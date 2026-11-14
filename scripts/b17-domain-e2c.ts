// B17 U2-E E-2c proof — §10 round-3 ruling 1 (lock-bracketed truthful §8
// preflight) + readiness drift/ACL recovery, on an explicit disposable
// PostgreSQL 18 with an INDEPENDENT superuser oracle.
// node --import tsx scripts/b17-domain-e2c.ts --allow-disposable-b17
//   --database-url=<loopback named b17_*scratch* DB>
//   --oracle-url=postgres://postgres@127.0.0.1:<same port>/<same db>
//
// NON-DESTRUCTIVE: seed-only fixtures, no business-row DELETE/UPDATE, every
// drift probe rolled back. No ambient .env. Coverage disclosed: §8 preflight
// truthfulness, the QA Q-probe, the BF-01 reverse window and readiness
// recovery — NOT an independent security review.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import express from 'express';
import cookieParser from 'cookie-parser';
import pg from 'pg';
import { getPool, runMigrations, setTenantContext, withTenantContext } from '../src/db/index.ts';
import { applyB17Offline, assertB17Ready, verifyB17Content, STRUCTURE_SQL, B17_CONTENT_SHAPE } from '../src/db/b17Readiness.ts';
import { inventoryB17ContentOffline, applyB17ContentOffline } from '../src/db/b17ContentMigration.ts';
import { hashPassword } from '../src/server/auth.ts';
import { seedDomainD } from './b17-domain-d-fixture.ts';
import apiRouter from '../src/server/routes.ts';
import { jsonInput } from '../src/server/jsonInput.ts';
import { globalJsonErrorHandler } from '../src/server/errorHandler.ts';

function guardedUrl(args: string[]): { owner: string; oracle: string } {
  if (!args.includes('--allow-disposable-b17')) throw new Error('Explicit disposable B17 opt-in required.');
  const urls = args.filter(arg => arg.startsWith('--database-url='));
  const oracles = args.filter(arg => arg.startsWith('--oracle-url='));
  if (urls.length !== 1 || oracles.length !== 1) throw new Error('One scratch URL and one oracle URL required.');
  if (existsSync('.env') || process.env.DATABASE_URL || process.env.JWT_SECRET)
    throw new Error('Refusing ambient .env / DATABASE_URL / JWT_SECRET.');
  const url = new URL(urls[0].slice('--database-url='.length));
  const oracle = new URL(oracles[0].slice('--oracle-url='.length));
  for (const u of [url, oracle]) {
    if (!['postgres:', 'postgresql:'].includes(u.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)
      || !/^\/b17_[a-z0-9_]*scratch[a-z0-9_]*$/.test(u.pathname) || u.search || u.hash)
      throw new Error('Only named disposable loopback scratch URLs accepted.');
  }
  if (!url.username || url.username === 'postgres') throw new Error('Owner URL must not be the oracle superuser.');
  if (oracle.username !== 'postgres' || oracle.hostname !== url.hostname || oracle.port !== url.port
    || oracle.pathname !== url.pathname) throw new Error('Oracle must be the superuser on the SAME scratch database.');
  return { owner: url.toString(), oracle: oracle.toString() };
}
const urls = guardedUrl(process.argv.slice(2));
process.env.DATABASE_URL = urls.owner;
process.env.JWT_SECRET = randomBytes(48).toString('hex');
process.env.B17_SCRATCH_OPT_IN = 'YES';
const pass = (label: string) => console.log(`PASS ${label}`);
// Ended in the top-level finally so an early assertion failure cannot leave the
// oracle socket holding the event loop open (the proof would hang instead of
// exiting non-zero).
let oracleConn: pg.Client | undefined;
const LOCK_SEED = 1717005;
// Independent ground truth: a superuser read with NO RLS at all.
const ORACLE_UNMAPPED = `SELECT count(*)::int n FROM assignments a JOIN items i ON i.id=a.item_id
  WHERE a.client_id=$1 AND NOT EXISTS (SELECT 1 FROM disclosures ld
    JOIN service_standards ls ON ls.standard_id=ld.standard_id
    JOIN client_services lc ON lc.service_id=ls.service_id AND lc.client_id=$1
    WHERE ld.id=i.disclosure_id)`;

async function main() {
  const pool = getPool();
  const role = (await pool.query(`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`)).rows[0];
  assert.deepEqual(role, { rolsuper: false, rolbypassrls: false }, 'runtime role must be NOSUPERUSER/NOBYPASSRLS');
  assert.equal(Math.floor(Number((await pool.query('SHOW server_version_num')).rows[0].server_version_num) / 10000), 18);
  assert.equal((await pool.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0,
    'Scratch must start empty; never reset or replay an existing application DB.');
  assert.equal((await runMigrations()).success, true);

  const seed = await seedDomainD();
  const { tenants: t, users: u, services: s, sources, targets } = seed;
  // ---- Seed (INSERT-only) BEFORE activation: Q (the QA probe), R (complete),
  // Tf (the BF-01 reverse-window tenant). ----
  const fx = await withTenantContext({ role: 'ge_admin' }, async c => {
    const q = async (text: string, values: any[] = []) => (await c.query(text, values)).rows[0];
    const hash = await hashPassword(seed.password);
    const client = async (code: string) => (await q('INSERT INTO clients(code,name) VALUES($1,$1) RETURNING id', [code])).id;
    const dept = async (tenant: string) =>
      (await q("INSERT INTO departments(client_id,code,name) VALUES($1,'one','One') RETURNING id", [tenant])).id;
    const emp = async (name: string, tenant: string, department: string) =>
      (await q(`INSERT INTO users(email,password_hash,name,role,client_id,department_id)
        VALUES($1,$2,$3,'employee',$4,$5) RETURNING id`, [`${name}@e2c.invalid`, hash, name, tenant, department])).id;
    const std = async (code: string) => (await q("INSERT INTO standards(code,title,category) VALUES($1,$1,'Universal') RETURNING id", [code])).id;
    const disc = async (stdId: string, code: string) =>
      (await q('INSERT INTO disclosures(standard_id,code,title) VALUES($1,$2,$2) RETURNING id', [stdId, code])).id;
    const item = async (discId: string, code: string) =>
      (await q(`INSERT INTO items(disclosure_id,code,requirement,priority,esg_class)
        VALUES($1,$2,$2,'high','general') RETURNING id`, [discId, code])).id;
    const map = async (stdId: string) =>
      c.query('INSERT INTO service_standards(service_id,standard_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [s.GRI, stdId]);
    const assign = (tenant: string, itemId: string, department: string) =>
      c.query('INSERT INTO assignments(client_id,item_id,department_id) VALUES($1,$2,$3)', [tenant, itemId, department]);
    const answer = (tenant: string, itemId: string, department: string, by: string, status: string) =>
      c.query(`INSERT INTO answers(client_id,item_id,department_id,submitted_by,status,value)
        VALUES($1,$2,$3,$4,$5,'e2c')`, [tenant, itemId, department, by, status]);
    const evaluation = (tenant: string, itemId: string, by: string) =>
      c.query(`INSERT INTO evaluations(client_id,item_id,evaluator_id,score,not_evaluated,not_applicable)
        VALUES($1,$2,$3,50,false,false)`, [tenant, itemId, by]);

    const link = async (tenant: string) =>
      c.query('INSERT INTO client_services(client_id,service_id,show_gap,show_corrective) VALUES($1,$2,true,true)',
        [tenant, s.GRI]);

    // Q — QA's exact probe: 1 linked+complete assignment + 1 never-linked.
    const qTenant = await client('E2C-Q'), qDept = await dept(qTenant), qEmp = await emp('e2c-q', qTenant, qDept);
    await link(qTenant);
    const qStd1 = await std('E2C-Q1-STD'); await map(qStd1);
    const qItem1 = await item(await disc(qStd1, 'E2C-Q1-DISC'), 'E2C-Q1-ITEM');
    await assign(qTenant, qItem1, qDept); await answer(qTenant, qItem1, qDept, qEmp, 'client_approved');
    await evaluation(qTenant, qItem1, qEmp);
    const qStd2 = await std('E2C-Q2-STD'); // deliberately NEVER mapped
    const qItem2 = await item(await disc(qStd2, 'E2C-Q2-DISC'), 'E2C-Q2-ITEM');
    await assign(qTenant, qItem2, qDept); await answer(qTenant, qItem2, qDept, qEmp, 'draft');
    await evaluation(qTenant, qItem2, qEmp);

    // R — a COMPLETE tenant (every assignment linked and client-approved).
    const rTenant = await client('E2C-R'), rDept = await dept(rTenant), rEmp = await emp('e2c-r', rTenant, rDept);
    await link(rTenant);
    const rStd = await std('E2C-R-STD'); await map(rStd);
    const rDisc = await disc(rStd, 'E2C-R-DISC');
    const rItem1 = await item(rDisc, 'E2C-R-ITEM-1'), rItem2 = await item(rDisc, 'E2C-R-ITEM-2');
    for (const it of [rItem1, rItem2]) {
      await assign(rTenant, it, rDept); await answer(rTenant, it, rDept, rEmp, 'client_approved');
      await evaluation(rTenant, it, rEmp);
    }

    // Tf — the BF-01 reverse-window tenant (unfrozen at the commit's pre-lock
    // read; frozen by the holder while the commit is blocked on the lock).
    const tfTenant = await client('E2C-TF');
    await c.query('INSERT INTO client_services(client_id,service_id,show_gap,show_corrective) VALUES($1,$2,true,true)',
      [tfTenant, s.GRI]);
    return { qTenant, qDept, qItem1, qItem2, rTenant, rItem1, rItem2, tfTenant };
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
  pass('guards: loopback scratch opt-in, NOSUPERUSER/NOBYPASSRLS PG18, empty start, seed-only, offline activation green, FORCE RLS');

  const oracle = new pg.Client({ connectionString: urls.oracle });
  oracleConn = oracle;
  await oracle.connect();
  const oracleCount = async (tenant: string) =>
    (await oracle.query(ORACLE_UNMAPPED, [tenant])).rows[0].n as number;
  // The handler's own path: the count-only definer under the W work context.
  const definerCount = async (tenant: string) => withTenantContext(
    { purpose: 'work', role: 'ge_admin', userId: u.ge, mode: 'consultant', tenantId: tenant },
    async c => (await c.query("SELECT b17_catalog_child_count('tenant.unmapped_assignments',$1) AS n",
      [tenant])).rows[0].n as number);
  const snapshotsOf = async (tenant: string) => withTenantContext(
    { purpose: 'work', role: 'ge_admin', userId: u.ge, mode: 'consultant', tenantId: tenant },
    async c => (await c.query('SELECT count(*)::int n FROM review_snapshots WHERE client_id=$1', [tenant])).rows[0].n as number);
  const pairRows = async (tenants: string[]) => (await oracle.query(
    `SELECT (SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb) FROM assignments a WHERE a.client_id=ANY($1))
      || (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb) FROM answers x WHERE x.client_id=ANY($1))
      || (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY e.id),'[]'::jsonb) FROM evaluations e WHERE e.client_id=ANY($1)) AS rows`,
    [tenants])).rows[0].rows;

  // ---- R1a: independent-oracle equality for the preflight count ----
  const equality = async (tenant: string): Promise<number[]> => [await definerCount(tenant), await oracleCount(tenant)];
  const qPair = await equality(fx.qTenant);
  assert.deepEqual(qPair, [1, 1], `Q definer/oracle must both be 1: got ${JSON.stringify(qPair)}`);
  const rPair = await equality(fx.rTenant);
  assert.deepEqual(rPair, [0, 0], `R definer/oracle must both be 0: got ${JSON.stringify(rPair)}`);
  const aPair = await equality(t.A);
  assert.deepEqual(aPair, [1, 1], `A definer/oracle must both be 1: got ${JSON.stringify(aPair)}`);
  pass('R1a oracle equality: preflight definer == independent superuser oracle on Q(1), R(0), A(1)');

  const pairsBefore = await pairRows([fx.qTenant, fx.rTenant]);

  const app = express();
  app.use(jsonInput); app.use(cookieParser()); app.use('/api', apiRouter); app.use(globalJsonErrorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  const wCtx: { token: string; tabHandle: string; generation: number } = { token: '', tabHandle: '', generation: 0 };
  let inW = false;
  const post = async (token: string, path: string, body: unknown, tab?: { tabHandle: string; generation: number }) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (tab) { headers['X-Workspace-Tab'] = tab.tabHandle; headers['X-Workspace-Version'] = String(tab.generation); }
    const res = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
    return { status: res.status, data: await res.json() };
  };
  const call = async (method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { Authorization: `Bearer ${wCtx.token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (wCtx.tabHandle) { headers['X-Workspace-Tab'] = wCtx.tabHandle; headers['X-Workspace-Version'] = String(wCtx.generation); }
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let data: any; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, text };
  };
  const goto = async (tenant: string | null) => {
    if (inW) {
      const x = await post(wCtx.token, '/workspace/exit', {}, wCtx);
      assert.equal(x.status, 200, JSON.stringify(x.data));
      wCtx.generation = x.data.generation as number; inW = false;
    }
    if (tenant) {
      const e = await post(wCtx.token, '/workspace/enter', { clientId: tenant }, wCtx);
      assert.equal(e.status, 200, JSON.stringify(e.data));
      wCtx.generation = e.data.generation as number; inW = true;
    }
  };

  try {
    const login = async (email: string) => {
      const r = await post('', '/auth/login', { email, password: seed.password });
      assert.equal(r.status, 200, `${email} login: ${JSON.stringify(r.data).slice(0, 200)}`);
      return r.data.token as string;
    };
    wCtx.token = await login('ge@domain-d.invalid');
    const tab0 = (await post(wCtx.token, '/workspace/tab', {})).data;
    wCtx.tabHandle = tab0.tabHandle as string; wCtx.generation = tab0.generation as number;
    pass('real login + workspace tab ready (P until entered)');

    // ===== HEADLINE — QA's exact Q-probe: 1 linked+complete + 1 never-linked =====
    await goto(fx.qTenant);
    const probe = await call('POST', '/reviews/ge-final',
      { scope: 'tenant', scopeRef: fx.qTenant, clientId: fx.qTenant, confirm: true });
    assert.equal(probe.status, 409, `Q-probe must be refused: ${probe.text.slice(0, 300)}`);
    assert.equal(probe.data.code ?? probe.data.error, 'scope.unmapped',
      `exact code scope.unmapped: ${probe.text.slice(0, 300)}`);
    assert.equal(await snapshotsOf(fx.qTenant), 0, 'ZERO snapshot created for Q');
    assert.equal(await oracleCount(fx.qTenant), 1, 'ground truth still 1 unmapped (the count did not lie)');
    pass(`HEADLINE Q-probe: tenant Q (1 linked+complete + 1 never-linked) -> 409 scope.unmapped, snapshots(Q)=0 (oracle=1)`);

    // ===== Complete tenant still freezes, with the FULL authorized payload =====
    await goto(fx.rTenant);
    const complete = await call('POST', '/reviews/ge-final',
      { scope: 'tenant', scopeRef: fx.rTenant, clientId: fx.rTenant, confirm: true });
    assert.equal(complete.status, 201, `complete tenant must freeze: ${complete.text.slice(0, 400)}`);
    const payloadItems = complete.data.snapshot?.payload?.items ?? [];
    assert.equal(payloadItems.length, 2, 'FULL authorized scope — never a filtered subset');
    assert.deepEqual(payloadItems.map((i: any) => i.itemId).sort(), [fx.rItem1, fx.rItem2].sort(),
      'every authorized item is in the payload');
    assert.equal(await oracleCount(fx.rTenant), 0, 'oracle still agrees the tenant is complete');
    pass('R1 complete tenant: ge-final 201 with FULL 2-of-2 payload (no subset filtering)');

    // ===== BF-01 reverse window: freeze lands while the commit holds/waits =====
    const holder = await pool.connect();
    let commit: Promise<{ status: number; data: any; text: string }> | undefined;
    try {
      await holder.query('BEGIN');
      await setTenantContext(holder, { purpose: 'work', role: 'ge_admin', userId: u.ge,
        mode: 'consultant', tenantId: fx.tfTenant });
      await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1,$2))',
        [`b17.freeze:${fx.tfTenant}`, LOCK_SEED]);
      // The commit does its pre-lock freeze read NOW (Tf is still unfrozen),
      // then blocks on the lock we are holding.
      const pCtx: { token: string; tabHandle: string; generation: number } = { token: '', tabHandle: '', generation: 0 };
      pCtx.token = await login('ge@domain-d.invalid');
      const pTab = (await post(pCtx.token, '/workspace/tab', {})).data;
      pCtx.tabHandle = pTab.tabHandle as string; pCtx.generation = pTab.generation as number;
      commit = (async () => {
        const res = await fetch(base + '/gri/commit', { method: 'POST',
          headers: { Authorization: `Bearer ${pCtx.token}`, 'Content-Type': 'application/json',
            'X-Workspace-Tab': pCtx.tabHandle, 'X-Workspace-Version': String(pCtx.generation) },
          body: JSON.stringify({ clientId: fx.tfTenant, serviceId: s.GRI,
            standards: [{ code: 'E2C-LOCK-STD', title: 'Lock fixture', category: 'Universal', version: '2021',
              disclosures: [{ code: 'E2C-LOCK-DISC', title: 'Lock fixture',
                items: [{ code: 'E2C-LOCK-ITEM', requirement: 'Lock fixture', department: 'Lock Dept' }] }] }] }) });
        const text = await res.text();
        let data: any; try { data = JSON.parse(text); } catch { data = text; }
        return { status: res.status, data, text };
      })();
      const raced = await Promise.race([
        commit.then(() => 'settled' as const),
        new Promise(resolve => setTimeout(() => resolve('blocked'), 1500)),
      ]);
      if (raced !== 'blocked') {
        const outcome = await commit;
        throw new Error(`the commit must queue on the shared tenant lock: ${outcome.status} ${outcome.text.slice(0, 300)}`);
      }
      // Freeze Tf while the commit is blocked — the reverse window.
      await holder.query(
        `INSERT INTO review_snapshots(client_id,scope_type,scope_ref,payload,content_hash,created_by)
         VALUES($1,'tenant',$2,'{}','e2c-frozen',$3)`, [fx.tfTenant, fx.tfTenant, u.ge]);
      await holder.query('COMMIT');
      const released = await commit;
      assert.equal(released.status, 200, `commit completes after release: ${released.text.slice(0, 300)}`);
      assert.equal(released.data.departmentsUpserted, 0,
        'in-lock freeze recheck: provisioning must be SKIPPED on a frozen tenant');
      assert.equal(released.data.assignmentsCreated, 0,
        'in-lock freeze recheck: no assignment may land after the freeze');
    } finally {
      try { await holder.query('ROLLBACK'); } catch { /* committed or already released */ }
      holder.release();
    }
    assert.equal(await snapshotsOf(fx.tfTenant), 1, 'the reverse-window freeze committed exactly once');
    pass('R1b BF-01 reverse window: commit blocks on the lock, freeze lands meanwhile, in-lock recheck skips provisioning (0/0)');

    // ===== Readiness drift + ACL refusal + recovery =====
    const drift = await pool.connect();
    try {
      await drift.query('BEGIN');
      await setTenantContext(drift, { purpose: 'migration' });
      await drift.query('DROP POLICY b17_selection_insert ON client_initiatives');
      await assert.rejects(() => verifyB17Content(drift), /schema_drift/);
    } finally { await drift.query('ROLLBACK'); drift.release(); }
    await assertB17Ready();
    const acl = await pool.connect();
    try {
      await acl.query('BEGIN');
      await acl.query('GRANT EXECUTE ON FUNCTION b17_content_fact(text,uuid,uuid,uuid) TO PUBLIC');
      await assert.rejects(() => verifyB17Content(acl), /content_authority_drift/);
    } finally { await acl.query('ROLLBACK'); acl.release(); }
    await assertB17Ready();
    pass('readiness: dropped policy -> schema_drift, extra PUBLIC grant -> content_authority_drift, both recover on rollback');

    // ===== Non-destructive: the seeded Q/R workflow rows are byte-identical =====
    assert.deepEqual(await pairRows([fx.qTenant, fx.rTenant]), pairsBefore,
      'no pre-existing assignment/answer/evaluation row was updated or removed');
    pass('non-destructive: Q+R assignment/answer/evaluation rows byte-identical, readiness green');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
    await oracle.end();
  }
  console.log('B17 U2-E E-2c proof complete: truthful §8 preflight + BF-01 reverse window + readiness recovery; NOT release acceptance.');
}
main().catch(err => { console.error('B17_U2E_E2C proof FAILED:', err instanceof Error ? (err.stack || err.message) : err); process.exitCode = 1; })
  .finally(async () => { await oracleConn?.end().catch(() => {}); await getPool().end(); });
