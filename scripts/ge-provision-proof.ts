// GE-only account provisioning proof (run: DATABASE_URL=... JWT_SECRET=... tsx scripts/ge-provision-proof.ts).
//
// Micro-fix: close the client direct-create bypass (04 matrix + WF-01:
// "العميل لا ينشئ حسابات" — the client NEVER creates accounts; GE provisions
// only after staff-list approval). Proves against a real Postgres harness DB:
//   A1. client_admin POST /api/users   -> 403 (bilingual, names staff-list flow)
//   A2. employee POST /api/users       -> 403 (same pointer)
//   A3. client_admin PATCH /users/:id  -> 403 (deactivation is GE-only too)
//   A4. employee PATCH /users/:id      -> 403
//   B1. ge_admin POST /api/users       -> 201 (GE path still works)
//   B2. ge_admin PATCH deactivate/reactivate -> 200 (GE path still works)
//   B3. staff submit -> approve -> OTP still works end-to-end (regression:
//       OTP once, forced-change login, change-password clears the flag)
//   C.  the 3 seeded demo users are unaffected (same roles, still active;
//       no migration needed — schema untouched, proven by listing users)
//   S.  no endpoint in this flow returns password_hash or OTP afterwards.
//
// Env required: DATABASE_URL, JWT_SECRET. Exits non-zero on first failure.
// Cleans its GEP-prefixed rows; reports residue.

import express from 'express';
import { withTenantContext, runMigrations } from '../src/db/index.ts';
import { generateToken, hashPassword } from '../src/server/auth.ts';
import apiRouter from '../src/server/routes.ts';

const RUN = `GEP${Date.now().toString(36).toUpperCase()}`;
const results: string[] = [];
const refusals: string[] = [];

function ok(line: string) {
  results.push(`PASS ${line}`);
  console.log(`PASS ${line}`);
}

function refusal(endpoint: string, actor: string, expected: string, gotStatus: number, msg: string) {
  refusals.push(`${endpoint} | ${actor} | expected ${expected} | got ${gotStatus} | ${msg}`);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for the harness proof.');
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is required for the harness proof.');

  const mig = await runMigrations();
  if (!mig.success) throw new Error(`migrations failed: ${mig.message}`);
  ok(`harness migrations applied (${RUN})`);

  const ELEVATED = { tenantId: null as string | null, role: 'ge_admin', departmentId: null, userId: null as string | null };

  // ---- seed: 1 tenant + 3 demo users (mirrors the live demo shape) ----------
  const seed = await withTenantContext(ELEVATED, async (client) => {
    const cRes = await client.query(`INSERT INTO clients (code, name) VALUES ($1, $2) RETURNING id`, [`${RUN}-T`, `${RUN} tenant`]);
    const tenantId: string = cRes.rows[0].id;
    const deptId: string = (await client.query(`INSERT INTO departments (client_id, code, name) VALUES ($1,$2,$3) RETURNING id`, [tenantId, `${RUN}-D`, `${RUN} dept`])).rows[0].id;
    const mk = async (email: string, role: string, clientId: string | null, dep: string | null) => {
      const hash = await hashPassword('SeedPass123!');
      return (await client.query(
        `INSERT INTO users (email, password_hash, name, role, client_id, department_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [email, hash, `${RUN} ${role}`, role, clientId, dep]
      )).rows[0].id as string;
    };
    const geId = await mk(`${RUN}-ge@x.test`, 'ge_admin', null, null);
    const caId = await mk(`${RUN}-ca@x.test`, 'client_admin', tenantId, null);
    const empId = await mk(`${RUN}-emp@x.test`, 'employee', tenantId, deptId);
    return { tenantId, deptId, geId, caId, empId };
  });
  ok(`seed tenant + 3 demo users (ge_admin, client_admin, employee)`);

  const T = (u: { id: string; email: string; name: string; role: any; clientId?: string | null; departmentId?: string | null }) =>
    generateToken({ id: u.id, email: u.email, name: u.name, role: u.role, clientId: u.clientId ?? null, departmentId: u.departmentId ?? null });
  const geTok = T({ id: seed.geId, email: 'g', name: 'g', role: 'ge_admin' });
  const caTok = T({ id: seed.caId, email: 'c', name: 'c', role: 'client_admin', clientId: seed.tenantId });
  const empTok = T({ id: seed.empId, email: 'e', name: 'e', role: 'employee', clientId: seed.tenantId, departmentId: seed.deptId });

  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = await new Promise<any>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const api = async (method: string, path: string, tok: string | null, body?: any) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json: json as any };
  };
  const must = (cond: boolean, line: string) => {
    if (!cond) throw new Error(`PROOF FAILED: ${line}`);
    ok(line);
  };
  const noSecrets = (obj: any) => {
    const s = JSON.stringify(obj);
    return !s.includes('password_hash') && !s.includes('oneTimePassword') && !s.includes('one_time_password');
  };
  const namesStaffFlow = (msg: string) => /staff list/i.test(msg) && /قائمة/.test(msg);

  try {
    // ---- A. negative checks --------------------------------------------------
    let r = await api('POST', '/users', caTok, {
      email: `${RUN}-bypass@x.test`, password: 'Bypass123!', name: `${RUN} bypass`,
      role: 'employee', departmentId: seed.deptId,
    });
    must(r.status === 403 && namesStaffFlow(r.json.error ?? ''), 'A1 client_admin POST /users -> 403 naming the staff-list flow');
    refusal('POST /users', 'client_admin', '403 staff-list pointer', r.status, r.json.error);

    r = await api('POST', '/users', empTok, {
      email: `${RUN}-bypass2@x.test`, password: 'Bypass123!', name: `${RUN} bypass2`,
      role: 'employee', departmentId: seed.deptId,
    });
    must(r.status === 403 && namesStaffFlow(r.json.error ?? ''), 'A2 employee POST /users -> 403 naming the staff-list flow');
    refusal('POST /users', 'employee', '403 staff-list pointer', r.status, r.json.error);

    r = await api('PATCH', `/users/${seed.empId}`, caTok, { isActive: false });
    must(r.status === 403, 'A3 client_admin PATCH /users/:id (deactivate) -> 403');
    refusal('PATCH /users/:id', 'client_admin', '403', r.status, r.json.error);

    r = await api('PATCH', `/users/${seed.caId}`, empTok, { isActive: false });
    must(r.status === 403, 'A4 employee PATCH /users/:id -> 403');
    refusal('PATCH /users/:id', 'employee', '403', r.status, r.json.error);

    // Listing stays admin-scoped (prove we did not break reads).
    r = await api('GET', '/users', caTok);
    must(r.status === 200 && Array.isArray(r.json) && r.json.length === 2, `A5 client_admin GET /users still 200 own tenant (2 rows)`);
    must(noSecrets(r.json), 'A6 user list carries no hashes/OTPs');

    // ---- B. GE paths still work ----------------------------------------------
    r = await api('POST', '/users', geTok, {
      email: `${RUN}-gecreated@x.test`, password: 'GeProv123!', name: `${RUN} ge-created`,
      role: 'employee', departmentId: seed.deptId, clientId: seed.tenantId,
    });
    must(r.status === 201 && r.json.email === `${RUN}-gecreated@x.test`.toLowerCase(), 'B1 ge_admin POST /users -> 201');
    const geCreatedId: string = r.json.id;
    must(noSecrets(r.json), 'B2 create response carries no hash');

    r = await api('PATCH', `/users/${geCreatedId}`, geTok, { isActive: false });
    must(r.status === 200 && r.json.is_active === false, 'B3 ge_admin deactivate -> 200 is_active=false');
    r = await api('PATCH', `/users/${geCreatedId}`, geTok, { isActive: true });
    must(r.status === 200 && r.json.is_active === true, 'B4 ge_admin reactivate -> 200 is_active=true');

    // ---- B/C. staff flow regression (submit -> approve -> OTP) ----------------
    const staffEmail = `${RUN}-staff@x.test`;
    r = await api('POST', '/staff-lists', caTok, { rows: [{ email: staffEmail, name: `${RUN} staff`, departmentId: seed.deptId }] });
    must(r.status === 201, 'C1 client submits staff draft -> 201');
    const listId: string = r.json.id;
    r = await api('POST', `/staff-lists/${listId}/submit`, caTok);
    must(r.status === 200 && r.json.status === 'submitted', 'C2 submit staff list -> submitted');
    r = await api('POST', `/staff-lists/${listId}/approve`, geTok);
    must(r.status === 200 && r.json.approved === true && r.json.accounts?.length === 1, 'C3 GE approve -> provisions 1 account');
    const otp: string = r.json.accounts[0].oneTimePassword;
    must(typeof otp === 'string' && otp.length >= 12, 'C4 OTP looks random (>=12 chars)');
    must(!('password_hash' in (r.json.accounts[0] ?? {})), 'C5 approval response carries no hash (hash-only storage)');

    const loginRes = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: staffEmail, password: otp }),
    });
    const loginJson: any = await loginRes.json().catch(() => ({}));
    must(loginRes.status === 200 && loginJson.mustChangePassword === true, 'C6 first login with OTP -> 200 mustChangePassword=true');
    const staffTok: string = loginJson.token;
    const chRes = await fetch(`${base}/auth/change-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${staffTok}` },
      body: JSON.stringify({ currentPassword: otp, newPassword: 'StaffNew123!' }),
    });
    must(chRes.status === 200, 'C7 change-password with OTP -> 200 (flag cleared)');
    const login2 = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: staffEmail, password: 'StaffNew123!' }),
    });
    const login2Json: any = await login2.json().catch(() => ({}));
    must(login2.status === 200 && login2Json.mustChangePassword !== true, 'C8 re-login with new password -> 200, flag cleared');

    // ---- C. existing 3 demo users unaffected ----------------------------------
    r = await api('GET', '/users', geTok);
    must(r.status === 200, 'D1 ge_admin GET /users -> 200');
    const byEmail = new Map((r.json as any[]).map((u) => [String(u.email), u]));
    for (const [email, role] of [
      [`${RUN}-ge@x.test`, 'ge_admin'],
      [`${RUN}-ca@x.test`, 'client_admin'],
      [`${RUN}-emp@x.test`, 'employee'],
    ] as const) {
      const u = byEmail.get(email);
      must(!!u && u.role === role && u.is_active === true, `D2 seed user ${role} <${email}> unchanged (role + active)`);
    }
    must(byEmail.size === 5, `D3 user count = 5 (3 seed + 1 GE-created + 1 staff-provisioned), got ${byEmail.size}`);
    must(noSecrets(r.json) && !JSON.stringify(r.json).includes(otp), 'D4 final user list leaks neither hash nor OTP');

    console.log(`\nREFUSAL TABLE (${refusals.length} rows):`);
    for (const line of refusals) console.log(`  ${line}`);
    console.log(`\nALL GE-PROVISION CHECKS PASSED (${results.length} lines)`);
  } finally {
    server.close();
    // Cleanup GEP rows (leave GRI seed + schema behind by design).
    await withTenantContext(ELEVATED, async (c) => {
      await c.query(`DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE email LIKE '${RUN}%')`).catch(() => {});
      await c.query(`DELETE FROM staff_lists WHERE id IN (SELECT sl.id FROM staff_lists sl JOIN clients cl ON cl.id = sl.client_id WHERE cl.code LIKE '${RUN}%')`).catch(() => {});
      await c.query(`DELETE FROM users WHERE email LIKE '${RUN}%'`).catch(() => {});
      await c.query(`DELETE FROM departments WHERE code LIKE '${RUN}%'`).catch(() => {});
      await c.query(`DELETE FROM clients WHERE code LIKE '${RUN}%'`).catch(() => {});
    });
    const residue = await withTenantContext(ELEVATED, async (c) => {
      const u = (await c.query(`SELECT COUNT(*)::int AS n FROM users WHERE email LIKE '${RUN}%'`)).rows[0]?.n ?? 0;
      return { users: u };
    });
    console.log(`CLEANUP residue: ${JSON.stringify(residue)}`);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err?.message ?? err);
    process.exit(1);
  }
);
