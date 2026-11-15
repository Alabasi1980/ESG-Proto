import type { Router, Response } from 'express';
import type pg from 'pg';
import { recordAuditLog } from '../../db/index.ts';
import { authMiddleware, type AuthenticatedRequest } from '../auth.ts';
import { requireDomainAccess } from '../access.ts';
import { resolveLinkedService, scopeId } from '../scope.ts';
import { REPORT_GATE_CODE, REPORT_GATE_REFUSAL, reportGateStatus, validateReportSettingsInput, isNotifiedState } from '../../lib/reports.ts';
import { requireFreshPassword, platformConfigContext, readContext } from './_shared.ts';
import { domainTransaction, configurationService, domainTenant, domainFailure, validateDomainIds } from './initiativeScope.ts';

export async function loadReportSettings(client: pg.PoolClient, tenant: string, service: string | null) {
  // NULL legacy rows NEVER authorize a report, even when no links remain.
  if (!service) return null;
  return (await client.query(`SELECT id,client_id,service_id,disclosure_level,report_level,
    statement_name,statement_period,notified,notified_date,notify_ref,notification_recorded,level,created_at,updated_at
    FROM report_settings WHERE client_id=$1 AND service_id=$2`, [tenant,service])).rows[0] ?? null;
}
/** pg DATE is midnight LOCAL, not UTC: preserve the stored calendar day. */
export function formatDateOnly(value: unknown): string | null {
  if (typeof value === 'string') return value.slice(0,10) || null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
  return null;
}
const publicSettings = (row: any) => row ? { ...row,notified_date:formatDateOnly(row.notified_date) } : null;

export function registerReportSettings(router: Router) {
  router.get('/report-settings', authMiddleware, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
    try {
      validateDomainIds(req);
      const data = await domainTransaction(req, async client => {
        validateDomainIds(req);
        const tenant = domainTenant(req, req.query.clientId);
        const service = req.access!.mode === 'platform'
          ? await configurationService(client, tenant, req.query.serviceId, false)
          : await resolveLinkedService(client, req.access!, req.query.serviceId);
        const settings = await loadReportSettings(client, tenant, service), gate = reportGateStatus(settings);
        return { clientId:tenant,serviceId:service,settings:publicSettings(settings),
          gate:gate.ok ? { ok:true } : { ok:false,code:REPORT_GATE_CODE,refusal:REPORT_GATE_REFUSAL } };
      }, live => live.access!.mode === 'platform'
        ? platformConfigContext(live, domainTenant(live, req.query.clientId)) : readContext(live));
      res.json(data);
    } catch (err) { domainFailure(res, err, 'Failed to fetch report settings'); }
  });

  router.put('/report-settings', authMiddleware, requireFreshPassword, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
    try {
      validateDomainIds(req);
      const service = scopeId(req.body?.serviceId, true)!, body = req.body ?? {};
      const validation = validateReportSettingsInput(body);
      if (!validation.ok) return res.status(409).json({ error:REPORT_GATE_REFUSAL,code:REPORT_GATE_CODE,detail:validation.error });
      const saved = await domainTransaction(req, async client => {
        validateDomainIds(req);
        const tenant = domainTenant(req, req.body?.clientId);
        await configurationService(client, tenant, service);
        // Serialize same-target settings creation without changing identities or
        // relying on a legacy NULL-service row / nullable unique constraint.
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1717004))', [`${tenant}:${service}`]);
        const existing = await loadReportSettings(client, tenant, service);
        const notified = isNotifiedState(body.notified) ? body.notified : null;
        const date = typeof body.notifiedDate === 'string' && body.notifiedDate.trim() ? body.notifiedDate.trim().slice(0,10) : null;
        const reference = typeof body.notifyRef === 'string' && body.notifyRef.trim() ? body.notifyRef.trim() : null;
        const values = [body.disclosureLevel,body.reportLevel,body.statementName.trim(),body.statementPeriod.trim(),notified,date,reference,
          notified === 'done',body.disclosureLevel === 'in-accordance' ? 'in_accordance' : 'with_reference'];
        const row = existing ? (await client.query(`UPDATE report_settings SET disclosure_level=$1,report_level=$2,
          statement_name=$3,statement_period=$4,notified=$5,notified_date=$6,notify_ref=$7,notification_recorded=$8,level=$9,updated_at=NOW()
          WHERE id=$10 AND client_id=$11 AND service_id=$12 RETURNING *`, [...values,existing.id,tenant,service])).rows[0]
          : (await client.query(`INSERT INTO report_settings(disclosure_level,report_level,statement_name,statement_period,notified,
            notified_date,notify_ref,notification_recorded,level,client_id,service_id)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [...values,tenant,service])).rows[0];
        await recordAuditLog(client, { clientId:tenant,userId:req.access!.actorId,action:'REPORT_SETTINGS_SAVED',entityType:'report_settings',
          entityId:row.id,payload:{ targetTenant:tenant,serviceId:service,disclosureLevel:body.disclosureLevel,reportLevel:body.reportLevel,notified } });
        return row;
      }, live => platformConfigContext(live, domainTenant(live, req.body?.clientId)));
      res.json({ settings:publicSettings(saved),gate:{ ok:true } });
    } catch (err) { domainFailure(res, err, 'Failed to save report settings'); }
  });
}
