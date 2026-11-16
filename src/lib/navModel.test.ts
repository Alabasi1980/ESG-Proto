/**
 * TASK-PROTO-U3-B1 §3 evidence — table-driven proof of the ONE navigation model.
 *
 * Every expectation below is transcribed from B17_UI_BINDINGS.md §3 (the
 * authoritative matrix), NOT from navModel's internals, so a drift in either
 * direction fails here: 4 contexts x every page id (present / absent / order /
 * label AR+EN / alias), landing per context, and the deny-by-default guard that
 * App consumes before it mounts anything.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  CONTEXTS, PAGE_IDS, PENDING_PAGE_IDS,
  aliasOf, deriveNavContext, identityLabelKey, isPageAllowed, landingFor, labelOf,
  menuPages, navPages, pagesIn, resolvePage, shellIdentity, workspaceExitLanding,
  type NavContext, type PageId,
} from './navModel.ts';
import { permittedPages, type AccessContext } from './capabilities.ts';

/** [id, sidebar order (null = contextual target), menu, AR, EN] — §3 verbatim. */
type Row = readonly [PageId, number | null, boolean, string, string];

const EXPECTED: Record<NavContext, readonly Row[]> = {
  platform: [
    ['ge-overview', 1, true, 'عمليات GE', 'GE Operations'],
    ['clients', 2, true, 'العملاء', 'Clients'],
    ['standards', 3, true, 'معايير GRI', 'GRI Standards'],
    ['initiatives', 4, true, 'مكتبة المبادرات', 'Initiatives Library'],
    ['import-gri', 5, true, 'استيراد بيانات GRI', 'Import GRI Data'],
    ['settings', 6, true, 'الإعدادات وقاعدة البيانات', 'Settings & Database'],
    ['staff-lists', 7, true, 'قوائم الموظفين', 'Staff Lists'],
    ['audit-log', 8, true, 'سجل التدقيق', 'Audit Log'],
    ['notifications', 9, true, 'الإشعارات', 'Notifications'],
    ['client-detail', null, false, 'تفاصيل العميل', 'Client Detail'],
  ],
  consultant: [
    ['dashboard', 1, true, 'لوحة المؤشرات', 'Dashboard'],
    ['client-detail', 2, true, 'تفاصيل العميل', 'Client Detail'],
    ['standards', 3, true, 'معايير GRI', 'GRI Standards'],
    ['gap-analysis', 4, true, 'تحليل الفجوات', 'Gap Analysis'],
    ['actions', 5, true, 'الإجراءات التصحيحية', 'Corrective Actions'],
    ['initiatives', 6, true, 'المبادرات المسندة', 'Assigned Initiatives'],
    ['staff-lists', 9, true, 'قوائم الموظفين', 'Staff Lists'],
    ['audit-log', 10, true, 'سجل التدقيق', 'Audit Log'],
    ['notifications', 11, true, 'الإشعارات', 'Notifications'],
  ],
  client: [
    ['client-dashboard', 1, true, 'لوحة العميل', 'Client Dashboard'],
    ['client-detail', 2, true, 'تفاصيل العميل', 'Client Detail'],
    ['standards', 3, true, 'معايير GRI', 'GRI Standards'],
    ['gap-analysis', 4, true, 'تحليل الفجوات', 'Gap Analysis'],
    ['actions', 5, true, 'الإجراءات التصحيحية', 'Corrective Actions'],
    ['initiatives', 6, true, 'المبادرات المسندة', 'Assigned Initiatives'],
    ['staff-lists', 9, true, 'قوائم الموظفين', 'Staff Lists'],
    ['notifications', 10, true, 'الإشعارات', 'Notifications'],
  ],
  employee: [
    ['gap-analysis', 1, true, 'إفصاحات قسمي', 'My department disclosures'],
  ],
};

/** §3 `*` rows: withheld until the server-reported capability set proves them. */
const CONDITIONAL: Record<'consultant' | 'client', readonly Row[]> = {
  consultant: [
    ['esg-profile', 7, true, 'الملف البيئي والاجتماعي (ESG)', 'ESG Profile'],
    ['reports', 8, true, 'التقارير', 'Reports'],
  ],
  client: [
    ['esg-profile', 7, true, 'الملف البيئي والاجتماعي (ESG)', 'ESG Profile'],
    ['reports', 8, true, 'التقارير', 'Reports'],
  ],
};

const asTuple = (row: Row) => [row[0], row[1], row[2], row[3], row[4]];

test('U3-B1 §3 matrix: exact present/absent, sidebar order and AR/EN label per context', () => {
  assert.deepEqual(CONTEXTS, ['platform', 'consultant', 'client', 'employee']);
  for (const context of CONTEXTS) {
    const actual = navPages(context).map((entry) =>
      asTuple([entry.id, entry.order, entry.menu, entry.label.ar, entry.label.en]));
    assert.deepEqual(actual, EXPECTED[context].map(asTuple), `${context}: §3 rows, order and labels`);
    // A menu row always carries a §3 sidebar number; a contextual target never does.
    for (const entry of navPages(context)) {
      assert.equal(entry.menu, entry.order !== null, `${context}/${entry.id}: menu <=> numbered row`);
    }
  }
});

test('U3-B1 §3: absent pages are denied by default and resolve to the landing', () => {
  for (const context of CONTEXTS) {
    const present = new Set(EXPECTED[context].map((row) => row[0]));
    const landing = landingFor(context);
    for (const id of PAGE_IDS) {
      if (present.has(id)) continue;
      assert.equal(isPageAllowed(context, id), false, `${context}/${id}: absent pages are never allowed`);
      const resolved = resolvePage(context, id);
      assert.deepEqual(resolved, { page: landing, redirected: true }, `${context}/${id}: forbidden tab -> landing`);
    }
    // The landing itself is always a real, mountable page of that context.
    assert.equal(isPageAllowed(context, landing), true, `${context}: landing is mountable`);
  }
});

test('U3-B1 §3: allowed pages resolve to themselves; pending/contextual-only pages never mount', () => {
  // TASK-PROTO-U3-B2 implements the last placeholder: nothing is pending now.
  assert.equal(PENDING_PAGE_IDS.length, 0, 'clients was the last pending page; B2 supplies it');
  for (const context of CONTEXTS) {
    const landing = landingFor(context);
    const entries = navPages(context);
    // §3 `target` rows are contextual only: P's client-detail needs an explicit
    // target; W/C carry the same ID as a normal sidebar row.
    const targetIds = entries.filter((entry) => entry.target).map((entry) => entry.id);
    assert.deepEqual(targetIds, context === 'platform' ? ['client-detail'] : [], `${context}: §3 target rows`);
    for (const entry of entries) {
      if (entry.target || PENDING_PAGE_IDS.includes(entry.id)) continue;
      assert.deepEqual(resolvePage(context, entry.id), { page: entry.id, redirected: false }, `${context}/${entry.id}: allowed`);
      assert.equal(isPageAllowed(context, entry.id), true);
    }
    if (context === 'platform') {
      // Present in the truthful matrix, but not mountable without a target.
      assert.deepEqual(resolvePage(context, 'client-detail'), { page: landing, redirected: true });
      assert.equal(isPageAllowed(context, 'client-detail'), false);
    }
    // §5: `clients` is P only and is now a real, mountable sidebar row (B2).
    if (context === 'platform') {
      assert.equal(pagesIn(context).includes('clients'), true, 'clients stays in the truthful matrix');
      assert.equal(menuPages(context).some((entry) => entry.id === 'clients'), true, 'clients is a rendered P row');
      assert.deepEqual(resolvePage(context, 'clients'), { page: 'clients', redirected: false });
      assert.equal(isPageAllowed(context, 'clients'), true);
    } else {
      assert.equal(pagesIn(context).includes('clients'), false, `${context}: clients is P only`);
      assert.equal(isPageAllowed(context, 'clients'), false);
      assert.deepEqual(resolvePage(context, 'clients'), { page: landing, redirected: true });
    }
  }
});

test('U3-B2 §2/§7 landings: P fresh login stays ge-overview; Exit/boot-exit lands clients', () => {
  assert.equal(landingFor('platform'), 'ge-overview', 'fresh P login lands GE Operations');
  assert.equal(workspaceExitLanding(), 'clients', 'Exit and reload/new-tab boot-exit land on Clients');
  assert.equal(isPageAllowed('platform', workspaceExitLanding()), true);
  // Exit is a P concept; C/E still land on their own context pages.
  assert.equal(landingFor('consultant'), 'dashboard');
  assert.equal(landingFor('client'), 'client-dashboard');
  assert.equal(landingFor('employee'), 'gap-analysis');
});

test('U3-B1 §3 aliases: W client-dashboard -> dashboard, C dashboard -> client-dashboard, no duplicates', () => {
  assert.equal(aliasOf('consultant', 'client-dashboard'), 'dashboard');
  assert.equal(aliasOf('client', 'dashboard'), 'client-dashboard');
  assert.equal(aliasOf('platform', 'dashboard'), null);
  assert.equal(aliasOf('employee', 'client-dashboard'), null);
  assert.deepEqual(resolvePage('consultant', 'client-dashboard'), { page: 'dashboard', redirected: true });
  assert.deepEqual(resolvePage('client', 'dashboard'), { page: 'client-dashboard', redirected: true });
  // The alias target is the one highlight: each menu lists the target, never both.
  for (const context of ['consultant', 'client'] as const) {
    const ids = pagesIn(context);
    assert.equal(ids.filter((id) => id === 'dashboard' || id === 'client-dashboard').length, 1, context);
  }
  // Cross-context aliases are never broadened: W has no client-dashboard page.
  assert.deepEqual(resolvePage('consultant', 'dashboard'), { page: 'dashboard', redirected: false });
});

test('U3-B1 §2 landings: P ge-overview (until B2), W dashboard, C client-dashboard, E gap-analysis', () => {
  assert.equal(landingFor('platform'), 'ge-overview');
  assert.equal(landingFor('consultant'), 'dashboard');
  assert.equal(landingFor('client'), 'client-dashboard');
  assert.equal(landingFor('employee'), 'gap-analysis');
  for (const context of CONTEXTS) {
    assert.deepEqual(resolvePage(context, null), { page: landingFor(context), redirected: false }, context);
  }
});

test('U3-B1 §3 conditionals: esg-profile/reports only when the capability set names them', () => {
  for (const context of ['consultant', 'client'] as const) {
    // Default: NOTHING proves the linked-service entitlement -> OMIT both.
    const denied = pagesIn(context);
    for (const row of CONDITIONAL[context]) {
      assert.equal(denied.includes(row[0]), false, `${context}/${row[0]}: omitted by default`);
      assert.equal(isPageAllowed(context, row[0]), false);
      assert.deepEqual(resolvePage(context, row[0]), { page: landingFor(context), redirected: true });
      assert.equal(menuPages(context).some((entry) => entry.id === row[0]), false);
    }
    // A server-reported capability naming the page proves it: then it is present
    // at its §3 position with its §3 label.
    const withCaps = navPages(context, ['esg-profile', 'reports']);
    const conditionalRows = withCaps.filter((entry) => entry.id === 'esg-profile' || entry.id === 'reports');
    assert.deepEqual(conditionalRows.map((entry) =>
      asTuple([entry.id, entry.order, entry.menu, entry.label.ar, entry.label.en])),
    CONDITIONAL[context].map(asTuple), `${context}: proven conditionals keep §3 order`);
    assert.deepEqual(resolvePage(context, 'reports', ['reports']), { page: 'reports', redirected: false });
    assert.equal(isPageAllowed(context, 'esg-profile', ['reports']), false, `${context}: proof is per page`);
    // Unknown capability tokens prove nothing.
    assert.equal(isPageAllowed(context, 'reports', ['something-else']), false);
  }
  // §3 gives P and E no `*` rows at all — capability noise never adds a page.
  assert.deepEqual(pagesIn('platform', ['esg-profile', 'reports']), EXPECTED.platform.map((row) => row[0]));
  assert.deepEqual(pagesIn('employee', ['esg-profile', 'reports']), ['gap-analysis']);
});

test('U3-B1 §3 E: exactly one work item, no dashboard/reports/notifications (so nothing to poll)', () => {
  assert.deepEqual(pagesIn('employee'), ['gap-analysis']);
  assert.deepEqual(menuPages('employee').map((entry) => entry.id), ['gap-analysis']);
  assert.equal(labelOf('gap-analysis', 'employee').en, 'My department disclosures');
  assert.equal(labelOf('gap-analysis', 'employee').ar, 'إفصاحات قسمي');
  assert.equal(isPageAllowed('employee', 'notifications'), false);
  assert.equal(isPageAllowed('employee', 'dashboard'), false);
});

test('U3-B1 §2 derivation: role + workspace tab mode (no URL, no storage, no guessed tenant)', () => {
  assert.equal(deriveNavContext('ge_admin', 'platform', false), 'platform');
  assert.equal(deriveNavContext('ge_admin', null, false), 'platform');
  assert.equal(deriveNavContext('ge_admin', 'consultant', true), 'consultant');
  // A consultant mode WITHOUT a bound client is not a W context (missing binding).
  assert.equal(deriveNavContext('ge_admin', 'consultant', false), 'platform');
  assert.equal(deriveNavContext('client_admin', null, false), 'client');
  assert.equal(deriveNavContext('employee', null, false), 'employee');
  assert.equal(deriveNavContext('unknown_role', null, false), null);
  assert.equal(deriveNavContext(null, null, false), null);
  assert.equal(deriveNavContext(undefined, 'consultant', true), null);
});

test('U3-B1 §2 identity: P/W/C/E label + exactly the one truthful name each owns', () => {
  assert.equal(identityLabelKey('platform'), 'platformAdmin');
  assert.equal(identityLabelKey('consultant'), 'consultantWorkspace');
  assert.equal(identityLabelKey('client'), 'company');
  assert.equal(identityLabelKey('employee'), 'department');
  const names = { clientName: 'Acme Ltd', companyName: 'Acme Ltd', departmentName: 'Legal' };
  assert.deepEqual(shellIdentity('platform', names), { labelKey: 'platformAdmin', value: null, secondary: null });
  assert.deepEqual(shellIdentity('consultant', names), { labelKey: 'consultantWorkspace', value: 'Acme Ltd', secondary: null });
  assert.deepEqual(shellIdentity('client', names), { labelKey: 'company', value: 'Acme Ltd', secondary: null });
  assert.deepEqual(shellIdentity('employee', names), { labelKey: 'department', value: 'Legal', secondary: 'Acme Ltd' });
  // No name is invented when the session/workspace did not supply it.
  assert.deepEqual(shellIdentity('consultant', {}), { labelKey: 'consultantWorkspace', value: null, secondary: null });
  assert.deepEqual(shellIdentity('client', {}), { labelKey: 'company', value: null, secondary: null });
});

/** A minimally valid AccessContext per mode, so permittedPages() answers. */
function accessFor(context: NavContext): AccessContext {
  const base = { actorId: 'actor', sessionId: 'session', capability: 'test' };
  if (context === 'platform') {
    return { ...base, role: 'ge_admin', mode: 'platform', tenantId: null, departmentId: null, tabId: 'tab', generation: 3 };
  }
  if (context === 'consultant') {
    return { ...base, role: 'ge_admin', mode: 'consultant', tenantId: 'tenant', departmentId: null, tabId: 'tab', generation: 3 };
  }
  if (context === 'client') {
    return { ...base, role: 'client_admin', mode: 'client', tenantId: 'tenant', departmentId: null, tabId: null, generation: null };
  }
  return { ...base, role: 'employee', mode: 'employee', tenantId: 'tenant', departmentId: 'dept', tabId: null, generation: null };
}

test('U3-B1 nav model never exceeds the approved server page sets (default capabilities)', () => {
  for (const context of CONTEXTS) {
    const server = new Set(permittedPages(accessFor(context)));
    for (const id of pagesIn(context)) {
      assert.ok(server.has(id), `${context}/${id}: presented page missing from the server-approved set`);
    }
  }
  // P and E are exact (no conditional rows, and P's contextual target is server-listed too).
  const sorted = (ids: readonly string[]) => [...ids].sort();
  assert.deepEqual(sorted(pagesIn('platform')), sorted(permittedPages(accessFor('platform'))));
  assert.deepEqual(sorted(pagesIn('employee')), sorted(permittedPages(accessFor('employee'))));
  // W/C withhold exactly the two unproven `*` rows; the server's alias-shaped
  // equivalents (client-dashboard in W) are alias-only in the UI, not pages.
  for (const context of ['consultant', 'client'] as const) {
    const withheld = permittedPages(accessFor(context)).filter((id) => !pagesIn(context).includes(id as PageId));
    for (const id of withheld) {
      const aliasShaped = (context === 'consultant' && id === 'client-dashboard')
        || (context === 'client' && id === 'dashboard');
      assert.ok(aliasShaped || id === 'esg-profile' || id === 'reports', `${context}: unexpected withheld page ${id}`);
    }
    assert.ok(withheld.includes('esg-profile') && withheld.includes('reports'), `${context}: conditionals withheld`);
  }
});

test('U3-B1 shell wiring: App mounts only the resolved page; Sidebar renders the model; E never polls', () => {
  const app = readFileSync(path.resolve('src/App.tsx'), 'utf8');
  const sidebar = readFileSync(path.resolve('src/components/Sidebar.tsx'), 'utf8');
  const header = readFileSync(path.resolve('src/components/Header.tsx'), 'utf8');
  // The mount decision is resolvePage(context, activeTab) — never raw activeTab.
  assert.match(app, /resolvePage\(context, activeTab\)/);
  assert.match(app, /renderView\(currentPage\)/);
  // No view is chosen from the RAW requested tab. The single raw-tab comparison
  // allowed is the §3 P redirect (client-detail without an explicit target), and
  // it must carry the `!clientConfig` guard.
  assert.doesNotMatch(app,
    /activeTab\s*===\s*'(dashboard|standards|gap-analysis|actions|initiatives|esg-profile|reports|import-gri|settings|staff-lists|audit-log|notifications|ge-overview|clients|client-dashboard)'/,
    'views must not be rendered from the raw requested tab');
  assert.match(app, /activeTab === 'client-detail' && !clientConfig/);
  // Every implemented page has exactly one mount branch.
  for (const id of PAGE_IDS.filter((page) => !PENDING_PAGE_IDS.includes(page))) {
    assert.match(app, new RegExp(`case '${id}':`), `App: missing mount branch for ${id}`);
  }
  // Sidebar rows come from the model, and polling excludes the employee context.
  assert.match(sidebar, /menuPages\(context\)/);
  assert.match(sidebar, /context !== 'employee'/);
  assert.doesNotMatch(sidebar, /Enterprise Level|Unrestricted/);
  // Header carries the same context identity; TASK-PROTO-U3-B2 adds the W-only
  // exit control (never hover-only) and keeps the db pill P-only.
  assert.match(header, /shellIdentity\(context/);
  assert.match(header, /context === 'consultant'[\s\S]*?exitToClients/, 'W carries the Exit control');
  assert.match(header, /context === 'platform' && \(/, 'db diagnostics are behind a P-only guard');
  assert.match(header, /connectionLabel/);
  assert.doesNotMatch(header, /PostgreSQL RLS|RLS proven/);
  assert.doesNotMatch(header, /hidden sm:inline/, 'F4: the client title wraps instead of being hidden');
  // App gates every protected render on the workspace lifecycle phase (B1-01).
  assert.match(app, /workspacePhase !== 'idle'/);
  assert.match(app, /workspacePhase === 'failed'/);
  assert.match(app, /workspacePhase === 'opening'/);
  assert.match(app, /workspacePhase === 'closing'/);
  // Clients is mounted and Configure stays a Clients sub-state.
  assert.match(app, /case 'clients':/);
  assert.match(app, /<ClientsView/);
  assert.match(app, /workspaceExitLanding\(\)/);
  // §7 boot landing: fresh login → ge-overview, reload/exited W → clients.
  assert.match(app, /bootLanding/);
  assert.match(app, /setActiveTab\(bootLanding\)/);
  const auth = readFileSync(path.resolve('src/context/AuthContext.tsx'), 'utf8');
  assert.match(auth, /setBootLanding\(workspaceExitLanding\(\)\)/);
  assert.match(auth, /runBootWorkspace/);
  assert.match(auth, /enterVerified/);
  assert.match(auth, /exitVerified/);
  assert.match(auth, /recoverWorkspace/);
});
