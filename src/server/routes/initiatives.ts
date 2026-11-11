// B12 (R-01) — initiatives sub-router: library browse/create/patch,
// per-tenant selection, and the ESG profile import/read.
// Mounted by src/server/routes.ts under the /api prefix. Moved verbatim;
// B12 wiring: requireFreshPassword on every mutating route (F-03).

import express, { type Response } from 'express';
import {
  withTenantContext,
  recordAuditLog,
} from '../../db/index.ts';
import {
  authMiddleware,
  type AuthenticatedRequest,
  type AuthUser,
} from '../auth.ts';
import { resolveImportTenant } from '../../lib/tenantAccess.ts';
import { calculateEsgProfileScore } from '../../lib/esgProfile.ts';
import { esgProfileTextToRating, initiativeNaturalKey } from '../../lib/initiatives.ts';
import {
  contextFromUser,
  requireFreshPassword,
  isFrozenScope,
  type DbClient,
} from './_shared.ts';

const router = express.Router();

// ----------------------------------------------------------------------
// 10. Initiatives library (FIX BATCH 8 / MP-41)
//
// initiatives_library is tenant-neutral GLOBAL (like standards): readable by
// every authenticated role. Selection links (client_initiatives) are
// per-tenant. Only admins select for a tenant; only ge_admin edits the
// library. Creates upsert on the natural key (title, sector) so re-imports
// add 0 duplicates.
// ----------------------------------------------------------------------

function initiativeSelectionScope(
  user: AuthUser,
  explicit: unknown
): { effectiveClientId: string | null } | { error: string; status: number } {
  const named = typeof explicit === 'string' && explicit.trim() ? explicit.trim() : null;
  if (user.role === 'ge_admin') {
    return { effectiveClientId: named ?? user.clientId ?? null };
  }
  if (named && named !== user.clientId) {
    return { error: 'Cross-tenant initiative selection is forbidden.', status: 403 };
  }
  return { effectiveClientId: user.clientId ?? null };
}

// B3. Browse the library with filters; `selected` reflects the effective tenant.
router.get('/initiatives', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const sector = typeof req.query.sector === 'string' ? req.query.sector.trim() : '';
    const esg = typeof req.query.esg === 'string' ? req.query.esg.trim() : '';
    const department = typeof req.query.department === 'string' ? req.query.department.trim() : '';
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    const scope = initiativeSelectionScope(user, req.query.clientId);
    if ('error' in scope) {
      return res.status(scope.status).json({ error: scope.error });
    }
    const tenantId = scope.effectiveClientId;

    const rows = await withTenantContext(contextFromUser(user), async (client) => {
      const params: any[] = [];
      let where = '';
      if (sector) {
        params.push(sector);
        where += ` AND lib.sector = $${params.length}`;
      }
      if (esg) {
        params.push(esg);
        where += ` AND lib.esg_class = $${params.length}`;
      }
      if (department) {
        params.push(department);
        where += ` AND lib.department = $${params.length}`;
      }
      if (search) {
        params.push(`%${search}%`);
        where += ` AND lib.title ILIKE $${params.length}`;
      }
      let selectExtra = 'FALSE AS selected, NULL::timestamptz AS selected_at';
      if (tenantId) {
        params.push(tenantId);
        selectExtra = `EXISTS (SELECT 1 FROM client_initiatives ci WHERE ci.initiative_id = lib.id AND ci.client_id = $${params.length}) AS selected,
          (SELECT ci2.selected_at FROM client_initiatives ci2 WHERE ci2.initiative_id = lib.id AND ci2.client_id = $${params.length}) AS selected_at`;
      }
      const result = await client.query(
        `SELECT lib.id, lib.title, lib.sector, lib.department, lib.esg_class,
                lib.standards_ref, lib.notes, lib.sort_order, ${selectExtra}
         FROM initiatives_library lib
         WHERE 1 = 1${where}
         ORDER BY lib.sort_order ASC NULLS LAST, lib.title ASC`,
        params
      );
      return result.rows;
    });

    res.json({ items: rows, count: rows.length });
  } catch (err: any) {
    console.error('Initiatives browse error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to fetch initiatives' });
  }
});

// B3. GE-only library create (upsert on natural key — the import path).
router.post('/initiatives', authMiddleware, requireFreshPassword, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.role !== 'ge_admin') {
      return res.status(403).json({ error: 'Only platform administrators may edit the initiatives library.' });
    }
    const body = req.body ?? {};
    const key = initiativeNaturalKey(body.title, body.sector);
    if (!key.title) {
      return res.status(400).json({ error: 'title is required.' });
    }
    const department = typeof body.department === 'string' ? body.department.trim() : '';
    const esgClass = typeof body.esgClass === 'string' ? body.esgClass.trim() : '';
    const standardsRef = typeof body.standardsRef === 'string' ? body.standardsRef.trim() : '';
    const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
    const sortOrder =
      body.sortOrder === null || body.sortOrder === undefined || body.sortOrder === ''
        ? null
        : Number(body.sortOrder);
    if (sortOrder !== null && !Number.isInteger(sortOrder)) {
      return res.status(400).json({ error: 'sortOrder must be an integer.' });
    }
    const importBatchId = typeof body.importBatchId === 'string' ? body.importBatchId : null;

    const result = await withTenantContext(contextFromUser(user), async (client) => {
      const upsertRes = await client.query(
        `INSERT INTO initiatives_library (title, sector, department, esg_class, standards_ref, notes, sort_order, import_batch_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (title, sector) DO UPDATE SET
           department = EXCLUDED.department,
           esg_class = EXCLUDED.esg_class,
           standards_ref = EXCLUDED.standards_ref,
           notes = EXCLUDED.notes,
           sort_order = EXCLUDED.sort_order,
           import_batch_id = EXCLUDED.import_batch_id,
           updated_at = NOW()
         RETURNING *, (xmax = 0) AS was_inserted`,
        [key.title, key.sector, department, esgClass, standardsRef, notes, sortOrder, importBatchId]
      );
      const row = upsertRes.rows[0];
      await recordAuditLog(client, {
        clientId: null,
        userId: user.id,
        action: 'INITIATIVE_UPSERTED',
        entityType: 'initiatives_library',
        entityId: row.id,
        payload: { title: key.title, sector: key.sector, created: row.was_inserted },
      });
      return { initiative: row, created: row.was_inserted };
    });

    res.status(result.created ? 201 : 200).json(result);
  } catch (err: any) {
    console.error('Initiative upsert error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to save initiative' });
  }
});

// B3. GE-only library patch.
router.patch('/initiatives/:id', authMiddleware, requireFreshPassword, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.role !== 'ge_admin') {
      return res.status(403).json({ error: 'Only platform administrators may edit the initiatives library.' });
    }
    const body = req.body ?? {};
    const allowed: Record<string, string> = {
      title: 'title',
      sector: 'sector',
      department: 'department',
      esgClass: 'esg_class',
      standardsRef: 'standards_ref',
      notes: 'notes',
    };
    const sets: string[] = ['updated_at = NOW()'];
    const params: any[] = [];
    for (const [bodyKey, column] of Object.entries(allowed)) {
      if (body[bodyKey] !== undefined) {
        if (typeof body[bodyKey] !== 'string') {
          return res.status(400).json({ error: `${bodyKey} must be a string.` });
        }
        params.push(body[bodyKey].trim());
        sets.push(`${column} = $${params.length}`);
      }
    }
    if (body.sortOrder !== undefined) {
      if (body.sortOrder !== null && !Number.isInteger(Number(body.sortOrder))) {
        return res.status(400).json({ error: 'sortOrder must be an integer.' });
      }
      params.push(body.sortOrder === null ? null : Number(body.sortOrder));
      sets.push(`sort_order = $${params.length}`);
    }
    if (sets.length === 1) {
      return res.status(400).json({ error: 'No editable field provided.' });
    }
    if (params.length === 0) {
      return res.status(400).json({ error: 'No editable field provided.' });
    }

    const updated = await withTenantContext(contextFromUser(user), async (client) => {
      params.push(req.params.id);
      let row;
      try {
        const updRes = await client.query(
          `UPDATE initiatives_library SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
          params
        );
        row = updRes.rows[0];
      } catch (dbErr: any) {
        if (dbErr?.code === '23505') {
          throw Object.assign(new Error('Another initiative already uses this title and sector.'), { statusCode: 409 });
        }
        throw dbErr;
      }
      if (!row) {
        throw Object.assign(new Error('Initiative not found.'), { statusCode: 404 });
      }
      await recordAuditLog(client, {
        clientId: null,
        userId: user.id,
        action: 'INITIATIVE_UPDATED',
        entityType: 'initiatives_library',
        entityId: row.id,
        payload: { title: row.title, sector: row.sector },
      });
      return row;
    });

    res.json(updated);
  } catch (err: any) {
    console.error('Initiative patch error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to update initiative' });
  }
});

// B3. Select a library initiative for a tenant (admins only).
router.post('/initiatives/select', authMiddleware, requireFreshPassword, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.role !== 'ge_admin' && user.role !== 'client_admin') {
      return res.status(403).json({ error: 'Only administrators may select initiatives for a tenant.' });
    }
    const body = req.body ?? {};
    const initiativeId = typeof body.initiativeId === 'string' ? body.initiativeId.trim() : '';
    if (!initiativeId) {
      return res.status(400).json({ error: 'initiativeId is required.' });
    }
    const scope = initiativeSelectionScope(user, body.clientId);
    if ('error' in scope) {
      return res.status(scope.status).json({ error: scope.error });
    }
    if (!scope.effectiveClientId) {
      return res.status(400).json({ error: 'No tenant selected. As a platform admin, choose a tenant (clientId) to select for.' });
    }
    const effectiveClientId = scope.effectiveClientId;

    const result = await withTenantContext(contextFromUser(user), async (client) => {
      const libRes = await client.query('SELECT id FROM initiatives_library WHERE id = $1', [initiativeId]);
      if (!libRes.rows[0]) {
        throw Object.assign(new Error('Initiative not found in the library.'), { statusCode: 404 });
      }
      const tenantRes = await client.query('SELECT id FROM clients WHERE id = $1', [effectiveClientId]);
      if (!tenantRes.rows[0]) {
        throw Object.assign(new Error('Target tenant not found for the given clientId.'), { statusCode: 404 });
      }
      // B9-B3: frozen tenants keep their selection links untouched.
      if (await isFrozenScope(client, effectiveClientId, null)) {
        throw Object.assign(
          new Error('This tenant is frozen by GE final approval. Initiative selection is disabled; only append-only snapshot notes are allowed.'),
          { statusCode: 409 }
        );
      }
      const linkRes = await client.query(
        `INSERT INTO client_initiatives (client_id, initiative_id, selected_by)
          VALUES ($1, $2, $3)
          ON CONFLICT (client_id, initiative_id) DO NOTHING
          RETURNING *`,
        [effectiveClientId, initiativeId, user.id]
      );
      const alreadySelected = (linkRes.rowCount ?? 0) === 0;
      await recordAuditLog(client, {
        clientId: effectiveClientId,
        userId: user.id,
        action: 'INITIATIVE_SELECTED',
        entityType: 'client_initiatives',
        entityId: initiativeId,
        payload: { initiativeId, targetTenant: effectiveClientId, alreadySelected },
      });
      return { selected: true, alreadySelected };
    });

    res.json(result);
  } catch (err: any) {
    console.error('Initiative select error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to select initiative' });
  }
});

// B3. Unselect a library initiative for a tenant (admins only).
router.delete('/initiatives/select/:id', authMiddleware, requireFreshPassword, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.role !== 'ge_admin' && user.role !== 'client_admin') {
      return res.status(403).json({ error: 'Only administrators may unselect initiatives for a tenant.' });
    }
    const initiativeId = req.params.id;
    const scope = initiativeSelectionScope(user, req.query.clientId);
    if ('error' in scope) {
      return res.status(scope.status).json({ error: scope.error });
    }
    if (!scope.effectiveClientId) {
      return res.status(400).json({ error: 'No tenant selected. As a platform admin, choose a tenant (clientId) to unselect for.' });
    }
    const effectiveClientId = scope.effectiveClientId;

    await withTenantContext(contextFromUser(user), async (client) => {
      // B9-B3: frozen tenants keep their selection links untouched.
      if (await isFrozenScope(client, effectiveClientId, null)) {
        throw Object.assign(
          new Error('This tenant is frozen by GE final approval. Initiative selection is disabled; only append-only snapshot notes are allowed.'),
          { statusCode: 409 }
        );
      }
      const delRes = await client.query(
        'DELETE FROM client_initiatives WHERE client_id = $1 AND initiative_id = $2',
        [effectiveClientId, initiativeId]
      );
      if ((delRes.rowCount ?? 0) === 0) {
        throw Object.assign(new Error('This initiative is not selected for the tenant.'), { statusCode: 404 });
      }
      await recordAuditLog(client, {
        clientId: effectiveClientId,
        userId: user.id,
        action: 'INITIATIVE_UNSELECTED',
        entityType: 'client_initiatives',
        entityId: initiativeId,
        payload: { initiativeId, targetTenant: effectiveClientId },
      });
    });

    res.json({ selected: false });
  } catch (err: any) {
    console.error('Initiative unselect error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to unselect initiative' });
  }
});

// ----------------------------------------------------------------------
// 11. ESG Profile (FIX BATCH 8 / MP-42)
//
// Per-tenant rows keyed by (pillar, department, topic, parameter); import
// upserts idempotently. GET returns rows + the sheet's own DD-02 aggregate
// (score + coverage). GE sees every tenant explicitly; client_admin sees
// their own tenant; employees read their own tenant.
// ----------------------------------------------------------------------

/** Tenant scope for profile reads/writes. ge_admin may name a client explicitly. */
function evalClientScope(user: AuthUser, explicit?: unknown): string | null {
  if (typeof explicit === 'string' && explicit.trim()) {
    if (user.role !== 'ge_admin' && explicit.trim() !== user.clientId) {
      return null; // cross-tenant access — caller rejects with 403
    }
    return explicit.trim();
  }
  return user.clientId ?? null;
}

// C3. Import rows (ge_admin: explicit clientId; client_admin: own tenant).
router.post('/esg-profile/import', authMiddleware, requireFreshPassword, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.role !== 'ge_admin' && user.role !== 'client_admin') {
      return res.status(403).json({ error: 'Only administrators may import the ESG profile.' });
    }
    const body = req.body ?? {};
    const rows = Array.isArray(body.rows) ? body.rows : null;
    if (!rows || rows.length === 0) {
      return res.status(400).json({ error: 'rows (non-empty array) is required.' });
    }

    const tenantResolution = resolveImportTenant(
      { id: user.id, role: user.role, clientId: user.clientId ?? null },
      body.clientId
    );
    if (!tenantResolution.ok) {
      return res.status(tenantResolution.status).json({ error: tenantResolution.error });
    }
    const effectiveClientId = tenantResolution.effectiveClientId;
    const importBatchId = `esg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

    const result = await withTenantContext(contextFromUser(user), async (client) => {
      const tenantRes = await client.query('SELECT id FROM clients WHERE id = $1', [effectiveClientId]);
      if (!tenantRes.rows[0]) {
        throw Object.assign(new Error('Target tenant not found for the given clientId.'), { statusCode: 404 });
      }

      let inserted = 0;
      let updated = 0;
      let skipped = 0;
      // B9-B3 (WF-05): a tenant-frozen scope skips profile rows with reason.
      let skippedFrozen = 0;
      const tenantFrozen = await isFrozenScope(client, effectiveClientId, null);
      if (tenantFrozen) {
        skippedFrozen = rows.length;
        skipped = rows.length;
      }
      const seen = new Set<string>();
      for (const [index, row] of rows.entries()) {
        if (tenantFrozen) continue;
        const pillar = typeof row.pillar === 'string' ? row.pillar.trim() : '';
        const department = typeof row.department === 'string' ? row.department.trim() : '';
        const topic = typeof row.topic === 'string' ? row.topic.trim() : '';
        const parameter = typeof row.parameter === 'string' ? row.parameter.trim() : '';
        if (!pillar || !department || !topic || !parameter) {
          throw Object.assign(
            new Error(`Row ${index + 1}: pillar, department, topic, and parameter are all required.`),
            { statusCode: 400 }
          );
        }
        const dedupeKey = [pillar, department, topic, parameter].join('::');
        if (seen.has(dedupeKey)) {
          skipped++;
          continue;
        }
        seen.add(dedupeKey);

        // profile_rating 1..3; when only PROFILE text is given, map it.
        let profileRating: number | null = null;
        if (row.profileRating !== undefined && row.profileRating !== null && row.profileRating !== '') {
          profileRating = Number(row.profileRating);
        } else if (typeof row.profile === 'string' && row.profile.trim()) {
          profileRating = esgProfileTextToRating(row.profile);
        }
        if (profileRating !== null && ![1, 2, 3].includes(profileRating)) {
          throw Object.assign(
            new Error(`Row ${index + 1}: profileRating must be one of 1, 2, 3.`),
            { statusCode: 400 }
          );
        }
        const rating =
          row.rating === null || row.rating === undefined || row.rating === '' ? null : Number(row.rating);
        const maxRating =
          row.maxRating === null || row.maxRating === undefined || row.maxRating === '' ? null : Number(row.maxRating);
        if (rating !== null && !Number.isFinite(rating)) {
          throw Object.assign(new Error(`Row ${index + 1}: rating must be numeric.`), { statusCode: 400 });
        }
        if (maxRating !== null && !Number.isFinite(maxRating)) {
          throw Object.assign(new Error(`Row ${index + 1}: maxRating must be numeric.`), { statusCode: 400 });
        }
        const sortOrder =
          row.sortOrder === null || row.sortOrder === undefined || row.sortOrder === ''
            ? null
            : Number(row.sortOrder);

        const upsertRes = await client.query(
          `INSERT INTO esg_profile (client_id, pillar, department, topic, parameter,
                                    observations, market_scenario, profile, profile_rating,
                                    timeline, eco_impact, rating, max_rating, sort_order, import_batch_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           ON CONFLICT (client_id, pillar, department, topic, parameter) DO UPDATE SET
             observations = EXCLUDED.observations,
             market_scenario = EXCLUDED.market_scenario,
             profile = EXCLUDED.profile,
             profile_rating = EXCLUDED.profile_rating,
             timeline = EXCLUDED.timeline,
             eco_impact = EXCLUDED.eco_impact,
             rating = EXCLUDED.rating,
             max_rating = EXCLUDED.max_rating,
             sort_order = EXCLUDED.sort_order,
             import_batch_id = EXCLUDED.import_batch_id,
             updated_at = NOW()
           RETURNING (xmax = 0) AS was_inserted`,
          [
            effectiveClientId, pillar, department, topic, parameter,
            typeof row.observations === 'string' ? row.observations.trim() || null : null,
            typeof row.marketScenario === 'string' ? row.marketScenario.trim() || null : null,
            typeof row.profile === 'string' ? row.profile.trim() || null : null,
            profileRating,
            typeof row.timeline === 'string' ? row.timeline.trim() || null : null,
            typeof row.ecoImpact === 'string' ? row.ecoImpact.trim() || null : null,
            rating, maxRating, sortOrder, importBatchId,
          ]
        );
        if (upsertRes.rows[0].was_inserted) inserted++;
        else updated++;
      }

      await recordAuditLog(client, {
        clientId: effectiveClientId,
        userId: user.id,
        action: 'ESG_PROFILE_IMPORTED',
        entityType: 'esg_profile',
        payload: {
          actor: user.id,
          actorRole: user.role,
          targetTenant: effectiveClientId,
          explicitTenant: tenantResolution.explicit,
          inserted,
          updated,
          skipped,
          skippedFrozen,
          skippedFrozenReason: skippedFrozen > 0 ? 'frozen-scope (GE final tenant snapshot): rows skipped, never touched' : null,
          importBatchId,
        },
      });

      const allRes = await client.query(
        'SELECT profile_rating FROM esg_profile WHERE client_id = $1',
        [effectiveClientId]
      );
      const score = calculateEsgProfileScore(allRes.rows);

      return {
        inserted,
        updated,
        skipped,
        skippedFrozen,
        skippedFrozenReason: skippedFrozen > 0 ? 'frozen-scope (GE final tenant snapshot): rows skipped, never touched' : null,
        count: inserted + updated,
        importBatchId,
        ...score,
      };
    });

    res.json({ success: true, ...result });
  } catch (err: any) {
    console.error('ESG profile import error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to import ESG profile' });
  }
});

// C3. Read the tenant profile: rows + DD-02 score + coverage.
router.get('/esg-profile', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const clientId = evalClientScope(user, req.query.clientId);
    if (!clientId) {
      if (user.role === 'ge_admin') {
        return res.status(400).json({ error: 'No tenant selected. As a platform admin, choose a tenant (clientId).' });
      }
      return res.status(403).json({ error: 'Cross-tenant ESG profile access is forbidden.' });
    }

    const data = await withTenantContext(contextFromUser(user), async (client) => {
      const rowsRes = await client.query(
        `SELECT id, pillar, department, topic, parameter, observations, market_scenario,
                profile, profile_rating, timeline, eco_impact, rating, max_rating,
                sort_order, updated_at
         FROM esg_profile
         WHERE client_id = $1
         ORDER BY sort_order ASC NULLS LAST, pillar ASC, department ASC, topic ASC, parameter ASC`,
        [clientId]
      );
      const score = calculateEsgProfileScore(rowsRes.rows);
      return { rows: rowsRes.rows, ...score };
    });

    res.json(data);
  } catch (err: any) {
    console.error('ESG profile fetch error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to fetch ESG profile' });
  }
});

export default router;
