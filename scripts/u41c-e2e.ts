// TASK-PROTO-U4-1c round 3 (G-01..G-04) — END-TO-END behaviour on own scratch.
//
// Calls the REAL server (real auth, real workspace tab, real routers, real RLS)
// over HTTP; nothing is stubbed. Precondition: a scratch database already
// activated by scripts/u41c-scratch.ts (B17 ready + clients A/B, dept D1 and a
// service linked to A). This script seeds three accounts, boots `server.ts` on a
// random loopback port and asserts:
//   R1  P create/patch/delete requirement → 201/200/200 (never 500), and the
//       audit rows carry client_id = T (the G-01 42501 regression);
//   R2  P delete of a requirement with a department submission → 409
//       documents.dependency with no raw PG text;
//   R3  P lists → 200 with an explicit clientId, P without one → 400,
//       E/C lists → 200 (mode branched before any department lookup);
//   R4  E/P flows unchanged (submit → 200, C write → 403).
import assert from 'node:assert/strict';
import pg from 'pg';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import bcrypt from 'bcryptjs';
import { verifyB17 } from '../src/db/b17Readiness.ts';

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
  || !/^\/u41c_scratch_\d+$/.test(url.pathname) || !url.port || url.search || url.hash
  || url.username !== 'u41cowner') throw new Error('Only own named loopback scratch accepted');
if (oracleUrl.host !== url.host || oracleUrl.pathname !== url.pathname || oracleUrl.username !== 'postgres')
  throw new Error('Oracle must be exact same scratch');

const A = '11111111-1111-4111-8111-111111111111';
const D1 = '21111111-1111-4111-8111-111111111111';
const S = '31111111-1111-4111-8111-111111111111';
const P_ID = 'c1111111-1111-4111-8111-111111111111';
const C_ID = 'c2222222-2222-4222-8222-222222222222';
const E_ID = 'c3333333-3333-4333-8333-333333333333';
const PASSWORD = randomBytes(18).toString('base64url') + 'Aa1!';
const log = (m: string) => console.log(m);
const pass = (m: string) => console.log(`PASS ${m}`);

const oracle = new pg.Client({ connectionString: oracleUrl.toString() });
await oracle.connect();
const runtime = new pg.Client({ connectionString: url.toString() });
await runtime.connect();
let child: ReturnType<typeof spawn> | undefined;
try {
  await runtime.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await verifyB17(runtime as any);
  await runtime.query('COMMIT');
  pass('scratch is B17-ready before the E2E');

  const hash = await bcrypt.hash(PASSWORD, 10);
  const mk = (id: string, clientId: string | null, departmentId: string | null, email: string,
    name: string, role: string) => oracle.query(
    `INSERT INTO users(id,client_id,department_id,email,password_hash,name,role,is_active,must_change_password)
      VALUES($1,$2,$3,$4,$5,$6,$7,true,false)
      ON CONFLICT (email) DO UPDATE SET password_hash=EXCLUDED.password_hash, name=EXCLUDED.name,
        role=EXCLUDED.role, client_id=EXCLUDED.client_id, department_id=EXCLUDED.department_id,
        is_active=true, must_change_password=false`, [id, clientId, departmentId, email, hash, name, role]);
  await mk(P_ID, null, null, 'p@e2e.test', 'E2E Platform', 'ge_admin');
  await mk(C_ID, A, null, 'c@e2e.test', 'E2E Client', 'client_admin');
  await mk(E_ID, A, D1, 'e@e2e.test', 'E2E Employee', 'employee');

  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: url.toString(),
    JWT_SECRET: randomBytes(48).toString('hex'), B17_SCRATCH_OPT_IN: 'YES', NODE_ENV: 'production' };
  delete env.PGOPTIONS;
  child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server.ts'],
    { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const base = await new Promise<string>((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`server did not start: ${buf.slice(-400)}`)), 90000);
    child!.stdout!.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      const m = /http:\/\/127\.0\.0\.1:(\d+)/.exec(buf);
      if (m) { clearTimeout(timer); resolve(`http://127.0.0.1:${m[1]}`); }
    });
    child!.stderr!.on('data', (chunk: Buffer) => { buf += chunk.toString(); });
    child!.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited ${code}: ${buf.slice(-400)}`)); });
  });
  log(`server up at ${base}`);

  const call = async (method: string, path: string, token?: string, body?: unknown, extra: Record<string, string> = {}) => {
    const headers: Record<string, string> = { ...extra };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + path, { method, headers,
      body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, body: json, text };
  };
  const login = async (email: string) => {
    const r = await call('POST', '/api/auth/login', undefined, { email, password: PASSWORD });
    assert.equal(r.status, 200, `login ${email}: ${r.text}`);
    return r.body.token as string;
  };
  const pToken = await login('p@e2e.test');
  const cToken = await login('c@e2e.test');
  const eToken = await login('e@e2e.test');
  pass('P/C/E login (fresh must_change_password=false accounts)');

  const tab = await call('POST', '/api/workspace/tab', pToken, {});
  assert.equal(tab.status, 201, tab.text);
  const tabHeaders = { 'X-Workspace-Tab': tab.body.tabHandle, 'X-Workspace-Version': String(tab.body.generation) };
  assert.equal(tab.body.mode, 'platform');
  pass('GE opened a platform workspace tab');

  // R1: P requirement create / patch / delete — the G-01 42501 regression.
  const created = await call('POST', `/api/services/${S}/documents?clientId=${A}`, pToken,
    { title: `E2E ${randomBytes(4).toString('hex')}`, tags: ['e2e'], required: true }, tabHeaders);
  assert.equal(created.status, 201, `P create: ${created.text}`);
  assert.equal(created.body.client_id, A, 'the row is client-scoped to T');
  const reqId = created.body.id as string;
  const patched = await call('PATCH', `/api/services/${S}/documents/${reqId}?clientId=${A}`, pToken,
    { required: false, tags: ['e2e', 'patched'] }, tabHeaders);
  assert.equal(patched.status, 200, `P patch: ${patched.text}`);
  assert.equal(patched.body.required, false);
  const deleted = await call('DELETE', `/api/services/${S}/documents/${reqId}?clientId=${A}`, pToken, undefined, tabHeaders);
  assert.equal(deleted.status, 200, `P delete: ${deleted.text}`);
  const audits = await oracle.query(`SELECT action, client_id::text AS c FROM audit_log
    WHERE action IN ('DOCUMENT_REQUIREMENT_CREATED','DOCUMENT_REQUIREMENT_UPDATED','DOCUMENT_REQUIREMENT_DELETED')
      AND entity_id = $1 ORDER BY action`, [reqId]);
  assert.deepEqual(audits.rows.map((r: any) => r.action).sort(),
    ['DOCUMENT_REQUIREMENT_CREATED', 'DOCUMENT_REQUIREMENT_DELETED', 'DOCUMENT_REQUIREMENT_UPDATED']);
  assert.ok(audits.rows.every((r: any) => r.c === A), 'audit rows are target-bound, not NULL');
  pass('R1: P create/patch/delete = 201/200/200 and the three audits are client_id = T');

  // R2: E submits, then P delete → 409 documents.dependency (FK RESTRICT).
  const second = await call('POST', `/api/services/${S}/documents?clientId=${A}`, pToken,
    { title: `E2E lock ${randomBytes(4).toString('hex')}` }, tabHeaders);
  assert.equal(second.status, 201, second.text);
  // PROTECT fixture: versioned contract (0 = absent on first create).
  const submitted = await call('PATCH', `/api/requirements/${second.body.id}`, eToken,
    { provided: true, note: 'evidence attached', expectedVersion: 0 });
  assert.equal(submitted.status, 200, `E submit: ${submitted.text}`);
  assert.equal(submitted.body.version, 1, 'first versioned create stores revision 1');
  const countsBefore = (await oracle.query(`SELECT
    (SELECT count(*)::int FROM document_requirements) AS req,
    (SELECT count(*)::int FROM document_submissions) AS sub`)).rows[0];
  const blocked = await call('DELETE', `/api/services/${S}/documents/${second.body.id}?clientId=${A}`,
    pToken, undefined, tabHeaders);
  assert.equal(blocked.status, 409, `P delete with submission: ${blocked.status} ${blocked.text}`);
  assert.equal(blocked.body.code, 'documents.dependency');
  assert.ok(!/23503|23001|violates|constraint/i.test(blocked.text), 'no raw PG text');
  const countsAfter = (await oracle.query(`SELECT
    (SELECT count(*)::int FROM document_requirements) AS req,
    (SELECT count(*)::int FROM document_submissions) AS sub`)).rows[0];
  assert.deepEqual(countsAfter, countsBefore, 'the refused delete changed nothing');
  pass('R2: delete with a submission = 409 documents.dependency, zero rows touched');

  // R3: the two P@T lists, and P without clientId.
  const pList = await call('GET', `/api/requirements?clientId=${A}`, pToken, undefined, tabHeaders);
  assert.equal(pList.status, 200, `P requirements: ${pList.text}`);
  assert.ok(pList.body.some((row: any) => row.id === second.body.id));
  const pInit = await call('GET', `/api/initiatives/department?clientId=${A}`, pToken, undefined, tabHeaders);
  assert.equal(pInit.status, 200, `P initiatives: ${pInit.text}`);
  const pNoTarget = await call('GET', '/api/requirements', pToken, undefined, tabHeaders);
  assert.equal(pNoTarget.status, 400, `P without clientId: ${pNoTarget.status} ${pNoTarget.text}`);
  pass('R3: P@T lists = 200 (real target), P without clientId = 400');

  // R4: E/C flows unchanged.
  const eList = await call('GET', '/api/requirements', eToken);
  assert.equal(eList.status, 200, `E requirements: ${eList.text}`);
  const eInit = await call('GET', '/api/initiatives/department', eToken);
  assert.equal(eInit.status, 200, `E initiatives: ${eInit.text}`);
  const cList = await call('GET', `/api/requirements?clientId=${A}`, cToken);
  assert.equal(cList.status, 200, `C requirements: ${cList.text}`);
  // PROTECT fixture: the C denial precedes version disclosure (matrix first).
  const cWrite = await call('PATCH', `/api/requirements/${second.body.id}`, cToken, { provided: false, expectedVersion: 0 });
  assert.equal(cWrite.status, 403, `C write must be refused: ${cWrite.status} ${cWrite.text}`);
  const eForeign = await call('GET', `/api/requirements?clientId=12121212-1212-4212-8212-121212121212`, eToken);
  assert.equal(eForeign.status, 403, `E foreign tenant: ${eForeign.status} ${eForeign.text}`);
  pass('R4: E read/submit = 200, E foreign-tenant = 403, C read = 200, C write = 403');

  log('SUMMARY');
  log('R1 P-requirement CRUD 201/200/200 + target-bound audits');
  log('R2 FK RESTRICT -> 409 documents.dependency, zero writes');
  log('R3 P@T lists 200, P without T 400');
  log('R4 E/C flows unchanged');
} finally {
  if (child) child.kill();
  await oracle.end().catch(() => {});
  await runtime.end().catch(() => {});
}
