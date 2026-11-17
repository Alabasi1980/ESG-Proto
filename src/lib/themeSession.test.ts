// TASK-PROTO-H12 (D-H01-01) — tenant theme from the server.
//
// These are the no-DB guarantees: the closed enum + NULL-safe read, the schema
// append, the session-broadcast wiring (/auth/login and /auth/me), the single P
// write boundary (validation-before-transaction + §3 matrix), the provider
// order, and the pre-H12 fingerprint pins. The fresh-install proof (schema→U1→
// content with shape == constant) runs on an owned throwaway PG18 scratch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TENANT_THEMES, normalizeTenantTheme } from '../server/auth.ts';
import { classifyRoute, parseMatrix } from '../server/accessRegistry.ts';
import { assertRouteContext } from '../server/access.ts';
import type { AccessContext } from './capabilities.ts';
import { B17_CONTENT_SHAPE, B17_SHAPE, PREDECESSOR_SHAPE } from '../db/b17Readiness.ts';
import { updateClient } from '../server/routes/adminClients.ts';

const source = (file: string) => readFileSync(file, 'utf8');

test('H12 theme enum is closed; legacy/NULL/unknown values settle on ge', () => {
  assert.deepEqual([...TENANT_THEMES], ['ge', 'lime', 'dark']);
  for (const valid of ['ge', 'lime', 'dark'] as const)
    assert.equal(normalizeTenantTheme(valid), valid);
  // Legacy row, unset column, wrong case, non-string JSON: never a crash, never
  // an invented theme — the documented default wins.
  for (const legacy of [undefined, null, '', 'GE', 'Lime', 'blue', 0, 1, false, {}])
    assert.equal(normalizeTenantTheme(legacy), 'ge', `legacy ${String(legacy)} -> ge`);
});

test('H12 schema appends clients.theme with the ge default behind IF NOT EXISTS', () => {
  const schema = source('src/db/schema.sql');
  const h12Start = schema.indexOf('-- D-H01-01 (TASK-PROTO-H12)');
  assert.ok(h12Start >= 0, 'the D-H01-01 marker is present');
  // Bound to the H12 section only (ends where U4-1a begins): later additive
  // batches (e.g. TASK-PROTO-U4-2-FIX P1) legitimately carry their own CHECKs.
  const h12End = schema.indexOf('-- TASK-PROTO-U4-1a', h12Start);
  assert.ok(h12End > h12Start, 'the H12 section ends where U4-1a begins');
  const block = schema.slice(h12Start, h12End);
  assert.ok(block.length > 0, 'the D-H01-01 schema block is present');
  assert.match(block, /IF NOT EXISTS \(SELECT 1 FROM information_schema\.columns WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'theme'\)/);
  assert.match(block, /ALTER TABLE clients ADD COLUMN theme TEXT NOT NULL DEFAULT 'ge';/);
  // Validation deliberately lives in the handler, not a CHECK constraint.
  assert.doesNotMatch(block, /CHECK\s*\(/);
});

test('H12 login and /auth/me broadcast the server-owned theme', () => {
  const auth = source('src/server/auth.ts');
  const session = source('src/server/routes/session.ts');
  for (const [name, src] of [['auth.ts', auth], ['session.ts', session]] as const) {
    assert.match(src, /SELECT name,suspended,theme FROM clients WHERE id=\$1 FOR SHARE/,
      `${name}: tenant read carries theme`);
    assert.match(src, /theme: 'ge'/, `${name}: tenant-less/ge_admin default is ge`);
    assert.match(src, /normalizeTenantTheme\(tenant\.theme\)/, `${name}: stored value normalized`);
  }
  // /auth/me inherits identity.user untouched (no separate shape).
  assert.match(session, /\.\.\.identity\.user, mustChangePassword: identity\.mustChangePassword, suspended: identity\.suspended/);
  // The login response user object is the same AuthUser spread (theme included).
  assert.match(session, /user: \{ \.\.\.user, mustChangePassword: row\.must_change_password \}/);
});

test('H12 PATCH /clients/:id rejects an invalid theme before any transaction', async () => {
  const calls: unknown[] = [];
  const res = {
    status(code: number) { calls.push(['status', code]); return this; },
    json(body: unknown) { calls.push(['json', body]); return this; },
  };
  const req = {
    params: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    body: { theme: 'blue' },
    access: { mode: 'platform', actorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
  };
  // domainTransaction is never reached: an invalid enum is a pure 400.
  await updateClient(req as never, res as never);
  assert.deepEqual(calls, [
    ['status', 400],
    ['json', { error: 'theme must be one of ge, lime, dark.', code: 'theme.invalid' }],
  ]);
  const src = source('src/server/routes/adminClients.ts');
  const patch = src.slice(src.indexOf('export async function updateClient'),
    src.indexOf('export async function listClientServices'));
  assert.ok(patch.indexOf("code: 'theme.invalid'") < patch.indexOf('await domainTransaction(req'),
    'theme validation precedes the write transaction');
  assert.match(patch, /RETURNING id, code, name, industry, contact_email, suspended, theme, created_at/);
  assert.match(patch, /\.\.\.\(body\.theme !== undefined \? \{ theme: row\.theme \} : \{\}\)/,
    'the PATCH audit records the applied theme');
});

test('H12 theme writes are P-only by the §3 matrix (C/W/E are refused)', () => {
  const route = classifyRoute('PATCH', '/clients/:id')!;
  assert.deepEqual(route.matrix.map((rule) => rule.context), ['P']);
  assert.equal(route.matrix[0].tenant, 'none');
  assert.deepEqual(parseMatrix('P#suspend-unsuspend-only-on-clients-list-rename-industry-config'),
    [...route.matrix], 'the matrix row itself is unchanged');
  const base = { actorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', capability: 'probe' };
  const contexts: Record<string, AccessContext> = {
    platform: { ...base, role: 'ge_admin', mode: 'platform', tenantId: null, departmentId: null, tabId: base.actorId, generation: 1 },
    consultant: { ...base, role: 'ge_admin', mode: 'consultant', tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', departmentId: null, tabId: base.actorId, generation: 1 },
    client: { ...base, role: 'client_admin', mode: 'client', tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', departmentId: null, tabId: null, generation: null },
    employee: { ...base, role: 'employee', mode: 'employee', tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', departmentId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', tabId: null, generation: null },
  };
  assert.doesNotThrow(() => assertRouteContext(route, contexts.platform));
  for (const mode of ['consultant', 'client', 'employee'] as const) {
    assert.throws(() => assertRouteContext(route, contexts[mode]),
      (err: { statusCode?: number; code?: string }) => err.statusCode === 403 && err.code === 'workspace.mode_mismatch',
      `${mode} must not reach the theme writer`);
  }
});

test('H12 ThemeProvider mirrors the session theme and the providers are ordered Auth→Theme', () => {
  const theme = source('src/context/ThemeContext.tsx');
  assert.match(theme, /useLayoutEffect\(\(\) => \{[\s\S]*?setAttribute\('data-theme', theme\);[\s\S]*?\}, \[theme\]\);/,
    'data-theme is applied on every theme change');
  assert.match(theme, /user\?\.theme/);
  assert.doesNotMatch(theme, /localStorage\.|fetch\(|URLSearchParams|useSearchParams|window\.location/,
    'the provider never persists, fetches, or reads a URL override');
  const main = source('src/main.tsx');
  assert.ok(main.indexOf('<AuthProvider>') > -1 && main.indexOf('<ThemeProvider>') > -1);
  assert.ok(main.indexOf('<AuthProvider>') < main.indexOf('<ThemeProvider>'),
    'AuthProvider wraps ThemeProvider');
  assert.doesNotMatch(source('src/App.tsx'), /<AuthProvider>|<ThemeProvider>/,
    'App does not re-mount either provider');
});

test('H12 fingerprint pins are the freshly measured values, not the pre-theme ones', () => {
  for (const [name, value, before] of [
    ['PREDECESSOR_SHAPE', PREDECESSOR_SHAPE, '18851d69e9808bf86a41314173406ef9'],
    ['B17_SHAPE', B17_SHAPE, '4b4e39e3a13eae0d336d30fa94bbf52f'],
    ['B17_CONTENT_SHAPE', B17_CONTENT_SHAPE, '5d5ddb9344225a53059da3f7d92bdd94'],
  ] as const) {
    assert.match(value, /^[0-9a-f]{32}$/, name);
    // clients.theme is a public column: reverting the constant (without dropping
    // the column) must fail here before it can strand a fresh install.
    assert.notEqual(value, before, `${name} must be re-measured after clients.theme`);
  }
  assert.notEqual(PREDECESSOR_SHAPE, B17_SHAPE);
  assert.notEqual(B17_SHAPE, B17_CONTENT_SHAPE);
});
