// TASK-PROTO-U4-1c (OD-12 §7) — the ONE general bucket per service.
//
// Owner decision: a free question (an item with no standard/disclosure of its
// own) is a real requirement, so every service gets a GENERAL bucket created
// automatically — standard `GENERAL-<SANITIZED_CODE>-<FIRST8(SERVICE_ID)>`
// («عام / General»), disclosure `GENERAL` («أسئلة عامة / General questions») and
// the `service_standards` mapping. NO schema change: items living there are
// ordinary items with `esg_class='general'` (the column already allows it).
//
// Round 2 (M-01): the code carries an 8-hex suffix of the SERVICE ID, so two
// services whose codes slug to the same text can never collide on
// `standards.code` (which is globally UNIQUE). The lookup prefers the service's
// OWN bucket and only falls back to an already-mapped general standard (the
// pre-suffix legacy row) so a not-yet-renamed database keeps working.
//
// Idempotence is the contract: create / duplicate / backfill may call this in
// any order, any number of times, and the bucket must converge on exactly one
// row per object. Every write is `ON CONFLICT DO NOTHING` + a read-back, so a
// concurrent pair of calls cannot mint a duplicate and a repeat is a no-op.
import { createHash } from 'node:crypto';

/** Minimal query surface (a pg client, a pool or a transaction client). */
export type BucketDb = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

export const GENERAL_STANDARD_PREFIX = 'GENERAL-';
export const GENERAL_STANDARD_TITLE = 'عام / General';
export const GENERAL_DISCLOSURE_CODE = 'GENERAL';
export const GENERAL_DISCLOSURE_TITLE = 'أسئلة عامة / General questions';
export const GENERAL_STANDARD_CATEGORY = 'general';

/** Uppercase ASCII slug of a service code. Never empty: a code with no ASCII
 * letter/digit (e.g. an Arabic-only code) falls back to a digest of the
 * ORIGINAL code, so two such services can never share one GENERAL standard. */
export function sanitizeServiceCode(serviceCode: unknown): string {
  const raw = typeof serviceCode === 'string' ? serviceCode : String(serviceCode ?? '');
  const slug = raw.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  if (slug) return slug;
  return `SERVICE-${createHash('sha256').update(raw).digest('hex').slice(0, 8).toUpperCase()}`;
}

/** 8 uppercase hex characters derived from the service id (its first 8 for a
 * canonical UUID, a stable digest otherwise). This is the collision guard. */
export function serviceBucketSuffix(serviceId: unknown): string {
  const hex = String(serviceId ?? '').replace(/[^0-9a-fA-F]/g, '');
  if (hex.length >= 8) return hex.slice(0, 8).toUpperCase();
  return createHash('sha256').update(String(serviceId ?? '')).digest('hex').slice(0, 8).toUpperCase();
}

/** Standards.code for a service's general bucket (globally unique by construction). */
export function generalStandardCode(serviceCode: unknown, serviceId: unknown): string {
  return `${GENERAL_STANDARD_PREFIX}${sanitizeServiceCode(serviceCode)}-${serviceBucketSuffix(serviceId)}`;
}

export interface GeneralBucketResult {
  serviceId: string;
  serviceCode: string;
  standardCode: string;
  standardId: string;
  disclosureId: string;
  /** True when the service already had a general bucket before this call. */
  adopted: boolean;
  /** Which of the three objects this call had to create (all false on a repeat). */
  created: { standard: boolean; disclosure: boolean; mapping: boolean };
}

const one = async (db: BucketDb, text: string, params: any[]): Promise<any> => (await db.query(text, params)).rows[0];

/**
 * Create-or-ensure the general bucket of ONE service. Safe to call repeatedly
 * and inside the caller's transaction (service create / duplicate / backfill).
 * The service row must already exist (create paths call it after INSERT …
 * RETURNING); a missing service is a programming error, not a user refusal.
 */
export async function ensureGeneralBucket(db: BucketDb, serviceId: string): Promise<GeneralBucketResult> {
  const service = await one(db, 'SELECT id, code FROM services WHERE id = $1', [serviceId]);
  if (!service) throw new Error('general.service_not_found');
  const expected = generalStandardCode(service.code, service.id);

  // Prefer the service's OWN bucket. A mapped general-category standard is the
  // only accepted fallback (a pre-suffix legacy row that the live rename
  // statement has not touched yet) — any other standard is never adopted.
  const own = await one(db, 'SELECT id FROM standards WHERE code = $1', [expected]);
  const legacy = own ? null : await one(db,
    `SELECT st.id FROM service_standards ss JOIN standards st ON st.id = ss.standard_id
      WHERE ss.service_id = $1 AND st.category = $2 ORDER BY st.code LIMIT 1`,
    [serviceId, GENERAL_STANDARD_CATEGORY]);

  let standardId: string | undefined = own?.id ?? legacy?.id;
  let standardCode = expected;
  let createdStandard = false;
  if (!standardId) {
    const inserted = await one(db,
      `INSERT INTO standards (code, title, category) VALUES ($1, $2, $3)
       ON CONFLICT (code) DO NOTHING RETURNING id`,
      [expected, GENERAL_STANDARD_TITLE, GENERAL_STANDARD_CATEGORY]);
    standardId = inserted?.id ?? (await one(db, 'SELECT id FROM standards WHERE code = $1', [expected]))?.id;
    createdStandard = Boolean(inserted);
  } else if (!own) {
    standardCode = String((await one(db, 'SELECT code FROM standards WHERE id = $1', [standardId]))?.code ?? expected);
  }
  if (!standardId) throw new Error('general.standard_missing');

  const insertedDisclosure = await one(db,
    `INSERT INTO disclosures (standard_id, code, title, sort_order) VALUES ($1, $2, $3, 0)
     ON CONFLICT (standard_id, code) DO NOTHING RETURNING id`,
    [standardId, GENERAL_DISCLOSURE_CODE, GENERAL_DISCLOSURE_TITLE]);
  const disclosureId = insertedDisclosure?.id
    ?? (await one(db, 'SELECT id FROM disclosures WHERE standard_id = $1 AND code = $2',
      [standardId, GENERAL_DISCLOSURE_CODE]))?.id;
  if (!disclosureId) throw new Error('general.disclosure_missing');

  const mapping = await db.query(
    `INSERT INTO service_standards (service_id, standard_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING RETURNING id`,
    [serviceId, standardId]);

  return {
    serviceId: String(service.id),
    serviceCode: String(service.code),
    standardCode,
    standardId: String(standardId),
    disclosureId: String(disclosureId),
    adopted: Boolean(own ?? legacy),
    created: { standard: createdStandard, disclosure: Boolean(insertedDisclosure),
      mapping: (mapping.rowCount ?? 0) > 0 },
  };
}

/**
 * Idempotent backfill for services created before this unit (OD-12 §7). One
 * pass over the catalog; a service that already has its bucket is a no-op, so
 * re-running is free. Returns the per-service results (created flags included
 * so the caller/evidence can state exactly what the run changed).
 *
 * The ROUTE-level backfill path is P's first save of an existing service:
 * PATCH /services/:id ensures that one service's bucket inside the same
 * platform configuration transaction, so no operator SQL is required.
 */
export async function backfillGeneralBuckets(db: BucketDb): Promise<GeneralBucketResult[]> {
  const services = (await db.query('SELECT id FROM services ORDER BY code, id')).rows;
  const results: GeneralBucketResult[] = [];
  for (const service of services) results.push(await ensureGeneralBucket(db, String(service.id)));
  return results;
}
