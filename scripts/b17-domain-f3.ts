// B17 U2-F ROUND 2 (final) proof — the THREE §3.4 PROVISIONING rows end-to-end:
// 6 POST /users, 7 PATCH /users/:id, 23 POST /staff-lists/:id/approve.
// node --import tsx scripts/b17-domain-f3.ts --allow-disposable-b17
//   --database-url=<loopback named b17_*scratch* DB> --oracle-url=<same-DB postgres>
//
// Guards byte-identical to b17-domain-f1.ts. NON-DESTRUCTIVE: fixtures are
// INSERT-only before activation; the only rows removed are removed by nothing
// (deactivate/reactivate flips a flag and restores it; the case-collision batch
// rolls back inside its own transaction).
//
// Coverage disclosed (NOT an independent review): exact 3 -> 0 flip truth;
// every row's P@T positive + cross-T/wrong-context/MALFORMED refusals through
// the real dispatcher -> requireDomainAccess -> platformConfigContext -> handler
// chain; §3(2) lock order (source-order pin + CONCURRENT deactivate vs a live
// session request: no deadlock, revoke visible, retry succeeds); deactivate
// revokes sessions (old bearer 401) + self-refusal with sessions untouched;
// OTP-once (displayed in the approve response only, never stored plaintext,
// never re-read, approve-again 409 issues nothing) + all-or-nothing rollback
// (a case-colliding batch inserts NOTHING); readiness drift -> refusal ->
// recovery against the NEW users/audit policies; E3-02 source pin for this
// unit's provisioning catches; exact census deltas. MUST-FIX 1/2/4 live in f1/f2
// and the Shield-2 column pin + lock-order source pin live in routeGates.test.ts.

import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import express from 'express';
import cookieParser from 'cookie-parser';
import pg from 'pg';
import path from 'node:path';
import { getPool, runMigrations, withTenantContext } from '../src/db/index.ts';
import {
  applyB17Offline, assertB17Ready, verifyB17Content, STRUCTURE_SQL, B17_CONTENT_SHAPE,
} from '../src/db/b17Readiness.ts';
import { inventoryB17ContentOffline, applyB17ContentOffline } from '../src/db/b17ContentMigration.ts';
import { LEGACY_ROUTES } from '../src/server/accessRegistry.ts';
import { activeBusinessCapabilities } from '../src/lib/capabilities.ts';
import { hashPassword } from '../src/server/auth.ts';
import { comparePassword } from '../src/server/auth.ts';
import { hashTab } from '../src/server/access.ts';
import { assertAuthorityHeldAtInsert, changeTabBetweenWrapperAndTransaction,
  concurrentRequestAndDeactivation, failDeactivationAudit } from './b17-domain-f-lock-proof.ts';
import { seedDomainD } from './b17-domain-d-fixture.ts';
import apiRouter from '../src/server/routes.ts';
import { jsonInput } from '../src/server/jsonInput.ts';
import { globalJsonErrorHandler } from '../src/server/errorHandler.ts';

let oracleUrl = '';
let oracleClient: pg.Client | undefined;
function guardedUrl(args: string[]): string {
  if (!args.includes('--allow-disposable-b17')) throw new Error('Explicit disposable B17 opt-in required.');
  const urls = args.filter(arg => arg.startsWith('--database-url='));
  if (urls.length !== 1) throw new Error('One explicit scratch database URL required; ambient URL is ignored.');
  if (existsSync('.env') || process.env.DATABASE_URL || process.env.JWT_SECRET)
    throw new Error('Refusing ambient .env / DATABASE_URL / JWT_SECRET.');
  const url = new URL(urls[0].slice('--database-url='.length));
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || !/^\/b17_[a-z0-9_]*scratch[a-z0-9_]*$/.test(url.pathname) || url.search || url.hash
    || !url.username || url.username === 'postgres') throw new Error('Only named disposable loopback B17 owner database accepted.');
  const oracleArgs = args.filter(arg => arg.startsWith('--oracle-url='));
  if (oracleArgs.length !== 1) throw new Error('One explicit same-scratch oracle URL required.');
  const oracle = new URL(oracleArgs[0].slice('--oracle-url='.length));
  if (oracle.protocol !== url.protocol || oracle.hostname !== url.hostname || oracle.port !== url.port
    || oracle.pathname !== url.pathname || oracle.username !== 'postgres' || oracle.search || oracle.hash)
    throw new Error('Oracle must target the exact same loopback scratch as the app URL.');
  oracleUrl = oracle.toString();
  return url.toString();
}
process.env.DATABASE_URL = guardedUrl(process.argv.slice(2));
process.env.JWT_SECRET = randomBytes(48).toString('hex');
process.env.B17_SCRATCH_OPT_IN = 'YES';
const pass = (label: string) => console.log(`PASS ${label}`);

const PROVISIONING3 = ['POST /users', 'PATCH /users/:id', 'POST /staff-lists/:id/approve'];

async function main() {
  const pool = getPool();
  const role = (await pool.query(`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`)).rows[0];
  assert.deepEqual(role, { rolsuper: false, rolbypassrls: false }, 'runtime role must be NOSUPERUSER/NOBYPASSRLS');
  assert.equal(Math.floor(Number((await pool.query('SHOW server_version_num')).rows[0].server_version_num) / 10000), 18);
  assert.equal((await pool.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0);
  assert.equal((await runMigrations()).success, true);
  oracleClient = new pg.Client({ connectionString: oracleUrl });
  await oracleClient.connect();
  const count = async (table: string) =>
    (await oracleClient!.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n as number;

  const seed = await seedDomainD();
  const { tenants: t, departments: d, users: u, services: s } = seed;
  // Fixtures (INSERT-only, BEFORE activation/census):
  //  - provoke: an active employee of A with a live session (lock-order +
  //    revoke->401 probes), deactivated and REACTIVATED during the run;
  //  - dupeList: a submitted staff list whose two rows collide only AFTER
  //    lowercasing ('f2dupe' / 'F2DUPE') — passes every pre-flight check and
  //    fails on the SECOND insert -> proves the all-or-nothing rollback.
  const fixtures = await withTenantContext({ role: 'ge_admin' }, async c => {
    const hash = await hashPassword(seed.password);
    const provoke = (await c.query(
      `INSERT INTO users(email,password_hash,name,role,client_id,department_id)
       VALUES($1,$2,'provoke','employee',$3,$4) RETURNING id`,
      ['provoke@u2f.invalid', hash, t.A, d.A])).rows[0].id as string;
    const list = (await c.query(
      `INSERT INTO staff_lists(client_id,submitted_by,status,note) VALUES($1,$2,'submitted','f3-dupe')
       RETURNING id`, [t.A, u.cA])).rows[0].id as string;
    for (const email of ['f2dupe@u2f.invalid', 'F2DUPE@u2f.invalid']) {
      await c.query(
        `INSERT INTO staff_list_rows(list_id,email,name,department_id,department_name,role)
         VALUES($1,$2,$3,$4,'One','employee')`, [list, email, 'Dupe Row', d.A]);
    }
    return { provoke, list };
  });

  const admin = await pool.connect();
  try {
    assert.equal(await applyB17Offline(admin), 'applied');
    const inventory = await inventoryB17ContentOffline(admin, seed.targets, seed.sources);
    assert.equal(await applyB17ContentOffline(admin, inventory, seed.sources), 'applied');
  } finally { admin.release(); }
  await assertB17Ready();
  assert.equal((await pool.query(STRUCTURE_SQL)).rows[0].checksum, B17_CONTENT_SHAPE,
    'the NEW users/audit policies are inside the content fingerprint');
  assert.equal((await pool.query(`SELECT count(*)::int n FROM pg_class WHERE relnamespace='public'::regnamespace
    AND relrowsecurity AND NOT relforcerowsecurity`)).rows[0].n, 0, 'every RLS table must be FORCE');
  pass('guards: loopback scratch opt-in, NOSUPERUSER/NOBYPASSRLS PG18, empty start, seed-only, offline U1+content green, FORCE RLS');

  // ---- Registry: the final 3 -> 0 flip ----
  const byKey = new Map(LEGACY_ROUTES.map(r => [`${r.method} ${r.path}`, r]));
  assert.equal(LEGACY_ROUTES.filter(r => r.activation === 'UNACTIVATED').length, 0, '3 -> 0 UNACTIVATED');
  assert.equal(LEGACY_ROUTES.filter(r => r.activation === 'U1').length, 95, '92 -> 95 U1');
  for (const k of PROVISIONING3) assert.equal(byKey.get(k)?.activation, 'U1', `${k} must be activated`);
  assert.deepEqual([...activeBusinessCapabilities()],
    ['taxonomy', 'gri', 'evaluations', 'admin', 'actions', 'initiatives', 'reports', 'storage', 'audit', 'notifications'],
    'capabilities truthful (10) after the final flip');
  pass('R1 registry truth: provisioning triple activated (3 -> 0), 95 U1, capabilities truthful');

  // ---- E3-02 source pin for this unit's provisioning catches ----
  const provSrc = readFileSync(path.resolve('src/server/routes/adminProvisioning.ts'), 'utf8');
  const provCatches = (provSrc.match(/catch \(err: any\) \{/g) ?? []).length;
  assert.equal((provSrc.match(/writeFailure\(res, err,/g) ?? []).length, provCatches,
    'every provisioning write catch routes through writeFailure');
  assert.ok(!/res\.status\([^)]*\)\.json\(\s*\{\s*error:\s*err\??\.message/.test(provSrc),
    'no provisioning catch echoes err.message (runtime mask proved in f1)');
  pass(`E3-02 source pin: ${provCatches}/${provCatches} provisioning catches masked`);

  // ---- HTTP contexts ----
  const app = express();
  app.use(jsonInput); app.use(cookieParser()); app.use('/api', apiRouter); app.use(globalJsonErrorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  type Cx = { token: string; tabHandle?: string; generation?: number };
  const contexts: Record<string, Cx | undefined> = {};
  const raw = async (who: string, method: string, path_: string, body?: unknown) => {
    const ctx = contexts[who];
    const headers: Record<string, string> = {};
    if (ctx?.token) headers.Authorization = `Bearer ${ctx.token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (ctx?.tabHandle) { headers['X-Workspace-Tab'] = ctx.tabHandle;
      headers['X-Workspace-Version'] = String(ctx.generation); }
    const res = await fetch(base + path_, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await res.text();
    let data: any; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, text };
  };
  try {
    const login = async (email: string) => {
      const r = await raw('anon', 'POST', '/auth/login', { email, password: seed.password });
      assert.equal(r.status, 200, `${email} login: ${r.text.slice(0, 200)}`);
      return r.data.token as string;
    };
    const post = async (who: string, path_: string, body: unknown) => {
      const ctx = contexts[who]!;
      const res = await fetch(base + path_, { method: 'POST',
        headers: { Authorization: `Bearer ${ctx.token}`, 'Content-Type': 'application/json',
          ...(ctx.tabHandle ? { 'X-Workspace-Tab': ctx.tabHandle, 'X-Workspace-Version': String(ctx.generation) } : {}) },
        body: JSON.stringify(body) });
      return { status: res.status, data: await res.json() };
    };
    contexts.P = { token: await login('ge@domain-d.invalid') };
    const pTab = (await post('P', '/workspace/tab', {})).data;
    contexts.P.tabHandle = pTab.tabHandle; contexts.P.generation = pTab.generation;
    contexts.P2 = { token: await login('ge@domain-d.invalid') };
    const p2Tab = (await post('P2', '/workspace/tab', {})).data;
    contexts.P2.tabHandle = p2Tab.tabHandle; contexts.P2.generation = p2Tab.generation;
    contexts.W = { token: await login('ge@domain-d.invalid') };
    const wTab = (await post('W', '/workspace/tab', {})).data;
    contexts.W.tabHandle = wTab.tabHandle; contexts.W.generation = wTab.generation;
    const entered = await post('W', '/workspace/enter', { clientId: t.A });
    assert.equal(entered.status, 200, JSON.stringify(entered.data));
    contexts.W.generation = entered.data.generation as number;
    contexts.C = { token: await login('cA@domain-d.invalid') };
    contexts.E = { token: await login('eA@domain-d.invalid') };
    contexts.provoke = { token: await login('provoke@u2f.invalid') };
    pass('contexts: P (platform), W (consultant A), C, E + the provoke employee session');

    // Post-fixture baseline for the exact final census (STRICT tables only;
    // audit_log/notifications/auth_sessions/workspace_tabs may only grow).
    const baseline: Record<string, number> = {};
    for (const table of ['clients', 'departments', 'users', 'client_services', 'assignments', 'answers',
      'evaluations', 'approvals', 'staff_lists', 'staff_list_rows', 'review_snapshots'])
      baseline[table] = await count(table);

    const deniedContexts = async (method: string, path_: string, body: unknown) => {
      for (const who of ['W', 'C', 'E']) {
        const r = await raw(who, method, path_, body);
        assert.deepEqual([r.status, r.data.code], [403, 'workspace.mode_mismatch'],
          `${who} ${method} ${path_} must be refused by the §3 matrix`);
      }
    };

    // ================= row 6: POST /users (P@T provisioning) =================
    const users0 = await count('users');
    await deniedContexts('POST', '/users',
      { clientId: t.A, email: 'w-denied@u2f.invalid', name: 'X', role: 'employee', departmentId: d.A, password: seed.password });
    const noT = await raw('P', 'POST', '/users',
      { email: 'not@u2f.invalid', name: 'X', role: 'employee', departmentId: d.A, password: seed.password });
    assert.equal(noT.status, 400, noT.text.slice(0, 200));
    assert.equal(noT.data.code, 'scope.id_required', 'every provisioning call demands explicit T');
    const crossDept = await raw('P', 'POST', '/users',
      { clientId: t.A, email: 'crossdept@u2f.invalid', name: 'X', role: 'employee', departmentId: d.B, password: seed.password });
    assert.deepEqual([crossDept.status, crossDept.data.code], [403, 'scope.tenant_mismatch'],
      `cross-T department => 403 scope.tenant_mismatch: ${crossDept.text.slice(0, 200)}`);
    const noDept = await raw('P', 'POST', '/users',
      { clientId: t.A, email: 'nodept@u2f.invalid', name: 'X', role: 'employee', departmentId: randomUUID(), password: seed.password });
    assert.equal(noDept.status, 404, `nonexistent department => 404: ${noDept.text.slice(0, 200)}`);
    assert.equal(await count('users'), users0, 'every refused POST /users minted nothing');
    const authority = (await oracleClient!.query('SELECT id,session_id FROM workspace_tabs WHERE handle_hash=$1',
      [hashTab(contexts.P.tabHandle!)])).rows[0];
    const stale = await changeTabBetweenWrapperAndTransaction(contexts.P.tabHandle!, async () => {
      const changed = await raw('P', 'POST', '/workspace/enter', { clientId: t.A });
      assert.equal(changed.status, 200, changed.text);
      contexts.P!.generation = changed.data.generation;
    }, () => raw('P', 'POST', '/users', { clientId: t.A, email: 'stale@u2f.invalid', name: 'Stale',
      role: 'employee', departmentId: d.A, password: seed.password }));
    assert.deepEqual([stale.status, stale.data.code], [409, 'workspace.stale']);
    assert.equal(await count('users'), users0, 'transition after wrapper minted nothing');
    const exited = await raw('P', 'POST', '/workspace/exit', {}); assert.equal(exited.status, 200, exited.text);
    contexts.P.generation = exited.data.generation;
    const created = await assertAuthorityHeldAtInsert(oracleUrl, authority.session_id, authority.id,
      'r2emp@u2f.invalid', () => raw('P', 'POST', '/users',
      { clientId: t.A, email: 'r2emp@u2f.invalid', name: 'R2 Employee', role: 'employee',
        departmentId: d.A, password: seed.password }));
    assert.equal(created.status, 201, created.text.slice(0, 300));
    assert.equal(created.data.client_id, t.A, 'the account belongs to the explicit target T');
    const dupe = await raw('P', 'POST', '/users',
      { clientId: t.A, email: 'r2emp@u2f.invalid', name: 'Again', role: 'employee', departmentId: d.A, password: seed.password });
    assert.deepEqual([dupe.status, dupe.data.error], [409, 'A user with this email already exists.'],
      `duplicate email => 409: ${dupe.text.slice(0, 200)}`);
    // A targetless GE creation is NOT a P@T operation (no implicit branch).
    const ge = await raw('P', 'POST', '/users',
      { email: 'r2ge@u2f.invalid', name: 'R2 GE', role: 'ge_admin', password: seed.password });
    assert.deepEqual([ge.status, ge.data.code], [400, 'scope.id_required']);
    const userAudit = (await oracleClient!.query(
      `SELECT count(*)::int n FROM audit_log WHERE action='USER_CREATED'
         AND payload->>'targetTenant' = $1`, [t.A])).rows[0].n as number;
    assert.ok(userAudit >= 1, 'USER_CREATED audit rows exist under the explicit target');
    const geAudit = (await oracleClient!.query(
      `SELECT count(*)::int n FROM audit_log WHERE action='USER_CREATED' AND client_id IS NULL`)).rows[0].n as number;
    assert.equal(geAudit, 0, 'no NULL-client provisioning audit');
    assert.equal(await count('users'), users0 + 1, 'exactly the accepted P@T creation');
    pass('row 6 POST /users: P@T serves + audit, W/C/E 403, no-T/targetless-GE 400, cross-T dept 403, no-dept 404, dupe 409');
    pass('live transaction proof: wrapper->tab transition409/users+0; session+tab locks still held at INSERT');

    // ================= row 7: PATCH /users/:id (lock order + revoke) =================
    await deniedContexts('PATCH', `/users/${u.cA}`, { isActive: false, clientId: t.A });
    const noTargetT = await raw('P', 'PATCH', `/users/${fixtures.provoke}`, { isActive: false });
    assert.deepEqual([noTargetT.status, noTargetT.data.code], [400, 'scope.id_required'],
      'P@T deactivation demands the explicit target');
    const malformed = await raw('P', 'PATCH', '/users/not-a-uuid', { isActive: false, clientId: t.A });
    assert.deepEqual([malformed.status, malformed.data.code], [400, 'scope.id_invalid'],
      'malformed user id is 400 BEFORE any SQL');
    const self = await raw('P', 'PATCH', `/users/${u.ge}`, { isActive: false, clientId: t.A });
    assert.equal(self.status, 400, self.text.slice(0, 200));
    assert.match(String(self.data.error), /own active status/i, 'self-deactivation refused');
    const crossUser = await raw('P', 'PATCH', `/users/${u.cB}`, { isActive: false, clientId: t.A });
    assert.equal(crossUser.status, 404, `a user outside T is invisible (wrong-T 404): ${crossUser.text.slice(0, 200)}`);
    const revokedBefore = (await oracleClient!.query(
      'SELECT count(*)::int n FROM auth_sessions WHERE user_id=$1 AND revoked_at IS NOT NULL',
      [fixtures.provoke])).rows[0].n as number;
    assert.equal(revokedBefore, 0, 'the provoke session starts live');

    // CONCURRENCY (parent §15): deactivate vs a live session request. Both lock
    // auth_sessions -> users in the SAME order, so this must never surface a
    // 40P01 deadlock; the request either finishes first (200) or lands after the
    // revoke (401).
    const { writer: deactR, reader: liveR } = await concurrentRequestAndDeactivation(oracleUrl, fixtures.provoke,
      () => raw('provoke', 'GET', '/auth/me'),
      () => raw('P', 'PATCH', `/users/${fixtures.provoke}`, { isActive: false, clientId: t.A }));
    assert.ok(!/deadlock|40P01/i.test(deactR.text + liveR.text),
      `no deadlock in concurrent deactivate+request: ${deactR.text.slice(0, 150)} | ${liveR.text.slice(0, 150)}`);
    assert.equal(deactR.status, 200, `deactivate succeeds: ${deactR.text.slice(0, 200)}`);
    assert.ok([200, 401].includes(liveR.status), `live request resolves 200 or 401, saw ${liveR.status}`);
    const revokedAfter = (await oracleClient!.query(
      'SELECT count(*)::int n FROM auth_sessions WHERE user_id=$1 AND revoked_at IS NOT NULL',
      [fixtures.provoke])).rows[0].n as number;
    assert.ok(revokedAfter > revokedBefore, 'the deactivation revoked the target sessions');
    const oldBearer = await raw('provoke', 'GET', '/auth/me');
    assert.equal(oldBearer.status, 401, `old bearer => 401 after revoke: ${oldBearer.text.slice(0, 150)}`);
    const reactivate = await raw('P', 'PATCH', `/users/${fixtures.provoke}`, { isActive: true, clientId: t.A });
    assert.equal(reactivate.status, 200, reactivate.text.slice(0, 200));
    const relogin = await raw('anon', 'POST', '/auth/login', { email: 'provoke@u2f.invalid', password: seed.password });
    assert.equal(relogin.status, 200, `retry succeeds after reactivate: ${relogin.text.slice(0, 200)}`);
    assert.ok(relogin.data.token, 'reactivation restores login');
    contexts.provoke = { token: relogin.data.token };
    const failedAudit = await failDeactivationAudit(fixtures.provoke,
      () => raw('P', 'PATCH', `/users/${fixtures.provoke}`, { isActive: false, clientId: t.A }));
    assert.deepEqual([failedAudit.status, failedAudit.data], [500, { error: 'Failed to update user' }]);
    assert.equal((await oracleClient!.query('SELECT is_active FROM users WHERE id=$1', [fixtures.provoke])).rows[0].is_active, true);
    assert.equal((await raw('provoke', 'GET', '/auth/me')).status, 200,
      'post-UPDATE audit failure rolled back BOTH user status and trigger session revocation');
    const retried = await raw('P', 'PATCH', `/users/${fixtures.provoke}`, { isActive: false, clientId: t.A });
    assert.equal(retried.status, 200, retried.text);
    assert.equal((await raw('provoke', 'GET', '/auth/me')).status, 401);
    assert.equal((await raw('P', 'PATCH', `/users/${fixtures.provoke}`, { isActive: true, clientId: t.A })).status, 200);
    // Self-refusal touched no session (rollback-safety of the rejected path).
    const revokedAfterSelf = (await oracleClient!.query(
      'SELECT count(*)::int n FROM auth_sessions WHERE user_id=$1 AND revoked_at IS NOT NULL',
      [u.ge])).rows[0].n as number;
    assert.equal(revokedAfterSelf, 0, 'the refused self-deactivation revoked nothing');
    pass('row 7 PATCH /users/:id: explicit T required, malformed 400, self 400, cross-T 404; concurrent deactivate+request NO deadlock, sessions revoked, old bearer 401, reactivate+retry green');

    // ============ row 23: POST /staff-lists/:id/approve (OTP-once) ============
    await deniedContexts('POST', `/staff-lists/${fixtures.list}/approve`, { clientId: t.A });
    const missingT = await raw('P', 'POST', `/staff-lists/${fixtures.list}/approve`, {});
    assert.deepEqual([missingT.status, missingT.data.code], [400, 'scope.id_required'],
      'approve demands the explicit P@T target');
    const crossList = await raw('P', 'POST', `/staff-lists/${fixtures.list}/approve`, { clientId: t.B });
    assert.deepEqual([crossList.status, crossList.data.code], [403, 'scope.tenant_mismatch'],
      `cross-T list => 403 scope.tenant_mismatch: ${crossList.text.slice(0, 200)}`);
    const ghost = await raw('P', 'POST', `/staff-lists/${randomUUID()}/approve`, { clientId: t.A });
    assert.equal(ghost.status, 404, `nonexistent list => 404: ${ghost.text.slice(0, 200)}`);

    // Draft -> submit (C, existing rows 21/22) -> approve with OTP-once.
    const draft = await raw('C', 'POST', '/staff-lists',
      { clientId: t.A, rows: [{ email: 'r2otp@u2f.invalid', name: 'R2 OTP', departmentId: d.A, role: 'employee' }] });
    assert.equal(draft.status, 201, draft.text.slice(0, 300));
    const submitted = await raw('C', 'POST', `/staff-lists/${draft.data.id}/submit`);
    assert.equal(submitted.status, 200, submitted.text.slice(0, 200));
    const usersBeforeApprove = await count('users');
    const approvals = await Promise.all(['P', 'P2'].map(who =>
      raw(who, 'POST', `/staff-lists/${draft.data.id}/approve`, { clientId: t.A })));
    assert.deepEqual(approvals.map(r => r.status).sort(), [200, 409], 'concurrent approval: only ONE response issues OTP');
    const approve = approvals.find(r => r.status === 200)!;
    assert.equal(approve.status, 200, approve.text.slice(0, 300));
    assert.equal(approve.data.approved, true);
    const accounts = approve.data.accounts as { email: string; oneTimePassword: string }[];
    assert.equal(accounts.length, 1, 'one account provisioned');
    const otp = accounts[0].oneTimePassword;
    assert.ok(otp && otp.length >= 6, 'the OTP is delivered in the approve response');
    assert.equal(await count('users'), usersBeforeApprove + 1, 'exactly one account created');
    const provisioned = (await oracleClient!.query(
      `SELECT u.must_change_password, u.password_hash, u.is_active FROM users u WHERE u.email='r2otp@u2f.invalid'`))
      .rows[0];
    assert.equal(provisioned.must_change_password, true, 'OTP flow forces the password change');
    assert.equal(provisioned.is_active, true);
    assert.notEqual(provisioned.password_hash, otp, 'the OTP itself is never stored (hash only)');
    assert.equal(await comparePassword(otp, provisioned.password_hash), true, 'the delivered OTP verifies against its hash');
    const persisted = (await oracleClient!.query(`SELECT
      (SELECT to_jsonb(u) FROM users u WHERE email='r2otp@u2f.invalid') u,
      (SELECT to_jsonb(s) FROM staff_lists s WHERE id=$1) list,
      (SELECT jsonb_agg(to_jsonb(r)) FROM staff_list_rows r WHERE list_id=$1) rows`, [draft.data.id])).rows[0];
    assert.ok(!JSON.stringify(persisted).includes(otp), 'plaintext OTP absent from every persisted provisioning row');
    // OTP-once: the value appears ONLY in that one response — never in any
    // later read, never in the audit payload, and a repeat approve issues none.
    const laterReads = [
      await raw('P', 'GET', `/staff-lists?clientId=${t.A}`),
      await raw('P', 'GET', `/clients/${t.A}`),
      await raw('P', 'GET', '/users?clientId=' + t.A),
    ];
    for (const r of laterReads) {
      assert.ok(!r.text.includes(otp), `OTP must never be re-readable: ${r.status} ${r.text.slice(0, 120)}`);
      assert.ok(!/oneTimePassword|"otp"/i.test(r.text), 'no OTP field in any later read');
    }
    const approvedAudit = (await oracleClient!.query(
      `SELECT payload::text AS p FROM audit_log WHERE action='STAFF_LIST_APPROVED' AND entity_id=$1`,
      [draft.data.id])).rows;
    assert.ok(approvedAudit.length === 1 && !approvedAudit[0].p.includes(otp),
      'the approval audit payload carries no OTP');
    const repeat = await raw('P', 'POST', `/staff-lists/${draft.data.id}/approve`, { clientId: t.A });
    assert.equal(repeat.status, 409, `approve-again => 409: ${repeat.text.slice(0, 200)}`);
    assert.ok(!repeat.text.includes(otp), 'approve-again issues nothing');
    const notif = (await oracleClient!.query(
      `SELECT count(*)::int n FROM notifications WHERE type='staff.approved' AND user_id=$1`, [u.cA]))
      .rows[0].n as number;
    assert.ok(notif >= 1, 'the in-tenant submitter was notified (membership-guarded fan-out)');

    // ---- all-or-nothing: the case-colliding batch inserts NOTHING ----
    const usersBeforeDupe = await count('users');
    const batch = await raw('P', 'POST', `/staff-lists/${fixtures.list}/approve`, { clientId: t.A });
    assert.equal(batch.status, 409, `colliding batch => 409: ${batch.text.slice(0, 250)}`);
    assert.match(String(batch.data.error), /already exists/i);
    assert.equal(await count('users'), usersBeforeDupe,
      'all-or-nothing: the first insert of the batch rolled back with the second');
    const listAfter = (await oracleClient!.query('SELECT status FROM staff_lists WHERE id=$1', [fixtures.list])).rows[0];
    assert.equal(listAfter.status, 'submitted', 'the failed approval left the list submitted (rollback)');
    pass('row 23 approve: P@T serves with OTP ONCE (hash-only, never re-read), cross-T 403, ghost 404, W/C/E 403, colliding batch rolls back entirely');

    // ---- readiness drift -> refusal -> recovery on the NEW policies ----
    const drift = await pool.connect();
    try {
      await drift.query('BEGIN');
      await drift.query('DROP POLICY b17_admin_users_insert ON users');
      await assert.rejects(() => verifyB17Content(drift), /schema_drift/,
        'dropping a round-2 policy must be refused by the fingerprint');
      await drift.query('ROLLBACK');
    } catch (err) { await drift.query('ROLLBACK').catch(() => {}); throw err; }
    finally { drift.release(); }
    await assertB17Ready();
    pass('readiness: the new users/audit policies are fingerprinted — DROP => schema_drift, rollback => recovery green');

    // ---- exact census deltas vs the post-fixture baseline ----
    const STRICT = ['clients', 'departments', 'users', 'client_services', 'assignments', 'answers',
      'evaluations', 'approvals', 'staff_lists', 'staff_list_rows', 'review_snapshots'];
    const EXPECTED: Record<string, number> = {
      users: 2,          // row 6 employee + row 23 approve (explicit T only)
      staff_lists: 1,    // C draft for the OTP flow
      staff_list_rows: 1,
    };
    const deltas: Record<string, number> = {};
    for (const table of STRICT) {
      deltas[table] = (await count(table)) - baseline[table];
      assert.equal(deltas[table], EXPECTED[table] ?? 0,
        `${table} delta must be exactly ${EXPECTED[table] ?? 0}, saw ${deltas[table]}`);
    }
    const auditRows = (await oracleClient!.query('SELECT count(*)::int n FROM audit_log')).rows[0].n as number;
    assert.ok(auditRows > 0, 'audit_log is append-only and carried the provisioning rows');
    await assertB17Ready();
    pass(`census: expected deltas only (${JSON.stringify(deltas)}) + audit grew + readiness green`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
  console.log('B17 U2-F round-2 proof complete: 3 provisioning rows E2E + 3 -> 0 exact; NOT release acceptance.');
}
main().catch(err => { console.error('B17_U2F_F3 proof FAILED:', err instanceof Error ? (err.stack || err.message) : err); process.exitCode = 1; })
  .finally(async () => { await oracleClient?.end().catch(() => {}); await getPool().end(); });
