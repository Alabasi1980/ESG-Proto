// TASK-PROTO-H13 — application-wide theme setting (platform) + ISS-005 token fix.
//
// No-DB guarantees for the whole contract §2: the closed option enum and its
// NULL storage, the global -> tenant -> 'ge' precedence matrix, the P-only
// registry rows (C/W/E refused), the handler's clean 400 before any transaction,
// the single-row storage + its three policies, both content-file hunks, the
// platform-only Settings section and the ISS-005 colour-as-text conversions.
// The live behaviour (row security, audit append, structure constants and the
// two falsifiability checks) is proved on an owned throwaway PG18 scratch by
// scripts/h13-app-theme-scratch.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  APP_THEME_OPTIONS,
  TENANT_THEMES,
  appThemeStorageValue,
  normalizeAppThemeOption,
  resolveAppTheme,
} from '../server/auth.ts';
import { classifyRoute, parseMatrix } from '../server/accessRegistry.ts';
import { assertRouteContext } from '../server/access.ts';
import type { AccessContext } from './capabilities.ts';
import { B17_CONTENT_SHAPE, B17_SHAPE, PREDECESSOR_SHAPE } from '../db/b17Readiness.ts';
import { writeAppSettings } from '../server/routes/settings.ts';

const source = (file: string) => readFileSync(file, 'utf8');

test('H13 option enum is closed; auto is the UI spelling of "no global override"', () => {
  assert.deepEqual([...APP_THEME_OPTIONS], ['auto', 'ge', 'lime', 'dark']);
  assert.deepEqual([...TENANT_THEMES], ['ge', 'lime', 'dark'], 'the stored set stays the tenant set');
  for (const option of ['auto', 'ge', 'lime', 'dark'] as const)
    assert.equal(normalizeAppThemeOption(option), option);
  // Unknown/legacy/NULL stored values settle on auto, never on an invented theme.
  for (const legacy of [undefined, null, '', 'GE', 'Auto', 'blue', 0, 1, false, {}, []])
    assert.equal(normalizeAppThemeOption(legacy), 'auto', `legacy ${String(legacy)} -> auto`);
  assert.equal(appThemeStorageValue('auto'), null, 'auto is stored as NULL');
  for (const theme of ['ge', 'lime', 'dark'] as const) assert.equal(appThemeStorageValue(theme), theme);
});

test('H13 resolution matrix: global ?? tenant ?? ge', () => {
  const matrix: [unknown, unknown, string][] = [
    // global wins over every tenant theme
    ['ge', 'lime', 'ge'], ['lime', 'dark', 'lime'], ['dark', 'ge', 'dark'], ['dark', 'dark', 'dark'],
    // global absent (NULL) -> the tenant theme applies
    [null, 'lime', 'lime'], [null, 'dark', 'dark'], [null, 'ge', 'ge'],
    // no global, no tenant -> the documented default
    [null, null, 'ge'], [null, '', 'ge'],
    // defensive: an unknown stored value can never pin the whole application
    ['auto', 'lime', 'lime'], ['blue', 'dark', 'dark'], ['', 'lime', 'lime'], [undefined, null, 'ge'],
    // tenant legacy columns keep their existing NULL-safe read
    [null, 'GE', 'ge'], [null, 0, 'ge'],
  ];
  for (const [global, tenant, expected] of matrix)
    assert.equal(resolveAppTheme(global, tenant), expected, `global=${String(global)} tenant=${String(tenant)}`);
});

test('H13 GET/PUT are P only: consultant, client and employee are refused by the matrix', () => {
  const base = { actorId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', capability: 'settings' };
  const contexts: Record<string, AccessContext> = {
    platform: { ...base, role: 'ge_admin', mode: 'platform', tenantId: null, departmentId: null,
      tabId: base.actorId, generation: 1 },
    consultant: { ...base, role: 'ge_admin', mode: 'consultant', tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      departmentId: null, tabId: base.actorId, generation: 1 },
    client: { ...base, role: 'client_admin', mode: 'client', tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      departmentId: null, tabId: null, generation: null },
    employee: { ...base, role: 'employee', mode: 'employee', tenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      departmentId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', tabId: null, generation: null },
  };
  for (const [method, path, matrix] of [
    ['GET', '/settings', 'P#platform-app-theme-read-absent-row-is-auto-no-tenant-payload'],
    ['PUT', '/settings', 'P#platform-app-theme-writer-enum-validated-audited-auto-stores-null'],
  ] as const) {
    const route = classifyRoute(method, path)!;
    assert.deepEqual(route.matrix.map((rule) => rule.context), ['P'], `${method} ${path} is P only`);
    assert.equal(route.activation, 'U1');
    assert.deepEqual(parseMatrix(matrix), [...route.matrix], 'the matrix row itself is the transcribed data');
    assert.doesNotThrow(() => assertRouteContext(route, contexts.platform));
    for (const mode of ['consultant', 'client', 'employee'] as const)
      assert.throws(() => assertRouteContext(route, contexts[mode]),
        (err: { statusCode?: number; code?: string }) => err.statusCode === 403 && err.code === 'workspace.mode_mismatch',
        `${mode} must not reach the settings rows`);
  }
  // Both declarations are mounted with the standard wrapper, and the write keeps
  // the F-03 fresh-identity gate.
  const src = source('src/server/routes/settings.ts');
  assert.match(src, /router\.get\('\/settings', authMiddleware, requireDomainAccess,/);
  assert.match(src, /router\.put\('\/settings', authMiddleware, requireFreshPassword, requireDomainAccess,/);
});

test('H13 PUT rejects an invalid theme with 400 settings.theme_invalid before any transaction', async () => {
  const calls: unknown[] = [];
  const res = {
    status(code: number) { calls.push(['status', code]); return this; },
    json(body: unknown) { calls.push(['json', body]); return this; },
  };
  // domainTransaction is never reached: the enum check is a pure 400.
  for (const theme of ['blue', 'GE', 'Auto', '', 3, null, undefined, ['ge']])
    await writeAppSettings({ body: { theme } } as never, res as never);
  const expected = ['status', 400];
  for (let i = 0; i < 8; i++) {
    assert.deepEqual(calls[i * 2], expected);
    assert.deepEqual(calls[i * 2 + 1], ['json', {
      error: 'theme must be one of auto, ge, lime, dark.', code: 'settings.theme_invalid',
    }]);
  }
  const src = source('src/server/routes/settings.ts');
  const write = src.slice(src.indexOf('export async function writeAppSettings'));
  assert.ok(write.indexOf("code: 'settings.theme_invalid'") < write.indexOf('await domainTransaction(req'),
    'enum validation precedes the write transaction');
});

test('H13 PUT upserts the single row, stores auto as NULL and audits APP_THEME_UPDATED', () => {
  const src = source('src/server/routes/settings.ts');
  assert.match(src, /INSERT INTO app_settings \(id, theme\) VALUES \(1, \$1\)\s*\n?\s*ON CONFLICT \(id\) DO UPDATE SET theme = EXCLUDED\.theme, updated_at = clock_timestamp\(\)/);
  assert.match(src, /\[appThemeStorageValue\(theme\)\]/, 'auto is persisted as NULL through the shared mapping');
  assert.match(src, /action: 'APP_THEME_UPDATED'/);
  assert.match(src, /entityType: 'app_settings'/);
  assert.match(src, /clientId: null/, 'a platform row carries no tenant id');
  assert.match(src, /payload: \{ theme \}/, 'the audit payload is exactly {theme}');
  // GET and PUT answer with the same shape, and GET maps the stored value back
  // to the option enum so a missing row reads as auto.
  assert.match(src, /return normalizeAppThemeOption\(row\?\.theme\)/);
  assert.equal((src.match(/res\.json\(\{ theme \}\)/g) ?? []).length, 2, 'GET reflects PUT (same shape)');
});

test('H13 storage: one row (id=1), FORCE RLS, three policies, no theme CHECK', () => {
  const schema = source('src/db/schema.sql');
  const start = schema.indexOf('-- TASK-PROTO-H13 — app_settings');
  assert.ok(start > 0, 'the H13 storage block is present');
  const block = schema.slice(start);
  assert.match(block, /CREATE TABLE IF NOT EXISTS app_settings \(/);
  assert.match(block, /id SMALLINT PRIMARY KEY DEFAULT 1 CHECK \(id = 1\)/);
  assert.match(block, /theme TEXT,/);
  assert.match(block, /updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW\(\)/);
  assert.match(block, /ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;/);
  assert.match(block, /ALTER TABLE app_settings FORCE ROW LEVEL SECURITY;/);
  assert.match(block, /CREATE POLICY app_settings_read ON app_settings\s*\n\s*FOR SELECT\s*\n\s*USING \(true\);/);
  const predicate = "nullif\\(current_setting\\('app\\.current_purpose', true\\), ''\\) = 'platform\\.config'\\)";
  assert.match(block, new RegExp(`CREATE POLICY app_settings_insert ON app_settings\\s*\\n\\s*FOR INSERT\\s*\\n\\s*WITH CHECK \\(${predicate}`));
  assert.match(block, new RegExp(`CREATE POLICY app_settings_update ON app_settings\\s*\\n\\s*FOR UPDATE\\s*\\n\\s*USING \\(${predicate}\\s*\\n\\s*WITH CHECK \\(${predicate}`));
  // Handler-validated on purpose, exactly like clients.theme: no theme CHECK.
  assert.doesNotMatch(block, /CHECK\s*\(\s*theme/i);
  assert.doesNotMatch(block, /INSERT INTO app_settings/i, 'nothing is seeded: absent row = auto');
});

test('H13 content substrate: the audit action and the post-wipe policy re-assert (only two hunks)', () => {
  const content = source('src/db/b17-content.sql');
  // Hunk 1: the NULL-target platform.config audit allowlist.
  const audit = content.slice(content.indexOf('CREATE POLICY b17_audit_insert'),
    content.indexOf('OR b17_work_tenant(client_id)));'));
  assert.match(audit, /action IN \('CREATE_CLIENT','LINK_SERVICE_ALL_TENANTS','APP_THEME_UPDATED'\)/,
    'APP_THEME_UPDATED is admitted only on the NULL-target platform.config branch');
  assert.equal((content.match(/APP_THEME_UPDATED/g) ?? []).length, 1, 'exactly one allowlist mention');
  // Hunk 2: b17.sql replaces every predecessor policy, so the three app_settings
  // policies are re-asserted after the wipe (idempotent DROP + CREATE).
  const tail = content.slice(content.lastIndexOf('-- TASK-PROTO-H13 — app_settings'));
  for (const policy of ['app_settings_read', 'app_settings_insert', 'app_settings_update'])
    assert.match(tail, new RegExp(`DROP POLICY IF EXISTS ${policy} ON app_settings;\\s*\\nCREATE POLICY ${policy} ON app_settings`));
  assert.match(tail, /USING \(true\);/);
  assert.equal((tail.match(/= 'platform\.config'\)/g) ?? []).length, 3,
    'INSERT WITH CHECK + UPDATE USING + UPDATE WITH CHECK');
});

test('H13 SettingsView: platform-only section, server round-trip, immediate apply', () => {
  const view = source('src/views/SettingsView.tsx');
  // Handlers block (state + GET/PUT/refreshUser) then the JSX block.
  const handlers = view.slice(view.indexOf('TASK-PROTO-H13: platform-wide application theme'),
    view.indexOf('Account Security & Change Password Card'));
  const section = view.slice(view.indexOf('TASK-PROTO-H13: platform-only'),
    view.indexOf('Account Security & Change Password Card'));
  assert.ok(handlers.length > 0 && section.length > 0, 'the section and its handlers exist');
  assert.match(handlers, /fetch\('\/api\/settings', \{ headers:/, 'current value is loaded from GET /settings');
  assert.match(handlers, /method: 'PUT'/, 'saved through PUT /settings');
  assert.match(handlers, /await refreshUser\(\);/, 'the change applies immediately through the session');
  assert.match(handlers, /setAppTheme\(stored === 'ge' \|\| stored === 'lime' \|\| stored === 'dark' \? stored : 'auto'\)/,
    'an unknown/absent stored value reads as auto');
  assert.match(section, /\{isGeAdmin && \(/, 'never rendered for client_admin/employee');
  assert.ok(section.indexOf('{isGeAdmin && (') < section.indexOf('appThemeSection'));
  assert.match(section, /APP_THEME_CHOICES\.map/, 'four options: auto + the three themes');
  assert.doesNotMatch(section, /text-brand(?![-a-zA-Z])/, 'no colour-as-text in the new section');
});

test('ISS-005: no colour-as-text remaining at the recorded spots', () => {
  const spots: [string, RegExp][] = [
    ['src/views/SettingsView.tsx', /bg-brand-soft text-brand-text/],
    ['src/App.tsx', /text-brand-text animate-spin/],
    ['src/views/SetupView.tsx', /border-border-strong text-brand-text focus:ring-focus-ring/],
  ];
  for (const [file, expected] of spots) {
    const src = source(file);
    assert.match(src, expected, `${file}: converted spot present`);
    // `text-brand` as TEXT/ICON is gone; `bg-brand` fills and `text-brand-ink`
    // (on brand fill) are untouched, GAP-002 included.
    assert.doesNotMatch(src, /text-brand(?![-a-zA-Z])/, `${file}: text-brand-as-text must be gone`);
  }
  // Two recorded ISS-005 chips + the new H13 section header chip: all three are
  // colour-as-icon on a soft surface, so all three carry the -text token.
  assert.equal((source('src/views/SettingsView.tsx').match(/bg-brand-soft text-brand-text/g) ?? []).length, 3,
    'every soft-surface brand chip uses the -text token');
  assert.match(source('src/views/SettingsView.tsx'), /<UserPlus className="w-4 h-4 text-brand-text" \/>/);
});

test('H13 i18n: every new key exists in both locales', () => {
  const i18n = source('src/i18n/translations.ts');
  for (const key of ['appThemeSection', 'appThemeDescription', 'appThemePlatformOnly', 'appThemeAuto',
    'appThemeAutoHint', 'appThemeGe', 'appThemeLime', 'appThemeDark', 'appThemeSave', 'appThemeSaving',
    'appThemeSaved', 'appThemeFailed']) {
    assert.equal((i18n.match(new RegExp(`\\b${key}:`, 'g')) ?? []).length, 3,
      `${key}: interface + EN + AR`);
  }
});

test('H13 constants were re-measured, not carried over from H12', () => {
  for (const [name, value, before] of [
    ['PREDECESSOR_SHAPE', PREDECESSOR_SHAPE, '6df697af6c8f04a95c799f1bd9640aff'],
    ['B17_SHAPE', B17_SHAPE, 'a8dbb2d504cc945bea31e29e858e5437'],
    ['B17_CONTENT_SHAPE', B17_CONTENT_SHAPE, 'cf79a6a3827ab6037a28f629e4cbdb17'],
  ] as const) {
    assert.match(value, /^[0-9a-f]{32}$/, name);
    // app_settings is a table with policies and the audit allowlist is fingerprinted:
    // reverting a constant (without reverting the SQL) must fail here first.
    assert.notEqual(value, before, `${name} must be re-measured after H13`);
  }
  assert.notEqual(PREDECESSOR_SHAPE, B17_SHAPE);
  assert.notEqual(B17_SHAPE, B17_CONTENT_SHAPE);
});
