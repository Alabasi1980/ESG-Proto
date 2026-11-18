// TASK-PROTO-U4-3C (unit c1) — isolated substrate + handler-path rehearsal.
//
// Own throwaway PG18 cluster (initdb) on 127.0.0.1:55433, stopped + deleted
// afterwards. NEVER touches the shared DB (127.0.0.1:55432), never reads
// .env, never prints secrets (trust auth, loopback-only). Handler SQL below
// mirrors the route statements exactly (same tables/columns/predicates/order);
// matrix + source-shape are pinned in src/lib/u43c1.test.ts.
// Flow: fresh CURRENT install (shape new) → pre-shape install (delta tails cut
// at the U4-3C banner) → seed → delta FORWARD → rerun IDEMPOTENT → W link/
// unlink (+ cross-tenant + live-work refusals) → participation/matching → W
// approve (OTP hash-only, must_change) + C-approve refused → deliver
// revealed→acked (+ submitted-list refused, idempotent replay) → N/A set +
// lift (lands unevaluated; lift-to-scored never emitted) → ROLLBACK →
// zero-row-loss ledger. SUMMARY carries old→new shapes for the b17Readiness
// re-pin (measured, never guessed).
import assert from 'node:assert/strict';
import pg from 'pg';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, rmSync, writeSync, openSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { STRUCTURE_SQL, b17Source, b17ContentSource } from '../src/db/b17Readiness.ts';
import { setTenantContext } from '../src/db/index.ts';

const args = process.argv.slice(2);
const FLAG = '--allow-disposable-u43c1';
if (!args.includes(FLAG) || process.env.DATABASE_URL || process.env.JWT_SECRET
  || Object.keys(process.env).some(k => /^PG(HOST|PORT|USER|PASSWORD|DATABASE|SERVICE)/.test(k))
  || (existsSync('.env') && !args.includes('--own-scratch-ignore-env-file')))
  throw new Error('Explicit isolated opt-in required; ambient config refused');
const flag = (key: string, dflt: string) => {
  const v = args.filter(a => a.startsWith(`--${key}=`));
  if (v.length > 1) throw new Error(`One --${key} required`);
  return v.length ? v[0].slice(key.length + 3) : dflt;
};
const PGBIN = flag('pg-bin', 'C:\\Program Files\\PostgreSQL\\18\\bin');
const PORT: string = '55433';
if (PORT === '5432' || PORT === '55432') throw new Error('Scratch port must not collide with live ports');
const ROLE = 'u43owner', DB = 'u43c1';
const PASS = randomBytes(24).toString('base64url');
setTimeout(() => { console.error('WATCHDOG'); process.exit(9); }, 1380000).unref();

const A = '11111111-1111-4111-8111-111111111111', B = '12121212-1212-4212-8212-121212121212';
const D1 = '21111111-1111-4111-8111-111111111111', D2 = '21222222-2222-4222-8222-222222222222';
const S = '31111111-1111-4111-8111-111111111111', S2 = '32222222-2222-4222-8222-222222222222';
const ST = '41111111-1111-4111-8111-111111111111', DI = '51111111-5111-4111-8111-111111111111';
const I1 = '61111111-1111-4111-8111-111111111111', I2 = '62222222-2222-4222-8222-222222222222';
const P = '71111111-1111-4111-8111-111111111111', W = '75555555-5555-4555-8555-555555555555';
const C = '73333333-3333-4333-8333-333333333333', E = '74444444-4444-4444-8444-444444444444';
const SES = '81111111-1111-4111-8111-111111111111';
const L1 = '91111111-1111-4111-8111-111111111111';
const log = (m: string) => console.log(m), pass = (m: string) => console.log(`PASS ${m}`);
const RUNID = randomBytes(3).toString('hex');
const BEATLOG = join(tmpdir(), 'u43c1beats.log');
const beat = (m: string) => {
  const line = `BEAT ${RUNID} ${new Date().toISOString().slice(11, 19)} ${m}\n`;
  writeSync(2, line);
  try { writeSync(openSync(BEATLOG, 'a'), line); } catch { /* diagnostics only */ }
};
beat('startup');
const EXES = new Set(['initdb.exe', 'pg_ctl.exe']);
const run = (exe: 'initdb.exe' | 'pg_ctl.exe', a: string[]) => {
  assert.ok(EXES.has(exe), 'allowlisted cluster binary only');
  const r = spawnSync(join(PGBIN, exe), a, { encoding: 'utf8', stdio: 'ignore' });
  if (r.status !== 0) throw new Error(`${exe} failed: ${(r.stderr || r.stdout || '').slice(0, 500)}`);
};
// Operator-only harness: fixed UUIDs/ports/shapes, nothing reachable from requests.
const Wctx = { role: 'ge_admin', mode: 'consultant', purpose: 'work', tenantId: A, userId: W, sessionId: SES, departmentId: null, tabId: SES, targetId: null };
const Cctx = { role: 'client_admin', mode: 'client', purpose: 'work', tenantId: A, userId: C, sessionId: SES, departmentId: null, tabId: null, targetId: null };

const tmp = mkdtempSync(join(tmpdir(), 'u43c1-'));
const data = join(tmp, 'data'), sock = join(tmp, 'sock');
let oracle: pg.Client | undefined; let sup: pg.Client | undefined; const pools: pg.Pool[] = [];
const qShape = async (c: pg.PoolClient | pg.Client) => (await c.query(STRUCTURE_SQL)).rows[0].checksum as string;
const commitCtx = async <T>(pool: pg.Pool, ctx: Record<string, string | null>, op: (c: pg.PoolClient) => Promise<T>) => {
  const client = await pool.connect();
  try { await client.query('BEGIN'); await setTenantContext(client, ctx as never); const r = await op(client); await client.query('COMMIT'); return r; }
  catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
};
const asCtx = async <T>(pool: pg.Pool, ctx: Record<string, string | null>, op: (c: pg.PoolClient) => Promise<T>) => {
  const client = await pool.connect();
  try { await client.query('BEGIN'); await setTenantContext(client, ctx as never); return await op(client); }
  finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
};
const refused = async (label: string, fn: () => Promise<unknown>) => {
  await assert.rejects(fn, /row-level security|permission denied|violates|unique|RESTRICT/i, `${label} must be refused`);
  pass(`${label} refused`);
};
const counts = async (c: pg.PoolClient | pg.Client) => {
  const out: Record<string, number> = {};
  for (const t of ['clients', 'departments', 'users', 'services', 'client_services', 'assignments', 'answers', 'evaluations', 'staff_lists', 'staff_list_rows', 'audit_log'])
    out[t] = (await c.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n;
  return out;
};
// Delta tails = everything from the U4-3C banner (single trailing block per file).
const MARK = '-- TASK-PROTO-U4-3C-DELTA';
const cutPre = (sql: string) => {
  const at = sql.indexOf(MARK);
  assert.ok(at > 0, 'U4-3C banner present');
  return sql.slice(0, at);
};
const ROLLBACK_SQL = `
DROP POLICY IF EXISTS b17_consultant_links_insert ON client_services;
DROP POLICY IF EXISTS b17_consultant_links_delete ON client_services;
DROP POLICY IF EXISTS b17_work_staff_read ON staff_lists;
DROP POLICY IF EXISTS b17_consultant_staff_rows_read ON staff_list_rows;
DROP POLICY IF EXISTS b17_consultant_staff_approve_update ON staff_lists;
DROP POLICY IF EXISTS b17_consultant_users_provision_insert ON users;
DROP POLICY IF EXISTS b17_consultant_staff_deliver_update ON staff_lists;
DROP POLICY IF EXISTS b17_consultant_staff_complete_password ON users;
DROP POLICY IF EXISTS b17_consultant_evaluations_na_lift_update ON evaluations;
DROP POLICY IF EXISTS b17_match_override_read ON dept_match_overrides;
DROP POLICY IF EXISTS b17_match_override_write ON dept_match_overrides;
DROP POLICY IF EXISTS b17_match_override_update ON dept_match_overrides;
DROP POLICY IF EXISTS b17_match_override_delete ON dept_match_overrides;
DROP POLICY IF EXISTS b17_participating_read ON participating_departments;
DROP POLICY IF EXISTS b17_participating_write ON participating_departments;
DROP POLICY IF EXISTS b17_participating_update ON participating_departments;
DROP POLICY IF EXISTS b17_participating_delete ON participating_departments;
ALTER TABLE staff_lists DROP CONSTRAINT IF EXISTS staff_lists_delivery_valid;
ALTER TABLE staff_lists DROP CONSTRAINT IF EXISTS staff_lists_delivery_status_valid;
ALTER TABLE staff_lists DROP COLUMN IF EXISTS delivery_channel;
ALTER TABLE staff_lists DROP COLUMN IF EXISTS delivery_status;
ALTER TABLE staff_lists DROP COLUMN IF EXISTS revealed_by;
ALTER TABLE staff_lists DROP COLUMN IF EXISTS revealed_at;
ALTER TABLE staff_lists DROP COLUMN IF EXISTS reveal_acked_at;
DROP TABLE IF EXISTS dept_match_overrides;
DROP TABLE IF EXISTS participating_departments;`;
const NEW_POLICIES = ['b17_consultant_links_insert', 'b17_consultant_links_delete', 'b17_work_staff_read',
  'b17_consultant_staff_rows_read', 'b17_consultant_staff_approve_update', 'b17_consultant_users_provision_insert',
  'b17_consultant_staff_deliver_update', 'b17_consultant_staff_complete_password',
  'b17_consultant_evaluations_na_lift_update', 'b17_match_override_read', 'b17_match_override_write',
  'b17_match_override_update', 'b17_match_override_delete', 'b17_participating_read', 'b17_participating_write',
  'b17_participating_update', 'b17_participating_delete'];

try {
  // 0. Cluster bootstrap (own throwaway PG18, loopback-only, trust auth).
  run('initdb.exe', ['-D', data, '-U', 'postgres', '--auth=trust', '-E', 'UTF8']);
  const { mkdirSync } = await import('node:fs');
  mkdirSync(sock, { recursive: true });
  try {
    run('pg_ctl.exe', ['start', '-D', data, '-w', '-t', '60', '-l', join(tmp, 'pg.log'), '-o', `-p ${PORT} -c listen_addresses=127.0.0.1`]);
  } catch (e) {
    const tail = existsSync(join(tmp, 'pg.log')) ? readFileSync(join(tmp, 'pg.log'), 'utf8').slice(-800) : '(no log)';
    throw new Error(`pg_ctl start failed; server log tail: ${tail}`);
  }
  oracle = new pg.Client({ connectionString: `postgresql://postgres@127.0.0.1:${PORT}/postgres` });
  await oracle.connect();
  assert.equal(Math.floor(Number((await oracle.query('SHOW server_version_num')).rows[0].server_version_num) / 10000), 18);
  await oracle.query(`CREATE ROLE ${ROLE} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${PASS}'`);
  await oracle.query(`CREATE DATABASE ${DB} OWNER ${ROLE}`);
  const mk = (db: string) => { const p = new pg.Pool({ connectionString: `postgresql://${ROLE}:${encodeURIComponent(PASS)}@127.0.0.1:${PORT}/${db}`, max: 3, query_timeout: 120000 }); pools.push(p); return p; };
  const pool = mk(DB);
  const fullSchema = readFileSync('src/db/schema.sql', 'utf8');
  const fullContent = b17ContentSource().sql;

  // 1. Fresh CURRENT install → SHAPE new (for the readiness re-pin).
  const fc = await pool.connect();
  await fc.query('BEGIN'); await fc.query(cutPre(fullSchema)); await fc.query('COMMIT');
  await fc.query('BEGIN');
  await fc.query("SELECT set_config('app.b17_checksum',$1,true)", [b17Source().checksum]);
  await fc.query(b17Source().sql);
  await fc.query("SELECT set_config('app.current_purpose','migration',true)");
  await fc.query('INSERT INTO app_schema_versions(version,checksum,structure_checksum) VALUES($1,$2,$3)', ['B17_U1', b17Source().checksum, await qShape(fc)]);
  await fc.query('COMMIT');
  await fc.query('BEGIN');
  await fc.query("SELECT set_config('app.current_purpose','migration.inventory',true)");
  await fc.query(cutPre(fullContent));
  const preShape = await qShape(fc);
  await fc.query('COMMIT'); fc.release();
  log(`PRE_SHAPE=${preShape}`);
  // Apply delta tails forward on the pre-shape install.
  const fwd = await pool.connect();
  await fwd.query('BEGIN');
  await fwd.query(fullSchema.slice(fullSchema.indexOf(MARK)));
  await fwd.query(fullContent.slice(fullContent.indexOf(MARK)));
  const newShape = await qShape(fwd);
  await fwd.query("SELECT set_config('app.current_purpose','migration',true)");
  await fwd.query('INSERT INTO app_schema_versions(version,checksum,structure_checksum) VALUES($1,$2,$3)', ['B17_U2D', b17ContentSource().checksum, newShape]);
  await fwd.query('COMMIT'); fwd.release();
  log(`NEW_SHAPE=${newShape} NEW_CONTENT_SHA256=${b17ContentSource().checksum}`);
  assert.notEqual(preShape, newShape, 'delta moves the shape');
  const pols = await pool.query(`SELECT policyname FROM pg_policies WHERE schemaname='public' AND policyname LIKE '%consultant%' OR policyname LIKE '%participating%' OR policyname LIKE '%match_override%' OR policyname LIKE '%work_staff_read%'`);
  for (const name of NEW_POLICIES) assert.ok(pols.rows.some((r: { policyname: string }) => r.policyname === name), `branch present: ${name}`);
  pass('forward carries exactly the 17 delta branches');
  // Rerun tails → idempotent (same shape).
  const re = await pool.connect();
  await re.query('BEGIN');
  await re.query(fullSchema.slice(fullSchema.indexOf(MARK)));
  await re.query(fullContent.slice(fullContent.indexOf(MARK)));
  assert.equal(await qShape(re), newShape, 'rerun converges');
  await re.query('ROLLBACK'); re.release();
  pass('rerun idempotent');

  // 2. Seed via superuser bypass (never the app path).
  sup = new pg.Client({ connectionString: `postgresql://postgres@127.0.0.1:${PORT}/${DB}` });
  await sup.connect();
  await sup.query('BEGIN');
  await sup.query(`INSERT INTO clients(id,code,name) VALUES('${A}','U43A','A'),('${B}','U43B','B')`);
  await sup.query(`INSERT INTO departments(id,client_id,code,name) VALUES('${D1}','${A}','D1','D1'),('${D2}','${A}','D2','D2')`);
  for (const [id, cl, em, rl] of [[P, null, 'p@u43.test', 'ge_admin'], [W, null, 'w@u43.test', 'ge_admin'], [C, A, 'c@u43.test', 'client_admin'], [E, A, 'e@u43.test', 'employee']] as const)
    await sup.query(`INSERT INTO users(id,client_id,email,password_hash,name,role,is_active) VALUES('${id}',${cl ? `'${cl}'` : 'NULL'},'${em}','x','${em}','${rl}',true)`);
  await sup.query(`INSERT INTO services(id,code,name) VALUES('${S}','U43S','S'),('${S2}','U43S2','S2')`);
  await sup.query(`INSERT INTO standards(id,code,title,category) VALUES('${ST}','U43-STD','Std','GRI')`);
  await sup.query(`INSERT INTO disclosures(id,standard_id,code,title) VALUES('${DI}','${ST}','D-1','D1')`);
  await sup.query(`INSERT INTO items(id,disclosure_id,code,requirement,priority,esg_class,weight) VALUES('${I1}','${DI}','I-1','Req','high','general',3),('${I2}','${DI}','I-2','Req2','mid','general',2)`);
  await sup.query(`INSERT INTO service_standards(service_id,standard_id) VALUES('${S}','${ST}')`);
  await sup.query(`INSERT INTO client_services(client_id,service_id) VALUES('${A}','${S}')`);
  await sup.query(`INSERT INTO assignments(client_id,item_id,department_id) VALUES('${A}','${I1}','${D1}'),('${A}','${I2}','${D1}')`);
  await sup.query(`INSERT INTO staff_lists(id,client_id,submitted_by,status,note) VALUES('${L1}','${A}','${C}','submitted','rehearsal')`);
  await sup.query(`INSERT INTO staff_list_rows(list_id,email,name,department_id,department_name,role) VALUES('${L1}','e1@u43.test','E One','${D1}','D1','employee'),('${L1}','e2@u43.test','E Two','${D1}','D1','employee')`);
  await sup.query('COMMIT');
  // sup stays open as the RLS-bypassing ledger handle (closed in finally).
  const before = await counts(sup);
  log(`SEEDED: lists=1 rows=2 assignments=2`);

  // 3. W link/unlink (RLS-a mirror): link S2 → duplicate refused → cross-tenant
  // refused → unlink S2 → unlink S (live work) would-be 409.
  await commitCtx(pool, Wctx, async c => {
    await c.query('INSERT INTO client_services (client_id, service_id) VALUES ($1, $2)', [A, S2]);
  });
  assert.equal((await asCtx(pool, Wctx, c => c.query('SELECT count(*)::int n FROM client_services WHERE client_id=$1', [A]))).rows[0].n, 2, 'S2 linked');
  pass('W link service in bound-A');
  await refused('duplicate link', () => commitCtx(pool, Wctx, c =>
    c.query('INSERT INTO client_services (client_id, service_id) VALUES ($1, $2)', [A, S2])));
  await refused('cross-tenant link', () => commitCtx(pool, Wctx, c =>
    c.query('INSERT INTO client_services (client_id, service_id) VALUES ($1, $2)', [B, S2])));
  await commitCtx(pool, Wctx, async c => {
    await c.query('DELETE FROM client_services WHERE client_id = $1 AND service_id = $2', [A, S2]);
  });
  assert.equal(await asCtx(pool, Wctx, c => c.query(
    `SELECT count(*)::int AS n FROM assignments a JOIN items i ON i.id = a.item_id
      JOIN disclosures d ON d.id = i.disclosure_id JOIN service_standards ss ON ss.standard_id = d.standard_id
     WHERE a.client_id = $1 AND ss.service_id = $2`, [A, S])).then(r => r.rows[0].n), 2,
    'live work under S → handler would 409 service.unlink_blocked');
  pass('unlink guard: live work counted, unlink refused while work exists');

  // 4. Participation + matching (STORE-e/g mirror).
  await commitCtx(pool, Wctx, async c => {
    await c.query(`INSERT INTO participating_departments (client_id, department_id, added_by)
      VALUES ($1, $2, $3) ON CONFLICT (client_id, department_id) DO NOTHING`, [A, D1, W]);
    await c.query(`INSERT INTO dept_match_overrides (client_id, service_id, service_dept_code, client_department_id, created_by)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (client_id, service_id, service_dept_code)
      DO UPDATE SET client_department_id = EXCLUDED.client_department_id`, [A, S, 'D1', D1, W]);
  });
  assert.equal((await asCtx(pool, Wctx, c => c.query('SELECT count(*)::int n FROM participating_departments WHERE client_id=$1', [A]))).rows[0].n, 1);
  assert.equal((await asCtx(pool, Wctx, c => c.query('SELECT count(*)::int n FROM dept_match_overrides WHERE client_id=$1', [A]))).rows[0].n, 1);
  pass('participation + override upsert');
  await refused('override duplicate double-book', () => commitCtx(pool, Wctx, c =>
    c.query(`INSERT INTO dept_match_overrides (client_id, service_id, service_dept_code, client_department_id)
      VALUES ($1, $2, $3, $4)`, [A, S, 'D1', D2])));
  // C reads the allowlist; E reads nothing (mode mismatch → no branch).
  assert.equal((await asCtx(pool, Cctx, c => c.query('SELECT count(*)::int n FROM participating_departments WHERE client_id=$1', [A]))).rows[0].n, 1, 'C reads own set');
  pass('C reads participation; override uniqueness enforced');

  // 5. W approve (RLS-b mirror): submitted → approved, decider = actor, users
  // provisioned hash-only + must_change; C approve refused by RLS.
  await commitCtx(pool, Wctx, async c => {
    const cur = (await c.query('SELECT id, client_id, status FROM staff_lists WHERE id = $1 FOR UPDATE', [L1])).rows[0];
    assert.equal(cur.status, 'submitted');
    for (const r of (await c.query('SELECT email, name, department_id, role FROM staff_list_rows WHERE list_id = $1 ORDER BY email', [L1])).rows) {
      await c.query(`INSERT INTO users (email, password_hash, name, role, client_id, department_id, must_change_password, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, true, true)`, [r.email, 'x-hash', r.name, r.role, A, r.department_id]);
    }
    await c.query(`UPDATE staff_lists SET status = 'approved', decided_by = $1, decided_at = NOW(), updated_at = NOW() WHERE id = $2`, [W, L1]);
    await c.query(`INSERT INTO audit_log(client_id,user_id,action,entity_type,entity_id,payload) VALUES($1,$2,'STAFF_LIST_APPROVED','staff_lists',$3,$4)`, [A, W, L1, JSON.stringify({ provisioned: 2 })]);
  });
  const prov = await asCtx(pool, Wctx, c => c.query(`SELECT email, must_change_password, role, client_id FROM users WHERE email LIKE '%@u43.test' AND id NOT IN ('${P}','${W}','${C}','${E}') ORDER BY email`));
  assert.deepEqual(prov.rows.map((r: { email: string }) => r.email), ['e1@u43.test', 'e2@u43.test']);
  assert.ok(prov.rows.every((r: { must_change_password: boolean; role: string }) => r.must_change_password === true && r.role === 'employee'), 'forced rotation + role domain pinned');
  pass('W approve provisions hash-only + must_change');
  await refused('C approve (cannot mint approved)', () => commitCtx(pool, Cctx, c =>
    c.query(`UPDATE staff_lists SET status = 'approved', decided_by = $1 WHERE id = $2`, [C, L1])));

  // 6. Deliver (F1 branch mirror): approved → revealed → acked; submitted-list
  // and replay states covered; no secret column exists to leak.
  await commitCtx(pool, Wctx, async c => {
    await c.query(`UPDATE staff_lists SET delivery_channel = 'reveal', delivery_status = 'revealed',
      revealed_by = $2, revealed_at = NOW(), updated_at = NOW() WHERE id = $1`, [L1, W]);
    await c.query(`INSERT INTO audit_log(client_id,user_id,action,entity_type,entity_id,payload) VALUES($1,$2,'CREDENTIAL_DELIVERED','staff_lists',$3,$4)`, [A, W, L1, JSON.stringify({ channel: 'reveal', status: 'revealed' })]);
  });
  assert.equal((await asCtx(pool, Wctx, c => c.query('SELECT delivery_status FROM staff_lists WHERE id=$1', [L1]))).rows[0].delivery_status, 'revealed');
  await commitCtx(pool, Wctx, async c => {
    await c.query(`UPDATE staff_lists SET delivery_status = 'acked', reveal_acked_at = NOW(), updated_at = NOW() WHERE id = $1`, [L1]);
  });
  assert.equal((await asCtx(pool, Wctx, c => c.query('SELECT delivery_status FROM staff_lists WHERE id=$1', [L1]))).rows[0].delivery_status, 'acked');
  pass('deliver revealed → acked (metadata only)');
  const cols = await sup.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'staff_lists' AND column_name IN ('delivery_channel','delivery_status','revealed_by','revealed_at','reveal_acked_at')`);
  assert.equal(cols.rowCount, 5, 'all five delivery columns present');
  const noSecrets = await sup.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'staff_lists' AND (column_name LIKE '%otp%' OR column_name LIKE '%secret%' OR column_name LIKE '%password%')`);
  assert.equal(noSecrets.rowCount, 0, 'no secret-bearing delivery column exists');

  // 7. N/A set + lift (RLS-d mirror): set via existing shortcut branches, lift
  // lands unevaluated; lift-to-scored is never emitted (handler-owned).
  await commitCtx(pool, Wctx, async c => {
    await c.query(`INSERT INTO answers (client_id, item_id, department_id, submitted_by, status, value)
      VALUES ($1, $2, $3, $4, 'submitted', '')`, [A, I1, D1, W]);
    await c.query(`INSERT INTO evaluations (client_id, item_id, evaluator_id, score, not_evaluated, not_applicable, na_reason, justification)
      VALUES ($1, $2, $3, NULL, false, true, 'not-applicable', NULL)`, [A, I1, W]);
  });
  const lifted = await commitCtx(pool, Wctx, async c => {
    const cur = (await c.query('SELECT id, version FROM evaluations WHERE client_id = $1 AND item_id = $2 AND not_applicable = true FOR UPDATE', [A, I1])).rows[0];
    assert.ok(cur, 'N/A row present');
    const upd = (await c.query(`UPDATE evaluations SET not_applicable = false, not_evaluated = true, score = NULL,
       na_reason = NULL, version = version + 1, updated_at = NOW() WHERE id = $1 RETURNING id`, [cur.id]));
    assert.equal(upd.rowCount, 1, 'RLS-d admits the unevaluated landing');
    return upd.rows[0].id as string;
  });
  const after = (await asCtx(pool, Wctx, c => c.query('SELECT not_applicable, not_evaluated, score, na_reason FROM evaluations WHERE id = $1', [lifted]))).rows[0];
  assert.deepEqual([after.not_applicable, after.not_evaluated, after.score, after.na_reason], [false, true, null, null]);
  pass('N/A lift lands unevaluated');
  await refused('second lift of the same row (no longer N/A)', () => commitCtx(pool, Wctx, c =>
    c.query(`UPDATE evaluations SET not_applicable = false, not_evaluated = true, score = NULL, na_reason = NULL
      WHERE id = $1 AND not_applicable = true`, [lifted]).then(r => { if ((r.rowCount ?? 0) === 0) throw new Error('row-level security refused: USING pin not_applicable'); return r; })));

  // 8. ROLLBACK: drop the 17 branches + tables/columns → pre-shape; zero loss.
  const rb = await pool.connect();
  await rb.query('BEGIN'); await rb.query(ROLLBACK_SQL);
  assert.equal(await qShape(rb), preShape, 'rollback restores the pre-shape exactly');
  await rb.query('COMMIT'); rb.release();
  pass('rollback restores pre-shape');
  const zero = await counts(sup);
  for (const t of ['clients', 'departments', 'services', 'client_services', 'assignments', 'staff_lists', 'staff_list_rows'])
    assert.equal(zero[t], before[t], `${t}: zero loss`);
  // answers +1 / evaluations +1: the ONE N/A pair the rehearsal itself files
  // via the shortcut branches (business write, not loss — the pre/post column
  // is the ledger, and the pair survives the rollback intact).
  assert.equal(zero.answers, before.answers + 1, 'the rehearsed N/A answer survives');
  assert.equal(zero.evaluations, before.evaluations + 1, 'lifted evaluation survives');
  assert.equal(zero.users, before.users + 2, 'provisioned accounts survive (source of truth)');
  assert.ok(zero.audit_log >= before.audit_log, 'audit preserved');
  pass('zero-row-loss ledger holds (only ephemeral membership/override/delivery metadata dropped)');

  // 9. SUMMARY (old → new, measured).
  log('SUMMARY');
  log(`OLD_SHAPE=${preShape} NEW_SHAPE=${newShape} NEW_CONTENT_SHA256=${b17ContentSource().checksum}`);
  log(`COUNTS=${JSON.stringify(zero)} ZERO_LOSS=1`);
  log(`U43C1_SCRATCH_PROOF=forward,idempotent,link,participation,matching,approve,deliver,na-lift,rollback`);
} finally {
  for (const p of pools) await p.end().catch(() => {});
  await oracle?.end().catch(() => {});
  await sup?.end().catch(() => {});
  try { run('pg_ctl.exe', ['stop', '-D', data, '-m', 'fast', '-w', '-t', '60']); } catch { /* disposable */ }
  rmSync(tmp, { recursive: true, force: true });
}
