// B12 (R-01) — actions sub-router: corrective-action lifecycle (WF-04).
// Mounted by src/server/routes.ts under the /api prefix. Moved verbatim;
// B12 wiring: requireFreshPassword on POST + PATCH (F-03); S-23 fan-out on
// verified/closed/reopened transitions (→ owner dept users + client_admins).

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
import {
  ACTION_STATUSES,
  actionTransitionRequiresReason,
  canTransitionAction,
  isActionStatus,
  type ActionStatus,
} from '../../lib/actions.ts';
import {
  contextFromUser,
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
// and save evidence notes on their own actions. Employees of other
// departments stay refused.
// Evidence is a TEXT reference (DV-01: no binary upload). Closing an action
// only UPDATEs actions — evaluations are never touched.
// ----------------------------------------------------------------------

// B1. List actions in scope, optional status/department filters.
router.get('/actions', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
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
    if (user.role === 'employee') {
      if (!user.departmentId) {
        return res.status(400).json({ error: 'Your user account has no department assignment.' });
      }
      if (namedDept && namedDept !== user.departmentId) {
        return res.status(403).json({ error: 'Employees may only access actions assigned to their own department.' });
      }
    }
    if ((user.role === 'client_admin' || user.role === 'employee') && namedClient && namedClient !== user.clientId) {
      return res.status(403).json({ error: 'Cross-tenant action access is forbidden.' });
    }
    const deptFilter = user.role === 'employee' ? user.departmentId! : namedDept;
    const clientFilter = user.role === 'ge_admin' ? namedClient : null;

    const rows = await withTenantContext(contextFromUser(user), async (client) => {
      const params: any[] = [];
      let where = '';
      if (namedStatus) {
        params.push(namedStatus);
        where += ` AND a.status = $${params.length}`;
      }
      if (deptFilter) {
        params.push(deptFilter);
        where += ` AND a.owner_department_id = $${params.length}`;
      }
      if (clientFilter) {
        params.push(clientFilter);
        where += ` AND a.client_id = $${params.length}`;
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
    });

    res.json({ items: rows, count: rows.length });
  } catch (err: any) {
    console.error('Actions list error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to fetch actions' });
  }
});

// B1. Create an action (status starts at open). B16-B2: GE-only —
// departments progress their assigned actions (start work, evidence).
router.post('/actions', authMiddleware, requireFreshPassword, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.role !== 'ge_admin') {
      return res.status(403).json({ error: B16_ACTION_OPEN_REFUSAL });
    }
    const body = req.body ?? {};
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    const departmentId = typeof body.departmentId === 'string' ? body.departmentId.trim() : '';
    const itemId = typeof body.itemId === 'string' && body.itemId.trim() ? body.itemId.trim() : null;
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

    // Effective tenant: same explicit-tenant pattern as /gri/commit.
    const tenantResolution = resolveImportTenant(
      { id: user.id, role: user.role, clientId: user.clientId ?? null },
      body.clientId
    );
    if (!tenantResolution.ok) {
      return res.status(tenantResolution.status).json({ error: tenantResolution.error });
    }
    const effectiveClientId = tenantResolution.effectiveClientId;

    const created = await withTenantContext(contextFromUser(user), async (client) => {
      const deptRes = await client.query(
        'SELECT id, client_id FROM departments WHERE id = $1',
        [departmentId]
      );
      if (!deptRes.rows[0]) {
        throw Object.assign(new Error('Department not found for the given departmentId.'), { statusCode: 404 });
      }
      if (deptRes.rows[0].client_id !== effectiveClientId) {
        throw Object.assign(new Error('Department does not belong to the target tenant.'), { statusCode: 400 });
      }
      if (itemId) {
        const itemRes = await client.query('SELECT id FROM items WHERE id = $1', [itemId]);
        if (!itemRes.rows[0]) {
          throw Object.assign(new Error('Item not found for the given itemId.'), { statusCode: 404 });
        }
      }

      const insRes = await client.query(
        `INSERT INTO actions (client_id, item_id, owner_department_id, title, description, due_date, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'open')
         RETURNING *`,
        [effectiveClientId, itemId, departmentId, title, description || null, dueDate]
      );

      await recordAuditLog(client, {
        clientId: effectiveClientId,
        userId: user.id,
        action: 'ACTION_CREATED',
        entityType: 'actions',
        entityId: insRes.rows[0].id,
        payload: { itemId, departmentId, title, explicitTenant: tenantResolution.explicit },
      });

      return insRes.rows[0];
    });

    res.status(201).json(created);
  } catch (err: any) {
    console.error('Action create error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to create action' });
  }
});

// B1. Patch an action: WF-04 transition and/or evidence note.
// Closing NEVER touches evaluations — this handler UPDATEs actions only.
router.patch('/actions/:id', authMiddleware, requireFreshPassword, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
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

    const updated = await withTenantContext(contextFromUser(user), async (client) => {
      const found = await client.query('SELECT * FROM actions WHERE id = $1', [actionId]);
      const action = found.rows[0];
      // Outside the caller's RLS scope the row is simply not visible.
      if (!action) {
        throw Object.assign(new Error('Action not found.'), { statusCode: 404 });
      }

      if (user.role === 'employee') {
        if (!user.departmentId || action.owner_department_id !== user.departmentId) {
          throw Object.assign(new Error('Employees may only update actions assigned to their own department.'), {
            statusCode: 403,
          });
        }
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
        // B16-B2: verify / close / reopen are GE-only (client + employees
        // refused with the path-pointing message). Starting work
        // (open→in_progress, reopened→in_progress) and evidence notes stay
        // with the owning department.
        if (
          (nextStatus === 'awaiting_verification' || nextStatus === 'closed' || nextStatus === 'reopened') &&
          user.role !== 'ge_admin'
        ) {
          throw Object.assign(new Error(B16_ACTION_CLOSE_REFUSAL), {
            statusCode: 403,
          });
        }
      }

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
          userId: user.id,
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
          userId: user.id,
          action: 'ACTION_EVIDENCE_UPDATED',
          entityType: 'actions',
          entityId: action.id,
          payload: { hasEvidence: body.evidenceNote.length > 0 },
        });
      }

      return updRes.rows[0];
    });

    res.json(updated);
  } catch (err: any) {
    console.error('Action patch error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to update action' });
  }
});

export default router;
