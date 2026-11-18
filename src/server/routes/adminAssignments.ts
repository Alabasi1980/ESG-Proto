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

/** TASK-PROTO-U4-3C (G2): participation allowlist gate for W application
 * writes. When the consultant has set an explicit participating-departments
 * allowlist for the tenant, the department must be a member (400
 * `match.incomplete`); with no allowlist yet the D-5 derivation (assignment
 * presence) stays the only gate — zero behavior change on existing tenants. */
async function requireParticipatingDept(
  client: { query: (t: string, p?: any[]) => Promise<any> }, tenant: string, departmentId: string,
): Promise<void> {
  const any = await client.query('SELECT 1 FROM participating_departments WHERE client_id = $1 LIMIT 1', [tenant]);
  if ((any.rowCount ?? 0) === 0) return;
  const ok = await client.query(
    'SELECT 1 FROM participating_departments WHERE client_id = $1 AND department_id = $2', [tenant, departmentId]);
  if (!ok.rows[0]) {
    throw Object.assign(new Error('Department is not in the participating set for this tenant.'), { statusCode: 400, code: 'match.incomplete' });
  }
}

/** TASK-PROTO-U4-3C (G2): items of one disclosure linked to the tenant. A
 * disclosure with no linked item is 403 `scope.service_unlinked` (fail closed). */
async function linkedDisclosureItems(
  client: { query: (t: string, p?: any[]) => Promise<any> }, tenant: string, disclosureId: string,
): Promise<Array<{ id: string; answer_type: string; attachment_required: boolean }>> {
  const disc = (await client.query('SELECT id FROM disclosures WHERE id = $1', [disclosureId])).rows[0];
  if (!disc) throw Object.assign(new Error('Disclosure not found.'), { statusCode: 404 });
  const rows = (await client.query(
    `SELECT i.id, i.answer_type AS answer_type, i.attachment_required AS attachment_required
       FROM items i JOIN disclosures d ON d.id = i.disclosure_id
       JOIN service_standards ss ON ss.standard_id = d.standard_id
       JOIN client_services cs ON cs.service_id = ss.service_id AND cs.client_id = $2
      WHERE d.id = $1 ORDER BY i.id`,
    [disclosureId, tenant]
  )).rows;
  if (rows.length === 0) throw scopeError(403, 'scope.service_unlinked');
  return rows;
}

/** Shared single-item N/A leg (item scope, or one item of a disclosure batch).
 * Guards preserved verbatim from the pre-U4-3C shortcut: assignment 403,
 * freeze 409, attachment 409 (R2/SHIELD M-02), existing-evaluation 409, then
 * the N/A evaluation + submitted answer. R3 (Shield R-A3): the stored answer
 * value stays consistent with the typed-answer module — TEXT keeps 'N/A' (or
 * the supplied justification), every OTHER type stores ''. Returns the new
 * evaluation id. */
async function applyItemNa(
  client: { query: (t: string, p?: any[]) => Promise<any> },
  tenant: string, req: AuthenticatedRequest, itemId: string,
  departmentId: string, naReason: string, justification: string,
): Promise<string> {
  const asg = await client.query(
    `SELECT a.id, i.answer_type AS answer_type, i.attachment_required AS attachment_required
       FROM assignments a
       JOIN items i ON i.id = a.item_id
      WHERE a.client_id = $1 AND a.item_id = $2 AND a.department_id = $3`,
    [tenant, itemId, departmentId]
  );
  if (!asg.rows[0]) {
    throw Object.assign(new Error('This item is not assigned to the department.'), { statusCode: 403 });
  }
  if (await isFrozenScope(client, tenant, itemId)) throw frozenWriteError();
  if (asg.rows[0].attachment_required === true) {
    throw Object.assign(
      new Error('This item requires an attachment, so the N/A shortcut cannot be used. Submit N/A through the evaluation workflow with the required attachment.'),
      { statusCode: 409, code: 'assignment.na_attachment_required' }
    );
  }
  const naAnswerValue = asg.rows[0].answer_type === 'text'
    ? (justification || 'N/A')
    : '';
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
    [tenant, itemId, departmentId, req.access!.actorId, naAnswerValue]
  );
  return evalIns.rows[0].id;
}
/** §3.4 row 19 — the GE N/A shortcut, W R+L ONLY (P/C/E refused by the matrix
 * before this handler). TASK-PROTO-U4-3C (G2): scope-aware —
 * `{scope:'item'|'disclosure', itemId|disclosureId, departmentId?, naReason,
 * justification?}`. Disclosure scope N/As every assigned item under the
 * disclosure (derived, no scope column — parent DB-2 option ii); aggregates
 * exclude N/A (never zero-filled). Guards (assignment 403, freeze 409,
 * attachment 409, existing-evaluation 409) hold per item; the batch is atomic.
 * Item scope keeps the existing EVALUATION_NA_SHORTCUT audit name (never
 * renamed); disclosure scope audits NA_SCOPE_SET. */
export async function assignNotApplicable(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const body = req.body ?? {};
    const scope = body.scope === undefined ? 'item' : body.scope;
    if (scope !== 'item' && scope !== 'disclosure') {
      res.status(400).json({ error: 'scope must be item or disclosure.', code: 'na.scope_invalid' }); return;
    }
    const departmentId = scopeId(body.departmentId, true)!;
    const naReason = typeof body.naReason === 'string' ? body.naReason.trim() : '';
    const justification = typeof body.justification === 'string' ? body.justification.trim() : '';
    if (!isStaffNaReason(naReason)) {
      res.status(400).json({
        error: 'naReason is required, one of: not-applicable, legal-prohibitions, confidentiality-constraints, information-unavailable-incomplete.',
      }); return;
    }
    if (scope === 'item') scopeId(body.itemId, true);
    else scopeId(body.disclosureId, true);
    const result = await domainTransaction(req, async (client) => {
      const tenant = ownTenant(req.access!, body.clientId);
      await requireParticipatingDept(client, tenant, departmentId);
      if (scope === 'item') {
        const itemId = scopeId(body.itemId, true)!;
        const item = (await client.query(
          'SELECT id, answer_type AS answer_type, attachment_required AS attachment_required FROM items WHERE id = $1',
          [itemId]
        )).rows[0];
        if (!item) throw Object.assign(new Error('Item not found.'), { statusCode: 404 });
        if (!(await client.query(
          `SELECT 1 FROM assignments a WHERE a.client_id = $1 AND a.item_id = $2
             AND EXISTS (SELECT 1 FROM client_services cs JOIN service_standards ss ON ss.service_id = cs.service_id
               JOIN disclosures d ON d.standard_id = ss.standard_id JOIN items i ON i.disclosure_id = d.id
               WHERE cs.client_id = $1 AND i.id = $2)`,
          [tenant, itemId]
        )).rows[0]) throw scopeError(403, 'scope.service_unlinked');
        const evaluationId = await applyItemNa(client, tenant, req, itemId,
          departmentId, naReason, justification);
        await recordAuditLog(client, {
          clientId: tenant,
          userId: req.access!.actorId,
          action: 'EVALUATION_NA_SHORTCUT',
          entityType: 'evaluations',
          entityId: evaluationId,
          payload: { itemId, departmentId, naReason },
        });
        return { evaluationId, notApplicable: true, scope, naReason };
      }
      const disclosureId = scopeId(body.disclosureId, true)!;
      const items = await linkedDisclosureItems(client, tenant, disclosureId);
      const evaluationIds: string[] = [];
      for (const item of items) {
        evaluationIds.push(await applyItemNa(client, tenant, req, String(item.id),
          departmentId, naReason, justification));
      }
      await recordAuditLog(client, {
        clientId: tenant,
        userId: req.access!.actorId,
        action: 'NA_SCOPE_SET',
        entityType: 'evaluations',
        payload: { scope: 'disclosure', disclosureId, departmentId, naReason, itemIds: items.map((i) => String(i.id)) },
      });
      return { notApplicable: true, scope, disclosureId, evaluationIds, naReason };
    }, readContext);
    res.status(201).json(result);
  } catch (err: any) {
    writeFailure(res, err, 'Failed to mark item N/A');
  }
}

/** TASK-PROTO-U4-3C (G2) — POST /assignments/na/lift (NEW, W R+L bound-A only).
 * `{scope:'item'|'disclosure', itemId|disclosureId, departmentId?, reason,
 * expectedVersion?}`. Lift lands UNEVALUATED (never direct-to-scored — the
 * WITH CHECK of b17_consultant_evaluations_na_lift_update); the paired
 * shortcut answer reverts via the EXISTING b17_answers_workflow_update W branch
 * (draft + neutral value, supplied-dept only — never another dept's work).
 * Reason mandatory (400 `na.reason_required`); frozen 409 + trigger backstop;
 * stale version 409; lifts audited NA_SCOPE_LIFTED (metadata only). */
export async function liftNotApplicable(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const body = req.body ?? {};
    const scope = body.scope === undefined ? 'item' : body.scope;
    if (scope !== 'item' && scope !== 'disclosure') {
      res.status(400).json({ error: 'scope must be item or disclosure.', code: 'na.scope_invalid' }); return;
    }
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason) {
      res.status(400).json({ error: 'A lift reason is required.', code: 'na.reason_required' }); return;
    }
    const departmentId = body.departmentId === undefined ? null : scopeId(body.departmentId, true);
    const expectedVersion = body.expectedVersion === undefined ? null : body.expectedVersion;
    if (expectedVersion !== null && (!Number.isInteger(expectedVersion) || expectedVersion < 1)) {
      res.status(400).json({ error: 'expectedVersion must be a positive integer.', code: 'na.version_invalid' }); return;
    }
    const result = await domainTransaction(req, async (client) => {
      const tenant = ownTenant(req.access!, body.clientId);
      const liftOne = async (itemId: string): Promise<string> => {
        if (await isFrozenScope(client, tenant, itemId)) throw frozenWriteError();
        const cur = (await client.query(
          `SELECT id, version FROM evaluations
            WHERE client_id = $1 AND item_id = $2 AND not_applicable = true FOR UPDATE`, [tenant, itemId]
        )).rows[0];
        if (!cur) {
          throw Object.assign(new Error('No N/A evaluation to lift for this item.'), { statusCode: 404, code: 'na.lift_forbidden' });
        }
        if (expectedVersion !== null && cur.version !== expectedVersion) {
          throw Object.assign(new Error('Stale evaluation version.'), { statusCode: 409, code: 'item.version_conflict' });
        }
        const upd = await client.query(
          `UPDATE evaluations SET not_applicable = false, not_evaluated = true, score = NULL,
             na_reason = NULL, version = version + 1, updated_at = NOW()
           WHERE id = $1 RETURNING id`,
          [cur.id]
        );
        if ((upd.rowCount ?? 0) === 0) throw scopeError(403, 'na.lift_forbidden');
        if (departmentId) {
          await client.query(
            `UPDATE answers SET status = 'draft', value = '', version = version + 1, updated_at = NOW()
             WHERE client_id = $1 AND item_id = $2 AND department_id = $3`,
            [tenant, itemId, departmentId]
          );
        }
        return String(cur.id);
      };
      let lifted: string[];
      let ref: Record<string, string>;
      if (scope === 'item') {
        const itemId = scopeId(body.itemId, true)!;
        lifted = [await liftOne(itemId)];
        ref = { itemId };
      } else {
        const disclosureId = scopeId(body.disclosureId, true)!;
        const items = await linkedDisclosureItems(client, tenant, disclosureId);
        lifted = [];
        for (const item of items) {
          const cur = (await client.query(
            'SELECT id FROM evaluations WHERE client_id = $1 AND item_id = $2 AND not_applicable = true', [tenant, item.id]
          )).rows[0];
          if (cur) lifted.push(await liftOne(String(item.id)));
        }
        if (lifted.length === 0) {
          throw Object.assign(new Error('No N/A evaluations to lift under this disclosure.'), { statusCode: 404, code: 'na.lift_forbidden' });
        }
        ref = { disclosureId };
      }
      await recordAuditLog(client, {
        clientId: tenant,
        userId: req.access!.actorId,
        action: 'NA_SCOPE_LIFTED',
        entityType: 'evaluations',
        payload: { scope, ...ref, ...(departmentId ? { departmentId } : {}), reason, evaluationIds: lifted },
      });
      return { lifted: true, scope, ...ref, evaluationIds: lifted };
    }, readContext);
    res.json(result);
  } catch (err: any) {
    writeFailure(res, err, 'Failed to lift N/A');
  }
}
