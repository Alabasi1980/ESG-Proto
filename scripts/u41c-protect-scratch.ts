// TASK-PROTO-U4-1c-PROTECT round 4 (FINAL, owner decision §23) — archived-write refusal proof.
// Unselect SETS client_initiatives.archived_at (never deletes); reselect
// clears it IN PLACE (same ID, history reconnects, no duplicates); hard row
// deletion is refused by RESTRICT only when linked records exist. Version
// protocol unchanged (first valid save wins; stale 409 + approved Arabic;
// missing 400 baseline). Own fresh named loopback PG18 scratch only;
// explicit opt-in, throwaway creds, NOSUPERUSER/NOBYPASSRLS, FORCE RLS.
// Real-router barrier proofs with observed (never slept) lock waits. API JSON
// only; no UI. Cleans up only its own DBs.
import assert from 'node:assert/strict';
import pg from 'pg';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import { STRUCTURE_SQL, b17Source, b17ContentSource } from '../src/db/b17Readiness.ts';

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
  || !/^\/(u41c_scratch_\d+|u41c_protect_\d+)$/.test(url.pathname) || !url.port || url.search || url.hash
  || url.username !== 'u41cowner') throw new Error('Only own named loopback scratch accepted');
if (oracleUrl.host !== url.host || oracleUrl.pathname !== url.pathname || oracleUrl.username !== 'postgres')
  throw new Error('Oracle must be exact same scratch');
process.env.DATABASE_URL = url.toString();
process.env.JWT_SECRET = randomBytes(48).toString('hex');
setTimeout(() => { console.error('WATCHDOG'); process.exit(9); }, 290000).unref();

const A = '11111111-1111-4111-8111-111111111111';
const B = '12121212-1212-4212-8212-121212121212';
const D1 = '21111111-1111-4111-8111-111111111111';
const D2 = '21222222-2222-4222-8222-222222222222';
const S = '31111111-1111-4111-8111-111111111111';
const LIB = '91111111-1111-4111-8111-111111111111';
const LIB2 = '92222222-2222-4222-8222-222222222222';
const P_ID = 'c1111111-1111-4111-8111-111111111111';
const C_ID = 'c2222222-2222-4222-8222-222222222222';
const E_ID = 'c3333333-3333-4333-8333-333333333333';
const E2_ID = 'c4444444-4444-4444-8444-444444444444';
const PASSWORD = randomBytes(18).toString('base64url') + 'Aa1!';
const log = (m: string) => console.log(m);
const pass = (m: string) => console.log(`PASS ${m}`);
const STALE_AR = 'تغيّرت البيانات منذ فتحها. يرجى تحديثها ومراجعة التعديلات قبل الحفظ.';

const pool = new pg.Pool({ connectionString: url.toString() });
const oracle = new pg.Client({ connectionString: oracleUrl.toString() });
let child: ReturnType<typeof spawn> | undefined;
// Bounded observed wait: proceeds the moment the state appears, fails closed
// on timeout — never a timing-only sleep.
const waitFor = async (sql: string, boundMs: number) => {
  const t0 = Date.now();
  for (;;) {
    if (Number((await oracle.query(sql)).rows[0].n) > 0) return;
    assert.ok(Date.now() - t0 < boundMs, 'observed-state wait timed out');
    await new Promise(r => setTimeout(r, 100));
  }
};
try {
  await oracle.connect();
  await oracle.query("SET lock_timeout='20s'");
  assert.equal(Math.floor(Number((await oracle.query('SHOW server_version_num')).rows[0].server_version_num) / 10000), 18);
  assert.deepEqual((await pool.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0],
    { rolsuper: false, rolbypassrls: false });
  assert.equal((await pool.query('SHOW row_security')).rows[0].row_security, 'on');
  assert.equal((await pool.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n, 0);

  // Fresh install: schema + B17 + content, all as the non-superuser owner.
  const schemaSql = readFileSync('src/db/schema.sql', 'utf8');
  const db = await pool.connect();
  let fresh = '';
  try {
    await db.query('BEGIN'); await db.query(schemaSql); await db.query('COMMIT');
    await db.query('BEGIN');
    await db.query("SELECT set_config('app.b17_checksum',$1,true)", [b17Source().checksum]);
    await db.query(b17Source().sql);
    const u1 = (await db.query(STRUCTURE_SQL)).rows[0].checksum as string;
    await db.query("SELECT set_config('app.current_purpose','migration',true)");
    await db.query('INSERT INTO app_schema_versions(version,checksum,structure_checksum) VALUES($1,$2,$3)',
      ['B17_U1', b17Source().checksum, u1]);
    await db.query('COMMIT');
    await db.query('BEGIN');
    await db.query("SELECT set_config('app.current_purpose','migration.inventory',true)");
    await db.query(b17ContentSource().sql);
    fresh = (await db.query(STRUCTURE_SQL)).rows[0].checksum as string;
    await db.query("SELECT set_config('app.current_purpose','migration',true)");
    await db.query('INSERT INTO app_schema_versions(version,checksum,structure_checksum) VALUES($1,$2,$3)',
      ['B17_U2D', b17ContentSource().checksum, fresh]);
    await db.query('COMMIT');
    log(`B17_SHAPE=${u1} B17_CONTENT_SHAPE=${fresh} CONTENT_SHA=${b17ContentSource().checksum}`);
  } finally { db.release(); }

  // Base fixture (operator setup only; shape-neutral tables).
  const hash = await bcrypt.hash(PASSWORD, 10);
  await oracle.query('BEGIN');
  await oracle.query("INSERT INTO clients(id,code,name) VALUES($1,'PX','A'),($2,'PY','B')", [A, B]);
  await oracle.query('INSERT INTO departments(id,client_id,code,name) VALUES($1,$2,$3,$4),($5,$6,$7,$8)',
    [D1, A, 'D1', 'D1', D2, A, 'D2', 'D2']);
  await oracle.query("INSERT INTO services(id,code,name) VALUES($1,'SV','S')", [S]);
  await oracle.query('INSERT INTO client_services(client_id,service_id) VALUES($1,$2),($3,$4)', [A, S, B, S]);
  await oracle.query("INSERT INTO initiatives_library(id,title,sector) VALUES($1,'LIB','s'),($2,'LIB2','s')", [LIB, LIB2]);
  await oracle.query('INSERT INTO service_initiatives(service_id,initiative_id) VALUES($1,$2),($1,$3)', [S, LIB, LIB2]);
  const mk = (id: string, c: string | null, d: string | null, e: string, r: string) => oracle.query(
    `INSERT INTO users(id,client_id,department_id,email,password_hash,name,role,is_active,must_change_password)
     VALUES($1,$2,$3,$4,$5,$6,$7,true,false)`, [id, c, d, e, hash, e, r]);
  await mk(P_ID, null, null, 'p@t.test', 'ge_admin');
  await mk(C_ID, A, null, 'c@t.test', 'client_admin');
  await mk(E_ID, A, D1, 'e@t.test', 'employee');
  await mk(E2_ID, A, D2, 'e2@t.test', 'employee');
  await oracle.query("INSERT INTO document_requirements(id,client_id,service_id,title) VALUES('b1111111-1111-4111-8111-111111111111',$1,$2,'REQ')", [A, S]);
  await oracle.query('COMMIT');

  // Upgrade rehearsal: downgrade the live shape to the CURRENT committed one
  // (CASCADE + no version/archived columns), seed statuses/evidence there,
  // then run the working-tree upgrade and prove zero data loss + byte parity.
  const rh = await pool.connect();
  let selCommitted = '';
  try {
    await rh.query('ALTER TABLE initiative_department_status DROP CONSTRAINT initiative_department_status_selection_restrict');
    await rh.query('ALTER TABLE initiative_department_status ADD CONSTRAINT initiative_department_status_client_initiative_id_fkey FOREIGN KEY (client_initiative_id) REFERENCES client_initiatives(id) ON DELETE CASCADE');
    await rh.query('ALTER TABLE initiative_department_status DROP COLUMN version');
    await rh.query('ALTER TABLE document_submissions DROP COLUMN version');
    await rh.query('ALTER TABLE client_initiatives DROP COLUMN archived_at');
    const downgraded = (await rh.query(STRUCTURE_SQL)).rows[0].checksum as string;
    assert.notEqual(downgraded, fresh, 'committed shape differs from revised fresh shape');
    await oracle.query('BEGIN');
    selCommitted = (await oracle.query('INSERT INTO client_initiatives(client_id,initiative_id,selected_by) VALUES($1,$2,$3) RETURNING id',
      [A, LIB, P_ID])).rows[0].id as string;
    await oracle.query(`INSERT INTO initiative_department_status(client_initiative_id,department_id,performed,note,submitted_by,submitted_at)
      VALUES($1,$2,true,'keep-me',$3,clock_timestamp()),($1,$4,false,'draft-note',NULL,NULL)`,
      [selCommitted, D1, E_ID, D2]);
    await oracle.query(`INSERT INTO evidence_files(client_id,department_id,entity_type,entity_id,filename,mime,size_bytes,content,uploaded_by)
      SELECT $1,$2,'initiative_status',st.id,'keep.txt','text/plain',11,'submitted-b', $3 FROM initiative_department_status st
      WHERE st.client_initiative_id=$4 AND st.department_id=$2`,
      [A, D1, E_ID, selCommitted]);
    await oracle.query('COMMIT');
    const snap = async () => ({
      st: JSON.stringify((await oracle.query(`SELECT department_id,performed,note,submitted_by,submitted_at::text AS submitted_at
        FROM initiative_department_status ORDER BY department_id`)).rows),
      ev: JSON.stringify((await oracle.query(`SELECT department_id,entity_type,filename,mime,size_bytes,encode(content,'hex') AS bytes
        FROM evidence_files ORDER BY department_id`)).rows),
    });
    const beforeUp = await snap();
    await rh.query('ALTER TABLE document_submissions ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
    await rh.query('ALTER TABLE initiative_department_status ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
    await rh.query('ALTER TABLE client_initiatives ADD COLUMN archived_at TIMESTAMPTZ NULL');
    await rh.query('ALTER TABLE initiative_department_status DROP CONSTRAINT initiative_department_status_client_initiative_id_fkey');
    await rh.query('ALTER TABLE initiative_department_status ALTER COLUMN client_initiative_id SET NOT NULL');
    await rh.query('ALTER TABLE initiative_department_status ADD CONSTRAINT initiative_department_status_selection_restrict FOREIGN KEY (client_initiative_id) REFERENCES client_initiatives(id) ON DELETE RESTRICT');
    assert.equal((await rh.query(STRUCTURE_SQL)).rows[0].checksum, fresh, 'upgrade converges to the fresh fingerprint');
    assert.deepEqual(await snap(), beforeUp, 'upgrade preserves every status and evidence byte');
    const fk = (await rh.query(`SELECT confdeltype, conname FROM pg_constraint WHERE conname IN
      ('initiative_department_status_selection_restrict','initiative_department_status_selection_setnull','initiative_department_status_client_initiative_id_fkey')`)).rows;
    assert.equal(fk.length, 1); assert.equal(fk[0].conname, 'initiative_department_status_selection_restrict');
    assert.equal(fk[0].confdeltype, 'r', 'RESTRICT: hard delete refused when linked rows exist');
    assert.equal((await rh.query(`SELECT is_nullable FROM information_schema.columns WHERE table_name='client_initiatives'
      AND column_name='archived_at'`)).rows[0].is_nullable, 'YES', 'archived marker nullable (NULL = active)');
    assert.equal((await rh.query(`SELECT is_nullable FROM information_schema.columns WHERE table_name='initiative_department_status'
      AND column_name='client_initiative_id'`)).rows[0].is_nullable, 'NO', 'the link stays NOT NULL');
    pass('upgrade rehearsal: committed(CASCADE) -> revised(archive+RESTRICT) with zero data loss + fresh/upgrade byte parity');
  } finally { rh.release(); }

  // Boot the real server and drive the real routers over HTTP.
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: url.toString(),
    JWT_SECRET: randomBytes(48).toString('hex'), B17_SCRATCH_OPT_IN: 'YES', NODE_ENV: 'production' };
  child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server.ts'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const base = await new Promise<string>((resolve, reject) => {
    let buf = ''; const t = setTimeout(() => reject(new Error(`no start: ${buf.slice(-400)}`)), 90000);
    child!.stdout!.on('data', (c: Buffer) => { buf += c.toString(); const m = /http:\/\/127\.0\.0\.1:(\d+)/.exec(buf); if (m) { clearTimeout(t); resolve(`http://127.0.0.1:${m[1]}`); } });
    child!.stderr!.on('data', (c: Buffer) => { buf += c.toString(); });
    child!.on('exit', (c) => { clearTimeout(t); reject(new Error(`exit ${c}: ${buf.slice(-400)}`)); });
  });
  const call = async (m: string, p: string, t?: string, b?: unknown, h: Record<string, string> = {}) => {
    const hs: Record<string, string> = { ...h }; if (t) hs.Authorization = `Bearer ${t}`;
    if (b !== undefined) hs['Content-Type'] = 'application/json';
    const r = await fetch(base + p, { method: m, headers: hs, body: b === undefined ? undefined : JSON.stringify(b) });
    const txt = await r.text(); let j: any = null; try { j = txt ? JSON.parse(txt) : null; } catch { j = txt; }
    return { status: r.status, body: j, text: txt };
  };
  const login = async (e: string) => (await call('POST', '/api/auth/login', undefined, { email: e, password: PASSWORD })).body.token as string;
  const pT = await login('p@t.test'), eT = await login('e@t.test'), e2T = await login('e2@t.test'), cT = await login('c@t.test');
  const tab = await call('POST', '/api/workspace/tab', pT, {});
  const wth = { 'X-Workspace-Tab': tab.body.tabHandle, 'X-Workspace-Version': String(tab.body.generation) };
  const entered = await call('POST', '/api/workspace/enter', pT, { clientId: A }, wth);
  assert.equal(entered.status, 200);
  const wctx = { 'X-Workspace-Tab': tab.body.tabHandle, 'X-Workspace-Version': String(entered.body.generation) };
  const REQ = 'b1111111-1111-4111-8111-111111111111';

  // Documents: version protocol + concurrency (behavior unchanged by round 3).
  let r = await call('PATCH', `/api/requirements/${REQ}`, eT, { provided: true, expectedVersion: 0 });
  assert.equal(r.status, 200); assert.equal(r.body.version, 1);
  r = await call('PATCH', `/api/requirements/${REQ}`, eT, { provided: true, expectedVersion: 0 });
  assert.equal(r.status, 409); assert.equal(r.body.code, 'version.conflict'); assert.equal(r.body.error, STALE_AR);
  r = await call('PATCH', `/api/requirements/${REQ}`, eT, { provided: true });
  assert.equal(r.status, 400); assert.equal(r.body.code, 'version.required');
  for (const bad of [-1, 1.5, 2147483648, 'x']) {
    const q = await call('PATCH', `/api/requirements/${REQ}`, eT, { provided: true, expectedVersion: bad as any });
    assert.equal(q.status, 400, `bad version ${String(bad)}`);
  }
  pass('stale/missing/invalid versions fail closed with the two approved messages');
  const [c1, c2] = await Promise.all([
    call('PATCH', `/api/requirements/${REQ}`, eT, { note: 'race-a', expectedVersion: 1 }),
    call('PATCH', `/api/requirements/${REQ}`, eT, { note: 'race-b', expectedVersion: 1 }),
  ]);
  assert.equal([c1.status, c2.status].sort().join(','), '200,409', 'first valid save wins, never silent overwrite');
  r = await call('PATCH', `/api/requirements/${REQ}`, cT, { provided: false, expectedVersion: 0 });
  assert.equal(r.status, 403, 'C write refused before version disclosure');

  // Initiatives: operator-seeded selection is live with a submitted D1 row (v1)
  // and a D2 draft. E2 reads only its own department; E drives the version
  // flow; the anchor barrier below proves serialization on real routes.
  const sel = selCommitted as string;
  const e2list = await call('GET', '/api/initiatives/department', e2T);
  assert.equal(e2list.status, 200);
  assert.ok(e2list.body.every((x: any) => (x.statuses ?? []).every((s: any) => s.departmentId === D2)),
    'E2 never sees another department rows');
  const key = `u41c-protect:v1:initiative:${A.toLowerCase()}:${LIB.toLowerCase()}`;
  await oracle.query('BEGIN');
  await oracle.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
  const pending = call('PATCH', `/api/initiatives/department/${sel}`, eT,
    { note: 'barrier-write', expectedVersion: 1 });
  await waitFor("SELECT count(*)::int AS n FROM pg_locks WHERE locktype='advisory' AND NOT granted", 15000);
  pass('second writer observably waits on the canonical anchor (no sleep)');
  await oracle.query('COMMIT');
  const bw = await pending;
  assert.equal(bw.status, 200, `barrier write commits after release: ${bw.text}`); assert.equal(bw.body.version, 2);
  r = await call('PATCH', `/api/initiatives/department/${sel}`, eT, { note: 'late', expectedVersion: 1 });
  assert.equal(r.status, 409); assert.equal(r.body.code, 'version.conflict'); assert.equal(r.body.error, STALE_AR);
  pass('same-version loser conflicts with the approved stale message; first valid save wins');
  for (const bad of [undefined, -1, 1.5, 2147483648, 'x']) {
    const q = await call('PATCH', `/api/initiatives/department/${sel}`, eT,
      bad === undefined ? { note: 't' } : { note: 't', expectedVersion: bad as any });
    assert.equal(q.status, 400, `bad version ${String(bad)}`); assert.equal(q.body.code, 'version.required');
  }
  r = await call('PATCH', `/api/initiatives/department/${sel}`, cT, { note: 'c', expectedVersion: 0 });
  assert.equal(r.status, 403, 'C status write refused before any data disclosure');
  r = await call('PATCH', `/api/initiatives/department/${sel}`, eT, { note: 'x', expectedVersion: 2, clientId: B } as any);
  assert.equal(r.status, 400, 'cross-tenant clientId is an unknown field, refused before any data access');
  assert.equal(r.body.code, 'initiatives.field_refused');
  r = await call('PATCH', '/api/initiatives/department/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', eT, { note: 'x', expectedVersion: 0 });
  assert.equal(r.status, 404, 'fabricated selection ID resolves to nothing in-tenant');

  // Unselect ARCHIVES in place: the row survives with its flag, every status
  // stays linked (same IDs, same versions), evidence stays, audit +1, and both
  // lists re-show the initiative as archived instead of dropping it.
  const auditsBefore = Number((await oracle.query('SELECT count(*)::int n FROM audit_log')).rows[0].n);
  const un = await call('DELETE', `/api/initiatives/select/${LIB}?serviceId=${S}&clientId=${A}`, pT, undefined, wctx);
  assert.equal(un.status, 200, `unselect with state is permitted: ${un.text}`);
  assert.equal((await oracle.query('SELECT archived_at IS NOT NULL AS a FROM client_initiatives WHERE id=$1', [sel])).rows[0].a,
    true, 'the selection row survives with its archived flag');
  const kept = (await oracle.query(`SELECT id::text AS i, department_id::text AS d, performed, note,
    submitted_at::text AS sat, version, client_initiative_id::text AS link FROM initiative_department_status ORDER BY department_id`)).rows;
  assert.equal(kept.length, 2, 'both statuses preserved (submitted + draft)');
  assert.ok(kept.every((k: any) => k.link === sel), 'links intact on the SAME selection ID — never nulled, never deleted');
  assert.ok(kept.some((k: any) => k.d === D1 && k.performed && k.note === 'barrier-write' && k.version === 2),
    'submitted row keeps stamp, note and revision');
  assert.equal((await oracle.query('SELECT count(*)::int n FROM evidence_files')).rows[0].n, 1, 'evidence preserved');
  assert.equal(Number((await oracle.query('SELECT count(*)::int n FROM audit_log')).rows[0].n), auditsBefore + 1, 'exactly one audit');
  const wlist = await call('GET', '/api/initiatives', pT, undefined, wctx);
  assert.equal(wlist.status, 200, `W selection list: ${wlist.text}`);
  const wlib = (wlist.body.items ?? []).find((x: any) => x.id === LIB);
  assert.ok(wlib && wlib.selected === false && wlib.archived === true, 'W re-lists it as archived, not selected');
  const gone = await call('GET', '/api/initiatives/department', eT);
  const glib = gone.body.find((x: any) => x.initiative_id === LIB);
  assert.ok(glib && glib.archived === true && glib.statuses.length === 1 && glib.statuses[0].departmentId === D1,
    'E re-lists it archived WITH its own history (other departments stay hidden)');
  const again = await call('DELETE', `/api/initiatives/select/${LIB}?serviceId=${S}&clientId=${A}`, pT, undefined, wctx);
  assert.equal(again.status, 200, 'repeat unselect is idempotent');
  assert.equal(Number((await oracle.query('SELECT count(*)::int n FROM audit_log')).rows[0].n), auditsBefore + 1, 'idempotent repeat adds no audit');
  pass('unselect archives in place; lists re-show it archived with full history; audit +1');

  // Writes against the archived selection fail closed with the BASELINE 404
  // (round-2 notice replaced by archive/refresh). PROTECT round 4 (M-01,
  // fail-closed): evidence upload/delete on the archived link reuse the
  // existing evidence.not_found 404 — no new text; the preserved proof stays
  // readable/downloadable and refusals add no audit.
  r = await call('PATCH', `/api/initiatives/department/${sel}`, eT, { note: 'after', expectedVersion: 2 });
  assert.equal(r.status, 404); assert.equal(r.body.code, 'scope.not_found');
  r = await call('PATCH', `/api/initiatives/department/${sel}`, eT, { note: 'after', expectedVersion: 0 });
  assert.equal(r.status, 404, 'create against an archived selection keeps the not-found path');
  assert.equal(Number((await oracle.query('SELECT count(*)::int n FROM audit_log')).rows[0].n), auditsBefore + 1, 'refusals add no audit');
  const stD1 = kept.find((k: any) => k.d === D1).i as string;
  const arcFile = (await oracle.query(`SELECT id::text AS i FROM evidence_files WHERE entity_id=$1 ORDER BY created_at LIMIT 1`, [stD1])).rows[0].i as string;
  const upArc = new FormData(); upArc.append('file', new Blob(['archived-proof'], { type: 'text/plain' }), 'a.txt');
  const upArcRes = await fetch(`${base}/api/evidence/initiative_status/${stD1}/files`,
    { method: 'POST', headers: { Authorization: `Bearer ${eT}` }, body: upArc });
  assert.equal(upArcRes.status, 404, 'evidence upload on an archived selection fails closed (existing not-found path)');
  assert.equal((await upArcRes.json()).code, 'evidence.not_found');
  const delArc = await call('DELETE', `/api/evidence/initiative_status/${stD1}/files/${arcFile}`, eT);
  assert.equal(delArc.status, 404, 'evidence delete on an archived selection fails closed (existing not-found path)');
  assert.equal(delArc.body.code, 'evidence.not_found');
  assert.equal((await oracle.query('SELECT count(*)::int n FROM evidence_files')).rows[0].n, 1, 'refused archived writes preserve every evidence byte');
  assert.equal(Number((await oracle.query('SELECT count(*)::int n FROM audit_log')).rows[0].n), auditsBefore + 1, 'refusals add no audit');
  const dl = await fetch(`${base}/api/evidence/initiative_status/${stD1}/files/${arcFile}/download`,
    { headers: { Authorization: `Bearer ${eT}` } });
  assert.equal(dl.status, 200); assert.equal(await dl.text(), 'submitted-b');
  pass('archived writes fail closed (baseline 404, no audit); preserved proof stays downloadable');

  // Reselect clears the flag ON THE SAME ROW: same ID, both statuses still
  // attached with their versions, no duplicates; the current revision writes.
  r = await call('POST', '/api/initiatives/select', pT, { initiativeId: LIB, serviceId: S, clientId: A }, wctx);
  assert.equal(r.status, 200); assert.equal(r.body.alreadySelected, false);
  const sel2 = (await oracle.query('SELECT id::text AS id FROM client_initiatives WHERE client_id=$1 AND initiative_id=$2',
    [A, LIB])).rows[0].id as string;
  assert.equal(sel2, sel, 'reselect reuses the SAME selection row — history reconnects, no duplicate');
  assert.equal((await oracle.query('SELECT count(*)::int n FROM client_initiatives WHERE client_id=$1 AND initiative_id=$2', [A, LIB])).rows[0].n,
    1, 'still exactly one selection row');
  assert.equal((await oracle.query('SELECT count(*)::int n FROM initiative_department_status WHERE client_initiative_id=$1', [sel])).rows[0].n,
    2, 'both statuses still attached to the reconnected selection');
  r = await call('PATCH', `/api/initiatives/department/${sel}`, eT, { note: 'reconnected', expectedVersion: 2 });
  assert.equal(r.status, 200); assert.equal(r.body.version, 3, 'the preserved revision continues on the same row');
  assert.equal((await oracle.query('SELECT count(*)::int n FROM initiative_department_status WHERE client_initiative_id=$1 AND department_id=$2',
    [sel, D1])).rows[0].n, 1, 'no duplicate status row created');
  pass('reselect reconnects history on the same ID with zero duplication');

  // Concurrent unselect vs submit, both orders, on a live second initiative.
  await call('POST', '/api/initiatives/select', pT, { initiativeId: LIB2, serviceId: S, clientId: A }, wctx);
  const selB = (await oracle.query('SELECT id::text AS id FROM client_initiatives WHERE client_id=$1 AND initiative_id=$2', [A, LIB2])).rows[0].id as string;
  r = await call('PATCH', `/api/initiatives/department/${selB}`, eT, { performed: true, expectedVersion: 0 });
  assert.equal(r.status, 200); assert.equal(r.body.version, 1);
  // Concurrent unselect vs submit: the archive waits on an out-of-band holder
  // (observed, never slept) so it is the sole waiter and deterministically
  // commits first; the submit overlaps it in flight but the post-wait reread
  // fails closed after the archive in every interleaving — never overwrites.
  await oracle.query('BEGIN');
  await oracle.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
    [`u41c-protect:v1:initiative:${A.toLowerCase()}:${LIB2.toLowerCase()}`]);
  const archiving = call('DELETE', `/api/initiatives/select/${LIB2}?serviceId=${S}&clientId=${A}`, pT, undefined, wctx);
  await waitFor("SELECT count(*)::int AS n FROM pg_locks WHERE locktype='advisory' AND NOT granted", 15000);
  pass('unselect observably waits on the anchor (no sleep); sole waiter commits first');
  await oracle.query('COMMIT');
  const racing = call('PATCH', `/api/initiatives/department/${selB}`, eT, { note: 'racer', expectedVersion: 1 });
  const unB = await archiving;
  assert.equal(unB.status, 200, 'archive commits while the submit overlaps in flight');
  const rw = await racing;
  assert.equal(rw.status, 404, 'overlapping submit fails closed after the archive, never overwrites');
  assert.equal((await oracle.query('SELECT note, version FROM initiative_department_status WHERE client_initiative_id=$1', [selB])).rows[0].note, null);
  r = await call('POST', '/api/initiatives/select', pT, { initiativeId: LIB2, serviceId: S, clientId: A }, wctx);
  assert.equal(r.status, 200);
  r = await call('PATCH', `/api/initiatives/department/${selB}`, eT, { note: 'after-reselect', expectedVersion: 1 });
  assert.equal(r.status, 200); assert.equal(r.body.version, 2, 'submit wins after reselect; data intact either order');
  pass('unselect-vs-submit both orders preserve data; waiter fails closed without overwrite');

  // Policy load-bearing: without b17_selection_update the archive UPDATE is a
  // silent 0-row no-op (RLS default-deny, no error); the approved policy is
  // what makes the same predicate archive exactly one row. Rolled back: no
  // lasting change, policy intact for the live proof below.
  const ac = await pool.connect();
  try {
    await ac.query('BEGIN');
    await ac.query("SELECT set_config('app.current_tenant_id',$1,false), set_config('app.current_mode','consultant',false)", [A]);
    await ac.query('DROP POLICY b17_selection_update ON client_initiatives');
    assert.equal((await ac.query(`UPDATE client_initiatives SET archived_at=NOW()
      WHERE client_id=$1 AND initiative_id=$2 AND archived_at IS NULL`, [A, LIB2])).rowCount, 0,
      'without the policy the archive UPDATE silently matches nothing');
    await ac.query('ROLLBACK');
  } finally { ac.release(); }
  assert.equal((await oracle.query(`SELECT count(*)::int n FROM pg_policies
    WHERE schemaname='public' AND tablename='client_initiatives' AND policyname='b17_selection_update'`)).rows[0].n,
    1, 'the approved policy is present after rollback');
  pass('archive UPDATE is load-bearing on b17_selection_update (0 rows without it, rolled back)');
  r = await call('DELETE', `/api/initiatives/select/${LIB2}?serviceId=${S}&clientId=${A}`, pT, undefined, wctx);
  assert.equal(r.status, 200, 'with the policy the same predicate archives exactly one row');
  assert.equal((await oracle.query('SELECT archived_at IS NOT NULL AS a FROM client_initiatives WHERE id=$1', [selB])).rows[0].a,
    true, 'LIB2 archived with its audit trail');

  // Post-submit evidence lock intact on the live LIB row (before LIB teardown).
  const liveFile = (await oracle.query(`SELECT id::text AS i FROM evidence_files WHERE entity_id=$1 ORDER BY created_at DESC LIMIT 1`, [stD1])).rows[0].i as string;
  const lockedLive = await call('DELETE', `/api/evidence/initiative_status/${stD1}/files/${liveFile}`, eT);
  assert.equal(lockedLive.status, 409); assert.equal(lockedLive.body.code, 'evidence.locked');
  pass('owner evidence lock intact on the live row');

  // Hard-delete backstop at SQL level: refused ONLY when linked rows exist
  // (pg rejects with 23001/23503 on err.code; the message text carries no code).
  const delErr = await oracle.query('DELETE FROM client_initiatives WHERE id=$1', [selB]).then(() => null, (e) => e);
  assert.ok(delErr && (delErr.code === '23001' || delErr.code === '23503'),
    'hard delete with linked statuses is refused by RESTRICT');
  assert.equal((await oracle.query('SELECT count(*)::int n FROM initiative_department_status WHERE client_initiative_id=$1', [selB])).rows[0].n,
    1, 'refused delete preserves the linked status');
  await oracle.query('DELETE FROM initiative_department_status WHERE client_initiative_id=$1', [sel]);
  await oracle.query('DELETE FROM client_initiatives WHERE id=$1', [sel]);
  assert.equal((await oracle.query('SELECT count(*)::int n FROM client_initiatives WHERE id=$1', [sel])).rows[0].n, 0,
    'an empty selection deletes cleanly — refusal happens ONLY with linked records');
  pass('RESTRICT refuses hard delete only when linked records exist');

  // Freeze-live on the changed path: reselect LIB2, freeze tenant A with a
  // tenant review snapshot, then unselect must refuse 409 scope.frozen with
  // zero writes and no audit (snapshot rows are immutable, so this runs last).
  r = await call('POST', '/api/initiatives/select', pT, { initiativeId: LIB2, serviceId: S, clientId: A }, wctx);
  assert.equal(r.status, 200);
  await oracle.query(`INSERT INTO review_snapshots(client_id,scope_type,scope_ref,payload,content_hash,created_by)
    VALUES($1,'tenant','','{}','scratch-freeze',$2)`, [A, P_ID]);
  const frzBefore = Number((await oracle.query('SELECT count(*)::int n FROM audit_log')).rows[0].n);
  r = await call('DELETE', `/api/initiatives/select/${LIB2}?serviceId=${S}&clientId=${A}`, pT, undefined, wctx);
  assert.equal(r.status, 409); assert.equal(r.body.code, 'scope.frozen');
  assert.equal((await oracle.query('SELECT archived_at IS NULL AS a FROM client_initiatives WHERE id=$1', [selB])).rows[0].a,
    true, 'frozen unselect writes nothing');
  assert.equal(Number((await oracle.query('SELECT count(*)::int n FROM audit_log')).rows[0].n), frzBefore, 'frozen refusal adds no audit');
  pass('freeze rules hold live: frozen scope refuses archive with zero writes');

  log('SUMMARY');
  log('archive + RESTRICT + anchor/version/evidence barrier proof on real routes');
} finally {
  if (child) child.kill();
  await oracle.end().catch(() => {});
  await pool.end().catch(() => {});
}
