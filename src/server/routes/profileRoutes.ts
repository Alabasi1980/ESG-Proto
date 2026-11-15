import type { Router, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { recordAuditLog } from '../../db/index.ts';
import { authMiddleware, type AuthenticatedRequest } from '../auth.ts';
import { requireDomainAccess } from '../access.ts';
import { scopedProfile, scopeError, scopeId } from '../scope.ts';
import { calculateEsgProfileScore } from '../../lib/esgProfile.ts';
import { esgProfileTextToRating } from '../../lib/initiatives.ts';
import { requireFreshPassword, isFrozenScope, platformConfigContext } from './_shared.ts';
import { domainTransaction, configurationService, domainFailure, domainTenant, textFilter, validateDomainIds } from './initiativeScope.ts';

// Natural key stays client/pillar/department/topic/parameter, NOT service. An
// existing key belonging to another/unknown service must never be reassigned
// by runtime import: only the offline OD-10 metadata migration can do that.
function profileInput(row: any, index: number) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw scopeError(400, 'profile.row_invalid');
  const key = ['pillar','department','topic','parameter'].map(k => textFilter(row[k]));
  if (key.some(v => !v)) throw Object.assign(new Error(`Row ${index + 1}: pillar, department, topic, and parameter are all required.`), { statusCode:400 });
  const numeric = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null;
    if (!['string','number'].includes(typeof v) || !Number.isFinite(Number(v))) throw scopeError(400, 'profile.rating_invalid');
    return Number(v);
  };
  const profile = textFilter(row.profile);
  const profileRating = row.profileRating == null || row.profileRating === ''
    ? (profile ? esgProfileTextToRating(profile) : null) : numeric(row.profileRating);
  if (profileRating !== null && ![1,2,3].includes(profileRating)) throw scopeError(400, 'profile.rating_invalid');
  const sort = numeric(row.sortOrder);
  if (sort !== null && !Number.isInteger(sort)) throw scopeError(400, 'profile.sort_invalid');
  return { key, values:[...key,textFilter(row.observations) || null,textFilter(row.marketScenario) || null,
    profile || null,profileRating,textFilter(row.timeline) || null,textFilter(row.ecoImpact) || null,
    numeric(row.rating),numeric(row.maxRating),sort] };
}

export function registerProfileRoutes(router: Router) {
  router.post('/esg-profile/import', authMiddleware, requireFreshPassword, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
    try {
      validateDomainIds(req);
      const service = scopeId(req.body?.serviceId, true)!;
      if (!Array.isArray(req.body?.rows) || !req.body.rows.length) throw scopeError(400, 'profile.rows_required');
      const rows = req.body.rows.map(profileInput), importBatchId = `esg_${randomUUID()}`;
      const result = await domainTransaction(req, async client => {
        validateDomainIds(req);
        const tenant = domainTenant(req, req.body?.clientId);
        await configurationService(client, tenant, service);
        const frozen = await isFrozenScope(client, tenant);
        let inserted = 0, updated = 0, skipped = 0;
        const seen = new Set<string>();
        for (const row of rows) {
          if (frozen || seen.has(JSON.stringify(row.key))) { skipped++; continue; }
          seen.add(JSON.stringify(row.key));
          // No service_id assignment in DO UPDATE. Even a hidden conflicting
          // key cannot be moved to another entitlement by this runtime import.
          const upsert = await client.query(`INSERT INTO esg_profile(client_id,service_id,pillar,department,topic,parameter,
            observations,market_scenario,profile,profile_rating,timeline,eco_impact,rating,max_rating,sort_order,import_batch_id)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
            ON CONFLICT(client_id,pillar,department,topic,parameter) DO UPDATE SET
            observations=EXCLUDED.observations,market_scenario=EXCLUDED.market_scenario,profile=EXCLUDED.profile,
            profile_rating=EXCLUDED.profile_rating,timeline=EXCLUDED.timeline,eco_impact=EXCLUDED.eco_impact,
            rating=EXCLUDED.rating,max_rating=EXCLUDED.max_rating,sort_order=EXCLUDED.sort_order,
            import_batch_id=EXCLUDED.import_batch_id,updated_at=NOW()
            WHERE esg_profile.service_id=EXCLUDED.service_id RETURNING (xmax=0) AS was_inserted`,
          [tenant,service,...row.values,importBatchId]);
          if (!upsert.rowCount) throw scopeError(409, 'profile.service_conflict');
          if (upsert.rows[0].was_inserted) inserted++; else updated++;
        }
        const skippedFrozen = frozen ? rows.length : 0;
        const reason = frozen ? 'frozen-scope (GE final tenant snapshot): rows skipped, never touched' : null;
        await recordAuditLog(client, { clientId:tenant,userId:req.access!.actorId,action:'ESG_PROFILE_IMPORTED',entityType:'esg_profile',
          payload:{ actor:req.access!.actorId,actorRole:req.access!.role,targetTenant:tenant,explicitTenant:true,serviceId:service,
            inserted,updated,skipped,skippedFrozen,skippedFrozenReason:reason,importBatchId } });
        const all = await client.query('SELECT profile_rating FROM esg_profile WHERE client_id=$1 AND service_id=$2', [tenant,service]);
        return { inserted,updated,skipped,skippedFrozen,skippedFrozenReason:reason,count:inserted+updated,importBatchId,
          ...calculateEsgProfileScore(all.rows) };
      }, live => platformConfigContext(live, domainTenant(live, req.body?.clientId)));
      res.json({ success:true,...result });
    } catch (err: any) {
      domainFailure(res, ['42501','23505'].includes(err?.code) ? scopeError(409, 'profile.service_conflict') : err,
        'Failed to import ESG profile');
    }
  });

  router.get('/esg-profile', authMiddleware, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
    try {
      validateDomainIds(req);
      const data = await domainTransaction(req, async client => {
        validateDomainIds(req);
        domainTenant(req, req.query.clientId);
        const rows = (await scopedProfile(client, req.access!, req.query.serviceId)).map(row => ({
          id:row.id,pillar:row.pillar,department:row.department,topic:row.topic,parameter:row.parameter,
          observations:row.observations,market_scenario:row.market_scenario,profile:row.profile,profile_rating:row.profile_rating,
          timeline:row.timeline,eco_impact:row.eco_impact,rating:row.rating,max_rating:row.max_rating,
          sort_order:row.sort_order,updated_at:row.updated_at,
        })).sort((a,b) => (a.sort_order ?? Infinity) - (b.sort_order ?? Infinity)
          || [a.pillar,a.department,a.topic,a.parameter].join('\0').localeCompare([b.pillar,b.department,b.topic,b.parameter].join('\0')));
        return { rows,...calculateEsgProfileScore(rows) };
      });
      res.json(data);
    } catch (err) { domainFailure(res, err, 'Failed to fetch ESG profile'); }
  });
}
