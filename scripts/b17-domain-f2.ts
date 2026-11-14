// U2-F proof part 2, recovered after the interrupted write zero-filled this file.
// Retains the R1 oracle/dashboard/unlink/NA/staff/suspend/census probes, adds
// R2 per-service unmapped T1/T2 cases and explicit-T approval refusal.
// Fresh PG18 loopback scratch ONLY: --allow-disposable-b17 --database-url=...
// --oracle-url=... (postgres, exact same scratch, independent count oracle).
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import express from 'express';
import cookieParser from 'cookie-parser';
import pg from 'pg';
import { getPool, runMigrations, withTenantContext } from '../src/db/index.ts';
import { applyB17Offline, assertB17Ready, STRUCTURE_SQL, B17_CONTENT_SHAPE } from '../src/db/b17Readiness.ts';
import { inventoryB17ContentOffline, applyB17ContentOffline } from '../src/db/b17ContentMigration.ts';
import { seedDomainD } from './b17-domain-d-fixture.ts';
import apiRouter from '../src/server/routes.ts';
import { jsonInput } from '../src/server/jsonInput.ts';
import { globalJsonErrorHandler } from '../src/server/errorHandler.ts';

let oracleUrl = '';
let oracleClient: pg.Client | undefined;
function guardedUrl(args: string[]): string {
  if (!args.includes('--allow-disposable-b17')) throw new Error('Explicit disposable B17 opt-in required.');
  const urls = args.filter(a => a.startsWith('--database-url='));
  if (urls.length !== 1 || existsSync('.env') || process.env.DATABASE_URL || process.env.JWT_SECRET)
    throw new Error('One explicit scratch URL required; refusing ambient .env / DATABASE_URL / JWT_SECRET.');
  const url = new URL(urls[0].slice('--database-url='.length));
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || !/^\/b17_[a-z0-9_]*scratch[a-z0-9_]*$/.test(url.pathname) || url.search || url.hash
    || !url.username || url.username === 'postgres') throw new Error('Only named disposable loopback owner DB accepted.');
  const oracles = args.filter(a => a.startsWith('--oracle-url='));
  if (oracles.length !== 1) throw new Error('One explicit same-scratch count oracle required.');
  const oracle = new URL(oracles[0].slice('--oracle-url='.length));
  if (oracle.protocol !== url.protocol || oracle.hostname !== url.hostname || oracle.port !== url.port
    || oracle.pathname !== url.pathname || oracle.username !== 'postgres' || oracle.search || oracle.hash)
    throw new Error('Oracle must target the exact same loopback scratch.');
  oracleUrl = oracle.toString();
  return url.toString();
}
process.env.DATABASE_URL = guardedUrl(process.argv.slice(2));
process.env.JWT_SECRET = randomBytes(48).toString('hex');
process.env.B17_SCRATCH_OPT_IN = 'YES';
const pass = (s: string) => console.log(`PASS ${s}`);

// Independent SQL formulation, unlike the handler's JS maps; FORCE RLS owner
// counts without context would be vacuous, so ONLY the oracle reads raw rows.
const PROGRESS_ORACLE = `SELECT cs.client_id,cs.service_id,
 (SELECT count(*)::int FROM service_standards ss JOIN disclosures d ON d.standard_id=ss.standard_id
  JOIN items i ON i.disclosure_id=d.id WHERE ss.service_id=cs.service_id) mapped,
 (SELECT count(DISTINCT (a.item_id,a.department_id))::int FROM assignments a WHERE a.client_id=cs.client_id
  AND a.item_id IN (SELECT i.id FROM service_standards ss JOIN disclosures d ON d.standard_id=ss.standard_id
   JOIN items i ON i.disclosure_id=d.id WHERE ss.service_id=cs.service_id)) assigned,
 (SELECT count(DISTINCT (a.item_id,a.department_id))::int FROM answers a WHERE a.client_id=cs.client_id
  AND a.status IN ('submitted','approved','client_approved')
  AND a.item_id IN (SELECT i.id FROM service_standards ss JOIN disclosures d ON d.standard_id=ss.standard_id
   JOIN items i ON i.disclosure_id=d.id WHERE ss.service_id=cs.service_id)) submitted,
 (SELECT count(DISTINCT (a.item_id,a.department_id))::int FROM assignments a JOIN items i2 ON i2.id=a.item_id
  WHERE a.client_id=cs.client_id AND a.item_id IN (SELECT i.id FROM service_standards ss
   JOIN disclosures d ON d.standard_id=ss.standard_id JOIN items i ON i.disclosure_id=d.id WHERE ss.service_id=cs.service_id)
  AND EXISTS(SELECT 1 FROM review_snapshots r WHERE r.client_id=cs.client_id
   AND (r.scope_type='tenant' OR (r.scope_type='disclosure' AND r.scope_ref=i2.disclosure_id::text)))) frozen
 FROM client_services cs`;
const UNMAPPED_ORACLE = `SELECT a.client_id,count(*)::int n FROM assignments a WHERE NOT EXISTS(
 SELECT 1 FROM client_services cs JOIN service_standards ss ON ss.service_id=cs.service_id
 JOIN disclosures d ON d.standard_id=ss.standard_id JOIN items i ON i.disclosure_id=d.id
 WHERE cs.client_id=a.client_id AND i.id=a.item_id) GROUP BY a.client_id`;

async function main() {
  const pool = getPool();
  assert.deepEqual((await pool.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0],
    { rolsuper: false, rolbypassrls: false });
  assert.equal(Math.floor(Number((await pool.query('SHOW server_version_num')).rows[0].server_version_num) / 10000), 18);
  assert.equal((await pool.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0);
  assert.equal((await runMigrations()).success, true);
  oracleClient = new pg.Client({ connectionString: oracleUrl }); await oracleClient.connect();
  const oracle = oracleClient;
  const count = async (table: string) => (await oracle.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n as number;
  const seed = await seedDomainD();
  const { tenants: t, departments: d, users: u, services: s } = seed;
  const actionItem = await withTenantContext({ role: 'ge_admin' }, async c => {
    for (const pair of [[t.B, seed.draft, d.B], [t.F, seed.scored, d.F], [t.H, seed.foreign, d.H]])
      await c.query('INSERT INTO assignments(client_id,item_id,department_id) VALUES($1,$2,$3)', pair);
    const item = (await c.query("SELECT id FROM items WHERE code='D-ACTION-ONLY'")).rows[0].id as string;
    await c.query('INSERT INTO assignments(client_id,item_id,department_id) VALUES($1,$2,$3)', [t.A, item, d.A]);
    return item;
  });
  const admin = await pool.connect();
  try {
    assert.equal(await applyB17Offline(admin), 'applied');
    const inventory = await inventoryB17ContentOffline(admin, seed.targets, seed.sources);
    assert.equal(await applyB17ContentOffline(admin, inventory, seed.sources), 'applied');
  } finally { admin.release(); }
  await assertB17Ready();
  assert.equal((await pool.query(STRUCTURE_SQL)).rows[0].checksum, B17_CONTENT_SHAPE);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM pg_class WHERE relnamespace='public'::regnamespace
    AND relrowsecurity AND NOT relforcerowsecurity`)).rows[0].n, 0);
  pass('f2 guards: fresh named PG18 loopback, non-bypass owner, FORCE, seed-only, readiness green');
  const STRICT = ['clients', 'departments', 'users', 'client_services', 'assignments', 'answers', 'evaluations',
    'approvals', 'staff_lists', 'staff_list_rows', 'review_snapshots'];
  const before: Record<string, number> = {};
  for (const table of [...STRICT, 'audit_log', 'notifications']) before[table] = await count(table);
  const app = express(); app.use(jsonInput, cookieParser()); app.use('/api', apiRouter); app.use(globalJsonErrorHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  type Ctx = { token: string; tabHandle?: string; generation?: number };
  const contexts: Record<string, Ctx | undefined> = {};
  const raw = async (who: string, method: string, path: string, body?: unknown) => {
    const ctx = contexts[who], headers: Record<string, string> = {};
    if (ctx) headers.Authorization = `Bearer ${ctx.token}`;
    if (ctx?.tabHandle) { headers['X-Workspace-Tab'] = ctx.tabHandle; headers['X-Workspace-Version'] = String(ctx.generation); }
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(base + path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text(); return { status: response.status, text, data: JSON.parse(text) };
  };
  try {
    const login = async (email: string) => {
      const r = await raw('anon', 'POST', '/auth/login', { email, password: seed.password });
      assert.equal(r.status, 200, r.text); assert.ok(r.data.token); return r.data.token as string;
    };
    const geContext = async (who: string, tenant?: string) => {
      contexts[who] = { token: await login('ge@domain-d.invalid') };
      const tab = await raw(who, 'POST', '/workspace/tab', {}); assert.equal(tab.status, 201, tab.text);
      Object.assign(contexts[who]!, { tabHandle: tab.data.tabHandle, generation: tab.data.generation });
      if (tenant) { const entered = await raw(who, 'POST', '/workspace/enter', { clientId: tenant });
        assert.equal(entered.status, 200, entered.text); contexts[who]!.generation = entered.data.generation; }
    };
    await geContext('P'); await geContext('W', t.A); await geContext('WB', t.B); await geContext('WH', t.H);
    for (const [who, email] of [['C', 'cA'], ['CH', 'cH'], ['CF', 'cF'], ['E', 'eA']])
      contexts[who] = { token: await login(`${email}@domain-d.invalid`) };
    pass('f2 live P/W(A)/W(B)/W(H)/C/CH/CF/E contexts');

    const clients = await raw('P', 'GET', '/clients'); assert.equal(clients.status, 200, clients.text);
    const expected = (await oracle.query(PROGRESS_ORACLE)).rows;
    const orphan = new Map((await oracle.query(UNMAPPED_ORACLE)).rows.map(r => [r.client_id, r.n]));
    let compared = 0;
    for (const row of clients.data) {
      assert.ok(Array.isArray(row.services));
      for (const service of row.services) {
        const exp = expected.find(e => e.client_id === row.id && e.service_id === service.id); assert.ok(exp);
        assert.deepEqual([service.mappedItemCount, service.assignedPairCount, service.submittedPairCount,
          service.pendingPairCount, service.frozenPairCount],
        [exp.mapped, exp.assigned, exp.submitted, Math.max(0, exp.assigned - exp.submitted), exp.frozen]);
        assert.equal(service.unmapped, exp.mapped === 0, `${row.code}/${service.code}: per-service mapping flag`);
        compared++;
      }
    }
    assert.ok(compared >= 6);
    const servicesOf = (tenant: string) => clients.data.find((row: any) => row.id === tenant).services;
    const empty = servicesOf(t.A).find((v: any) => v.code === 'D-EMPTY'); assert.ok(empty);
    assert.deepEqual([empty.mappedItemCount, empty.unmapped], [0, true], 'QA T1: empty mapping is unmapped');
    assert.equal(servicesOf(t.A).find((v: any) => v.code === 'GRI').unmapped, false);
    assert.equal(orphan.get(t.H), 1, 'H has the deliberately seeded client-level orphan');
    assert.equal(servicesOf(t.H).find((v: any) => v.code === 'GRI').unmapped, false,
      'QA T2: mapped service is NOT flagged by a tenant orphan');
    const text = JSON.stringify(clients.data).replace(/"(?:code|name|industry|statementName)":"[^"]*"/g, '"x"');
    assert.ok(!/(score|gap|coverage|justification|not_applicable|notApplicable|password|otp|value)/i.test(text));
    const frozen = servicesOf(t.F).reduce((n: number, v: any) => n + v.frozenPairCount, 0); assert.ok(frozen >= 1);
    pass(`f2 oracle: ${compared} entries equal; per-service T1=true/T2=false, tenant orphan separate, frozen=${frozen}, no P score/gap/value`);

    const dashA = await raw('C', 'GET', `/client/dashboard?clientId=${t.A}`);
    assert.equal(dashA.status, 200, dashA.text); assert.notEqual(dashA.data.review.aggregateScore, null);
    for (const who of ['CH', 'WH']) {
      const dash = await raw(who, 'GET', `/client/dashboard?clientId=${t.H}`); assert.equal(dash.status, 200, dash.text);
      assert.equal(dash.data.review.aggregateScore, null); assert.equal(dash.data.review.fullGapCount, null);
      assert.ok(dash.data.departments.every((v: any) => v.score === null && v.coveragePercentage === null));
    }
    pass('f2 dashboard L+V: A visible; hidden H aggregate/gap/department fields null for C and W');

    const unmappedCount = async (tenant: string) => withTenantContext(
      { purpose: 'work', role: 'ge_admin', userId: u.ge, mode: 'consultant', tenantId: tenant },
      async c => (await c.query("SELECT b17_catalog_child_count('tenant.unmapped_assignments',$1) n", [tenant])).rows[0].n as number);
    assert.equal(await unmappedCount(t.B), 0);
    const visibleBefore = await raw('WB', 'GET', `/assignments?clientId=${t.B}`);
    assert.equal(visibleBefore.status, 200); assert.equal(visibleBefore.data.count, 1);
    const business = async () => (await oracle.query(`SELECT
      (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]') FROM assignments a WHERE client_id=$1) assignments,
      (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY id),'[]') FROM answers a WHERE client_id=$1) answers,
      (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY id),'[]') FROM evaluations e WHERE client_id=$1) evaluations`, [t.B])).rows[0];
    const retained = await business();
    const unlink = await raw('P', 'DELETE', `/clients/${t.B}/services/${s.S2}`);
    assert.equal(unlink.status, 200, unlink.text); assert.deepEqual(unlink.data, { unlinked: true });
    assert.deepEqual(await business(), retained, 'unlink preserves exact business rows');
    const invisible = await raw('WB', 'GET', `/assignments?clientId=${t.B}`);
    assert.equal(invisible.status, 200); assert.equal(invisible.data.count, 0);
    assert.equal(await unmappedCount(t.B), 1);
    const final = await raw('WB', 'POST', '/reviews/ge-final', { scope: 'tenant', clientId: t.B, confirm: true });
    assert.deepEqual([final.status, final.data.code], [409, 'scope.unmapped']);
    assert.equal((await oracle.query('SELECT count(*)::int n FROM review_snapshots WHERE client_id=$1', [t.B])).rows[0].n, 0);
    pass('f2 unlink: exact business rows retained, visibility revoked, NEXT ge-final 409 scope.unmapped, snapshots=0');

    const ev0 = await count('evaluations'), ans0 = await count('answers');
    const naBody = { clientId: t.A, itemId: actionItem, departmentId: d.A, naReason: 'not-applicable', justification: 'f2' };
    const na = await raw('W', 'POST', '/assignments/na', naBody); assert.equal(na.status, 201, na.text);
    assert.equal(await count('evaluations'), ev0 + 1); assert.equal(await count('answers'), ans0 + 1);
    const ev = (await oracle.query('SELECT not_applicable,score,na_reason,evaluator_id FROM evaluations WHERE client_id=$1 AND item_id=$2', [t.A, actionItem])).rows[0];
    assert.deepEqual([ev.not_applicable, ev.score, ev.na_reason, ev.evaluator_id], [true, null, 'not-applicable', u.ge]);
    assert.equal((await oracle.query('SELECT status FROM answers WHERE client_id=$1 AND item_id=$2 AND department_id=$3', [t.A, actionItem, d.A])).rows[0].status, 'submitted');
    for (const who of ['P', 'C', 'E']) { const r = await raw(who, 'POST', '/assignments/na', naBody);
      assert.deepEqual([r.status, r.data.code], [403, 'workspace.mode_mismatch']); }
    const repeat = await raw('W', 'POST', '/assignments/na', { ...naBody, itemId: seed.draft });
    assert.equal(repeat.status, 409); assert.match(String(repeat.data.error), /already has an evaluation/);
    const foreignDept = await raw('W', 'POST', '/assignments/na', { ...naBody, departmentId: d.B });
    assert.equal(foreignDept.status, 403); assert.match(String(foreignDept.data.error), /not assigned to the department/);
    pass('f2 NA: W creates N/A+submitted answer; P/C/E 403; existing evaluation 409; unassigned department 403');

    const list = await raw('C', 'POST', '/staff-lists', { clientId: t.A,
      rows: [{ email: 'f2@u2f.invalid', name: 'F2', departmentId: d.A, role: 'employee' }] });
    assert.equal(list.status, 201, list.text); assert.ok(!/password_hash|oneTimePassword|"otp"/i.test(list.text));
    const submitted = await raw('C', 'POST', `/staff-lists/${list.data.id}/submit`);
    assert.equal(submitted.status, 200); assert.ok(!/password_hash|oneTimePassword|"otp"/i.test(submitted.text));
    const users0 = await count('users');
    const noTarget = await raw('P', 'POST', `/staff-lists/${list.data.id}/approve`, {});
    assert.deepEqual([noTarget.status, noTarget.data.code], [400, 'scope.id_required']);
    assert.equal(await count('users'), users0, 'missing explicit T provisions nothing');
    assert.equal((await raw('C', 'POST', `/staff-lists/${list.data.id}/reject`, { reason: 'f2' })).status, 403);
    const rejected = await raw('P', 'POST', `/staff-lists/${list.data.id}/reject`, { clientId: t.A, reason: 'f2 P reject' });
    assert.equal(rejected.status, 200, rejected.text); assert.equal(rejected.data.status, 'rejected');
    assert.match(String(rejected.data.reject_reason), /f2 P reject/);
    const stored = (await oracle.query('SELECT * FROM staff_lists WHERE id=$1', [list.data.id])).rows[0];
    assert.ok(!Object.keys(stored).some(k => /otp|password|secret/i.test(k)));
    pass('f2 staff: C draft/submit, P approve requires T (400/users+0), C reject 403, P reject reason retained, no credentials');

    assert.equal((await raw('CF', 'GET', '/clients')).status, 200);
    const suspend = await raw('P', 'PATCH', `/clients/${t.F}`, { suspended: true });
    assert.equal(suspend.status, 200); assert.equal(suspend.data.suspended, true);
    const wall = await raw('anon', 'POST', '/auth/login', { email: 'cF@domain-d.invalid', password: seed.password });
    assert.equal(wall.status, 200); assert.equal(wall.data.suspended, true); assert.ok(!wall.data.token);
    const blocked = await raw('CF', 'GET', '/clients'); assert.deepEqual([blocked.status, blocked.data.code], [403, 'tenant.suspended']);
    for (const who of ['W', 'C', 'E']) { const r = await raw(who, 'PATCH', `/clients/${t.A}`, { suspended: true });
      assert.deepEqual([r.status, r.data.code], [403, 'workspace.mode_mismatch']); }
    assert.equal((await raw('P', 'PATCH', `/clients/${t.F}`, { suspended: false })).status, 200);
    const restored = await raw('anon', 'POST', '/auth/login', { email: 'cF@domain-d.invalid', password: seed.password });
    assert.equal(restored.status, 200); assert.ok(restored.data.token);
    assert.equal((await raw('CF', 'GET', '/clients')).status, 200);
    pass('f2 suspend wall: login200/suspended/no token, existing session403, W/C/E cannot suspend, restore green');

    const expectedDelta: Record<string, number> = { answers: 1, evaluations: 1, client_services: -1, staff_lists: 1, staff_list_rows: 1 };
    const deltas: Record<string, number> = {};
    for (const table of STRICT) { deltas[table] = (await count(table)) - before[table];
      assert.equal(deltas[table], expectedDelta[table] ?? 0, `${table} delta`); }
    assert.ok(await count('audit_log') >= before.audit_log); assert.ok(await count('notifications') >= before.notifications);
    await assertB17Ready(); pass(`f2 exact census ${JSON.stringify(deltas)}; readiness green`);
  } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
}
main().catch(e => { console.error('B17_U2F_F2 proof FAILED:', e); process.exitCode = 1; })
  .finally(async () => { await oracleClient?.end(); await getPool().end(); });
