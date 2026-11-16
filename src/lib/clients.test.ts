/**
 * TASK-PROTO-U3-B2 §1/§3/§5 evidence — the P Clients page.
 *
 * Proves the §5 progress math/fallbacks, the search epoch (stale responses are
 * rejected), badge truth (unknown ≠ Active), the forbidden-CTA removals and the
 * P-only diagnostics gate. Pure helpers are imported from the real view module;
 * the JSX itself is pinned against its source so a silent regression fails here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  INITIAL_QUERY,
  beginQuery,
  isCurrentQuery,
  isUnmapped,
  readCount,
  readProgress,
  readStatus,
  type ClientServiceProgress,
} from '../views/ClientsView.tsx';
import { clientDetailMode, resolveTargetClientId } from '../views/ClientDetailView.tsx';
import { isPageAllowed, type NavContext } from './navModel.ts';

const source = (file: string) => readFileSync(path.resolve(file), 'utf8');

const service = (overrides: Partial<ClientServiceProgress> = {}): ClientServiceProgress => ({
  id: 'svc-1',
  code: 'GRI',
  name: 'GRI Reporting',
  mappedItemCount: 10,
  assignedPairCount: 4,
  submittedPairCount: 1,
  pendingPairCount: 3,
  frozenPairCount: 2,
  unmapped: false,
  ...overrides,
});

test('U3-B2 §5 badge truth: false=Active, true=Suspended, anything else is unknown (never Active)', () => {
  assert.equal(readStatus({ suspended: false }), 'active');
  assert.equal(readStatus({ suspended: true }), 'suspended');
  for (const missing of [undefined, null, 0, 1, 'false', 'true', {}, []]) {
    assert.equal(readStatus({ suspended: missing }), 'unknown', `suspended=${String(missing)} is not Active`);
    assert.equal(readStatus({}), 'unknown');
  }
});

test('U3-B2 §5 counts: only finite non-negative numbers are usable; everything else is unavailable', () => {
  assert.equal(readCount(0), 0);
  assert.equal(readCount(7), 7);
  for (const missing of [undefined, null, '7', -1, 1.5, NaN, Infinity, {}, []]) {
    assert.equal(readCount(missing), null, `count ${String(missing)} must be unavailable`);
  }
});

test('U3-B2 §5 progress: zero assignments → null percentage (never 0%/100%) and no frozen fraction', () => {
  const progress = readProgress(service({
    mappedItemCount: 5, assignedPairCount: 0, submittedPairCount: 0, pendingPairCount: 0, frozenPairCount: 0,
  }));
  assert.deepEqual(progress, { mapped: 5, assigned: 0, submitted: 0, pending: 0, frozen: 0, percent: null });
});

test('U3-B2 §5 progress: mixed freeze is a real fraction, not a service-wide badge', () => {
  const progress = readProgress(service());
  assert.equal(progress.assigned, 4);
  assert.equal(progress.submitted, 1);
  assert.equal(progress.pending, 3);
  assert.equal(progress.frozen, 2);
  assert.equal(progress.percent, 25);
  // Partial freeze on a different pair mix.
  assert.equal(readProgress(service({ assignedPairCount: 7, submittedPairCount: 5, pendingPairCount: 2, frozenPairCount: 3 })).percent, 71);
});

test('U3-B2 §5 progress: missing counts are unavailable, never zeros', () => {
  const progress = readProgress({ id: 's', code: 'C', name: 'N', assignedPairCount: 3 } as ClientServiceProgress);
  assert.deepEqual(progress, { mapped: null, assigned: 3, submitted: null, pending: null, frozen: null, percent: null });
  // A missing denominator makes the percentage unknowable even when submitted exists.
  const noAssigned = readProgress({ id: 's', code: 'C', name: 'N', submittedPairCount: 2 } as ClientServiceProgress);
  assert.equal(noAssigned.percent, null);
});

test('U3-B2 §5 unmapped: the per-service flag is surfaced separately from mapped-but-unassigned', () => {
  assert.equal(isUnmapped(service({ unmapped: true, mappedItemCount: 0 })), true);
  assert.equal(isUnmapped(service({ unmapped: false })), false);
  assert.equal(isUnmapped(service({ unmapped: 'yes' as unknown as boolean })), false);
  // mapped-but-unassigned is distinguishable: mapped > 0 AND assigned === 0.
  const mappedUnassigned = readProgress(service({ mappedItemCount: 9, assignedPairCount: 0, submittedPairCount: 0 }));
  assert.equal(mappedUnassigned.mapped, 9);
  assert.equal(mappedUnassigned.assigned, 0);
  assert.equal(mappedUnassigned.percent, null);
});

test('U3-B2 §5 search: Search/Clear each reissue a server query epoch; stale replies are rejected', () => {
  const first = beginQuery(INITIAL_QUERY, '  acme  ');
  assert.deepEqual(first, { applied: 'acme', requestId: 1 }, 'trimmed server search term');
  const cleared = beginQuery(first, '   ');
  assert.deepEqual(cleared, { applied: '', requestId: 2 }, 'Clear reissues an empty search');
  const second = beginQuery(cleared, 'beta');
  assert.equal(isCurrentQuery(second, second.requestId), true);
  assert.equal(isCurrentQuery(second, first.requestId), false, 'the acme reply is stale');
  assert.equal(isCurrentQuery(second, cleared.requestId), false, 'the cleared reply is stale');
});

test('U3-B2 §5 view wiring: server query only, epoch guard, confirmations, authoritative refetch', () => {
  const src = source('src/views/ClientsView.tsx');
  // Real server results for the exact term; no local filter/sort/pagination.
  assert.match(src, /apiFetch\(`\/api\/clients\$\{suffix\}`\)/);
  assert.match(src, /beginQuery\(queryRef\.current, search\)/);
  assert.match(src, /if \(!isCurrentQuery\(queryRef\.current, next\.requestId\)\) return;/);
  assert.match(src, /encodeURIComponent\(next\.applied\)/);
  // §5 confirmations name client + action, and refetch is authoritative.
  assert.match(src, /t\.clients\.suspendConfirm/);
  assert.match(src, /body: JSON\.stringify\(\{ suspended: nextSuspended \}\)/);
  assert.match(src, /await load\(queryRef\.current\.applied\)/);
  assert.match(src, /t\.clients\.enterConfirm/);
  // §5 fallbacks exist in the rendered output.
  assert.match(src, /t\.clients\.noAssignments/);
  assert.match(src, /t\.clients\.noLinkedServices/);
  assert.match(src, /t\.clients\.unmappedService/);
  assert.match(src, /t\.clients\.unavailable/);
  assert.match(src, /t\.clients\.statusUnknown/);
  // Semantic table: caption + column headers in §5 reading order.
  const order = ['colClient', 'colStatus', 'colServices', 'colActions']
    .map((key) => src.indexOf(`t.clients.${key}`));
  assert.ok(order.every((index) => index > 0), 'all four §5 columns are rendered');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'columns follow §5 order');
  assert.match(src, /<caption/);
  assert.match(src, /aria-live="polite"/);
  // Actions are always-visible wrapping buttons, never hover-only.
  assert.match(src, /whitespace-normal/);
  assert.doesNotMatch(src, /group-hover:|opacity-0/);
});

test('U3-B2 §3 F3: forbidden CTAs are gone from every non-permitted context view', () => {
  // DashboardView is the W workspace: no Import-GRI, no Settings shortcut.
  const dashboard = source('src/views/DashboardView.tsx');
  assert.doesNotMatch(dashboard, /'import-gri'/);
  assert.doesNotMatch(dashboard, /setActiveTab\('settings'\)/);
  // GapAnalysis (W/C/E) and Standards (W/C) have no `import-gri` page.
  assert.doesNotMatch(source('src/views/GapAnalysisView.tsx'), /'import-gri'/);
  assert.doesNotMatch(source('src/views/StandardsView.tsx'), /'import-gri'/);
  // The overview is totals-only: no per-client suspend and no bulk-link shortcut.
  const overview = source('src/views/GeOverviewView.tsx');
  assert.doesNotMatch(overview, /link-all|linkAll|linkAllBtn/);
  assert.doesNotMatch(overview, /toggleSuspend|suspendBtn|aggregateScore/);
});

test('U3-B2 §3 B1-03: db/status polling + pill are P-only (C/E get no diagnostics)', () => {
  const app = source('src/App.tsx');
  assert.match(app, /if \(context !== 'platform' \|\| workspaceBlocked\)/, 'polling is gated to verified P');
  assert.match(app, /context !== 'platform'[\s\S]{0,220}?setInterval\(checkDb/, 'no interval outside platform');
  const header = source('src/components/Header.tsx');
  assert.match(header, /context === 'platform' && \(/);
  assert.doesNotMatch(header, /PostgreSQL RLS|RLS proven/);
  assert.match(header, /t\.common\.checking/, 'unknown status is Checking, never a false Connected');
});

test('U3-B2 §1/§2 i18n: every new key exists in the interface + EN + AR', () => {
  const i18n = source('src/i18n/translations.ts');
  for (const key of [
    'searchLabel', 'clearSearch', 'colClient', 'colStatus', 'colServices', 'colActions',
    'active', 'suspended', 'statusUnknown', 'noAssignments', 'unmappedService',
    'noLinkedServices', 'unavailable', 'mappedItems', 'collection', 'pendingSubmission',
    'frozenPairs', 'enterWorkspace', 'configureClient', 'enterConfirm', 'suspendConfirm',
  ]) {
    assert.equal((i18n.match(new RegExp(`\\b${key}:`, 'g')) ?? []).length, 3, `${key}: interface + EN + AR`);
  }
  for (const key of ['opening', 'closing', 'confirmFailed', 'confirmFailedDesc', 'exitToClients', 'clientSuspended', 'backToClients', 'configureTitle']) {
    assert.equal((i18n.match(new RegExp(`\\b${key}:`, 'g')) ?? []).length, 3, `${key}: interface + EN + AR`);
  }
  // `checking` is a shared word (pre-existing settings keys), so it is pinned at
  // its call site instead: the P→W transition screen and the db pill.
  assert.match(source('src/App.tsx'), /t\.workspace\.checking/);
  assert.match(source('src/components/Header.tsx'), /t\.common\.checking/);
});

// --- TASK-PROTO-U3-B2 R1/R2 (round 2) --------------------------------------

test('U3-B2 R1a target resolution: P requires explicit T, W/C use verified context', () => {
  const base = {
    explicitClientId: 'explicit-1',
    workspaceMode: 'platform' as const,
    workspaceClientId: null,
    sessionClientId: 'session-1',
  };
  // P: the explicit target only.
  assert.equal(resolveTargetClientId({ ...base, role: 'ge_admin' }), 'explicit-1');
  assert.equal(resolveTargetClientId({ ...base, role: 'ge_admin', explicitClientId: null }), null);
  assert.equal(resolveTargetClientId({ ...base, role: 'ge_admin', explicitClientId: '' }), null);
  // W: the workspace envelope's client, never the explicit prop or a first row.
  assert.equal(resolveTargetClientId({
    ...base, role: 'ge_admin', workspaceMode: 'consultant', workspaceClientId: 'workspace-1',
  }), 'workspace-1');
  assert.equal(resolveTargetClientId({
    ...base, role: 'ge_admin', workspaceMode: 'consultant', workspaceClientId: null,
  }), null, 'W without a bound client never falls back');
  // C: the session's own company, ignoring any explicit prop.
  assert.equal(resolveTargetClientId({ ...base, role: 'client_admin' }), 'session-1');
  assert.equal(resolveTargetClientId({ ...base, role: 'client_admin', sessionClientId: null }), null);
  // E / unknown: no client-detail page.
  assert.equal(resolveTargetClientId({ ...base, role: 'employee' }), null);
  assert.equal(resolveTargetClientId({ ...base, role: null }), null);
});

test('U3-B2 R1b ClientDetail: selector and client-list lookup are gone; handlers unchanged', () => {
  const src = source('src/views/ClientDetailView.tsx');
  assert.doesNotMatch(src, /fetchTenants|setTenants|tenants\.map|setSelected|selectTenant/);
  assert.doesNotMatch(src, /apiFetch\('\/api\/clients'/, 'no client-list lookup request');
  assert.doesNotMatch(src, /<select[\s\S]{0,400}?suspended/);
  assert.match(src, /resolveTargetClientId\(/);
  assert.match(src, /if \(!selected\) return null/, 'P without a target renders nothing');
  // Every existing handler is preserved (no behaviour change beyond the target).
  // M2 removes only the suspend handler (§5: suspend lives on Clients alone).
  for (const handler of ['handleLink', 'handleUnlink', 'handleSaveFlags',
    'handleAssign', 'handleUnassign', 'handleNa', 'handleSetHead']) {
    assert.match(src, new RegExp(`const ${handler} =`), `${handler} preserved`);
  }
  assert.doesNotMatch(src, /const handleSuspend =/);
});

test('U3-B2 R1a/M1 App routes P without a target to Clients (no first-client mount)', () => {
  const app = source('src/App.tsx');
  // The detour is part of the ONE shell resolver, not a raw-tab effect.
  assert.match(app, /resolveShellPage\(\{/);
  assert.match(app, /hasConfigTarget: Boolean\(clientConfig\)/);
  assert.match(app, /case 'client-detail':[\s\S]{0,220}?context === 'platform' \? null : <ClientDetailView/);
  assert.match(app, /<ClientDetailView key=\{clientConfig\.id\} clientId=\{clientConfig\.id\} \/>/);
});

test('U3-B2 R2 refreshUser: the only view caller is P-only Settings (no W/C boot-exit)', () => {
  const views = readdirSync(path.resolve('src/views')).filter((file) => file.endsWith('.tsx'));
  const callers = views.filter((file) => source(`src/views/${file}`).includes('refreshUser('));
  assert.deepEqual(callers, ['SettingsView.tsx'], 'enumerated: only the P Settings view re-reads the session');
  // Settings is a P page in the ONE nav model, so no W/C action can reach it.
  assert.equal(isPageAllowed('platform', 'settings'), true);
  for (const context of ['consultant', 'client', 'employee'] as NavContext[]) {
    assert.equal(isPageAllowed(context, 'settings'), false, `${context} has no Settings page`);
  }
  // App's own refreshUser call is the forced-change gate, which runs before any
  // shell context exists (ge_admin boot at most; C/E boot never exits).
  assert.match(source('src/App.tsx'), /await refreshUser\(\)/);
});

// --- TASK-PROTO-U3-B2 round 3 (M2/M5) --------------------------------------

test('U3-B2 M2 editor mode is the platform MODE, not role=ge_admin (W is read-only)', () => {
  // Platform context: editors + catalogs, roster shown.
  assert.deepEqual(clientDetailMode({ role: 'ge_admin', workspaceMode: 'platform' }),
    { canEdit: true, showUsers: true, fetchCatalogs: true });
  assert.deepEqual(clientDetailMode({ role: 'ge_admin', workspaceMode: null }),
    { canEdit: true, showUsers: true, fetchCatalogs: true }, 'P before the mirror settles is still P');
  // Consultant (the actor is ALSO ge_admin): zero editors, zero catalogs, no roster.
  assert.deepEqual(clientDetailMode({ role: 'ge_admin', workspaceMode: 'consultant' }),
    { canEdit: false, showUsers: false, fetchCatalogs: false });
  // C: own-company read-only; roster stays. E/unknown: nothing.
  assert.deepEqual(clientDetailMode({ role: 'client_admin', workspaceMode: null }),
    { canEdit: false, showUsers: true, fetchCatalogs: false });
  assert.deepEqual(clientDetailMode({ role: 'employee', workspaceMode: 'consultant' }),
    { canEdit: false, showUsers: false, fetchCatalogs: false });
  assert.deepEqual(clientDetailMode({ role: null, workspaceMode: null }),
    { canEdit: false, showUsers: false, fetchCatalogs: false });
});

test('U3-B2 M2 source: every editor subtree is platform-gated; suspend panel removed', () => {
  const src = source('src/views/ClientDetailView.tsx');
  assert.doesNotMatch(src, /isGe|handleSuspend|suspendTitle|suspendedNote/);
  // Editors: unlink, flags, link service, assign form, unassign, N/A, head controls.
  assert.ok((src.match(/\{canEdit &&/g) ?? []).length >= 8, 'editor subtrees gated on canEdit');
  assert.match(src, /\{!canEdit && \(/, 'read-only note for non-platform contexts');
  assert.match(src, /\{mode\.showUsers && \(/, 'roster is never rendered in W');
  assert.match(src, /if \(mode\.fetchCatalogs\) fetchCatalogs\(\);/, 'catalog fetch gated');
  assert.match(src, /if \(!selected\) return null/);
});

test('U3-B2 M5: success only after the authoritative refetch; binding copy', () => {
  const clients = source('src/views/ClientsView.tsx');
  assert.match(clients, /await load\(queryRef\.current\.applied\);[\s\S]{0,80}?setNotice\(outcome\)/);
  const i18n = source('src/i18n/translations.ts');
  assert.match(i18n, /emptyTitle: 'لا يوجد عملاء'/);
  assert.doesNotMatch(i18n, /emptyTitle: 'لا يوجد عملاء بعد'/);
  assert.match(i18n, /connected: 'Connected'/);
  assert.match(i18n, /connected: 'متصل'/);
  assert.match(i18n, /disconnected: 'غير متصل'/);
  const header = source('src/components/Header.tsx');
  assert.match(header, /t\.common\.connected/);
  assert.match(header, /t\.common\.disconnected/);
  assert.doesNotMatch(header, /t\.settings\.connected|t\.settings\.disconnected/);
});
