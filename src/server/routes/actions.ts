// B12 (R-01) — actions sub-router: corrective-action lifecycle (WF-04),
// retrofitted for B17 U2-B round 3.
// Mounted by src/server/routes.ts under the /api prefix. B12 wiring:
// requireFreshPassword + requireDomainAccess on POST/PATCH (F-03 + §3 matrix);
// S-23 fan-out on verified/closed/reopened transitions (→ owner dept users +
// client_admins) now commits through the server-side notify context.
//
// §3.5: GET = W/C linked + owned (C covers ALL own-company departments);
// POST = W only (owner dept in A + linked item or explicit linked service);
// PATCH = W keeps the existing GE transition set, C is owned start-work +
// evidence ONLY, E/P denied. WF-04 transition legality and the required-reason
// rule stay in src/lib/actions.ts; the policy layer encodes neither.

import express, { type Response } from 'express';
import {
  recordAuditLog,
} from '../../db/index.ts';
import {
  authMiddleware,
  type AuthenticatedRequest,
} from '../auth.ts';
import { requireDomainAccess } from '../access.ts';
import { domainTransaction, deferredFailure, DeferredRefusal } from './initiativeScope.ts';
import { assertActionBinding, scopeId, scopeError } from '../scope.ts';
import {
  ACTION_STATUSES,
  actionTransitionRequiresReason,
  canTransitionAction,
  isActionStatus,
  type ActionStatus,
} from '../../lib/actions.ts';
import {
  readContext,
  requireFreshPassword,
  notifyUsers,
  activeDepartmentUserIds,
  activeClientAdminIds,
  B16_ACTION_OPEN_REFUSAL,
  B16_ACTION_CLOSE_REFUSAL,
} from './_shared.ts';

const router = express.Router();

// ----------------------------------------------------------------------
// 9. Actions — Corrective Action lifecycle (FIX BATCH 8 / MP-40, WF-04)
//
// open → in_progress → awaiting_verification → closed
// awaiting_verification → closed | reopened (reason required)
// closed → reopened (reason required); reopened → in_progress
// Anything else is refused (409). B16-B2: opening actions and
// verify/close/reopen are GE-only; departments start work (in_progress)
// and save evidence notes on their own actions.
// Evidence is a TEXT reference (DV-01: no binary upload). Closing an action
// only UPDATEs actions — evaluations are never touched.
// ----------------------------------------------------------------------

// B1. List actions in scope, optional status/department filters.
router.get('/actions', authMiddleware, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const namedStatus = typeof req.query.status === 'string' && req.query.status.trim()
      ? req.query.status.trim()
      : null;
    const namedDept = typeof req.query.departmentId === 'string' && req.query.departmentId.trim()
      ? req.query.departmentId.trim()
      : null;
    const namedClient = typeof req.query.clientId === 'string' && req.query.clientId.trim()
      ? req.query.clientId.trim()
      : null;

    if (namedStatus && !isActionStatus(namedStatus)) {
      return res.status(400).json({ error: 'Unknown action status filter.' });
    }
    // Supplied ids are comparisons/filters only, never the scope source:
    // a foreign clientId or a department outside own company is a 403.
    if (namedClient) {
      scopeId(namedClient, true);
    }
    if (namedDept) scopeId(namedDept, true);

    const rows = await domainTransaction(req, async (client) => {
      const access = req.access!;
      if (namedClient && namedClient !== access.tenantId)
        throw new DeferredRefusal(403, { error: 'Cross-tenant action access is forbidden.' });
      if (namedDept && !(await client.query('SELECT 1 FROM departments WHERE id = $1', [namedDept])).rowCount) {
        throw scopeError(403, 'scope.department_mismatch');
      }
      const params: any[] = [access.tenantId];
      let where = ' AND a.client_id = $1';
      if (namedStatus) {
        params.push(namedStatus);
        where += ` AND a.status = $${params.length}`;
      }
      if (namedDept) {
        params.push(namedDept);
        where += ` AND a.owner_department_id = $${params.length}`;
      }
      const result = await client.query(
        `SELECT a.id, a.client_id, a.item_id, a.owner_department_id,
                d.code AS department_code, d.name AS department_name,
                i.code AS item_code,
                a.title, a.description, a.due_date, a.status, a.evidence_note,
                a.created_at, a.updated_at
         FROM actions a
         JOIN departments d ON d.id = a.owner_department_id
         LEFT JOIN items i ON i.id = a.item_id
         WHERE 1 = 1${where}
         ORDER BY a.created_at DESC`,
        params
      );
      return result.rows;
    }, readContext);

    res.json({ items: rows, count: rows.length });
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    console.error('Actions list error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to fetch actions' });
  }
});

// B1. Create an action (status starts at open). §3.5: W only — the owner
// department must belong to A, with a linked item or an explicit linked
// service for a standalone action (assertActionBinding in scope.ts).
router.post('/actions', authMiddleware, requireFreshPassword, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = req.body ?? {};
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    const departmentId = typeof body.departmentId === 'string' ? body.departmentId.trim() : '';
    const itemId = typeof body.itemId === 'string' && body.itemId.trim() ? body.itemId.trim() : null;
    const serviceId = typeof body.serviceId === 'string' && body.serviceId.trim() ? body.serviceId.trim() : null;
    const dueDate = typeof body.dueDate === 'string' && body.dueDate.trim() ? body.dueDate.trim() : null;

    if (!title) {
      return res.status(400).json({ error: 'title is required.' });
    }
    if (!departmentId) {
      return res.status(400).json({ error: 'departmentId is required.' });
    }
    if (dueDate && Number.isNaN(Date.parse(dueDate))) {
      return res.status(400).json({ error: 'dueDate must be a valid date.' });
    }
    // Effective tenant is the server-derived A; a supplied clientId may only
    // agree with it (explicit mismatch -> 403), never widen the scope.
    const created = await domainTransaction(req, async (client) => {
      const access = req.access!;
      if (access.mode !== 'consultant') throw new DeferredRefusal(403, { error: B16_ACTION_OPEN_REFUSAL });
      if (body.clientId !== undefined && body.clientId !== null && body.clientId !== '' && body.clientId !== access.tenantId)
        throw new DeferredRefusal(403, { error: 'Cross-tenant action access is forbidden.' });
      await assertActionBinding(client, access, { itemId, serviceId, departmentId });
      const insRes = await client.query(
        `INSERT INTO actions (client_id, item_id, service_id, owner_department_id, title, description, due_date, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'open')
         RETURNING *`,
        [access.tenantId, itemId, serviceId, departmentId, title, description || null, dueDate]
      );

      await recordAuditLog(client, {
        clientId: access.tenantId,
        userId: access.actorId,
        action: 'ACTION_CREATED',
        entityType: 'actions',
        entityId: insRes.rows[0].id,
        payload: { itemId, serviceId, departmentId, title },
      });

      return insRes.rows[0];
    }, readContext);

    res.status(201).json(created);
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    console.error('Action create error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to create action' });
  }
});

// B1. Patch an action: WF-04 transition and/or evidence note.
// Closing NEVER touches evaluations — this handler UPDATEs actions only.
// §19(4)/QA-R2: COLUMN SCOPE is handler-enforced — this handler writes ONLY
// status, evidence_note and updated_at, whatever else the body carries; and
// MODE SCOPE: W keeps the full existing GE transition set, C is start-work
// (→ in_progress) + evidence only. E/P never reach here (matrix + mode check).
router.patch('/actions/:id', authMiddleware, requireFreshPassword, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const actionId = req.params.id;
    const body = req.body ?? {};
    const hasStatus = body.status !== undefined && body.status !== null;
    const hasEvidence = typeof body.evidenceNote === 'string';
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

    if (!hasStatus && !hasEvidence) {
      return res.status(400).json({ error: 'Provide status and/or evidenceNote.' });
    }
    let nextStatus: ActionStatus | null = null;
    if (hasStatus) {
      if (!isActionStatus(body.status)) {
        return res.status(400).json({
          error: `Unknown status. Allowed: ${ACTION_STATUSES.join(', ')}.`,
        });
      }
      nextStatus = body.status;
    }

    const updated = await domainTransaction(req, async (client) => {
      const access = req.access!;
      if (access.mode !== 'consultant' && access.mode !== 'client')
        throw new DeferredRefusal(403, { error: B16_ACTION_CLOSE_REFUSAL });
      const found = await client.query('SELECT * FROM actions WHERE id = $1', [actionId]);
      const action = found.rows[0];
      // Outside the caller's RLS scope the row is simply not visible.
      if (!action) {
        throw Object.assign(new Error('Action not found.'), { statusCode: 404 });
      }

      if (nextStatus) {
        if (!canTransitionAction(action.status as ActionStatus, nextStatus)) {
          throw Object.assign(
            new Error(`Illegal transition ${action.status} → ${nextStatus} (WF-04).`),
            { statusCode: 409 }
          );
        }
        if (actionTransitionRequiresReason(nextStatus) && !reason) {
          throw Object.assign(new Error('A reason is required to reopen an action.'), { statusCode: 400 });
        }
        // C capability gate (§3.5): client_admin gets start-work only — the
        // legal GE transitions into awaiting_verification/closed/reopened are
        // refused with the existing B16 path-pointing message.
        if (access.mode === 'client' && nextStatus !== 'in_progress') {
          throw Object.assign(new Error(B16_ACTION_CLOSE_REFUSAL), { statusCode: 403 });
        }
      }

      // Column scope: ONLY these columns are ever written (QA-R2 / §19(4)).
      const sets: string[] = ['updated_at = NOW()'];
      const params: any[] = [];
      if (nextStatus) {
        params.push(nextStatus);
        sets.push(`status = $${params.length}`);
      }
      if (hasEvidence) {
        params.push(body.evidenceNote);
        sets.push(`evidence_note = $${params.length}`);
      }
      params.push(actionId);
      const updRes = await client.query(
        `UPDATE actions SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params
      );

      if (nextStatus) {
        await recordAuditLog(client, {
          clientId: action.client_id,
          userId: access.actorId,
          action: 'ACTION_STATUS_CHANGED',
          entityType: 'actions',
          entityId: action.id,
          payload: { from: action.status, to: nextStatus, reason: reason || null },
        });

        // B12 (S-23): verified/closed/reopened → owner dept users + client_admin(s).
        if (nextStatus === 'awaiting_verification' || nextStatus === 'closed' || nextStatus === 'reopened') {
          const deptUsers = await activeDepartmentUserIds(client, action.client_id, action.owner_department_id);
          const admins = await activeClientAdminIds(client, action.client_id);
          const statusAr = nextStatus === 'closed' ? 'مغلق' : nextStatus === 'reopened' ? 'معاد فتحه' : 'بانتظار التحقق';
          await notifyUsers(client, {
            userIds: [...deptUsers, ...admins],
            clientId: action.client_id,
            type: 'action.status',
            title: `Action ${nextStatus}: ${action.title}`,
            titleAr: `الإجراء ${statusAr}: ${action.title}`,
            body: reason ? `Reason: ${reason}` : `Action moved to ${nextStatus}.`,
            bodyAr: reason ? `السبب: ${reason}` : `انتقل الإجراء إلى الحالة ${statusAr}.`,
            entityType: 'actions',
            entityId: action.id,
          });
        }
      }
      if (hasEvidence) {
        await recordAuditLog(client, {
          clientId: action.client_id,
          userId: access.actorId,
          action: 'ACTION_EVIDENCE_UPDATED',
          entityType: 'actions',
          entityId: action.id,
          payload: { hasEvidence: body.evidenceNote.length > 0 },
        });
      }

      return updRes.rows[0];
    }, readContext);

    res.json(updated);
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    console.error('Action patch error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to update action' });
  }
});

export default router;
