// B17 U2-F — §3.4 staff rows: GET /staff-lists (20), POST /staff-lists (21),
// POST /staff-lists/:id/submit (22), POST /staff-lists/:id/reject (24), plus
// GET /client/dashboard (25). Handlers only; declarations + middleware stay in
// admin.ts. Row 23 (approve) is ROUND 2 — it lives in adminProvisioning.ts
// behind the §3(2) lock-order + OTP-once proof (activated, round 2).
//
// Matrix: GET staff P@T;W;C · POST staff C;W (draft authority, NO provisioning) ·
// submit C:R;W:R · reject P@T;W:R · dashboard W:L+V;C:L+V (E/P denied).
// Draft → submitted → approved/rejected stays the §8 workflow: a work context
// can only write submitted/rejected (the staff_lists UPDATE WITH CHECK pins it),
// so W/C can never mint 'approved' — provisioning stays behind the round-2 row.
// OTPs are never stored plaintext anywhere on these paths (approve returns them
// exactly once from adminProvisioning.ts); draft/submit/reject payloads carry
// no credential fields.

import type { Response } from 'express';
import { recordAuditLog } from '../../db/index.ts';
import { domainTransaction } from './initiativeScope.ts';
import type { AuthenticatedRequest } from '../auth.ts';
import {
  calculateAggregateScore,
  gateDraftEvaluations,
  type DashboardSourceRow,
} from '../../lib/scoring.ts';
import { stripSecrets, unknownDepartmentRefusal, validateStaffListRows } from '../../lib/b11b.ts';
import {
  frozenWriteError,
  isFrozenScope,
  notifyUsers,
  platformConfigContext,
  readContext,
  writeFailure,
} from './_shared.ts';
import { ownTenant, scopeId } from '../scope.ts';
import { adminTenantContext, platformTarget } from './adminCommon.ts';

const SUBMITTED_STATUSES = ['submitted', 'approved', 'client_approved'];

/** §3.4 row 20 — P@T target; W bound A; C own company (E refused by the matrix). */
export async function listStaffLists(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const rows = await domainTransaction(req, async (client) => {
      const { tenant } = adminTenantContext(req, req.query.clientId);
      const lists = await client.query(
        `SELECT sl.id, sl.client_id, sl.status, sl.note, sl.reject_reason, sl.created_at, sl.decided_at,
                c.code AS client_code, c.name AS client_name,
                sb.name AS submitted_by_name, db.name AS decided_by_name,
                (SELECT COUNT(*)::int FROM staff_list_rows r WHERE r.list_id = sl.id) AS row_count
         FROM staff_lists sl
         JOIN clients c ON c.id = sl.client_id
         LEFT JOIN users sb ON sb.id = sl.submitted_by
         LEFT JOIN users db ON db.id = sl.decided_by
         WHERE sl.client_id = $1 ORDER BY sl.created_at DESC`,
        [tenant]
      );
      // Rows are small (demo ≤200); embed them for the ops UI. Never embeds OTPs (not stored).
      for (const list of lists.rows) {
        const rRes = await client.query(
          `SELECT r.id, r.email, r.name, r.department_id, r.department_name, r.role,
                  d.name AS department_resolved
           FROM staff_list_rows r LEFT JOIN departments d ON d.id = r.department_id
           WHERE r.list_id = $1 ORDER BY r.email ASC`,
          [list.id]
        );
        list.rows = rRes.rows.map((r: any) => stripSecrets(r));
      }
      return lists.rows;
    }, live => adminTenantContext(live, req.query.clientId).context);
    res.json({ items: rows, count: rows.length });
  } catch (err: any) {
    writeFailure(res, err, 'Failed to fetch staff lists');
  }
}

/** §3.4 row 21 — C own company / W bound A DRAFT authority only: one draft list
 * + its rows, validated departments, freeze checked, audited. No provisioning. */
export async function createStaffList(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const body = req.body ?? {};
    const validation = validateStaffListRows(body.rows);
    if (!validation.ok) { res.status(validation.status).json({ error: validation.error }); return; }
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;
    const created = await domainTransaction(req, async (client) => {
      const access = req.access!;
      const tenant = ownTenant(access, body.clientId);
      const cRes = await client.query('SELECT id FROM clients WHERE id = $1', [tenant]);
      if (!cRes.rows[0]) throw Object.assign(new Error('Target tenant not found.'), { statusCode: 404 });
      if (await isFrozenScope(client, tenant, null)) throw frozenWriteError();
      const listRes = await client.query(
        `INSERT INTO staff_lists (client_id, submitted_by, status, note)
         VALUES ($1, $2, 'draft', $3) RETURNING id, client_id, status, note, created_at`,
        [tenant, access.actorId, note]
      );
      const listId: string = listRes.rows[0].id;
      for (const row of validation.rows) {
        let departmentId: string | null = row.departmentId;
        if (!departmentId && row.departmentName) {
          const dRes = await client.query(
            'SELECT id FROM departments WHERE client_id = $1 AND (LOWER(name) = LOWER($2) OR code = $3) LIMIT 1',
            [tenant, row.departmentName, row.departmentName]
          );
          departmentId = dRes.rows[0]?.id ?? null;
        }
        if (departmentId) {
          const dCheck = await client.query('SELECT id, client_id FROM departments WHERE id = $1', [departmentId]);
          if (!dCheck.rows[0] || dCheck.rows[0].client_id !== tenant) {
            throw Object.assign(new Error(unknownDepartmentRefusal()), { statusCode: 400 });
          }
        } else {
          throw Object.assign(new Error(unknownDepartmentRefusal()), { statusCode: 400 });
        }
        try {
          await client.query(
            `INSERT INTO staff_list_rows (list_id, email, name, department_id, department_name, role)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [listId, row.email, row.name, departmentId, row.departmentName, row.role]
          );
        } catch (dbErr: any) {
          if (dbErr?.code === '23505') {
            throw Object.assign(new Error(`Duplicate email '${row.email}' in this list.`), { statusCode: 409 });
          }
          throw dbErr;
        }
      }
      await recordAuditLog(client, {
        clientId: tenant,
        userId: access.actorId,
        action: 'STAFF_LIST_CREATED',
        entityType: 'staff_lists',
        entityId: listId,
        payload: { targetTenant: tenant, rows: validation.rows.length },
      });
      return { ...listRes.rows[0], rows: validation.rows.length };
    }, readContext);
    res.status(201).json(created);
  } catch (err: any) {
    writeFailure(res, err, 'Failed to create staff list');
  }
}

/** §3.4 row 22 — C/W draft submit: draft + nonempty + own-tenant gates, no
 * provisioning (status moves to 'submitted' only). */
export async function submitStaffList(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const listId = scopeId(req.params.id, true)!;
    const result = await domainTransaction(req, async (client) => {
      const access = req.access!;
      const cur = await client.query(
        'SELECT id, client_id, status FROM staff_lists WHERE id = $1 AND client_id = $2',
        [listId, access.tenantId]
      );
      const list = cur.rows[0];
      if (!list) throw Object.assign(new Error('Staff list not found.'), { statusCode: 404 });
      if (list.status !== 'draft') {
        throw Object.assign(
          new Error(`Only draft lists can be submitted (current: ${list.status}).`),
          { statusCode: 409 }
        );
      }
      const nRes = await client.query(
        'SELECT COUNT(*)::int AS n FROM staff_list_rows WHERE list_id = $1', [listId]);
      if ((nRes.rows[0]?.n ?? 0) === 0) {
        throw Object.assign(new Error('Cannot submit an empty staff list.'), { statusCode: 400 });
      }
      const upd = await client.query(
        `UPDATE staff_lists SET status = 'submitted', updated_at = NOW() WHERE id = $1
         RETURNING id, client_id, status`,
        [listId]
      );
      await recordAuditLog(client, {
        clientId: list.client_id,
        userId: access.actorId,
        action: 'STAFF_LIST_SUBMITTED',
        entityType: 'staff_lists',
        entityId: listId,
        payload: { targetTenant: list.client_id },
      });
      return upd.rows[0];
    }, readContext);
    res.json(result);
  } catch (err: any) {
    writeFailure(res, err, 'Failed to submit staff list');
  }
}

/** §3.4 row 24 — P explicit T (checked against the list) or W bound A: reason +
 * submitted-list gates, NO provisioning (status → 'rejected' only). */
export async function rejectStaffList(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const listId = scopeId(req.params.id, true)!;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason) { res.status(400).json({ error: 'A rejection reason is required.' }); return; }
    const result = await domainTransaction(req, async (client) => {
      const access = req.access!;
      const tenant = access.mode === 'platform' ? platformTarget(req.body?.clientId) : access.tenantId;
      const cur = await client.query(
        `SELECT id, client_id, status, submitted_by FROM staff_lists
         WHERE id = $1 AND client_id = $2`,
        [listId, tenant]
      );
      const list = cur.rows[0];
      if (!list) throw Object.assign(new Error('Staff list not found.'), { statusCode: 404 });
      if (list.status !== 'submitted') {
        throw Object.assign(
          new Error(`Only submitted lists can be rejected (current: ${list.status}).`),
          { statusCode: 409 }
        );
      }
      const upd = await client.query(
        `UPDATE staff_lists SET status = 'rejected', reject_reason = $1, decided_by = $2,
           decided_at = NOW(), updated_at = NOW()
         WHERE id = $3 RETURNING id, client_id, status, reject_reason`,
        [reason, access.actorId, listId]
      );
      await recordAuditLog(client, {
        clientId: list.client_id,
        userId: access.actorId,
        action: 'STAFF_LIST_REJECTED',
        entityType: 'staff_lists',
        entityId: listId,
        payload: { targetTenant: list.client_id, reason },
      });
      // S-23 fan-out to the submitter, but ONLY when that submitter is a member
      // of this very tenant: the notifications row scope refuses a foreign
      // recipient, and a rejected list must not roll back because its submitter
      // happened to be an outside platform account.
      if (list.submitted_by) {
        const recipient = await client.query(
          'SELECT id FROM users WHERE id = $1 AND client_id = $2',
          [list.submitted_by, list.client_id]
        );
        if (recipient.rows[0]) {
          await notifyUsers(client, {
            userIds: [list.submitted_by],
            clientId: list.client_id,
            type: 'staff.rejected',
            title: 'Staff list rejected',
            titleAr: 'تم رفض قائمة الموظفين',
            body: `Reason: ${reason}`,
            bodyAr: `السبب: ${reason}`,
            entityType: 'staff_lists',
            entityId: listId,
          });
        }
      }
      return upd.rows[0];
    }, live => live.access!.mode === 'platform'
      ? platformConfigContext(live, platformTarget(req.body?.clientId)) : readContext(live));
    res.json(result);
  } catch (err: any) {
    writeFailure(res, err, 'Failed to reject staff list');
  }
}

/** §3.4 row 25 — W/C own tenant, L+V: same scoring math as before (drafts
 * excluded, N/A excluded), show_gap/show_corrective nulling preserved on the
 * server. E/P never reach this handler (matrix); the in-handler suspended
 * branch stays as the second ring behind requireDomainAccess. */
export async function clientDashboard(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const data = await domainTransaction(req, async (client) => {
      const access = req.access!;
      const tenant = ownTenant(access, req.query.clientId);
      const cRes = await client.query(
        'SELECT id, code, name, suspended FROM clients WHERE id = $1', [tenant]);
      const tenantRow = cRes.rows[0];
      if (!tenantRow) throw Object.assign(new Error('Client not found.'), { statusCode: 404 });
      const suspended = tenantRow.suspended === true;
      if (suspended && access.role !== 'ge_admin') {
        return { suspended: true as const, message: 'This tenant is suspended. Contact the platform administrator.' };
      }
      const svcRes = await client.query(
        `SELECT s.id, s.code, s.name, cs.show_gap, cs.show_corrective FROM client_services cs
         JOIN services s ON s.id = cs.service_id WHERE cs.client_id = $1 ORDER BY s.code ASC`,
        [tenant]
      );
      const services = svcRes.rows.map((s: any) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        showGap: s.show_gap !== false,
        showCorrective: s.show_corrective !== false,
      }));
      const evalRes = await client.query(
        `SELECT i.id AS item_id, i.weight::float AS weight, e.score, e.not_evaluated, e.not_applicable,
                (e.id IS NOT NULL) AS has_evaluation,
                EXISTS (SELECT 1 FROM answers a2 WHERE a2.item_id = i.id AND a2.client_id = $1
                        AND a2.status IN ('submitted','approved','client_approved')) AS has_submitted
         FROM items i LEFT JOIN evaluations e ON e.item_id = i.id AND e.client_id = $1`,
        [tenant]
      );
      const gated = gateDraftEvaluations(
        evalRes.rows.map((row: any): DashboardSourceRow => ({
          itemId: String(row.item_id),
          weight: Number(row.weight) || 2,
          score: row.score === null || row.score === undefined ? null : (Number(row.score) as 0 | 50 | 100),
          notEvaluated: Boolean(row.not_evaluated),
          notApplicable: Boolean(row.not_applicable),
          hasEvaluation: Boolean(row.has_evaluation),
          hasSubmittedAnswer: Boolean(row.has_submitted),
        }))
      );
      const agg = calculateAggregateScore(gated);
      const deptRes = await client.query(
        `SELECT dep.id AS department_id, dep.name AS department_name,
                i.id AS item_id, i.weight::float AS weight,
                e.score, e.not_evaluated, e.not_applicable, ans.status AS answer_status
         FROM assignments a
         JOIN departments dep ON dep.id = a.department_id
         JOIN items i ON i.id = a.item_id
         LEFT JOIN evaluations e ON e.item_id = i.id AND e.client_id = $1
         LEFT JOIN answers ans ON ans.item_id = i.id AND ans.client_id = $1 AND ans.department_id = a.department_id
         WHERE a.client_id = $1`,
        [tenant]
      );
      const buckets = new Map<string, { departmentId: string; departmentName: string; weightedSum: number; weightTotal: number; evaluated: number; applicable: number }>();
      for (const r of deptRes.rows) {
        const id = String(r.department_id);
        let b = buckets.get(id);
        if (!b) {
          b = { departmentId: id, departmentName: r.department_name, weightedSum: 0, weightTotal: 0, evaluated: 0, applicable: 0 };
          buckets.set(id, b);
        }
        if (r.not_applicable) continue;
        b.applicable++;
        if (r.not_evaluated || r.score === null || r.score === undefined) continue;
        if (!r.answer_status || !SUBMITTED_STATUSES.includes(r.answer_status)) continue;
        b.evaluated++;
        const w = Number(r.weight) || 2;
        b.weightedSum += w * Number(r.score);
        b.weightTotal += w;
      }
      const departments = [...buckets.values()]
        .map((b) => ({
          departmentId: b.departmentId,
          departmentName: b.departmentName,
          score: b.weightTotal > 0 ? Math.round((b.weightedSum / b.weightTotal) * 10) / 10 : null,
          coveragePercentage: b.applicable > 0 ? Math.round((b.evaluated / b.applicable) * 1000) / 10 : 0,
          evaluatedItems: b.evaluated,
          applicableItems: b.applicable,
        }))
        .sort((a, b) => a.departmentName.localeCompare(b.departmentName));
      const gapVisible = services.length === 0 || services.some((s: any) => s.showGap);
      return {
        suspended: false as const,
        tenant: { id: tenantRow.id, code: tenantRow.code, name: tenantRow.name },
        services,
        collection: { items: evalRes.rows.length },
        review: {
          aggregateScore: gapVisible ? agg.aggregateScore : null,
          coveragePercentage: gapVisible ? agg.coveragePercentage : null,
          evaluatedCount: agg.evaluatedCount,
          applicableCount: agg.applicableCount,
          notApplicableCount: agg.notApplicableCount,
          notEvaluatedCount: agg.notEvaluatedCount,
          fullGapCount: gapVisible ? agg.fullGapCount : null,
          partialGapCount: gapVisible ? agg.partialGapCount : null,
          noGapCount: gapVisible ? agg.noGapCount : null,
        },
        departments: gapVisible ? departments : departments.map((d) => ({ ...d, score: null, coveragePercentage: null })),
      };
    }, readContext);
    res.json(data);
  } catch (err: any) {
    writeFailure(res, err, 'Failed to build client dashboard');
  }
}
