// B12 (R-01) — admin sub-router: clients, departments, users, client×service
// links, assignments, staff-list flow, GE overview, client dashboard.
// Mounted by src/server/routes.ts under the /api prefix. Moved verbatim;
// B12 wiring: requireFreshPassword on every mutating route (F-03) and S-23
// fan-out on assignment creation + staff approve/reject. New-user custom
// passwords already enforce the shared S-02 rule via validateNewUser.

import express, { type Response } from 'express';
import {
  withTenantContext,
  recordAuditLog,
} from '../../db/index.ts';
import {
  authMiddleware,
  hashPassword,
  type AuthenticatedRequest,
  type AuthUser,
} from '../auth.ts';
import { GE_ONLY_DEACTIVATE_REFUSAL, GE_ONLY_PROVISION_REFUSAL, validateNewUser } from '../../lib/tenantAccess.ts';
import { calculateAggregateScore, gateDraftEvaluations, type DashboardSourceRow } from '../../lib/scoring.ts';
import {
  assignUnassignRefusal,
  CLIENT_PROVISION_REFUSAL,
  generateOneTimePassword,
  isStaffNaReason,
  PASSWORD_CHANGE_REQUIRED_CODE,
  stripSecrets,
  unknownDepartmentRefusal,
  validateStaffListRows,
} from '../../lib/b11b.ts';
import {
  b11bRequireGeAdmin,
  b11bAssertPasswordFresh,
  b11bAssertTenantActive,
  b11bOwnTenantScope,
  contextFromUser,
  requireFreshPassword,
  isFrozenScope,
  frozenWriteError,
  notifyUsers,
  activeClientAdminIds,
  activeDepartmentUserIds,
  B16_CLIENT_ASSIGN_REFUSAL,
} from './_shared.ts';

const router = express.Router();

// ----------------------------------------------------------------------
// 7. Clients & Departments (for Administration)
// ----------------------------------------------------------------------
router.get('/clients', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;

    const rows = await withTenantContext(contextFromUser(user), async (client) => {
      let query = 'SELECT id, code, name, industry, contact_email, suspended, created_at FROM clients';
      const params: any[] = [];

      if (user.role !== 'ge_admin') {
        if (!user.clientId) {
          return [];
        }
        query += ' WHERE id = $1';
        params.push(user.clientId);
      }

      query += ' ORDER BY name ASC';
      const result = await client.query(query, params);
      return result.rows;
    });

    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/clients', authMiddleware, requireFreshPassword, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.role !== 'ge_admin') {
      return res.status(403).json({ error: 'Only platform administrators can create new client tenants.' });
    }

    const { code, name, industry, contactEmail } = req.body;
    if (!code || !name) {
      return res.status(400).json({ error: 'Client code and name are required.' });
    }

    const newClient = await withTenantContext(contextFromUser(user), async (client) => {
      const result = await client.query(
        `INSERT INTO clients (code, name, industry, contact_email)
         VALUES ($1, $2, $3, $4)
         RETURNING id, code, name, industry, contact_email, created_at`,
        [code.trim(), name.trim(), industry || null, contactEmail || null]
      );

      const created = result.rows[0];

      await recordAuditLog(client, {
        clientId: created.id,
        userId: user.id,
        action: 'CREATE_CLIENT',
        entityType: 'clients',
        entityId: created.id,
        payload: { code: created.code, name: created.name },
      });

      return created;
    });

    res.json(newClient);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to create client tenant' });
  }
});

router.get('/departments', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {  try {
    const user = req.user!;

    const rows = await withTenantContext(contextFromUser(user), async (client) => {
      let query = `SELECT d.id, d.client_id, d.code, d.name, d.description,
                          d.head_user_id, hu.name AS head_name
                   FROM departments d LEFT JOIN users hu ON hu.id = d.head_user_id`;
      const params: any[] = [];

      if (user.role !== 'ge_admin' && user.clientId) {
        query += ' WHERE d.client_id = $1';
        params.push(user.clientId);
      }

      query += ' ORDER BY d.name ASC';
      const result = await client.query(query, params);
      return result.rows;
    });

    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// B16-A1. Designate (or clear) the department head — ge_admin ONLY.
// The head must be an ACTIVE employee of that same department; client_admin
// and cross-department users are refused (the A4 gate could never admit
// them, so designation refuses them too). Pass { headUserId: null } to clear.
router.patch('/departments/:id/head', authMiddleware, requireFreshPassword, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!b11bRequireGeAdmin(user, res)) return;
    const body = req.body ?? {};
    const raw = body.headUserId === null || body.headUserId === undefined ? null : String(body.headUserId).trim();
    const headUserId: string | null = raw === '' ? null : raw;

    const updated = await withTenantContext(contextFromUser(user), async (client) => {
      await b11bAssertPasswordFresh(client, user.id);
      const deptRes = await client.query('SELECT id, client_id, code, name FROM departments WHERE id = $1', [
        req.params.id,
      ]);
      const dept = deptRes.rows[0];
      if (!dept) throw Object.assign(new Error('Department not found.'), { statusCode: 404 });

      if (headUserId !== null) {
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
        [headUserId, req.params.id]
      );
      await recordAuditLog(client, {
        clientId: dept.client_id,
        userId: user.id,
        action: headUserId ? 'DEPARTMENT_HEAD_ASSIGNED' : 'DEPARTMENT_HEAD_CLEARED',
        entityType: 'departments',
        entityId: dept.id,
        payload: { departmentCode: dept.code, headUserId },
      });
      return upd.rows[0];
    });
    res.json(updated);
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to set department head' });
  }
});

// ----------------------------------------------------------------------
// 8. Minimal User Management (FIX BATCH 4, demo only)
//
// The demo ships exactly one bootstrap account (/setup/admin is once-only),
// so admins need list (admins) + create/deactivate (GE ONLY: 04 matrix +
// WF-01 — the client NEVER creates accounts; provisioning flows through GE
// approval of a submitted staff list). Accounts are never deleted;
// deactivated logins fail closed with a human 401 (see /auth/login).
// Every write is audit-logged under the effective tenant.
// ----------------------------------------------------------------------

const SAFE_USER_COLUMNS = `
  u.id, u.email, u.name, u.role, u.is_active, u.must_change_password, u.client_id, u.department_id,
  u.created_at, c.name AS client_name, d.name AS department_name
`; // B11b: must_change_password is operational (not secret); password_hash is NEVER selected.

function requireUserAdmin(user: AuthUser, res: Response): boolean {
  if (user.role !== 'ge_admin' && user.role !== 'client_admin') {
    res.status(403).json({ error: 'Only administrators can manage users.' });
    return false;
  }
  return true;
}

// 04 matrix (تحديد أسماء الدخول + إنشاء/تعطيل حسابات = GE) + WF-01
// (العميل لا ينشئ حسابات): account WRITES are ge_admin-only. Client reads
// (GET /users) stay admin-scoped above. The staff-list reject path stays the
// client's voice; provisioning stays GE's.
function requireGeOnlyAccounts(user: AuthUser, res: Response, what: 'create' | 'activate'): boolean {
  if (user.role !== 'ge_admin') {
    res.status(403).json({ error: what === 'create' ? GE_ONLY_PROVISION_REFUSAL : GE_ONLY_DEACTIVATE_REFUSAL });
    return false;
  }
  return true;
}

// C1. List users — ge_admin: all; client_admin: own tenant.
router.get('/users', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!requireUserAdmin(user, res)) return;

    const rows = await withTenantContext(contextFromUser(user), async (client) => {
      let query = `SELECT ${SAFE_USER_COLUMNS} FROM users u
                   LEFT JOIN clients c ON u.client_id = c.id
                   LEFT JOIN departments d ON d.id = u.department_id`;
      const params: any[] = [];
      if (user.role !== 'ge_admin') {
        if (!user.clientId) return [];
        query += ' WHERE u.client_id = $1';
        params.push(user.clientId);
      }
      query += ' ORDER BY u.created_at ASC';
      const result = await client.query(query, params);
      return result.rows;
    });

    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch users' });
  }
});

// C1. Create user — ge_admin ONLY (04 matrix + WF-01). client_admin /
// employee → 403 pointing at the staff-list flow. Duplicate e-mail → 409.
// Audit-logged.
router.post('/users', authMiddleware, requireFreshPassword, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const creator = req.user!;
    if (!requireGeOnlyAccounts(creator, res, 'create')) return;

    const validation = validateNewUser(
      { id: creator.id, role: creator.role, clientId: creator.clientId ?? null },
      req.body ?? {}
    );
    if (!validation.ok) {
      return res.status(validation.status).json({ error: validation.error });
    }
    const input = validation.user;

    const created = await withTenantContext(contextFromUser(creator), async (client) => {
      // E-mail uniqueness is case-insensitive (C3 → 409).
      const dupe = await client.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [input.email]);
      if ((dupe.rowCount ?? 0) > 0) {
        throw Object.assign(new Error('A user with this email already exists.'), { statusCode: 409 });
      }

      // Target tenant must exist for tenant-scoped roles.
      if (input.effectiveClientId) {
        const tenantCheck = await client.query('SELECT id FROM clients WHERE id = $1', [input.effectiveClientId]);
        if ((tenantCheck.rowCount ?? 0) === 0) {
          throw Object.assign(new Error('Target tenant not found for the given clientId.'), { statusCode: 404 });
        }
      }

      // Employee departments must exist inside the effective tenant.
      if (input.role === 'employee' && input.departmentId) {
        const deptCheck = await client.query(
          'SELECT id, client_id FROM departments WHERE id = $1',
          [input.departmentId]
        );
        const dept = deptCheck.rows[0];
        if (!dept) {
          throw Object.assign(new Error('Department not found for the given departmentId.'), { statusCode: 404 });
        }
        if (dept.client_id !== input.effectiveClientId) {
          throw Object.assign(new Error('Department does not belong to the target tenant.'), { statusCode: 400 });
        }
      }

      const passwordHash = await hashPassword(input.password);
      let createdRow;
      try {
        const insertRes = await client.query(
          `INSERT INTO users (email, password_hash, name, role, client_id, department_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, email, name, role, is_active, client_id, department_id, created_at`,
          [input.email, passwordHash, input.name, input.role, input.effectiveClientId, input.departmentId]
        );
        createdRow = insertRes.rows[0];
      } catch (dbErr: any) {
        // Race on the unique e-mail index still surfaces as 409, never 500.
        if (dbErr?.code === '23505') {
          throw Object.assign(new Error('A user with this email already exists.'), { statusCode: 409 });
        }
        throw dbErr;
      }

      await recordAuditLog(client, {
        clientId: input.effectiveClientId,
        userId: creator.id,
        action: 'USER_CREATED',
        entityType: 'users',
        entityId: createdRow.id,
        payload: {
          actor: creator.id,
          actorRole: creator.role,
          targetTenant: input.effectiveClientId,
          createdRole: createdRow.role,
          email: createdRow.email,
        },
      });

      return createdRow;
    });

    res.status(201).json(created);
  } catch (err: any) {
    console.error('Create user error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to create user' });
  }
});

// C1. Deactivate (or reactivate) — ge_admin ONLY (04 matrix: تعطيل = GE),
// never delete. Self-deactivation is refused.
router.patch('/users/:id', authMiddleware, requireFreshPassword, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = req.user!;
    if (!requireGeOnlyAccounts(actor, res, 'activate')) return;

    const { isActive } = req.body ?? {};
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive (boolean) is required.' });
    }
    const targetId = req.params.id;
    if (targetId === actor.id) {
      return res.status(400).json({ error: 'You cannot change your own active status.' });
    }

    const updated = await withTenantContext(contextFromUser(actor), async (client) => {
      const found = await client.query(
        `SELECT ${SAFE_USER_COLUMNS} FROM users u
         LEFT JOIN clients c ON u.client_id = c.id
         LEFT JOIN departments d ON d.id = u.department_id
         WHERE u.id = $1`,
        [targetId]
      );
      const target = found.rows[0];
      // Outside the caller's tenant scope the row is simply not visible.
      if (!target) {
        throw Object.assign(new Error('User not found.'), { statusCode: 404 });
      }

      const updRes = await client.query(
        'UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING id, email, name, role, is_active, client_id, department_id, created_at',
        [isActive, targetId]
      );

      await recordAuditLog(client, {
        clientId: target.client_id,
        userId: actor.id,
        action: isActive ? 'USER_REACTIVATED' : 'USER_DEACTIVATED',
        entityType: 'users',
        entityId: targetId,
        payload: { actor: actor.id, actorRole: actor.role, targetTenant: target.client_id, isActive },
      });

      return updRes.rows[0];
    });

    res.json(updated);
  } catch (err: any) {
    console.error('Update user error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to update user' });
  }
});

// ----------------------------------------------------------------------
// FIX BATCH 11b (demo) — GE ops, client×service completion, manual assign,
// staff-list flow with OTP + forced change, client dashboard.
// (S-03/S-09/S-10/S-11/S-12/S-13, WF-01). GE-only writes where the 04
// matrix says so; client_admin submits staff drafts; employees never touch
// these endpoints. Never log passwords/OTPs (MEDIUM binding condition).
// ----------------------------------------------------------------------

// A. GE operations overview (S-03) — ge_admin only.
router.get('/ge/overview', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!b11bRequireGeAdmin(user, res)) return;
    const data = await withTenantContext(contextFromUser(user), async (client) => {
      await b11bAssertPasswordFresh(client, user.id);
      const clientsRes = await client.query(
        'SELECT id, code, name, suspended, created_at FROM clients ORDER BY name ASC'
      );
      const servicesRes = await client.query('SELECT id, code, name FROM services ORDER BY code ASC');
      const SUBMITTED = ['submitted', 'approved', 'client_approved'];
      const clients: any[] = [];
      let suspendedCount = 0;
      for (const c of clientsRes.rows) {
        if (c.suspended === true) suspendedCount++;
        const deptRes = await client.query('SELECT COUNT(*)::int AS n FROM departments WHERE client_id = $1', [c.id]);
        const userRes = await client.query('SELECT COUNT(*)::int AS n FROM users WHERE client_id = $1', [c.id]);
        const svcRes = await client.query(
          `SELECT s.id, s.code, s.name, cs.show_gap, cs.show_corrective,
                  EXISTS (SELECT 1 FROM report_settings rs WHERE rs.client_id = $1 AND rs.service_id = s.id
                          AND rs.disclosure_level IS NOT NULL AND rs.report_level IS NOT NULL) AS level_set
           FROM client_services cs JOIN services s ON s.id = cs.service_id
           WHERE cs.client_id = $1 ORDER BY s.code ASC`,
          [c.id]
        );
        const itemsRes = await client.query('SELECT COUNT(*)::int AS n FROM items', []);
        const assignRes = await client.query('SELECT COUNT(*)::int AS n FROM assignments WHERE client_id = $1', [c.id]);
        const ansRes = await client.query(
          `SELECT status, COUNT(*)::int AS n FROM answers WHERE client_id = $1 GROUP BY status`,
          [c.id]
        );
        const byStatus: Record<string, number> = {};
        for (const r of ansRes.rows) byStatus[r.status] = r.n;
        // Review numbers: same math as /dashboard/stats (drafts excluded, N/A excluded).
        const evalRes = await client.query(
          `SELECT i.id AS item_id, i.weight::float AS weight, e.score, e.not_evaluated, e.not_applicable,
                  (e.id IS NOT NULL) AS has_evaluation,
                  EXISTS (SELECT 1 FROM answers a2 WHERE a2.item_id = i.id AND a2.client_id = $1
                          AND a2.status IN ('submitted','approved','client_approved')) AS has_submitted
           FROM items i LEFT JOIN evaluations e ON e.item_id = i.id AND e.client_id = $1`,
          [c.id]
        );
        const gated = gateDraftEvaluations(
          evalRes.rows.map((row: any): DashboardSourceRow => ({
            itemId: String(row.item_id),
            weight: Number(row.weight) || 2,
            score: row.score === null || row.score === undefined ? null : (Number(row.score) as 0 | 50 | 100),
            notEvaluated: Boolean(row.not_evaluated),
            notApplicable: Boolean(row.not_applicable),
            hasEvaluation: row.has_evaluation === true,
            hasSubmittedAnswer: row.has_submitted === true,
          }))
        );
        const agg = calculateAggregateScore(gated);
        const actRes = await client.query(
          `SELECT status, COUNT(*)::int AS n FROM actions WHERE client_id = $1 GROUP BY status`,
          [c.id]
        );
        const actionsByStatus: Record<string, number> = {};
        for (const r of actRes.rows) actionsByStatus[r.status] = r.n;
        const snapRes = await client.query(
          `SELECT COUNT(*)::int AS n FROM review_snapshots WHERE client_id = $1 AND scope_type = 'tenant'`,
          [c.id]
        );
        const staffRes = await client.query(
          `SELECT status, COUNT(*)::int AS n FROM staff_lists WHERE client_id = $1 GROUP BY status`,
          [c.id]
        );
        const staffByStatus: Record<string, number> = {};
        for (const r of staffRes.rows) staffByStatus[r.status] = r.n;
        clients.push({
          id: c.id,
          code: c.code,
          name: c.name,
          suspended: c.suspended === true,
          createdAt: c.created_at,
          userCount: userRes.rows[0]?.n ?? 0,
          departmentCount: deptRes.rows[0]?.n ?? 0,
          services: svcRes.rows.map((s: any) => ({
            id: s.id,
            code: s.code,
            name: s.name,
            showGap: s.show_gap !== false,
            showCorrective: s.show_corrective !== false,
            levelSet: s.level_set === true,
          })),
          collection: {
            items: itemsRes.rows[0]?.n ?? 0,
            assignments: assignRes.rows[0]?.n ?? 0,
            answersByStatus: byStatus,
          },
          review: {
            aggregateScore: agg.aggregateScore,
            coveragePercentage: agg.coveragePercentage,
            evaluatedCount: agg.evaluatedCount,
            applicableCount: agg.applicableCount,
            notApplicableCount: agg.notApplicableCount,
            fullGapCount: agg.fullGapCount,
            partialGapCount: agg.partialGapCount,
            noGapCount: agg.noGapCount,
          },
          actions: actionsByStatus,
          staffLists: staffByStatus,
          frozen: (snapRes.rows[0]?.n ?? 0) > 0,
        });
      }
      return {
        clients,
        totals: {
          clients: clientsRes.rows.length,
          suspended: suspendedCount,
          services: servicesRes.rows.length,
          servicesCatalog: servicesRes.rows,
        },
      };
    });
    res.json(data);
  } catch (err: any) {
    if (err?.code === PASSWORD_CHANGE_REQUIRED_CODE || err?.code === 'tenant.suspended') {
      return res.status(err.statusCode || 403).json({ error: err.message, code: err.code, suspended: err.suspended });
    }
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to build GE overview' });
  }
});

// B. Client detail (GE any tenant; client roles own tenant only).
router.get('/clients/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const scope = b11bOwnTenantScope(user, req.params.id);
    if ('error' in scope) return res.status(scope.status).json({ error: scope.error });
    // Non-GE callers may only read their own tenant (the scope above already
    // pins them); GE may read any tenant by id.
    if (user.role !== 'ge_admin' && scope.clientId !== user.clientId) {
      return res.status(403).json({ error: 'Cross-tenant access is forbidden.' });
    }
    const data = await withTenantContext(contextFromUser(user), async (client) => {
      await b11bAssertPasswordFresh(client, user.id);
      const cRes = await client.query(
        'SELECT id, code, name, industry, contact_email, suspended, created_at FROM clients WHERE id = $1',
        [scope.clientId]
      );
      const tenant = cRes.rows[0];
      if (!tenant) throw Object.assign(new Error('Client not found.'), { statusCode: 404 });
      if (user.role !== 'ge_admin') await b11bAssertTenantActive(client, scope.clientId, user.role);
      const svcRes = await client.query(
        `SELECT s.id, s.code, s.name, s.description, cs.show_gap, cs.show_corrective, cs.created_at AS linked_at,
                rs.disclosure_level, rs.report_level, rs.statement_name, rs.statement_period
         FROM client_services cs JOIN services s ON s.id = cs.service_id
         LEFT JOIN report_settings rs ON rs.client_id = cs.client_id AND rs.service_id = cs.service_id
         WHERE cs.client_id = $1 ORDER BY s.code ASC`,
        [scope.clientId]
      );
      const deptRes = await client.query(
        `SELECT d.id, d.code, d.name, d.head_user_id, hu.name AS head_name
         FROM departments d LEFT JOIN users hu ON hu.id = d.head_user_id
         WHERE d.client_id = $1 ORDER BY d.name ASC`,
        [scope.clientId]
      );
      const userRes = await client.query(
        `SELECT id, email, name, role, is_active, must_change_password, department_id, created_at
         FROM users WHERE client_id = $1 ORDER BY created_at ASC`,
        [scope.clientId]
      );
      const staffRes = await client.query(
        `SELECT id, status, note, reject_reason, created_at, decided_at FROM staff_lists
         WHERE client_id = $1 ORDER BY created_at DESC`,
        [scope.clientId]
      );
      return {
        client: { ...tenant, suspended: tenant.suspended === true },
        services: svcRes.rows.map((s: any) => ({
          ...stripSecrets(s),
          showGap: s.show_gap !== false,
          showCorrective: s.show_corrective !== false,
        })),
        departments: deptRes.rows,
        users: userRes.rows.map((u: any) => stripSecrets(u)),
        staffLists: staffRes.rows,
      };
    });
    res.json(data);
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to fetch client detail' });
  }
});

// B. Suspend / unsuspend + rename (GE only). Suspended login → 200 {suspended:true}.
router.patch('/clients/:id', authMiddleware, requireFreshPassword, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!b11bRequireGeAdmin(user, res)) return;
    const body = req.body ?? {};
    const sets: string[] = [];
    const params: any[] = [];
    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) return res.status(400).json({ error: 'Client name must not be empty.' });
      params.push(name);
      sets.push(`name = $${params.length}`);
    }
    if (body.suspended !== undefined) {
      if (typeof body.suspended !== 'boolean') {
        return res.status(400).json({ error: 'suspended must be a boolean.' });
      }
      params.push(body.suspended);
      sets.push(`suspended = $${params.length}`);
    }
    if (body.industry !== undefined) {
      params.push(typeof body.industry === 'string' && body.industry.trim() ? body.industry.trim() : null);
      sets.push(`industry = $${params.length}`);
    }
    if (sets.length === 0) return res.status(400).json({ error: 'Provide name and/or suspended to update.' });
    const updated = await withTenantContext(contextFromUser(user), async (client) => {
      await b11bAssertPasswordFresh(client, user.id);
      params.push(req.params.id);
      const upd = await client.query(
        `UPDATE clients SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length}
         RETURNING id, code, name, industry, contact_email, suspended, created_at`,
        params
      );
      const row = upd.rows[0];
      if (!row) throw Object.assign(new Error('Client not found.'), { statusCode: 404 });
      await recordAuditLog(client, {
        clientId: row.id,
        userId: user.id,
        action: body.suspended === true ? 'CLIENT_SUSPENDED' : body.suspended === false ? 'CLIENT_UNSUSPENDED' : 'CLIENT_UPDATED',
        entityType: 'clients',
        entityId: row.id,
        payload: { suspended: row.suspended },
      });
      return { ...row, suspended: row.suspended === true };
    });
    res.json(updated);
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to update client' });
  }
});

// B. Client×service links (WF-01 LinkServices; S-09 flags). GE-only writes.
router.get('/clients/:id/services', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const scope = b11bOwnTenantScope(user, req.params.id);
    if ('error' in scope) return res.status(scope.status).json({ error: scope.error });
    const rows = await withTenantContext(contextFromUser(user), async (client) => {
      await b11bAssertPasswordFresh(client, user.id);
      const result = await client.query(
        `SELECT s.id, s.code, s.name, s.description, cs.show_gap, cs.show_corrective, cs.created_at AS linked_at
         FROM client_services cs JOIN services s ON s.id = cs.service_id
         WHERE cs.client_id = $1 ORDER BY s.code ASC`,
        [scope.clientId]
      );
      return result.rows.map((r: any) => ({
        ...r,
        showGap: r.show_gap !== false,
        showCorrective: r.show_corrective !== false,
      }));
    });
    res.json(rows);
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to fetch client services' });
  }
});

router.post('/clients/:id/services', authMiddleware, requireFreshPassword, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!b11bRequireGeAdmin(user, res)) return;
    const body = req.body ?? {};
    const serviceId = typeof body.serviceId === 'string' ? body.serviceId.trim() : '';
    if (!serviceId) return res.status(400).json({ error: 'serviceId is required.' });
    const showGap = body.showGap === undefined ? true : body.showGap;
    const showCorrective = body.showCorrective === undefined ? true : body.showCorrective;
    if (typeof showGap !== 'boolean' || typeof showCorrective !== 'boolean') {
      return res.status(400).json({ error: 'showGap and showCorrective must be booleans.' });
    }
    const result = await withTenantContext(contextFromUser(user), async (client) => {
      await b11bAssertPasswordFresh(client, user.id);
      const cRes = await client.query('SELECT id FROM clients WHERE id = $1', [req.params.id]);
      if (!cRes.rows[0]) throw Object.assign(new Error('Client not found.'), { statusCode: 404 });
      const sRes = await client.query('SELECT id, code FROM services WHERE id = $1', [serviceId]);
      if (!sRes.rows[0]) throw Object.assign(new Error('Service not found.'), { statusCode: 404 });
      const ins = await client.query(
        `INSERT INTO client_services (client_id, service_id, show_gap, show_corrective)
         VALUES ($1, $2, $3, $4) ON CONFLICT (client_id, service_id) DO NOTHING RETURNING *`,
        [req.params.id, serviceId, showGap, showCorrective]
      );
      const created = (ins.rowCount ?? 0) > 0;
      if (created) {
        await recordAuditLog(client, {
          clientId: req.params.id,
          userId: user.id,
          action: 'LINK_CLIENT_SERVICE',
          entityType: 'client_services',
          payload: { clientId: req.params.id, serviceId, showGap, showCorrective },
        });
      }
      const cur = await client.query(
        `SELECT s.id, s.code, s.name, cs.show_gap, cs.show_corrective FROM client_services cs
         JOIN services s ON s.id = cs.service_id WHERE cs.client_id = $1 AND cs.service_id = $2`,
        [req.params.id, serviceId]
      );
      return { linked: true, existed: !created, link: cur.rows[0] };
    });
    res.status(result.existed ? 200 : 201).json(result);
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to link service' });
  }
});

router.patch('/clients/:id/services/:serviceId', authMiddleware, requireFreshPassword, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!b11bRequireGeAdmin(user, res)) return;
    const body = req.body ?? {};
    if (body.showGap !== undefined && typeof body.showGap !== 'boolean') {
      return res.status(400).json({ error: 'showGap must be a boolean.' });
    }
    if (body.showCorrective !== undefined && typeof body.showCorrective !== 'boolean') {
      return res.status(400).json({ error: 'showCorrective must be a boolean.' });
    }
    if (body.showGap === undefined && body.showCorrective === undefined) {
      return res.status(400).json({ error: 'Provide showGap and/or showCorrective.' });
    }
    const updated = await withTenantContext(contextFromUser(user), async (client) => {
      await b11bAssertPasswordFresh(client, user.id);
      const sets: string[] = [];
      const params: any[] = [];
      if (body.showGap !== undefined) {
        params.push(body.showGap);
        sets.push(`show_gap = $${params.length}`);
      }
      if (body.showCorrective !== undefined) {
        params.push(body.showCorrective);
        sets.push(`show_corrective = $${params.length}`);
      }
      params.push(req.params.id, req.params.serviceId);
      const upd = await client.query(
        `UPDATE client_services SET ${sets.join(', ')} WHERE client_id = $${params.length - 1}
         AND service_id = $${params.length}
         RETURNING client_id, service_id, show_gap, show_corrective`,
        params
      );
      const row = upd.rows[0];
      if (!row) throw Object.assign(new Error('Client×service link not found.'), { statusCode: 404 });
      await recordAuditLog(client, {
        clientId: req.params.id,
        userId: user.id,
        action: 'UPDATE_CLIENT_SERVICE_FLAGS',
        entityType: 'client_services',
        payload: { clientId: req.params.id, serviceId: req.params.serviceId, ...body },
      });
      return { ...row, showGap: row.show_gap !== false, showCorrective: row.show_corrective !== false };
    });
    res.json(updated);
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to update client service flags' });
  }
});

router.delete('/clients/:id/services/:serviceId', authMiddleware, requireFreshPassword, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!b11bRequireGeAdmin(user, res)) return;
    const result = await withTenantContext(contextFromUser(user), async (client) => {
      await b11bAssertPasswordFresh(client, user.id);
      const del = await client.query(
        'DELETE FROM client_services WHERE client_id = $1 AND service_id = $2',
        [req.params.id, req.params.serviceId]
      );
      if ((del.rowCount ?? 0) === 0) {
        throw Object.assign(new Error('Client×service link not found.'), { statusCode: 404 });
      }
      await recordAuditLog(client, {
        clientId: req.params.id,
        userId: user.id,
        action: 'UNLINK_CLIENT_SERVICE',
        entityType: 'client_services',
        payload: { clientId: req.params.id, serviceId: req.params.serviceId },
      });
      return { unlinked: true };
    });
    res.json(result);
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to unlink service' });
  }
});

// B. Link one service to every tenant missing it (GE only, idempotent).
router.post('/services/link-all', authMiddleware, requireFreshPassword, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!b11bRequireGeAdmin(user, res)) return;
    const body = req.body ?? {};
    const serviceId = typeof body.serviceId === 'string' ? body.serviceId.trim() : '';
    if (!serviceId) return res.status(400).json({ error: 'serviceId is required.' });
    const result = await withTenantContext(contextFromUser(user), async (client) => {
      await b11bAssertPasswordFresh(client, user.id);
      const sRes = await client.query('SELECT id, code FROM services WHERE id = $1', [serviceId]);
      if (!sRes.rows[0]) throw Object.assign(new Error('Service not found.'), { statusCode: 404 });
      const ins = await client.query(
        `INSERT INTO client_services (client_id, service_id, show_gap, show_corrective)
         SELECT c.id, $1, true, true FROM clients c
         ON CONFLICT (client_id, service_id) DO NOTHING RETURNING client_id`,
        [serviceId]
      );
      await recordAuditLog(client, {
        clientId: null,
        userId: user.id,
        action: 'LINK_SERVICE_ALL_TENANTS',
        entityType: 'client_services',
        payload: { serviceId, linked: ins.rowCount ?? 0 },
      });
      return { linked: ins.rowCount ?? 0, serviceCode: sRes.rows[0].code };
    });
    res.json(result);
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to link service to all tenants' });
  }
});

// C. Manual assignment reads (admins; employees see own department only).
router.get('/assignments', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.role === 'employee' && !user.departmentId) {
      return res.status(400).json({ error: 'Your user account has no department assignment.' });
    }
    const namedClient = typeof req.query.clientId === 'string' && req.query.clientId.trim() ? req.query.clientId.trim() : null;
    const namedDept = typeof req.query.departmentId === 'string' && req.query.departmentId.trim() ? req.query.departmentId.trim() : null;
    const namedItem = typeof req.query.itemId === 'string' && req.query.itemId.trim() ? req.query.itemId.trim() : null;
    if (user.role === 'employee' && namedDept && namedDept !== user.departmentId) {
      return res.status(403).json({ error: 'Employees may only access items assigned to their own department.' });
    }
    if (namedClient && user.role !== 'ge_admin' && namedClient !== user.clientId) {
      return res.status(403).json({ error: 'Cross-tenant assignment access is forbidden.' });
    }
    const deptFilter = user.role === 'employee' ? user.departmentId! : namedDept;
    const clientFilter = user.role === 'ge_admin' ? namedClient : user.clientId;
    const rows = await withTenantContext(contextFromUser(user), async (client) => {
      await b11bAssertPasswordFresh(client, user.id);
      const params: any[] = [];
      let where = '';
      if (clientFilter) {
        params.push(clientFilter);
        where += ` AND a.client_id = $${params.length}`;
      }
      if (deptFilter) {
        params.push(deptFilter);
        where += ` AND a.department_id = $${params.length}`;
      }
      if (namedItem) {
        params.push(namedItem);
        where += ` AND a.item_id = $${params.length}`;
      }
      const result = await client.query(
        `SELECT a.id, a.client_id, a.item_id, a.department_id,
                i.code AS item_code, i.requirement,
                d.code AS department_code, d.name AS department_name,
                c.code AS client_code, c.name AS client_name, a.created_at
         FROM assignments a
         JOIN items i ON i.id = a.item_id
         JOIN departments d ON d.id = a.department_id
         JOIN clients c ON c.id = a.client_id
         WHERE 1 = 1${where}
         ORDER BY c.name ASC, d.name ASC, i.code ASC`,
        params
      );
      return result.rows;
    });
    res.json({ items: rows, count: rows.length });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to fetch assignments' });
  }
});

// C. Manual assign (S-10) — B16-B2: GE-only. Client roles read the list.
router.post('/assignments', authMiddleware, requireFreshPassword, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.role !== 'ge_admin') {
      return res.status(403).json({ error: B16_CLIENT_ASSIGN_REFUSAL });
    }
    const body = req.body ?? {};
    const itemId = typeof body.itemId === 'string' ? body.itemId.trim() : '';
    const departmentId = typeof body.departmentId === 'string' ? body.departmentId.trim() : '';
    if (!itemId) return res.status(400).json({ error: 'itemId is required.' });
    if (!departmentId) return res.status(400).json({ error: 'departmentId is required.' });
    const scope = b11bOwnTenantScope(user, body.clientId ?? user.clientId);
    if ('error' in scope) return res.status(scope.status).json({ error: scope.error });
    const result = await withTenantContext(contextFromUser(user), async (client) => {
      await b11bAssertPasswordFresh(client, user.id);
      await b11bAssertTenantActive(client, scope.clientId, user.role);
      const cRes = await client.query('SELECT id FROM clients WHERE id = $1', [scope.clientId]);
      if (!cRes.rows[0]) throw Object.assign(new Error('Target tenant not found.'), { statusCode: 404 });
      const iRes = await client.query('SELECT id, code FROM items WHERE id = $1', [itemId]);
      if (!iRes.rows[0]) throw Object.assign(new Error('Item not found.'), { statusCode: 404 });
      const dRes = await client.query('SELECT id, client_id, name FROM departments WHERE id = $1', [departmentId]);
      const dept = dRes.rows[0];
      if (!dept || dept.client_id !== scope.clientId) {
        throw Object.assign(new Error(unknownDepartmentRefusal()), { statusCode: 400 });
      }
      if (await isFrozenScope(client, scope.clientId, itemId)) throw frozenWriteError();
      const ins = await client.query(
        `INSERT INTO assignments (client_id, item_id, department_id)
         VALUES ($1, $2, $3) ON CONFLICT (client_id, item_id, department_id) DO NOTHING RETURNING id`,
        [scope.clientId, itemId, departmentId]
      );
      const created = (ins.rowCount ?? 0) > 0;
      if (created) {
        await recordAuditLog(client, {
          clientId: scope.clientId,
          userId: user.id,
          action: 'ASSIGN_ITEM',
          entityType: 'assignments',
          entityId: ins.rows[0].id,
          payload: { itemId, departmentId },
        });
        // B12 (S-23): item assigned → that department's users.
        const recipients = await activeDepartmentUserIds(client, scope.clientId, departmentId);
        await notifyUsers(client, {
          userIds: recipients,
          clientId: scope.clientId,
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
        [scope.clientId, itemId, departmentId]
      );
      return { assigned: true, existed: true, id: cur.rows[0].id };
    });
    res.status(result.existed ? 200 : 201).json(result);
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to assign item' });
  }
});

// C. Manual unassign (S-10) — B16-B2: GE-only; refused while
// answers/evaluations exist (409).
router.delete('/assignments', authMiddleware, requireFreshPassword, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.role !== 'ge_admin') {
      return res.status(403).json({ error: B16_CLIENT_ASSIGN_REFUSAL });
    }
    const body = (req.body ?? {}) as any;
    const q = req.query as any;
    const itemId = (typeof body.itemId === 'string' && body.itemId.trim()) || (typeof q.itemId === 'string' && q.itemId.trim()) || '';
    const departmentId =
      (typeof body.departmentId === 'string' && body.departmentId.trim()) ||
      (typeof q.departmentId === 'string' && q.departmentId.trim()) ||
      '';
    if (!itemId || !departmentId) return res.status(400).json({ error: 'itemId and departmentId are required.' });
    const scope = b11bOwnTenantScope(user, body.clientId ?? q.clientId ?? user.clientId);
    if ('error' in scope) return res.status(scope.status).json({ error: scope.error });
    const result = await withTenantContext(contextFromUser(user), async (client) => {
      await b11bAssertPasswordFresh(client, user.id);
      await b11bAssertTenantActive(client, scope.clientId, user.role);
      const cur = await client.query(
        'SELECT id FROM assignments WHERE client_id = $1 AND item_id = $2 AND department_id = $3',
        [scope.clientId, itemId, departmentId]
      );
      if (!cur.rows[0]) throw Object.assign(new Error('Assignment not found.'), { statusCode: 404 });
      if (await isFrozenScope(client, scope.clientId, itemId)) throw frozenWriteError();
      const ans = await client.query(
        'SELECT COUNT(*)::int AS n FROM answers WHERE client_id = $1 AND item_id = $2',
        [scope.clientId, itemId]
      );
      const ev = await client.query(
        'SELECT COUNT(*)::int AS n FROM evaluations WHERE client_id = $1 AND item_id = $2',
        [scope.clientId, itemId]
      );
      const blockers = { answers: ans.rows[0]?.n ?? 0, evaluations: ev.rows[0]?.n ?? 0 };
      if (blockers.answers + blockers.evaluations > 0) {
        throw Object.assign(new Error(assignUnassignRefusal(blockers)), { statusCode: 409 });
      }
      await client.query('DELETE FROM assignments WHERE client_id = $1 AND item_id = $2 AND department_id = $3', [
        scope.clientId,
        itemId,
        departmentId,
      ]);
      await recordAuditLog(client, {
        clientId: scope.clientId,
        userId: user.id,
        action: 'UNASSIGN_ITEM',
        entityType: 'assignments',
        payload: { itemId, departmentId },
      });
      return { unassigned: true };
    });
    res.json(result);
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to unassign item' });
  }
});

// C. N/A + reason shortcut (S-10) — B16-B2: GE-only; creates the
// evaluation row directly.
router.post('/assignments/na', authMiddleware, requireFreshPassword, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.role !== 'ge_admin') {
      return res.status(403).json({ error: B16_CLIENT_ASSIGN_REFUSAL });
    }
    const body = req.body ?? {};
    const itemId = typeof body.itemId === 'string' ? body.itemId.trim() : '';
    const departmentId = typeof body.departmentId === 'string' ? body.departmentId.trim() : '';
    const naReason = typeof body.naReason === 'string' ? body.naReason.trim() : '';
    const justification = typeof body.justification === 'string' ? body.justification.trim() : '';
    if (!itemId) return res.status(400).json({ error: 'itemId is required.' });
    if (!departmentId) return res.status(400).json({ error: 'departmentId is required.' });
    if (!isStaffNaReason(naReason)) {
      return res.status(400).json({
        error: 'naReason is required, one of: not-applicable, legal-prohibitions, confidentiality-constraints, information-unavailable-incomplete.',
      });
    }
    const scope = b11bOwnTenantScope(user, body.clientId ?? user.clientId);
    if ('error' in scope) return res.status(scope.status).json({ error: scope.error });
    const result = await withTenantContext(contextFromUser(user), async (client) => {
      await b11bAssertPasswordFresh(client, user.id);
      await b11bAssertTenantActive(client, scope.clientId, user.role);
      const asg = await client.query(
        'SELECT id FROM assignments WHERE client_id = $1 AND item_id = $2 AND department_id = $3',
        [scope.clientId, itemId, departmentId]
      );
      if (!asg.rows[0]) {
        throw Object.assign(new Error('This item is not assigned to the department.'), { statusCode: 403 });
      }
      if (await isFrozenScope(client, scope.clientId, itemId)) throw frozenWriteError();
      const existing = await client.query(
        'SELECT id FROM evaluations WHERE client_id = $1 AND item_id = $2',
        [scope.clientId, itemId]
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
        [scope.clientId, itemId, user.id, naReason, justification || null]
      );
      // Shortcut answer keeps scoring consistent (submitted so the N/A is visible, never counted).
      await client.query(
        `INSERT INTO answers (client_id, item_id, department_id, submitted_by, status, value)
         VALUES ($1, $2, $3, $4, 'submitted', $5)
         ON CONFLICT (client_id, item_id, department_id) DO UPDATE SET status = 'submitted', value = EXCLUDED.value`,
        [scope.clientId, itemId, departmentId, user.id, justification || 'N/A']
      );
      await recordAuditLog(client, {
        clientId: scope.clientId,
        userId: user.id,
        action: 'EVALUATION_NA_SHORTCUT',
        entityType: 'evaluations',
        entityId: evalIns.rows[0].id,
        payload: { itemId, departmentId, naReason },
      });
      return { evaluationId: evalIns.rows[0].id, notApplicable: true, naReason };
    });
    res.status(201).json(result);
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to mark item N/A' });
  }
});

// D. Staff lists (S-11/S-12, WF-01): drafts → submit → GE approve/reject.
router.get('/staff-lists', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.role !== 'ge_admin' && user.role !== 'client_admin') {
      return res.status(403).json({ error: 'Only administrators may view staff lists.' });
    }
    const namedClient = typeof req.query.clientId === 'string' && req.query.clientId.trim() ? req.query.clientId.trim() : null;
    if (namedClient && user.role !== 'ge_admin' && namedClient !== user.clientId) {
      return res.status(403).json({ error: 'Cross-tenant staff-list access is forbidden.' });
    }
    const tenantFilter = user.role === 'ge_admin' ? namedClient : user.clientId;
    const rows = await withTenantContext(contextFromUser(user), async (client) => {
      await b11bAssertPasswordFresh(client, user.id);
      const params: any[] = [];
      let where = '';
      if (tenantFilter) {
        params.push(tenantFilter);
        where = `WHERE sl.client_id = $${params.length}`;
      }
      const lists = await client.query(
        `SELECT sl.id, sl.client_id, sl.status, sl.note, sl.reject_reason, sl.created_at, sl.decided_at,
                c.code AS client_code, c.name AS client_name,
                sb.name AS submitted_by_name, db.name AS decided_by_name,
                (SELECT COUNT(*)::int FROM staff_list_rows r WHERE r.list_id = sl.id) AS row_count
         FROM staff_lists sl
         JOIN clients c ON c.id = sl.client_id
         LEFT JOIN users sb ON sb.id = sl.submitted_by
         LEFT JOIN users db ON db.id = sl.decided_by
         ${where} ORDER BY sl.created_at DESC`,
        params
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
    });
    res.json({ items: rows, count: rows.length });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to fetch staff lists' });
  }
});

router.post('/staff-lists', authMiddleware, requireFreshPassword, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.role !== 'ge_admin' && user.role !== 'client_admin') {
      return res.status(403).json({ error: CLIENT_PROVISION_REFUSAL });
    }
    const body = req.body ?? {};
    const scope = b11bOwnTenantScope(user, body.clientId ?? user.clientId);
    if ('error' in scope) return res.status(scope.status).json({ error: scope.error });
    const validation = validateStaffListRows(body.rows);
    if (!validation.ok) return res.status(validation.status).json({ error: validation.error });
    const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;
    const created = await withTenantContext(contextFromUser(user), async (client) => {
      await b11bAssertPasswordFresh(client, user.id);
      await b11bAssertTenantActive(client, scope.clientId, user.role);
      const cRes = await client.query('SELECT id FROM clients WHERE id = $1', [scope.clientId]);
      if (!cRes.rows[0]) throw Object.assign(new Error('Target tenant not found.'), { statusCode: 404 });
      if (await isFrozenScope(client, scope.clientId, null)) throw frozenWriteError();
      const listRes = await client.query(
        `INSERT INTO staff_lists (client_id, submitted_by, status, note)
         VALUES ($1, $2, 'draft', $3) RETURNING id, client_id, status, note, created_at`,
        [scope.clientId, user.id, note]
      );
      const listId: string = listRes.rows[0].id;
      for (const row of validation.rows) {
        let departmentId: string | null = row.departmentId;
        if (!departmentId && row.departmentName) {
          const dRes = await client.query(
            'SELECT id FROM departments WHERE client_id = $1 AND (LOWER(name) = LOWER($2) OR code = $3) LIMIT 1',
            [scope.clientId, row.departmentName, row.departmentName]
          );
          departmentId = dRes.rows[0]?.id ?? null;
        }
        if (departmentId) {
          const dCheck = await client.query('SELECT id, client_id FROM departments WHERE id = $1', [departmentId]);
          if (!dCheck.rows[0] || dCheck.rows[0].client_id !== scope.clientId) {
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
        clientId: scope.clientId,
        userId: user.id,
        action: 'STAFF_LIST_CREATED',
        entityType: 'staff_lists',
        entityId: listId,
        payload: { targetTenant: scope.clientId, rows: validation.rows.length },
      });
      return { ...listRes.rows[0], rows: validation.rows.length };
    });
    res.status(201).json(created);
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to create staff list' });
  }
});

router.post('/staff-lists/:id/submit', authMiddleware, requireFreshPassword, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.role !== 'ge_admin' && user.role !== 'client_admin') {
      return res.status(403).json({ error: CLIENT_PROVISION_REFUSAL });
    }
    const result = await withTenantContext(contextFromUser(user), async (client) => {
      await b11bAssertPasswordFresh(client, user.id);
      const cur = await client.query('SELECT * FROM staff_lists WHERE id = $1', [req.params.id]);
      const list = cur.rows[0];
      if (!list) throw Object.assign(new Error('Staff list not found.'), { statusCode: 404 });
      if (user.role !== 'ge_admin' && list.client_id !== user.clientId) {
        throw Object.assign(new Error('Cross-tenant staff-list access is forbidden.'), { statusCode: 403 });
      }
      await b11bAssertTenantActive(client, list.client_id, user.role);
      if (list.status !== 'draft') {
        throw Object.assign(new Error(`Only draft lists can be submitted (current: ${list.status}).`), { statusCode: 409 });
      }
      const nRes = await client.query('SELECT COUNT(*)::int AS n FROM staff_list_rows WHERE list_id = $1', [req.params.id]);
      if ((nRes.rows[0]?.n ?? 0) === 0) {
        throw Object.assign(new Error('Cannot submit an empty staff list.'), { statusCode: 400 });
      }
      const upd = await client.query(
        `UPDATE staff_lists SET status = 'submitted', updated_at = NOW() WHERE id = $1
         RETURNING id, client_id, status`,
        [req.params.id]
      );
      await recordAuditLog(client, {
        clientId: list.client_id,
        userId: user.id,
        action: 'STAFF_LIST_SUBMITTED',
        entityType: 'staff_lists',
        entityId: req.params.id,
        payload: { targetTenant: list.client_id },
      });
      return upd.rows[0];
    });
    res.json(result);
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to submit staff list' });
  }
});

// D. GE approve → provisions users, returns OTPs ONCE (hash-only storage).
router.post('/staff-lists/:id/approve', authMiddleware, requireFreshPassword, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!b11bRequireGeAdmin(user, res)) return;
    const result = await withTenantContext(contextFromUser(user), async (client) => {
      await b11bAssertPasswordFresh(client, user.id);
      const cur = await client.query('SELECT * FROM staff_lists WHERE id = $1', [req.params.id]);
      const list = cur.rows[0];
      if (!list) throw Object.assign(new Error('Staff list not found.'), { statusCode: 404 });
      if (list.status !== 'submitted') {
        throw Object.assign(
          new Error(`Only submitted lists can be approved (current: ${list.status}). Submit the client list first (WF-01).`),
          { statusCode: 409 }
        );
      }
      if (await isFrozenScope(client, list.client_id, null)) throw frozenWriteError();
      const rowsRes = await client.query('SELECT * FROM staff_list_rows WHERE list_id = $1 ORDER BY email ASC', [
        req.params.id,
      ]);
      if (rowsRes.rows.length === 0) {
        throw Object.assign(new Error('Cannot approve an empty staff list.'), { statusCode: 400 });
      }
      // Pre-flight: every e-mail must be unused; every department must belong
      // to the tenant. Any failure aborts the whole batch (transaction rolls
      // back — no partial provisioning).
      for (const r of rowsRes.rows) {
        const dupe = await client.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [r.email]);
        if ((dupe.rowCount ?? 0) > 0) {
          throw Object.assign(new Error(`A user with email '${r.email}' already exists.`), { statusCode: 409 });
        }
        const dCheck = await client.query('SELECT id, client_id FROM departments WHERE id = $1', [r.department_id]);
        if (!dCheck.rows[0] || dCheck.rows[0].client_id !== list.client_id) {
          throw Object.assign(new Error(unknownDepartmentRefusal()), { statusCode: 400 });
        }
      }
      const accounts: { email: string; oneTimePassword: string }[] = [];
      for (const r of rowsRes.rows) {
        const otp = generateOneTimePassword();
        const hash = await hashPassword(otp);
        const role = r.role === 'client_admin' ? 'client_admin' : 'employee';
        const deptId = role === 'employee' ? r.department_id : null;
        await client.query(
          `INSERT INTO users (email, password_hash, name, role, client_id, department_id, must_change_password, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, true, true)`,
          [String(r.email).toLowerCase(), hash, r.name, role, list.client_id, deptId]
        );
        accounts.push({ email: String(r.email).toLowerCase(), oneTimePassword: otp });
      }
      await client.query(
        `UPDATE staff_lists SET status = 'approved', decided_by = $1, decided_at = NOW(), updated_at = NOW()
         WHERE id = $2`,
        [user.id, req.params.id]
      );
      await recordAuditLog(client, {
        clientId: list.client_id,
        userId: user.id,
        action: 'STAFF_LIST_APPROVED',
        entityType: 'staff_lists',
        entityId: req.params.id,
        // Binding: never log OTPs or hashes — only counts + e-mails.
        payload: { targetTenant: list.client_id, provisioned: accounts.length, emails: accounts.map((a) => a.email) },
      });
      // B12 (S-23): staff approved → the submitter.
      if (list.submitted_by) {
        await notifyUsers(client, {
          userIds: [list.submitted_by],
          clientId: list.client_id,
          type: 'staff.approved',
          title: 'Staff list approved — accounts provisioned',
          titleAr: 'تمت الموافقة على قائمة الموظفين — تم إنشاء الحسابات',
          body: `${accounts.length} account(s) provisioned. One-time passwords were returned to the approver only.`,
          bodyAr: `تم إنشاء ${accounts.length} حساب. تمت إعادة كلمات المرور لمرة واحدة إلى المعتمد فقط.`,
          entityType: 'staff_lists',
          entityId: req.params.id,
        });
      }
      return { approved: true, accounts };
    });
    // OTPs leave the API exactly once, in this response. No other endpoint
    // returns password_hash or OTPs (proven by the harness + unit tests).
    res.json(result);
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to approve staff list' });
  }
});

router.post('/staff-lists/:id/reject', authMiddleware, requireFreshPassword, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!b11bRequireGeAdmin(user, res)) return;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason) return res.status(400).json({ error: 'A rejection reason is required.' });
    const result = await withTenantContext(contextFromUser(user), async (client) => {
      await b11bAssertPasswordFresh(client, user.id);
      const cur = await client.query('SELECT * FROM staff_lists WHERE id = $1', [req.params.id]);
      const list = cur.rows[0];
      if (!list) throw Object.assign(new Error('Staff list not found.'), { statusCode: 404 });
      if (list.status !== 'submitted') {
        throw Object.assign(new Error(`Only submitted lists can be rejected (current: ${list.status}).`), {
          statusCode: 409,
        });
      }
      const upd = await client.query(
        `UPDATE staff_lists SET status = 'rejected', reject_reason = $1, decided_by = $2, decided_at = NOW(), updated_at = NOW()
         WHERE id = $3 RETURNING id, client_id, status, reject_reason`,
        [reason, user.id, req.params.id]
      );
      await recordAuditLog(client, {
        clientId: list.client_id,
        userId: user.id,
        action: 'STAFF_LIST_REJECTED',
        entityType: 'staff_lists',
        entityId: req.params.id,
        payload: { targetTenant: list.client_id, reason },
      });
      // B12 (S-23): staff rejected → the submitter.
      if (list.submitted_by) {
        await notifyUsers(client, {
          userIds: [list.submitted_by],
          clientId: list.client_id,
          type: 'staff.rejected',
          title: 'Staff list rejected',
          titleAr: 'تم رفض قائمة الموظفين',
          body: `Reason: ${reason}`,
          bodyAr: `السبب: ${reason}`,
          entityType: 'staff_lists',
          entityId: req.params.id,
        });
      }
      return upd.rows[0];
    });
    res.json(result);
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to reject staff list' });
  }
});

// E. Client dashboard (S-13): own tenant only, same scoring math (drafts
// excluded, N/A excluded, coverage beside every score). Suspended → no data.
router.get('/client/dashboard', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.role !== 'client_admin' && user.role !== 'ge_admin') {
      return res.status(403).json({ error: 'Only client administrators may view the client dashboard.' });
    }
    const scope = b11bOwnTenantScope(user, req.query.clientId ?? user.clientId);
    if ('error' in scope) return res.status(scope.status).json({ error: scope.error });
    if (user.role !== 'ge_admin' && scope.clientId !== user.clientId) {
      return res.status(403).json({ error: 'Client administrators may only view their own tenant dashboard.' });
    }
    const data = await withTenantContext(contextFromUser(user), async (client) => {
      await b11bAssertPasswordFresh(client, user.id);
      const cRes = await client.query('SELECT id, code, name, suspended FROM clients WHERE id = $1', [scope.clientId]);
      const tenant = cRes.rows[0];
      if (!tenant) throw Object.assign(new Error('Client not found.'), { statusCode: 404 });
      const suspended = tenant.suspended === true;
      if (suspended && user.role !== 'ge_admin') {
        return { suspended: true as const, message: 'This tenant is suspended. Contact the platform administrator.' };
      }
      const svcRes = await client.query(
        `SELECT s.id, s.code, s.name, cs.show_gap, cs.show_corrective FROM client_services cs
         JOIN services s ON s.id = cs.service_id WHERE cs.client_id = $1 ORDER BY s.code ASC`,
        [scope.clientId]
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
        [scope.clientId]
      );
      const gated = gateDraftEvaluations(
        evalRes.rows.map((row: any): DashboardSourceRow => ({
          itemId: String(row.item_id),
          weight: Number(row.weight) || 2,
          score: row.score === null || row.score === undefined ? null : (Number(row.score) as 0 | 50 | 100),
          notEvaluated: Boolean(row.not_evaluated),
          notApplicable: Boolean(row.not_applicable),
          hasEvaluation: row.has_evaluation === true,
          hasSubmittedAnswer: row.has_submitted === true,
        }))
      );
      const agg = calculateAggregateScore(gated);
      // Per-department breakdown (same weighted rule, drafts excluded).
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
        [scope.clientId]
      );
      const buckets = new Map<string, { departmentId: string; departmentName: string; weightedSum: number; weightTotal: number; evaluated: number; applicable: number }>();
      const SUBMITTED = ['submitted', 'approved', 'client_approved'];
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
        if (!r.answer_status || !SUBMITTED.includes(r.answer_status)) continue;
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
        tenant: { id: tenant.id, code: tenant.code, name: tenant.name },
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
    });
    res.json(data);
  } catch (err: any) {
    if (err?.code === PASSWORD_CHANGE_REQUIRED_CODE) {
      return res.status(403).json({ error: err.message, code: err.code });
    }
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to build client dashboard' });
  }
});

export default router;
