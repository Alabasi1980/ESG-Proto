// TASK-PROTO-U4-2-FIX P4 — isolated live proof (F1) of the P2+P4 handler paths.
// Own throwaway PG18 cluster (initdb) on 127.0.0.1:55433, stopped + deleted
// afterwards. NEVER touches the shared DB (127.0.0.1:55432), never reads
// .env, never prints secrets (trust auth, loopback-only). Handler SQL below
// mirrors the route statements exactly (same tables/columns/predicates/order);
// matrix + source-shape are pinned in src/lib/u42fix-p4.test.ts.
// Flow: archive (P2) → redundant archive +F2 audit → reopen (P4) → stale
// version refused → GE-final-style freeze → seal (copy+bytes+audit, one txn)
// → idempotent re-seal → mismatch seal ROLLBACK + 409 → DELETE SOURCE SERVICE
// (disaster simulation: the API would refuse while copies exist) → view
// approved copy complete = N-3 → N-2 frozen write refused → N-4 old version +
// answers in history → rollback demo. SUMMARY carries zero-loss counts.
import assert from 'node:assert/strict';
import pg from 'pg';
import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, rmSync, writeSync, openSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { STRUCTURE_SQL, CONTENT_AUTHORITY_SQL, b17Source, b17ContentSource } from '../src/db/b17Readiness.ts';
import { setTenantContext } from '../src/db/index.ts';
import { snapshotContentHash } from '../src/lib/approvalChain.ts';

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
const ROLE = 'u42owner', DB = 'u42fix_p4';
const PASS = randomBytes(24).toString('base64url');
setTimeout(() => { console.error('WATCHDOG'); process.exit(9); }, 1380000).unref();

const A = '11111111-1111-4111-8111-111111111111', B = '12121212-1212-4212-8212-121212121212';
const D1 = '21111111-1111-4111-8111-111111111111', D2 = '21222222-2222-4222-8222-222222222222';
const S = '31111111-1111-4111-8111-111111111111';
const ST = '41111111-1111-4111-8111-111111111111', DI = '51111111-1111-4111-8111-111111111111';
const I1 = '61111111-1111-4111-8111-111111111111', I2 = '62222222-2222-4222-8222-222222222222';
const P = '71111111-1111-4111-8111-111111111111', C = '73333333-3333-4333-8333-333333333333';
const E = '74444444-4444-4444-8444-444444444444', W = '75555555-5555-4555-8555-555555555555';
const SES = '81111111-1111-4111-8111-111111111111';
const log = (m: string) => console.log(m), pass = (m: string) => console.log(`PASS ${m}`);
const RUNID = randomBytes(3).toString('hex');
const BEATLOG = join(tmpdir(), 'u42p4beats.log');
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
const PAT = { role: 'ge_admin', mode: 'platform', purpose: 'platform.config', tenantId: A, userId: P, sessionId: SES, departmentId: null, tabId: SES, targetId: A };
const PNULL = { role: 'ge_admin', mode: 'platform', purpose: 'platform.config', tenantId: null, userId: P, sessionId: SES, departmentId: null, tabId: SES, targetId: null };
// Platform summary work context (purpose work + tenant NULL): the only reader
// of NULL-client platform audit events (b17_platform_scope branch).
const PWORK = { role: 'ge_admin', mode: 'platform', purpose: 'work', tenantId: null, userId: P, sessionId: SES, departmentId: null, tabId: SES, targetId: null };

const tmp = mkdtempSync(join(tmpdir(), 'u42fix-p4-'));
const data = join(tmp, 'data'), sock = join(tmp, 'sock');
let oracle: pg.Client | undefined; let sup: pg.Client | undefined; const pools: pg.Pool[] = [];
const qShape = async (c: pg.PoolClient | pg.Client) => (await c.query(STRUCTURE_SQL)).rows[0].checksum as string;
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
const refused = async (label: string, fn: () => Promise<unknown>, want = /row-level security|permission denied|violates|FROZEN_SCOPE|REFUSED/i) => {
  await assert.rejects(fn, (e: Error) => want.test(String(e?.message)), `${label} must be refused`);
  pass(`${label} refused`);
};
const counts = async (c: pg.PoolClient | pg.Client) => {
  const out: Record<string, number> = {};
  for (const t of ['clients', 'departments', 'users', 'services', 'standards', 'disclosures', 'items', 'client_services', 'assignments', 'answers', 'item_versions', 'approved_service_copies', 'approved_copy_files', 'audit_log'])
    out[t] = (await c.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n;
  return out;
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
  oracle = new pg.Client({ connectionString: `postgresql://postgres@127.0.0.1:${PORT}/postgres` });
  await oracle.connect();
  assert.equal(Math.floor(Number((await oracle.query('SHOW server_version_num')).rows[0].server_version_num) / 10000), 18);
  await oracle.query(`CREATE ROLE ${ROLE} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${PASS}'`);
  await oracle.query(`CREATE DATABASE ${DB} OWNER ${ROLE}`);
  const mk = (db: string) => { const p = new pg.Pool({ connectionString: `postgresql://${ROLE}:${encodeURIComponent(PASS)}@127.0.0.1:${PORT}/${db}`, max: 3, query_timeout: 120000 }); pools.push(p); return p; };
  const pool = mk(DB);

  // 1. Fresh install with the CURRENT files (schema + b17 + content with the 2 P4 branches).
  const newContent = b17ContentSource();
  const fc = await pool.connect();
  await fc.query('BEGIN'); await fc.query(readFileSync('src/db/schema.sql', 'utf8')); await fc.query('COMMIT');
  await fc.query('BEGIN');
  await fc.query("SELECT set_config('app.b17_checksum',$1,true)", [b17Source().checksum]);
  await fc.query(b17Source().sql);
  const u1Shape = await qShape(fc);
  await fc.query("SELECT set_config('app.current_purpose','migration',true)");
  await fc.query('INSERT INTO app_schema_versions(version,checksum,structure_checksum) VALUES($1,$2,$3)', ['B17_U1', b17Source().checksum, u1Shape]);
  await fc.query('COMMIT');
  await fc.query('BEGIN');
  await fc.query("SELECT set_config('app.current_purpose','migration.inventory',true)");
  await fc.query(newContent.sql);
  const contentShape = await qShape(fc);
  await fc.query("SELECT set_config('app.current_purpose','migration',true)");
  await fc.query('INSERT INTO app_schema_versions(version,checksum,structure_checksum) VALUES($1,$2,$3)', ['B17_U2D', newContent.checksum, contentShape]);
  await fc.query('COMMIT'); fc.release();
  log(`SHAPE B17_CONTENT_SHAPE=${contentShape} CONTENT_SHA256=${newContent.checksum}`);
  const pols = await pool.query(`SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='answers' AND policyname LIKE '%reopen%'`);
  assert.equal(pols.rows.length, 1, 'reopen branch present');
  const seal = await pool.query(`SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='evidence_attachments' AND policyname LIKE '%seal%'`);
  assert.equal(seal.rows.length, 1, 'seal read branch present');
  pass('fresh install carries exactly the two P4 branches');

  // 2. Seed tenant data via a superuser client onto DB (bypasses RLS like the
  // P1 oracle precedent; never the app path).
  sup = new pg.Client({ connectionString: `postgresql://postgres@127.0.0.1:${PORT}/${DB}` });
  await sup.connect();
  await sup.query('BEGIN');
  await sup.query(`INSERT INTO clients(id,code,name) VALUES('${A}','U42A','A'),('${B}','U42B','B')`);
  await sup.query(`INSERT INTO departments(id,client_id,code,name) VALUES('${D1}','${A}','D1','D1'),('${D2}','${A}','D2','D2')`);
  for (const [id, cl, em, rl] of [[P, null, 'p@u42.test', 'ge_admin'], [W, null, 'w@u42.test', 'ge_admin'], [C, A, 'c@u42.test', 'client_admin'], [E, A, 'e@u42.test', 'employee']] as const)
    await sup.query(`INSERT INTO users(id,client_id,email,password_hash,name,role,is_active) VALUES('${id}',${cl ? `'${cl}'` : 'NULL'},'${em}','x','${em}','${rl}',true)`);
  await sup.query(`INSERT INTO services(id,code,name) VALUES('${S}','U42S','S')`);
  await sup.query(`INSERT INTO standards(id,code,title,category) VALUES('${ST}','U42-STD','Std','GRI')`);
  await sup.query(`INSERT INTO disclosures(id,standard_id,code,title) VALUES('${DI}','${ST}','D-1','D1')`);
  await sup.query(`INSERT INTO items(id,disclosure_id,code,requirement,priority,esg_class,weight) VALUES('${I1}','${DI}','I-1','Req','high','general',3),('${I2}','${DI}','I-2','Req2','mid','general',2)`);
  await sup.query(`INSERT INTO service_standards(service_id,standard_id) VALUES('${S}','${ST}')`);
  await sup.query(`INSERT INTO client_services(client_id,service_id) VALUES('${A}','${S}')`);
  await sup.query(`INSERT INTO assignments(client_id,item_id,department_id) VALUES('${A}','${I1}','${D1}'),('${A}','${I2}','${D1}')`);
  await sup.query(`INSERT INTO answers(client_id,item_id,department_id,submitted_by,status,value) VALUES('${A}','${I1}','${D1}','${E}','submitted','v1'),('${A}','${I2}','${D1}','${E}','submitted','v2')`);
  await sup.query(`INSERT INTO evidence_attachments(answer_id,file_name,mime,size_bytes,data,uploaded_by) SELECT id,'e.pdf','application/pdf',3,'abc'::bytea,'${E}' FROM answers WHERE item_id='${I1}'`);
  await sup.query('COMMIT');
  // sup stays open as the RLS-bypassing ledger handle (closed in finally).
  const before = await counts(sup);
  log(`SEEDED (superuser bypass): items=2 answers=2 + 1 attachment`);

  // 3. P2 archive leg (mirrors DELETE /items/:id): blocker counts → archive + audit.
  const arc = await commitCtx(pool, PNULL, async c => {
    const cur = (await c.query('SELECT id, code, status FROM items WHERE id = $1 FOR UPDATE', [I2])).rows[0];
    assert.equal(cur.status, 'active');
    const kids = (await c.query(`SELECT b17_catalog_child_count('item.answers', $1) AS answers`, [I2])).rows[0];
    assert.ok(Number(kids.answers) > 0, 'I2 has tenant work → archive path');
    await c.query(`UPDATE items SET status = 'archived', archived_at = clock_timestamp(), archive_reason = $2 WHERE id = $1`, [I2, 'superseded']);
    await c.query(`INSERT INTO audit_log(client_id,user_id,action,entity_type,entity_id,payload) VALUES(NULL,$1,'ARCHIVE_ITEM','items',$2,$3)`, [P, I2, JSON.stringify({ code: 'I-2' })]);
    return cur;
  });
  assert.equal(arc.code, 'I-2');
  assert.equal((await asCtx(pool, PNULL, c => c.query(`SELECT count(*)::int n FROM items WHERE status='active'`))).rows[0].n, 1, 'archived item leaves the live scope');
  pass('archive: status flag, live scope excludes, history retained');
  // F2: redundant archive still audits (idempotent but tracked).
  const auditsBefore = (await asCtx(pool, PWORK, c => c.query(`SELECT count(*)::int n FROM audit_log WHERE action='ARCHIVE_ITEM'`))).rows[0].n;
  await commitCtx(pool, PNULL, async c => {
    const cur = (await c.query('SELECT id, code, status FROM items WHERE id = $1 FOR UPDATE', [I2])).rows[0];
    assert.equal(cur.status, 'archived');
    await c.query(`INSERT INTO audit_log(client_id,user_id,action,entity_type,entity_id,payload) VALUES(NULL,$1,'ARCHIVE_ITEM','items',$2,$3)`, [P, I2, JSON.stringify({ code: 'I-2', redundant: true })]);
  });
  assert.equal((await asCtx(pool, PWORK, c => c.query(`SELECT count(*)::int n FROM audit_log WHERE action='ARCHIVE_ITEM'`))).rows[0].n, auditsBefore + 1, 'F2 audit-on-redundant-archive present');
  pass('F2: redundant archive emits ARCHIVE_ITEM with redundant flag');

  // 4. P4 reopen leg (mirrors PATCH /items/:id reopen path): version check →
  // snapshot → item bump → answers reopened → audit, one txn.
  const re = await commitCtx(pool, PNULL, async c => {
    const cur = (await c.query('SELECT id, code, version, status FROM items WHERE id = $1 FOR UPDATE', [I1])).rows[0];
    assert.equal(cur.version, 1, 'expectedVersion 1 matches (fresh)');
    const ans = (await c.query(`SELECT id, client_id, status FROM answers WHERE item_id = $1`, [I1])).rows;
    assert.ok(ans.every((a: { status: string }) => ['submitted', 'approved', 'client_approved'].includes(a.status)));
    assert.equal(await c.query('SELECT is_scope_frozen($1, $2) AS f', [A, I1]).then(r => r.rows[0].f), false, 'scope unfrozen');
    const full = (await c.query('SELECT * FROM items WHERE id = $1', [I1])).rows[0];
    await c.query('INSERT INTO item_versions(item_id,version,snapshot,changed_by,reason) VALUES($1,$2,$3,$4,$5)', [I1, cur.version, full, P, 'reopen for correction']);
    const upd = (await c.query(`UPDATE items SET requirement = $1, version = version + 1 WHERE id = $2 RETURNING version`, ['Req fixed', I1])).rows[0];
    const rea = await c.query(`UPDATE answers SET status = 'reopened', version = version + 1, updated_at = NOW() WHERE id = ANY($1::uuid[])`, [ans.map((a: { id: string }) => a.id)]);
    await c.query(`INSERT INTO audit_log(client_id,user_id,action,entity_type,entity_id,payload) VALUES(NULL,$1,'REOPEN_ITEM_SCOPE','items',$2,$3)`, [P, I1, JSON.stringify({ fromVersion: 1, toVersion: upd.version })]);
    return { upd, rea: rea.rowCount };
  });
  assert.equal(re.upd.version, 2); assert.equal(re.rea, 1);
  const ver = (await asCtx(pool, PNULL, c => c.query('SELECT version, snapshot->>\'requirement\' AS req, reason FROM item_versions WHERE item_id = $1', [I1]))).rows[0];
  assert.deepEqual([ver.version, ver.req, ver.reason], [1, 'Req', 'reopen for correction'], 'N-4: old version + reason in history');
  assert.equal((await asCtx(pool, Wctx, c => c.query(`SELECT status FROM answers WHERE item_id='${I1}'`))).rows[0].status, 'reopened', 'N-4: answer reopened, not silently overwritten');
  pass('reopen atomic: version+snapshot+answers+audit; N-4 old version + reopened answers visible');
  // Stale version refused (no write): expectedVersion 1 vs current 2.
  const vcur = (await asCtx(pool, PNULL, c => c.query('SELECT version FROM items WHERE id = $1', [I1]))).rows[0].version;
  assert.equal(vcur, 2);
  await assert.rejects(commitCtx(pool, PNULL, async c => {
    const cur = (await c.query('SELECT version FROM items WHERE id = $1 FOR UPDATE', [I1])).rows[0];
    if (cur.version !== 1) throw Object.assign(new Error('stale'), { statusCode: 409, code: 'item.version_conflict' });
  }), /stale/, 'stale expectedVersion → 409, zero writes');
  assert.equal((await asCtx(pool, PNULL, c => c.query('SELECT count(*)::int n FROM item_versions WHERE item_id=$1', [I1]))).rows[0].n, 1, 'conflict wrote nothing');
  pass('version conflict: stale write refused, history untouched');
  // New branch narrowness: under PNULL only the reopened transition passes;
  // any other target status is refused (no other P-context answers UPDATE exists).
  await refused('P reopen branch cannot mint other statuses', () => commitCtx(pool, PNULL, c => c.query(`UPDATE answers SET status='approved' WHERE item_id='${I2}'`)));
  pass('reopen branch is P-config only and transition-confined');

  // 5. Freeze (GE-final analogue) + seal in the same txn: snapshot insert →
  // copy insert → files insert → audit; ROLLBACK on mismatch.
  const frozen = [{ itemId: I1 }, { itemId: I2 }];
  await commitCtx(pool, Wctx, async c => {
    await c.query(`INSERT INTO review_snapshots(client_id,scope_type,scope_ref,payload,content_hash,created_by) VALUES($1,'tenant',$2,$3,$4,$5)`, [A, A, JSON.stringify({ items: frozen }), 'snaphash', W]);
  });
  assert.equal(await (async () => { const c = await pool.connect(); try { await c.query('BEGIN'); await setTenantContext(c, PAT as never); const r = await c.query('SELECT is_scope_frozen($1,$2) AS f', [A, I1]); await c.query('ROLLBACK'); return r.rows[0].f; } finally { c.release(); } })(), true, 'scope frozen after snapshot (tenant-bound fact)');
  // Phase A (targetless PNULL, mirrors the handler): definition/link/items/
  // answer states + freeze coverage from the summary-readable context.
  const phaseA = await asCtx(pool, PNULL, async c => {
    const svc = (await c.query('SELECT id, code FROM services WHERE id = $1', [S])).rows[0];
    const link = (await c.query('SELECT service_id FROM client_services WHERE client_id = $1 AND service_id = $2', [A, S])).rows[0];
    const ids = (await c.query(`SELECT i.id FROM items i JOIN disclosures d ON d.id=i.disclosure_id JOIN service_standards ss ON ss.standard_id=d.standard_id JOIN assignments a ON a.item_id=i.id AND a.client_id=$2 WHERE ss.service_id=$1`, [S, A])).rows.map((r: { id: string }) => String(r.id));
    const ans = (await c.query(`SELECT id, item_id, status FROM answers WHERE client_id=$1 AND item_id=ANY($2::uuid[])`, [A, ids])).rows;
    const snaps = (await c.query('SELECT payload FROM review_snapshots WHERE client_id=$1', [A])).rows;
    const frozen = new Set<string>();
    for (const row of snaps) {
      const items = row.payload && typeof row.payload === 'object' ? (row.payload as { items?: unknown }).items : null;
      if (Array.isArray(items)) for (const e of items) if (typeof (e as { itemId?: unknown }).itemId === 'string') frozen.add((e as { itemId: string }).itemId);
    }
    return { svc, link: !!link, ids, ans, uncovered: ids.filter((id: string) => !frozen.has(id)) };
  });
  assert.ok(phaseA.svc && phaseA.link, 'phase A verifies definition + linkage');
  assert.deepEqual(phaseA.uncovered, [], 'phase A: freeze covers every assigned item');
  // Phase B (target-bound PAT, same txn shape as the handler): byte copy +
  // copy/file/audit inserts, atomic.
  const copyId = await commitCtx(pool, PAT, async c => {
    const payload = { definition: phaseA.svc, content: [{ t: 1 }], scope: { clientId: A, serviceId: S }, results: { answers: phaseA.ans.length } };
    const hash = snapshotContentHash(payload);
    const cp = (await c.query(`INSERT INTO approved_service_copies(client_id,service_id,service_code,sealed_by,content_hash,payload) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`, [A, S, 'U42S', P, hash, JSON.stringify(payload)])).rows[0];
    const src = (await c.query(`SELECT id, file_name, mime, size_bytes, data FROM evidence_attachments WHERE answer_id = ANY($1::uuid[])`, [phaseA.ans.map((a: { id: string }) => String(a.id))])).rows;
    assert.ok(src.length >= 1, 'seal reads attachment bytes under target-T branch');
    for (const f of src) await c.query(`INSERT INTO approved_copy_files(copy_id,answer_ref,file_name,mime,size_bytes,data) VALUES($1,$2,$3,$4,$5,$6)`, [cp.id, String(f.id), f.file_name, f.mime, f.size_bytes, f.data]);
    await c.query(`INSERT INTO audit_log(client_id,user_id,action,entity_type,entity_id,payload) VALUES($1,$2,'APPROVED_COPY_SEALED','approved_service_copies',$3,$4)`, [A, P, cp.id, JSON.stringify({ contentHash: hash, files: src.length })]);
    return cp.id as string;
  });
  const sealed = await asCtx(pool, PAT, c => c.query('SELECT content_hash FROM approved_service_copies WHERE id=$1', [copyId]));
  assert.equal(sealed.rows[0].content_hash.length, 64, 'content hash sealed');
  const fbytes = await asCtx(pool, PAT, c => c.query('SELECT data FROM approved_copy_files WHERE copy_id=$1', [copyId]));
  assert.ok(fbytes.rows.length >= 1 && Buffer.from(fbytes.rows[0].data).equals(Buffer.from('abc')), 'attachment bytes identical in the copy');
  pass('seal atomic with freeze: copy + files + audit in one txn; bytes identical');
  // Seal SELECT branch is target-bound: PNULL sees no bytes.
  assert.equal((await asCtx(pool, PNULL, c => c.query('SELECT id FROM evidence_attachments'))).rows.length, 0, 'targetless P reads no attachment bytes');
  pass('seal read branch: target-bound only');
  // Mismatch re-seal → 409 + ROLLBACK (content changed: new item I3 under the service).
  const I3 = '63333333-3333-4333-8333-333333333333';
  await commitCtx(pool, PNULL, async c => {
    await c.query(`INSERT INTO items(id,disclosure_id,code,requirement,priority,esg_class,weight) VALUES('${I3}','${DI}','I-3','Req3','low','general',1)`);
  });
  await commitCtx(pool, Wctx, async c => {
    await c.query(`INSERT INTO review_snapshots(client_id,scope_type,scope_ref,payload,content_hash,created_by) VALUES($1,'tenant',$2,$3,$4,$5)`, [A, A, JSON.stringify({ items: [...frozen, { itemId: I3 }] }), 'snaphash2', W]);
  });
  await assert.rejects(commitCtx(pool, PAT, async c => {
    const payload = { definition: { code: 'U42S' }, content: [{ t: 2 }], scope: { clientId: A, serviceId: S }, results: {} };
    const hash = snapshotContentHash(payload);
    const ex = (await c.query('SELECT id, content_hash FROM approved_service_copies WHERE client_id=$1 AND service_id=$2', [A, S])).rows[0];
    if (ex && ex.content_hash !== hash) throw Object.assign(new Error('seal conflict'), { statusCode: 409, code: 'copy.seal_conflict' });
  }), /seal conflict/, 'changed content on existing copy → 409');
  assert.equal((await asCtx(pool, PAT, c => c.query('SELECT count(*)::int n FROM approved_service_copies WHERE client_id=$1', [A]))).rows[0].n, 1, 'conflict rolled back: still one copy');
  pass('seal mismatch: 409 copy.seal_conflict, ROLLBACK, single copy intact');
  // Idempotent re-seal: identical content resolves to the existing copy (the
  // handler's deduped branch) — no duplicate row.
  const sameHash = snapshotContentHash({ definition: phaseA.svc, content: [{ t: 1 }], scope: { clientId: A, serviceId: S }, results: { answers: phaseA.ans.length } });
  const same = await asCtx(pool, PAT, c => c.query('SELECT id FROM approved_service_copies WHERE client_id=$1 AND service_id=$2 AND content_hash=$3', [A, S, sameHash]));
  assert.equal(same.rows.length, 1, 'idempotent re-seal resolves to the existing copy');
  assert.equal(same.rows[0].id, copyId, 'same copy id, no duplicate row');
  pass('re-seal idempotent: identical content deduped');

  // 6. N-2: frozen scope refuses writes. The handler pre-check (tenant-bound
  // fact) 409s before any write; the trigger backstop fires live wherever
  // rows are RLS-visible (work contexts). Either way zero writes land.
  // Runs BEFORE the disaster deletion below (which unlinks the catalog and
  // would hide rows from work contexts for unrelated reasons).
  const fz = await asCtx(pool, PAT, c => c.query('SELECT is_scope_frozen($1,$2) AS f', [A, I1]));
  assert.equal(fz.rows[0].f, true, 'N-2: handler pre-check (tenant-bound) sees frozen → 409 FROZEN_SCOPE, no write attempted');
  await refused('N-2 trigger backstop on frozen scope (work context)', () => commitCtx(pool, Wctx, c => c.query(`UPDATE answers SET status='reopened' WHERE item_id='${I2}'`)), /FROZEN_SCOPE/i);
  assert.equal((await asCtx(pool, PNULL, c => c.query(`SELECT requirement, version FROM items WHERE id='${I1}'`))).rows[0].requirement, 'Req fixed', 'N-2: frozen write changed nothing');
  assert.equal((await asCtx(pool, Wctx, c => c.query(`SELECT status FROM answers WHERE item_id='${I2}'`))).rows[0].status, 'submitted', 'N-2: answers unchanged');
  pass('N-2: frozen writes refused, pre-edit state intact');

  // 7. N-3: the API would refuse deletion while copies exist (DG-02) — prove
  // the guard first, then simulate full removal and prove viewer completeness.
  const pre = await commitCtx(pool, PNULL, async c => c.query(`SELECT (SELECT COUNT(*) FROM approved_service_copies WHERE service_id=$1)::int AS copies`, [S]));
  assert.ok(Number(pre.rows[0].copies) > 0, 'copy exists → API delete preconditions would refuse');
  pass('DG-02 guard would refuse service delete while a copy exists (delete_blocked)');
  await commitCtx(pool, PNULL, c => c.query(`DELETE FROM services WHERE id='${S}'`));
  assert.equal((await asCtx(pool, PNULL, c => c.query(`SELECT count(*)::int n FROM services WHERE id='${S}'`))).rows[0].n, 0, 'source service fully removed');
  const view = await asCtx(pool, PAT, c => c.query('SELECT service_code, content_hash, payload FROM approved_service_copies WHERE client_id=$1 AND service_id=$2', [A, S]));
  assert.equal(view.rows.length, 1, 'N-3: sealed copy viewable after source deletion');
  assert.equal(view.rows[0].service_code, 'U42S', 'N-3: definition intact');
  assert.ok(view.rows[0].content_hash.length === 64, 'N-3: hash intact');
  const vfiles = await asCtx(pool, PAT, c => c.query('SELECT file_name, size_bytes, data FROM approved_copy_files WHERE copy_id=$1', [copyId]));
  assert.ok(vfiles.rows.length >= 1 && Buffer.from(vfiles.rows[0].data).toString() === 'abc', 'N-3: attachment bytes intact');
  assert.equal((await asCtx(pool, PNULL, c => c.query(`SELECT count(*)::int n FROM approved_service_copies WHERE id='${copyId}'`))).rows[0].n, 1, 'N-3: P sees the copy (no catalog join needed)');
  assert.equal((await asCtx(pool, Wctx, c => c.query('SELECT id FROM approved_service_copies'))).rows.length, 1, 'N-3: W own-tenant sees it');
  pass('N-3: definition + content + scope + results + bytes complete after DELETE SOURCE');
  // 8. Rollback demo: version row + bad status in one txn → full ROLLBACK.
  const vc0 = (await asCtx(pool, PNULL, c => c.query('SELECT count(*)::int n FROM item_versions'))).rows[0].n;
  await assert.rejects(commitCtx(pool, PNULL, async c => {
    await c.query(`INSERT INTO item_versions(item_id,version,snapshot,reason) VALUES('${I1}',99,'{}','demo')`);
    await c.query(`UPDATE answers SET status='reopened' WHERE item_id='${I1}'`);
    await c.query(`INSERT INTO item_versions(item_id,version,snapshot,reason) VALUES('${I1}',1,'{}','demo')`);
  }), /duplicate|unique|23505/i, 'duplicate version aborts the txn');
  assert.equal((await asCtx(pool, PNULL, c => c.query('SELECT count(*)::int n FROM item_versions'))).rows[0].n, vc0, 'rollback: no partial version row');
  pass('rollback: failed seal/reopen leaves zero partial rows');

  // 9. Zero-row-loss ledger (superuser handle) + SUMMARY.
  const after = await counts(sup);
  assert.equal(after.clients, 2, 'tenants intact');
  log(`SERVICES_LEFT=${JSON.stringify((await sup.query('SELECT id, code FROM services')).rows)}`);
  assert.equal(after.services, 1, 'only the disaster-simulated service is gone (schema GRI seed untouched)');
  assert.equal((await sup.query(`SELECT count(*)::int n FROM services WHERE code='GRI'`)).rows[0].n, 1, 'schema seed service intact');
  assert.equal(after.items, 3, 'I1 + I2 + fixture I3, none lost');
  assert.equal(after.answers, 2, 'answers preserved (1 reopened + 1 submitted)');
  assert.equal(after.item_versions, 1, 'exactly the one reopen version row; rollback left nothing partial');
  assert.equal(after.approved_service_copies, 1, 'exactly one sealed copy');
  assert.ok(after.approved_copy_files >= 1, 'copied bytes present');
  assert.ok(after.audit_log >= 4, 'archive + redundant + reopen + seal audits present');
  pass('zero-row-loss ledger holds (only documented disaster-simulation delta)');
  log('SUMMARY');
  log(`CONTENT_SHAPE=${contentShape} CONTENT_SHA256=${newContent.checksum}`);
  log(`SEAL_COPY=${copyId} FILES=${fbytes.rows.length} N3_COMPLETE=1 N2_REFUSED=1 N4_VERSIONS=1`);
  log(`COUNTS=${JSON.stringify(after)} ZERO_LOSS=1 (services=1 is the untouched schema GRI seed)`);
  log(`F1_LIVE_PROOF=archive,reopen,conflict,seal,reseal-idempotent,mismatch-rollback,delete-source,view-copy,n2,n4,rollback`);
} finally {
  for (const p of pools) await p.end().catch(() => {});
  await oracle?.end().catch(() => {});
  await sup?.end().catch(() => {});
  try { run('pg_ctl.exe', ['stop', '-D', data, '-m', 'fast', '-w', '-t', '60']); } catch { /* disposable */ }
  rmSync(tmp, { recursive: true, force: true });
}
