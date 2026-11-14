// B17 U2-F ROUND 2 — §3.4 PROVISIONING rows 6 (POST /users), 7 (PATCH
// /users/:id) and 23 (POST /staff-lists/:id/approve).
//
// R2-B (Shield): all three now run the ONE platform configuration context
// (platformConfigContext(req, T) with an explicit validated clientId),
// never the legacy purpose-NULL contextFromUser — under which users INSERT was
// denied outright (b17_bootstrap is auth.bootstrap-only and forbids a
// department), users UPDATE was denied (b17_users_lock is auth.*-only), the
// audit INSERT was denied and the dupe pre-check read only the actor's own row.
// SHIELD-U2F-01 round-2 extension in b17-content.sql adds the users
// INSERT/UPDATE row scope + the USER_*/STAFF_LIST_APPROVED audit rows.
//
// R2-A LOCK ORDER (parent §15, handler-side only, b17.sql NOT writable): the
// deactivation takes the TARGET user's auth_sessions ... FOR UPDATE BEFORE the
// users UPDATE, so b17_revoke_inactive's own FOR UPDATE re-enters rows this
// transaction already holds instead of acquiring them for the first time.
// Without it the trigger (users row lock -> sessions lock) can deadlock against
// a concurrent request (sessions FOR SHARE -> users FOR SHARE). auth_sessions
// row visibility for the lock is reached exactly the way b17_revoke_inactive
// reaches it: a transaction-local GUC switch to actor=target + purpose
// 'auth.revoke' (server-set literals, restored immediately after the lock — the
// row lock itself survives the restore until commit). No auth_sessions policy
// is added, no request can select the purpose, b17.sql untouched.
//
// R2-C: every catch routes through _shared writeFailure (E3-02); console.error
// stays server-side only (evaluations readFailure precedent).
// OTP-once (row 23): the one-time passwords leave the API in THIS response
// exactly once, are never logged, never stored plaintext (hash-only) and are
// never re-read — no other endpoint returns them (proved in b17-domain-f3.ts).

import type { Response } from 'express';
import type pg from 'pg';
import { setTenantContext, recordAuditLog } from '../../db/index.ts';
import { hashPassword, type AuthenticatedRequest } from '../auth.ts';
import { withWorkspace, assertRouteContext, assertRouteActivated } from '../access.ts';
import { classifyRoute } from '../accessRegistry.ts';
import { validateNewUser } from '../../lib/tenantAccess.ts';
import {
  generateOneTimePassword,
  unknownDepartmentRefusal,
} from '../../lib/b11b.ts';
import {
  frozenWriteError,
  isFrozenScope,
  notifyUsers,
  platformConfigContext,
  writeFailure,
} from './_shared.ts';
import { SAFE_USER_COLUMNS, assertTenantExists, platformTarget } from './adminCommon.ts';
import { scopeError, scopeId } from '../scope.ts';

/** Same locked boundary as U2-D: live session -> live tab/generation -> matrix
 * -> platformConfigContext on ONE client, held through mutation/audit/commit.
 * Never authorize a write using only the earlier middleware attachment. */
async function configurationTransaction<T>(req: AuthenticatedRequest, target: string,
  operation: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const route = classifyRoute(req.method, req.path);
  if (!route) throw scopeError(404, 'api.not_found');
  assertRouteActivated(route);
  return withWorkspace(req, route.capability, async (client, _identity, _tab, access) => {
    req.access = access;
    assertRouteContext(route, access);
    await setTenantContext(client, platformConfigContext(req, target));
    return operation(client);
  });
}

function explicitTarget(req: AuthenticatedRequest): string {
  const target = platformTarget(req.body?.clientId);
  if (req.query.clientId !== undefined && scopeId(req.query.clientId, true) !== target)
    throw scopeError(403, 'scope.tenant_mismatch');
  return target;
}

/** §3.4 row 6 — explicit-T tenant provisioning only. A tenant-less platform
 * account is not a P@T operation; the bootstrap/platform-account flow is not
 * activated by this handler. All resource checks run inside the locked txn. */
export async function createUser(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const target = explicitTarget(req);
    const creator = req.user!;
    const validation = validateNewUser(
      { id: creator.id, role: creator.role, clientId: creator.clientId ?? null },
      req.body ?? {}
    );
    if (!validation.ok) { res.status(validation.status).json({ error: validation.error }); return; }
    const input = validation.user;
    if (input.effectiveClientId !== target) throw scopeError(403, 'scope.tenant_mismatch');
    if (input.departmentId) scopeId(input.departmentId, true);
    const created = await configurationTransaction(req, target, async (client) => {
      // E-mail uniqueness is case-insensitive inside the target tenant (C3 -> 409).
      const dupe = await client.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [input.email]);
      if ((dupe.rowCount ?? 0) > 0) {
        throw Object.assign(new Error('A user with this email already exists.'), { statusCode: 409 });
      }
      await assertTenantExists(client, target);
      if (input.role === 'employee' && input.departmentId) {
        const dept = (await client.query(
          'SELECT id, client_id FROM departments WHERE id = $1', [input.departmentId])).rows[0];
        if (!dept) {
          // Existing targetless department metadata policy distinguishes a
          // foreign department from a missing one; same client/locks, restored
          // before any write (never a separate context-free transaction).
          await setTenantContext(client, platformConfigContext(req, null));
          const foreign = (await client.query('SELECT 1 FROM departments WHERE id=$1', [input.departmentId])).rowCount;
          await setTenantContext(client, platformConfigContext(req, target));
          if (foreign) throw scopeError(403, 'scope.tenant_mismatch');
          throw Object.assign(new Error('Department not found for the given departmentId.'), { statusCode: 404 });
        }
        if (dept.client_id !== input.effectiveClientId) throw scopeError(403, 'scope.tenant_mismatch');
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
        // Global users.email UNIQUE: cross-tenant (or racing) duplicates still
        // surface as 409, never 500.
        if (dbErr?.code === '23505') {
          throw Object.assign(new Error('A user with this email already exists.'), { statusCode: 409 });
        }
        throw dbErr;
      }

      await recordAuditLog(client, {
        clientId: input.effectiveClientId,
        userId: req.access!.actorId,
        action: 'USER_CREATED',
        entityType: 'users',
        entityId: createdRow.id,
        payload: {
          actor: req.access!.actorId,
          actorRole: req.access!.role,
          targetTenant: input.effectiveClientId,
          createdRole: createdRow.role,
          email: createdRow.email,
        },
      });
      return createdRow;
    });

    res.status(201).json(created);
  } catch (err: any) {
    writeFailure(res, err, 'Failed to create user');
  }
}

/** §3.4 row 7 — P@T deactivation/reactivation (never delete), self-refusal
 * kept, and the §3(2) lock order: sessions FOR UPDATE before the users UPDATE.
 * A user outside T is invisible under the target context -> 404 (wrong-T 404,
 * same ring as the round-1 head-designation probe). */
export async function deactivateUser(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const body = req.body ?? {};
    const isActive = body.isActive;
    if (typeof isActive !== 'boolean') {
      res.status(400).json({ error: 'isActive (boolean) is required.' });
      return;
    }
    const targetId = scopeId(req.params.id, true)!;
    if (targetId === req.access!.actorId) {
      res.status(400).json({ error: 'You cannot change your own active status.' });
      return;
    }
    const target = explicitTarget(req);

    const updated = await configurationTransaction(req, target, async (client) => {
      const found = await client.query(
        `SELECT ${SAFE_USER_COLUMNS} FROM users u
         LEFT JOIN clients c ON u.client_id = c.id
         LEFT JOIN departments d ON d.id = u.department_id
         WHERE u.id = $1`,
        [targetId]
      );
      const row = found.rows[0];
      if (!row) throw Object.assign(new Error('User not found.'), { statusCode: 404 });

      // ---- LOCK ORDER (parent §15): auth_sessions ... FOR UPDATE FIRST ----
      // GUC dance identical to b17_revoke_inactive: actor=target + purpose
      // 'auth.revoke' (transaction-local literals, server-set only) so both
      // session policies admit the rows, lock them, then restore — the row
      // locks stay held until commit and the users UPDATE below can never race
      // a concurrent request's sessions->users lock order into 40P01.
      const prior = await client.query(
        "SELECT current_setting('app.current_actor_id', true) AS actor, current_setting('app.current_purpose', true) AS purpose"
      );
      await client.query(
        "SELECT set_config('app.current_actor_id', $1, true), set_config('app.current_purpose', 'auth.revoke', true)",
        [targetId]
      );
      await client.query('SELECT sid FROM auth_sessions WHERE user_id = $1 ORDER BY sid FOR UPDATE', [targetId]);
      await client.query(
        'SELECT set_config($1, $2, true), set_config($3, $4, true)',
        ['app.current_actor_id', String(prior.rows[0]?.actor ?? ''), 'app.current_purpose', String(prior.rows[0]?.purpose ?? '')]
      );
      // ---- lock held; back in the platform configuration context ----

      const updRes = await client.query(
        'UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING id, email, name, role, is_active, client_id, department_id, created_at',
        [isActive, targetId]
      );

      await recordAuditLog(client, {
        clientId: row.client_id,
        userId: req.access!.actorId,
        action: isActive ? 'USER_REACTIVATED' : 'USER_DEACTIVATED',
        entityType: 'users',
        entityId: targetId,
        payload: { actor: req.access!.actorId, actorRole: req.access!.role, targetTenant: row.client_id, isActive },
      });
      return updRes.rows[0];
    });
    res.json(updated);
  } catch (err: any) {
    writeFailure(res, err, 'Failed to update user');
  }
}

/** §3.4 row 23 — approve a submitted staff list under explicit T: all-or-
 * nothing (one transaction; every failure rolls the batch back), OTP once in
 * this response only, no provisioning for W/C/E (matrix), cross-T 403
 * (target context hides a foreign list; the NULL-target read distinguishes it
 * from a nonexistent one). */
export async function approveStaffList(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const listId = scopeId(req.params.id, true)!;
    const target = explicitTarget(req);
    const result = await configurationTransaction(req, target, async (client) => {
      const cur = await client.query(
        'SELECT id, client_id, status, submitted_by FROM staff_lists WHERE id = $1 AND client_id = $2 FOR UPDATE',
        [listId, target]
      );
      const list = cur.rows[0];
      if (!list) {
        await setTenantContext(client, platformConfigContext(req, null));
        const foreign = (await client.query('SELECT 1 FROM staff_lists WHERE id=$1 AND client_id<>$2', [listId, target])).rowCount;
        await setTenantContext(client, platformConfigContext(req, target));
        if (foreign) throw scopeError(403, 'scope.tenant_mismatch');
        throw Object.assign(new Error('Staff list not found.'), { statusCode: 404 });
      }
      if (list.status !== 'submitted') {
        throw Object.assign(
          new Error(`Only submitted lists can be approved (current: ${list.status}). Submit the client list first (WF-01).`),
          { statusCode: 409 }
        );
      }
      if (await isFrozenScope(client, list.client_id, null)) throw frozenWriteError();
      const rowsRes = await client.query(
        'SELECT id, email, name, department_id, department_name, role FROM staff_list_rows WHERE list_id = $1 ORDER BY email ASC',
        [listId]
      );
      if (rowsRes.rows.length === 0) {
        throw Object.assign(new Error('Cannot approve an empty staff list.'), { statusCode: 400 });
      }
      // Pre-flight: every e-mail must be unused; every department must belong
      // to the tenant. Any failure aborts the WHOLE batch (the transaction
      // rolls back — no partial provisioning; proved in b17-domain-f3.ts with a
      // case-collision that only fails on the second INSERT).
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
        try {
          await client.query(
            `INSERT INTO users (email, password_hash, name, role, client_id, department_id, must_change_password, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, true, true)`,
            [String(r.email).toLowerCase(), hash, r.name, role, list.client_id, deptId]
          );
        } catch (dbErr: any) {
          // In-batch collision on the lower-cased address (and any other race):
          // 409 with the same message; the transaction rollback above means the
          // accounts inserted before this point disappear too.
          if (dbErr?.code === '23505') {
            throw Object.assign(new Error(`A user with email '${String(r.email).toLowerCase()}' already exists.`), { statusCode: 409 });
          }
          throw dbErr;
        }
        accounts.push({ email: String(r.email).toLowerCase(), oneTimePassword: otp });
      }
      await client.query(
        `UPDATE staff_lists SET status = 'approved', decided_by = $1, decided_at = NOW(), updated_at = NOW()
         WHERE id = $2`,
        [req.access!.actorId, listId]
      );
      await recordAuditLog(client, {
        clientId: list.client_id,
        userId: req.access!.actorId,
        action: 'STAFF_LIST_APPROVED',
        entityType: 'staff_lists',
        entityId: listId,
        // Binding: never log OTPs or hashes — only counts + e-mails.
        payload: { targetTenant: list.client_id, provisioned: accounts.length, emails: accounts.map((a) => a.email) },
      });
      // B12 (S-23): staff approved → the submitter, but ONLY when that
      // submitter is a member of this tenant (the notifications row scope
      // refuses a foreign recipient — the reject row's round-1 guard).
      if (list.submitted_by) {
        const recipient = await client.query(
          'SELECT id FROM users WHERE id = $1 AND client_id = $2',
          [list.submitted_by, list.client_id]
        );
        if (recipient.rows[0]) {
          await notifyUsers(client, {
            userIds: [list.submitted_by],
            clientId: list.client_id,
            type: 'staff.approved',
            title: 'Staff list approved — accounts provisioned',
            titleAr: 'تمت الموافقة على قائمة الموظفين — تم إنشاء الحسابات',
            body: `${accounts.length} account(s) provisioned. One-time passwords were returned to the approver only.`,
            bodyAr: `تم إنشاء ${accounts.length} حساب. تمت إعادة كلمات المرور لمرة واحدة إلى المعتمد فقط.`,
            entityType: 'staff_lists',
            entityId: listId,
          });
        }
      }
      return { approved: true, accounts };
    });
    // OTPs leave the API exactly once, in this response. No other endpoint
    // returns password_hash or OTPs (proved by b17-domain-f3.ts).
    res.json(result);
  } catch (err: any) {
    writeFailure(res, err, 'Failed to approve staff list');
  }
}
