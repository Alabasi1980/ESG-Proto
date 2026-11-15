// B17 U2-F — §3.4 assignment rows: GET /assignments (16), POST /assignments (17),
// DELETE /assignments (18), POST /assignments/na (19). Handlers only; declarations
// + middleware stay in admin.ts.
//
// Matrix (never reworded): GET  P@T;W:L;C:L;E:L+D · POST  P@T#item-belong-to-
// linked-service-same-T-department-freeze-checks · DELETE  P@T#existing-answer-
// evaluation-blockers-freeze-no-delete-data-workaround · NA  W:R+L ONLY (P denied:
// it creates an evaluation/answer, not configuration).
//
// The blocker counts on DELETE go through the count-only definer
// (b17_catalog_child_count tenant.item.* kinds, SHIELD-U2F-01) so spec §5's
// "no P SELECT answer/evaluation blobs" holds — the handler never SELECTs an
// answers/evaluations row in a platform context.

import type { Response } from 'express';
import { recordAuditLog } from '../../db/index.ts';
import { domainTransaction } from './initiativeScope.ts';
import type { AuthenticatedRequest } from '../auth.ts';
import {
  assignUnassignRefusal,
  isStaffNaReason,
  unknownDepartmentRefusal,
} from '../../lib/b11b.ts';
import {
  activeDepartmentUserIds,
  frozenWriteError,
  isFrozenScope,
  notifyUsers,
  readContext,
  writeFailure,
} from './_shared.ts';
import { platformConfigContext } from './_shared.ts';
import {
  optionalScopeId,
  ownDepartment,
  ownTenant,
  scopeError,
  scopeId,
} from '../scope.ts';
import { adminTenantContext, assertTenantExists, platformTarget } from './adminCommon.ts';

const ASSIGNMENT_COLUMNS = `a.id, a.client_id, a.item_id, a.department_id,
  i.code AS item_code, i.requirement,
  d.code AS department_code, d.name AS department_name,
  c.code AS client_code, c.name AS client_name, a.created_at`;

/** §3.4 row 16 — P@T target; W/C L; E L+D (own department pinned below). */
export async function listAssignments(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const namedClient = optionalScopeId(req.query.clientId);
    const namedDept = optionalScopeId(req.query.departmentId);
    const namedItem = optionalScopeId(req.query.itemId);
    const rows = await domainTransaction(req, async (client) => {
      const access = req.access!;
      const { tenant, platform } = adminTenantContext(req, namedClient);
      let departmentFilter: string | null = namedDept;
      if (!platform && access.mode === 'employee') {
        const own = ownDepartment(access)!;
        if (namedDept && namedDept !== own) throw scopeError(403, 'scope.department_mismatch');
        departmentFilter = own;
      }
      const params: any[] = [tenant];
      let where = 'a.client_id = $1';
      if (departmentFilter) {
        params.push(departmentFilter);
        where += ` AND a.department_id = $${params.length}`;
      }
      if (namedItem) {
        params.push(namedItem);
        where += ` AND a.item_id = $${params.length}`;
      }
      const result = await client.query(
        `SELECT ${ASSIGNMENT_COLUMNS}
         FROM assignments a
         JOIN items i ON i.id = a.item_id
         JOIN departments d ON d.id = a.department_id
         JOIN clients c ON c.id = a.client_id
         WHERE ${where}
         ORDER BY c.name ASC, d.name ASC, i.code ASC`,
        params
      );
      return result.rows;
    }, live => adminTenantContext(live, namedClient).context);
    res.json({ items: rows, count: rows.length });
  } catch (err: any) {
    writeFailure(res, err, 'Failed to fetch assignments');
  }
}

/** §3.4 row 17 — P@T ONLY: target tenant exists, item must belong to a linked
 * service of T, department inside T, freeze checked, then insert + audit + fan-out. */
export async function createAssignment(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const body = req.body ?? {};
    const target = platformTarget(body.clientId);
    const itemId = scopeId(body.itemId, true)!;
    const departmentId = scopeId(body.departmentId, true)!;
    const result = await domainTransaction(req, async (client) => {
      await assertTenantExists(client, target);
      const iRes = await client.query('SELECT id, code FROM items WHERE id = $1', [itemId]);
      if (!iRes.rows[0]) throw Object.assign(new Error('Item not found.'), { statusCode: 404 });
      // §3.4: the item must belong to a service LINKED to T (row-free fact under
      // the explicit target context — a catalog item alone is never enough).
      const linked = (await client.query(
        "SELECT b17_content_fact('linked', $1, $2) AS ok", [target, itemId])).rows[0];
      if (!linked.ok) throw scopeError(403, 'scope.item_unlinked');
      const dRes = await client.query(
        'SELECT id, client_id, name FROM departments WHERE id = $1', [departmentId]);
      const dept = dRes.rows[0];
      if (!dept || dept.client_id !== target) {
        throw Object.assign(new Error(unknownDepartmentRefusal()), { statusCode: 400 });
      }
      if (await isFrozenScope(client, target, itemId)) throw frozenWriteError();
      const ins = await client.query(
        `INSERT INTO assignments (client_id, item_id, department_id)
         VALUES ($1, $2, $3) ON CONFLICT (client_id, item_id, department_id) DO NOTHING RETURNING id`,
        [target, itemId, departmentId]
      );
      const created = (ins.rowCount ?? 0) > 0;
      if (created) {
        await recordAuditLog(client, {
          clientId: target,
          userId: req.access!.actorId,
          action: 'ASSIGN_ITEM',
          entityType: 'assignments',
          entityId: ins.rows[0].id,
          payload: { itemId, departmentId },
        });
        const recipients = await activeDepartmentUserIds(client, target, departmentId);
        await notifyUsers(client, {
          userIds: recipients,
          clientId: target,
          type: 'assignment.created',
          title: `New item assigned: ${iRes.rows[0].code}`,
          titleAr: `تم إسناد بند جديد: ${iRes.rows[0].code}`,
          body: `Item ${iRes.rows[0].code} was assigned to ${dept.name ?? 'your department'}.`,
          bodyAr: `تم إسناد البند ${iRes.rows[0].code} إلى ${dept.name ?? 'إدارتك'}.`,
          entityType: 'assignments',
          entityId: ins.rows[0].id,
        });
        return { assigned: true, existed: false, id: ins.rows[0].id };
      }
      const cur = await client.query(
        'SELECT id FROM assignments WHERE client_id = $1 AND item_id = $2 AND department_id = $3',
        [target, itemId, departmentId]
      );
      return { assigned: true, existed: true, id: cur.rows[0].id };
    }, live => platformConfigContext(live, target));
    res.status(result.existed ? 200 : 201).json(result);
  } catch (err: any) {
    writeFailure(res, err, 'Failed to assign item');
  }
}

/** §3.4 row 18 — P@T ONLY: freeze + the existing answer/evaluation blockers,
 * then DELETE the ASSIGNMENT ROW ONLY (never a delete-data workaround: answers,
 * evaluations and approvals stay untouched and keep the pair they document). */
export async function deleteAssignment(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const query = (req.query ?? {}) as Record<string, unknown>;
    const target = platformTarget(body.clientId ?? query.clientId);
    const itemId = scopeId(body.itemId ?? query.itemId, true)!;
    const departmentId = scopeId(body.departmentId ?? query.departmentId, true)!;
    const result = await domainTransaction(req, async (client) => {
      await assertTenantExists(client, target);
      const cur = await client.query(
        'SELECT id FROM assignments WHERE client_id = $1 AND item_id = $2 AND department_id = $3',
        [target, itemId, departmentId]
      );
      if (!cur.rows[0]) throw Object.assign(new Error('Assignment not found.'), { statusCode: 404 });
      if (await isFrozenScope(client, target, itemId)) throw frozenWriteError();
      const blockers = (await client.query(
        `SELECT b17_catalog_child_count('tenant.item.answers', $1) AS answers,
                b17_catalog_child_count('tenant.item.evaluations', $1) AS evaluations`,
        [itemId]
      )).rows[0];
      if (blockers.answers + blockers.evaluations > 0) {
        throw Object.assign(new Error(assignUnassignRefusal(blockers)), { statusCode: 409 });
      }
      await client.query(
        'DELETE FROM assignments WHERE client_id = $1 AND item_id = $2 AND department_id = $3',
        [target, itemId, departmentId]
      );
      await recordAuditLog(client, {
        clientId: target,
        userId: req.access!.actorId,
        action: 'UNASSIGN_ITEM',
        entityType: 'assignments',
        payload: { itemId, departmentId },
      });
      return { unassigned: true };
    }, live => platformConfigContext(live, target));
    res.json(result);
  } catch (err: any) {
    writeFailure(res, err, 'Failed to unassign item');
  }
}

/** §3.4 row 19 — the GE N/A shortcut, W R+L ONLY (P/C/E refused by the matrix
 * before this handler): existing guards first (assignment 403, freeze 409,
 * existing evaluation 409), then the N/A evaluation + submitted answer. The row
 * scope in b17-content.sql pins it to not_applicable + actor + linked + retained
 * assignment, so no scored evaluation can be minted through this route. */
export async function assignNotApplicable(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const body = req.body ?? {};
    const itemId = scopeId(body.itemId, true)!;
    const departmentId = scopeId(body.departmentId, true)!;
    const naReason = typeof body.naReason === 'string' ? body.naReason.trim() : '';
    const justification = typeof body.justification === 'string' ? body.justification.trim() : '';
    if (!isStaffNaReason(naReason)) {
      res.status(400).json({
        error: 'naReason is required, one of: not-applicable, legal-prohibitions, confidentiality-constraints, information-unavailable-incomplete.',
      }); return;
    }
    const result = await domainTransaction(req, async (client) => {
      const tenant = ownTenant(req.access!, body.clientId);
      const asg = await client.query(
        'SELECT id FROM assignments WHERE client_id = $1 AND item_id = $2 AND department_id = $3',
        [tenant, itemId, departmentId]
      );
      if (!asg.rows[0]) {
        throw Object.assign(new Error('This item is not assigned to the department.'), { statusCode: 403 });
      }
      if (await isFrozenScope(client, tenant, itemId)) throw frozenWriteError();
      const existing = await client.query(
        'SELECT id FROM evaluations WHERE client_id = $1 AND item_id = $2',
        [tenant, itemId]
      );
      if (existing.rows[0]) {
        throw Object.assign(
          new Error('This item already has an evaluation. Post-submit changes must go through PUT /api/evaluations/:id/correct with a reason.'),
          { statusCode: 409 }
        );
      }
      const evalIns = await client.query(
        `INSERT INTO evaluations (client_id, item_id, evaluator_id, score, not_evaluated, not_applicable, na_reason, justification)
         VALUES ($1, $2, $3, NULL, false, true, $4, $5) RETURNING id, version`,
        [tenant, itemId, req.access!.actorId, naReason, justification || null]
      );
      // Shortcut answer keeps scoring consistent (submitted so the N/A is visible, never counted).
      await client.query(
        `INSERT INTO answers (client_id, item_id, department_id, submitted_by, status, value)
         VALUES ($1, $2, $3, $4, 'submitted', $5)
         ON CONFLICT (client_id, item_id, department_id) DO UPDATE SET status = 'submitted', value = EXCLUDED.value`,
        [tenant, itemId, departmentId, req.access!.actorId, justification || 'N/A']
      );
      await recordAuditLog(client, {
        clientId: tenant,
        userId: req.access!.actorId,
        action: 'EVALUATION_NA_SHORTCUT',
        entityType: 'evaluations',
        entityId: evalIns.rows[0].id,
        payload: { itemId, departmentId, naReason },
      });
      return { evaluationId: evalIns.rows[0].id, notApplicable: true, naReason };
    }, readContext);
    res.status(201).json(result);
  } catch (err: any) {
    writeFailure(res, err, 'Failed to mark item N/A');
  }
}
