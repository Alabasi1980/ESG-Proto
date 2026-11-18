// TASK-PROTO-U4-2-FIX P5 — Services screen correction (no DB, no DOM).
//
// Behavioral pins for the P-only screen over the P1→P4 APIs as built: four
// tabs (Rules deleted, JSON editor deleted), flexible content tree
// (standards → disclosures → items + groups + direct items, details never a
// tree level), full CRUD wiring, bulk-edit subset, history drawer, named
// settings closed set, service-scoped import with mapping + row errors and
// no client anywhere. DG-04 reopened state is status-only (counts, never
// invented copy). E-1…E-9 live-handler proof stays UNVERIFIED here (reads
// only, no live mutations); the unit halves (tree split, counts, mapping,
// conflict/version plumbing) are pinned below.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  SERVICE_TABS,
  tabsFor,
  friendlyError,
  isFrozenRefusal,
  filterServices,
  countsForService,
  buildContent,
  contentStatus,
  eligibleClients,
  isGroupCategory,
  isGeneralStandard,
  suggestedGroupStandardCode,
  buildFlexibleContent,
  flexibleCounts,
  splitArchived,
  reopenedCount,
  IMPORT_CANONICAL_COLUMNS,
  splitCsvLine,
  autoMapColumns,
} from '../views/ServicesView.tsx';
// W-P5-01: the named-settings closed set moved with the settings tab into
// ServiceSettingsPanel (pure move); behavioral pins follow the units.
import {
  NAMED_SETTINGS_KEYS,
  DEFAULT_NAMED_SETTINGS,
} from '../components/services/ServiceSettingsPanel.tsx';
import {
  matches,
  filterStandardNodes,
  draftIsDirty,
  historyReopenedCount,
  ANSWER_TYPES,
  PRIORITIES,
  ESG_CLASSES,
  type ItemPatch,
  type ItemRow,
  type StandardNode,
} from '../components/services/ServiceContentPanel.tsx';
import type { ServiceRow } from '../components/services/ServiceRail.tsx';

const source = (file: string) => readFileSync(path.resolve(file), 'utf8');
const view = () => source('src/views/ServicesView.tsx');
const panel = () => source('src/components/services/ServiceContentPanel.tsx');
const settingsPanel = () => source('src/components/services/ServiceSettingsPanel.tsx');

const row = (over: Partial<ServiceRow> & { id: string }): ServiceRow => ({
  code: 'SVC-1', name: 'الخدمة الأولى', description: null,
  standards: [{ id: 'std-1', code: 'GRI 2', title: 'General Disclosures' }],
  ...over,
});

const item = (over: Partial<ItemRow> & { id: string; disclosure_id: string; code: string }): ItemRow => ({
  requirement: `Requirement ${over.code}`, answer_type: 'text', hint: null, priority: 'mid',
  esg_class: 'general', weight: 2, objective: null, topic: null, reference: null,
  attachment_required: false, ...over,
});

const disclosure = (id: string, standardId: string, code: string, title = `Title ${code}`) =>
  ({ id, standard_id: standardId, code, title, description: null });

// --- P5 UI-1: four tabs, Rules deleted, JSON editor deleted ---

test('P5 UI-1: tabs are overview·content·settings·import only (no Rules)', () => {
  assert.deepEqual([...SERVICE_TABS], ['overview', 'content', 'settings', 'import']);
  assert.deepEqual(tabsFor(null), [], 'no service → no tabs (workspace empty state)');
  assert.deepEqual(tabsFor('svc-1'), [...SERVICE_TABS]);
  assert.doesNotMatch(view(), /\bs\.tabRules\b/, 'Rules tab copy is unreachable from the screen');
  assert.doesNotMatch(view(), /\bs\.jsonSettingsTitle\b/, 'raw JSON editor copy is unreachable from the view');
  assert.doesNotMatch(settingsPanel(), /\bs\.jsonSettingsTitle\b/, 'raw JSON editor copy is unreachable from the settings panel');
  assert.doesNotMatch(view(), /\bs\.rulesScope\b/, 'Rules scope copy is unreachable');
  assert.doesNotMatch(panel(), /\bs\.bulkClient\b/, 'no client control in the bulk bar');
  assert.doesNotMatch(panel(), /\bs\.bulkDepartment\b/, 'no department control in the bulk bar');
  assert.doesNotMatch(view(), /\bs\.importTarget\b/, 'no client picker on the import path');
  assert.doesNotMatch(view(), /\bs\.importNoClient\b/, 'no client-required import copy');
  assert.doesNotMatch(view(), /\/api\/assignments/, 'Services surface performs no assignment writes');
});

// --- P5 friendly errors + frozen-scope refusal ---

test('P5 UI-4: friendlyError + isFrozenRefusal (reactive frozen banner source)', () => {
  assert.equal(friendlyError(new Error('Failed to fetch'), 'copy'), 'copy');
  assert.equal(friendlyError(new Error('NetworkError when attempting to fetch resource.'), 'copy'), 'copy');
  assert.equal(friendlyError(new TypeError('Load failed'), 'copy'), 'copy');
  assert.equal(friendlyError(undefined, 'copy'), 'copy');
  assert.equal(friendlyError(new Error('Service code is required.'), 'copy'), 'Service code is required.');
  assert.equal(isFrozenRefusal({ code: 'FROZEN_SCOPE' }), true);
  assert.equal(isFrozenRefusal({ error: 'Write refused: FROZEN_SCOPE' }), true);
  assert.equal(isFrozenRefusal({ error: 'frozen by GE final snapshot' }), true);
  assert.equal(isFrozenRefusal({ error: 'Something else' }), false);
  assert.equal(isFrozenRefusal(null), false);
  assert.match(view(), /s\.frozenScopeBanner/, 'frozen banner copy is wired');
});

// --- P5 rail: search + counts ---

test('P5 rail: filterServices matches AR/EN name, code and description', () => {
  const rows = [
    row({ id: 'a', name: 'الخدمات البيئية', code: 'ENV-1' }),
    row({ id: 'b', name: 'Social services', code: 'SOC-1', description: 'community' }),
  ];
  assert.deepEqual(filterServices(rows, '').map((r) => r.id), ['a', 'b']);
  assert.deepEqual(filterServices(rows, '  بيئية ').map((r) => r.id), ['a']);
  assert.deepEqual(filterServices(rows, 'soc').map((r) => r.id), ['b']);
  assert.deepEqual(filterServices(rows, 'COMMUNITY').map((r) => r.id), ['b']);
  assert.deepEqual(filterServices(rows, 'zzz'), []);
  assert.equal(matches('  بيئية ', 'الخدمات البيئية'), true);
  assert.equal(matches('', null, undefined), true);
  assert.equal(matches('x', null, undefined), false);
});

test('P5 overview: counts roll up linked standards only; status derives from items', () => {
  const svc = row({ id: 's' });
  const nodes: StandardNode[] = [{
    id: 'std-1', code: 'GRI 2', title: 'General',
    disclosures: [
      { id: 'd-1', code: '2-1', title: 'T', description: null, items: [item({ id: 'i-1', disclosure_id: 'd-1', code: '2-1-a' })] },
      { id: 'd-2', code: '2-2', title: 'T', description: null, items: [] },
    ],
  }];
  assert.deepEqual(countsForService(svc, nodes), { standards: 1, disclosures: 2, items: 1 });
  assert.equal(contentStatus({ standards: 1, disclosures: 2, items: 1 }), 'ready');
  assert.equal(contentStatus({ standards: 0, disclosures: 0, items: 0 }), 'empty');
  const built = buildContent(svc,
    [disclosure('d-1', 'std-1', '2-1'), disclosure('d-9', 'std-9', '9-9')],
    [item({ id: 'i-1', disclosure_id: 'd-1', code: '2-1-a' })]);
  assert.equal(built.length, 1, 'unlinked disclosures never enter the drill');
  assert.equal(built[0].disclosures.length, 1);
  assert.equal(built[0].disclosures[0].items.length, 1);
});

test('P5 overview: linked-clients count is read-only (id + name only)', () => {
  type ClientOption = { id: string; name: string; services?: Array<{ id: string }> };
  const clients: ClientOption[] = [
    { id: 'c-1', name: 'Client One', services: [{ id: 's' }] },
    { id: 'c-2', name: 'Client Two', services: [{ id: 'other' }] },
    { id: 'c-3', name: 'Client Three' },
  ];
  assert.deepEqual(eligibleClients(clients, 's'), [{ id: 'c-1', name: 'Client One' }]);
  assert.deepEqual(eligibleClients(clients, null), []);
  assert.deepEqual(eligibleClients([], 's'), []);
});

// --- P5 UI-2: flexible levels (standards + groups + direct; details never a level) ---

test('P5 UI-2: bucket predicates (group vs general vs regular)', () => {
  assert.equal(isGroupCategory('group'), true);
  assert.equal(isGroupCategory(' Group '), true);
  assert.equal(isGroupCategory('general'), false);
  assert.equal(isGroupCategory('universal'), false);
  assert.equal(isGroupCategory(''), false);
  assert.equal(isGroupCategory(null), false);
  assert.equal(isGeneralStandard('GENERAL-GRI-1', 'universal'), true);
  assert.equal(isGeneralStandard('GRI 2', 'general'), true);
  assert.equal(isGeneralStandard('GRI 2', 'universal'), false);
  assert.equal(isGeneralStandard('GROUP-GRI-1', 'group'), false);
  const code = suggestedGroupStandardCode('GRI-CONSULT', '11111111-1111-4111-8111-111111111111');
  assert.match(code, /^GROUP-/);
  assert.ok(code.includes('GRI-CONSULT'), 'service slug survives in the suggested bucket code');
});

test('P5 UI-2: buildFlexibleContent splits standards / groups / direct items', () => {
  const svc = row({
    id: 's',
    standards: [
      { id: 'std-reg', code: 'GRI 2', title: 'Regular' },
      { id: 'std-grp', code: 'GROUP-SVC-1', title: 'Groups container' },
      { id: 'std-gen', code: 'GENERAL-SVC-1', title: 'General bucket' },
    ],
  });
  const categories = { 'std-reg': 'universal', 'std-grp': 'group', 'std-gen': 'general' };
  const discs = [
    disclosure('d-reg', 'std-reg', '2-1'),
    disclosure('d-grp', 'std-grp', 'GRP-A', 'Group A'),
    disclosure('d-gen', 'std-gen', 'GENERAL'),
    disclosure('d-gen-x', 'std-gen', 'EXTRA'),
  ];
  const items = [
    item({ id: 'i-reg', disclosure_id: 'd-reg', code: '2-1-a' }),
    item({ id: 'i-grp', disclosure_id: 'd-grp', code: 'GRP-A-1' }),
    item({ id: 'i-dir', disclosure_id: 'd-gen', code: 'GEN-1' }),
    item({ id: 'i-gen-x', disclosure_id: 'd-gen-x', code: 'GEN-X-1' }),
  ];
  const flex = buildFlexibleContent(svc, discs, items, categories);
  assert.equal(flex.standards.length, 2, 'regular standard + GENERAL bucket remainder (EXTRA)');
  assert.equal(flex.groups.length, 1);
  assert.equal(flex.groups[0].code, 'GRP-A');
  assert.equal(flex.groups[0].standardCode, 'GROUP-SVC-1');
  assert.deepEqual(flex.groups[0].items.map((i) => i.id), ['i-grp']);
  assert.deepEqual(flex.direct.map((i) => i.id), ['i-dir'], 'only the GENERAL disclosure feeds direct items');
  for (const node of [...flex.standards, ...flex.groups]) {
    assert.ok(!('details' in node), 'details are never a tree level');
  }
  assert.deepEqual(flexibleCounts(flex), { standards: 2, groups: 1, direct: 1, disclosures: 3, items: 4 });
  assert.deepEqual(flexibleCounts({ standards: [], groups: [], direct: [] }),
    { standards: 0, groups: 0, direct: 0, disclosures: 0, items: 0 });
});

test('P5 UI-2: archived items leave the live scope but stay viewable', () => {
  const live = item({ id: 'i-1', disclosure_id: 'd-1', code: 'A' });
  const gone = item({ id: 'i-2', disclosure_id: 'd-1', code: 'B', status: 'archived' });
  assert.deepEqual(splitArchived([live, gone]).active.map((i) => i.id), ['i-1']);
  assert.deepEqual(splitArchived([live, gone]).archived.map((i) => i.id), ['i-2']);
  assert.match(panel(), /s\.archivedSection/, 'archived retention section is wired');
  assert.match(panel(), /s\.archivedBadge/, 'archived styling is wired');
  assert.match(panel(), /s\.itemArchivedNote/, 'archive-with-history messaging is wired');
});

// --- P5 DG-04: reopened is status-only ---

test('P5 DG-04: reopened counts are status-only (never values, never invented copy)', () => {
  assert.equal(reopenedCount([{ status: 'reopened', count: 2 }, { status: 'submitted', count: 5 }]), 2);
  assert.equal(reopenedCount([]), 0);
  assert.equal(reopenedCount([{ status: 'submitted', count: 'x' as unknown as number }]), 0);
  assert.equal(historyReopenedCount(null), 0);
  assert.equal(historyReopenedCount({ versions: [], answersSummary: [{ status: 'reopened', count: 3 }] }), 3);
  assert.match(panel(), /s\.historyReopened/, 'reopened banner reuses the existing string');
});

// --- P5 content interactions: search scope, dirty draft, conflict, bulk subset ---

test('P5 content: level search, draft dirtiness incl single department, conflict copy', () => {
  const nodes: StandardNode[] = [
    { id: 's-1', code: 'GRI 2', title: 'General', disclosures: [] },
    { id: 's-2', code: 'GRI 3', title: 'Material', disclosures: [] },
  ];
  assert.deepEqual(filterStandardNodes(nodes, '').map((n) => n.id), ['s-1', 's-2']);
  assert.deepEqual(filterStandardNodes(nodes, 'gri 3').map((n) => n.id), ['s-2']);
  const base = item({ id: 'i', disclosure_id: 'd', code: 'C', department_id: null });
  const clean: ItemPatch = {
    requirement: base.requirement, hint: '', answerType: 'text', priority: 'mid',
    esgClass: 'general', objective: '', topic: '', reference: '', departmentId: null,
  };
  assert.equal(draftIsDirty(base, clean), false);
  assert.equal(draftIsDirty(base, { ...clean, departmentId: 'dept-1' }), true, 'department move dirties the draft');
  assert.equal(draftIsDirty(base, { ...clean, answerType: 'number' }), true);
  assert.deepEqual([...ANSWER_TYPES], ['text', 'number', 'boolean', 'date', 'file']);
  assert.deepEqual([...PRIORITIES], ['high', 'mid', 'low']);
  assert.deepEqual([...ESG_CLASSES], ['environmental', 'social', 'governance', 'general']);
  assert.match(panel(), /s\.saveConflictHint/, 'N-7 version-conflict copy is wired');
  assert.match(panel(), /s\.singleDeptNote/, 'single-department rule copy is wired');
  assert.match(panel(), /s\.bulkUnset/, 'bulk leaves fields untouched unless chosen');
});

// --- P5 settings: the closed named-key set (owner confirmation list) ---

test('P5 settings: closed named-key set (no raw JSON)', () => {
  assert.deepEqual([...NAMED_SETTINGS_KEYS], [
    'default_answer_type', 'default_priority', 'default_esg_class',
    'attachment_required_default', 'report_visible_default',
  ]);
  assert.deepEqual(DEFAULT_NAMED_SETTINGS, {
    default_answer_type: 'text', default_priority: 'mid', default_esg_class: 'general',
    attachment_required_default: false, report_visible_default: true,
  });
  assert.match(settingsPanel(), /s\.namedSettingsTitle/, 'named settings card is wired (settings panel)');
  assert.doesNotMatch(view(), /s\.settingsInvalid/, 'raw-JSON validation copy is unreachable from the view');
  assert.doesNotMatch(settingsPanel(), /s\.settingsInvalid/, 'raw-JSON validation copy is unreachable from the settings panel');
});

// --- P5 import: canonical columns, mapping, row errors, service scope ---

test('P5 import: canonical columns + CSV + mapping (unmapped never silent)', () => {
  assert.deepEqual([...IMPORT_CANONICAL_COLUMNS], [
    'standardCode', 'standardTitle', 'category', 'disclosureCode', 'disclosureTitle',
    'itemCode', 'requirement', 'priority', 'esgClass', 'answerType', 'hint',
    'department', 'objective', 'topic', 'reference',
  ]);
  assert.deepEqual(splitCsvLine('a,b,c'), ['a', 'b', 'c']);
  assert.deepEqual(splitCsvLine('"a,b",c'), ['a,b', 'c'], 'quoted commas stay in one cell');
  assert.deepEqual(splitCsvLine('"a""b",c'), ['a"b', 'c'], 'escaped quotes collapse');
  assert.deepEqual(splitCsvLine(''), ['']);
  const mapping = autoMapColumns(IMPORT_CANONICAL_COLUMNS, ['Standard Code', 'Requirement', 'Extra Header']);
  assert.equal(mapping.standardCode, 'Standard Code');
  assert.equal(mapping.requirement, 'Requirement');
  assert.equal(mapping.disclosureCode, undefined, 'unmatched canonical stays unmapped (shown, never silent)');
  assert.ok(!Object.values(mapping).includes('Extra Header'), 'extra file headers map to nothing');
  assert.match(view(), /s\.mappingTitle/, 'mapping table is wired');
  assert.match(view(), /s\.unmappedTitle/, 'unmapped columns are surfaced');
  assert.match(view(), /s\.rowErrorsTitle/, 'row-level errors are surfaced');
  assert.match(view(), /s\.commitBlocked/, 'commit blocks on row errors');
  assert.match(view(), /s\.previewClean/, 'clean preview is announced');
  assert.match(view(), /s\.templateDownload/, 'per-service template is wired');
  assert.ok(view().includes('/import/preview'), 'preview binds POST /api/import/preview');
  assert.ok(view().includes('/import/commit'), 'commit binds POST /api/import/commit');
  assert.ok(view().includes('/import/template'), 'template binds GET …/import/template');
  assert.ok(view().includes('standards: preview.standards'), 'commit sends mapped standards (no clientId)');
  assert.ok(view().includes('/api/items/bulk'), 'bulk binds POST /api/items/bulk');
  assert.ok(view().includes('/api/items/${itemId}/history'), 'history binds GET /api/items/:id/history');
});

// --- P5 i18n: every new workspace key exists in interface + EN + AR ---

test('P5 i18n: new workspace keys exist in the interface, EN and AR', () => {
  const i18n = source('src/i18n/translations.ts');
  for (const key of ['contentGroups', 'contentGroup', 'contentDirect', 'directHint',
    'archivedCount', 'archivedSection', 'archivedBadge', 'linkedReadOnly',
    'approvedCopiesTitle', 'approvedCopiesNone', 'approvedCopySealed', 'approvedCopyMissing',
    'approvedCopiesHint', 'namedSettingsTitle', 'namedSettingsHint', 'namedSettingsReplace',
    'settingDefaultAnswerType', 'settingDefaultAnswerTypeHint', 'settingDefaultPriority',
    'settingDefaultPriorityHint', 'settingDefaultEsgClass', 'settingDefaultEsgClassHint',
    'settingAttachmentDefault', 'settingAttachmentDefaultHint', 'settingVisibleDefault',
    'settingVisibleDefaultHint', 'frozenScopeBanner', 'historyReopened',
    'historyFailed', 'templateDownload', 'templateDownloadHint', 'mappingTitle',
    'mappingHint', 'mappingFileColumn', 'importConfirmService', 'unmappedTitle', 'rowErrorsTitle',
    'commitBlocked', 'previewClean', 'createStandard', 'editStandard', 'deleteStandardConfirm',
    'createGroup', 'newGroupStandard', 'createGroupHint', 'editGroup', 'deleteGroupConfirm',
    'createDisclosure', 'editDisclosure', 'deleteDisclosureConfirm', 'itemDepartment',
    'itemDepartmentNone', 'singleDeptNote', 'saveConflictHint', 'deleteItemTitle', 'deleteItemHint',
    'deleteReasonPh', 'itemArchivedNote', 'bulkEditDone', 'bulkUnset',
    'bulkEditApply', 'bulkEditHint', 'bulkRowOk']) {
    assert.equal((i18n.match(new RegExp(`\\b${key}:`, 'g')) ?? []).length, 3, `${key}: interface + EN + AR`);
  }
});
