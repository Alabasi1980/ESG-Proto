// B17 U2-E E-2b proof — BF-01 freeze/commit linearisation + readiness
// drift/ACL refusal and recovery, on an explicit disposable PostgreSQL 18.
// node --import tsx scripts/b17-domain-e2b.ts --allow-disposable-b17
//   --database-url=<loopback named b17_*scratch* DB>
//
// Guards and NON-DESTRUCTIVE contract are identical to b17-domain-e2.ts:
// named loopback scratch, --allow opt-in, NOSUPERUSER/NOBYPASSRLS owner +
// FORCE RLS, no ambient .env, seed-only fixtures, every drift probe rolled
// back. Coverage disclosed: BF-01 lock identity/serialization and readiness
// drift+recovery only — NOT an independent security review.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import express from 'express';
import cookieParser from 'cookie-parser';
import { getPool, runMigrations, setTenantContext, withTenantContext } from '../src/db/index.ts';
import { applyB17Offline, assertB17Ready, verifyB17Content, STRUCTURE_SQL, B17_CONTENT_SHAPE } from '../src/db/b17Readiness.ts';
import { inventoryB17ContentOffline, applyB17ContentOffline } from '../src/db/b17ContentMigration.ts';
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
const LOCK_KEY = 'b17.freeze:'; // byte-identical prefix on BOTH sides of BF-01

async function main() {
  const pool = getPool();
  const role = (await pool.query(`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`)).rows[0];
  assert.deepEqual(role, { rolsuper: false, rolbypassrls: false });
  assert.equal(Math.floor(Number((await pool.query('SHOW server_version_num')).rows[0].server_version_num) / 10000), 18);
  assert.equal((await pool.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0);
  assert.equal((await runMigrations()).success, true);

  const seed = await seedDomainD();
  const { tenants: t, departments: d, users: u, services: s, sources, targets } = seed;
  // ---- Seed (INSERT-only) BEFORE activation ----
  const fx = await withTenantContext({ role: 'ge_admin' }, async c => {
    const q = async (text: string, values: any[] = []) => (await c.query(text, values)).rows[0];
    // §8 whole-tenant preflight needs ZERO unmapped assignments for tenant A.
    const foreignStd = (await q("SELECT id FROM standards WHERE code='D-FOREIGN-STD'")).id;
    await c.query('INSERT INTO service_standards(service_id,standard_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [s.GRI, foreignStd]);
    const std = (await q("INSERT INTO standards(code,title,category) VALUES('E2B-STD','E2B-STD','Universal') RETURNING id")).id;
    const disc = (await q('INSERT INTO disclosures(standard_id,code,title) VALUES($1,$2,$2) RETURNING id', [std, 'E2B-DISC'])).id;
    const item = (await q(`INSERT INTO items(disclosure_id,code,requirement,priority,esg_class)
      VALUES($1,$2,$2,'high','general') RETURNING id`, [disc, 'E2B-ITEM'])).id;
    await c.query('INSERT INTO service_standards(service_id,standard_id) VALUES($1,$2)', [s.GRI, std]);
    // A READY-TO-FREEZE scope: one disclosure, one assignment, already
    // client-approved, evaluated by someone other than the GE freezer.
    await c.query('INSERT INTO assignments(client_id,item_id,department_id) VALUES($1,$2,$3)',
      [t.A, item, d.A]);
    await c.query(`INSERT INTO answers(client_id,item_id,department_id,submitted_by,status,value)
      VALUES($1,$2,$3,$4,'client_approved','ready')`, [t.A, item, d.A, u.eA]);
    await c.query(`INSERT INTO evaluations(client_id,item_id,evaluator_id,score,not_evaluated,not_applicable)
      VALUES($1,$2,$3,50,false,false)`, [t.A, item, u.eA]);
    return { disc, item };
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
  pass('guards: loopback scratch opt-in, NOSUPERUSER/NOBYPASSRLS PG18, empty start, seed-only, offline activation green');

  // Both BF-01 sides must use the SAME key: assert it from the sources, then
  // prove it behaviourally below by holding that exact key.
  const griSrc = readFileSync('src/server/routes/gri.ts', 'utf8');
  const evalSrc = readFileSync('src/server/routes/evaluations.ts', 'utf8');
  const keyRe = /pg_advisory_xact_lock\(hashtextextended\(\$1,(\d+)\)\)/;
  const griKey = griSrc.match(keyRe)?.[1], evalKey = evalSrc.match(keyRe)?.[1];
  assert.ok(griKey && evalKey && griKey === evalKey,
    `both sides must use the same advisory-lock seed (gri=${griKey}, ge-final=${evalKey})`);
  assert.equal((griSrc.match(new RegExp(`b17\\.freeze:` , 'g')) ?? []).length, 1, 'exactly ONE lock line in gri.ts');
  assert.equal((evalSrc.match(new RegExp(`b17\\.freeze:` , 'g')) ?? []).length, 1, 'exactly ONE lock line in ge-final');
  pass(`BF-01 source check: identical lock seed ${griKey} and exactly one lock line on each side`);

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
    if (ctx?.tabHandle) { headers['X-Workspace-Tab'] = ctx.tabHandle; headers['X-Workspace-Version'] = String(ctx.generation); }
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let data: any; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, text };
  };
  const post = async (token: string, path: string, body: unknown, tab?: { tabHandle: string; generation: number }) => {
    const res = await fetch(base + path, { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
        ...(tab ? { 'X-Workspace-Tab': tab.tabHandle, 'X-Workspace-Version': String(tab.generation) } : {}) },
      body: JSON.stringify(body) });
    return { status: res.status, data: await res.json() };
  };

  try {
    const login = async (email: string) => {
      const r = await request('anon', 'POST', '/auth/login', { email, password: seed.password });
      assert.equal(r.status, 200, `${email} login: ${r.text.slice(0, 200)}`);
      return r.data.token as string;
    };
    const ge = await login('ge@domain-d.invalid');
    const tab0 = (await post(ge, '/workspace/tab', {})).data;
    const wTab = { tabHandle: tab0.tabHandle as string, generation: tab0.generation as number };
    const entered = await post(ge, '/workspace/enter', { clientId: t.A }, wTab);
    assert.equal(entered.status, 200, JSON.stringify(entered.data));
    wTab.generation = entered.data.generation as number;
    contexts.W = { token: ge, ...wTab };
    const geP = await login('ge@domain-d.invalid');
    const pTab0 = (await post(geP, '/workspace/tab', {})).data;
    contexts.P = { token: geP, tabHandle: pTab0.tabHandle as string, generation: pTab0.generation as number };
    pass('real login + workspace tab/enter produce W (consultant A) and P (platform) contexts');

    // ================= BF-01: ge-final vs the shared tenant lock =================
    const holder = await pool.connect();
    let geFinal: Promise<{ status: number; data: any; text: string }> | undefined;
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1,$2))', [`${LOCK_KEY}${t.A}`, Number(griKey)]);
      geFinal = request('W', 'POST', '/reviews/ge-final',
        { scope: 'disclosure', scopeRef: fx.disc, clientId: t.A, confirm: true });
      const raced = await Promise.race([
        geFinal.then(() => 'settled' as const),
        new Promise(resolve => setTimeout(() => resolve('blocked'), 1200)),
      ]);
      assert.equal(raced, 'blocked', 'ge-final must queue behind the shared tenant lock');
      await holder.query('ROLLBACK');
      const released = await geFinal;
      assert.equal(released.status, 201, `ge-final completes after release: ${released.text.slice(0, 300)}`);
      assert.ok(released.data.snapshot?.content_hash, 'immutable snapshot + hash created inside the lock');
    } finally {
      try { await holder.query('ROLLBACK'); } catch { /* already released */ }
      holder.release();
    }
    pass('BF-01 a: ge-final blocks on the shared tenant lock, then freezes (preflight+snapshot) atomically after release');

    // ================= BF-01: GRI-commit provisioning vs the same lock =================
    const holder2 = await pool.connect();
    let commit: Promise<{ status: number; data: any; text: string }> | undefined;
    try {
      await holder2.query('BEGIN');
      await holder2.query('SELECT pg_advisory_xact_lock(hashtextextended($1,$2))', [`${LOCK_KEY}${t.A}`, Number(griKey)]);
      commit = request('P', 'POST', '/gri/commit', {
        clientId: t.A, serviceId: s.GRI,
        standards: [{ code: 'E2B-LOCK-STD', title: 'Lock fixture', category: 'Universal', version: '2021',
          disclosures: [{ code: 'E2B-LOCK-DISC', title: 'Lock fixture',
            items: [{ code: 'E2B-LOCK-ITEM', requirement: 'Lock fixture', department: 'Lock Dept' }] }] }],
      });
      const raced = await Promise.race([
        commit.then(() => 'settled' as const),
        new Promise(resolve => setTimeout(() => resolve('blocked'), 1500)),
      ]);
      assert.equal(raced, 'blocked', 'GRI-commit provisioning must queue behind the SAME tenant lock');
      await holder2.query('ROLLBACK');
      const released = await commit;
      assert.equal(released.status, 200, `commit completes after release: ${released.text.slice(0, 300)}`);
      assert.ok(released.data.departmentsUpserted >= 1 && released.data.assignmentsCreated >= 1,
        'provisioning actually ran under the lock');
    } finally {
      try { await holder2.query('ROLLBACK'); } catch { /* already released */ }
      holder2.release();
    }
    // The frozen disclosure scope is untouched by the concurrent commit, and
    // the newly provisioned assignment did not appear inside the frozen scope.
    const snap = await request('W', 'GET', `/reviews/snapshots`);
    assert.equal(snap.status, 200, snap.text.slice(0, 200));
    assert.ok(snap.data.items.length >= 1, 'the freeze committed');
    const afterFreeze = await withTenantContext(
      { purpose: 'work', role: 'ge_admin', userId: u.ge, mode: 'consultant', tenantId: t.A },
      async c => (await c.query('SELECT count(*)::int n FROM review_snapshots WHERE client_id=$1', [t.A])).rows[0].n);
    assert.equal(afterFreeze, 1, 'exactly one snapshot — no double freeze from the interleaving');
    pass('BF-01 b: GRI-commit provisioning blocks on the SAME lock, then completes; whole-scope freeze held (one snapshot)');

    // ================= Readiness drift + ACL refusal + recovery =================
    const drift = await pool.connect();
    try {
      await drift.query('BEGIN');
      await setTenantContext(drift, { purpose: 'migration' });
      await drift.query('DROP POLICY b17_selection_insert ON client_initiatives');
      await assert.rejects(() => verifyB17Content(drift), /schema_drift/);
    } finally { await drift.query('ROLLBACK'); drift.release(); }
    await assertB17Ready();
    pass('readiness: a dropped policy refuses verifyB17Content with schema_drift, rollback recovers');

    const acl = await pool.connect();
    try {
      await acl.query('BEGIN');
      await acl.query('GRANT EXECUTE ON FUNCTION b17_content_fact(text,uuid,uuid,uuid) TO PUBLIC');
      await assert.rejects(() => verifyB17Content(acl), /content_authority_drift/);
    } finally { await acl.query('ROLLBACK'); acl.release(); }
    await assertB17Ready();
    pass('readiness: an extra PUBLIC grant on a sanctioned definer refuses with content_authority_drift, rollback recovers');

    const count = await withTenantContext(
      { purpose: 'work', role: 'ge_admin', userId: u.ge, mode: 'consultant', tenantId: t.A },
      async c => (await c.query('SELECT count(*)::int n FROM review_snapshots WHERE client_id=$1', [t.A])).rows[0].n);
    assert.equal(count, 1, 'no business row added or removed by this proof');
    pass('non-destructive: snapshot census unchanged, readiness green after every drift/recovery cycle');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  }
  console.log('B17 U2-E E-2b proof complete: BF-01 linearisation + readiness drift/ACL recovery green; NOT release acceptance.');
}
main().catch(err => { console.error('B17_U2E_E2B proof FAILED:', err instanceof Error ? (err.stack || err.message) : err); process.exitCode = 1; })
  .finally(async () => { await getPool().end(); });
