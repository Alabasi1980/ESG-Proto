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
// P5D: browser-safe SHA-256 (pure TS, no node: imports) — this module is
// imported by the client bundle (ServicesView), where node:crypto is
// externalized and throws at module eval (total boot crash). Digests are
// byte-identical to node:crypto sha256 (pinned in generalBucket.test.ts).
const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/** SHA-256 hex digest, byte-identical to node:crypto. Synchronous on purpose:
 * the bucket-code helpers are sync and run in both server and browser. */
export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  const withOne = bytes.length + 1;
  const padded = withOne + ((64 - ((withOne + 8) % 64)) % 64) + 8;
  const msg = new Uint8Array(padded);
  msg.set(bytes);
  msg[bytes.length] = 0x80;
  const view = new DataView(msg.buffer);
  view.setUint32(padded - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(padded - 4, bitLen >>> 0);
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
      const s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = [h0, h1, h2, h3, h4, h5, h6, h7];
    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((v) => v.toString(16).padStart(8, '0')).join('');
}

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
  return `SERVICE-${sha256Hex(raw).slice(0, 8).toUpperCase()}`;
}

/** 8 uppercase hex characters derived from the service id (its first 8 for a
 * canonical UUID, a stable digest otherwise). This is the collision guard. */
export function serviceBucketSuffix(serviceId: unknown): string {
  const hex = String(serviceId ?? '').replace(/[^0-9a-fA-F]/g, '');
  if (hex.length >= 8) return hex.slice(0, 8).toUpperCase();
  return sha256Hex(String(serviceId ?? '')).slice(0, 8).toUpperCase();
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
