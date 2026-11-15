// B17 U2-F — §3.4 directory rows: GET /departments (3), PATCH /departments/:id/head
// (4), GET /users (5). Handlers only; declarations + middleware stay in admin.ts.
// Matrix (accessRegistry, transcribed from spec §3.4, never reworded):
//   GET /departments        P@T#configuration-target-required;W;C;E#own-dept-metadata-only
//   PATCH /departments/:id/head  P@T#target-department-employee-same-T-active-W-C-E-denied
//   GET /users              P@T#explicit-T-for-tenant-users-or-platform-scope-for-GE-accounts
// Every role/mode gate is the dispatcher + requireDomainAccess matrix ring; these
// handlers only resolve their server-selected context and pin their rows.

import type { Response } from 'express';
import { recordAuditLog } from '../../db/index.ts';
import { domainTransaction } from './initiativeScope.ts';
import type { AuthenticatedRequest } from '../auth.ts';
import { readContext, platformConfigContext, writeFailure } from './_shared.ts';
import { optionalScopeId, ownDepartment, scopeId } from '../scope.ts';
import { SAFE_USER_COLUMNS, adminTenantContext, platformTarget } from './adminCommon.ts';

/** §3.4 row 3 — P@T target REQUIRED; W/C own departments; E own department only. */
export async function listDepartments(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const rows = await domainTransaction(req, async (client) => {
      const access = req.access!;
      const { tenant, platform } = adminTenantContext(req, req.query.clientId);
      const params: any[] = [tenant];
      let where = 'd.client_id = $1';
      // §9(c) defence-in-depth beside FORCE RLS: an employee row is EXACTLY its
      // own department, never "whatever RLS happened to return".
      if (!platform && access.mode === 'employee') {
        params.push(ownDepartment(access)!);
        where += ` AND d.id = $${params.length}`;
      }
      const result = await client.query(
        `SELECT d.id, d.client_id, d.code, d.name, d.description,
                d.head_user_id, hu.name AS head_name
         FROM departments d LEFT JOIN users hu ON hu.id = d.head_user_id
         WHERE ${where} ORDER BY d.name ASC`,
        params
      );
      return result.rows;
    }, live => adminTenantContext(live, req.query.clientId).context);
    res.json(rows);
  } catch (err: any) {
    writeFailure(res, err, 'Failed to fetch departments');
  }
}

/** §3.4 row 4 — P@T ONLY. The explicit target T is required (body.clientId):
 * the department AND the designated head must both live inside it, active. */
export async function setDepartmentHead(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const body = req.body ?? {};
    const target = platformTarget(body.clientId);
    const departmentId = scopeId(req.params.id, true)!;
    const raw = body.headUserId === null || body.headUserId === undefined ? null : String(body.headUserId).trim();
    // Clear = { headUserId: null }; anything else must be a well-formed UUID
    // before it can reach SQL (§9(b) — a malformed id is 400, never a raw 22P02).
    const headUserId: string | null = raw === null || raw === '' ? null : scopeId(raw, true)!;

    const updated = await domainTransaction(req, async (client) => {
      // Target-bound read: a department outside T is simply not visible (404).
      const deptRes = await client.query(
        'SELECT id, client_id, code, name FROM departments WHERE id = $1 AND client_id = $2',
        [departmentId, target]
      );
      const dept = deptRes.rows[0];
      if (!dept) throw Object.assign(new Error('Department not found.'), { statusCode: 404 });

      if (headUserId !== null) {
        // RLS admits only rows of T here, so a foreign-tenant user reads as
        // "not found" -> the same-T refusal below; role/active/department
        // rules are unchanged from the B16-A1 gate.
        const uRes = await client.query(
          'SELECT id, role, client_id, department_id, is_active FROM users WHERE id = $1',
          [headUserId]
        );
        const head = uRes.rows[0];
        if (!head || head.is_active !== true || head.client_id !== dept.client_id) {
          throw Object.assign(new Error('Head must be an active user of the same tenant.'), { statusCode: 400 });
        }
        if (head.role !== 'employee' || head.department_id !== dept.id) {
          throw Object.assign(
            new Error('Head must be an employee of this department (client administrators and other departments are refused).'),
            { statusCode: 400 }
          );
        }
      }

      const upd = await client.query(
        'UPDATE departments SET head_user_id = $1, updated_at = NOW() WHERE id = $2 RETURNING id, client_id, code, name, head_user_id',
        [headUserId, departmentId]
      );
      await recordAuditLog(client, {
        clientId: dept.client_id,
        userId: req.access!.actorId,
        action: headUserId ? 'DEPARTMENT_HEAD_ASSIGNED' : 'DEPARTMENT_HEAD_CLEARED',
        entityType: 'departments',
        entityId: dept.id,
        payload: { departmentCode: dept.code, headUserId },
      });
      return upd.rows[0];
    }, live => platformConfigContext(live, target));
    res.json(updated);
  } catch (err: any) {
    writeFailure(res, err, 'Failed to set department head');
  }
}

/** §3.4 row 5 — P@T for tenant users, or the explicit PLATFORM scope (tenant
 * NULL) for GE accounts. Without a named T the row returns platform accounts
 * only: a cross-tenant user enumeration is never implied (W/C/E are refused by
 * the matrix before this handler runs). */
export async function listUsers(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const target = optionalScopeId(req.query.clientId);
    const rows = await domainTransaction(req, async (client) => {
      const params: any[] = [];
      let where = ' WHERE u.client_id IS NULL';
      if (target) {
        params.push(target);
        where = ' WHERE u.client_id = $1';
      }
      const result = await client.query(
        `SELECT ${SAFE_USER_COLUMNS} FROM users u
         LEFT JOIN clients c ON u.client_id = c.id
         LEFT JOIN departments d ON d.id = u.department_id${where}
         ORDER BY u.created_at ASC`,
        params
      );
      return result.rows;
    }, live => target ? platformConfigContext(live, target) : readContext(live));
    res.json(rows);
  } catch (err: any) {
    writeFailure(res, err, 'Failed to fetch users');
  }
}
