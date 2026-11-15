// G2 full census — OWN fresh scratch only (b17_u2g_g2_scratch_*), real mounted
// dispatcher (accessDispatcher -> auth -> requireDomainAccess -> handler).
// Table-driven: all 99 mounted declarations (95 legacy + 4 workspace) x their
// §3 contexts {anon, P, W, C, E} = 495 cells with EXACT expected status/code
// (refusals derived from the registry matrix; served cells pinned per route).
// Also proves registry/matrix/capabilities byte-stability against the G2 base
// and 0 UNACTIVATED. Never runs scripts/b17-scope-proof.ts or the showcase.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import express from 'express';
import cookieParser from 'cookie-parser';
import { getPool, runMigrations } from '../src/db/index.ts';
import { applyB17Offline, assertB17Ready } from '../src/db/b17Readiness.ts';
import { inventoryB17ContentOffline, applyB17ContentOffline } from '../src/db/b17ContentMigration.ts';
import { verifyToken } from '../src/server/auth.ts';
import { ACCESS_REGISTRY, LEGACY_ROUTES, WORKSPACE_ROUTES, classifyRoute,
  type RouteDeclaration } from '../src/server/accessRegistry.ts';
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
const baseFile = (file: string) =>
  execFileSync('git', ['show', `${BASE}:${file}`], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] })
    .replace(/\r\n/g, '\n');

// ---- Registry / matrix / capabilities byte-stability vs the G2 base ----
for (const file of ['src/server/accessRegistry.ts', 'src/lib/capabilities.ts'])
  assert.equal(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'), baseFile(file),
    `${file} must be byte-stable against the G2 base`);
assert.equal(ACCESS_REGISTRY.length, 99, '99 mounted declarations');
assert.equal(LEGACY_ROUTES.length, 95, '95 legacy declarations');
assert.equal(WORKSPACE_ROUTES.length, 4, '4 workspace declarations');
assert.equal(LEGACY_ROUTES.filter(r => r.activation === 'UNACTIVATED').length, 0, '0 UNACTIVATED');
assert.ok(LEGACY_ROUTES.every(r => r.activation === 'U1') && WORKSPACE_ROUTES.every(r => r.activation === 'U1'));
pass('registry/matrix/capabilities byte-stable vs G2 base; 99 = 95 + 4; 0 UNACTIVATED (all U1)');

type Cell = [status: number, code?: string];
type Row = { m: string; p: string; body?: unknown; served: Cell; anon?: Cell; mode?: 'enter' | 'exit' | 'logout';
  /** Per-context override of the derived cell (served OR refusal). */
  ctx?: Partial<Record<'P' | 'W' | 'C' | 'E', Cell>> };

const seed = await (async () => {
  // Predecessor schema first, then the INSERT-only fixture (same order as the
  // G1 proof): both run before any activation and fail the process if broken.
  assert.equal((await runMigrations()).success, true);
  return seedG1();
})();
const t = seed.tenants.A, svc = seed.services.GRI, std = seed.std;
const item = seed.items[3], item2 = seed.items[4];

// Every registry declaration appears exactly once; `served` is the exact
// outcome for every matrix-allowed context (over = per-context override),
// refusals are derived from the matrix, `anon` overrides the PUBLIC default.
const ROWS: Row[] = [
  // §3.1 system + session (8)
  { m: 'GET', p: '/db/status', served: [200] },
  { m: 'POST', p: '/db/migrate', body: {}, served: [409, 'migrations.offline_only'] },
  { m: 'GET', p: '/setup/status', served: [200] },
  { m: 'POST', p: '/setup/admin', body: {}, served: [403, 'setup.denied'], anon: [400, 'setup.input_invalid'] },
  { m: 'POST', p: '/auth/login', body: {}, served: [400, 'auth.credentials_required'] },
  { m: 'POST', p: '/auth/logout', body: {}, served: [200], mode: 'logout' },
  { m: 'GET', p: '/auth/me', served: [200], anon: [401, 'auth.invalid'] },
  { m: 'POST', p: '/auth/change-password', body: {}, served: [400, 'auth.password_invalid'],
    // Body validation runs before the session check on this remediation path:
    // an anonymous malformed body is the same own 400, exposing nothing.
    anon: [400, 'auth.password_invalid'] },
  // §3.2 taxonomy (18) + GRI/dashboard (5)
  { m: 'GET', p: '/services', served: [200] },
  { m: 'GET', p: '/disclosures', served: [200] },
  { m: 'GET', p: '/items', served: [200] },
  { m: 'POST', p: '/services', body: {}, served: [400] },
  { m: 'PATCH', p: `/services/${NIL}`, body: { code: 'G2X', name: 'G2X' }, served: [404] },
  { m: 'POST', p: `/services/${NIL}/duplicate`, body: { code: 'G2X' }, served: [404] },
  { m: 'POST', p: `/services/${NIL}/standards`, body: { standardId: std }, served: [404] },
  // The unlink handler has no service-existence pre-check (unchanged legacy
  // behaviour): unlinking an unmapped pair answers idempotent 200.
  { m: 'DELETE', p: `/services/${NIL}/standards`, body: { standardId: std }, served: [200] },
  { m: 'PATCH', p: `/standards/${NIL}`, body: { title: 'G2' }, served: [404] },
  { m: 'DELETE', p: `/standards/${NIL}`, served: [404] },
  { m: 'PATCH', p: `/disclosures/${NIL}`, body: { title: 'G2' }, served: [404] },
  { m: 'DELETE', p: `/disclosures/${NIL}`, served: [404] },
  { m: 'POST', p: '/items', body: { disclosureId: NIL, code: 'G2', requirement: 'G2' }, served: [404] },
  { m: 'PATCH', p: `/items/${NIL}`, body: { requirement: 'G2' }, served: [404] },
  { m: 'DELETE', p: `/items/${NIL}`, served: [404] },
  { m: 'POST', p: `/items/${NIL}/links`, body: { otherItemId: item2 }, served: [404] },
  { m: 'DELETE', p: `/items/${NIL}/links`, body: { otherItemId: item2 }, served: [404] },
  { m: 'GET', p: `/items/${NIL}/links`, served: [404] },
  { m: 'POST', p: '/gri/preview', body: {}, served: [400] },
  { m: 'POST', p: '/gri/commit', body: {}, served: [400] },
  { m: 'GET', p: '/gri/template', served: [200] },
  { m: 'GET', p: '/standards', served: [200] },
  { m: 'GET', p: '/dashboard/stats', served: [200] },
  // §3.3 evaluations (15)
  { m: 'GET', p: '/queue', served: [200] },
  { m: 'POST', p: '/evaluations', body: {}, served: [400] },
  { m: 'POST', p: `/evaluations/${NIL}/submit`, body: { version: 1 }, served: [404] },
  { m: 'POST', p: `/evaluations/${NIL}/approve`, body: { version: 1 }, served: [404] },
  { m: 'POST', p: `/evaluations/${NIL}/return`, body: { version: 1, comment: 'g2' }, served: [404] },
  { m: 'PUT', p: `/evaluations/${NIL}/correct`, body: { newScore: 50, reason: 'g2', version: 1 }, served: [404] },
  { m: 'GET', p: `/evaluations?itemId=${item}`, served: [200] },
  { m: 'POST', p: `/evaluations/${NIL}/client-approve`, body: { version: 1 }, served: [404] },
  { m: 'POST', p: `/evaluations/${NIL}/client-return`, body: { version: 1, comment: 'g2' }, served: [404] },
  { m: 'GET', p: '/client-review', served: [200] },
  { m: 'GET', p: '/reviews/ge-check?scope=tenant', served: [200] },
  { m: 'POST', p: '/reviews/ge-final', body: {}, served: [400] },
  { m: 'GET', p: '/reviews/snapshots', served: [200] },
  { m: 'GET', p: `/reviews/snapshots/${NIL}`, served: [404] },
  { m: 'POST', p: `/reviews/snapshots/${NIL}/notes`, body: { note: 'g2' }, served: [404] },
  // §3.4 admin (25)
  { m: 'GET', p: '/clients', served: [200] },
  { m: 'POST', p: '/clients', body: {}, served: [400] },
  { m: 'GET', p: `/departments?clientId=${t}`, served: [200] },
  { m: 'PATCH', p: `/departments/${NIL}/head`, body: { clientId: t, headUserId: seed.users.eA }, served: [404] },
  { m: 'GET', p: `/users?clientId=${t}`, served: [200] },
  { m: 'POST', p: '/users', body: {}, served: [400] },
  { m: 'PATCH', p: `/users/${NIL}`, body: { clientId: t, isActive: false }, served: [404] },
  { m: 'GET', p: '/ge/overview', served: [200] },
  { m: 'GET', p: `/clients/${t}`, served: [200] },
  { m: 'PATCH', p: `/clients/${NIL}`, body: { name: 'G2' }, served: [404] },
  { m: 'GET', p: `/clients/${NIL}/services`, served: [200],
    // P@T truthfully answers an empty list for an unknown target; W/C/E treat
    // the path id as a supplied client id, which must MISMATCH their own (403).
    ctx: { W: [403, 'scope.tenant_mismatch'], C: [403, 'scope.tenant_mismatch'],
      E: [403, 'scope.tenant_mismatch'] } },
  { m: 'POST', p: `/clients/${NIL}/services`, body: { serviceId: svc }, served: [404] },
  { m: 'PATCH', p: `/clients/${NIL}/services/${svc}`, body: { showGap: true }, served: [404] },
  { m: 'DELETE', p: `/clients/${NIL}/services/${svc}`, served: [404] },
  { m: 'POST', p: '/services/link-all', body: {}, served: [400] },
  { m: 'GET', p: `/assignments?clientId=${t}`, served: [200] },
  { m: 'POST', p: '/assignments', body: {}, served: [400] },
  { m: 'DELETE', p: '/assignments', body: {}, served: [400] },
  { m: 'POST', p: '/assignments/na', body: {}, served: [400] },
  { m: 'GET', p: `/staff-lists?clientId=${t}`, served: [200] },
  { m: 'POST', p: '/staff-lists', body: {}, served: [400] },
  { m: 'POST', p: `/staff-lists/${NIL}/submit`, body: {}, served: [404] },
  { m: 'POST', p: `/staff-lists/${NIL}/approve`, body: { clientId: t }, served: [404] },
  { m: 'POST', p: `/staff-lists/${NIL}/reject`, body: { clientId: t, reason: 'g2' }, served: [404] },
  { m: 'GET', p: '/client/dashboard', served: [200] },
  // §3.5 actions (3), initiatives/profile (7), reports (4)
  { m: 'GET', p: '/actions', served: [200] },
  { m: 'POST', p: '/actions', body: {}, served: [400] },
  { m: 'PATCH', p: `/actions/${NIL}`, body: { evidenceNote: 'g2' }, served: [404] },
  { m: 'GET', p: '/initiatives', served: [200] },
  { m: 'POST', p: '/initiatives', body: {}, served: [400] },
  { m: 'PATCH', p: `/initiatives/${NIL}`, body: { title: 'G2' }, served: [404] },
  { m: 'POST', p: '/initiatives/select', body: {}, served: [400] },
  { m: 'DELETE', p: `/initiatives/select/${NIL}`, served: [404] },
  { m: 'POST', p: '/esg-profile/import', body: {}, served: [400] },
  { m: 'GET', p: `/esg-profile?serviceId=${svc}`, served: [200] },
  { m: 'GET', p: `/report-settings?clientId=${t}&serviceId=${svc}`, served: [200] },
  { m: 'PUT', p: '/report-settings', body: {}, served: [400] },
  { m: 'GET', p: `/reports/index?level=L3&serviceId=${svc}`, served: [200] },
  { m: 'GET', p: `/reports/export?level=L3&serviceId=${svc}`, served: [200] },
  // §3.6 storage (5), audit (1), notifications (4)
  { m: 'POST', p: `/answers/${seed.answer}/attachments`, served: [400, 'attachments.missing'] },
  { m: 'GET', p: `/answers/${NIL}/attachments`, served: [404] },
  { m: 'GET', p: `/answers/${NIL}/attachments/${NIL}/download`, served: [404] },
  { m: 'DELETE', p: `/answers/${NIL}/attachments/${NIL}`, served: [404] },
  { m: 'GET', p: `/storage/usage?clientId=${t}`, served: [200] },
  { m: 'GET', p: '/audit-log', served: [200] },
  { m: 'GET', p: '/notifications', served: [200] },
  { m: 'GET', p: '/notifications/unread-count', served: [200] },
  { m: 'POST', p: `/notifications/${NIL}/read`, body: {}, served: [404] },
  { m: 'POST', p: '/notifications/read-all', body: {}, served: [200] },
  // §4 workspace lifecycle (4)
  { m: 'POST', p: '/workspace/tab', body: {}, served: [201] },
  { m: 'GET', p: '/workspace', served: [200] },
  { m: 'POST', p: '/workspace/enter', body: { clientId: t }, served: [200], mode: 'enter',
    // A W-mode tab must exit first (state machine 409), never a silent switch.
    ctx: { W: [409, 'workspace.exit_required'] } },
  { m: 'POST', p: '/workspace/exit', body: {}, served: [200], mode: 'exit' },
];

// ---- Table completeness: exactly the 99 registry declarations, once each ----
const keys = ROWS.map(row => {
  const route = classifyRoute(row.m, row.p.split('?')[0]);
  assert.ok(route, `probe must map to a registry declaration: ${row.m} ${row.p}`);
  return `${route.method} ${route.path}`;
});
assert.equal(new Set(keys).size, 99, 'no duplicate probe rows');
assert.deepEqual([...new Set(keys)].sort(), ACCESS_REGISTRY.map(r => `${r.method} ${r.path}`).sort(),
  'probe table covers EXACTLY the 99 mounted declarations');

const permitted = (route: RouteDeclaration, letter: string) => route.matrix.some(rule =>
  rule.context === 'PUBLIC' || rule.context === 'SESSION' || rule.context === letter
  || (rule.context === 'GE' && (letter === 'P' || letter === 'W')));
const anonPermitted = (route: RouteDeclaration) => route.matrix.some(rule => rule.context === 'PUBLIC');
const SQLSTATE = /^[0-9A-Z]{5}$/;

let server: ReturnType<express.Express['listen']> | undefined;
try {
  const migration = await pool.connect();
  try {
    assert.equal(await applyB17Offline(migration), 'applied');
    const inventory = await inventoryB17ContentOffline(migration, seed.targets, seed.sources);
    assert.equal(await applyB17ContentOffline(migration, inventory, seed.sources), 'applied');
  } finally { migration.release(); }
  await assertB17Ready();
  // Importing api runs assertRegistryCoverage against the real routers.
  const app = express();
  app.use(jsonInput); app.use(cookieParser()); app.use('/api', api); app.use(globalJsonErrorHandler);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(r => server!.once('listening', r));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;

  type Cx = { token: string; handle?: string; generation?: number };
  async function raw(cx: Cx | undefined, method: string, pathName: string, body?: unknown) {
    const headers: Record<string, string> = {};
    if (cx) headers.Authorization = `Bearer ${cx.token}`;
    if (cx?.handle) { headers['X-Workspace-Tab'] = cx.handle; headers['X-Workspace-Version'] = String(cx.generation); }
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(origin + pathName, { method, headers,
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const text = await response.text();
    let data: Record<string, unknown> = { raw: true };
    try { data = JSON.parse(text) as Record<string, unknown>; } catch { /* non-JSON (CSV) */ }
    return { status: response.status, data, text };
  }
  async function login(name: string, tab: boolean): Promise<Cx> {
    const response = await raw(undefined, 'POST', '/auth/login', { email: `${name}@domain-d.invalid`, password: seed.password });
    assert.equal(response.status, 200, `${name} login: ${response.text.slice(0, 160)}`);
    const cx: Cx = { token: (response.data as { token: string }).token };
    if (tab) {
      const created = await raw(cx, 'POST', '/workspace/tab', {});
      assert.equal(created.status, 201, 'census tab');
      cx.handle = (created.data as { tabHandle: string }).tabHandle;
      cx.generation = (created.data as { generation: number }).generation;
    }
    return cx;
  }
  const nameFor = (letter: string) => letter === 'P' || letter === 'W' ? 'ge'
    : letter === 'C' ? 'cA' : 'eA';
  const contexts: Record<string, Cx | undefined> = { anon: undefined };
  for (const letter of ['P', 'W', 'C', 'E']) contexts[letter] = await login(nameFor(letter), letter === 'P' || letter === 'W');
  const wEnter = await raw(contexts.W, 'POST', '/workspace/enter', { clientId: t });
  assert.equal(wEnter.status, 200, `W enter: ${wEnter.text.slice(0, 160)}`);
  (contexts.W as Cx).generation = (wEnter.data as { generation: number }).generation;

  const failures: string[] = [];
  const check = (response: { status: number; data: Record<string, unknown>; text: string },
    cell: Cell, label: string) => {
    if (response.status !== cell[0])
      failures.push(`${label}: status expected ${cell[0]} got ${response.status} :: ${response.text.slice(0, 200)}`);
    else if (cell[1] !== undefined && response.data.code !== cell[1])
      failures.push(`${label}: code expected ${cell[1]} got ${String(response.data.code)} :: ${response.text.slice(0, 200)}`);
    else if (cell[1] === undefined && typeof response.data.code === 'string'
      && SQLSTATE.test(response.data.code))
      failures.push(`${label}: raw SQLSTATE code ${response.data.code}`);
  };

  let served = 0, refused = 0, cells = 0;
  const statusHistogram: Record<number, number> = {};
  for (const row of ROWS) {
    const route = classifyRoute(row.m, row.p.split('?')[0])!;
    const routeKey = `${route.method} ${route.path}`;
    for (const letter of ['anon', 'P', 'W', 'C', 'E'] as const) {
      let cx = contexts[letter];
      let cell: Cell;
      if (letter === 'anon') cell = row.anon ?? (anonPermitted(route) ? row.served : [401, 'auth.invalid']);
      else if (permitted(route, letter)) cell = row.ctx?.[letter] ?? row.served;
      // The workspace lifecycle router guards in its own handler (business
      // roles get workspace.forbidden), never through requireDomainAccess's
      // matrix ring; every other row refuses through the matrix.
      else cell = row.ctx?.[letter]
        ?? (route.path.startsWith('/workspace') ? [403, 'workspace.forbidden']
          : [403, 'workspace.mode_mismatch']);
      // Context-state probes get a dedicated session so the shared contexts stay usable.
      if (row.mode === 'logout' && letter !== 'anon') cx = await login(nameFor(letter), false);
      if (row.mode === 'enter' && letter === 'P') {
        cx = await login('ge', true);
      }
      if (row.mode === 'exit' && letter === 'W') {
        cx = await login('ge', true);
        const entered = await raw(cx, 'POST', '/workspace/enter', { clientId: t });
        assert.equal(entered.status, 200, 'dedicated W enter');
        cx.generation = (entered.data as { generation: number }).generation;
      }
      const label = `${routeKey} [${letter}]`;
      const response = await raw(cx, row.m, row.p, row.body);
      check(response, cell, label);
      cells++;
      if (cell[0] >= 400 && cell[1] !== undefined
        && ['auth.invalid', 'workspace.mode_mismatch', 'access.unactivated', 'api.not_found'].includes(cell[1])) refused++;
      else served++;
      statusHistogram[response.status] = (statusHistogram[response.status] ?? 0) + 1;
    }
  }
  assert.equal(cells, 495, '99 declarations x 5 callers = 495 cells');
  assert.deepEqual(failures, [], `census cell mismatches:\n${failures.join('\n')}`);
  // Negative route: unknown operations fail closed with the terminal JSON 404.
  const unknown = await raw(contexts.P, 'GET', '/g2-unknown-operation');
  assert.deepEqual([unknown.status, unknown.data.code], [404, 'api.not_found'], 'unknown route is refused');
  assert.ok(served > 150 && refused > 150, `both outcomes must be exercised (served=${served} refused=${refused})`);
  console.log(`CENSUS cells=${cells} (99x5) served=${served} refused=${refused} statuses=${JSON.stringify(statusHistogram)}`);
  pass('full mounted-route census: every declaration x every §3 context through the real dispatcher, exact status/code');
  console.log('NOT VERIFIED here: per-handler positive business semantics (covered by the G1/proof suites).');
} finally {
  if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
  await pool.end();
}
