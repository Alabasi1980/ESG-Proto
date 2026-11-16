// TASK-PROTO-U4-1a — own-scratch measurement + behaviour proof.
//
// WHY: the three STRUCTURE_SQL constants must be re-measured on a real PG18
// catalog AFTER the three additive columns exist, and the falsifiability claim
// ("dropping them restores the PREVIOUS md5") must be shown, not asserted. This
// script also proves the C-only mask read, the defensive stored-value read, and
// the RLS fact behind the U4-1a step-5 ASK (W cannot UPDATE client_services).
//
// Own throwaway container only (created/removed by the caller), one fresh named
// database, generated credentials, ambient DSNs/.env refused.
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { getPool, runMigrations, setTenantContext } from '../src/db/index.ts';
import { STRUCTURE_SQL, b17Source, b17ContentSource, assertB17ContentAuthority }
  from '../src/db/b17Readiness.ts';
import { maskedItemFields, resolveLinkedService, serviceFieldMask } from '../src/server/scope.ts';
import { parseVisibilityBody, storedClientFieldMask } from '../src/lib/clientFieldMask.ts';
import type { AccessContext } from '../src/lib/capabilities.ts';

// Pre-U4-1a constants measured at HEAD (0edf250) — the falsifiability oracle.
const PREDECESSOR_OLD = '62e7586e86f7b2fe7035e7992279a613';
const B17_OLD = 'bbcb018ee1d1655b36c3a0745e3536ae';
const CONTENT_OLD = '5def29de961f3ee64a783e65f9c1501b';
const A = '11111111-1111-4111-8111-111111111111';
const S = '22222222-2222-4222-8222-222222222222';
const S2 = '33333333-3333-4333-8333-333333333333';
const STANDARD = '44444444-4444-4444-8444-444444444444';
const DISCLOSURE = '55555555-5555-4555-8555-555555555555';
const ITEM = '66666666-6666-4666-8666-666666666666';
const ACTOR = '77777777-7777-4777-8777-777777777777';
const SESSION = '88888888-8888-4888-8888-888888888888';
const DEPT = '99999999-9999-4999-8999-999999999999';
const DDL = [
  'ALTER TABLE items ADD COLUMN attachment_required BOOLEAN NOT NULL DEFAULT false',
  "ALTER TABLE services ADD COLUMN settings JSONB NOT NULL DEFAULT '{}'::jsonb",
  'ALTER TABLE client_services ADD COLUMN client_field_mask JSONB NULL',
];
const DROPS = ['ALTER TABLE items DROP COLUMN attachment_required',
  'ALTER TABLE services DROP COLUMN settings',
  'ALTER TABLE client_services DROP COLUMN client_field_mask'];
setTimeout(() => { console.error('WATCHDOG: scratch proof stalled'); process.exit(9); }, 180000).unref();

const args = process.argv.slice(2);
if (!args.includes('--allow-disposable-b17') || process.env.DATABASE_URL || process.env.JWT_SECRET
  || Object.keys(process.env).some(k => /^PG(HOST|PORT|USER|PASSWORD|DATABASE|SERVICE)/.test(k))
  || (existsSync('.env') && !args.includes('--own-scratch-ignore-env-file')))
  throw new Error('Explicit isolated opt-in required; ambient config refused');
const one = (key: string) => {
  const values = args.filter(a => a.startsWith(`--${key}=`));
  if (values.length !== 1) throw new Error(`One explicit ${key} required`);
  return new URL(values[0].slice(key.length + 3));
};
const url = one('database-url'), oracleUrl = one('oracle-url');
if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1'
  || !/^\/u41_scratch_\d+$/.test(url.pathname) || !url.port || url.search || url.hash
  || url.username !== 'u41owner') throw new Error('Only own named loopback scratch accepted');
if (oracleUrl.host !== url.host || oracleUrl.pathname !== url.pathname || oracleUrl.username !== 'postgres')
  throw new Error('Oracle must be exact same scratch');
process.env.DATABASE_URL = url.toString();
process.env.JWT_SECRET = randomBytes(48).toString('hex');

const pool = getPool();
const oracle = new pg.Client({ connectionString: oracleUrl.toString() });
const log = (m: string) => console.log(m);
const pass = (m: string) => console.log(`PASS ${m}`);
const shape = async (client: pg.PoolClient | pg.Client) =>
  (await client.query(STRUCTURE_SQL)).rows[0].checksum as string;
const ddl = async (client: pg.PoolClient | pg.Client, list: string[]) => {
  for (const statement of list) await client.query(statement);
};
const asCtx = async <T>(ctx: Record<string, string | null>, operation: (c: pg.PoolClient) => Promise<T>) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setTenantContext(client, ctx);
    return await operation(client);
  } finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
};
/** Committing twin for the POSITIVE W write (asCtx always rolls back). */
const asCtxCommit = async <T>(ctx: Record<string, string | null>, operation: (c: pg.PoolClient) => Promise<T>) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setTenantContext(client, ctx);
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
};
const access = (mode: AccessContext['mode'], role: AccessContext['role']): AccessContext => ({
  actorId: ACTOR, sessionId: SESSION, role, mode, tenantId: A,
  departmentId: mode === 'employee' ? DEPT : null, tabId: mode === 'platform' || mode === 'consultant' ? SESSION : null,
  generation: mode === 'platform' || mode === 'consultant' ? 1 : null, capability: 'u41-proof',
});
const C_CTX = { role: 'client_admin', mode: 'client', purpose: 'work', tenantId: A, userId: ACTOR,
  sessionId: SESSION, departmentId: null, tabId: null, targetId: null };
const W_CTX = { role: 'ge_admin', mode: 'consultant', purpose: 'work', tenantId: A, userId: ACTOR,
  sessionId: SESSION, departmentId: null, tabId: SESSION, targetId: null };
const P_CTX = { role: 'ge_admin', mode: 'platform', purpose: 'platform.config', tenantId: A, userId: ACTOR,
  sessionId: SESSION, departmentId: null, tabId: SESSION, targetId: A };

let owner: pg.PoolClient | undefined;
try {
  await oracle.connect();
  await oracle.query("SET lock_timeout='20s'");
  assert.equal(Math.floor(Number((await oracle.query('SHOW server_version_num')).rows[0].server_version_num) / 10000), 18);
  assert.deepEqual((await pool.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0],
    { rolsuper: false, rolbypassrls: false }, 'runtime owner is NOSUPERUSER/NOBYPASSRLS');
  assert.equal((await pool.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0);

  // Baselines on separate empty DBs. (1) HEAD schema + HEAD content validates
  // the stored pre-U4 constants; (2) HEAD schema + NEW content (the added W
  // policy, no U4 columns) is the content oracle the column-drop must restore.
  const baseline = async (suffix: string, schema: string, contentSql: string) => {
    const dbName = url.pathname.slice(1) + suffix;
    await oracle.query(`CREATE DATABASE "${dbName}" OWNER u41owner`);
    const headUrl = new URL(url.toString()); headUrl.pathname = `/${dbName}`;
    const headPool = new pg.Pool({ connectionString: headUrl.toString() });
    try {
      const c = await headPool.connect();
      await c.query('BEGIN'); await c.query(schema); await c.query('COMMIT');
      const pre = await shape(c);
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.b17_checksum',$1,true)", [b17Source().checksum]);
      await c.query(b17Source().sql);
      const u1 = await shape(c);
      await c.query("SELECT set_config('app.current_purpose','migration',true)");
      await c.query('INSERT INTO app_schema_versions(version,checksum,structure_checksum) VALUES($1,$2,$3)',
        ['B17_U1', b17Source().checksum, u1]);
      await c.query('COMMIT');
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_purpose','migration.inventory',true)");
      await c.query(contentSql);
      const content = await shape(c);
      await c.query('COMMIT');
      c.release();
      return { pre, u1, content };
    } finally { await headPool.end().catch(() => {}); }
  };
  // runMigrations executes the WORKING-TREE file verbatim, and this checkout is
  // CRLF; function bodies therefore carry CRLF and the pinned md5s were measured
  // that way. Emulate the initializer (not an LF-normalized copy).
  const headSchemaSql = execFileSync('git', ['show', '0edf250:src/db/schema.sql'], { encoding: 'utf8' })
    .replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
  const headContentSql = execFileSync('git', ['show', '0edf250:src/db/b17-content.sql'], { encoding: 'utf8' })
    .replace(/\r\n/g, '\n');
  log('STEP head baseline');
  const headOld = await baseline('_head', headSchemaSql, headContentSql);
  log(`HEAD_PREDECESSOR=${headOld.pre} HEAD_B17=${headOld.u1} HEAD_CONTENT=${headOld.content}`);
  assert.equal(headOld.pre, PREDECESSOR_OLD);
  assert.equal(headOld.u1, B17_OLD);
  assert.equal(headOld.content, CONTENT_OLD);
  pass('HEAD constants reproduce exactly on this PG18 scratch');
  log('STEP policy-only baseline');
  const policyOnly = await baseline('_policy', headSchemaSql, b17ContentSource().sql);
  log(`POLICY_ONLY_CONTENT=${policyOnly.content}`);
  assert.equal(policyOnly.pre, PREDECESSOR_OLD);
  assert.equal(policyOnly.u1, B17_OLD);

  log('STEP schema');
  assert.equal((await runMigrations()).success, true);
  const db = await pool.connect();
  owner = db;
  const predecessorNew = await shape(db);
  log(`PREDECESSOR_SHAPE=${predecessorNew}`);

  log('STEP predecessor falsifiability');
  await ddl(oracle, DROPS);
  assert.equal(await shape(db), PREDECESSOR_OLD, 'dropping the three columns restores the old predecessor md5');
  await ddl(oracle, DDL);
  assert.equal(await shape(db), predecessorNew, 're-adding the same DDL restores the new value');
  pass('U4-1a columns are the ONLY predecessor delta (drop -> old md5, add -> new md5)');

  log('STEP b17');
  await db.query('BEGIN');
  await db.query('SELECT pg_advisory_xact_lock(1717001)');
  await db.query("SELECT set_config('app.b17_checksum',$1,true)", [b17Source().checksum]);
  await db.query(b17Source().sql);
  const b17New = await shape(db);
  await db.query("SELECT set_config('app.current_purpose','migration',true)");
  await db.query('INSERT INTO app_schema_versions(version,checksum,structure_checksum) VALUES($1,$2,$3)',
    ['B17_U1', b17Source().checksum, b17New]);
  await db.query('COMMIT');
  log(`B17_SHAPE=${b17New}`);
  assert.notEqual(b17New, predecessorNew);

  log('STEP b17 falsifiability');
  await ddl(oracle, DROPS);
  assert.equal(await shape(db), B17_OLD, 'dropping the columns restores the old post-U1 md5');
  await ddl(oracle, DDL);
  assert.equal(await shape(db), b17New);
  pass('post-U1 constant falsifiable too');

  log('STEP content');
  await db.query('BEGIN');
  await db.query("SELECT set_config('app.current_purpose','migration.inventory',true)");
  await db.query(b17ContentSource().sql);
  const contentNew = await shape(db);
  await db.query("SELECT set_config('app.current_purpose','migration',true)");
  await db.query('INSERT INTO app_schema_versions(version,checksum,structure_checksum) VALUES($1,$2,$3)',
    ['B17_U2D', b17ContentSource().checksum, contentNew]);
  await db.query('COMMIT');
  log(`B17_CONTENT_SHAPE=${contentNew}`);
  assert.notEqual(contentNew, b17New);

  log('STEP content falsifiability');
  await ddl(oracle, DROPS);
  const droppedContent = await shape(db);
  log(`CONTENT_AFTER_DROP=${droppedContent}`);
  assert.equal(droppedContent, policyOnly.content, 'dropping the columns restores the policy-only (previous) content md5');
  await ddl(oracle, DDL);
  assert.equal(await shape(db), contentNew);
  pass('content constant falsifiable: drop -> policy-only md5, add -> new md5');
  await assertB17ContentAuthority(db);
  pass('sanctioned definer surface unchanged (no new definer)');

  log('STEP seed');
  await oracle.query('BEGIN');
  await oracle.query('INSERT INTO clients(id,code,name) VALUES($1,$2,$3)', [A, 'U41', 'U41 tenant']);
  await oracle.query('INSERT INTO departments(id,client_id,code,name) VALUES($1,$2,$3,$4)',
    [DEPT, A, 'D', 'Dept']);
  await oracle.query('INSERT INTO services(id,code,name) VALUES($1,$2,$3)', [S, 'U41S', 'Service']);
  await oracle.query('INSERT INTO services(id,code,name) VALUES($1,$2,$3)', [S2, 'U41S2', 'Service 2']);
  await oracle.query('INSERT INTO standards(id,code,title,category) VALUES($1,$2,$3,$4)',
    [STANDARD, 'U41-STD', 'Standard', 'GRI']);
  await oracle.query('INSERT INTO disclosures(id,standard_id,code,title) VALUES($1,$2,$3,$4)',
    [DISCLOSURE, STANDARD, 'D-1', 'Disclosure']);
  await oracle.query(`INSERT INTO items(id,disclosure_id,code,requirement,priority,esg_class)
    VALUES($1,$2,$3,$4,'high','general')`, [ITEM, DISCLOSURE, 'I-1', 'Requirement']);
  await oracle.query('INSERT INTO service_standards(service_id,standard_id) VALUES($1,$2)', [S, STANDARD]);
  await oracle.query(`INSERT INTO client_services(client_id,service_id,client_field_mask)
    VALUES($1,$2,'["hint","weight"]'::jsonb)`, [A, S]);
  await oracle.query('INSERT INTO client_services(client_id,service_id) VALUES($1,$2)', [A, S2]);
  await oracle.query('COMMIT');

  log('STEP defaults');
  assert.deepEqual((await oracle.query('SELECT settings,code FROM services WHERE id=$1', [S])).rows[0].settings, {},
    'services.settings defaults to {}');
  assert.equal((await oracle.query('SELECT attachment_required FROM items WHERE id=$1', [ITEM])).rows[0]
    .attachment_required, false, 'items.attachment_required defaults to false');
  assert.equal((await oracle.query('SELECT client_field_mask FROM client_services WHERE client_id=$1 AND service_id=$2',
    [A, S2])).rows[0].client_field_mask, null, 'client_field_mask defaults to NULL');
  pass('three column defaults verified on the scratch');

  log('STEP C mask read');
  const cMask = await asCtx(C_CTX, client => maskedItemFields(client, access('client', 'client_admin'), [ITEM]));
  assert.deepEqual([...(cMask.get(ITEM) ?? [])].sort(), ['hint', 'weight'],
    'C sees the union mask of its linked services');
  const cServiceMask = await asCtx(C_CTX, client =>
    serviceFieldMask(client, access('client', 'client_admin'), S));
  assert.deepEqual([...cServiceMask].sort(), ['hint', 'weight']);
  const wMask = await asCtx(W_CTX, client => maskedItemFields(client, access('consultant', 'ge_admin'), [ITEM]));
  assert.equal(wMask.size, 0, 'W is never masked');
  const eMask = await asCtx({ ...C_CTX, role: 'employee', mode: 'employee', departmentId: DEPT },
    client => maskedItemFields(client, access('employee', 'employee'), [ITEM]));
  assert.equal(eMask.size, 0, 'E is never masked');
  pass('C mask read (union) works; W/E get an empty map by construction');

  log('STEP defensive stored value (FAIL-CLOSED)');
  for (const bad of ['{"hint":true}', '"hint"', '5', 'true', '["hint","bogus"]', '[7]']) {
    await oracle.query('UPDATE client_services SET client_field_mask=$1::jsonb WHERE client_id=$2 AND service_id=$3',
      [bad, A, S]);
    const garbage = await asCtx(C_CTX, client => maskedItemFields(client, access('client', 'client_admin'), [ITEM]));
    assert.equal(garbage.get(ITEM)?.size, 8, `malformed stored mask ${bad} hides ALL maskable fields`);
    assert.ok(!garbage.get(ITEM)?.has('attachment_required'));
  }
  assert.equal(storedClientFieldMask({ hint: true }).size, 8);
  assert.equal(storedClientFieldMask(['hint', 'bogus']).size, 8);
  await oracle.query('UPDATE client_services SET client_field_mask=\'["hint","weight"]\'::jsonb WHERE client_id=$1 AND service_id=$2', [A, S]);
  const validMask = await asCtx(C_CTX, client => maskedItemFields(client, access('client', 'client_admin'), [ITEM]));
  assert.deepEqual([...(validMask.get(ITEM) ?? [])].sort(), ['hint', 'weight'], 'valid array semantics unchanged');
  pass('malformed/stale JSONB fails CLOSED (hides all, never 500); valid arrays unchanged');

  log('STEP W visibility policy + handler column guard');
  const wMaskUpdate = await asCtxCommit(W_CTX, client => client.query(
    'UPDATE client_services SET client_field_mask=$1::jsonb WHERE client_id=$2 AND service_id=$3',
    ['["hint"]', A, S]));
  assert.equal(wMaskUpdate.rowCount, 1, 'W (consultant, own A) writes the mask');
  // RLS is ROW-scoped, not column-scoped: the SAME policy admits another column.
  const before = (await oracle.query('SELECT show_gap FROM client_services WHERE client_id=$1 AND service_id=$2', [A, S])).rows[0].show_gap;
  const wOtherColumn = await asCtx(W_CTX, client => client.query(
    'UPDATE client_services SET show_gap=$1 WHERE client_id=$2 AND service_id=$3', [false, A, S]));
  assert.equal(wOtherColumn.rowCount, 1, 'proof RLS alone does NOT confine W to client_field_mask');
  await oracle.query('UPDATE client_services SET show_gap=$1 WHERE client_id=$2 AND service_id=$3', [before, A, S]);
  // The HANDLER contract is the column guard: any other key is refused before SQL.
  assert.equal(parseVisibilityBody({ showGap: false }).ok, false);
  assert.equal(parseVisibilityBody({ clientFieldMask: ['hint'], showGap: false }).ok, false);
  assert.equal(parseVisibilityBody({ clientFieldMask: ['hint'] }).ok, true);
  const afterRejected = (await oracle.query(
    'SELECT show_gap, client_field_mask FROM client_services WHERE client_id=$1 AND service_id=$2', [A, S])).rows[0];
  assert.equal(afterRejected.show_gap, before, 'a refused request leaves show_gap unchanged');
  assert.deepEqual([...storedClientFieldMask(afterRejected.client_field_mask)], ['hint']);
  const cUpdate = await asCtx(C_CTX, client => client.query(
    'UPDATE client_services SET client_field_mask=$1::jsonb WHERE client_id=$2 AND service_id=$3', ['[]', A, S]));
  assert.equal(cUpdate.rowCount, 0, 'C has no UPDATE row');
  const eUpdate = await asCtx({ ...C_CTX, role: 'employee', mode: 'employee', departmentId: DEPT }, client => client.query(
    'UPDATE client_services SET client_field_mask=$1::jsonb WHERE client_id=$2 AND service_id=$3', ['[]', A, S]));
  assert.equal(eUpdate.rowCount, 0, 'E has no UPDATE row');
  const pUpdate = await asCtx(P_CTX, client => client.query(
    'UPDATE client_services SET client_field_mask=$1::jsonb WHERE client_id=$2 AND service_id=$3', ['["hint"]', A, S]));
  assert.equal(pUpdate.rowCount, 1, 'P@T still writes the same row');
  await assert.rejects(() => asCtx(W_CTX, client =>
    resolveLinkedService(client, access('consultant', 'ge_admin'), '00000000-0000-4000-8000-000000000000')),
    (err: any) => err?.code === 'scope.service_unlinked', 'a service not linked to A is refused');
  pass('W writes only via the exact-body handler; other columns/keys refused; C/E 0 rows; unlinked 403');

  log('SUMMARY');
  log(`B17_CONTENT_SHA256=${b17ContentSource().checksum}`);
  log(`POLICY_ONLY_CONTENT=${policyOnly.content}`);
  log(`PREDECESSOR_SHAPE=${predecessorNew}`);
  log(`B17_SHAPE=${b17New}`);
  log(`B17_CONTENT_SHAPE=${contentNew}`);
} finally {
  await oracle.end().catch(() => {});
  owner?.release();
  await pool.end().catch(() => {});
}
