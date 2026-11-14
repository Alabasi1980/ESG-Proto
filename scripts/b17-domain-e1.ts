// B17 U2-E E-1 proof — the SIX evaluations/reviews READ declarations through
// the REAL dispatcher -> requireDomainAccess -> readContext('work') -> scope.ts
// predicates -> handler chain, under FORCE RLS as a non-bypass owner.
// node --import tsx scripts/b17-domain-e1.ts --allow-disposable-b17
//   --database-url=<loopback named b17_*scratch* DB>
//
// Guards: explicit --allow opt-in, one named loopback b17_*scratch* owner URL,
// non-superuser/non-BYPASSRLS runtime role, PG18, empty start, no ambient
// .env/DATABASE_URL, seed-only fixtures.
//
// NON-DESTRUCTIVE by contract: this script never DELETEs/UPDATEs a business
// row — it seeds extra rows (second department, second-department answer,
// cross-tenant assignment, three review snapshots) and proves a before/after
// census is byte-identical. Every policy probe runs through real HTTP.
//
// Coverage disclosed: §3.3 E-1 positives + negatives for the six flipped reads,
// re-run green after E-2 flipped the nine write rows too (the current split is
// 0 UNACTIVATED / 95 U1). It is NOT an independent security review.

import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
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

const READS = ['GET /queue', 'GET /evaluations', 'GET /client-review',
  'GET /reviews/ge-check', 'GET /reviews/snapshots', 'GET /reviews/snapshots/:id'];
const WRITES = ['POST /evaluations', 'POST /evaluations/:id/submit', 'POST /evaluations/:id/approve',
  'POST /evaluations/:id/return', 'PUT /evaluations/:id/correct', 'POST /evaluations/:id/client-approve',
  'POST /evaluations/:id/client-return', 'POST /reviews/ge-final', 'POST /reviews/snapshots/:id/notes'];

const CENSUS_TABLES = ['clients', 'departments', 'users', 'client_services', 'service_standards',
  'assignments', 'answers', 'evaluations', 'approvals', 'review_snapshots', 'snapshot_notes',
  'audit_log', 'actions', 'esg_profile', 'report_settings', 'standards', 'disclosures', 'items'];

async function main() {
  const pool = getPool();
  const role = (await pool.query(`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`)).rows[0];
  assert.deepEqual(role, { rolsuper: false, rolbypassrls: false }, 'runtime role must be NOSUPERUSER/NOBYPASSRLS');
  assert.equal(Math.floor(Number((await pool.query('SHOW server_version_num')).rows[0].server_version_num) / 10000), 18);
  assert.equal((await pool.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0,
    'Scratch must start empty; never reset or replay an existing application DB.');
  assert.equal((await runMigrations()).success, true);

  // ---- Seed (INSERT-only) + the E-1 extra fixtures, BEFORE activation ----
  const seed = await seedDomainD();
  const { tenants: t, departments: d, users: u, disc, scored, draft, foreign, sources, targets } = seed;
  const extra = await withTenantContext({ role: 'ge_admin' }, async c => {
    const hash = await hashPassword(seed.password);
    const e2 = (await c.query(`INSERT INTO users(email,password_hash,name,role,client_id,department_id)
      VALUES($1,$2,'e2','employee',$3,$4) RETURNING id`, [`e2@b17u2e.invalid`, hash, t.A, seed.department2])).rows[0].id as string;
    // G-SHARED fixture: a SECOND department's answer on the same (client,item).
    // The retained evaluation must then stay unreadable to both employees.
    await c.query(`INSERT INTO answers(client_id,item_id,department_id,submitted_by,status,value)
      VALUES($1,$2,$3,$4,'draft','second department draft')`, [t.A, scored, seed.department2, e2]);
    // Cross-tenant assignment on a shared catalog item: B's queue must show it,
    // A's must never see it.
    await c.query('INSERT INTO assignments(client_id,item_id,department_id) VALUES($1,$2,$3)', [t.B, draft, d.B]);
    // Item-local history rows for the E-positive item (entity-scoped, not audit).
    const evalId = (await c.query('SELECT id FROM evaluations WHERE client_id=$1 AND item_id=$2', [t.A, draft])).rows[0].id as string;
    await c.query(`INSERT INTO audit_log(client_id,user_id,action,entity_type,entity_id,payload)
      VALUES($1,$2,'EVALUATION_SUBMITTED','evaluations',$3,'{}'),($1,$2,'EVALUATION_DEPT_APPROVED','evaluations',$3,'{}')`,
    [t.A, u.eA, evalId]);
    // Three own-tenant snapshots: fully linked / mixed (unlinked item) / empty.
    const snap = async (payload: unknown, contentHash: string) => (await c.query(
      `INSERT INTO review_snapshots(client_id,scope_type,scope_ref,payload,content_hash,created_by)
       VALUES($1,'disclosure',$2,$3,$4,$5) RETURNING id`, [t.A, disc, JSON.stringify(payload), contentHash, u.ge])).rows[0].id as string;
    const snapFull = await snap({ scope: 'disclosure', scopeRef: disc, clientId: t.A,
      items: [{ itemId: scored, code: 'D-SCORE', score: 50 }, { itemId: draft, code: 'D-DRAFT', score: 100 }],
      aggregate: 75, coveragePercentage: 100 }, 'e1-hash-full');
    const snapMixed = await snap({ items: [{ itemId: scored }, { itemId: foreign }] }, 'e1-hash-mixed');
    const snapEmpty = await snap({}, 'e1-hash-empty');
    await c.query(`INSERT INTO snapshot_notes(client_id,snapshot_id,note,created_by)
      VALUES($1,$2,'E1 append-only note',$3)`, [t.A, snapFull, u.ge]);
    const foreignSnapshot = (await c.query('SELECT id FROM review_snapshots WHERE client_id=$1', [t.F])).rows[0].id as string;
    return { e2, evalId, snapFull, snapMixed, snapEmpty, foreignSnapshot };
  });

  // ---- Offline activation through the REAL migration path ----
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

  // ---- R1 registry truth: the six E-1 reads stay activated; E-2 has since
  // flipped the nine write rows of the same group, so the live split is 25/70.
  // ----
  const keyOf = (r: { method: string; path: string }) => `${r.method} ${r.path}`;
  const byKey = new Map(LEGACY_ROUTES.map(r => [keyOf(r), r]));
  assert.equal(LEGACY_ROUTES.length, 95);
  for (const k of READS) assert.equal(byKey.get(k)?.activation, 'U1', `${k} must be activated`);
  for (const k of WRITES) assert.equal(byKey.get(k)?.activation, 'U1', `${k} activated by U2-E E-2`);
  assert.equal(LEGACY_ROUTES.filter(r => r.activation === 'UNACTIVATED').length, 0, 'post-U2-F final split: 0 UNACTIVATED');
  assert.equal(LEGACY_ROUTES.filter(r => r.activation === 'U1').length, 95, 'post-U2-F final split: 95 U1');
  assert.deepEqual([...activeBusinessCapabilities()],
    ['taxonomy', 'gri', 'evaluations', 'admin', 'actions', 'initiatives', 'reports', 'storage', 'audit', 'notifications'],
    'activeBusinessCapabilities() is truthful after the U2-F round-1 flips');
  pass('R1 registry truth: the six E-1 reads still activated; current split 0 UNACTIVATED / 95 U1, capabilities truthful (10)');

  const census = async () => {
    const out: Record<string, number> = {};
    for (const table of CENSUS_TABLES)
      out[table] = (await pool.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n;
    return out;
  };
  const before = await census();

  // ---- Real HTTP chain: dispatcher -> wrapper -> readContext('work') -> handler ----
  const app = express();
  app.use(jsonInput); app.use(cookieParser()); app.use('/api', apiRouter); app.use(globalJsonErrorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  type Ctx = { token: string; tabHandle?: string; generation?: number };
  const contexts: Record<string, Ctx | undefined> = { anon: undefined };
  const request = async (who: string, method: string, path: string, body?: unknown) => {
    const ctx = contexts[who];
    const headers: Record<string, string> = {};
    if (ctx?.token) headers.Authorization = `Bearer ${ctx.token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (ctx?.tabHandle) {
      headers['X-Workspace-Tab'] = ctx.tabHandle;
      headers['X-Workspace-Version'] = String(ctx.generation);
    }
    const response = await fetch(base + path, { method, headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    let data: any; try { data = JSON.parse(text); } catch { data = text; }
    assert.ok(!text.includes('password_hash') && !text.includes(' at Parser.'),
      `no credential/SQL leakage: ${text.slice(0, 200)}`);
    return { status: response.status, data, text };
  };
  const ok = async (who: string, method: string, path: string) => {
    const r = await request(who, method, path);
    assert.equal(r.status, 200, `${who} ${method} ${path}: ${r.text.slice(0, 300)}`);
    return r.data;
  };
  const refused = async (who: string, method: string, path: string, status: number, code: string | undefined) => {
    const r = await request(who, method, path, method === 'GET' ? undefined : {});
    assert.deepEqual([r.status, r.data.code], [status, code],
      `${who} ${method} ${path} must be ${status}/${code}: ${r.text.slice(0, 300)}`);
    return r;
  };

  try {
    const login = async (email: string) => {
      const r = await request('anon', 'POST', '/auth/login', { email, password: seed.password });
      assert.equal(r.status, 200, `${email} login: ${r.text.slice(0, 200)}`);
      return r.data.token as string;
    };
    const post = async (token: string, path: string, body: unknown, tab?: { tabHandle: string; generation: number }) => {
      const response = await fetch(base + path, { method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
          ...(tab ? { 'X-Workspace-Tab': tab.tabHandle, 'X-Workspace-Version': String(tab.generation) } : {}) },
        body: JSON.stringify(body) });
      return { status: response.status, data: await response.json() };
    };
    const geW = await login('ge@domain-d.invalid');
    const wTab = (await post(geW, '/workspace/tab', {})).data;
    const wLive = { tabHandle: wTab.tabHandle as string, generation: wTab.generation as number };
    const entered = await post(geW, '/workspace/enter', { clientId: t.A }, wLive);
    assert.equal(entered.status, 200, JSON.stringify(entered.data));
    wLive.generation = entered.data.generation as number;
    contexts.W = { token: geW, ...wLive };
    const geP = await login('ge@domain-d.invalid');
    const pTab = (await post(geP, '/workspace/tab', {})).data;
    contexts.P = { token: geP, tabHandle: pTab.tabHandle as string, generation: pTab.generation as number };
    contexts.C = { token: await login('cA@domain-d.invalid') };
    contexts.E = { token: await login('eA@domain-d.invalid') };
    contexts.E2 = { token: await login('e2@b17u2e.invalid') };
    pass('real login + workspace tab/enter produce P (platform), W (consultant A), C, E and E2 contexts');

    // ---- P1: GET /queue — W/C L, E L+D, tenant always resolved ----
    const queueW = await ok('W', 'GET', '/queue');
    assert.equal(queueW.count, 5, `W queue must be the five linked assignment rows: ${JSON.stringify(queueW.items.map((i: any) => i.code))}`);
    assert.ok(queueW.items.every((i: any) => [d.A, seed.department2].includes(i.department_id)), 'W sees only own-tenant departments');
    assert.ok(!queueW.items.some((i: any) => i.code === 'D-FOREIGN'), 'unlinked assignment must never enter the queue (L)');
    const queueC = await ok('C', 'GET', '/queue');
    assert.equal(queueC.count, 5, 'C sees the whole own-company linked set (L, no D)');
    const queueE = await ok('E', 'GET', '/queue');
    assert.equal(queueE.count, 4, 'E sees only own-department linked rows (L+D)');
    assert.ok(queueE.items.every((i: any) => i.department_id === d.A), 'E never receives another department rows');
    const queueE2 = await ok('E2', 'GET', '/queue');
    assert.equal(queueE2.count, 1, 'second department sees exactly its own row');
    assert.equal(queueE2.items[0].department_id, seed.department2);
    pass('P1 GET /queue: W/C L (5), E L+D (4), second department (1), unlinked + foreign rows excluded');

    // ---- P2: GET /evaluations — R+L (+D), G-SHARED fail-closed, item-local history ----
    const histW = await ok('W', 'GET', `/evaluations?itemId=${draft}`);
    assert.ok(histW.evaluation && histW.answers.length === 1 && histW.history.length === 2,
      'W receives the evaluation, answers and the entity-scoped item history');
    const histC = await ok('C', 'GET', `/evaluations?itemId=${draft}`);
    assert.ok(histC.evaluation && histC.answers.length === 1, 'C (R+L) receives the evaluation');
    const histE = await ok('E', 'GET', `/evaluations?itemId=${draft}`);
    assert.ok(histE.evaluation, 'E receives its own-department evaluation');
    assert.equal(histE.answers.length, 1);
    assert.equal(histE.answers[0].department_id, d.A, 'E receives ONLY its own department answer array');
    // G-SHARED: two departments answered -> neither employee may read the evaluation.
    const sharedE = await ok('E', 'GET', `/evaluations?itemId=${scored}`);
    assert.equal(sharedE.evaluation, null, 'foreign-department shared evaluation stays unreadable to E');
    assert.equal(sharedE.answers.length, 1);
    const sharedE2 = await ok('E2', 'GET', `/evaluations?itemId=${scored}`);
    assert.equal(sharedE2.evaluation, null, 'second department reads no evaluation either');
    const sharedW = await ok('W', 'GET', `/evaluations?itemId=${scored}`);
    assert.ok(sharedW.evaluation, 'W (R+L) still reads the shared evaluation');
    // Refusals.
    await refused('anon', 'GET', `/evaluations?itemId=${draft}`, 401, 'auth.invalid');
    await refused('P', 'GET', `/evaluations?itemId=${draft}`, 403, 'workspace.mode_mismatch');
    await refused('E2', 'GET', `/evaluations?itemId=${draft}`, 404, 'scope.not_found');   // foreign department
    await refused('W', 'GET', `/evaluations?itemId=${foreign}`, 404, 'scope.not_found');  // unlinked item
    await refused('W', 'GET', '/evaluations?itemId=not-a-uuid', 400, 'scope.id_invalid');
    await refused('W', 'GET', `/evaluations?itemId=${draft}&clientId=${t.B}`, 403, 'scope.tenant_mismatch');
    await refused('C', 'GET', `/evaluations?itemId=${draft}&clientId=${t.B}`, 403, 'scope.tenant_mismatch');
    await refused('E', 'GET', `/evaluations?itemId=${draft}&departmentId=${seed.department2}`, 403, 'scope.department_mismatch');
    const missing = await request('W', 'GET', '/evaluations');
    assert.deepEqual([missing.status, missing.data.code], [400, undefined], 'missing itemId stays 400');
    pass('P2 GET /evaluations: R+L(+D), G-SHARED empty for both employees, item history for W, exact refusals');

    // ---- P3: GET /client-review — W/C L, no tenant selector ----
    const reviewW = await ok('W', 'GET', '/client-review');
    assert.equal(reviewW.count, 3, 'three linked disclosures in the A client-review queue');
    const reviewC = await ok('C', 'GET', '/client-review');
    assert.equal(reviewC.count, 3, 'C own-company queue');
    assert.equal(reviewC.tenantId, t.A, 'tenant always the server-derived own tenant');
    await refused('anon', 'GET', '/client-review', 401, 'auth.invalid');
    await refused('P', 'GET', '/client-review', 403, 'workspace.mode_mismatch');
    await refused('E', 'GET', '/client-review', 403, 'workspace.mode_mismatch');
    await refused('W', 'GET', `/client-review?clientId=${t.B}`, 403, 'scope.tenant_mismatch');
    pass('P3 GET /client-review: W/C served, P/E refused, supplied clientId is comparison only');

    // ---- P4: GET /reviews/ge-check — W R+L, disclosure/tenant scope types kept ----
    const checkTenant = await ok('W', 'GET', '/reviews/ge-check?scope=tenant');
    assert.equal(checkTenant.total, 4, 'four linked items in the whole-tenant checklist');
    assert.equal(checkTenant.clientId, t.A, 'no tenant selector: own tenant resolved server-side');
    const checkOwn = await ok('W', 'GET', `/reviews/ge-check?scope=tenant&clientId=${t.A}`);
    assert.equal(checkOwn.total, 4, 'supplied own clientId is an accepted comparison');
    const checkDisclosure = await ok('W', 'GET', `/reviews/ge-check?scope=disclosure&scopeRef=${disc}`);
    assert.equal(checkDisclosure.total, 2, 'disclosure scope type still works (scored + draft)');
    await refused('anon', 'GET', '/reviews/ge-check?scope=tenant', 401, 'auth.invalid');
    await refused('P', 'GET', '/reviews/ge-check?scope=tenant', 403, 'workspace.mode_mismatch');
    await refused('C', 'GET', '/reviews/ge-check?scope=tenant', 403, 'workspace.mode_mismatch');
    await refused('E', 'GET', '/reviews/ge-check?scope=tenant', 403, 'workspace.mode_mismatch');
    await refused('W', 'GET', `/reviews/ge-check?scope=tenant&clientId=${t.B}`, 403, 'scope.tenant_mismatch');
    await refused('W', 'GET', '/reviews/ge-check?scope=bogus', 400, undefined);
    await refused('W', 'GET', '/reviews/ge-check?scope=disclosure&scopeRef=not-a-uuid', 400, 'scope.id_invalid');
    pass('P4 GET /reviews/ge-check: W R+L with both scope types, no tenant selector, P/C/E refused');

    // ---- P5: GET /reviews/snapshots — metadata only when mixed/inaccessible ----
    const listW = await ok('W', 'GET', '/reviews/snapshots');
    assert.equal(listW.count, 3, 'own-tenant snapshot list only (no cross-tenant row)');
    const byHash = new Map<string, any>(listW.items.map((row: any) => [row.content_hash, row]));
    assert.ok(byHash.get('e1-hash-full')?.payload, 'fully linked snapshot keeps its payload');
    assert.ok(!('payload' in byHash.get('e1-hash-mixed')), 'mixed snapshot is metadata-only (payload dropped whole)');
    assert.ok(!('payload' in byHash.get('e1-hash-empty')), 'unparseable/empty payload is metadata-only');
    for (const hash of ['e1-hash-mixed', 'e1-hash-empty'])
      assert.equal(byHash.get(hash)?.content_hash, hash, 'the stored hash is passed through, never rewritten');
    assert.equal(byHash.get('e1-hash-mixed')?.notes_count, 0, 'notes count is safe metadata');
    await refused('anon', 'GET', '/reviews/snapshots', 401, 'auth.invalid');
    await refused('P', 'GET', '/reviews/snapshots', 403, 'workspace.mode_mismatch');
    await refused('C', 'GET', '/reviews/snapshots', 403, 'workspace.mode_mismatch');
    await refused('E', 'GET', '/reviews/snapshots', 403, 'workspace.mode_mismatch');
    await refused('W', 'GET', `/reviews/snapshots?clientId=${t.B}`, 403, 'scope.tenant_mismatch');
    pass('P5 GET /reviews/snapshots: full payload only when the entire item set is linked, else metadata only');

    // ---- P6: GET /reviews/snapshots/:id — full blob or 403 scope.not_visible ----
    const full = await ok('W', 'GET', `/reviews/snapshots/${extra.snapFull}`);
    assert.equal(full.snapshot.content_hash, 'e1-hash-full');
    assert.equal(full.snapshot.payload.items.length, 2, 'entire linked payload item set served');
    assert.equal(full.notes.length, 1, 'append-only notes readable under the W SELECT substrate');
    assert.equal(full.notes[0].note, 'E1 append-only note');
    await refused('W', 'GET', `/reviews/snapshots/${extra.snapMixed}`, 403, 'scope.not_visible');
    await refused('W', 'GET', `/reviews/snapshots/${extra.snapEmpty}`, 403, 'scope.not_visible');
    await refused('W', 'GET', `/reviews/snapshots/${extra.foreignSnapshot}`, 404, 'scope.not_found');
    await refused('W', 'GET', '/reviews/snapshots/00000000-0000-4000-8000-000000000099', 404, 'scope.not_found');
    await refused('W', 'GET', '/reviews/snapshots/not-a-uuid', 400, 'scope.id_invalid');
    await refused('anon', 'GET', `/reviews/snapshots/${extra.snapFull}`, 401, 'auth.invalid');
    await refused('P', 'GET', `/reviews/snapshots/${extra.snapFull}`, 403, 'workspace.mode_mismatch');
    await refused('C', 'GET', `/reviews/snapshots/${extra.snapFull}`, 403, 'workspace.mode_mismatch');
    await refused('E', 'GET', `/reviews/snapshots/${extra.snapFull}`, 403, 'workspace.mode_mismatch');
    pass('P6 GET /reviews/snapshots/:id: full blob only when the entire payload item set is L, else 403 scope.not_visible');

    // ---- P7: every declaration that is STILL unactivated stays denied ----
    // (the nine E-2 write rows are activated now and are proved by
    // scripts/b17-domain-e2.ts; only the U2-F admin group remains denied.)
    const stillDenied = LEGACY_ROUTES.filter(r => r.activation === 'UNACTIVATED');
    assert.equal(stillDenied.length, 0, 'zero UNACTIVATED rows after U2-F round 2');
    let denied = 0;
    for (const route of stillDenied) {
      const path = route.path.replace(/:[^/]+/g, randomUUID());
      for (const who of ['anon', 'W', 'C', 'E']) {
        const r = await request(who, route.method, path, route.method === 'GET' ? undefined : {});
        assert.deepEqual([r.status, r.data.code], [403, 'access.unactivated'], `${who} ${route.method} ${route.path}`);
        denied++;
      }
    }
    assert.equal(denied, 0, 'zero still-denied rows: the loop is vacuous at 0');
    pass('P7: zero still-unactivated declarations remain (vacuous loop; the refusal ring is pinned synthetically in domainAccess.test)');

    // ---- P8: nothing moved — seed-only, non-destructive ----
    assert.deepEqual(await census(), before, 'no business row may be added or removed by this proof');
    await assertB17Ready();
    pass('P8 before/after census identical across 18 tables; readiness still green (no schema/policy drift)');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
  console.log('B17 U2-E E-1 proof complete: six reads proven end-to-end, current split 0/95 (U2-F final), still-denied rows refused; NOT release acceptance.');
}
main().catch(err => { console.error('B17_U2E_E1 proof FAILED:', err instanceof Error ? err.message : err); process.exitCode = 1; })
  .finally(async () => { await getPool().end(); });
