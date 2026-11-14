// B17 U2-E E-2 proof — the NINE evaluations/reviews WRITE declarations through
// the REAL dispatcher -> requireDomainAccess -> readContext('work') -> scope.ts
// predicates -> handler chain, under FORCE RLS as a non-bypass owner.
// node --import tsx scripts/b17-domain-e2.ts --allow-disposable-b17
//   --database-url=<loopback named b17_*scratch* DB>
//
// Guards: explicit --allow opt-in, one named loopback b17_*scratch* owner URL,
// non-superuser/non-BYPASSRLS runtime role, PG18, empty start, no ambient
// .env/DATABASE_URL, seed-only fixtures.
//
// NON-DESTRUCTIVE by contract: never DELETEs/UPDATEs a pre-existing business
// row — it only drives the real handlers on its own fixtures and proves a
// before/after census is byte-identical. Every probe runs through real HTTP.
//
// Coverage disclosed: §3.3 E-2 positives, the denial matrix, the frozen path,
// G-SHARED, the §9(a) history branch and the exact 34 -> 25 flip. It is NOT an
// independent security review. BF-01 + readiness drift live in b17-domain-e2b.ts.

import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import express from 'express';
import cookieParser from 'cookie-parser';
import { getPool, runMigrations, withTenantContext } from '../src/db/index.ts';
import { applyB17Offline, assertB17Ready, STRUCTURE_SQL, B17_CONTENT_SHAPE } from '../src/db/b17Readiness.ts';
import { inventoryB17ContentOffline, applyB17ContentOffline } from '../src/db/b17ContentMigration.ts';
import { hashPassword } from '../src/server/auth.ts';
import { LEGACY_ROUTES } from '../src/server/accessRegistry.ts';
import { activeBusinessCapabilities } from '../src/lib/capabilities.ts';
import { seedDomainD } from './b17-domain-d-fixture.ts';
import apiRouter from '../src/server/routes.ts';
import { jsonInput } from '../src/server/jsonInput.ts';
import { globalJsonErrorHandler } from '../src/server/errorHandler.ts';

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
  return url.toString();
}
process.env.DATABASE_URL = guardedUrl(process.argv.slice(2));
process.env.JWT_SECRET = randomBytes(48).toString('hex');
process.env.B17_SCRATCH_OPT_IN = 'YES';
const pass = (label: string) => console.log(`PASS ${label}`);

const WRITES = ['POST /evaluations', 'POST /evaluations/:id/submit', 'POST /evaluations/:id/approve',
  'POST /evaluations/:id/return', 'PUT /evaluations/:id/correct', 'POST /evaluations/:id/client-approve',
  'POST /evaluations/:id/client-return', 'POST /reviews/ge-final', 'POST /reviews/snapshots/:id/notes'];

async function main() {
  const pool = getPool();
  const role = (await pool.query(`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`)).rows[0];
  assert.deepEqual(role, { rolsuper: false, rolbypassrls: false }, 'runtime role must be NOSUPERUSER/NOBYPASSRLS');
  assert.equal(Math.floor(Number((await pool.query('SHOW server_version_num')).rows[0].server_version_num) / 10000), 18);
  assert.equal((await pool.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0,
    'Scratch must start empty; never reset or replay an existing application DB.');
  assert.equal((await runMigrations()).success, true);

  const seed = await seedDomainD();
  const { tenants: t, departments: d, users: u, services: s, disc, sources, targets } = seed;
  const dept1 = d.A, dept2 = seed.department2;

  // ---- Seed (INSERT-only) BEFORE activation ----
  const fx = await withTenantContext({ role: 'ge_admin' }, async c => {
    const q = async (text: string, values: any[] = []) => (await c.query(text, values)).rows[0];
    const hash = await hashPassword(seed.password);
    const e2 = (await q(`INSERT INTO users(email,password_hash,name,role,client_id,department_id)
      VALUES($1,$2,'e2','employee',$3,$4) RETURNING id`, [`e2@b17u2e.invalid`, hash, t.A, dept2])).id;
    // §8 whole-tenant preflight needs ZERO unmapped assignments for tenant A:
    // the legacy foreign standard is linked here (it is a fixture, not data).
    const foreignStd = (await q("SELECT id FROM standards WHERE code='D-FOREIGN-STD'")).id;
    await c.query('INSERT INTO service_standards(service_id,standard_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [s.GRI, foreignStd]);
    const mkStd = async (code: string) => (await q("INSERT INTO standards(code,title,category) VALUES($1,$1,'Universal') RETURNING id", [code])).id;
    const mkDisc = async (stdId: string, code: string) =>
      (await q('INSERT INTO disclosures(standard_id,code,title) VALUES($1,$2,$2) RETURNING id', [stdId, code])).id;
    const mkItem = async (discId: string, code: string) =>
      (await q(`INSERT INTO items(disclosure_id,code,requirement,priority,esg_class)
        VALUES($1,$2,$2,'high','general') RETURNING id`, [discId, code])).id;
    const link = async (stdId: string) =>
      c.query('INSERT INTO service_standards(service_id,standard_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [s.GRI, stdId]);
    // LIFECYCLE fixture: one disclosure, one item, one department assignment.
    const stdLife = await mkStd('E2-STD'), discLife = await mkDisc(stdLife, 'E2-DISC');
    const itemLife = await mkItem(discLife, 'E2-ITEM');
    await link(stdLife);
    await c.query('INSERT INTO assignments(client_id,item_id,department_id) VALUES($1,$2,$3)', [t.A, itemLife, dept1]);
    // G-SHARED fixture: two departments + two answers on ONE item.
    const stdSh = await mkStd('E2-SH-STD'), discSh = await mkDisc(stdSh, 'E2-SH-DISC');
    const itemSh = await mkItem(discSh, 'E2-SH-ITEM');
    await link(stdSh);
    await c.query('INSERT INTO assignments(client_id,item_id,department_id) VALUES($1,$2,$3),($1,$2,$4)',
      [t.A, itemSh, dept1, dept2]);
    await c.query(`INSERT INTO answers(client_id,item_id,department_id,submitted_by,status,value)
      VALUES($1,$2,$3,$4,'submitted','own dept'),($1,$2,$5,$6,'draft','foreign dept')`,
    [t.A, itemSh, dept1, u.eA, dept2, e2]);
    await c.query(`INSERT INTO evaluations(client_id,item_id,evaluator_id,score,not_evaluated,not_applicable)
      VALUES($1,$2,$3,50,false,false)`, [t.A, itemSh, u.eA]);
    // An item linked to NOTHING — only used to build a MIXED snapshot payload.
    const stdU = await mkStd('E2-UNMAPPED-STD'), discU = await mkDisc(stdU, 'E2-UNMAPPED-DISC');
    const itemU = await mkItem(discU, 'E2-UNMAPPED-ITEM');
    // Scope ref = the UNMAPPED disclosure: a snapshot there freezes nothing the
    // lifecycle below still needs (it must stay a MIXED payload, not a freeze).
    const snap = async (scopeRef: string, payload: unknown, hash2: string) => (await q(
      `INSERT INTO review_snapshots(client_id,scope_type,scope_ref,payload,content_hash,created_by)
       VALUES($1,'disclosure',$2,$3,$4,$5) RETURNING id`, [t.A, scopeRef, JSON.stringify(payload), hash2, u.ge])).id;
    const snapMixed = await snap(discU, { items: [{ itemId: itemLife }, { itemId: itemU }] }, 'e2-hash-mixed');
    return { e2, itemLife, discLife, stdLife, itemSh, discSh, snapMixed };
  });

  const admin = await pool.connect();
  try {
    assert.equal(await applyB17Offline(admin), 'applied');
    const inventory = await inventoryB17ContentOffline(admin, targets, sources);
    assert.equal(await applyB17ContentOffline(admin, inventory, sources), 'applied');
    assert.equal(await applyB17ContentOffline(admin, inventory, sources), 'verified');
  } finally { admin.release(); }
  await assertB17Ready();
  assert.equal((await pool.query(STRUCTURE_SQL)).rows[0].checksum, B17_CONTENT_SHAPE,
    'effective catalog must equal the content-version structure/authority fingerprint');
  assert.equal((await pool.query(`SELECT count(*)::int n FROM pg_class WHERE relnamespace='public'::regnamespace
    AND relrowsecurity AND NOT relforcerowsecurity`)).rows[0].n, 0, 'every RLS table must be FORCE');
  pass('guards: loopback scratch opt-in, NOSUPERUSER/NOBYPASSRLS PG18, empty start, seed-only, offline U1+U2D content green, FORCE RLS');

  // ---- R1 registry truth: EXACTLY the nine write rows flipped, 34 -> 25 ----
  const byKey = new Map(LEGACY_ROUTES.map(r => [`${r.method} ${r.path}`, r]));
  assert.equal(LEGACY_ROUTES.length, 95);
  assert.equal(LEGACY_ROUTES.filter(r => r.activation === 'UNACTIVATED').length, 25, '34 -> 25 UNACTIVATED');
  assert.equal(LEGACY_ROUTES.filter(r => r.activation === 'U1').length, 70, '61 -> 70 U1');
  for (const k of WRITES) assert.equal(byKey.get(k)?.activation, 'U1', `${k} must be activated`);
  const remaining = LEGACY_ROUTES.filter(r => r.activation === 'UNACTIVATED');
  assert.ok(remaining.every(r => r.capability === 'admin'), 'only the U2-F admin group is still denied');
  assert.deepEqual([...activeBusinessCapabilities()],
    ['taxonomy', 'gri', 'evaluations', 'actions', 'initiatives', 'reports', 'storage', 'audit', 'notifications'],
    'activeBusinessCapabilities() is truthful after the E-2 flips');
  pass('R1 registry truth: exactly nine writes flipped (34 -> 25), matrix/capability data untouched, capabilities truthful (9)');

  // Non-destructive proof: the tenant/catalog surface must not move at all,
  // the workflow tables may only GROW, and the G-SHARED pair must stay
  // byte-identical (no rekey, no overwrite).
  const snapState = async () => {
    const count = async (table: string) => (await pool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n as number;
    const readOnly: Record<string, number> = {};
    for (const table of ['clients', 'departments', 'users', 'client_services', 'service_standards',
      'standards', 'disclosures', 'items', 'assignments', 'actions', 'esg_profile', 'report_settings'])
      readOnly[table] = await count(table);
    const growing: Record<string, number> = {};
    for (const table of ['answers', 'evaluations', 'approvals', 'notifications', 'audit_log',
      'review_snapshots', 'snapshot_notes']) growing[table] = await count(table);
    const shared = (await pool.query(
      `SELECT (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb) FROM answers a WHERE a.item_id=$1)
       || (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]'::jsonb) FROM evaluations e WHERE e.item_id=$1) AS pair`,
      [fx.itemSh])).rows[0].pair;
    return { readOnly, growing, shared };
  };
  const before = await snapState();

  const app = express();
  app.use(jsonInput); app.use(cookieParser()); app.use('/api', apiRouter); app.use(globalJsonErrorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  type Ctx = { token: string; tabHandle?: string; generation?: number };
  const contexts: Record<string, Ctx | undefined> = { anon: undefined };
  const request = async (who: string, method: string, path: string, body?: unknown,
    opts: { noTab?: boolean; version?: number } = {}) => {
    const ctx = contexts[who];
    const headers: Record<string, string> = {};
    if (ctx?.token) headers.Authorization = `Bearer ${ctx.token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (ctx?.tabHandle && !opts.noTab) {
      headers['X-Workspace-Tab'] = ctx.tabHandle;
      headers['X-Workspace-Version'] = String(opts.version ?? ctx.generation);
    }
    const response = await fetch(base + path, { method, headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    let data: any; try { data = JSON.parse(text); } catch { data = text; }
    assert.ok(!text.includes('password_hash') && !text.includes('invalid input syntax')
      && !text.includes(' at Parser.'), `no credential/SQL leakage: ${text.slice(0, 200)}`);
    return { status: response.status, data, text };
  };
  const ok = async (who: string, method: string, path: string, body?: unknown) => {
    const r = await request(who, method, path, body);
    assert.equal(r.status, 200, `${who} ${method} ${path}: ${r.text.slice(0, 400)}`);
    return r.data;
  };
  const refused = async (who: string, method: string, path: string, status: number,
    code: string | undefined, body?: unknown) => {
    const r = await request(who, method, path, body);
    const got = r.data.code ?? r.data.error;
    assert.deepEqual([r.status, got], [status, code], `${who} ${method} ${path}: ${r.text.slice(0, 300)}`);
    return r;
  };

  try {
    const login = async (email: string) => {
      const r = await request('anon', 'POST', '/auth/login', { email, password: seed.password });
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
    const geW = await login('ge@domain-d.invalid');
    const wTab0 = (await post(geW, '/workspace/tab', {})).data;
    const wTab = { tabHandle: wTab0.tabHandle as string, generation: wTab0.generation as number };
    const entered = await post(geW, '/workspace/enter', { clientId: t.A }, wTab);
    assert.equal(entered.status, 200, JSON.stringify(entered.data));
    wTab.generation = entered.data.generation as number;
    contexts.W = { token: geW, ...wTab };
    const geP = await login('ge@domain-d.invalid');
    const pTab0 = (await post(geP, '/workspace/tab', {})).data;
    contexts.P = { token: geP, tabHandle: pTab0.tabHandle as string, generation: pTab0.generation as number };
    contexts.C = { token: await login('cA@domain-d.invalid') };
    contexts.CB = { token: await login('cB@domain-d.invalid') };
    contexts.E = { token: await login('eA@domain-d.invalid') };
    contexts.E2 = { token: await login('e2@b17u2e.invalid') };
    pass('real login + workspace tab/enter produce P (platform), W (consultant A), C, CB, E and E2 contexts');

    const item = fx.itemLife, disc = fx.discLife;
    const v = (r: any) => r.data.answer.version as number;
    let r = await request('E', 'POST', '/evaluations',
      { itemId: item, score: 50, evidenceNote: 'first draft' });
    assert.equal(r.status, 201, r.text.slice(0, 300));
    assert.ok(r.data.answer, `answer row must come back: ${r.text.slice(0, 400)}`);
    assert.equal(v(r), 1, `fresh pair starts at version 1: ${r.text.slice(0, 400)}`);
    const evalId = r.data.evaluation.id;
    r = await request('E', 'POST', '/evaluations',
      { itemId: item, score: 100, evidenceNote: 'resave', version: 1 });
    assert.equal(r.status, 201, `resave: ${r.text.slice(0, 300)}`);
    assert.equal(v(r), 2, 'resave bumps BOTH rows in lockstep');
    assert.equal(r.data.evaluation.version, 2, 'evaluation version moves with the answer');
    // Submit (author), then the two version refusals BEFORE the real approve.
    r = await request('E', 'POST', `/evaluations/${evalId}/submit`, { version: 2 });
    assert.equal(r.status, 200, r.text.slice(0, 300));
    assert.equal(r.data.answer.status, 'submitted');
    assert.equal(v(r), 3);
    await refused('E', 'POST', `/evaluations/${evalId}/approve`, 400, 'version.required', {});
    await refused('E', 'POST', `/evaluations/${evalId}/approve`, 409, 'version.conflict', { version: 1 });
    // Dept approve — OD-08 self-preliminary (evaluator = submitter = caller).
    r = await request('E', 'POST', `/evaluations/${evalId}/approve`, { version: 3 });
    assert.equal(r.status, 200, r.text.slice(0, 300));
    assert.equal(r.data.selfApproved, true, 'self-approval exception is reported for the preliminary label');
    assert.equal(r.data.approval.level, 'department');
    assert.equal(r.data.answer.status, 'approved');
    const labelled = await withTenantContext(
      { purpose: 'work', role: 'client_admin', userId: u.cA, mode: 'client', tenantId: t.A },
      async c => (await c.query("SELECT body FROM notifications WHERE user_id=$1 AND type='evaluation.dept_approved'", [u.cA])).rows);
    assert.ok(labelled.some((n: any) => String(n.body).includes('pending client confirmation')),
      'the dept-approval fan-out carries the preliminary label');
    pass('L1 save -> resave -> submit -> dept approve: versions lockstep 1/2/3, selfApproved + preliminary label, 400/409 version refusals');

    // Author correction (pre-final, reasoned) — appended revision only.
    r = await request('E', 'PUT', `/evaluations/${evalId}/correct`,
      { newScore: 50, reason: 'evidence reviewed again', version: 4 });
    assert.equal(r.status, 200, r.text.slice(0, 300));
    assert.equal(r.data.answer.correction_history.length, 1, 'correction appends, never rewrites');
    assert.equal(r.data.evaluation.previous_score, 100, 'previous_score stamped');
    assert.equal(v(r), 5, 'both rows bump together on a correction');

    // C confirm, C return, E re-submit, E re-approve, C confirm again.
    r = await request('C', 'POST', `/evaluations/${evalId}/client-approve`, { version: 5 });
    assert.equal(r.status, 200, r.text.slice(0, 300));
    assert.equal(r.data.answer.status, 'client_approved');
    assert.equal(r.data.approval.level, 'client');
    r = await request('C', 'POST', `/evaluations/${evalId}/client-return`,
      { version: 6, comment: 'needs one more look' });
    assert.equal(r.status, 200, r.text.slice(0, 300));
    assert.equal(r.data.answer.status, 'returned');
    r = await request('E', 'POST', `/evaluations/${evalId}/submit`, { version: 7 });
    assert.equal(r.status, 200, r.text.slice(0, 300));
    assert.equal(r.data.answer.status, 'submitted');
    r = await request('E', 'POST', `/evaluations/${evalId}/approve`, { version: 8 });
    assert.equal(r.status, 200, r.text.slice(0, 300));
    assert.equal(r.data.answer.status, 'approved');
    r = await request('C', 'POST', `/evaluations/${evalId}/client-approve`, { version: 9 });
    assert.equal(r.status, 200, r.text.slice(0, 300));
    assert.equal(r.data.answer.status, 'client_approved');
    assert.equal(v(r), 10, 'ten lockstep bumps across the whole lifecycle');
    pass('L2 author correct(reason) -> C confirm -> C return -> re-submit -> re-approve -> C confirm, versions tracked throughout');

    // W ge-check then ge-final (§8 preflight + immutable snapshot + freeze).
    const check = await ok('W', 'GET', `/reviews/ge-check?scope=disclosure&scopeRef=${disc}`);
    assert.equal(check.total, 1);
    assert.equal(check.gate.ok, true, 'whole disclosure is client-approved');
    const frozen = await request('W', 'POST', '/reviews/ge-final',
      { scope: 'disclosure', scopeRef: disc, clientId: t.A, confirm: true });
    assert.equal(frozen.status, 201, frozen.text.slice(0, 400));
    const snapId = frozen.data.snapshot.id as string;
    assert.ok(frozen.data.snapshot.content_hash, 'immutable snapshot carries its content hash');
    assert.equal(frozen.data.finalApprovals, 1, 'FinalApproval stamped on the client-approved answer');
    // Frozen writes are refused at the API (409). `submit` stops one gate
    // earlier (the answer is already client-approved) and still refuses.
    for (const [who, method, path, body, msg] of [
      ['E', 'POST', '/evaluations', { itemId: item, score: 0 }, /frozen by GE final approval/i],
      ['E', 'POST', `/evaluations/${evalId}/submit`, { version: 9 }, /already been submitted/i],
      ['E', 'PUT', `/evaluations/${evalId}/correct`, { newScore: 0, reason: 'post-freeze', version: 9 },
        /frozen by GE final approval/i],
      ['C', 'POST', `/evaluations/${evalId}/client-return`, { version: 9, comment: 'post-freeze' },
        /frozen by GE final approval/i],
    ] as const) {
      const f = await request(who, method, path, body);
      assert.equal(f.status, 409, `${who} ${method} ${path} frozen: ${f.text.slice(0, 200)}`);
      assert.match(String(f.data.error), msg);
    }
    // … and at the DB (the is_scope_frozen trigger is the second line).
    await assert.rejects(() => withTenantContext(
      { purpose: 'work', role: 'ge_admin', userId: u.ge, mode: 'consultant', tenantId: t.A },
      async c => c.query('UPDATE answers SET value=$1 WHERE client_id=$2 AND item_id=$3',
        ['direct sql write', t.A, item])), /FROZEN_SCOPE/);
    pass('L3 W ge-check -> ge-final preflight+snapshot+freeze; frozen writes 409 at the API and FROZEN_SCOPE at the DB');
    // ================= S: G-SHARED fail-closed (second department) =================
    await refused('E', 'POST', '/evaluations', 409, 'scope.shared_ambiguous', { itemId: fx.itemSh, score: 0 });
    const sharedRead = await ok('E', 'GET', `/evaluations?itemId=${fx.itemSh}`);
    assert.equal(sharedRead.evaluation, null, 'shared evaluation stays unreadable to E (no rekey)');
    assert.ok(sharedRead.answers.every((a: any) => a.department_id === dept1), 'E sees only its own department answer');
    const sharedE2 = await ok('E2', 'GET', `/evaluations?itemId=${fx.itemSh}`);
    assert.equal(sharedE2.evaluation, null, 'and to the second department as well');
    const sharedW = await ok('W', 'GET', `/evaluations?itemId=${fx.itemSh}`);
    assert.ok(sharedW.evaluation, 'W (R+L) still reads the shared evaluation');
    pass('S G-SHARED: second department refused 409 scope.shared_ambiguous before any upsert; foreign reads empty, no rekey');

    // ================= H: §9(a) item-local history branch =================
    const histW = await ok('W', 'GET', `/evaluations?itemId=${item}`);
    const histC = await ok('C', 'GET', `/evaluations?itemId=${item}`);
    const histE = await ok('E', 'GET', `/evaluations?itemId=${item}`);
    for (const [who, h] of [['W', histW], ['C', histC], ['E', histE]] as const)
      assert.ok(h.history.length >= 3, `${who} receives the entity-scoped item history (${h.history.length} rows)`);
    assert.ok(histC.history.every((x: any) => x.entity_type === 'evaluations'), 'C history is entity-whitelisted');
    assert.ok(histE.history.every((x: any) => x.entity_type === 'evaluations'), 'E history is entity-whitelisted');
    assert.equal((await request('E', 'GET', `/evaluations?itemId=${fx.itemSh}`)).data.history.length, 0,
      'a shared item yields NO history for E (G-SHARED)');
    await refused('CB', 'GET', `/evaluations?itemId=${item}`, 404, 'scope.not_found');
    await refused('C', 'GET', '/audit-log', 403, 'workspace.mode_mismatch');
    await refused('E', 'GET', '/audit-log', 403, 'workspace.mode_mismatch');
    const foreignRows = await withTenantContext(
      { purpose: 'work', role: 'client_admin', userId: u.cB, mode: 'client', tenantId: t.B },
      async c => (await c.query('SELECT count(*)::int n FROM audit_log WHERE client_id=$1', [t.A])).rows[0].n);
    assert.equal(foreignRows, 0, 'a foreign tenant can never reach another tenant audit rows');
    pass('H §9(a) history: W/C/E all served entity-scoped rows, shared item empty, /audit-log still P/W-only, no foreign tenant');

    // ================= D: denial matrix =================
    for (const [who, method, path, body] of [
      ['C', 'POST', '/evaluations', { itemId: item, score: 0 }],
      ['C', 'PUT', `/evaluations/${evalId}/correct`, { newScore: 0, reason: 'x', version: 9 }],
      ['W', 'POST', '/evaluations', { itemId: item, score: 0 }],
      ['P', 'POST', '/evaluations', { itemId: item, score: 0 }],
      ['W', 'POST', `/evaluations/${evalId}/client-approve`, { version: 9 }],
      ['P', 'POST', `/evaluations/${evalId}/client-approve`, { version: 9 }],
      ['W', 'POST', `/evaluations/${evalId}/client-return`, { version: 9, comment: 'x' }],
      ['E', 'POST', `/evaluations/${evalId}/client-approve`, { version: 9 }],
      ['E', 'POST', `/evaluations/${evalId}/client-return`, { version: 9, comment: 'x' }],
      ['E', 'POST', '/reviews/ge-final', { scope: 'tenant', clientId: t.A, confirm: true }],
      ['P', 'POST', '/reviews/ge-final', { scope: 'tenant', clientId: t.A, confirm: true }],
    ] as const) await refused(who, method, path, 403, 'workspace.mode_mismatch', body);
    pass('D1 matrix denials: C drafting/scoring, P/W client-approve/return, E client-*/ge-final all 403 workspace.mode_mismatch');

    await refused('W', 'POST', '/reviews/ge-final', 403, 'scope.tenant_mismatch',
      { scope: 'tenant', clientId: t.B, confirm: true });
    await refused('E', 'POST', '/evaluations', 403, 'scope.department_mismatch',
      { itemId: fx.itemSh, score: 0, departmentId: dept2 });
    await refused('E', 'POST', '/evaluations', 400, 'scope.id_invalid',
      { itemId: item, score: 0, departmentId: 'not-a-uuid' });
    await refused('E', 'POST', '/evaluations', 400, 'scope.id_invalid', { itemId: 'not-a-uuid', score: 0 });
    await refused('W', 'GET', '/queue?departmentId=not-a-uuid', 400, 'scope.id_invalid');
    await refused('E', 'PUT', '/evaluations/not-a-uuid/correct', 400, 'scope.id_invalid',
      { newScore: 0, reason: 'x', version: 1 });
    await refused('W', 'POST', '/reviews/snapshots/not-a-uuid/notes', 400, 'scope.id_invalid', { note: 'x' });
    await refused('W', 'POST', '/reviews/ge-final', 400, 'scope.id_invalid',
      { scope: 'disclosure', scopeRef: 'not-a-uuid', clientId: t.A, confirm: true });
    pass('D2 §9(b) malformed ids are 400 scope.id_invalid BEFORE any SQL; cross-tenant/department refused');

    const noTab = await request('W', 'GET', '/queue', undefined, { noTab: true });
    assert.deepEqual([noTab.status, noTab.data.code], [409, 'workspace.invalid'], 'missing tab handle');
    const stale = await request('W', 'GET', '/queue', undefined, { version: (wTab.generation ?? 1) + 7 });
    assert.deepEqual([stale.status, stale.data.code], [409, 'workspace.stale'], 'stale generation');
    await refused('W', 'GET', `/reviews/snapshots/${fx.snapMixed}`, 403, 'scope.not_visible');
    const note = await request('W', 'POST', `/reviews/snapshots/${snapId}/notes`, { note: 'x'.repeat(2001) });
    assert.deepEqual([note.status, note.data.error], [400, 'note must be at most 2000 characters.']);
    const noteOk = await request('W', 'POST', `/reviews/snapshots/${snapId}/notes`, { note: 'post-freeze note' });
    assert.equal(noteOk.status, 201, noteOk.text.slice(0, 300));
    pass('D3 missing/stale tab 409, mixed snapshot 403 scope.not_visible, notes 2000-cap + append-only 201');

    // ===== R2/R3/R4/R5: the §10 round-3 rulings proven against the landed code =====
    // R5 (Shield-05): you may not annotate a blob you cannot read — notes on a
    // MIXED snapshot must be refused exactly like GET /:id.
    await refused('W', 'POST', `/reviews/snapshots/${fx.snapMixed}/notes`, 403, 'scope.not_visible',
      { note: 'annotation on an unreadable blob' });
    // R3 (Shield-01): the approvals provenance pin — an employee of department
    // one may not stamp an approval onto department two's answer.
    const foreignAnswer = await withTenantContext(
      { purpose: 'scope.internal', role: 'employee', userId: fx.e2, mode: 'employee',
        tenantId: t.A, departmentId: dept2 },
      async c => (await c.query('SELECT id FROM answers WHERE client_id=$1 AND item_id=$2 AND department_id=$3',
        [t.A, fx.itemSh, dept2])).rows[0]);
    assert.ok(foreignAnswer, 'the second-department answer exists');
    await assert.rejects(() => withTenantContext(
      { purpose: 'work', role: 'employee', userId: u.eA, mode: 'employee',
        tenantId: t.A, departmentId: dept1 },
      async c => c.query(`INSERT INTO approvals (client_id,answer_id,approver_id,level,status,comments)
        VALUES($1,$2,$3,'department','approved',NULL)`, [t.A, foreignAnswer.id, u.eA])),
    (err: any) => err.code === '42501' || /row-level security/i.test(String(err.message)),
      'a foreign-department approvals INSERT must be refused by row security');
    // R2 (Shield-06): OD-08 handler-level twin — both client-* handlers carry
    // the explicit client_admin guard; the dispatcher matrix is the outer ring,
    // not the only one.
    const evalSrc = readFileSync('src/server/routes/evaluations.ts', 'utf8');
    assert.equal((evalSrc.match(/user\.role !== 'client_admin'/g) ?? []).length, 2,
      'client-approve and client-return each carry the explicit client_admin guard');
    // R4 (Shield-04): the six READ catches go through readFailure, never err.code.
    assert.equal((evalSrc.match(/readFailure\(res, err,/g) ?? []).length, 6,
      'all six read catches use the sanitized readFailure treatment');
    for (const path of ['/queue?departmentId=not-a-uuid', '/evaluations?itemId=not-a-uuid',
      '/client-review?clientId=not-a-uuid', '/reviews/ge-check?scope=disclosure&scopeRef=not-a-uuid',
      '/reviews/snapshots?clientId=not-a-uuid', '/reviews/snapshots/not-a-uuid']) {
      const r = await request('W', 'GET', path);
      assert.equal(r.status, 400, `${path} -> 400: ${r.text.slice(0, 200)}`);
      assert.ok(!/(invalid input syntax|at Parser\.|SQLSTATE)/.test(r.text),
        `${path} leaks raw database text: ${r.text.slice(0, 200)}`);
      assert.ok(!/"[0-9A-Z]{5}"/.test(r.text), `${path} echoes a SQLSTATE: ${r.text.slice(0, 200)}`);
    }
    pass('R2/R3/R4/R5 client-* handler guards, approvals provenance pin, six sanitized read catches, notes full-visibility gate');

    // ================= C: nothing moved =================
    const after = await snapState();
    assert.deepEqual(after.readOnly, before.readOnly, 'no tenant/catalog/assignment row added or removed');
    for (const key of Object.keys(before.growing))
      assert.ok(after.growing[key] >= before.growing[key], `${key} may only grow (append-only)`);
    assert.deepEqual(after.shared, before.shared, 'the G-SHARED pair is byte-identical — no rekey, no overwrite');
    await assertB17Ready();
    pass('C non-destructive: tenant/catalog surface identical, workflow tables only grew, G-SHARED pair untouched, readiness green');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
  console.log('B17 U2-E E-2 proof complete: nine writes proven end-to-end, 34 -> 25 exact; NOT release acceptance.');
}
main().catch(err => { console.error('B17_U2E_E2 proof FAILED:', err instanceof Error ? (err.stack || err.message) : err); process.exitCode = 1; })
  .finally(async () => { await getPool().end(); });
