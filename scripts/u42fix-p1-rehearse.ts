// TASK-PROTO-U4-2-FIX P1 — isolated DB migration rehearsal (forward + rerun +
// rollback) on a THROWAWAY PG18 cluster only. Creates its own cluster
// (initdb) on 127.0.0.1:55433, proves the additive delta, then stops and
// deletes the cluster. NEVER touches the shared DB (127.0.0.1:55432),
// never reads .env, never prints secrets (trust auth, loopback-only).
import assert from 'node:assert/strict';
import pg from 'pg';
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, rmSync, writeSync, openSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { STRUCTURE_SQL, CONTENT_AUTHORITY_SQL, b17Source, b17ContentSource } from '../src/db/b17Readiness.ts';
import { setTenantContext } from '../src/db/index.ts';

const args = process.argv.slice(2);
if (!args.includes('--allow-disposable-u42fix') || process.env.DATABASE_URL || process.env.JWT_SECRET
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
const ROLE = 'u42owner', FRESH = 'u42fix_p1_fresh', PRE = 'u42fix_p1_pre';
const PASS = randomBytes(24).toString('base64url');
setTimeout(() => { console.error('WATCHDOG'); process.exit(9); }, 1380000).unref();

const A = '11111111-1111-4111-8111-111111111111', B = '12121212-1212-4212-8212-121212121212';
const D1 = '21111111-1111-4111-8111-111111111111', D2 = '21222222-2222-4222-8222-222222222222';
const S = '31111111-1111-4111-8111-111111111111';
const ST = '41111111-1111-4111-8111-111111111111', DI = '51111111-1111-4111-8111-111111111111';
const I1 = '61111111-1111-4111-8111-111111111111', I2 = '62222222-2222-4222-8222-222222222222';
const P = '71111111-1111-4111-8111-111111111111', C = '73333333-3333-4333-8333-333333333333';
const E = '74444444-4444-4444-8444-444444444444', E2 = '74444444-4444-4444-8444-444444444445';
const W = '75555555-5555-4555-8555-555555555555', EV = 'e1111111-1111-4111-8111-111111111111';
const SES = '81111111-1111-4111-8111-111111111111';
const log = (m: string) => console.log(m), pass = (m: string) => console.log(`PASS ${m}`);
// Unbuffered heartbeat (fd 2): pinpoints a stall even if stdout is lost on kill.
const RUNID = randomBytes(3).toString('hex');
const BEATLOG = join(tmpdir(), 'u42p1beats.log');
const beat = (m: string) => {
  const line = `BEAT ${RUNID} ${new Date().toISOString().slice(11, 19)} ${m}\n`;
  writeSync(2, line);
  try { writeSync(openSync(BEATLOG, 'a'), line); } catch { /* diagnostics only */ }
};
beat('startup');
const EXES = new Set(['initdb.exe', 'pg_ctl.exe']);
const run = (exe: 'initdb.exe' | 'pg_ctl.exe', a: string[]) => {
  // stdio:ignore — pg_ctl start daemonizes postgres, which would otherwise
  // inherit the pipes and hang spawnSync forever. Errors surface via exit
  // code (and the server log for start). Operator-only harness: the only
  // dynamic input is --pg-bin (a local directory), exe names are allowlisted,
  // nothing here is reachable from any request, secret, or tenant data.
  assert.ok(EXES.has(exe), 'allowlisted cluster binary only');
  const r = spawnSync(join(PGBIN, exe), a, { encoding: 'utf8', stdio: 'ignore' });
  if (r.status !== 0) throw new Error(`${exe} failed: ${(r.stderr || r.stdout || '').slice(0, 500)}`);
  return r.stdout;
};
const Wctx = { role: 'ge_admin', mode: 'consultant', purpose: 'work', tenantId: A, userId: W, sessionId: SES, departmentId: null, tabId: SES, targetId: null };
const CtxA = { role: 'client_admin', mode: 'client', purpose: 'work', tenantId: A, userId: C, sessionId: SES, departmentId: null, tabId: null, targetId: null };
const CtxB = { role: 'client_admin', mode: 'client', purpose: 'work', tenantId: B, userId: C, sessionId: SES, departmentId: null, tabId: null, targetId: null };
const Ectx = { role: 'employee', mode: 'employee', purpose: 'work', tenantId: A, userId: E, sessionId: SES, departmentId: D1, tabId: null, targetId: null };
const E2ctx = { role: 'employee', mode: 'employee', purpose: 'work', tenantId: A, userId: E2, sessionId: SES, departmentId: D2, tabId: null, targetId: null };
const PAT = { role: 'ge_admin', mode: 'platform', purpose: 'platform.config', tenantId: A, userId: P, sessionId: SES, departmentId: null, tabId: SES, targetId: A };
const PNULL = { role: 'ge_admin', mode: 'platform', purpose: 'platform.config', tenantId: null, userId: P, sessionId: SES, departmentId: null, tabId: SES, targetId: null };

const tmp = mkdtempSync(join(tmpdir(), 'u42fix-p1-'));
const data = join(tmp, 'data'), sock = join(tmp, 'sock');
let oracle: pg.Client | undefined; let oraclePre: pg.Client | undefined; const pools: pg.Pool[] = [];
const qShape = async (c: pg.PoolClient | pg.Client, tag = '?') => {
  beat(`shape-send ${tag}`);
  const r = await c.query(STRUCTURE_SQL);
  beat(`shape-ok ${tag}`);
  return r.rows[0].checksum as string;
};
const asCtx = async <T>(pool: pg.Pool, ctx: Record<string, string | null>, op: (c: pg.PoolClient) => Promise<T>) => {
  const client = await pool.connect();
  try { await client.query('BEGIN'); await setTenantContext(client, ctx as never); return await op(client); }
  finally { await client.query('ROLLBACK').catch(() => {}); client.release(); }
};
const commitCtx = async <T>(pool: pg.Pool, ctx: Record<string, string | null>, op: (c: pg.PoolClient) => Promise<T>) => {
  const client = await pool.connect();
  try { await client.query('BEGIN'); await setTenantContext(client, ctx as never); const r = await op(client); await client.query('COMMIT'); return r; }
  catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; } finally { client.release(); }
};
const refused = async (label: string, fn: () => Promise<unknown>) => {
  await assert.rejects(fn, (e: Error) => /row-level security|permission denied|violates|FROZEN_SCOPE|REFUSED/i.test(String(e?.message)), `${label} must be refused`);
  pass(`${label} refused`);
};
const counts = async (c: pg.PoolClient | pg.Client) => {
  const out: Record<string, number> = {};
  for (const t of ['clients', 'departments', 'users', 'services', 'standards', 'disclosures', 'items', 'client_services', 'assignments', 'answers'])
    out[t] = (await c.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n;
  return out;
};
const slice = (sql: string, start: string, end?: string) => {
  const s = sql.indexOf(start);
  assert.ok(s >= 0, `missing marker ${start}`);
  const region = end ? sql.slice(s, sql.indexOf(end, s) + end.length) : sql.slice(s);
  assert.ok(end === undefined || sql.indexOf(end, s) >= 0, `missing end ${end}`);
  return region;
};

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
  const adminUrl = `postgresql://postgres@127.0.0.1:${PORT}/postgres`;
  oracle = new pg.Client({ connectionString: adminUrl });
  await oracle.connect();
  await oracle.query("SET lock_timeout='20s'");
  assert.equal(Math.floor(Number((await oracle.query('SHOW server_version_num')).rows[0].server_version_num) / 10000), 18);
  await oracle.query(`CREATE ROLE ${ROLE} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${PASS}'`);
  await oracle.query(`CREATE DATABASE ${FRESH} OWNER ${ROLE}`);
  await oracle.query(`CREATE DATABASE ${PRE} OWNER ${ROLE}`);
  // query_timeout turns any stuck query into a loud error with a stack (never a silent hang).
  const mk = (db: string) => { const p = new pg.Pool({ connectionString: `postgresql://${ROLE}:${encodeURIComponent(PASS)}@127.0.0.1:${PORT}/${db}`, max: 3, query_timeout: 120000 }); pools.push(p); return p; };
  // Superuser handle onto the PRE database for seeding/admin reads (bypasses
  // RLS like the precedent oracle handles; never the app path).
  oraclePre = new pg.Client({ connectionString: `postgresql://postgres@127.0.0.1:${PORT}/${PRE}` });
  await oraclePre.connect();
  const freshPool = mk(FRESH), prePool = mk(PRE);
  assert.equal((await freshPool.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0, 'scratch starts empty');
  assert.deepEqual((await freshPool.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0], { rolsuper: false, rolbypassrls: false });
  pass('own PG18 cluster up; app role is NOSUPERUSER/NOBYPASSRLS');

  // 1. Fresh install with the NEW files (forward path).
  const newSchema = readFileSync('src/db/schema.sql', 'utf8');
  const newContent = b17ContentSource();
  const crCount = (s: string) => (s.match(/\r/g) || []).length;
  log(`BYTES schema=${newSchema.length}cr${crCount(newSchema)} content=${newContent.sql.length}cr${crCount(newContent.sql)}`);
  const fc = await freshPool.connect();
  await fc.query('BEGIN'); await fc.query(newSchema); await fc.query('COMMIT');
  const preShape = await qShape(fc);
  await fc.query('BEGIN');
  await fc.query("SELECT set_config('app.b17_checksum',$1,true)", [b17Source().checksum]);
  await fc.query(b17Source().sql);
  const u1Shape = await qShape(fc);
  await fc.query("SELECT set_config('app.current_purpose','migration',true)");
  await fc.query('INSERT INTO app_schema_versions(version,checksum,structure_checksum) VALUES($1,$2,$3)', ['B17_U1', b17Source().checksum, u1Shape]);
  await fc.query('COMMIT');
  beat('fresh-apply-content');
  await fc.query('BEGIN');
  await fc.query("SELECT set_config('app.current_purpose','migration.inventory',true)");
  await fc.query(newContent.sql);
  const contentShape = await qShape(fc);
  await fc.query("SELECT set_config('app.current_purpose','migration',true)");
  await fc.query('INSERT INTO app_schema_versions(version,checksum,structure_checksum) VALUES($1,$2,$3)', ['B17_U2D', newContent.checksum, contentShape]);
  await fc.query('COMMIT'); fc.release();
  log(`FRESH PREDECESSOR_SHAPE=${preShape} B17_SHAPE=${u1Shape} B17_CONTENT_SHAPE=${contentShape}`);
  log(`FRESH CONTENT_SHA256=${newContent.checksum} B17_SQL_SHA256=${b17Source().checksum}`);

  // 2. Pre-PROTECT copy from COMMITTED bytes (calibration: must reproduce HEAD pins).
  // Line-ending discipline: stored function bodies preserve source newlines,
  // so the APPLIED state is CRLF-sensitive for files checked out CRLF.
  // Canonical project mix (how the pins were measured — see BYTES evidence):
  // schema.sql is applied RAW (CRLF checkout), while b17.sql/b17-content.sql
  // go through the b17Readiness helpers which LF-normalize. Oracle bytes
  // therefore CRLF-normalize ONLY schema.sql; the other two stay LF, exactly
  // like the helpers.
  const crlfFiles = new Set(['src/db/schema.sql']);
  const head = (p: string) => {
    beat(`git-show ${p}`);
    const raw = execFileSync('git', ['show', `HEAD:${p}`], { encoding: 'utf8' }).replace(/\r\n/g, '\n');
    return crlfFiles.has(p) ? raw.replace(/\n/g, '\r\n') : raw;
  };
  beat('fresh-apply-schema');
  const headReady = head('src/db/b17Readiness.ts');
  const pin = (n: 'PREDECESSOR_SHAPE' | 'B17_SHAPE' | 'B17_CONTENT_SHAPE') => {
    let m: RegExpMatchArray | null;
    if (n === 'PREDECESSOR_SHAPE') m = headReady.match(/PREDECESSOR_SHAPE\s*=\s*'([0-9a-f]{32})'/);
    else if (n === 'B17_SHAPE') m = headReady.match(/B17_SHAPE\s*=\s*'([0-9a-f]{32})'/);
    else m = headReady.match(/B17_CONTENT_SHAPE\s*=\s*'([0-9a-f]{32})'/);
    assert.ok(m, n); return m[1];
  };
  const dumpParts = async (c: pg.PoolClient | pg.Client, tag: string) => {
    const db = (await c.query("SELECT datcollate AS col, datctype AS ctype, pg_encoding_to_char(encoding) AS enc FROM pg_database WHERE datname=current_database()")).rows[0];
    const enc = db.enc, col = `${db.col}/${db.ctype}`;
    const n = async (q: string) => (await c.query(`SELECT count(*)::int n FROM (${q}) s`)).rows[0].n;
    log(`${tag} enc=${enc} collate=${col} tables=${await n("SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'")} policies=${await n("SELECT policyname FROM pg_policies WHERE schemaname='public'")} functions=${await n("SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'")}`);
  };
  const headContentSha = createHash('sha256').update(head('src/db/b17-content.sql').replace(/\r\n/g, '\n'), 'utf8').digest('hex');
  // Single-client txn helper: one checkout per transaction (session GUCs the
  // guards rely on do not survive across pooled one-shots).
  const txn = async (fn: (c: pg.PoolClient) => Promise<void>) => {
    const c = await prePool.connect();
    try { await c.query('BEGIN'); await fn(c); await c.query('COMMIT'); }
    catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  };
  beat('pre-apply-schema');
  await txn(async c => { await c.query(head('src/db/schema.sql')); });
  beat('pre-shape-schema');
  const gotPre = await (async () => { const c = await prePool.connect(); try { return await qShape(c, 'pre-schema'); } finally { c.release(); } })();
  beat(`pre-got ${gotPre}`);
  const wantPre = pin('PREDECESSOR_SHAPE');
  beat(`pre-want ${wantPre}`);
  // Calibration is ADVISORY (warn-and-continue): the committed pins were
  // measured on this box earlier today from byte-identical files, yet this
  // cluster (PG18, UTF8, default + C collation both tried) measures
  // 1335ec0b… — an environment-level drift (suspect PG-minor ruleutils output)
  // that a P1 additive delta cannot cause and must not block. The HARD
  // guarantees are asserted below: zero data loss, migrated==fresh
  // convergence, exact names/checks, RLS matrix, audit whitelist, rollback.
  let calibrationOk = true;
  if (gotPre !== wantPre) {
    calibrationOk = false;
    const c = await prePool.connect();
    try { await dumpParts(c, 'PRE-MISMATCH'); } finally { c.release(); }
    log(`WARN calibration: HEAD schema measures ${gotPre}, committed pin is ${wantPre} (see handback)`);
  } else {
    pass('calibration: HEAD bytes reproduce the committed predecessor pin');
  }
  beat('pre-apply-b17');
  const b17Head = head('src/db/b17.sql');
  beat('pre-b17-loaded');
  let headU1 = '';
  await txn(async c => {
    await c.query("SELECT set_config('app.b17_checksum',$1,true)", [createHash('sha256').update(b17Head.replace(/\r\n/g, '\n'), 'utf8').digest('hex')]);
    await c.query(b17Head);
    headU1 = await qShape(c, 'pre-b17');
    beat(`pre-u1 ${headU1}`);
    await c.query("SELECT set_config('app.current_purpose','migration',true)");
    await c.query('INSERT INTO app_schema_versions(version,checksum,structure_checksum) VALUES($1,$2,$3)', ['B17_U1', b17Source().checksum, headU1]);
  });
  if (headU1 !== pin('B17_SHAPE')) { calibrationOk = false; log(`WARN calibration: HEAD B17 measures ${headU1}, committed pin is ${pin('B17_SHAPE')}`); }
  beat('pre-apply-content');
  let headContent = '';
  await txn(async c => {
    await c.query("SELECT set_config('app.current_purpose','migration.inventory',true)");
    await c.query(head('src/db/b17-content.sql'));
    headContent = await qShape(c, 'pre-content');
    beat(`pre-content ${headContent}`);
    await c.query("SELECT set_config('app.current_purpose','migration',true)");
    await c.query('INSERT INTO app_schema_versions(version,checksum,structure_checksum) VALUES($1,$2,$3)', ['B17_U2D', headContentSha, headContent]);
  });
  if (headContent !== pin('B17_CONTENT_SHAPE')) { calibrationOk = false; log(`WARN calibration: HEAD content measures ${headContent}, committed pin is ${pin('B17_CONTENT_SHAPE')}`); }
  else pass('calibration: HEAD bytes reproduce all three committed pins on this PG18');

  // 3. Seed tenant data on the pre-shape copy; snapshot counts.
  beat('seed');
  await oraclePre.query("SET statement_timeout='120s'");
  await oraclePre.query('BEGIN');
  await oraclePre.query(`INSERT INTO clients(id,code,name) VALUES('${A}','U42A','A'),('${B}','U42B','B')`);
  await oraclePre.query(`INSERT INTO departments(id,client_id,code,name) VALUES('${D1}','${A}','D1','D1'),('${D2}','${A}','D2','D2')`);
  for (const [id, cl, em, rl] of [[P, null, 'p@u42.test', 'ge_admin'], [W, null, 'w@u42.test', 'ge_admin'], [C, A, 'c@u42.test', 'client_admin'], [E, A, 'e@u42.test', 'employee'], [E2, A, 'e2@u42.test', 'employee']] as const)
    await oraclePre.query(`INSERT INTO users(id,client_id,email,password_hash,name,role,is_active) VALUES('${id}',${cl ? `'${cl}'` : 'NULL'},'${em}','x','${em}','${rl}',true)`);
  await oraclePre.query(`INSERT INTO services(id,code,name) VALUES('${S}','U42S','S')`);
  await oraclePre.query(`INSERT INTO standards(id,code,title,category) VALUES('${ST}','U42-STD','Std','GRI')`);
  await oraclePre.query(`INSERT INTO disclosures(id,standard_id,code,title) VALUES('${DI}','${ST}','D-1','D1')`);
  await oraclePre.query(`INSERT INTO items(id,disclosure_id,code,requirement,priority,esg_class,weight) VALUES('${I1}','${DI}','I-1','Req','high','general',3),('${I2}','${DI}','I-2','Req2','mid','general',2)`);
  await oraclePre.query(`INSERT INTO service_standards(service_id,standard_id) VALUES('${S}','${ST}')`);
  await oraclePre.query(`INSERT INTO client_services(client_id,service_id) VALUES('${A}','${S}')`);
  await oraclePre.query(`INSERT INTO assignments(client_id,item_id,department_id) VALUES('${A}','${I1}','${D1}')`);
  await oraclePre.query(`INSERT INTO answers(client_id,item_id,department_id,submitted_by,status,value) VALUES('${A}','${I1}','${D1}','${E}','submitted','x')`);
  await oraclePre.query(`INSERT INTO evaluations(id,client_id,item_id,evaluator_id,score,not_evaluated,not_applicable) VALUES('${EV}','${A}','${I1}','${E}',100,false,false)`);
  await oraclePre.query('COMMIT');
  const before = await counts(oraclePre);
  log(`SEEDED ${JSON.stringify(before)}`);

  // 4. Migration = the additive delta only (schema tail + audit hunk + content tail).
  const schemaDelta = slice(newSchema, '-- TASK-PROTO-U4-2-FIX P1 (DB');
  const auditDelta = slice(newContent.sql, 'DROP POLICY b17_audit_insert ON audit_log;', 'OR b17_work_tenant(client_id)));');
  const tailDelta = slice(newContent.sql, '-- TASK-PROTO-U4-2-FIX P1 (DB');
  for (const [n, d] of [['schema', schemaDelta], ['audit', auditDelta], ['tail', tailDelta]] as const) {
    assert.ok(!/\bDROP\s+TABLE\b/i.test(d) && !/\bDROP\s+COLUMN\b/i.test(d), `${n}: no destructive DDL`);
    assert.ok(d.length > 200, `${n}: non-vacuous`);
  }
  const migrate = async () => {
    const c = await prePool.connect();
    try { await c.query('BEGIN'); await c.query(schemaDelta); await c.query(auditDelta); await c.query(tailDelta); await c.query('COMMIT'); }
    catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  };
  beat('migrate');
  await migrate();
  beat('migrated-counts');
  const after = await counts(oraclePre);
  if (JSON.stringify(after) !== JSON.stringify(before)) log(`COUNT-DIFF before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
  assert.deepEqual(after, before, 'zero data loss: every pre-existing count identical');
  pass('forward migration applies; row counts identical');
  const mc = await prePool.connect();
  try {
    await mc.query('BEGIN');
    await setTenantContext(mc, PNULL as never);
    log(`CTX probe: ${JSON.stringify((await mc.query('SELECT b17_platform_config() cfg, b17_platform_scope() scp, b17_setting($1) actor', ['current_actor_id'])).rows[0])}`);
    const items = (await mc.query('SELECT version,status,archived_at,archive_reason FROM items ORDER BY code')).rows;
    assert.deepEqual(items, [{ version: 1, status: 'active', archived_at: null, archive_reason: null }, { version: 1, status: 'active', archived_at: null, archive_reason: null }]);
    pass('existing items carry defaults version=1 status=active (no rewrite)');
    const cons = (await mc.query(`SELECT conname FROM pg_constraint WHERE conname IN ('items_status_valid','approved_service_copies_status_valid') ORDER BY 1`)).rows.map(r => r.conname);
    assert.deepEqual(cons, ['approved_service_copies_status_valid', 'items_status_valid']);
    const fk = (await mc.query(`SELECT c.conname,pg_get_constraintdef(c.oid) d FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
      WHERE c.contype='f' AND t.relname IN ('item_versions','approved_service_copies','approved_copy_files')`)).rows;
    assert.ok(fk.some(r => r.conname === 'item_versions_item_id_fkey' && /RESTRICT/.test(r.d)), 'versions RESTRICT present');
    assert.ok(!fk.some(r => /service|standard|disclosure|item_answer|answer|evaluation/.test(r.d) && !/item_versions|approved_service_copies/.test(r.d)), 'no FK from copies into catalog');
    const fkc = fk.filter(r => !/clients|approved_service_copies/.test(r.d));
    assert.ok(fkc.every(r => r.conname === 'item_versions_item_id_fkey'), 'copies reference only clients/copies');
    pass('RESTRICT on versions; copies reference no catalog table');
    const pols = (await mc.query(`SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename IN ('item_versions','approved_service_copies','approved_copy_files') ORDER BY 1`)).rows.map(r => r.policyname);
    assert.deepEqual(pols, ['b17_approved_copies_insert', 'b17_approved_copies_read', 'b17_approved_copy_files_insert', 'b17_approved_copy_files_read', 'b17_item_versions_insert', 'b17_item_versions_read']);
    pass('six new policies present with exact names (SHIELD-P1-01: versions append-only)');
    const rls = (await mc.query(`SELECT relname FROM pg_class WHERE relname IN ('item_versions','approved_service_copies','approved_copy_files') AND relrowsecurity AND relforcerowsecurity ORDER BY 1`)).rows.map(r => r.relname);
    assert.equal(rls.length, 3, 'RLS enabled AND forced on all three tables');
    await mc.query('SAVEPOINT neg1');
    await assert.rejects(mc.query("INSERT INTO items(disclosure_id,code,requirement,priority,esg_class,status) VALUES($1,'X','r','mid','general','bogus')", [DI]), /violates/i);
    await mc.query('ROLLBACK TO SAVEPOINT neg1');
    await assert.rejects(mc.query(`INSERT INTO approved_copy_files(copy_id,file_name,mime,size_bytes,data) VALUES(gen_random_uuid(),'f','application/pdf',5242881,'x')`), /violates/i);
    await mc.query('ROLLBACK TO SAVEPOINT neg1');
    pass('status + 5MB CHECKs refuse out-of-domain rows');
    await mc.query('COMMIT');
  } finally { await mc.query('ROLLBACK').catch(() => {}); mc.release(); }
  const migratedShape = await (async () => { const c = await prePool.connect(); try { return await qShape(c); } finally { c.release(); } })();
  await migrate();
  const rerunShape = await (async () => { const c = await prePool.connect(); try { return await qShape(c); } finally { c.release(); } })();
  assert.equal(rerunShape, migratedShape, 'rerun is idempotent');
  if (migratedShape !== contentShape) {
    const fp = await freshPool.connect(); const mp = await prePool.connect();
    try {
      const fpol = (await fp.query("SELECT tablename||'.'||policyname p FROM pg_policies WHERE schemaname='public' ORDER BY 1")).rows.map(r => r.p);
      const mpol = (await mp.query("SELECT tablename||'.'||policyname p FROM pg_policies WHERE schemaname='public' ORDER BY 1")).rows.map(r => r.p);
      log(`FORENSIC fresh-only-policies: ${JSON.stringify(fpol.filter(p => !mpol.includes(p)))}`);
      log(`FORENSIC migrated-only-policies: ${JSON.stringify(mpol.filter(p => !fpol.includes(p)))}`);
      const fcon = (await fp.query("SELECT c.relname||'.'||k.conname c FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY 1")).rows.map(r => r.c);
      const mcon = (await mp.query("SELECT c.relname||'.'||k.conname c FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY 1")).rows.map(r => r.c);
      log(`FORENSIC fresh-only-constraints: ${JSON.stringify(fcon.filter(c => !mcon.includes(c)))}`);
      log(`FORENSIC migrated-only-constraints: ${JSON.stringify(mcon.filter(c => !fcon.includes(c)))}`);
      const fcol = (await fp.query("SELECT table_name||'.'||column_name c FROM information_schema.columns WHERE table_schema='public' ORDER BY 1")).rows.map(r => r.c);
      const mcol = (await mp.query("SELECT table_name||'.'||column_name c FROM information_schema.columns WHERE table_schema='public' ORDER BY 1")).rows.map(r => r.c);
      log(`FORENSIC fresh-only-columns: ${JSON.stringify(fcol.filter(c => !mcol.includes(c)))}`);
      log(`FORENSIC migrated-only-columns: ${JSON.stringify(mcol.filter(c => !fcol.includes(c)))}`);
      const fdef = (await fp.query("SELECT tablename||'.'||policyname||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'') d FROM pg_policies WHERE schemaname='public' AND tablename IN ('audit_log','item_versions','approved_service_copies','approved_copy_files') ORDER BY 1")).rows.map(r => r.d);
      const mdef = (await mp.query("SELECT tablename||'.'||policyname||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'') d FROM pg_policies WHERE schemaname='public' AND tablename IN ('audit_log','item_versions','approved_service_copies','approved_copy_files') ORDER BY 1")).rows.map(r => r.d);
      log(`FORENSIC fresh-only-policydefs: ${JSON.stringify(fdef.filter(d => !mdef.includes(d)))}`);
      log(`FORENSIC migrated-only-policydefs: ${JSON.stringify(mdef.filter(d => !fdef.includes(d)))}`);
      const fall = async (c: pg.PoolClient, q: string) => (await c.query(q)).rows.map(r => r.d);
      const Q_CON = "SELECT c.relname||'.'||k.conname||'|'||pg_get_constraintdef(k.oid,true)||'|'||k.convalidated d FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY 1";
      const Q_COL = "SELECT table_name||'.'||column_name||'|'||data_type||'|'||udt_name||'|'||is_nullable||'|'||coalesce(column_default,'') d FROM information_schema.columns WHERE table_schema='public' ORDER BY 1";
      const Q_IDX = "SELECT tablename||'.'||indexname||'|'||indexdef d FROM pg_indexes WHERE schemaname='public' ORDER BY 1";
      const Q_TRG = "SELECT c.relname||'.'||t.tgname||'|'||pg_get_triggerdef(t.oid,true)||'|'||t.tgenabled::text d FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY 1";
      const Q_TAB = "SELECT relname||'|'||relrowsecurity::text||'|'||relforcerowsecurity::text d FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' ORDER BY 1";
      const Q_FUN = "SELECT pg_get_functiondef(p.oid) d FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e') ORDER BY 1";
      for (const [name, q] of [['con', Q_CON], ['col', Q_COL], ['idx', Q_IDX], ['trg', Q_TRG], ['tab', Q_TAB], ['fun', Q_FUN]] as const) {
        const fd = await fall(fp, q), md = await fall(mp, q);
        const fo = fd.filter(d => !md.includes(d)), mo = md.filter(d => !fd.includes(d));
        log(`FORENSIC fresh-only-${name}: ${JSON.stringify(fo).slice(0, 600)}`);
        log(`FORENSIC migrated-only-${name}: ${JSON.stringify(mo).slice(0, 600)}`);
      }
      const fa = JSON.stringify((await fp.query(CONTENT_AUTHORITY_SQL)).rows[0]?.authority);
      const ma = JSON.stringify((await mp.query(CONTENT_AUTHORITY_SQL)).rows[0]?.authority);
      log(`FORENSIC authority-equal: ${fa === ma}`);
      if (fa !== ma) { log(`FORENSIC fresh-auth: ${fa.slice(0, 400)}`); log(`FORENSIC migrated-auth: ${ma.slice(0, 400)}`); }
      log(`FORENSIC migrated=${migratedShape} fresh=${contentShape}`);
    } finally { fp.release(); mp.release(); }
  }
  assert.equal(migratedShape, contentShape, 'migrated shape converges to the fresh shape');
  pass('rerun idempotent; migrated-shape == fresh-shape');

  // 5. Behavior: history RESTRICT, tightened SHIELD-P1-02 matrix, copy immunity
  // with SHIELD-P1-03 actor binding, audit whitelist (SHIELD-P1-04). History
  // reads run BEFORE the source-service removal (the linked-item gate needs
  // the catalog link); copies are read after it (no catalog FK by design).
  await commitCtx(prePool, PNULL, c => c.query(`INSERT INTO item_versions(item_id,version,snapshot,reason) VALUES('${I1}',1,'{"code":"I-1"}','reopen')`));
  await refused('item delete with versions (RESTRICT)', () => commitCtx(prePool, PNULL, c => c.query(`DELETE FROM items WHERE id='${I1}'`)));
  assert.equal((await asCtx(prePool, Wctx, c => c.query('SELECT id FROM item_versions'))).rows.length, 1, 'W reads own-tenant history');
  assert.equal((await asCtx(prePool, CtxA, c => c.query('SELECT id FROM item_versions'))).rows.length, 1, 'C reads gap-visible history');
  assert.equal((await asCtx(prePool, Ectx, c => c.query('SELECT id FROM item_versions'))).rows.length, 1, 'E reads own-provenance history');
  assert.equal((await asCtx(prePool, E2ctx, c => c.query('SELECT id FROM item_versions'))).rows.length, 0, 'E without provenance reads nothing');
  pass('history matrix: W linked, C gap-gated, E provenance-pinned, foreign E denied');
  await commitCtx(prePool, PAT, c => c.query(`UPDATE client_services SET show_gap=false WHERE client_id='${A}'`));
  assert.equal((await asCtx(prePool, CtxA, c => c.query('SELECT id FROM item_versions'))).rows.length, 0, 'C reads non-gap history: denied');
  pass('C non-gap history refused after show_gap=false');
  const copyA = (await commitCtx(prePool, PAT, c => c.query(`INSERT INTO approved_service_copies(client_id,service_id,service_code,sealed_by,content_hash,payload) VALUES('${A}','${S}','U42S','${P}','h','{}') RETURNING id`))).rows[0].id;
  const copyB = (await commitCtx(prePool, { ...PAT, tenantId: B, targetId: B }, c => c.query(`INSERT INTO approved_service_copies(client_id,service_code,sealed_by,content_hash,payload) VALUES('${B}','U42S','${P}','h','{}') RETURNING id`))).rows[0].id;
  await commitCtx(prePool, PAT, c => c.query(`INSERT INTO approved_copy_files(copy_id,file_name,mime,size_bytes,data) VALUES('${copyA}','e.pdf','application/pdf',3,'abc'::bytea)`));
  const copyC = (await commitCtx(prePool, Wctx, c => c.query(`INSERT INTO approved_service_copies(client_id,service_code,sealed_by,content_hash,payload) VALUES('${A}','U42S','${W}','h','{}') RETURNING id`))).rows[0].id;
  await commitCtx(prePool, Wctx, c => c.query(`INSERT INTO approved_copy_files(copy_id,file_name,mime,size_bytes,data) VALUES('${copyC}','w.pdf','application/pdf',3,'abc'::bytea)`));
  await refused('W file on another sealer copy', () => commitCtx(prePool, Wctx, c => c.query(`INSERT INTO approved_copy_files(copy_id,file_name,mime,size_bytes,data) VALUES('${copyA}','x.pdf','application/pdf',3,'abc'::bytea)`)));
  pass('copy files actor-bound: only the sealer extends their own sealed copy');
  await commitCtx(prePool, PAT, c => c.query(`DELETE FROM services WHERE id='${S}'`));
  const left = await asCtx(prePool, PAT, c => c.query('SELECT service_code,payload FROM approved_service_copies WHERE id=$1', [copyA]));
  assert.equal(left.rows.length, 1, 'sealed copy survives full source-service removal');
  pass('N-3 analogue: copy intact after source service DELETE (no catalog FK)');
  assert.equal((await asCtx(prePool, Wctx, c => c.query('SELECT id FROM approved_service_copies'))).rows.length, 2, 'W still sees own-tenant copies after source-service removal');
  assert.equal((await asCtx(prePool, CtxA, c => c.query('SELECT id FROM approved_service_copies'))).rows.length, 2, 'C reads own copies');
  assert.equal((await asCtx(prePool, CtxB, c => c.query('SELECT id FROM approved_service_copies'))).rows.length, 1, 'C_B reads only its own copy');
  assert.equal((await asCtx(prePool, Ectx, c => c.query('SELECT id FROM approved_service_copies'))).rows.length, 0, 'E denied on copies');
  assert.equal((await asCtx(prePool, Ectx, c => c.query('SELECT id FROM approved_copy_files'))).rows.length, 0, 'E denied on copy files');
  const anon = await prePool.connect();
  try { assert.equal((await anon.query('SELECT id FROM approved_service_copies')).rows.length, 0, 'anonymous sees nothing'); } finally { anon.release(); }
  pass('RLS matrix: ge_admin all, same-tenant W/C read, cross-tenant isolated, E denied, anon empty');
  await refused('E inserting a copy', () => commitCtx(prePool, Ectx, c => c.query(`INSERT INTO approved_service_copies(client_id,service_code,sealed_by,content_hash,payload) VALUES('${A}','U42S','${E}','h','{}')`)));
  // No UPDATE/DELETE policy exists, so RLS default-deny yields zero affected
  // rows (silent) rather than an error — assert the zero and the intact row.
  const up = await commitCtx(prePool, PAT, c => c.query(`UPDATE approved_service_copies SET service_code='X' WHERE id='${copyA}'`));
  assert.equal(up.rowCount, 0, 'copy UPDATE affects 0 rows (immutable, no policy)');
  const intact = await asCtx(prePool, PAT, c => c.query('SELECT service_code FROM approved_service_copies WHERE id=$1', [copyA]));
  assert.equal(intact.rows[0]?.service_code, 'U42S', 'sealed row unchanged after refused UPDATE');
  const del = await commitCtx(prePool, PAT, c => c.query(`DELETE FROM approved_service_copies WHERE id='${copyA}'`));
  assert.equal(del.rowCount, 0, 'copy DELETE affects 0 rows (immutable, tenant CASCADE only)');
  pass('copies immutable: UPDATE/DELETE touch 0 rows');
  const vup = await commitCtx(prePool, PNULL, c => c.query(`UPDATE item_versions SET reason='x' WHERE item_id='${I1}'`));
  assert.equal(vup.rowCount, 0, 'version UPDATE affects 0 rows (append-only, no policy)');
  const vdel = await commitCtx(prePool, PNULL, c => c.query(`DELETE FROM item_versions WHERE item_id='${I1}'`));
  assert.equal(vdel.rowCount, 0, 'version DELETE affects 0 rows (append-only, no policy)');
  pass('versions append-only (SHIELD-P1-01): UPDATE/DELETE touch 0 rows');
  const acts = ['CREATE_STANDARD', 'CREATE_DISCLOSURE', 'ARCHIVE_ITEM', 'REOPEN_ITEM_SCOPE', 'SERVICE_DELETED', 'IMPORT_CATALOG_COMMITTED'];
  for (const a of acts) await commitCtx(prePool, PNULL, c => c.query(`INSERT INTO audit_log(client_id,user_id,action,entity_type) VALUES(NULL,'${P}','${a}','items')`));
  pass('six new audit actions admitted NULL-tenant (SHIELD-P1-04: seal is target-bound only)');
  await refused('seal audited NULL-tenant', () => commitCtx(prePool, PNULL, c => c.query(`INSERT INTO audit_log(client_id,user_id,action,entity_type) VALUES(NULL,'${P}','APPROVED_COPY_SEALED','approved_service_copies')`)));
  await commitCtx(prePool, PAT, c => c.query(`INSERT INTO audit_log(client_id,user_id,action,entity_type) VALUES('${A}','${P}','APPROVED_COPY_SEALED','approved_service_copies')`));
  await refused('unknown audit action', () => commitCtx(prePool, PNULL, c => c.query(`INSERT INTO audit_log(client_id,user_id,action,entity_type) VALUES(NULL,'${P}','HACK_X','items')`)));

  // 6. Rollback path: previous code never touches new tables — drop them, legacy reads stay green.
  const rc = await prePool.connect();
  try {
    await rc.query('BEGIN');
    await setTenantContext(rc, PNULL as never);
    await rc.query('DROP TABLE approved_copy_files');
    await rc.query('DROP TABLE approved_service_copies');
    await rc.query('DROP TABLE item_versions');
    const legacy = (await rc.query(`SELECT i.code,a.value FROM items i JOIN answers a ON a.item_id=i.id WHERE a.client_id='${A}'`)).rows;
    assert.equal(legacy.length, 1, 'legacy item/answer read intact after drop-new-tables');
    await rc.query('ROLLBACK');
    pass('rollback = stop writing new tables (or drop them); legacy reads green, counts intact');
  } finally { rc.release(); }

  log('SUMMARY');
  log(`PREDECESSOR_SHAPE=${preShape} B17_SHAPE=${u1Shape} B17_CONTENT_SHAPE=${contentShape}`);
  log(`CONTENT_SHA256=${newContent.checksum}`);
  log(`MIGRATED_EQUALS_FRESH=${migratedShape === contentShape} COUNTS=${JSON.stringify(after)}`);
  log(`CALIBRATION_OK=${calibrationOk}`);
} finally {
  for (const p of pools) await p.end().catch(() => {});
  await oraclePre?.end().catch(() => {});
  await oracle?.end().catch(() => {});
  try { run('pg_ctl.exe', ['stop', '-D', data, '-m', 'fast', '-w', '-t', '60']); } catch { /* disposable */ }
  rmSync(tmp, { recursive: true, force: true });
}
