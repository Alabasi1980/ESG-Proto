import express, { type Response } from 'express';
import { recordAuditLog } from '../../db/index.ts';
import { authMiddleware, type AuthenticatedRequest } from '../auth.ts';
import { requireDomainAccess } from '../access.ts';
import { resolveLinkedService, scopeId, scopeError } from '../scope.ts';
import { initiativeNaturalKey } from '../../lib/initiatives.ts';
import { requireFreshPassword, isFrozenScope } from './_shared.ts';
import { domainTransaction, domainFailure, domainTenant, textFilter, u41cProtectLock, validateDomainIds } from './initiativeScope.ts';
import { registerProfileRoutes } from './profileRoutes.ts';
import type pg from 'pg';

const router = express.Router();

/** Multi-ID serviceIds list for POST/PATCH /initiatives (the ONLY multi-ID
 * list helper in this unit). §5/QA-F1: exact AND case-variant UUID duplicates
 * are refused 400 scope.duplicate_id here, BEFORE any SQL — PG uuid parsing
 * canonicalises case, so [X, X.toUpperCase()] must not reach ANY() and surface
 * as a later 404 count mismatch. Unknown DISTINCT well-formed IDs keep their
 * 404 from replaceMappings. */
export function serviceMappings(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw scopeError(400, 'scope.id_invalid');
  const ids = value.map(id => scopeId(id, true)!);
  const seen = new Set<string>();
  for (const id of ids) {
    const key = id.toLowerCase();
    if (seen.has(key)) throw scopeError(400, 'scope.duplicate_id');
    seen.add(key);
  }
  return ids;
}
async function replaceMappings(client: pg.PoolClient, id: string, ids?: string[]) {
  if (!ids) return;
  // Validate the complete set BEFORE touching any mapping; all changes + audit
  // share the same transaction, including natural-key upsert retries.
  const found = await client.query('SELECT id FROM services WHERE id=ANY($1::uuid[])', [ids]);
  if (found.rows.length !== ids.length) throw scopeError(404, 'scope.not_found');
  await client.query('DELETE FROM service_initiatives WHERE initiative_id=$1 AND NOT(service_id=ANY($2::uuid[]))', [id, ids]);
  for (const service of ids) await client.query(`INSERT INTO service_initiatives(service_id,initiative_id)
    VALUES($1,$2) ON CONFLICT DO NOTHING`, [service, id]);
}
async function eligible(client: pg.PoolClient, tenant: string, id: string, service: string | null) {
  if (!(await client.query(`SELECT id FROM initiatives_library WHERE id=$2
    AND b17_content_fact('initiative',$1,id,$3)`, [tenant, id, service])).rowCount)
    throw scopeError(404, 'scope.not_found');
}
function assertCatalogTenant(req: AuthenticatedRequest) {
  if (req.query.clientId !== undefined || req.body?.clientId !== undefined)
    throw scopeError(403, 'scope.tenant_mismatch');
}

router.get('/initiatives', authMiddleware, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    validateDomainIds(req);
    const filters = ['sector','esg','department','search'].map(key => textFilter(req.query[key]));
    const service = scopeId(req.query.serviceId, req.query.serviceId !== undefined);
    const rows = await domainTransaction(req, async client => {
      validateDomainIds(req);
      const platform = req.access!.mode === 'platform';
      const view = textFilter(req.query.view, platform ? 'library' : 'selected');
      if ((platform && view !== 'library') || (!platform && !['selected','eligible'].includes(view))
        || (view === 'eligible' && req.access!.mode !== 'consultant')) throw scopeError(403, 'scope.initiatives_denied');
      if (platform) assertCatalogTenant(req);
      const tenant = platform ? null : domainTenant(req, req.query.clientId);
      if (!platform && service) await resolveLinkedService(client, req.access!, service);
      const result = await client.query(`SELECT l.id,l.title,l.sector,l.department,l.esg_class,
        l.standards_ref,l.notes,l.sort_order,
        EXISTS(SELECT 1 FROM client_initiatives ci WHERE ci.client_id=$1 AND ci.initiative_id=l.id AND ci.archived_at IS NULL) AS selected,
        EXISTS(SELECT 1 FROM client_initiatives ci WHERE ci.client_id=$1 AND ci.initiative_id=l.id AND ci.archived_at IS NOT NULL) AS archived,
        (SELECT ci.selected_at FROM client_initiatives ci WHERE ci.client_id=$1 AND ci.initiative_id=l.id) AS selected_at,
        ARRAY(SELECT m.service_id FROM service_initiatives m WHERE m.initiative_id=l.id ORDER BY m.service_id) AS service_ids
        FROM initiatives_library l WHERE
        ($3::boolean OR b17_content_fact('initiative',$1,l.id,$2))
        AND ($3::boolean OR $4::boolean OR EXISTS(SELECT 1 FROM client_initiatives ci WHERE ci.client_id=$1 AND ci.initiative_id=l.id))
        AND ($2::uuid IS NULL OR EXISTS(SELECT 1 FROM service_initiatives m WHERE m.initiative_id=l.id AND m.service_id=$2))
        AND ($5='' OR l.sector=$5) AND ($6='' OR l.esg_class=$6) AND ($7='' OR l.department=$7)
        AND ($8='' OR l.title ILIKE '%'||$8||'%') ORDER BY l.sort_order ASC NULLS LAST,l.title`,
      [tenant, service, platform, view === 'eligible', ...filters]);
      return result.rows;
    });
    res.json({ items: rows, count: rows.length });
  } catch (err) { domainFailure(res, err, 'Failed to fetch initiatives'); }
});

router.post('/initiatives', authMiddleware, requireFreshPassword, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    validateDomainIds(req); assertCatalogTenant(req);
    const body = req.body ?? {}, key = initiativeNaturalKey(body.title, body.sector);
    if (!key.title) throw Object.assign(new Error('title is required.'), { statusCode: 400 });
    const mappings = serviceMappings(body.serviceIds);
    const fields = ['department','esgClass','standardsRef','notes'].map(k => textFilter(body[k]));
    const sortOrder = body.sortOrder == null || body.sortOrder === '' ? null : Number(body.sortOrder);
    if (sortOrder !== null && !Number.isInteger(sortOrder)) throw scopeError(400, 'scope.sort_invalid');
    const result = await domainTransaction(req, async client => {
      validateDomainIds(req);
      const row = (await client.query(`INSERT INTO initiatives_library(title,sector,department,esg_class,standards_ref,notes,sort_order,import_batch_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(title,sector) DO UPDATE SET
        department=EXCLUDED.department,esg_class=EXCLUDED.esg_class,standards_ref=EXCLUDED.standards_ref,
        notes=EXCLUDED.notes,sort_order=EXCLUDED.sort_order,import_batch_id=EXCLUDED.import_batch_id,updated_at=NOW()
        RETURNING *, (xmax=0) AS was_inserted`, [key.title,key.sector,...fields,sortOrder,body.importBatchId === undefined ? null : textFilter(body.importBatchId)])).rows[0];
      await replaceMappings(client, row.id, mappings);
      await recordAuditLog(client, { userId: req.access!.actorId, action:'INITIATIVE_UPSERTED', entityType:'initiatives_library',
        entityId:row.id, payload:{ title:key.title,sector:key.sector,created:row.was_inserted,serviceIds:mappings } });
      return { initiative:row,created:row.was_inserted };
    });
    res.status(result.created ? 201 : 200).json(result);
  } catch (err) { domainFailure(res, err, 'Failed to save initiative'); }
});

router.patch('/initiatives/:id', authMiddleware, requireFreshPassword, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    validateDomainIds(req); assertCatalogTenant(req);
    const id = scopeId(req.params.id, true)!, body = req.body ?? {}, mappings = serviceMappings(body.serviceIds);
    const allowed = { title:'title',sector:'sector',department:'department',esgClass:'esg_class',standardsRef:'standards_ref',notes:'notes' };
    const values: unknown[] = [], sets = ['updated_at=NOW()'];
    for (const [key,column] of Object.entries(allowed)) if (body[key] !== undefined) {
      const value = textFilter(body[key]);
      if (key === 'title' && !value) throw scopeError(400, 'scope.title_required');
      values.push(value); sets.push(`${column}=$${values.length}`);
    }
    if (body.sortOrder !== undefined) {
      const value = body.sortOrder === null ? null : Number(body.sortOrder);
      if (value !== null && !Number.isInteger(value)) throw scopeError(400, 'scope.sort_invalid');
      values.push(value); sets.push(`sort_order=$${values.length}`);
    }
    if (sets.length === 1 && mappings === undefined) throw scopeError(400, 'scope.fields_required');
    const row = await domainTransaction(req, async client => {
      validateDomainIds(req);
      values.push(id);
      let updated;
      try { updated = (await client.query(`UPDATE initiatives_library SET ${sets.join(',')} WHERE id=$${values.length} RETURNING *`, values)).rows[0]; }
      catch (err: any) {
        if (err.code === '23505') throw Object.assign(new Error('Another initiative already uses this title and sector.'), { statusCode:409 });
        throw err;
      }
      if (!updated) throw scopeError(404, 'scope.not_found');
      await replaceMappings(client, id, mappings);
      await recordAuditLog(client, { userId:req.access!.actorId,action:'INITIATIVE_UPDATED',entityType:'initiatives_library',entityId:id,
        payload:{ title:updated.title,sector:updated.sector,serviceIds:mappings } });
      return updated;
    });
    res.json(row);
  } catch (err) { domainFailure(res, err, 'Failed to update initiative'); }
});

router.post('/initiatives/select', authMiddleware, requireFreshPassword, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    validateDomainIds(req);
    const id = scopeId(req.body?.initiativeId, true)!, service = scopeId(req.body?.serviceId);
    const result = await domainTransaction(req, async client => {
      validateDomainIds(req);
      const tenant = domainTenant(req, req.body?.clientId);
      if (service) await resolveLinkedService(client, req.access!, service);
      await eligible(client, tenant, id, service);
      if (await isFrozenScope(client, tenant)) throw scopeError(409, 'scope.frozen');
      // PROTECT round 3 (owner decision §20: archive-flag replaces deletion).
      // The same canonical (tenant, library initiative) lock used by unselect/
      // status/evidence, taken BEFORE the unique INSERT so two first-selects
      // serialize. Revalidate after waiting (serial order, authorization and
      // audit are preserved). An archived row is reactivated IN PLACE (same ID,
      // history reconnects, no duplicate); only a truly absent row is INSERTed.
      await u41cProtectLock(client, 'initiative', tenant, id);
      await eligible(client, tenant, id, service);
      if (await isFrozenScope(client, tenant)) throw scopeError(409, 'scope.frozen');
      const reactivated = (await client.query(`UPDATE client_initiatives SET archived_at=NULL
        WHERE client_id=$1 AND initiative_id=$2 AND archived_at IS NOT NULL RETURNING id`,
      [tenant, id])).rows[0];
      let alreadySelected = false;
      if (!reactivated) {
        const link = await client.query(`INSERT INTO client_initiatives(client_id,initiative_id,selected_by)
          VALUES($1,$2,$3) ON CONFLICT(client_id,initiative_id) DO NOTHING RETURNING id`, [tenant,id,req.access!.actorId]);
        alreadySelected = link.rowCount === 0;
      }
      await recordAuditLog(client, { clientId:tenant,userId:req.access!.actorId,action:'INITIATIVE_SELECTED',entityType:'client_initiatives',
        entityId:id,payload:{ initiativeId:id,targetTenant:tenant,alreadySelected,reactivated:!!reactivated } });
      return { selected:true,alreadySelected };
    });
    res.json(result);
  } catch (err) { domainFailure(res, err, 'Failed to select initiative'); }
});

router.delete('/initiatives/select/:id', authMiddleware, requireFreshPassword, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    validateDomainIds(req);
    const id = scopeId(req.params.id, true)!, service = scopeId(req.query.serviceId);
    await domainTransaction(req, async client => {
      validateDomainIds(req);
      const tenant = domainTenant(req, req.query.clientId);
      if (service) await resolveLinkedService(client, req.access!, service);
      await eligible(client, tenant, id, service);
      if (await isFrozenScope(client, tenant)) throw scopeError(409, 'scope.frozen');
      // PROTECT round 3 (owner decision §20): unselect ARCHIVES — it is always
      // permitted for authorized W and never deletes. The flag preserves every
      // status/evidence row linked to the SAME selection ID; the anchor (same
      // key as POST select) still serializes select/unselect races and the
      // reselect window; scope is revalidated after waiting. The RESTRICT FK
      // refuses hard row deletion only when linked records exist (proven at
      // SQL level in the scratch harness; the API never issues that DELETE).
      await u41cProtectLock(client, 'initiative', tenant, id);
      await eligible(client, tenant, id, service);
      if (await isFrozenScope(client, tenant)) throw scopeError(409, 'scope.frozen');
      const archived = (await client.query(`UPDATE client_initiatives SET archived_at=NOW()
        WHERE client_id=$1 AND initiative_id=$2 AND archived_at IS NULL RETURNING id`,
      [tenant, id])).rows[0];
      if (!archived) {
        const existing = (await client.query('SELECT id FROM client_initiatives WHERE client_id=$1 AND initiative_id=$2',
          [tenant, id])).rows[0];
        if (!existing) throw scopeError(404, 'scope.not_found');
        // WHY no audit here: already archived is an idempotent repeat — no
        // state changed, so there is nothing to record. The serial order
        // (never-selected 404 vs archived 200) is preserved.
        return;
      }
      await recordAuditLog(client, { clientId:tenant,userId:req.access!.actorId,action:'INITIATIVE_UNSELECTED',entityType:'client_initiatives',
        entityId:id,payload:{ initiativeId:id,targetTenant:tenant } });
    });
    res.json({ selected:false });
  } catch (err: any) {
    domainFailure(res, err, 'Failed to unselect initiative');
  }
});

registerProfileRoutes(router);
export default router;
