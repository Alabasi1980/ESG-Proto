/**
 * TASK-PROTO-U4-2 §4 evidence — behavioural proof of the services workspace.
 *
 * The pure helpers are exported by the view itself (the screen owns its own
 * projection rules; no new lib module was authorized), so these tests exercise
 * the exact functions the rail/workspace call at render time.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  SERVICE_TABS, buildContent, contentStatus, countsForService, eligibleClients,
  filterServices, friendlyError, tabsFor,
} from '../views/ServicesView.tsx';
import {
  draftIsDirty, filterStandardNodes, matches, type ItemPatch, type ItemRow, type StandardNode,
} from '../components/services/ServiceContentPanel.tsx';
import { labelOf } from './navModel.ts';
import type { ServiceRow } from '../components/services/ServiceRail.tsx';

const source = (file: string) => readFileSync(path.resolve(file), 'utf8');

const item = (over: Partial<ItemRow> & { id: string; disclosure_id: string; code: string }): ItemRow => ({
  requirement: `Requirement ${over.code}`, answer_type: 'text', hint: null, priority: 'mid', esg_class: 'general',
  weight: 2, objective: null, topic: null, reference: null, attachment_required: false, ...over,
});

const service = (over: Partial<ServiceRow> & { id: string }): ServiceRow => ({
  code: 'SVC-1', name: 'الخدمة الأولى', description: null,
  standards: [{ id: 'std-2', code: 'GRI 2', title: 'General Disclosures' }], ...over,
});

const disclosure = (id: string, standardId: string, code: string, title: string) =>
  ({ id, standard_id: standardId, code, title, description: null });

test('U4-2-FIX P5 §UI-1 tab gating: the four tabs exist in contract order and only with a service', () => {
  assert.deepEqual([...SERVICE_TABS], ['overview', 'content', 'settings', 'import']);
  assert.deepEqual(tabsFor(null), [], 'no service → no tabs (workspace shows its empty state)');
  assert.deepEqual(tabsFor('svc-1'), [...SERVICE_TABS]);
  // The workspace render is gated on the resolved service, never on a raw id.
  const view = source('src/views/ServicesView.tsx');
  assert.match(view, /\{!service \? \(/);
  assert.match(view, /tabsFor\(service\.id\)\.map/);
  assert.match(view, /role="tab"/);
  assert.match(view, /aria-selected=\{tab === key\}/);
});

test('U4-2 §2 rail search: AR/EN name, code and description match case-insensitively', () => {
  const rows = [
    service({ id: 'a', name: 'الخدمات البيئية', code: 'ENV-1' }),
    service({ id: 'b', name: 'Social services', code: 'SOC-1', description: 'community' }),
  ];
  assert.deepEqual(filterServices(rows, '').map((r) => r.id), ['a', 'b']);
  assert.deepEqual(filterServices(rows, '  بيئية ').map((r) => r.id), ['a']);
  assert.deepEqual(filterServices(rows, 'soc').map((r) => r.id), ['b']);
  assert.deepEqual(filterServices(rows, 'COMMUNITY').map((r) => r.id), ['b']);
  assert.deepEqual(filterServices(rows, 'zzz'), []);
  // matches() is field-agnostic and ignores absent/null fields.
  assert.equal(matches('', 'x'), true);
  assert.equal(matches('gri', 'GRI 2', null, undefined), true);
  assert.equal(matches('gri', null, undefined), false);
});

test('U4-2 §2 drill counters: only the linked standards/disclosures/items are counted', () => {
  const rows = [
    disclosure('d1', 'std-2', '2-1', 'Organizational details'),
    disclosure('d2', 'std-2', '2-6', 'Activities'),
    disclosure('d3', 'std-9', '305-1', 'Emissions (unlinked standard)'),
  ];
  const items = [
    item({ id: 'i1', disclosure_id: 'd1', code: '2-1-a' }),
    item({ id: 'i2', disclosure_id: 'd1', code: '2-1-b' }),
    item({ id: 'i3', disclosure_id: 'd3', code: '305-1-a' }),
  ];
  const svc = service({ id: 'svc', standards: [{ id: 'std-2', code: 'GRI 2', title: 'General Disclosures' }] });
  const tree = buildContent(svc, rows, items);
  assert.deepEqual(tree.map((n) => n.code), ['GRI 2'], 'unlinked standards never appear');
  assert.deepEqual(tree[0].disclosures.map((d) => d.code), ['2-1', '2-6']);
  assert.equal(tree[0].disclosures[0].items.length, 2);
  assert.deepEqual(countsForService(svc, tree), { standards: 1, disclosures: 2, items: 2 });
  assert.equal(contentStatus(countsForService(svc, tree)), 'ready');
});

test('U4-2 §2 honest empty counters: a service with no linked content is empty, not ready', () => {
  const svc = service({ id: 'empty', standards: [] });
  const tree = buildContent(svc, [disclosure('d1', 'std-2', '2-1', 'x')], [item({ id: 'i1', disclosure_id: 'd1', code: 'c1' })]);
  assert.deepEqual(tree, []);
  assert.deepEqual(countsForService(svc, tree), { standards: 0, disclosures: 0, items: 0 });
  assert.equal(contentStatus(countsForService(svc, tree)), 'empty');
});

test('U4-2 §2 level search: standards filter by code/title and never cross a level', () => {
  const tree: StandardNode[] = [
    { id: 's1', code: 'GRI 2', title: 'General Disclosures', disclosures: [] },
    { id: 's2', code: 'GRI 305', title: 'Emissions', disclosures: [] },
  ];
  assert.equal(filterStandardNodes(tree, '').length, 2);
  assert.deepEqual(filterStandardNodes(tree, 'emiss').map((n) => n.id), ['s2']);
  assert.deepEqual(filterStandardNodes(tree, 'gri 2').map((n) => n.id), ['s1']);
  assert.deepEqual(filterStandardNodes(tree, 'nothing'), []);
});

test('U4-2 §2 overview: linked clients come from the real client→services projection', () => {
  const clients = [
    { id: 'c1', name: 'Acme', services: [{ id: 'svc' }, { id: 'other' }] },
    { id: 'c2', name: 'Beta', services: [{ id: 'other' }] },
    { id: 'c3', name: 'Gamma' },
  ];
  assert.deepEqual(eligibleClients(clients, 'svc'), [{ id: 'c1', name: 'Acme' }]);
  assert.deepEqual(eligibleClients(clients, null), [], 'no service → nobody is "linked"');
});

test('U4-2 R2 P2-07: the editor knows a pending draft, and a saved row looks clean', () => {
  const row = item({ id: 'i1', disclosure_id: 'd1', code: '2-1-a' });
  const base: ItemPatch = {
    requirement: row.requirement, hint: '', answerType: 'text', priority: 'mid',
    esgClass: 'general', objective: '', topic: '', reference: '',
  };
  assert.equal(draftIsDirty(row, base), false, 'an untouched draft is clean');
  assert.equal(draftIsDirty(row, { ...base, requirement: `${row.requirement} ` }), true);
  assert.equal(draftIsDirty(row, { ...base, hint: 'new hint' }), true);
  assert.equal(draftIsDirty(row, { ...base, answerType: 'number' }), true);
  // A stored hint/objective must be compared, not just the four visible fields.
  const stored = item({ id: 'i2', disclosure_id: 'd1', code: '2-1-b', hint: 'kept', objective: 'goal' });
  assert.equal(draftIsDirty(stored, { ...base, requirement: stored.requirement, hint: 'kept', objective: 'goal' }), false);
  assert.equal(draftIsDirty(stored, { ...base, requirement: stored.requirement, hint: 'kept', objective: '' }), true);
});

test('U4-2 R2 P2-08: a raw browser failure is replaced by the screen copy; server text survives', () => {
  assert.equal(friendlyError(new Error('Failed to fetch'), 'screen copy'), 'screen copy');
  assert.equal(friendlyError(new Error('NetworkError when attempting to fetch resource.'), 'screen copy'), 'screen copy');
  assert.equal(friendlyError(new TypeError('Load failed'), 'screen copy'), 'screen copy');
  assert.equal(friendlyError(undefined, 'screen copy'), 'screen copy');
  assert.equal(friendlyError(new Error('Service code is required.'), 'screen copy'), 'Service code is required.');
});

test('U4-2-FIX P5 R2 layout pins: sticky without a clipping ancestor, drawer panel, real tablist, P5 widths', () => {
  const view = source('src/views/ServicesView.tsx');
  // P1-01: the section can no longer clip the sticky header.
  assert.doesNotMatch(view, /className=\"[^\"]*overflow-hidden/);
  assert.match(view, /sticky top-0 z-20 bg-surface-2 border-b border-border rounded-t-2xl/);
  // P2-10: the rail badge receives the unfiltered total.
  assert.match(view, /total=\{services\.length\}/);
  // P2-11: every panel exists for aria-controls; roving tabindex + arrow keys.
  assert.match(view, /hidden=\{tab !== key\}/);
  assert.match(view, /id=\{`svc-panel-\$\{key\}`\}/);
  assert.match(view, /tabIndex=\{tab === key \? 0 : -1\}/);
  assert.match(view, /onKeyDown=\{onTabKey\}/);
  // P1-03: widths never fight a w-full base class again (P5: flex + min-widths).
  assert.match(view, /\$\{FIELD_CLS\} flex-1 min-w-40/);
  assert.match(view, /max-h-96/);
  // P1-05: the value cell stays RTL; code/date isolate LTR, localized text is
  // isolated by <bdi dir="ltr"> so a name can never flip the cell direction.
  assert.match(view, /<bdi dir="ltr">/);
  assert.match(view, /<bdi dir="ltr">\{service\?\.name\}<\/bdi>/);
  assert.doesNotMatch(view, /break-words" dir="auto">\{service\?\.name\}/);
  // Owner instruction: services management left Settings (single workspace).
  assert.doesNotMatch(source('src/views/SettingsView.tsx'), /ServicesManage/);
  // The P subtitle follows the service identity (Header micro-fix).
  assert.match(source('src/components/Header.tsx'), /t\.servicesWorkspace\.headerSubtitle/);
});

test('U4-2 R2 panel pins: drawer below xl, row highlight, dirty guard, confirm-before-unlink, edit icon', () => {
  const panel = source('src/components/services/ServiceContentPanel.tsx');
  // P1-02: a real drawer with a backdrop below xl; inline column from xl up.
  assert.match(panel, /fixed inset-y-0 end-0 z-50/);
  assert.match(panel, /2xl:static/);
  assert.match(panel, /2xl:hidden fixed inset-0/);
  assert.match(panel, /bg-black\/50/);
  assert.match(panel, /role="dialog" aria-modal="true"/);
  assert.match(panel, /focusables\(\)\[0\]\?\.focus\(\)/);
  assert.match(panel, /triggerRef\.current\.focus\(\)/);
  assert.match(panel, /panelMounted = Boolean\(selectedItemId && selectedItem && draft\)/);
  assert.match(panel, /2xl:grid-cols-\[minmax\(0,1fr\)_380px\]/);
  assert.match(panel, /addEventListener\('keydown', onKey\)/);
  // P1-02/P2-06: the open row is visibly selected and names its panel.
  assert.match(panel, /aria-controls=\{open \? 'svc-item-panel'/);
  assert.match(panel, /border-brand bg-brand-soft/);
  // P1-04: the requirement is fully readable (multi-row, auto direction).
  assert.match(panel, /rows=\{5\} dir="auto"/);
  assert.match(panel, /rows=\{3\} dir="auto"/);
  // P2-07/P2-14/P2-15: dirty guard, unlink confirmation, pencil (not save) icon.
  assert.match(panel, /s\.discardDraft/);
  assert.match(panel, /s\.unlinkStandardConfirm\.replace\('\{code\}'/);
  assert.match(panel, /Pencil className/);
  assert.doesNotMatch(panel, /<Save className="w-3\.5 h-3\.5" \/>\s*<\/button>\s*<\/div>\s*\)\)\}/);
});

test('U4-2-FIX P5 §3 wiring: catalog + service-scoped import endpoints only, apiFetch transport, P-only mount, label override', () => {
  const view = source('src/views/ServicesView.tsx');
  for (const path of ['/api/services', '/api/standards', '/api/disclosures', '/api/items', '/api/clients',
    '/api/departments?clientId=', '/api/import/preview', '/api/import/commit', '/import/template']) {
    assert.ok(view.includes(path), `missing existing endpoint: ${path}`);
  }
  assert.ok(!view.includes('/api/assignments'), 'Services surface performs no assignment writes (INV-DEF-APP)');
  assert.ok(!view.includes('/api/gri/preview') && !view.includes('/api/gri/commit'),
    'import binds the canonical /api/import/* paths, not the one-release /api/gri/* aliases');
  assert.ok(view.includes('/api/services/${service.id}/standards'), 'service↔standard link uses the existing route');
  assert.ok(view.includes('/api/services/${service.id}'), 'name/settings writes use PATCH /api/services/:id');
  assert.doesNotMatch(view, /(^|[^i])fetch\(/, 'all traffic goes through apiFetch (auth + workspace headers)');
  // P mounts the workspace on the existing `standards` id; W/C keep StandardsView.
  const app = source('src/App.tsx');
  assert.match(app, /context === 'platform' \? <ServicesView \/> : <StandardsView setActiveTab=\{setActiveTab\} \/>/);
  // Nav label moves for P only — W/C keep the GRI catalogue identity.
  assert.deepEqual(labelOf('standards', 'platform'), { ar: 'الخدمات', en: 'Services' });
  assert.deepEqual(labelOf('standards', 'consultant'), { ar: 'معايير GRI', en: 'GRI Standards' });
  assert.deepEqual(labelOf('standards', 'client'), { ar: 'معايير GRI', en: 'GRI Standards' });
});

test('U4-2 §3 i18n: every new workspace key exists in the interface, EN and AR', () => {
  const i18n = source('src/i18n/translations.ts');
  for (const key of ['tabOverview', 'tabContent', 'tabRules', 'tabSettings', 'tabImport',
    'attachmentRequired', 'attachmentNotRequired', 'selectedCount', 'bulkAssign',
    'settingsInvalid', 'fieldRequired', 'importConfirm', 'importDone',
    'workspaceLoadFailed', 'dirtyDraft', 'discardDraft', 'unlinkStandardConfirm', 'rulesShownOf', 'headerSubtitle']) {
    assert.equal((i18n.match(new RegExp(`\\b${key}:`, 'g')) ?? []).length, 3, `${key}: interface + EN + AR`);
  }
});
