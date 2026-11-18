// TASK-PROTO-U4-3C (unit c1) — consultant application writes (W bound-to-A only).
//
// FIVE declarations (matrix in accessRegistry.ts, group 'workspace'):
//   POST   /workspace/client-services
//   DELETE /workspace/client-services/:serviceId
//   PUT    /workspace/participating-departments
//   PUT    /workspace/dept-matching
//   POST   /workspace/staff/:userId/complete-password
// Mounted by src/server/routes.ts (mount entries only). Handlers only here.
// Admission is the dispatcher + requireDomainAccess matrix ring; every handler
// below re-asserts mode==='consultant' && role==='ge_admin' (defence-in-depth,
// same discipline as serviceVisibility.ts) and pins the tenant to the server's
// own bound A (ownTenant — request values never trusted, profile First Rule).
// Every mutation runs in ONE domainTransaction with in-txn audit (INV-AUDIT);
// unknown combinations fail closed (403/404); frozen scope refuses 409.

import express, { type Response } from 'express';
import { authMiddleware, hashPassword, type AuthenticatedRequest } from '../auth.ts';
import { requireDomainAccess } from '../access.ts';
import type { AccessContext } from '../../lib/capabilities.ts';
import { requireFreshPassword, readContext, writeFailure, frozenWriteError, isFrozenScope } from './_shared.ts';
import { domainTransaction } from './initiativeScope.ts';
import { ownTenant, scopeError, scopeId } from '../scope.ts';
import { validateSelfChosenPassword } from '../../lib/password.ts';
import { recordAuditLog } from '../../db/index.ts';
import { unknownDepartmentRefusal } from '../../lib/b11b.ts';

const router = express.Router();

/** Defence-in-depth beside the matrix: only a consultant tab may write, and the
 * tenant is the server's own bound A (request values never trusted). Call with
 * the in-transaction access (G1 ring: no req.access capture outside a
 * domainTransaction boundary). */
function consultantTenant(access: AccessContext, req: AuthenticatedRequest): string {
  if (access.mode !== 'consultant' || access.role !== 'ge_admin')
    throw scopeError(403, 'workspace.mode_mismatch');
  return ownTenant(access, (req.body ?? {}).clientId ?? req.query.clientId);
}

async function assertTenantActive(client: { query: (t: string, p?: any[]) => Promise<any> }, tenant: string): Promise<void> {
  const row = (await client.query('SELECT suspended FROM clients WHERE id = $1', [tenant])).rows[0];
  if (!row) throw Object.assign(new Error('Target tenant not found.'), { statusCode: 404 });
  if (row.suspended === true)
    throw Object.assign(new Error('This tenant is suspended.'), { statusCode: 403, code: 'tenant.suspended' });
}

/** Non-empty trimmed code (service-side department code being matched). */
function deptCode(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 120)
    throw scopeError(400, 'match.code_invalid');
  return value.trim();
}

/** Live tenant work under one service: assignments on items of that service. */
async function serviceWorkCount(client: { query: (t: string, p?: any[]) => Promise<any> }, tenant: string, serviceId: string): Promise<number> {
  const r = await client.query(
    `SELECT count(*)::int AS n FROM assignments a
      JOIN items i ON i.id = a.item_id
      JOIN disclosures d ON d.id = i.disclosure_id
      JOIN service_standards ss ON ss.standard_id = d.standard_id
     WHERE a.client_id = $1 AND ss.service_id = $2`,
    [tenant, serviceId]
  );
  return r.rows[0]?.n ?? 0;
}

/** POST /workspace/client-services {serviceId} → link (W bound-A; 409 if linked). */
async function linkClientService(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const serviceId = scopeId(req.body?.serviceId, true)!;
    const result = await domainTransaction(req, async (client) => {
      const tenant = consultantTenant(req.access!, req);
      await assertTenantActive(client, tenant);
      if (await isFrozenScope(client, tenant, null)) throw frozenWriteError();
      const svc = (await client.query('SELECT id FROM services WHERE id = $1', [serviceId])).rows[0];
      if (!svc) throw Object.assign(new Error('Service not found.'), { statusCode: 404 });
      const ins = await client.query(
        `INSERT INTO client_services (client_id, service_id)
         VALUES ($1, $2) ON CONFLICT (client_id, service_id) DO NOTHING RETURNING client_id, service_id`,
        [tenant, serviceId]
      );
      if ((ins.rowCount ?? 0) === 0)
        throw Object.assign(new Error('Service is already linked to this tenant.'), { statusCode: 409, code: 'service.link_conflict' });
      await recordAuditLog(client, {
        clientId: tenant, userId: req.access!.actorId, action: 'SERVICE_LINKED',
        entityType: 'client_services', payload: { clientId: tenant, serviceId },
      });
      return { linked: true, clientId: tenant, serviceId };
    }, readContext);
    res.status(201).json(result);
  } catch (err: any) {
    writeFailure(res, err, 'Failed to link service');
  }
}

/** DELETE /workspace/client-services/:serviceId → unlink (live work → 409). */
async function unlinkClientService(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const serviceId = scopeId(req.params.serviceId, true)!;
    const result = await domainTransaction(req, async (client) => {
      const tenant = consultantTenant(req.access!, req);
      await assertTenantActive(client, tenant);
      if (await isFrozenScope(client, tenant, null)) throw frozenWriteError();
      const cur = await client.query(
        'SELECT client_id, service_id FROM client_services WHERE client_id = $1 AND service_id = $2 FOR UPDATE',
        [tenant, serviceId]
      );
      if (!cur.rows[0]) throw Object.assign(new Error('Service is not linked to this tenant.'), { statusCode: 404 });
      if (await serviceWorkCount(client, tenant, serviceId) > 0)
        throw Object.assign(
          new Error('Cannot unlink: tenant work exists under this service. Archive its scope first.'),
          { statusCode: 409, code: 'service.unlink_blocked' }
        );
      await client.query('DELETE FROM client_services WHERE client_id = $1 AND service_id = $2', [tenant, serviceId]);
      await recordAuditLog(client, {
        clientId: tenant, userId: req.access!.actorId, action: 'SERVICE_UNLINKED',
        entityType: 'client_services', payload: { clientId: tenant, serviceId },
      });
      return { unlinked: true, clientId: tenant, serviceId };
    }, readContext);
    res.json(result);
  } catch (err: any) {
    writeFailure(res, err, 'Failed to unlink service');
  }
}

/** PUT /workspace/participating-departments {departmentIds[]} → replace set. */
async function setParticipatingDepartments(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const raw = req.body?.departmentIds;
    if (!Array.isArray(raw)) throw scopeError(400, 'scope.id_invalid');
    const ids = [...new Set(raw.map((v) => scopeId(v, true)!))];
    const result = await domainTransaction(req, async (client) => {
      const tenant = consultantTenant(req.access!, req);
      await assertTenantActive(client, tenant);
      if (await isFrozenScope(client, tenant, null)) throw frozenWriteError();
      for (const id of ids) {
        const d = (await client.query('SELECT id, client_id FROM departments WHERE id = $1', [id])).rows[0];
        if (!d || d.client_id !== tenant) throw Object.assign(new Error(unknownDepartmentRefusal()), { statusCode: 400 });
      }
      const existing = (await client.query(
        'SELECT department_id FROM participating_departments WHERE client_id = $1', [tenant]
      )).rows.map((r: any) => String(r.department_id));
      const next = new Set(ids);
      const removed = existing.filter((id: string) => !next.has(id));
      const added = ids.filter((id) => !existing.includes(id));
      for (const id of removed) {
        const w = (await client.query(
          'SELECT count(*)::int AS n FROM assignments WHERE client_id = $1 AND department_id = $2', [tenant, id]
        )).rows[0].n;
        if (w > 0)
          throw Object.assign(
            new Error('Cannot remove a department with existing assignments. Unassign its items first.'),
            { statusCode: 409, code: 'participating.dept_has_work' }
          );
        await client.query(
          'DELETE FROM participating_departments WHERE client_id = $1 AND department_id = $2', [tenant, id]);
      }
      for (const id of added) {
        await client.query(
          `INSERT INTO participating_departments (client_id, department_id, added_by)
           VALUES ($1, $2, $3) ON CONFLICT (client_id, department_id) DO NOTHING`,
          [tenant, id, req.access!.actorId]
        );
      }
      await recordAuditLog(client, {
        clientId: tenant, userId: req.access!.actorId, action: 'PARTICIPATING_DEPTS_SET',
        entityType: 'participating_departments', payload: { clientId: tenant, added, removed },
      });
      const current = (await client.query(
        'SELECT department_id FROM participating_departments WHERE client_id = $1 ORDER BY department_id', [tenant]
      )).rows.map((r: any) => String(r.department_id));
      return { departmentIds: current };
    }, readContext);
    res.json(result);
  } catch (err: any) {
    writeFailure(res, err, 'Failed to set participating departments');
  }
}

/** PUT /workspace/dept-matching {mappings:[{serviceId, serviceDeptCode, clientDeptId}]}. */
async function setDeptMatching(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const raw = req.body?.mappings;
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 500) throw scopeError(400, 'match.incomplete');
    const result = await domainTransaction(req, async (client) => {
      const tenant = consultantTenant(req.access!, req);
      await assertTenantActive(client, tenant);
      if (await isFrozenScope(client, tenant, null)) throw frozenWriteError();
      const allowlist = (await client.query(
        'SELECT department_id FROM participating_departments WHERE client_id = $1', [tenant]
      )).rows.map((r: any) => String(r.department_id));
      const restricted = allowlist.length > 0;
      const applied: Array<{ serviceId: string; serviceDeptCode: string; clientDeptId: string }> = [];
      for (const m of raw) {
        const serviceId = scopeId(m?.serviceId, true)!;
        const code = deptCode(m?.serviceDeptCode ?? m?.itemDeptKey);
        const deptId = scopeId(m?.clientDeptId, true)!;
        const link = (await client.query(
          'SELECT 1 FROM client_services WHERE client_id = $1 AND service_id = $2', [tenant, serviceId]
        )).rowCount;
        if (!link) throw scopeError(403, 'scope.service_unlinked');
        const dept = (await client.query('SELECT id, client_id FROM departments WHERE id = $1', [deptId])).rows[0];
        if (!dept || dept.client_id !== tenant) throw Object.assign(new Error(unknownDepartmentRefusal()), { statusCode: 400 });
        if (restricted && !allowlist.includes(deptId))
          throw Object.assign(new Error('Department is not in the participating set.'), { statusCode: 400, code: 'match.incomplete' });
        const prev = (await client.query(
          `SELECT client_department_id FROM dept_match_overrides
            WHERE client_id = $1 AND service_id = $2 AND service_dept_code = $3 FOR UPDATE`,
          [tenant, serviceId, code]
        )).rows[0];
        if (prev && String(prev.client_department_id) !== deptId) {
          const w = (await client.query(
            `SELECT count(*)::int AS n FROM assignments a
               JOIN items i ON i.id = a.item_id
               JOIN disclosures d ON d.id = i.disclosure_id
               JOIN service_standards ss ON ss.standard_id = d.standard_id
              WHERE a.client_id = $1 AND a.department_id = $2 AND ss.service_id = $3`,
            [tenant, String(prev.client_department_id), serviceId]
          )).rows[0].n;
          if (w > 0)
            throw Object.assign(
              new Error('Cannot remap: existing assignments reference the mapped department.'),
              { statusCode: 409, code: 'match.override_blocked' }
            );
        }
        await client.query(
          `INSERT INTO dept_match_overrides (client_id, service_id, service_dept_code, client_department_id, created_by)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (client_id, service_id, service_dept_code)
           DO UPDATE SET client_department_id = EXCLUDED.client_department_id, created_by = EXCLUDED.created_by`,
          [tenant, serviceId, code, deptId, req.access!.actorId]
        );
        applied.push({ serviceId, serviceDeptCode: code, clientDeptId: deptId });
      }
      await recordAuditLog(client, {
        clientId: tenant, userId: req.access!.actorId, action: 'DEPT_MATCH_OVERRIDDEN',
        entityType: 'dept_match_overrides', payload: { clientId: tenant, mappings: applied },
      });
      return { mappings: applied };
    }, readContext);
    res.json(result);
  } catch (err: any) {
    writeFailure(res, err, 'Failed to set department matching');
  }
}

/** POST /workspace/staff/:userId/complete-password {temporaryPassword} (W-assisted).
 * Hash-only storage; must_change_password stays true (login forces rotation);
 * single-column guard: writes ONLY password_hash (+ updated_at). */
async function completeStaffPassword(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const userId = scopeId(req.params.userId, true)!;
    const temporary = req.body?.temporaryPassword;
    const check = validateSelfChosenPassword(temporary);
    if (!check.ok) { res.status(400).json({ error: check.error }); return; }
    const result = await domainTransaction(req, async (client) => {
      const tenant = consultantTenant(req.access!, req);
      await assertTenantActive(client, tenant);
      if (userId === req.access!.actorId)
        throw Object.assign(new Error('Use the login rotation flow for your own account.'), { statusCode: 403, code: 'scope.denied' });
      const cur = (await client.query(
        'SELECT id, client_id, role, must_change_password, is_active FROM users WHERE id = $1 FOR UPDATE', [userId]
      )).rows[0];
      if (!cur || cur.client_id !== tenant)
        throw Object.assign(new Error('Staff account not found in this tenant.'), { statusCode: 404 });
      if (cur.role !== 'employee' && cur.role !== 'client_admin')
        throw Object.assign(new Error('Only employee/client_admin passwords may be completed here.'), { statusCode: 403, code: 'scope.denied' });
      if (cur.must_change_password !== true || cur.is_active !== true)
        throw Object.assign(new Error('Account is not pending password completion.'), { statusCode: 409, code: 'staff.completion_refused' });
      const hash = await hashPassword(String(temporary));
      await client.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, userId]);
      await recordAuditLog(client, {
        clientId: tenant, userId: req.access!.actorId, action: 'STAFF_PASSWORD_COMPLETED',
        entityType: 'users', entityId: userId, payload: { targetUserId: userId },
      });
      return { completed: true, mustChangePassword: true };
    }, readContext);
    res.json(result);
  } catch (err: any) {
    writeFailure(res, err, 'Failed to complete staff password');
  }
}

router.post('/workspace/client-services', authMiddleware, requireFreshPassword, requireDomainAccess, linkClientService);
router.delete('/workspace/client-services/:serviceId', authMiddleware, requireFreshPassword, requireDomainAccess, unlinkClientService);
router.put('/workspace/participating-departments', authMiddleware, requireFreshPassword, requireDomainAccess, setParticipatingDepartments);
router.put('/workspace/dept-matching', authMiddleware, requireFreshPassword, requireDomainAccess, setDeptMatching);
router.post('/workspace/staff/:userId/complete-password', authMiddleware, requireFreshPassword, requireDomainAccess, completeStaffPassword);

export default router;
export { linkClientService, unlinkClientService, setParticipatingDepartments, setDeptMatching, completeStaffPassword };
