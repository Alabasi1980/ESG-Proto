// TASK-PROTO-U4-1a (OD-11 §4) — W-only client-visibility writer.
//
// ONE declaration: PATCH /workspace/services/:serviceId/visibility.
// The consultant (W, bound to A) decides which ITEM columns the CLIENT sees for
// that client×service. The RLS substrate admits a W UPDATE of the caller's own
// client_services row (b17_consultant_service_visibility), and PostgreSQL RLS
// cannot column-scope — so THIS HANDLER is the column guard: the body must be
// exactly `{ clientFieldMask }` (unknown keys refused 400) and the single
// statement writes ONLY `client_field_mask`, never show_gap/show_corrective or
// any other column. P/C/E are refused by the §3 matrix before this file runs.

import express, { type Response } from 'express';
import { recordAuditLog } from '../../db/index.ts';
import { authMiddleware, type AuthenticatedRequest } from '../auth.ts';
import { requireDomainAccess } from '../access.ts';
import { readContext, requireFreshPassword, writeFailure } from './_shared.ts';
import { domainTransaction, deferredFailure } from './initiativeScope.ts';
import { resolveLinkedService, scopeError, scopeId } from '../scope.ts';
import { parseVisibilityBody } from '../../lib/clientFieldMask.ts';

const router = express.Router();

router.patch('/workspace/services/:serviceId/visibility', authMiddleware, requireFreshPassword, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Defence-in-depth beside the matrix: only a consultant tab may write.
    if (req.access!.mode !== 'consultant' || req.access!.role !== 'ge_admin')
      throw scopeError(403, 'workspace.mode_mismatch');
    const serviceId = scopeId(req.params.serviceId, true)!;
    const parsed = parseVisibilityBody(req.body);
    if (!parsed.ok) {
      res.status(400).json({
        error: 'clientFieldMask is required and only clientFieldMask may be updated.',
        code: 'service.mask_invalid',
      });
      return;
    }
    const result = await domainTransaction(req, async (client) => {
      const access = req.access!;
      // The service must be linked to A (throws 403 scope.service_unlinked).
      const service = await resolveLinkedService(client, access, serviceId);
      if (!service) throw scopeError(403, 'scope.service_unlinked');
      const upd = await client.query(
        `UPDATE client_services SET client_field_mask = $1::jsonb
         WHERE client_id = $2 AND service_id = $3
         RETURNING client_id, service_id, client_field_mask`,
        [JSON.stringify(parsed.mask), access.tenantId, service]
      );
      const row = upd.rows[0];
      if (!row) throw scopeError(403, 'scope.service_unlinked');
      await recordAuditLog(client, {
        clientId: access.tenantId,
        userId: access.actorId,
        action: 'CLIENT_SERVICE_VISIBILITY_UPDATED',
        entityType: 'client_services',
        payload: { clientId: access.tenantId, serviceId: service, clientFieldMask: parsed.mask },
      });
      return { clientId: row.client_id, serviceId: row.service_id,
        clientFieldMask: row.client_field_mask ?? null };
    }, readContext);
    res.json(result);
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    writeFailure(res, err, 'Failed to update client visibility');
  }
});

export default router;
