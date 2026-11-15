// G2 E3-02 runtime proof + before/after classification table — OWN fresh
// scratch only (b17_u2g_g2_scratch_*), real mounted dispatcher, no ambient
// .env/DSN, generated credentials never printed, owner showcase untouched.
// Never runs scripts/b17-scope-proof.ts.
//
// Evidence produced here:
//   1. E3-02 classification table: EVERY catch under src/server, before
//      (git show G2 base) and after — raw echo vs own-guarded vs
//      helper-collapsed, with the after-state required to contain ZERO
//      unguarded raw echoes.
//   2. Runtime own-error wire equality: responses we raised keep their exact
//      pre-change status/message(/code) bodies.
//   3. Runtime PG masking: a real PostgreSQL diagnostic reaching a catch
//      collapses to the route's static fallback — no PG text, no SQLSTATE.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import { getPool, runMigrations } from '../src/db/index.ts';
import { applyB17Offline, assertB17Ready } from '../src/db/b17Readiness.ts';
import { inventoryB17ContentOffline, applyB17ContentOffline } from '../src/db/b17ContentMigration.ts';
import { verifyToken } from '../src/server/auth.ts';
import api from '../src/server/routes.ts';
import { jsonInput } from '../src/server/jsonInput.ts';
import { globalJsonErrorHandler } from '../src/server/errorHandler.ts';
import { seedG1 } from './b17-domain-g1-fixture.ts';

const BASE = '048a6f254a75bbe86b8ad7fd48e46348a1c60e10';
const args = process.argv.slice(2);
if (!args.includes('--allow-disposable-b17') || existsSync('.env') || process.env.DATABASE_URL
  || process.env.JWT_SECRET
  || Object.keys(process.env).some(k => /^PG(HOST|PORT|USER|PASSWORD|DATABASE|SERVICE)/.test(k)))
  throw new Error('Explicit isolated opt-in required; ambient config refused');
const one = (key: string) => {
  const values = args.filter(a => a.startsWith(`--${key}=`));
  if (values.length !== 1) throw new Error(`One explicit ${key} required`);
  return new URL(values[0].slice(key.length + 3));
};
const url = one('database-url'), oracleUrl = one('oracle-url');
if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1'
  || !/^\/b17_u2g_g2_scratch_\d+_\d+$/.test(url.pathname) || !url.port || url.search || url.hash
  || url.username !== 'b17domainowner') throw new Error('Only own named loopback scratch accepted');
if (oracleUrl.protocol !== url.protocol || oracleUrl.host !== url.host || oracleUrl.pathname !== url.pathname
  || oracleUrl.username !== 'postgres' || oracleUrl.search || oracleUrl.hash)
  throw new Error('Oracle must be exact same scratch');
process.env.DATABASE_URL = url.toString();
process.env.JWT_SECRET = randomBytes(48).toString('hex');
const pool = getPool();
const pass = (label: string) => console.log(`PASS ${label}`);
const NIL = '00000000-0000-4000-8000-000000000000';

// ------------------------------------------------------------------
// 1. Static classification table (before = G2 base, after = worktree).
//    Guard span = an own-error guard's condition through its if-block's
//    closing `}` (regex literals masked so the `{5}` SQLSTATE test cannot
//    fake a boundary). Echoes outside every span (and outside no-catch
//    helpers, which this catch-scoped view does not enter) are raw.
// ------------------------------------------------------------------
const GUARDS = ['PASSWORD_CHANGE_REQUIRED_CODE', 'conflictPayload', 'Number.isInteger('];
function classify(src: string): { raw: number; guarded: number } {
  let raw = 0, guarded = 0;
  for (const m of src.matchAll(/\bcatch\s*\((\w+)(?::[^)]+)?\)\s*\{/g)) {
    let depth = 1, end = m.index! + m[0].length; const start = end;
    for (; end < src.length && depth; end++) {
      if (src[end] === '{') depth++; else if (src[end] === '}') depth--;
    }
    const body = src.slice(start, end - 1);
    const masked = body.replace(/\/\^[^\n]*?\//g, s => s.replace(/[^\r\n]/g, ' '));
    const spans: [number, number][] = [];
    for (const guard of GUARDS) {
      let at = body.indexOf(guard);
      while (at >= 0) {
        const close = masked.indexOf('}', at);
        spans.push([at, close < 0 ? body.length : close]);
        at = body.indexOf(guard, at + guard.length);
      }
    }
    for (const echo of body.matchAll(/(?:error|code)\s*:\s*[^,};]*?\.(?:message|code)\b/g)) {
      if (spans.some(([s, e]) => echo.index! > s && echo.index! < e)) guarded++;
      else raw++;
    }
  }
  return { raw, guarded };
}
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}
console.log('E3-02 CLASSIFICATION (catch-scoped; own-guarded = sanctioned own-error path)');
let beforeRawTotal = 0, afterRawTotal = 0;
for (const file of walk('src/server')) {
  const after = classify(readFileSync(file, 'utf8'));
  const before = classify(execFileSync('git', ['show', `${BASE}:${file.split(path.sep).join('/')}`],
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).replace(/\r\n/g, '\n'));
  if (!before.raw && !after.raw && !after.guarded) continue;
  beforeRawTotal += before.raw; afterRawTotal += after.raw;
  console.log(`  ${file.split(path.sep).join('/')}: before_raw=${before.raw} after_raw=${after.raw} after_guarded=${after.guarded}`);
}
assert.equal(afterRawTotal, 0, 'AFTER: zero unguarded raw echoes remain in any catch');
assert.ok(beforeRawTotal > afterRawTotal, `AFTER must remove raw echoes (before=${beforeRawTotal})`);
pass(`E3-02 table: ${beforeRawTotal} raw catch echoes at base -> 0 unguarded after`);

// ------------------------------------------------------------------
// 2. Runtime setup: own scratch activation + real mounted dispatcher.
// ------------------------------------------------------------------
type Cx = { token: string; handle?: string; generation?: number };
let server: ReturnType<express.Express['listen']> | undefined;
try {
  assert.equal((await runMigrations()).success, true);
  const seed = await seedG1();
  const migration = await pool.connect();
  try {
    assert.equal(await applyB17Offline(migration), 'applied');
    const inventory = await inventoryB17ContentOffline(migration, seed.targets, seed.sources);
    assert.equal(await applyB17ContentOffline(migration, inventory, seed.sources), 'applied');
  } finally { migration.release(); }
  await assertB17Ready();
  const app = express();
  app.use(jsonInput); app.use(cookieParser()); app.use('/api', api); app.use(globalJsonErrorHandler);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(r => server!.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  async function raw(cx: Cx | undefined, method: string, pathName: string, body?: unknown) {
    const headers: Record<string, string> = {};
    if (cx) headers.Authorization = `Bearer ${cx.token}`;
    if (cx?.handle) { headers['X-Workspace-Tab'] = cx.handle; headers['X-Workspace-Version'] = String(cx.generation); }
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(base + pathName, { method, headers,
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const text = await response.text();
    let data: unknown = null;
    try { data = JSON.parse(text); } catch { data = { raw: true }; }
    return { status: response.status, data: data as Record<string, unknown>, text };
  }
  async function context(who: 'P' | 'W' | 'C' | 'E'): Promise<Cx> {
    const name = who === 'P' || who === 'W' ? 'ge' : who === 'C' ? 'cA' : 'eA';
    const login = await raw(undefined, 'POST', '/auth/login', { email: `${name}@domain-d.invalid`, password: seed.password });
    assert.equal(login.status, 200, `${who} login`);
    const cx: Cx = { token: (login.data as { token: string }).token };
    if (who === 'P' || who === 'W') {
      const tab = await raw(cx, 'POST', '/workspace/tab', {});
      assert.equal(tab.status, 201);
      cx.handle = (tab.data as { tabHandle: string }).tabHandle;
      cx.generation = (tab.data as { generation: number }).generation;
      if (who === 'W') {
        const enter = await raw(cx, 'POST', '/workspace/enter', { clientId: seed.tenants.A });
        assert.equal(enter.status, 200);
        cx.generation = (enter.data as { generation: number }).generation;
      }
    }
    return cx;
  }
  const [p, w, c, e] = await Promise.all([context('P'), context('W'), context('C'), context('E')]);

  // ----------------------------------------------------------------
  // 2a. OWN errors: exact pre-change wire bodies (byte-equality claim).
  // ----------------------------------------------------------------
  const own: [Cx | undefined, string, string, unknown, number, Record<string, unknown>][] = [
    [p, 'GET', '/disclosures?standardId=not-a-uuid', undefined, 400,
      { error: 'scope.id_invalid', code: 'scope.id_invalid' }],
    [p, 'GET', '/standards?serviceId=not-a-uuid', undefined, 400,
      { error: 'scope.id_invalid', code: 'scope.id_invalid' }],
    [w, 'GET', `/items/${NIL}/links`, undefined, 404, { error: 'Item not found.' }],
    [w, 'GET', '/storage/usage?clientId=not-a-uuid', undefined, 400, { error: 'scope.id_invalid' }],
    [p, 'GET', '/storage/usage', undefined, 400,
      { error: 'No tenant selected. As a platform admin, choose a tenant (clientId).' }],
    [c, 'POST', `/notifications/${NIL}/read`, {}, 404, { error: 'Notification not found.' }],
    [p, 'GET', '/queue', undefined, 403,
      { error: 'workspace.mode_mismatch', code: 'workspace.mode_mismatch' }],
    [w, 'GET', '/actions?departmentId=not-a-uuid', undefined, 400, { error: 'scope.id_invalid' }],
    [w, 'GET', '/actions?status=bogus', undefined, 400, { error: 'Unknown action status filter.' }],
  ];
  for (const [cx, method, pathName, body, status, expected] of own) {
    const r = await raw(cx, method, pathName, body);
    assert.equal(r.status, status, `OWN ${method} ${pathName}: status (got ${r.status} ${r.text.slice(0, 160)})`);
    assert.deepEqual(r.data, expected, `OWN ${method} ${pathName}: exact body preserved`);
    console.log(`OWN ${method} ${pathName} -> ${status} exact body`);
  }
  // Own 409 at the evaluations write tail (preserved byte-for-byte): the
  // status gate answers BEFORE the version gate, so a double submit is a
  // deterministic own error whatever version is supplied.
  const draft = await raw(e, 'POST', '/evaluations', { itemId: seed.items[3], score: 50 });
  assert.equal(draft.status, 201, `draft create: ${draft.text.slice(0, 200)}`);
  const evaluationId = (draft.data as { evaluation: { id: string } }).evaluation.id;
  const submit = await raw(e, 'POST', `/evaluations/${evaluationId}/submit`, { version: 1 });
  assert.ok([200, 201].includes(submit.status), `submit: ${submit.text.slice(0, 200)}`);
  const resubmit = await raw(e, 'POST', `/evaluations/${evaluationId}/submit`, { version: 1 });
  assert.equal(resubmit.status, 409, `double submit status: ${resubmit.text.slice(0, 200)}`);
  assert.deepEqual(resubmit.data, { error: 'This evaluation has already been submitted.' },
    'own 409 body preserved (message only, no code)');
  console.log('OWN POST /evaluations/:id/submit (double) -> 409 exact body');

  // ----------------------------------------------------------------
  // 2b. PG diagnostics reaching catches: collapse to the static fallback.
  // ----------------------------------------------------------------
  const PG_MARKERS = /invalid input syntax|SQLSTATE|duplicate key value|violates [a-z_ .-]+constraint|relation "[^"]+"|permission denied for|division by zero|syntax error at|does not exist/i;
  const collapsed: [Cx, string, string, string][] = [
    [w, 'GET', '/audit-log?since=not-a-time', 'Failed to read audit log'],
    [w, 'GET', '/answers/not-a-uuid/attachments', 'Failed to fetch attachments'],
    [c, 'POST', '/notifications/not-a-uuid/read', 'Failed to mark notification read'],
  ];
  for (const [cx, method, pathName, fallback] of collapsed) {
    const r = await raw(cx, method, pathName, method === 'POST' ? {} : undefined);
    assert.equal(r.status, 500, `PG ${method} ${pathName}: static 500 (got ${r.status} ${r.text.slice(0, 200)})`);
    assert.deepEqual(r.data, { error: fallback }, `PG ${method} ${pathName}: static fallback body, no code`);
    assert.ok(!PG_MARKERS.test(r.text), `PG ${method} ${pathName}: no PG text/SQLSTATE leaked`);
    console.log(`PG ${method} ${pathName} -> 500 {error:'${fallback}'} (raw PG diagnostic collapsed)`);
  }
  pass('E3-02 runtime: own bodies byte-identical; PG diagnostics collapse to static fallbacks');
  console.log('NOT VERIFIED here: unreachable-PG catches (taxonomy/gri/evaluations pre-validate every id — '
    + 'covered by the static pin + helper treatment); globalJsonErrorHandler indirection (disclosed carry).');
} finally {
  if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
  await pool.end();
}
