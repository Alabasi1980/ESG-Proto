// B17 U2-F — §3.4 TARGETLESS platform rows: GET /ge/overview (row 8, platform
// summary totals) and POST /services/link-all (row 15, explicit bulk link).
// Split out of adminClients.ts so no touched file crosses ~500 lines (task
// §3(4)). Both run with NO target in the ONE targetless platform configuration
// context (purpose 'platform.config', NULL target): §5 enumerates the
// fixed-aggregate platform-progress read for the overview totals, and the
// bulk write is row 15's explicit operation. Handlers only; declarations +
// middleware stay in admin.ts.

import type { Response } from 'express';
import { withTenantContext, recordAuditLog } from '../../db/index.ts';
import type { AuthenticatedRequest } from '../auth.ts';
import { writeFailure } from './_shared.ts';
import { platformGlobalContext } from './adminCommon.ts';

/** §3.4 row 8 / §6 — operational totals ONLY. Client rows, review scores, gap
 * breakdowns, answers and per-collection payloads are deliberately absent: no
 * assessment aggregate of any kind rides this projection. */
export async function geOverview(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const data = await withTenantContext(platformGlobalContext(req), async (client) => {
      const clients = (await client.query(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE suspended IS NOT TRUE)::int AS active,
                count(*) FILTER (WHERE suspended IS TRUE)::int AS suspended
         FROM clients`)).rows[0];
      const services = (await client.query('SELECT count(*)::int AS n FROM services')).rows[0].n;
      const pendingStaffLists = (await client.query(
        `SELECT count(*)::int AS n FROM staff_lists WHERE status = 'submitted'`)).rows[0].n;
      return {
        totals: {
          clients: clients.total,
          active: clients.active,
          suspended: clients.suspended,
          services,
          pendingStaffLists,
        },
      };
    });
    res.json(data);
  } catch (err: any) {
    writeFailure(res, err, 'Failed to build GE overview');
  }
}

/** §3.4 row 15 — the EXPLICIT bulk-link operation only, with audit. Never
 * automatic/startup/backfill: there is no other caller, and the targetless
 * platform configuration context is server-selected here. */
export async function linkAllTenants(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const body = req.body ?? {};
    const serviceId = typeof body.serviceId === 'string' ? body.serviceId.trim() : '';
    if (!serviceId) { res.status(400).json({ error: 'serviceId is required.' }); return; }
    // Round-2 ruling 4 (§3.4 row 15 "explicit bulk + confirmation semantics"):
    // the bulk link only runs on an explicit confirm:true — never implicit,
    // never automatic/startup/backfill. Audit shape is unchanged (the confirmed
    // call still records LINK_SERVICE_ALL_TENANTS with the linked count).
    if (body.confirm !== true) {
      res.status(400).json({ error: 'Explicit confirmation is required: pass { confirm: true } to run the bulk link.' });
      return;
    }
    const result = await withTenantContext(platformGlobalContext(req), async (client) => {
      const sRes = await client.query('SELECT id, code FROM services WHERE id = $1', [serviceId]);
      if (!sRes.rows[0]) throw Object.assign(new Error('Service not found.'), { statusCode: 404 });
      // Idempotent by PRE-FILTER (NOT EXISTS under the NULL-target read row of
      // b17_admin_summary_read), not by ON CONFLICT: on PG18 under FORCE
      // RLS `INSERT ... SELECT ... ON CONFLICT DO NOTHING` trips
      // ExecWithCheckOptions for the identical rows that the same statement
      // without ON CONFLICT inserts cleanly (VALUES + ON CONFLICT is unaffected
      // — rows 12/17 use that shape). Same observable behaviour: already-linked
      // tenants are skipped and the affected-row count is the number newly
      // linked. No RETURNING either: a NULL-target configuration context
      // deliberately has no client_services read row for the new rows.
      const ins = await client.query(
        `INSERT INTO client_services (client_id, service_id, show_gap, show_corrective)
         SELECT c.id, $1, true, true FROM clients c
         WHERE NOT EXISTS (SELECT 1 FROM client_services cs
           WHERE cs.client_id = c.id AND cs.service_id = $1)`,
        [serviceId]
      );
      await recordAuditLog(client, {
        clientId: null,
        userId: req.access!.actorId,
        action: 'LINK_SERVICE_ALL_TENANTS',
        entityType: 'client_services',
        payload: { serviceId, linked: ins.rowCount ?? 0 },
      });
      return { linked: ins.rowCount ?? 0, serviceCode: sRes.rows[0].code };
    });
    res.json(result);
  } catch (err: any) {
    writeFailure(res, err, 'Failed to link service to all tenants');
  }
}
