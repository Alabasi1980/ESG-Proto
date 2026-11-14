// B17 U2-F round 1 proof (part 1) — the 22 NON-provisioning §3.4 admin rows
// through the REAL dispatcher -> requireDomainAccess -> server-selected context
// -> scope predicate -> handler chain, under FORCE RLS as a non-bypass owner.
// node --import tsx scripts/b17-domain-f1.ts --allow-disposable-b17
//   --database-url=<loopback named b17_*scratch* DB>
//
// Guards: explicit --allow opt-in, one named loopback b17_*scratch* owner URL,
// non-superuser/non-BYPASSRLS runtime role, PG18, empty start, no ambient
// .env/DATABASE_URL, seed-only fixtures (no business-row DELETE outside rows
// this proof itself creates — the assignment/clients it adds are removed only
// through the very routes under test).
//
// Coverage disclosed (NOT an independent review): the exact final flip truth
// (25 -> 3 -> 0 — the provisioning triple's positive/negative E2E lives in
// b17-domain-f3.ts together with its lock-order/OTP proofs), all 22 non-
// provisioning rows' §3 allowed contexts served AND every disallowed context
// refused 403 workspace.mode_mismatch (88 probes, serve-set cross-checked
// against the registry matrix), MUST-FIX 1 (W/C users[] field strip) and
// MUST-FIX 4 (link-all confirm:true gate), E3-02 write-catch masking (raw PG
// collapsed, own status/message pass), no implicit services/assessments on
// tenant creation, non-destructive census with an explicit expected-delta map,
// readiness green.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import express from 'express';
import cookieParser from 'cookie-parser';
import pg from 'pg';
import { getPool, runMigrations, withTenantContext } from '../src/db/index.ts';
import { applyB17Offline, assertB17Ready, STRUCTURE_SQL, B17_CONTENT_SHAPE } from '../src/db/b17Readiness.ts';
import { inventoryB17ContentOffline, applyB17ContentOffline } from '../src/db/b17ContentMigration.ts';
import { LEGACY_ROUTES } from '../src/server/accessRegistry.ts';
import { activeBusinessCapabilities } from '../src/lib/capabilities.ts';
import { hashPassword } from '../src/server/auth.ts';
import { seedDomainD } from './b17-domain-d-fixture.ts';
import apiRouter from '../src/server/routes.ts';
import { jsonInput } from '../src/server/jsonInput.ts';
import { globalJsonErrorHandler } from '../src/server/errorHandler.ts';

// The SAME scratch, second connection as the ORACLE for row counts/censuses:
// under FORCE RLS the app pool (even as table owner) sees zero tenant rows
// without a server-selected context, so a delta measured there would be
// vacuous. The oracle is loopback+same-DB+postgres superuser (BYPASSRLS) and
// is used for COUNTS ONLY — every API assertion still goes through the app.
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
  if (oracleArgs.length !== 1) throw new Error('One explicit same-scratch oracle URL required (RLS hides row counts from the app pool).');
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

const FLIPPED22 = ['GET /clients', 'POST /clients', 'GET /departments', 'PATCH /departments/:id/head',
  'GET /users', 'GET /ge/overview', 'GET /clients/:id', 'PATCH /clients/:id',
  'GET /clients/:id/services', 'POST /clients/:id/services',
  'PATCH /clients/:id/services/:serviceId', 'DELETE /clients/:id/services/:serviceId',
  'POST /services/link-all', 'GET /assignments', 'POST /assignments', 'DELETE /assignments',
  'POST /assignments/na', 'GET /staff-lists', 'POST /staff-lists', 'POST /staff-lists/:id/submit',
  'POST /staff-lists/:id/reject', 'GET /client/dashboard'];
const PROVISIONING3 = ['POST /users', 'PATCH /users/:id', 'POST /staff-lists/:id/approve'];
const CONTEXTS = ['P', 'W', 'C', 'E'] as const;
type Ctx = typeof CONTEXTS[number];

/** One §3 row probe: `serve` must equal the row's registry matrix contexts. */
interface Probe {
  row: string; method: string; serve: readonly Ctx[]; expect: number;
  path: (c: Ctx) => string; body?: (c: Ctx) => unknown; after?: (c: Ctx, data: any) => void;
}

async function main() {
  const pool = getPool();
  const role = (await pool.query(`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`)).rows[0];
  assert.deepEqual(role, { rolsuper: false, rolbypassrls: false }, 'runtime role must be NOSUPERUSER/NOBYPASSRLS');
  assert.equal(Math.floor(Number((await pool.query('SHOW server_version_num')).rows[0].server_version_num) / 10000), 18);
  assert.equal((await pool.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0,
    'Scratch must start empty; never reset or replay an existing application DB.');
  assert.equal((await runMigrations()).success, true);

  const seed = await seedDomainD();
  const { tenants: t, departments: d, users: u, services: s } = seed;
  // Fixtures (INSERT-only, before activation): one department employee of B so
  // the P@T assignment fan-out has a real recipient, and one retained assignment
  // in A for the W-only N/A shortcut (row 19).
  const fx = await withTenantContext({ role: 'ge_admin' }, async c => {
    const hash = await hashPassword(seed.password);
    const empB = (await c.query(`INSERT INTO users(email,password_hash,name,role,client_id,department_id)
      VALUES($1,$2,'f1-b','employee',$3,$4) RETURNING id`,
      [`f1-b@u2f.invalid`, hash, t.B, d.B])).rows[0].id;
    const actionItem = (await c.query("SELECT id FROM items WHERE code='D-ACTION-ONLY'")).rows[0].id;
    await c.query('INSERT INTO assignments(client_id,item_id,department_id) VALUES($1,$2,$3)', [t.A, actionItem, d.A]);
    return { empB, actionItem };
  });

  const admin = await pool.connect();
  try {
    assert.equal(await applyB17Offline(admin), 'applied');
    const inventory = await inventoryB17ContentOffline(admin, seed.targets, seed.sources);
    assert.equal(await applyB17ContentOffline(admin, inventory, seed.sources), 'applied');
    assert.equal(await applyB17ContentOffline(admin, inventory, seed.sources), 'verified');
  } finally { admin.release(); }
  await assertB17Ready();
  assert.equal((await pool.query(STRUCTURE_SQL)).rows[0].checksum, B17_CONTENT_SHAPE,
    'effective catalog must equal the content-version structure/authority fingerprint');
  assert.equal((await pool.query(`SELECT count(*)::int n FROM pg_class WHERE relnamespace='public'::regnamespace
    AND relrowsecurity AND NOT relforcerowsecurity`)).rows[0].n, 0, 'every RLS table must be FORCE');
  pass('guards: loopback scratch opt-in, NOSUPERUSER/NOBYPASSRLS PG18, empty start, seed-only, offline U1+content green, FORCE RLS');

  // ---- R1 registry truth: the final flip (25 -> 3 -> 0) ----
  const byKey = new Map(LEGACY_ROUTES.map(r => [`${r.method} ${r.path}`, r]));
  assert.equal(LEGACY_ROUTES.length, 95);
  assert.equal(LEGACY_ROUTES.filter(r => r.activation === 'UNACTIVATED').length, 0, '25 -> 3 -> 0 UNACTIVATED');
  assert.equal(LEGACY_ROUTES.filter(r => r.activation === 'U1').length, 95, '70 -> 92 -> 95 U1');
  for (const k of FLIPPED22) assert.equal(byKey.get(k)?.activation, 'U1', `${k} must be activated`);
  for (const k of PROVISIONING3) assert.equal(byKey.get(k)?.activation, 'U1',
    `${k} activated in round 2 behind the R2-A substrate + lock-order proof (E2E in f3)`);
  const remaining = LEGACY_ROUTES.filter(r => r.activation === 'UNACTIVATED').map(r => `${r.method} ${r.path}`);
  assert.deepEqual(remaining, [], 'zero UNACTIVATED legacy rows after U2-F round 2');
  assert.deepEqual([...activeBusinessCapabilities()],
    ['taxonomy', 'gri', 'evaluations', 'admin', 'actions', 'initiatives', 'reports', 'storage', 'audit', 'notifications'],
    'activeBusinessCapabilities() is truthful after the final U2-F flips');
  pass('R1 registry truth: all 25 §3.4 rows flipped (25 -> 3 -> 0), matrix data untouched, capabilities truthful (10)');

  // ---- Non-destructive census with an explicit expected-delta map (oracle) ----
  oracleClient = new pg.Client({ connectionString: oracleUrl });
  await oracleClient.connect();
  const count = async (table: string) => (await oracleClient!.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n as number;
  const CENSUS_TABLES = ['clients', 'departments', 'users', 'client_services', 'service_standards', 'standards',
    'disclosures', 'items', 'assignments', 'answers', 'evaluations', 'approvals', 'staff_lists', 'staff_list_rows',
    'review_snapshots', 'snapshot_notes', 'actions', 'esg_profile', 'report_settings', 'client_initiatives'];
  const census = async () => { const out: Record<string, number> = {};
    for (const table of CENSUS_TABLES) out[table] = await count(table); return out; };
  const before = await census();

  // ---- Real HTTP contexts: P (platform tab), W (consultant A), C, CB, E ----
  const app = express();
  app.use(jsonInput); app.use(cookieParser()); app.use('/api', apiRouter); app.use(globalJsonErrorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  type Cx = { token: string; tabHandle?: string; generation?: number };
  const contexts: Record<Ctx, Cx | undefined> = { P: undefined!, W: undefined!, C: undefined!, E: undefined! };
  const raw = async (who: Ctx | 'anon', method: string, path: string, body?: unknown) => {
    const ctx = contexts[who as Ctx];
    const headers: Record<string, string> = {};
    if (ctx?.token) headers.Authorization = `Bearer ${ctx.token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (ctx?.tabHandle) { headers['X-Workspace-Tab'] = ctx.tabHandle;
      headers['X-Workspace-Version'] = String(ctx.generation); }
    const res = await fetch(base + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
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
    const post = async (token: string, path: string, body: unknown, tab?: { tabHandle: string; generation: number }) => {
      const res = await fetch(base + path, { method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
          ...(tab ? { 'X-Workspace-Tab': tab.tabHandle, 'X-Workspace-Version': String(tab.generation) } : {}) },
        body: JSON.stringify(body) });
      return { status: res.status, data: await res.json() };
    };
    contexts.P = { token: await login('ge@domain-d.invalid') };
    const pTab = (await post(contexts.P.token, '/workspace/tab', {})).data;
    contexts.P.tabHandle = pTab.tabHandle; contexts.P.generation = pTab.generation;
    contexts.W = { token: await login('ge@domain-d.invalid') };
    const wTab = (await post(contexts.W.token, '/workspace/tab', {})).data;
    contexts.W.tabHandle = wTab.tabHandle; contexts.W.generation = wTab.generation;
    const entered = await post(contexts.W.token, '/workspace/enter', { clientId: t.A }, wTab);
    assert.equal(entered.status, 200, JSON.stringify(entered.data));
    contexts.W.generation = entered.data.generation as number;
    contexts.C = { token: await login('cA@domain-d.invalid') };
    contexts.E = { token: await login('eA@domain-d.invalid') };
    pass('real login + workspace tab/enter produce P (platform), W (consultant A), C and E contexts');

    const made: Record<string, string> = {};
    // "never automatic" (§3.4 row 15): the explicit bulk service has zero links until this round calls it.
    assert.equal((await oracleClient!.query('SELECT count(*)::int n FROM client_services WHERE service_id = $1', [s.UNLINKED])).rows[0].n, 0,
      'no startup/backfill link may exist before the explicit POST /services/link-all');
    // MUST-FIX 4 (round-2 ruling): the bulk link needs an explicit confirm:true.
    const noConfirm = await raw('P', 'POST', '/services/link-all', { serviceId: s.UNLINKED });
    assert.equal(noConfirm.status, 400, noConfirm.text.slice(0, 200));
    assert.match(String(noConfirm.data.error), /confirm/i, 'link-all refuses without { confirm: true }');
    assert.equal((await oracleClient!.query('SELECT count(*)::int n FROM client_services WHERE service_id = $1', [s.UNLINKED])).rows[0].n, 0,
      'the refused call inserted nothing');
    // ---- The 22 §3 rows: allowed contexts served, every other context refused ----
    const probes: Probe[] = [
      { row: 'GET /clients', method: 'GET', serve: ['P', 'C'], expect: 200, path: () => '/clients' },
      { row: 'POST /clients', method: 'POST', serve: ['P'], expect: 200, path: () => '/clients',
        body: () => ({ code: 'F-NEW', name: 'F New Client' }),
        after: (_c, data) => { made.newClient = data.id; } },
      { row: 'GET /departments', method: 'GET', serve: ['P', 'W', 'C', 'E'], expect: 200,
        path: () => `/departments?clientId=${t.A}` },
      { row: 'PATCH /departments/:id/head', method: 'PATCH', serve: ['P'], expect: 200,
        path: () => `/departments/${d.A}/head`,
        body: () => ({ clientId: t.A, headUserId: u.eA }) },
      { row: 'GET /users', method: 'GET', serve: ['P'], expect: 200, path: () => `/users?clientId=${t.A}` },
      { row: 'GET /ge/overview', method: 'GET', serve: ['P'], expect: 200, path: () => '/ge/overview' },
      { row: 'GET /clients/:id', method: 'GET', serve: ['P', 'W', 'C'], expect: 200,
        path: () => `/clients/${t.A}`,
        after: (c, data) => {
          // MUST-FIX 1 (round-2 ruling 1 / §3.4 row 9): W/C receive NO
          // account-operational flags or credential identifiers in users[];
          // P (explicit T) keeps its full safe projection.
          assert.ok(Array.isArray(data.users) && data.users.length > 0,
            `${c}: GET /clients/:id returns a non-empty roster for tenant A`);
          for (const entry of data.users) {
            if (c === 'P') {
              assert.ok('is_active' in entry && 'must_change_password' in entry,
                'P keeps its account-operational projection (safe columns only)');
            } else {
              for (const banned of ['is_active', 'must_change_password', 'email']) {
                assert.ok(!(banned in entry),
                  `${c} roster must not carry ${banned} (round-2 ruling 1 / §3.4 row 9)`);
              }
            }
          }
        } },
      { row: 'PATCH /clients/:id', method: 'PATCH', serve: ['P'], expect: 200,
        path: () => `/clients/${t.B}`, body: () => ({ name: 'D-B (renamed)' }) },
      { row: 'GET /clients/:id/services', method: 'GET', serve: ['P', 'W', 'C', 'E'], expect: 200,
        path: () => `/clients/${t.A}/services` },
      { row: 'POST /clients/:id/services', method: 'POST', serve: ['P'], expect: 201,
        path: () => `/clients/${t.B}/services`, body: () => ({ serviceId: s.UNLINKED }),
        after: (_c, data) => { assert.equal(data.linked, true); } },
      { row: 'PATCH /clients/:id/services/:serviceId', method: 'PATCH', serve: ['P'], expect: 200,
        path: () => `/clients/${t.B}/services/${s.UNLINKED}`, body: () => ({ showGap: false }) },
      { row: 'DELETE /clients/:id/services/:serviceId', method: 'DELETE', serve: ['P'], expect: 200,
        path: () => `/clients/${t.B}/services/${s.UNLINKED}`,
        after: (_c, data) => assert.deepEqual(data, { unlinked: true }) },
      { row: 'POST /services/link-all', method: 'POST', serve: ['P'], expect: 200,
        path: () => '/services/link-all', body: () => ({ serviceId: s.UNLINKED, confirm: true }),
        after: (_c, data) => {
          made.linkAll = String(data.linked);
          assert.ok(Number(made.linkAll) > 0,
            'link-all must link here: an automatic/startup run would have made this 0');
        } },
      { row: 'GET /assignments', method: 'GET', serve: ['P', 'W', 'C', 'E'], expect: 200,
        path: () => `/assignments?clientId=${t.A}` },
      { row: 'POST /assignments', method: 'POST', serve: ['P'], expect: 201,
        path: () => '/assignments',
        body: () => ({ clientId: t.B, itemId: seed.draft, departmentId: d.B }),
        after: (_c, data) => { assert.equal(data.assigned, true); } },
      { row: 'DELETE /assignments', method: 'DELETE', serve: ['P'], expect: 200,
        path: () => '/assignments',
        body: () => ({ clientId: t.B, itemId: seed.draft, departmentId: d.B }),
        after: (_c, data) => assert.deepEqual(data, { unassigned: true }) },
      { row: 'POST /assignments/na', method: 'POST', serve: ['W'], expect: 201,
        path: () => '/assignments/na',
        body: () => ({ clientId: t.A, itemId: fx.actionItem, departmentId: d.A,
          naReason: 'not-applicable', justification: 'f1 N/A probe' }) },
      { row: 'GET /staff-lists', method: 'GET', serve: ['P', 'W', 'C'], expect: 200,
        path: () => `/staff-lists?clientId=${t.A}` },
      { row: 'POST /staff-lists', method: 'POST', serve: ['C', 'W'], expect: 201, path: () => '/staff-lists',
        body: (c) => ({ clientId: t.A, note: `f1 ${c}`,
          rows: [{ email: `f1-${c.toLowerCase()}@u2f.invalid`, name: `F1 ${c}`, departmentId: d.A, role: 'employee' }] }),
        after: (c, data) => { made[`staff${c}`] = data.id; } },
      { row: 'POST /staff-lists/:id/submit', method: 'POST', serve: ['C', 'W'], expect: 200,
        path: (c) => `/staff-lists/${made[`staff${c}`]}/submit`,
        after: (_c, data) => assert.equal(data.status, 'submitted') },
      { row: 'POST /staff-lists/:id/reject', method: 'POST', serve: ['P', 'W'], expect: 200,
        path: (c) => `/staff-lists/${c === 'P' ? made.staffC : made.staffW}/reject`,
        body: (c) => (c === 'P' ? { clientId: t.A, reason: 'f1 P reject' } : { reason: 'f1 W reject' }),
        after: (_c, data) => assert.equal(data.status, 'rejected') },
      { row: 'GET /client/dashboard', method: 'GET', serve: ['W', 'C'], expect: 200,
        path: () => `/client/dashboard?clientId=${t.A}` },
    ];
    assert.equal(probes.length, 22, 'every non-provisioning §3.4 row has exactly one probe');
    let served = 0, refused = 0;
    for (const probe of probes) {
      const matrix = byKey.get(probe.row)!.matrix.map(r => r.context).sort();
      assert.deepEqual([...probe.serve].sort(), matrix,
        `${probe.row}: probe serve-set must equal its §3 registry matrix (${matrix.join(',')})`);
      for (const ctx of CONTEXTS) {
        const allowed = probe.serve.includes(ctx);
        const path = probe.path(ctx);
        const body = probe.body?.(ctx);
        const r = await raw(ctx, probe.method, path, allowed ? body : body);
        if (allowed) {
          assert.equal(r.status, probe.expect,
            `${ctx} ${probe.method} ${probe.row} must be served: ${r.text.slice(0, 300)}`);
          probe.after?.(ctx, r.data);
          served++;
        } else {
          assert.deepEqual([r.status, r.data.code], [403, 'workspace.mode_mismatch'],
            `${ctx} ${probe.method} ${probe.row} must be 403 workspace.mode_mismatch: ${r.text.slice(0, 200)}`);
          refused++;
        }
      }
    }
    assert.equal(served + refused, 88, '22 rows x 4 contexts = 88 probes');
    pass(`§3.4 matrix E2E: ${served} allowed contexts served + ${refused} disallowed refused 403 workspace.mode_mismatch (88)`);

    // The three PROVISIONING rows are activated in round 2 and E2E'd in
    // b17-domain-f3.ts (P@T serves, cross-T/wrong-context refusals, lock order,
    // OTP-once, all-or-nothing) — here they are only asserted ACTIVE in R1.

    // ---- E3-02 write-catch masking (runtime) ----
    // (a) raw PostgreSQL diagnostic collapses to the static fallback: no PG
    // message, no SQLSTATE.
    const dupe = await raw('P', 'POST', '/clients', { code: 'D-A', name: 'duplicate code probe' });
    assert.equal(dupe.status, 500, dupe.text.slice(0, 200));
    assert.deepEqual(dupe.data, { error: 'Failed to create client tenant' },
      'a raw 23505 must collapse to the route fallback with NO message and NO code');
    assert.ok(!/duplicate key|violates|constraint|SQLSTATE/i.test(dupe.text), 'no PG diagnostic text leaks');
    assert.ok(!/"code"\s*:\s*"[0-9A-Z]{5}"/.test(dupe.text), 'no SQLSTATE echoes');
    // (b) an error WE raised passes its own status/message/code through.
    const own404 = await raw('P', 'DELETE', '/assignments',
      { clientId: t.B, itemId: seed.draft, departmentId: d.B });
    assert.equal(own404.status, 404, own404.text.slice(0, 200));
    assert.equal(own404.data.error, 'Assignment not found.', 'own message passes through writeFailure');
    const own403 = await raw('W', 'POST', '/assignments/na',
      { clientId: t.A, itemId: seed.draft, departmentId: d.B, naReason: 'not-applicable' });
    assert.deepEqual([own403.status, own403.data.error], [403, 'This item is not assigned to the department.']);
    // Platform-scope (no named T) is the OTHER half of row 5: GE accounts only.
    const platformUsers = await raw('P', 'GET', '/users');
    assert.equal(platformUsers.status, 200, platformUsers.text.slice(0, 200));
    assert.ok(platformUsers.data.every((row: any) => row.client_id === null),
      'GET /users without a T returns ONLY platform (client_id NULL) accounts');
    pass('E3-02 masking: raw PG collapses to a static fallback; own status/message/code pass through');

    // ---- Implicit-grant + census truth ----
    const after = await census();
    const deltas: Record<string, number> = {};
    for (const table of CENSUS_TABLES) {
      deltas[table] = after[table] - before[table];
      const allowed: Record<string, number> = {
        clients: 1, evaluations: 1, answers: 1, staff_lists: 2, staff_list_rows: 2,
        client_services: Number(made.linkAll ?? 0),
      };
      assert.equal(deltas[table], allowed[table] ?? 0,
        `${table} delta must be exactly ${allowed[table] ?? 0}, saw ${deltas[table]} (before=${before[table]} after=${after[table]}, F-NEW=${JSON.stringify(made.newClient)})`);
    }
    assert.equal(deltas.users, 0, 'approve stayed denied: NO account was provisioned (OTP surface untouched)');
    assert.equal(deltas.assignments, 0, 'POST then DELETE /assignments nets zero (row 17/18)');
    assert.equal(deltas.review_snapshots, 0, 'no snapshot written by this round');
    await assertB17Ready();
    pass(`non-destructive census: expected deltas only (${JSON.stringify(deltas)}) + readiness green`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
  console.log('B17 U2-F proof (part 1) complete: 22 rows E2E + final flip truth 25 -> 3 -> 0; NOT release acceptance.');
}
main().catch(err => { console.error('B17_U2F_F1 proof FAILED:', err instanceof Error ? (err.stack || err.message) : err); process.exitCode = 1; })
  .finally(async () => { await oracleClient?.end().catch(() => {}); await getPool().end(); });
