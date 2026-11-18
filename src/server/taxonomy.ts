import express, { type Response, type NextFunction } from 'express';
import type pg from 'pg';
import { recordAuditLog, setTenantContext } from '../db/index.ts';
import { sealApprovedCopy } from './routes/evaluations.ts';
import { domainTransaction, deferredFailure, DeferredRefusal } from './routes/initiativeScope.ts';
import { authMiddleware, type AuthenticatedRequest } from './auth.ts';
import { requireDomainAccess } from './access.ts';
import { readContext, requireFreshPassword, platformConfigContext, isFrozenScope, frozenWriteError } from './routes/_shared.ts';
import { maskedItemFields, scopeId, scopeError, ownTenant, ownDepartment, assertOwnDepartmentRows, LINKED_ITEM_SQL, SCOPED_ITEM_SQL } from './scope.ts';
import { EMPTY_CLIENT_FIELD_MASK, stripMaskedFields } from '../lib/clientFieldMask.ts';
import { checkServiceSettingsKeys, parseServiceSettings } from '../lib/serviceSettings.ts';
// TASK-PROTO-U4-1c (OD-12 §5–§7): item classification + the per-service
// general bucket (created/ensured in the service create/duplicate transactions).
import { ensureGeneralBucket, generalStandardCode } from '../lib/generalBucket.ts';
import { normalizeIndicatorCode, normalizeTags } from '../lib/documents.ts';
import {
  canonicalLinkPair,
  checkItemVersion,
  isEsgClass,
  isItemAnswerType,
  isItemPriority,
  serviceDeleteRefusal,
  validateBulkPatch,
  validateNewDisclosure,
  validateNewItem,
  validateNewStandard,
} from '../lib/taxonomy.ts';

// B11a — services / taxonomy / items / equivalent-links (S-04, S-05, S-06, S-08).
// B17 U2-C (task §22/§24): all 18 declarations are retrofitted through
// requireDomainAccess → context → scope/RLS → handler and activated:
// - READS run under readContext(req) (purpose 'work'): P sees the global
//   catalog through the b17_platform_scope arm of the C1 catalog policies;
//   W/C/E are scoped by the linked/assigned fact predicates (L / L+D) with
//   authorized-children-only parents and truthful counts — zero links means
//   an empty list, never all content.
// - WRITES (the 12 P-only declarations + delete-refusal pre-checks) run under
//   platformConfigContext(req) (purpose 'platform.config', targetless for the
//   global catalog; §24 ratified posture). DELETE pre-checks use the sanctioned
//   count-only definer b17_catalog_child_count so dependency refusals carry
//   truthful catalog-wide counts BEFORE any delete (no silent CASCADE, §23 D1).
// - The local contextFromUser builder and requireGeAdmin role checks are
//   retired per U2_LEGACY_HELPER_RETIREMENT.md: the dispatcher + wrapper matrix
//   (SHIELD-U2A-01/02) now refuse any non-P caller before this file runs.
// Import path owns creation of standards/disclosures/items at scale (the GRI
// commit upsert on the natural key); the endpoints below are the GE-only
// surgical tools for single-row fixes.

const router = express.Router();

// G2 E3-02: an error WE raised (integer statusCode, no 5-char SQLSTATE) keeps
// the exact body these handlers always sent — status + message, no code key;
// a raw PostgreSQL diagnostic or unknown failure collapses to the route's
// static fallback, so a handler bug can never become a database oracle.
// (_shared writeFailure would ADD a `code` key for our own scope.* errors —
// a wire change — so this byte-preserving twin stays file-local.)
function catalogFailure(res: Response, err: any, fallback: string): void {
  const own = Number.isInteger(err?.statusCode)
    && !(typeof err?.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code));
  if (own) { res.status(err.statusCode as number).json({ error: err.message || fallback }); return; }
  res.status(500).json({ error: fallback });
}

// U2-D carryover: validate every UUID-bearing input in this activated router,
// including alternate body/query link filters, before domain SQL can run.
function validateTaxonomyIds(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (req.params.id !== undefined) scopeId(req.params.id, true);
    for (const key of ['clientId','serviceId','standardId','disclosureId','itemId','departmentId','otherItemId','linkId']) {
      if (req.query[key] !== undefined) scopeId(req.query[key], true);
      if (req.body?.[key] !== undefined && req.body[key] !== null) scopeId(req.body[key], true);
    }
    next();
  } catch (err: any) {
    // scopeId is the only thrower here (own 400 scope.* codes): pass through
    // byte-for-byte. The collapse arm is fail-closed defence for any
    // unexpected non-own failure (E3-02 — never echo a PG diagnostic).
    if (Number.isInteger(err?.statusCode)
      && !(typeof err?.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code))) {
      res.status(400).json({ error: err.message, code: err.code });
      return;
    }
    res.status(400).json({ error: 'Invalid request input.' });
  }
}

/** §22/§3.2: explicit invalid filters REFUSE (400 scope.id_invalid) — they
 * never broaden the set (scope.ts itemQuery rule, applied to every read
 * filter here). Repeated/array query params are refused too (spec §5). */
function readFilter(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw scopeError(400, 'scope.id_invalid');
  const trimmed = value.trim();
  if (trimmed === '') throw scopeError(400, 'scope.id_invalid');
  return scopeId(trimmed, true);
}

/** Item column → its camelCase key in the `/items/:id/links` `otherItem`
 * projection. Masking deletes the KEY (a masked field must be ABSENT, never
 * present-as-null); `attachment_required` is not maskable and has no entry. */
const LINK_FIELD_KEYS: Readonly<Record<string, string>> = {
  hint: 'hint', priority: 'priority', weight: 'weight', esg_class: 'esgClass',
  reference: 'reference', topic: 'topic', objective: 'objective', sort_order: 'sortOrder',
};

/** Build ONE `otherItem` row (pure; U4-1a). Masked fields are deleted AFTER the
 * object is built, so no null/NaN coercion can re-introduce them. */
export function linkOtherItem(row: any, mask?: ReadonlySet<string>): Record<string, unknown> {
  const otherItem: Record<string, unknown> = {
    id: row.other_id,
    code: row.other_code,
    requirement: row.other_requirement,
    answerType: row.other_answer_type,
    priority: row.other_priority,
    weight: row.other_weight === null ? null : Number(row.other_weight),
    esgClass: row.other_esg_class,
    objective: row.other_objective,
    topic: row.other_topic,
    hint: row.other_hint,
    attachment_required: row.other_attachment_required === true,
    disclosureCode: row.disclosure_code,
    disclosureTitle: row.disclosure_title,
    standardCode: row.standard_code,
  };
  if (mask && mask.size) for (const field of mask) delete otherItem[LINK_FIELD_KEYS[field] ?? field];
  return otherItem;
}

// ----------------------------------------------------------------------
// Reads (any authenticated role; RLS still scopes department rows).
// ----------------------------------------------------------------------

// List services with their linked standards (S-04). §3.2: P catalog /
// W-C linked only / E linked services having own assigned items — the C1
// catalog policies scope every joined row (services, service_standards,
// standards), so the aggregate cannot leak foreign parents or counts.
router.get('/services', authMiddleware, requireDomainAccess, validateTaxonomyIds, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await domainTransaction(req, async (client) => {
      const result = await client.query(
        `SELECT s.id, s.code, s.name, s.description, s.created_at,
                COALESCE(
                  json_agg(
                    json_build_object('id', st.id, 'code', st.code, 'title', st.title)
                    ORDER BY st.code
                  ) FILTER (WHERE st.id IS NOT NULL),
                  '[]'
                ) AS standards
         FROM services s
         LEFT JOIN service_standards ss ON ss.service_id = s.id
         LEFT JOIN standards st ON st.id = ss.standard_id
         GROUP BY s.id
         ORDER BY s.code ASC`
      );
      return result.rows.map((r) => ({ ...r, standard_count: r.standards.length }));
    }, readContext);
    res.json(rows);
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    catalogFailure(res, err, 'Failed to fetch services');
  }
});

// List disclosures, optionally under one standard (S-05/S-06 UI support).
// §3.2: P catalog / W-C L / E L+D; item_count is computed over authorized
// items only (RLS); an invalid explicit filter refuses with 400.
router.get('/disclosures', authMiddleware, requireDomainAccess, validateTaxonomyIds, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const standardId = readFilter(req.query.standardId);
    const rows = await domainTransaction(req, async (client) => {
      const params: any[] = [];
      let where = '';
      if (standardId) {
        params.push(standardId);
        where = `WHERE d.standard_id = $${params.length}`;
      }
      const result = await client.query(
        `SELECT d.id, d.standard_id, d.code, d.title, d.description, d.sort_order,
                s.code AS standard_code, s.title AS standard_title,
                COUNT(DISTINCT i.id) FILTER (WHERE i.status = 'active')::int AS item_count
         FROM disclosures d
         JOIN standards s ON s.id = d.standard_id
         LEFT JOIN items i ON i.disclosure_id = d.id
         ${where}
         GROUP BY d.id, s.code, s.title
         ORDER BY s.code ASC, d.sort_order ASC NULLS LAST, d.code ASC`,
        params
      );
      return result.rows;
    }, readContext);
    res.json(rows);
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    catalogFailure(res, err, 'Failed to fetch disclosures');
  }
});

// List items, optionally under one disclosure (S-06 UI support).
// §3.2: P catalog / W-C L / E L+D; explicit filters narrow, never broaden,
// and malformed ones refuse with 400 scope.id_invalid.
router.get('/items', authMiddleware, requireDomainAccess, validateTaxonomyIds, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const disclosureId = readFilter(req.query.disclosureId);
    // TASK-PROTO-U4-2-FIX P2 (OD-13 G-4): archived items are out of the live
    // scope — excluded by default; P history views (P4) opt back in. A
    // repeated/array param is never 'true', so it fails closed to exclusion.
    const includeArchived = req.query.includeArchived === 'true';
    const rows = await domainTransaction(req, async (client) => {
      const params: any[] = [];
      const conditions: string[] = [];
      if (disclosureId) {
        params.push(disclosureId);
        conditions.push(`i.disclosure_id = $${params.length}`);
      }
      if (!includeArchived) conditions.push(`i.status = 'active'`);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const result = await client.query(
        `SELECT i.id, i.disclosure_id, i.code, i.requirement, i.answer_type, i.hint,
                i.priority, i.esg_class, i.weight, i.objective, i.topic, i.reference,
                i.department_id, i.sort_order, i.attachment_required,
                i.indicator_code, i.tags, i.version, i.status,
                d.code AS disclosure_code, s.code AS standard_code
         FROM items i
         JOIN disclosures d ON d.id = i.disclosure_id
         JOIN standards s ON s.id = d.standard_id
         ${where}
         ORDER BY i.sort_order ASC NULLS LAST, i.code ASC`,
        params
      );
      // U4-1a §6: C redaction through the ONE helper. `attachment_required` is
      // not in the whitelist, so it is never stripped.
      if (req.access!.mode === 'client' && result.rows.length) {
        const mask = await maskedItemFields(client, req.access!, result.rows.map((row: any) => String(row.id)));
        for (const row of result.rows)
          stripMaskedFields(row, mask.get(String(row.id)) ?? EMPTY_CLIENT_FIELD_MASK);
      }
      return result.rows;
    }, readContext);
    res.json(rows);
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    catalogFailure(res, err, 'Failed to fetch items');
  }
});

// ----------------------------------------------------------------------
// A. Services (S-04) — GE-only writes.
// ----------------------------------------------------------------------

router.post('/services', authMiddleware, requireFreshPassword, requireDomainAccess, validateTaxonomyIds, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const description =
      typeof req.body?.description === 'string' && req.body.description.trim() !== ''
        ? req.body.description.trim()
        : null;
    if (!code) return res.status(400).json({ error: 'Service code is required.' });
    if (!name) return res.status(400).json({ error: 'Service name is required.' });

    const created = await domainTransaction(req, async (client) => {
      const user = req.user!;
      let row;
      try {
        const ins = await client.query(
          `INSERT INTO services (code, name, description) VALUES ($1, $2, $3)
           RETURNING id, code, name, description, created_at`,
          [code, name, description]
        );
        row = ins.rows[0];
      } catch (dbErr: any) {
        if (dbErr?.code === '23505') {
          throw Object.assign(new Error(`A service with code '${code}' already exists.`), {
            statusCode: 409,
          });
        }
        throw dbErr;
      }
      await recordAuditLog(client, {
        clientId: null,
        userId: user.id,
        action: 'CREATE_SERVICE',
        entityType: 'services',
        entityId: row.id,
        payload: { code: row.code, name: row.name },
      });
      // TASK-PROTO-U4-1c (OD-12 §7): every service owns ONE general bucket
      // (standard GENERAL-<CODE> + disclosure GENERAL + mapping), created in the
      // same transaction; the helper is idempotent, so a retry is a no-op.
      await ensureGeneralBucket(client, row.id);
      return row;
    });
    res.status(201).json(created);
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    catalogFailure(res, err, 'Failed to create service');
  }
});

router.patch('/services/:id', authMiddleware, requireFreshPassword, requireDomainAccess, validateTaxonomyIds, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = req.body ?? {};
    // Service code is the natural key: immutable after creation.
    if (typeof body.code === 'string' && body.code.trim() !== '') {
      const cur = await domainTransaction(req, async (client) => {
        const r = await client.query('SELECT code FROM services WHERE id = $1', [req.params.id]);
        return r.rows[0]?.code ?? null;
      });
      if (cur !== null && body.code.trim() !== cur) {
        return res
          .status(400)
          .json({ error: 'Service code is immutable. Duplicate the service under a new code instead.' });
      }
    }
    const sets: string[] = [];
    const params: any[] = [];
    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) return res.status(400).json({ error: 'Service name must not be empty.' });
      params.push(name);
      sets.push(`name = $${params.length}`);
    }
    if (body.description !== undefined) {
      const desc =
        typeof body.description === 'string' && body.description.trim() !== ''
          ? body.description.trim()
          : null;
      params.push(desc);
      sets.push(`description = $${params.length}`);
    }
    if (body.settings !== undefined) {
      // U4-1a §3: per-service settings — plain JSON object, ≤ 8 KB serialized.
      // Shape/size are validated HERE (the column carries no CHECK), so a bad
      // value is a clean 400 instead of a database error.
      const parsed = parseServiceSettings(body.settings);
      if (!parsed.ok) {
        return res.status(400).json({
          error: 'settings must be a JSON object of at most 8 KB.',
          code: 'service.settings_invalid',
        });
      }
      // P5S (OD-13 API-2 CHANGE): closed named-key whitelist + value shapes,
      // refused BEFORE any write — UI-only enforcement is bypassable by
      // direct API calls. Unknown key → service.settings_unknown; wrong
      // value shape → service.settings_invalid (established shape code).
      const keysCheck = checkServiceSettingsKeys(body.settings);
      if (!keysCheck.ok) {
        // E3-02: literal codes only in the refusal bodies below (the
        // routeGates guard forbids a computed member there).
        if (keysCheck.code === 'service.settings_unknown') {
          return res.status(400).json({
            error: `Unknown settings key: '${keysCheck.key}'.`,
            code: 'service.settings_unknown',
          });
        }
        return res.status(400).json({
          error: `Invalid value for settings key: '${keysCheck.key}'.`,
          code: 'service.settings_invalid',
        });
      }
      params.push(parsed.serialized);
      sets.push(`settings = $${params.length}::jsonb`);
    }
    if (sets.length === 0) {
      return res.status(400).json({ error: 'Provide name, description and/or settings to update.' });
    }
    const updated = await domainTransaction(req, async (client) => {
      const user = req.user!;
      params.push(req.params.id);
      const upd = await client.query(
        `UPDATE services SET ${sets.join(', ')} WHERE id = $${params.length}
         RETURNING id, code, name, description, settings, created_at`,
        params
      );
      const row = upd.rows[0];
      if (!row) throw Object.assign(new Error('Service not found.'), { statusCode: 404 });
      await recordAuditLog(client, {
        clientId: null,
        userId: user.id,
        action: 'UPDATE_SERVICE',
        entityType: 'services',
        entityId: row.id,
        payload: { code: row.code, fields: sets.map((s) => s.split(' ')[0]) },
      });
      // TASK-PROTO-U4-1c (OD-12 §7): the idempotent BACKFILL path for services
      // that existed before this unit — the first platform save of a service
      // ensures its general bucket (GENERAL-<CODE> + disclosure + mapping).
      // A no-op on every later save, and it never touches items or answers.
      await ensureGeneralBucket(client, row.id);
      return row;
    });
    res.json(updated);
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    catalogFailure(res, err, 'Failed to update service');
  }
});

// Duplicate a service with its standard links under a NEW code (S-04).
router.post('/services/:id/duplicate', authMiddleware, requireFreshPassword, requireDomainAccess, validateTaxonomyIds, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    if (!code) {
      return res.status(400).json({ error: 'A new service code is required for duplication.' });
    }
    const nameOverride =
      typeof req.body?.name === 'string' && req.body.name.trim() !== ''
        ? req.body.name.trim()
        : null;

    const result = await domainTransaction(req, async (client) => {
      const user = req.user!;
      const srcRes = await client.query('SELECT * FROM services WHERE id = $1', [req.params.id]);
      const src = srcRes.rows[0];
      if (!src) throw Object.assign(new Error('Service not found.'), { statusCode: 404 });
      let copy;
      try {
        const ins = await client.query(
          `INSERT INTO services (code, name, description) VALUES ($1, $2, $3)
           RETURNING id, code, name, description, created_at`,
          [code, nameOverride ?? `${src.name} (copy)`, src.description]
        );
        copy = ins.rows[0];
      } catch (dbErr: any) {
        if (dbErr?.code === '23505') {
          throw Object.assign(new Error(`A service with code '${code}' already exists.`), {
            statusCode: 409,
          });
        }
        throw dbErr;
      }
      // Copy every standard link EXCEPT the source's own general bucket: that
      // container is per-service (GENERAL-<CODE>) and is re-created below for
      // the copy, so carrying the source's bucket would leave a second, stale
      // general link on the duplicate.
      const linkRes = await client.query(
        `INSERT INTO service_standards (service_id, standard_id)
         SELECT $1, ss.standard_id FROM service_standards ss
         JOIN standards st ON st.id = ss.standard_id
         WHERE ss.service_id = $2 AND st.code <> $3
         ON CONFLICT DO NOTHING`,
        [copy.id, src.id, generalStandardCode(src.code, src.id)]
      );
      await recordAuditLog(client, {
        clientId: null,
        userId: user.id,
        action: 'DUPLICATE_SERVICE',
        entityType: 'services',
        entityId: copy.id,
        payload: { fromServiceId: src.id, fromCode: src.code, code: copy.code, linksCopied: linkRes.rowCount ?? 0 },
      });
      // TASK-PROTO-U4-1c (OD-12 §7): the copy gets its OWN general bucket
      // (GENERAL-<NEW CODE>) — the source's bucket is not a copy of content, it
      // is a per-service container, so only this service's bucket is ensured.
      await ensureGeneralBucket(client, copy.id);
      return { service: copy, linksCopied: linkRes.rowCount ?? 0 };
    });
    res.status(201).json(result);
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    catalogFailure(res, err, 'Failed to duplicate service');
  }
});

// Link / unlink a standard to a service (S-04).
router.post('/services/:id/standards', authMiddleware, requireFreshPassword, requireDomainAccess, validateTaxonomyIds, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const standardId =
      typeof req.body?.standardId === 'string' ? req.body.standardId.trim() : '';
    if (!standardId) return res.status(400).json({ error: 'standardId is required.' });

    const result = await domainTransaction(req, async (client) => {
      const user = req.user!;
      const svc = await client.query('SELECT id, code FROM services WHERE id = $1', [req.params.id]);
      if (!svc.rows[0]) throw Object.assign(new Error('Service not found.'), { statusCode: 404 });
      const std = await client.query('SELECT id, code FROM standards WHERE id = $1', [standardId]);
      if (!std.rows[0]) throw Object.assign(new Error('Standard not found.'), { statusCode: 404 });
      const ins = await client.query(
        `INSERT INTO service_standards (service_id, standard_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING RETURNING id`,
        [req.params.id, standardId]
      );
      const created = (ins.rowCount ?? 0) > 0;
      if (created) {
        await recordAuditLog(client, {
          clientId: null,
          userId: user.id,
          action: 'LINK_SERVICE_STANDARD',
          entityType: 'service_standards',
          payload: { serviceId: req.params.id, standardId },
        });
      }
      return { linked: true, existed: !created };
    });
    res.status(result.existed ? 200 : 201).json(result);
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    catalogFailure(res, err, 'Failed to link standard');
  }
});

router.delete('/services/:id/standards', authMiddleware, requireFreshPassword, requireDomainAccess, validateTaxonomyIds, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const standardId =
      (typeof req.body?.standardId === 'string' && req.body.standardId.trim()) ||
      (typeof req.query.standardId === 'string' && req.query.standardId.trim()) ||
      '';
    if (!standardId) return res.status(400).json({ error: 'standardId is required.' });

    const result = await domainTransaction(req, async (client) => {
      const user = req.user!;
      const del = await client.query(
        'DELETE FROM service_standards WHERE service_id = $1 AND standard_id = $2',
        [req.params.id, standardId]
      );
      const existed = (del.rowCount ?? 0) > 0;
      if (existed) {
        await recordAuditLog(client, {
          clientId: null,
          userId: user.id,
          action: 'UNLINK_SERVICE_STANDARD',
          entityType: 'service_standards',
          payload: { serviceId: req.params.id, standardId },
        });
      }
      return { unlinked: true, existed };
    });
    res.json(result);
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    catalogFailure(res, err, 'Failed to unlink standard');
  }
});

// TASK-PROTO-U4-2-FIX P2 (OD-13 DG-02, owner default): full service removal.
// Preconditions (409 `service.delete_blocked`) while ANY blocker exists:
// tenant work on reachable items (answers/evaluations/assignments/actions),
// history versions, approved copies, tenant links, or service-bound tenant
// rows (report settings, document requirements, ESG profiles, standalone
// actions — CASCADE would silently drop them, NO ACTION would 500). Else
// hard delete: exclusive auto-buckets (GENERAL/GROUP with no other service
// link) + the service row; catalog CASCADE clears mappings. Audit in-txn.

router.delete('/services/:id', authMiddleware, requireFreshPassword, requireDomainAccess, validateTaxonomyIds, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await domainTransaction(req, async (client) => {
      const user = req.user!;
      const cur = await client.query('SELECT id, code FROM services WHERE id = $1 FOR UPDATE', [req.params.id]);
      const row = cur.rows[0];
      if (!row) throw Object.assign(new Error('Service not found.'), { statusCode: 404 });

      const itemRes = await client.query(
        `SELECT i.id FROM items i
          JOIN disclosures d ON d.id = i.disclosure_id
          JOIN service_standards ss ON ss.standard_id = d.standard_id
          WHERE ss.service_id = $1`,
        [req.params.id]
      );
      const itemIds: string[] = itemRes.rows.map((r: any) => String(r.id));
      const work = await client.query(
        `SELECT COALESCE((SELECT SUM(b17_catalog_child_count('item.answers', u)) FROM unnest($1::uuid[]) u), 0)::int AS answers,
                COALESCE((SELECT SUM(b17_catalog_child_count('item.evaluations', u)) FROM unnest($1::uuid[]) u), 0)::int AS evaluations,
                COALESCE((SELECT SUM(b17_catalog_child_count('item.assignments', u)) FROM unnest($1::uuid[]) u), 0)::int AS assignments,
                COALESCE((SELECT SUM(b17_catalog_child_count('item.actions', u)) FROM unnest($1::uuid[]) u), 0)::int AS actions`,
        [itemIds]
      );
      const scoped = await client.query(
        `SELECT (SELECT COUNT(*) FROM item_versions WHERE item_id = ANY($2::uuid[]))::int AS versions,
                (SELECT COUNT(*) FROM approved_service_copies WHERE service_id = $1)::int AS copies,
                (SELECT COUNT(*) FROM client_services WHERE service_id = $1)::int AS links,
                (SELECT COUNT(*) FROM report_settings WHERE service_id = $1)::int AS report_settings,
                (SELECT COUNT(*) FROM document_requirements WHERE service_id = $1)::int AS requirements,
                (SELECT COUNT(*) FROM esg_profile WHERE service_id = $1)::int AS profiles,
                (SELECT COUNT(*) FROM actions WHERE service_id = $1)::int AS service_actions`,
        [req.params.id, itemIds]
      );
      const blockers = {
        code: row.code,
        answers: work.rows[0]?.answers ?? 0,
        evaluations: work.rows[0]?.evaluations ?? 0,
        assignments: work.rows[0]?.assignments ?? 0,
        actions: work.rows[0]?.actions ?? 0,
        versions: scoped.rows[0]?.versions ?? 0,
        copies: scoped.rows[0]?.copies ?? 0,
        links: scoped.rows[0]?.links ?? 0,
        reportSettings: scoped.rows[0]?.report_settings ?? 0,
        requirements: scoped.rows[0]?.requirements ?? 0,
        profiles: scoped.rows[0]?.profiles ?? 0,
        serviceActions: scoped.rows[0]?.service_actions ?? 0,
      };
      const total = blockers.answers + blockers.evaluations + blockers.assignments + blockers.actions
        + blockers.versions + blockers.copies + blockers.links + blockers.reportSettings
        + blockers.requirements + blockers.profiles + blockers.serviceActions;
      if (total > 0) {
        throw Object.assign(new Error(serviceDeleteRefusal(blockers)), {
          statusCode: 409,
          code: 'service.delete_blocked',
        });
      }

      // Exclusive auto-buckets only: the service's own GENERAL bucket plus any
      // GROUP bucket with no link to another service. Shared standards stay.
      const bucketRes = await client.query(
        `SELECT st.id FROM standards st
          JOIN service_standards ss ON ss.standard_id = st.id
          WHERE ss.service_id = $1 AND (st.code = $2 OR st.category = 'group')
          AND NOT EXISTS (
            SELECT 1 FROM service_standards ss2
            WHERE ss2.standard_id = st.id AND ss2.service_id <> $1
          )`,
        [req.params.id, generalStandardCode(row.code, row.id)]
      );
      const bucketIds: string[] = bucketRes.rows.map((r: any) => String(r.id));
      if (bucketIds.length > 0) {
        await client.query('DELETE FROM standards WHERE id = ANY($1::uuid[])', [bucketIds]);
      }
      await client.query('DELETE FROM services WHERE id = $1', [req.params.id]);
      await recordAuditLog(client, {
        clientId: null,
        userId: user.id,
        action: 'SERVICE_DELETED',
        entityType: 'services',
        entityId: req.params.id,
        payload: { code: row.code, bucketsRemoved: bucketIds.length },
      });
      return { deleted: true, bucketsRemoved: bucketIds.length };
    });
    res.json(result);
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    catalogFailure(res, err, 'Failed to delete service');
  }
});

// ----------------------------------------------------------------------
// B. Taxonomy (S-05) — GE-only writes. Codes are natural import keys:
// renaming a code with rows under it is FORBIDDEN (400); titles editable.
// Deleting a standard/disclosure with children is refused (409, human).
// No create/delete of standards/disclosures via UI — the import path owns
// creation (see the /gri/commit upsert on the natural key).
// ----------------------------------------------------------------------

// TASK-PROTO-U4-2-FIX P2 (OD-13 G-1): surgical single-row creation for the
// flexible levels (standards incl. GROUP buckets, disclosures/groups,
// direct-item containers). Natural-key upsert refusal (409), codes immutable
// after creation; audit in-txn.

router.post('/standards', authMiddleware, requireFreshPassword, requireDomainAccess, validateTaxonomyIds, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const validation = validateNewStandard(req.body ?? {});
    if (!validation.ok) {
      return res.status(validation.status).json({ error: validation.error });
    }
    const v = validation.value;
    const created = await domainTransaction(req, async (client) => {
      const user = req.user!;
      let row;
      try {
        const ins = await client.query(
          `INSERT INTO standards (code, title, category) VALUES ($1, $2, $3)
           RETURNING id, code, title, category`,
          [v.code, v.title, v.category]
        );
        row = ins.rows[0];
      } catch (dbErr: any) {
        if (dbErr?.code === '23505') {
          throw Object.assign(new Error(`A standard with code '${v.code}' already exists.`), {
            statusCode: 409,
          });
        }
        throw dbErr;
      }
      await recordAuditLog(client, {
        clientId: null,
        userId: user.id,
        action: 'CREATE_STANDARD',
        entityType: 'standards',
        entityId: row.id,
        payload: { code: row.code, title: row.title, category: row.category },
      });
      return row;
    });
    res.status(201).json(created);
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    catalogFailure(res, err, 'Failed to create standard');
  }
});

router.post('/disclosures', authMiddleware, requireFreshPassword, requireDomainAccess, validateTaxonomyIds, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const validation = validateNewDisclosure(req.body ?? {});
    if (!validation.ok) {
      return res.status(validation.status).json({ error: validation.error });
    }
    const v = validation.value;
    const created = await domainTransaction(req, async (client) => {
      const user = req.user!;
      const std = await client.query('SELECT id, code FROM standards WHERE id = $1', [v.standardId]);
      if (!std.rows[0]) throw Object.assign(new Error('Standard not found.'), { statusCode: 404 });
      let row;
      try {
        const ins = await client.query(
          `INSERT INTO disclosures (standard_id, code, title, description) VALUES ($1, $2, $3, $4)
           RETURNING id, standard_id, code, title, description`,
          [v.standardId, v.code, v.title, v.description]
        );
        row = ins.rows[0];
      } catch (dbErr: any) {
        if (dbErr?.code === '23505') {
          throw Object.assign(
            new Error(`A disclosure with code '${v.code}' already exists in this standard.`),
            { statusCode: 409 }
          );
        }
        throw dbErr;
      }
      await recordAuditLog(client, {
        clientId: null,
        userId: user.id,
        action: 'CREATE_DISCLOSURE',
        entityType: 'disclosures',
        entityId: row.id,
        payload: { standardCode: std.rows[0].code, code: row.code, title: row.title },
      });
      return row;
    });
    res.status(201).json(created);
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    catalogFailure(res, err, 'Failed to create disclosure');
  }
});

router.patch('/standards/:id', authMiddleware, requireFreshPassword, requireDomainAccess, validateTaxonomyIds, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = req.body ?? {};
    if (typeof body.code === 'string' && body.code.trim() !== '') {
      return res.status(400).json({
        error: 'Standard code is immutable — codes are natural import keys. Edit the title instead.',
      });
    }
    const sets: string[] = [];
    const params: any[] = [];
    if (body.title !== undefined) {
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      if (!title) return res.status(400).json({ error: 'Standard title must not be empty.' });
      params.push(title);
      sets.push(`title = $${params.length}`);
    }
    if (body.category !== undefined) {
      const category = typeof body.category === 'string' ? body.category.trim() : '';
      if (!category) return res.status(400).json({ error: 'Standard category must not be empty.' });
      params.push(category);
      sets.push(`category = $${params.length}`);
    }
    if (sets.length === 0) {
      return res.status(400).json({ error: 'Provide title and/or category to update.' });
    }
    const updated = await domainTransaction(req, async (client) => {
      const user = req.user!;
      params.push(req.params.id);
      const upd = await client.query(
        `UPDATE standards SET ${sets.join(', ')} WHERE id = $${params.length}
         RETURNING id, code, title, category, version`,
        params
      );
      const row = upd.rows[0];
      if (!row) throw Object.assign(new Error('Standard not found.'), { statusCode: 404 });
      await recordAuditLog(client, {
        clientId: null,
        userId: user.id,
        action: 'UPDATE_STANDARD',
        entityType: 'standards',
        entityId: row.id,
        payload: { code: row.code, title: row.title, category: row.category },
      });
      return row;
    });
    res.json(updated);
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    catalogFailure(res, err, 'Failed to update standard');
  }
});

router.delete('/standards/:id', authMiddleware, requireFreshPassword, requireDomainAccess, validateTaxonomyIds, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await domainTransaction(req, async (client) => {
      const user = req.user!;
      const cur = await client.query('SELECT id, code FROM standards WHERE id = $1', [req.params.id]);
      const row = cur.rows[0];
      if (!row) throw Object.assign(new Error('Standard not found.'), { statusCode: 404 });
      // §22/§23 D1: truthful catalog-wide refusal count via the sanctioned
      // count-only definer (platform.config guard inside), BEFORE any delete —
      // children of a global standard may belong to any tenant (no CASCADE).
      const kids = await client.query(
        `SELECT b17_catalog_child_count('standard.disclosures', $1) AS n`,
        [req.params.id]
      );
      const n = kids.rows[0]?.n ?? 0;
      if (n > 0) {
        throw Object.assign(
          new Error(
            `Cannot delete standard '${row.code}': ${n} disclosure(s) still belong to it. Reassign or remove them first.`
          ),
          { statusCode: 409 }
        );
      }
      await client.query('DELETE FROM standards WHERE id = $1', [req.params.id]);
      await recordAuditLog(client, {
        clientId: null,
        userId: user.id,
        action: 'DELETE_STANDARD',
        entityType: 'standards',
        entityId: req.params.id,
        payload: { code: row.code },
      });
      return { deleted: true };
    });
    res.json(result);
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    catalogFailure(res, err, 'Failed to delete standard');
  }
});

router.patch('/disclosures/:id', authMiddleware, requireFreshPassword, requireDomainAccess, validateTaxonomyIds, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = req.body ?? {};
    if (typeof body.code === 'string' && body.code.trim() !== '') {
      return res.status(400).json({
        error: 'Disclosure code is immutable — codes are natural import keys. Edit the title instead.',
      });
    }
    if (body.standardId !== undefined || body.standard_id !== undefined) {
      return res.status(400).json({
        error: 'A disclosure cannot be moved to another standard via PATCH. Re-import it instead.',
      });
    }
    const sets: string[] = [];
    const params: any[] = [];
    if (body.title !== undefined) {
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      if (!title) return res.status(400).json({ error: 'Disclosure title must not be empty.' });
      params.push(title);
      sets.push(`title = $${params.length}`);
    }
    if (body.description !== undefined) {
      const desc =
        typeof body.description === 'string' && body.description.trim() !== ''
          ? body.description.trim()
          : null;
      params.push(desc);
      sets.push(`description = $${params.length}`);
    }
    if (sets.length === 0) {
      return res.status(400).json({ error: 'Provide title and/or description to update.' });
    }
    const updated = await domainTransaction(req, async (client) => {
      const user = req.user!;
      params.push(req.params.id);
      const upd = await client.query(
        `UPDATE disclosures SET ${sets.join(', ')} WHERE id = $${params.length}
         RETURNING id, standard_id, code, title, description`,
        params
      );
      const row = upd.rows[0];
      if (!row) throw Object.assign(new Error('Disclosure not found.'), { statusCode: 404 });
      await recordAuditLog(client, {
        clientId: null,
        userId: user.id,
        action: 'UPDATE_DISCLOSURE',
        entityType: 'disclosures',
        entityId: row.id,
        payload: { code: row.code, title: row.title },
      });
      return row;
    });
    res.json(updated);
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    catalogFailure(res, err, 'Failed to update disclosure');
  }
});

router.delete('/disclosures/:id', authMiddleware, requireFreshPassword, requireDomainAccess, validateTaxonomyIds, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await domainTransaction(req, async (client) => {
      const user = req.user!;
      const cur = await client.query('SELECT id, code FROM disclosures WHERE id = $1', [req.params.id]);
      const row = cur.rows[0];
      if (!row) throw Object.assign(new Error('Disclosure not found.'), { statusCode: 404 });
      // §22/§23 D1: truthful catalog-wide refusal count before any delete.
      const kids = await client.query(
        `SELECT b17_catalog_child_count('disclosure.items', $1) AS n`,
        [req.params.id]
      );
      const n = kids.rows[0]?.n ?? 0;
      if (n > 0) {
        throw Object.assign(
          new Error(
            `Cannot delete disclosure '${row.code}': ${n} item(s) still belong to it. Reassign or remove them first.`
          ),
          { statusCode: 409 }
        );
      }
      await client.query('DELETE FROM disclosures WHERE id = $1', [req.params.id]);
      await recordAuditLog(client, {
        clientId: null,
        userId: user.id,
        action: 'DELETE_DISCLOSURE',
        entityType: 'disclosures',
        entityId: req.params.id,
        payload: { code: row.code },
      });
      return { deleted: true };
    });
    res.json(result);
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    catalogFailure(res, err, 'Failed to delete disclosure');
  }
});

// ----------------------------------------------------------------------
// C. Items (S-06) — GE-only writes. (disclosure_id, code) is the natural
// key: code is immutable once created; other fields editable. Priority
// changes re-derive weight via the enforce_item_weight_priority trigger
// (the route never sets weight directly). New items get
// sort_order = max+1 within the disclosure when not provided.
// ----------------------------------------------------------------------

router.post('/items', authMiddleware, requireFreshPassword, requireDomainAccess, validateTaxonomyIds, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const validation = validateNewItem(req.body ?? {});
    if (!validation.ok) {
      return res.status(validation.status).json({ error: validation.error });
    }
    const v = validation.value;
    const disclosureId = String((req.body as any).disclosureId).trim();
    // TASK-PROTO-U4-1c (OD-12 §5/§6): indicator_code + tags are handler-validated
    // (no schema CHECK), so the same rules serve every writer and the future UI.
    const indicator = normalizeIndicatorCode((req.body as any)?.indicatorCode ?? (req.body as any)?.indicator_code);
    if (!indicator.ok) return res.status(400).json({ error: indicator.error, code: indicator.code });
    const tags = normalizeTags((req.body as any)?.tags);
    if (!tags.ok) return res.status(400).json({ error: tags.error, code: tags.code });

    const created = await domainTransaction(req, async (client) => {
      const user = req.user!;
      const disc = await client.query('SELECT id, code FROM disclosures WHERE id = $1', [disclosureId]);
      if (!disc.rows[0]) throw Object.assign(new Error('Disclosure not found.'), { statusCode: 404 });
      if (v.departmentId) {
        const dept = await client.query('SELECT id FROM departments WHERE id = $1', [v.departmentId]);
        if (!dept.rows[0]) {
          throw Object.assign(new Error('Department not found.'), { statusCode: 400 });
        }
      }
      let sortOrder = v.sortOrder;
      if (sortOrder === null) {
        const maxRes = await client.query(
          'SELECT COALESCE(MAX(sort_order), 0)::int AS m FROM items WHERE disclosure_id = $1',
          [disclosureId]
        );
        sortOrder = (maxRes.rows[0]?.m ?? 0) + 1;
      }
      let row;
      try {
        // NOTE: weight is intentionally NOT set — enforce_item_weight_priority
        // derives it from priority (high=3, mid=2, low=1).
        const ins = await client.query(
           `INSERT INTO items (disclosure_id, code, requirement, answer_type, hint, priority,
                               esg_class, objective, topic, reference, department_id, sort_order,
                               indicator_code, tags)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING id, disclosure_id, code, requirement, answer_type, hint, priority,
                      esg_class, weight, objective, topic, reference, department_id, sort_order,
                      indicator_code, tags, version, status`,
          [
            disclosureId,
            v.code,
            v.requirement,
            v.answerType,
            v.hint,
            v.priority,
            v.esgClass,
            v.objective,
            v.topic,
            v.reference,
            v.departmentId,
            sortOrder,
            indicator.value,
            tags.value,
          ]
        );
        row = ins.rows[0];
      } catch (dbErr: any) {
        if (dbErr?.code === '23505') {
          throw Object.assign(
            new Error(`An item with code '${v.code}' already exists in this disclosure.`),
            { statusCode: 409 }
          );
        }
        throw dbErr;
      }
      await recordAuditLog(client, {
        clientId: null,
        userId: user.id,
        action: 'CREATE_ITEM',
        entityType: 'items',
        entityId: row.id,
        payload: { disclosureCode: disc.rows[0].code, code: row.code },
      });
      return row;
    });
    res.status(201).json(created);
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    catalogFailure(res, err, 'Failed to create item');
  }
});

// TASK-PROTO-U4-2-FIX P2 (OD-13 DG-06): bulk edit of the whitelisted item
// subset (answerType/priority/esgClass/attachment_required) with per-row
// optimistic versions. One transaction, per-row results — a row failure
// never aborts its siblings and never applies silently. Department changes
// stay single-item (per-row refusal). Spec §API-3: 200 + row results carry
// the multi-status semantics.

router.post('/items/bulk', authMiddleware, requireFreshPassword, requireDomainAccess, validateTaxonomyIds, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = req.body ?? {};
    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      return res.status(400).json({ error: 'ids must be a non-empty array of item ids.' });
    }
    const patchCheck = validateBulkPatch(body.patch);
    if (!patchCheck.ok && !patchCheck.perRow) {
      const patchError: string = patchCheck.error;
      return res.status(patchCheck.status).json({ error: patchError });
    }
    const expectedVersions = body.expectedVersions;
    if (expectedVersions !== undefined && expectedVersions !== null
      && (typeof expectedVersions !== 'object' || Array.isArray(expectedVersions))) {
      return res.status(400).json({ error: 'expectedVersions must be an object of id to version.' });
    }
    const sets = patchCheck.ok ? patchCheck.sets : [];
    const departmentError: string | null = patchCheck.ok ? null : patchCheck.error;

    // Canonical lock order (sorted ids) so two concurrent bulks can never
    // deadlock on row locks; results are re-ordered to the request order.
    const entries = body.ids.map((raw: unknown, index: number) => ({ raw, index }));
    const ordered = [...entries].sort((a, b) => String(a.raw) < String(b.raw) ? -1 : 1);

    const byIndex: { index: number; result: Record<string, unknown> }[] = await domainTransaction(req, async (client) => {
      const user = req.user!;
      const out: { index: number; result: Record<string, unknown> }[] = [];
      for (const entry of ordered) {
        const rawId = entry.raw;
        if (typeof rawId !== 'string' || rawId.trim() === '') {
          out.push({ index: entry.index, result: { id: rawId ?? null, ok: false, error: 'Invalid item id.', code: 'scope.id_invalid' } });
          continue;
        }
        const id = rawId.trim();
        if (departmentError !== null) {
          out.push({ index: entry.index, result: { id, ok: false, error: departmentError } });
          continue;
        }
        try {
          scopeId(id, true);
        } catch {
          out.push({ index: entry.index, result: { id, ok: false, error: 'Invalid item id.', code: 'scope.id_invalid' } });
          continue;
        }
        try {
          const cur = await client.query(
            'SELECT id, code, version, status FROM items WHERE id = $1 FOR UPDATE', [id]
          );
          const row = cur.rows[0];
          if (!row) {
            out.push({ index: entry.index, result: { id, ok: false, error: 'Item not found.' } });
            continue;
          }
          if (row.status === 'archived') {
            out.push({
              index: entry.index,
              result: { id, ok: false, error: 'Item is archived. Unarchive it before editing.', code: 'item.archived' },
            });
            continue;
          }
          const gate = checkItemVersion(row.version, expectedVersions?.[id]);
          if (!gate.ok) {
            const gateError: string = gate.error;
            const gateCode = gate.status === 409 ? 'item.version_conflict' : undefined;
            out.push({
              index: entry.index,
              result: gateCode ? { id, ok: false, error: gateError, code: gateCode } : { id, ok: false, error: gateError },
            });
            continue;
          }
          const params: any[] = [];
          const fragments = sets.map((s) => {
            params.push(s.value);
            return `${s.column} = $${params.length}`;
          });
          params.push(id);
          const upd = await client.query(
            `UPDATE items SET ${fragments.join(', ')}, version = version + 1 WHERE id = $${params.length}
             RETURNING id, code, version, status`,
            params
          );
          const updated = upd.rows[0];
          await recordAuditLog(client, {
            clientId: null,
            userId: user.id,
            action: 'UPDATE_ITEM',
            entityType: 'items',
            entityId: updated.id,
            payload: { code: updated.code, fields: sets.map((s) => s.key), bulk: true },
          });
          out.push({ index: entry.index, result: { id, ok: true, version: updated.version } });
        } catch {
          // One row never aborts its siblings; unexpected row failures stay
          // static (no diagnostic echo — G2 E3-02).
          out.push({ index: entry.index, result: { id, ok: false, error: 'Failed to update item.' } });
        }
      }
      return out;
    });
    const results = byIndex.sort((a, b) => a.index - b.index).map((e) => e.result);
    const updated = results.filter((r) => r.ok === true).length;
    res.json({ results, updated, failed: results.length - updated });
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    catalogFailure(res, err, 'Failed to bulk-update items');
  }
});

router.patch('/items/:id', authMiddleware, requireFreshPassword, requireDomainAccess, validateTaxonomyIds, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = req.body ?? {};
    if (
      (typeof body.code === 'string' && body.code.trim() !== '') ||
      body.disclosureId !== undefined ||
      body.disclosure_id !== undefined
    ) {
      return res.status(400).json({
        error:
          'Item code and disclosure are immutable — code is the natural key. Edit the other fields instead.',
      });
    }
    const sets: string[] = [];
    const params: any[] = [];
    const changed: string[] = [];
    const pushText = (key: string, column: string, allowEmpty: boolean) => {
      if (body[key] !== undefined) {
        if (typeof body[key] !== 'string') {
          throw Object.assign(new Error(`${key} must be a string.`), { statusCode: 400 });
        }
        const t = body[key].trim();
        if (!allowEmpty && t === '') {
          throw Object.assign(new Error(`${key} must not be empty.`), { statusCode: 400 });
        }
        params.push(t === '' ? null : t);
        sets.push(`${column} = $${params.length}`);
        changed.push(key);
      }
    };
    pushText('requirement', 'requirement', false);
    pushText('hint', 'hint', true);
    pushText('objective', 'objective', true);
    pushText('topic', 'topic', true);
    pushText('reference', 'reference', true);
    if (body.answerType !== undefined) {
      if (!isItemAnswerType(body.answerType)) {
        return res.status(400).json({ error: 'answerType must be one of: text, number, boolean, date, file.' });
      }
      params.push(body.answerType);
      sets.push(`answer_type = $${params.length}`);
      changed.push('answerType');
    }
    if (body.priority !== undefined) {
      if (!isItemPriority(body.priority)) {
        return res.status(400).json({ error: 'priority must be one of: high, mid, low.' });
      }
      // Weight is NOT set here: enforce_item_weight_priority re-derives it.
      params.push(body.priority);
      sets.push(`priority = $${params.length}`);
      changed.push('priority');
    }
    if (body.esgClass !== undefined) {
      if (!isEsgClass(body.esgClass)) {
        return res
          .status(400)
          .json({ error: 'esgClass must be one of: environmental, social, governance, general.' });
      }
      params.push(body.esgClass);
      sets.push(`esg_class = $${params.length}`);
      changed.push('esgClass');
    }
    if (body.sortOrder !== undefined) {
      if (body.sortOrder !== null) {
        const n = Number(body.sortOrder);
        if (!Number.isInteger(n) || n < 0) {
          return res.status(400).json({ error: 'sortOrder must be a non-negative integer.' });
        }
        params.push(n);
      } else {
        params.push(null);
      }
      sets.push(`sort_order = $${params.length}`);
      changed.push('sortOrder');
    }
    if (body.weight !== undefined) {
      return res.status(400).json({
        error: 'weight is derived from priority by the database trigger and cannot be set directly.',
      });
    }
    // TASK-PROTO-U4-1c (OD-12 §5/§6): item classification — validated here, no DB CHECK.
    if (body.indicatorCode !== undefined || body.indicator_code !== undefined) {
      const parsed = normalizeIndicatorCode(body.indicatorCode ?? body.indicator_code);
      if (!parsed.ok) return res.status(400).json({ error: parsed.error, code: parsed.code });
      params.push(parsed.value);
      sets.push(`indicator_code = $${params.length}`);
      changed.push('indicatorCode');
    }
    if (body.tags !== undefined) {
      const parsed = normalizeTags(body.tags);
      if (!parsed.ok) return res.status(400).json({ error: parsed.error, code: parsed.code });
      params.push(parsed.value);
      sets.push(`tags = $${params.length}::text[]`);
      changed.push('tags');
    }
    let departmentTouched = false;
    let departmentId: string | null = null;
    if (body.departmentId !== undefined) {
      departmentTouched = true;
      departmentId =
        typeof body.departmentId === 'string' && body.departmentId.trim() !== ''
          ? body.departmentId.trim()
          : null;
    }
    if (sets.length === 0 && !departmentTouched) {
      return res.status(400).json({ error: 'No editable field provided.' });
    }

    // TASK-PROTO-U4-2-FIX P4 (OD-13 G-3): version gate + snapshot + reopen, one txn.
    // `reason` is the caller-supplied history note for the version row (capped).
    const bodyReason =
      typeof body.reason === 'string' && body.reason.trim() !== '' ? body.reason.trim().slice(0, 500) : null;
    const updated = await domainTransaction(req, async (client) => {
      const user = req.user!;
      const cur = await client.query('SELECT id, code, version, status FROM items WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!cur.rows[0]) throw Object.assign(new Error('Item not found.'), { statusCode: 404 });
      if (cur.rows[0].status === 'archived') {
        throw Object.assign(new Error('Item is archived. Unarchive it before editing.'), {
          statusCode: 409, code: 'item.archived',
        });
      }
      // Stale write → 409 item.version_conflict (same shape as the bulk row error).
      const gate = checkItemVersion(cur.rows[0].version, body.expectedVersion);
      if (!gate.ok) {
        if (gate.status === 409) {
          throw Object.assign(new Error(gate.error), {
            statusCode: 409, code: 'item.version_conflict',
            provided: body.expectedVersion ?? null, current: cur.rows[0].version,
          });
        }
        throw Object.assign(new Error(gate.error), { statusCode: gate.status });
      }
      // Reopen detection: pre-final answers on this item (explicit status column
      // only — the CfgØ ring forbids value/correction_history projections here).
      const ansRes = await client.query(
        'SELECT id, client_id, department_id, status FROM answers WHERE item_id = $1',
        [req.params.id]
      );
      const reopenable = ansRes.rows.filter(
        (a: any) => a.status === 'submitted' || a.status === 'approved' || a.status === 'client_approved'
      );
      // Frozen scope refuses first (API pre-check; the is_scope_frozen
      // triggers are the backstop and are mapped to the same 409 below).
      // Tenant discovery runs over ALL answers on the item, not just the
      // reopenable subset: a frozen scope cannot hold pre-final states, but
      // the check must not depend on that invariant to fire.
      // Context note: the frozen fact binds an explicit tenant
      // (current_tenant_id = target_id = T), so the check runs under a
      // per-tenant target-bound switch; targetless platform config would
      // evaluate every scope as unfrozen. The switch is transaction-local and
      // rolled back with the rest on any refusal.
      {
        const tenants = [...new Set(ansRes.rows.map((a: any) => String(a.client_id)))];
        for (const tenant of tenants) {
          await setTenantContext(client as unknown as pg.PoolClient, platformConfigContext(req, tenant));
          const frozen = await isFrozenScope(client, tenant, req.params.id);
          await setTenantContext(client as unknown as pg.PoolClient, platformConfigContext(req, null));
          if (frozen) {
            throw Object.assign(frozenWriteError(), { code: 'FROZEN_SCOPE' });
          }
        }
      }
      // The pre-edit row for the version snapshot (the row is already locked).
      const full = await client.query('SELECT * FROM items WHERE id = $1', [req.params.id]);
      if (departmentTouched) {
        if (departmentId) {
          const dept = await client.query('SELECT id FROM departments WHERE id = $1', [departmentId]);
          if (!dept.rows[0]) {
            throw Object.assign(new Error('Department not found.'), { statusCode: 400 });
          }
        }
        params.push(departmentId);
        sets.push(`department_id = $${params.length}`);
        changed.push('departmentId');
      }
      params.push(req.params.id);
      let reopened = 0;
      if (reopenable.length > 0) {
        // INV-HISTORY: snapshot first (insert-before-update), using the
        // pre-edit row locked above.
        await client.query(
          'INSERT INTO item_versions (item_id, version, snapshot, changed_by, reason) VALUES ($1, $2, $3, $4, $5)',
          [req.params.id, cur.rows[0].version, full.rows[0], user.id, bodyReason]
        );
      }
      // Version lockstep: every successful PATCH bumps items.version.
      const upd = await client.query(
        `UPDATE items SET ${sets.join(', ')}, version = version + 1 WHERE id = $${params.length}
         RETURNING id, disclosure_id, code, requirement, answer_type, hint, priority,
                   esg_class, weight, objective, topic, reference, department_id, sort_order,
                   indicator_code, tags, version, status`,
        params
      );
      const row = upd.rows[0];
      if (reopenable.length > 0) {
        // Answers are RLS-visible only under the targetless configuration
        // (the summary-loop SELECT branch), so the write runs targetless —
        // where the reopen branch admits it. The frozen trigger backstop is
        // blind under targetless (the fact needs a bound tenant), hence the
        // tenant-bound re-check below closes the freeze-landing-mid-write
        // race: a freeze detected after the write rolls the whole txn back.
        const reRes = await client.query(
          `UPDATE answers SET status = 'reopened', version = version + 1, updated_at = NOW()
           WHERE id = ANY($1::uuid[])`,
          [reopenable.map((a: any) => String(a.id))]
        );
        reopened = reRes.rowCount ?? 0;
        if (reopened !== reopenable.length) {
          throw Object.assign(new Error('Failed to reopen item answers.'), { statusCode: 500 });
        }
        {
          const tenants = [...new Set(reopenable.map((a: any) => String(a.client_id)))];
          for (const tenant of tenants) {
            await setTenantContext(client as unknown as pg.PoolClient, platformConfigContext(req, tenant));
            const frozen = await isFrozenScope(client, tenant, req.params.id);
            await setTenantContext(client as unknown as pg.PoolClient, platformConfigContext(req, null));
            if (frozen) {
              throw Object.assign(frozenWriteError(), { code: 'FROZEN_SCOPE' });
            }
          }
        }
      }
      await recordAuditLog(client, {
        clientId: null,
        userId: user.id,
        action: reopened > 0 ? 'REOPEN_ITEM_SCOPE' : 'UPDATE_ITEM',
        entityType: 'items',
        entityId: row.id,
        payload:
          reopened > 0
            ? {
                code: row.code, fields: changed, fromVersion: cur.rows[0].version,
                toVersion: row.version, reopenedAnswers: reopened, reason: bodyReason,
              }
            : { code: row.code, fields: changed },
      });
      return reopened > 0 ? { ...row, reopenedAnswers: reopened } : row;
    });
    res.json(updated);
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    // P4 coded refusals (own codes, never a PG diagnostic): version conflict,
    // archived, and frozen scope keep their {error, code} body. Anything else
    // stays on the byte-preserving catalog path. Literal bodies only — no
    // err.message/err.code echo (G2 E3-02 ring).
    if (err?.statusCode === 409 && err?.code === 'item.version_conflict') {
      res.status(409).json({
        error: `Item changed since version ${err.provided} (now at ${err.current}). Reload and retry.`,
        code: 'item.version_conflict',
      });
      return;
    }
    if (err?.statusCode === 409 && err?.code === 'item.archived') {
      res.status(409).json({ error: 'Item is archived. Unarchive it before editing.', code: 'item.archived' });
      return;
    }
    if (err?.statusCode === 409 && err?.code === 'FROZEN_SCOPE') {
      res.status(409).json({
        error: 'This scope is frozen by GE final approval. Editing is disabled; only append-only snapshot notes are allowed.',
        code: 'FROZEN_SCOPE',
      });
      return;
    }
    if (typeof err?.message === 'string' && err.message.includes('FROZEN_SCOPE')) {
      res.status(409).json({
        error: 'This scope is frozen by GE final approval. Editing is disabled; only append-only snapshot notes are allowed.',
        code: 'FROZEN_SCOPE',
      });
      return;
    }
    catalogFailure(res, err, 'Failed to update item');
  }
});

router.delete('/items/:id', authMiddleware, requireFreshPassword, requireDomainAccess, validateTaxonomyIds, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = req.body ?? {};
    const rawReason = typeof body.reason === 'string' ? body.reason.trim() : '';
    // Caller-supplied archive note; capped so the history row stays a note.
    const archiveReason = rawReason === '' ? null : rawReason.slice(0, 500);
    const result = await domainTransaction(req, async (client) => {
      const user = req.user!;
      // Serialize FK writers before counting: no concurrent action insertion
      // may slip between a truthful count and the archive/hard-delete edge.
      const cur = await client.query('SELECT id, code, status FROM items WHERE id = $1 FOR UPDATE', [req.params.id]);
      const row = cur.rows[0];
      if (!row) throw Object.assign(new Error('Item not found.'), { statusCode: 404 });
      // DELETE is idempotent: an archived item is already out of the live
      // scope, so a repeat reports the same state. TASK-PROTO-U4-2-FIX P4
      // (F2, Tera decision): the repeat is tracked — an audit row is emitted
      // on the redundant archive too (idempotent but tracked).
      if (row.status === 'archived') {
        await recordAuditLog(client, {
          clientId: null,
          userId: user.id,
          action: 'ARCHIVE_ITEM',
          entityType: 'items',
          entityId: req.params.id,
          payload: { code: row.code, reason: archiveReason, redundant: true },
        });
        return { archived: true };
      }
      // §22/§23 D1: truthful catalog-wide counts for every blocker — answers,
      // evaluations and assignments (incl. OTHER tenants' rows) come from the
      // count-only definer, so the archive decision can never fail open into
      // CASCADE. Versions are read directly: RESTRICT must never fire.
      const counts = await client.query(
        `SELECT b17_catalog_child_count('item.answers', $1) AS answers,
                b17_catalog_child_count('item.evaluations', $1) AS evaluations,
                b17_catalog_child_count('item.assignments', $1) AS assignments,
                b17_catalog_child_count('item.actions', $1) AS actions,
                (SELECT COUNT(*) FROM item_versions WHERE item_id = $1)::int AS versions`,
        [req.params.id]
      );
      const blockers = {
        answers: counts.rows[0]?.answers ?? 0,
        evaluations: counts.rows[0]?.evaluations ?? 0,
        assignments: counts.rows[0]?.assignments ?? 0,
      };
      const actions = counts.rows[0].actions;
      const versions = counts.rows[0]?.versions ?? 0;
      const otherCount = blockers.answers + blockers.evaluations + blockers.assignments;
      // TASK-PROTO-U4-2-FIX P2 (OD-13 G-4): any tenant work or preserved
      // history archives instead of deleting — the item leaves the live scope
      // with its answers/attachments/approvals retained for history.
      if (otherCount + actions + versions > 0) {
        await client.query(
          `UPDATE items SET status = 'archived', archived_at = clock_timestamp(), archive_reason = $2
           WHERE id = $1`,
          [req.params.id, archiveReason]
        );
        await recordAuditLog(client, {
          clientId: null,
          userId: user.id,
          action: 'ARCHIVE_ITEM',
          entityType: 'items',
          entityId: req.params.id,
          payload: { code: row.code, reason: archiveReason },
        });
        return { archived: true };
      }
      // item_links rows cascade (ON DELETE CASCADE) — links never block deletion.
      await client.query('DELETE FROM items WHERE id = $1', [req.params.id]);
      await recordAuditLog(client, {
        clientId: null,
        userId: user.id,
        action: 'DELETE_ITEM',
        entityType: 'items',
        entityId: req.params.id,
        payload: { code: row.code },
      });
      return { deleted: true };
    });
    res.json(result);
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    catalogFailure(res, err, 'Failed to delete item');
  }
});

// TASK-PROTO-U4-2-FIX P4 (OD-13 G-3/G-4, API §API-2/§API-5): item edit-history
// viewer. Matrix: P catalog-global; W own-tenant linked; C own-tenant linked
// + gap-gated (same gap fact as the evaluations reads); E own-department
// provenance only (G-SHARED fail-closed). versions[] is newest-first with
// {version, snapshot, changedBy, changedAt, reason}; answersSummary is
// counts-by-status only — never values/history (CfgØ ring). Unknown combos
// fail closed (ownTenant/assertWorkScope + RLS).
router.get('/items/:id/history', authMiddleware, requireDomainAccess, validateTaxonomyIds, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = await domainTransaction(req, async (client) => {
      const access = req.access!;
      const id = req.params.id;
      if (access.mode === 'platform') {
        // P sees the global catalog through the platform configuration arm.
        const itemRes = await client.query(
          `SELECT i.id, i.code, i.requirement, i.version, i.status,
                  d.code AS disclosure_code, s.code AS standard_code
           FROM items i
           JOIN disclosures d ON d.id = i.disclosure_id
           JOIN standards s ON s.id = d.standard_id
           WHERE i.id = $1`,
          [id]
        );
        if (!itemRes.rows[0]) throw Object.assign(new Error('Item not found.'), { statusCode: 404 });
        const versions = await client.query(
          `SELECT version, snapshot, changed_by, changed_at, reason FROM item_versions
           WHERE item_id = $1 ORDER BY version DESC`,
          [id]
        );
        const summary = await client.query(
          'SELECT status, COUNT(*)::int AS count FROM answers WHERE item_id = $1 GROUP BY status ORDER BY status',
          [id]
        );
        return {
          versions: versions.rows.map((v: any) => ({
            version: v.version, snapshot: v.snapshot, changedBy: v.changed_by,
            changedAt: v.changed_at, reason: v.reason,
          })),
          answersSummary: summary.rows,
        };
      }
      // W/C/E: the tenant is always the caller's OWN (comparison only).
      const tenant = ownTenant(access, req.query.clientId);
      const ownDept = ownDepartment(access);
      const predicate = ownDept ? SCOPED_ITEM_SQL : LINKED_ITEM_SQL;
      const params: any[] = ownDept ? [tenant, null, ownDept] : [tenant, null];
      const itemRes = await client.query(
        `SELECT i.id, i.code, i.requirement, i.version, i.status FROM items i
         WHERE i.id = $${params.length + 1} AND ${predicate}`,
        [...params, id]
      );
      if (!itemRes.rows[0]) throw Object.assign(new Error('Item not found.'), { statusCode: 404 });
      // C gap gate (same fact as the evaluations reads): a non-gapped item is
      // invisible to the client reader — fail closed with the generic 404.
      if (access.mode === 'client') {
        const gap = await client.query(`SELECT b17_content_fact('gap',$1,$2) AS ok`, [tenant, id]);
        if (!gap.rows[0]?.ok) throw Object.assign(new Error('Item not found.'), { statusCode: 404 });
      }
      // E provenance: own retained assignment + single-department answers (the
      // same shape the own-department evaluation fact requires) — a
      // foreign-department/shared item yields no history at all. No evaluations
      // read here (targetless-platform ring). The item_versions RLS branch
      // re-checks the full fact as defence in depth.
      if (ownDept) {
        const prov = await client.query(
          `SELECT 1 FROM assignments a WHERE a.client_id = $1 AND a.item_id = $2 AND a.department_id = $3
           AND NOT EXISTS (SELECT 1 FROM answers o WHERE o.client_id = a.client_id AND o.item_id = a.item_id AND o.department_id <> $3)`,
          [tenant, id, ownDept]
        );
        if (!prov.rows[0]) throw Object.assign(new Error('Item not found.'), { statusCode: 404 });
      }
      const versions = await client.query(
        `SELECT version, snapshot, changed_by, changed_at, reason FROM item_versions
         WHERE item_id = $1 ORDER BY version DESC`,
        [id]
      );
      const summary = await client.query(
        'SELECT status, COUNT(*)::int AS count FROM answers WHERE client_id = $1 AND item_id = $2 GROUP BY status ORDER BY status',
        [tenant, id]
      );
      const answers = await client.query(
        `SELECT id, department_id, status FROM answers
         WHERE client_id = $1 AND item_id = $2 AND ($3::uuid IS NULL OR department_id = $3)`,
        [tenant, id, ownDept]
      );
      assertOwnDepartmentRows(access, answers.rows);
      return {
        versions: versions.rows.map((v: any) => ({
          version: v.version, snapshot: v.snapshot, changedBy: v.changed_by,
          changedAt: v.changed_at, reason: v.reason,
        })),
        answersSummary: summary.rows,
      };
    }, (live) => (live.access!.mode === 'platform' ? platformConfigContext(live, null) : readContext(live)));
    res.json(data);
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    catalogFailure(res, err, 'Failed to fetch item history');
  }
});

// TASK-PROTO-U4-2-FIX P4 (OD-13 G-5, API §API-2/§API-5): sealed approved-copy
// viewer. Matrix: P (explicit target T); W/C own-tenant (comparison only); E
// denied (no matrix row — refused before any SQL). Payload + files only, no
// catalog joins, so the copy stays complete after full source-service removal
// (N-3). Attachment bytes are base64-encoded in the files array.
/** Explicit-target tenant for the sealed-copy viewer (P), else the caller's own
 * tenant with the supplied id compared only (W/C). E never reaches here
 * (matrix denial + the handler refusal below). Reads req inline — no
 * authority binding, so the G1 pre-lock capture ring stays green. */
function viewerTenant(req: AuthenticatedRequest): string {
  if (req.access!.mode === 'platform') {
    return scopeId(typeof req.query.clientId === 'string' ? req.query.clientId.trim() : '', true)!;
  }
  return ownTenant(req.access!, req.query.clientId);
}

router.get('/services/:id/approved-copy', authMiddleware, requireDomainAccess, validateTaxonomyIds, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (req.access!.mode === 'employee') {
      return res.status(403).json({ error: 'Employees may not view approved copies.', code: 'scope.denied' });
    }
    if (typeof req.query.clientId !== 'string' || !req.query.clientId.trim()) {
      return res.status(400).json({ error: 'clientId is required.' });
    }
    const tenant = viewerTenant(req);
    const data = await domainTransaction(req, async (client) => {
      const access = req.access!;
      if (access.mode === 'platform') {
        const exists = await client.query('SELECT id FROM clients WHERE id = $1', [tenant]);
        if (!exists.rows[0]) {
          throw Object.assign(new Error('Target tenant not found for the given clientId.'), { statusCode: 404 });
        }
      }
      const copyRes = await client.query(
        `SELECT id, client_id, service_id, service_code, sealed_at, sealed_by, content_hash, payload, status
         FROM approved_service_copies WHERE client_id = $1 AND service_id = $2
         ORDER BY sealed_at DESC LIMIT 1`,
        [tenant, req.params.id]
      );
      const copy = copyRes.rows[0];
      if (!copy) {
        throw Object.assign(new Error('No sealed approved copy for this service and client.'), {
          statusCode: 404, code: 'copy.not_found',
        });
      }
      const filesRes = await client.query(
        `SELECT id, answer_ref, file_name, mime, size_bytes, data FROM approved_copy_files
         WHERE copy_id = $1 ORDER BY file_name ASC, id ASC`,
        [copy.id]
      );
      return {
        ...copy,
        files: filesRes.rows.map((f: any) => ({ ...f, data: Buffer.from(f.data).toString('base64') })),
      };
    }, (live) => (live.access!.mode === 'platform' ? platformConfigContext(live, tenant) : readContext(live)));
    res.json(data);
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    if (err?.statusCode === 404 && err?.code === 'copy.not_found') {
      res.status(404).json({ error: 'No sealed approved copy for this service and client.', code: 'copy.not_found' });
      return;
    }
    catalogFailure(res, err, 'Failed to fetch approved copy');
  }
});

// TASK-PROTO-U4-2-FIX P4 (OD-13 G-5): standalone approved-copy seal (P-only, taxonomy surface:
// explicit target T, mounted on the taxonomy (P catalog) surface. Two phases in ONE transaction (atomic by construction):
//  - Phase A under the targetless platform configuration: verify definition,
//    linkage, the assigned item set, and freeze coverage â€” the seal requires a
//    GE-final freeze covering every assigned item of the service (the freeze
//    gate already proved client-approval, which P cannot re-read from
//    evaluations). Summary-loop readable; explicit non-sensitive columns only.
//  - Phase B switches to the target-bound configuration context: byte copy
//    (b17_attachments_seal_read) + copy/file/audit inserts (P@T branches).
// Mismatch with an existing sealed copy â†’ ROLLBACK + 409 copy.seal_conflict.
router.post('/approved-copies/seal', authMiddleware, requireFreshPassword, requireDomainAccess, validateTaxonomyIds, async (req: AuthenticatedRequest, res: Response) => {
  try {
    // P-only is enforced by the matrix (non-P never reaches the handler);
    // inline read, no authority binding (G1 ring).
    if (req.access!.mode !== 'platform') {
      return res.status(403).json({ error: 'Only platform administrators may seal approved copies.', code: 'scope.denied' });
    }
    const body = req.body ?? {};
    const clientId = scopeId(body.clientId, true)!;
    const serviceId = scopeId(body.serviceId, true)!;
    const result = await domainTransaction(req, async (client) => {
      const user = req.user!;
      // Phase A: targetless verification reads (same PoolClient cast as Phase B).
      await setTenantContext(client as unknown as pg.PoolClient, platformConfigContext(req, null));
      const svcRes = await client.query('SELECT id, code FROM services WHERE id = $1', [serviceId]);
      if (!svcRes.rows[0]) throw Object.assign(new Error('Service not found.'), { statusCode: 404 });
      const linkRes = await client.query(
        'SELECT service_id FROM client_services WHERE client_id = $1 AND service_id = $2',
        [clientId, serviceId]
      );
      if (!linkRes.rows[0]) {
        throw Object.assign(new Error('Service is not linked to this client.'), { statusCode: 409 });
      }
      const itemRes = await client.query(
        `SELECT i.id FROM items i
         JOIN disclosures d ON d.id = i.disclosure_id
         JOIN service_standards ss ON ss.standard_id = d.standard_id
         JOIN assignments a ON a.item_id = i.id AND a.client_id = $2
         WHERE ss.service_id = $1`,
        [serviceId, clientId]
      );
      const ids = itemRes.rows.map((r: any) => String(r.id));
      if (ids.length === 0) {
        throw Object.assign(new Error('Nothing to seal: this service has no assigned items for the client.'), {
          statusCode: 400,
        });
      }
      const ansRes = await client.query(
        `SELECT id, item_id, department_id, status, value, version, updated_at FROM answers
         WHERE client_id = $1 AND item_id = ANY($2::uuid[]) ORDER BY item_id ASC, department_id ASC`,
        [clientId, ids]
      );
      // Freeze coverage: every assigned item must sit inside a frozen snapshot
      // (any scope â€” the union proves GE-final approval, which P cannot
      // re-derive from evaluations). Uncovered â†’ refuse before any write.
      const snapRes = await client.query(
        'SELECT scope_type, payload FROM review_snapshots WHERE client_id = $1 ORDER BY created_at DESC LIMIT 50',
        [clientId]
      );
      const frozen = new Set<string>();
      for (const row of snapRes.rows) {
        const items = row.payload && typeof row.payload === 'object' ? (row.payload as { items?: unknown }).items : null;
        if (Array.isArray(items)) {
          for (const entry of items) {
            const itemId = (entry as { itemId?: unknown })?.itemId;
            if (typeof itemId === 'string') frozen.add(itemId);
          }
        }
      }
      const uncovered = ids.filter((id) => !frozen.has(id));
      if (uncovered.length > 0) {
        throw Object.assign(
          new Error(`Cannot seal: ${uncovered.length} assigned item(s) are not covered by a GE-final freeze yet.`),
          { statusCode: 400, code: 'copy.scope_not_covered' }
        );
      }
      // Phase B: target-bound byte copy + inserts (own txn, atomic).
      await setTenantContext(client as unknown as pg.PoolClient, platformConfigContext(req, clientId));
      return sealApprovedCopy(
        client,
        { clientId, serviceId, sealedBy: user.id },
        { answers: ansRes.rows, frozenScores: null }
      );
    }, (live) => platformConfigContext(live, scopeId((req.body ?? {}).clientId, true)));
    res.status(result.deduped ? 200 : 201).json(result);
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    if (err?.statusCode === 409 && err?.code === 'copy.seal_conflict') {
      res.status(409).json({ error: 'A sealed copy already exists for this client and service with different content. Sealed copies are immutable.', code: 'copy.seal_conflict' });
      return;
    }
    if (err?.statusCode === 400 && err?.code === 'copy.scope_not_covered') {
      res.status(400).json({ error: 'Cannot seal: assigned items are not covered by a GE-final freeze yet.', code: 'copy.scope_not_covered' });
      return;
    }
    catalogFailure(res, err, 'Failed to seal approved copy');
  }
});

// ----------------------------------------------------------------------
// D. Equivalent-item links (S-08) — GE-only writes; reads expose the
// linked item's metadata + the reader's OWN-department evaluation state
// only (DD-06: never another department's answers or evidence text).
// ----------------------------------------------------------------------

function linkRefusal(status: number, error: string): { status: number; error: string } {
  return { status, error };
}

router.post('/items/:id/links', authMiddleware, requireFreshPassword, requireDomainAccess, validateTaxonomyIds, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const otherRaw = req.body?.otherItemId;
    const pair = canonicalLinkPair(req.params.id, otherRaw);
    if (!pair) {
      const r = linkRefusal(400, 'An item cannot be linked to itself. Provide a different otherItemId.');
      return res.status(r.status).json({ error: r.error });
    }
    let relation = 'equivalent';
    if (req.body?.relation !== undefined) {
      if (typeof req.body.relation !== 'string' || req.body.relation.trim() === '') {
        return res.status(400).json({ error: 'relation must be a non-empty string.' });
      }
      if (req.body.relation.trim().length > 32) {
        return res.status(400).json({ error: 'relation must be at most 32 characters.' });
      }
      relation = req.body.relation.trim();
    }
    const [first, second] = pair;

    const created = await domainTransaction(req, async (client) => {
      const user = req.user!;
      const items = await client.query('SELECT id FROM items WHERE id = ANY($1)', [[first, second]]);
      if ((items.rowCount ?? 0) !== 2) {
        const mine = await client.query('SELECT id FROM items WHERE id = $1', [req.params.id]);
        if (!mine.rows[0]) throw Object.assign(new Error('Item not found.'), { statusCode: 404 });
        throw Object.assign(new Error('The other item was not found.'), { statusCode: 404 });
      }
      let row;
      try {
        const ins = await client.query(
          `INSERT INTO item_links (item_a, item_b, relation, created_by)
           VALUES ($1, $2, $3, $4) RETURNING id, item_a, item_b, relation, created_at`,
          [first, second, relation, user.id]
        );
        row = ins.rows[0];
      } catch (dbErr: any) {
        if (dbErr?.code === '23505') {
          throw Object.assign(new Error('These two items are already linked as equivalents.'), {
            statusCode: 409,
          });
        }
        throw dbErr;
      }
      await recordAuditLog(client, {
        clientId: null,
        userId: user.id,
        action: 'LINK_ITEMS',
        entityType: 'item_links',
        entityId: row.id,
        payload: { itemA: first, itemB: second, relation },
      });
      return row;
    });
    res.status(201).json(created);
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    catalogFailure(res, err, 'Failed to create item link');
  }
});

router.delete('/items/:id/links', authMiddleware, requireFreshPassword, requireDomainAccess, validateTaxonomyIds, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const linkId =
      (typeof req.body?.linkId === 'string' && req.body.linkId.trim()) ||
      (typeof req.query.linkId === 'string' && req.query.linkId.trim()) ||
      '';
    const otherRaw =
      (typeof req.body?.otherItemId === 'string' && req.body.otherItemId.trim()) ||
      (typeof req.query.otherItemId === 'string' && req.query.otherItemId.trim()) ||
      '';
    if (!linkId && !otherRaw) {
      return res.status(400).json({ error: 'Provide linkId or otherItemId to remove the link.' });
    }

    const result = await domainTransaction(req, async (client) => {
      const user = req.user!;
      let del;
      if (linkId) {
        del = await client.query(
          'DELETE FROM item_links WHERE id = $1 AND (item_a = $2 OR item_b = $2) RETURNING id',
          [linkId, req.params.id]
        );
      } else {
        const pair = canonicalLinkPair(req.params.id, otherRaw);
        if (!pair) {
          throw Object.assign(new Error('Link not found.'), { statusCode: 404 });
        }
        del = await client.query('DELETE FROM item_links WHERE item_a = $1 AND item_b = $2 RETURNING id', pair);
      }
      const row = del.rows[0];
      if (!row) throw Object.assign(new Error('Link not found.'), { statusCode: 404 });
      await recordAuditLog(client, {
        clientId: null,
        userId: user.id,
        action: 'UNLINK_ITEMS',
        entityType: 'item_links',
        entityId: row.id,
        payload: { itemId: req.params.id },
      });
      return { unlinked: true };
    });
    res.json(result);
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    catalogFailure(res, err, 'Failed to remove item link');
  }
});

// Read-only reference: linked item metadata + the reader's OWN-department
// evaluation state (or "not evaluated by your department"). §3.2 (U2-C):
// P = catalog metadata ONLY, never a tenant evaluation overlay — a supplied
// clientId is refused for P; W/C = both ends L with own-tenant evaluation
// state (C gap-gated by the evaluations policy); E = both ends L+D and
// own-department answer status only, never foreign evidence/text (DD-06).
// Non-string clientId (repeated/array param) refuses 400; foreign clientId
// keeps its 403. Inaccessible item id stays the existing generic 404.
router.get('/items/:id/links', authMiddleware, requireDomainAccess, validateTaxonomyIds, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rawClientId = req.query.clientId;
    if (rawClientId !== undefined && rawClientId !== null && typeof rawClientId !== 'string') {
      throw scopeError(400, 'scope.id_invalid');
    }
    const explicitClient =
      typeof rawClientId === 'string' && rawClientId.trim() ? rawClientId.trim() : null;
    const rows = await domainTransaction(req, async (client) => {
      const access = req.access!;
      if (explicitClient && (access.mode === 'platform' || explicitClient !== access.tenantId))
        throw new DeferredRefusal(403, { error: 'Cross-tenant link reads are forbidden.' });
      const tenantId = access.mode === 'platform' ? null : access.tenantId;
      const mine = await client.query('SELECT id FROM items WHERE id = $1', [req.params.id]);
      if (!mine.rows[0]) throw Object.assign(new Error('Item not found.'), { statusCode: 404 });
      const links = await client.query(
        `SELECT l.id AS link_id, l.relation, l.created_at,
                o.id AS other_id, o.code AS other_code, o.requirement AS other_requirement,
                o.answer_type AS other_answer_type, o.priority AS other_priority,
                o.weight AS other_weight, o.esg_class AS other_esg_class,
                o.objective AS other_objective, o.topic AS other_topic,
                o.hint AS other_hint, o.attachment_required AS other_attachment_required,
                d.code AS disclosure_code, d.title AS disclosure_title,
                s.code AS standard_code
         FROM item_links l
         JOIN items o ON o.id = CASE WHEN l.item_a = $1 THEN l.item_b ELSE l.item_a END
         JOIN disclosures d ON d.id = o.disclosure_id
         JOIN standards s ON s.id = d.standard_id
         WHERE l.item_a = $1 OR l.item_b = $1
         ORDER BY o.code ASC`,
        [req.params.id]
      );
      // U4-1a §6: C mask for the linked items, applied by linkOtherItem when the
      // response object is built (key deletion after construction).
      const maskByItem = req.access!.mode === 'client' && links.rows.length
        ? await maskedItemFields(client, req.access!, links.rows.map((row: any) => String(row.other_id)))
        : null;
      // Tenant evaluation per linked item (score-level only — no answer text).
      const otherIds = links.rows.map((r) => r.other_id);
      const evalByItem = new Map<string, any>();
      const ansByItem = new Map<string, string | null>();
      if (tenantId && otherIds.length > 0) {
        const evRes = await client.query(
          `SELECT item_id, score, not_evaluated, not_applicable, na_reason
           FROM evaluations WHERE client_id = $1 AND item_id = ANY($2)`,
          [tenantId, otherIds]
        );
        for (const r of evRes.rows) evalByItem.set(String(r.item_id), r);
        // Own department only (E): the reader's department answer status, never
        // another department's rows (answers RLS enforces this too).
        if (access.departmentId) {
          const ansRes = await client.query(
            `SELECT item_id, status FROM answers
             WHERE client_id = $1 AND department_id = $2 AND item_id = ANY($3)`,
            [tenantId, access.departmentId, otherIds]
          );
          for (const r of ansRes.rows) ansByItem.set(String(r.item_id), r.status);
        }
      }
      return links.rows.map((r) => {
        const ev = evalByItem.get(String(r.other_id)) ?? null;
        const evaluated = ev !== null && !ev.not_evaluated && !ev.not_applicable;
        return {
          id: r.link_id,
          relation: r.relation,
          createdAt: r.created_at,
          otherItem: linkOtherItem(r, maskByItem?.get(String(r.other_id))),
          evaluation: ev
            ? {
                score: ev.score,
                notEvaluated: ev.not_evaluated,
                notApplicable: ev.not_applicable,
                naReason: ev.na_reason,
              }
            : null,
          ownDepartmentAnswerStatus: ansByItem.get(String(r.other_id)) ?? null,
          state: evaluated ? 'evaluated' : 'not evaluated by your department',
        };
      });
    }, readContext);
    res.json({ links: rows, count: rows.length });
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    catalogFailure(res, err, 'Failed to fetch item links');
  }
});

export default router;
