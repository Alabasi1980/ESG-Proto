import express, { type Response, type NextFunction } from 'express';
import { recordAuditLog } from '../db/index.ts';
import { domainTransaction, deferredFailure, DeferredRefusal } from './routes/initiativeScope.ts';
import { authMiddleware, type AuthenticatedRequest } from './auth.ts';
import { requireDomainAccess } from './access.ts';
import { readContext, requireFreshPassword } from './routes/_shared.ts';
import { scopeId, scopeError } from './scope.ts';
import {
  canonicalLinkPair,
  isEsgClass,
  isItemAnswerType,
  isItemPriority,
  itemDeleteRefusal,
  validateNewItem,
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
                COUNT(DISTINCT i.id)::int AS item_count
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
    const rows = await domainTransaction(req, async (client) => {
      const params: any[] = [];
      let where = '';
      if (disclosureId) {
        params.push(disclosureId);
        where = `WHERE i.disclosure_id = $${params.length}`;
      }
      const result = await client.query(
        `SELECT i.id, i.disclosure_id, i.code, i.requirement, i.answer_type, i.hint,
                i.priority, i.esg_class, i.weight, i.objective, i.topic, i.reference,
                i.department_id, i.sort_order,
                d.code AS disclosure_code, s.code AS standard_code
         FROM items i
         JOIN disclosures d ON d.id = i.disclosure_id
         JOIN standards s ON s.id = d.standard_id
         ${where}
         ORDER BY i.sort_order ASC NULLS LAST, i.code ASC`,
        params
      );
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
    if (sets.length === 0) {
      return res.status(400).json({ error: 'Provide name and/or description to update.' });
    }
    const updated = await domainTransaction(req, async (client) => {
      const user = req.user!;
      params.push(req.params.id);
      const upd = await client.query(
        `UPDATE services SET ${sets.join(', ')} WHERE id = $${params.length}
         RETURNING id, code, name, description, created_at`,
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
      const linkRes = await client.query(
        `INSERT INTO service_standards (service_id, standard_id)
         SELECT $1, standard_id FROM service_standards WHERE service_id = $2
         ON CONFLICT DO NOTHING`,
        [copy.id, src.id]
      );
      await recordAuditLog(client, {
        clientId: null,
        userId: user.id,
        action: 'DUPLICATE_SERVICE',
        entityType: 'services',
        entityId: copy.id,
        payload: { fromServiceId: src.id, fromCode: src.code, code: copy.code, linksCopied: linkRes.rowCount ?? 0 },
      });
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

// ----------------------------------------------------------------------
// B. Taxonomy (S-05) — GE-only writes. Codes are natural import keys:
// renaming a code with rows under it is FORBIDDEN (400); titles editable.
// Deleting a standard/disclosure with children is refused (409, human).
// No create/delete of standards/disclosures via UI — the import path owns
// creation (see the /gri/commit upsert on the natural key).
// ----------------------------------------------------------------------

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
                              esg_class, objective, topic, reference, department_id, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING id, disclosure_id, code, requirement, answer_type, hint, priority,
                     esg_class, weight, objective, topic, reference, department_id, sort_order`,
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

    const updated = await domainTransaction(req, async (client) => {
      const user = req.user!;
      const cur = await client.query('SELECT id, code FROM items WHERE id = $1', [req.params.id]);
      if (!cur.rows[0]) throw Object.assign(new Error('Item not found.'), { statusCode: 404 });
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
      const upd = await client.query(
        `UPDATE items SET ${sets.join(', ')} WHERE id = $${params.length}
         RETURNING id, disclosure_id, code, requirement, answer_type, hint, priority,
                   esg_class, weight, objective, topic, reference, department_id, sort_order`,
        params
      );
      const row = upd.rows[0];
      await recordAuditLog(client, {
        clientId: null,
        userId: user.id,
        action: 'UPDATE_ITEM',
        entityType: 'items',
        entityId: row.id,
        payload: { code: row.code, fields: changed },
      });
      return row;
    });
    res.json(updated);
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    catalogFailure(res, err, 'Failed to update item');
  }
});

router.delete('/items/:id', authMiddleware, requireFreshPassword, requireDomainAccess, validateTaxonomyIds, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await domainTransaction(req, async (client) => {
      const user = req.user!;
      // Serialize FK writers before counting: no concurrent action insertion
      // may slip between a truthful count and the ON DELETE SET NULL edge.
      const cur = await client.query('SELECT id, code FROM items WHERE id = $1 FOR UPDATE', [req.params.id]);
      const row = cur.rows[0];
      if (!row) throw Object.assign(new Error('Item not found.'), { statusCode: 404 });
      // §22/§23 D1: truthful catalog-wide counts for every blocker — answers,
      // evaluations and assignments (incl. OTHER tenants' rows) come from the
      // count-only definer, so the refusal can never fail open into CASCADE.
      const counts = await client.query(
        `SELECT b17_catalog_child_count('item.answers', $1) AS answers,
                b17_catalog_child_count('item.evaluations', $1) AS evaluations,
                b17_catalog_child_count('item.assignments', $1) AS assignments,
                b17_catalog_child_count('item.actions', $1) AS actions`,
        [req.params.id]
      );
      const blockers = {
        answers: counts.rows[0]?.answers ?? 0,
        evaluations: counts.rows[0]?.evaluations ?? 0,
        assignments: counts.rows[0]?.assignments ?? 0,
      };
      const actions = counts.rows[0].actions;
      const otherCount = blockers.answers + blockers.evaluations + blockers.assignments;
      if (otherCount + actions > 0) {
        const refusal = actions > 0 ? (otherCount > 0
          ? itemDeleteRefusal(blockers).replace(' reference it.', `, ${actions} action(s) reference it.`)
          : `Cannot delete this item: ${actions} action(s) reference it. Remove the references first.`)
          : itemDeleteRefusal(blockers);
        throw Object.assign(new Error(refusal), { statusCode: 409 });
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
                o.hint AS other_hint,
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
          otherItem: {
            id: r.other_id,
            code: r.other_code,
            requirement: r.other_requirement,
            answerType: r.other_answer_type,
            priority: r.other_priority,
            weight: r.other_weight === null ? null : Number(r.other_weight),
            esgClass: r.other_esg_class,
            objective: r.other_objective,
            topic: r.other_topic,
            hint: r.other_hint,
            disclosureCode: r.disclosure_code,
            disclosureTitle: r.disclosure_title,
            standardCode: r.standard_code,
          },
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
