// TASK-PROTO-U4-3 unit (b) — client console pins (no DB, no DOM).
//
// Behavioral pins for the C-only composition over the existing APIs as built:
// linked-service grouping with confirmed-path counts, read-only status
// vocabulary, staff resubmit prefill, paired AR/EN keys, and source pins
// proving C-never-answers (no answer/attachment/N-A/evaluate/provisioning
// controls anywhere on the C surface) + dept scoping (no cross-tenant data,
// no tenant picker).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import type { QueueItem } from '../views/EvaluationPanel.tsx';
import type { ServiceRow } from '../components/services/ServiceRail.tsx';
import {
  consoleStatusLabel,
  countsForDeptRows,
  emptyDraftRow,
  groupReviewByService,
  isConfirmedRow,
  itemsForService,
  resubmitPrefill,
  type ConsoleDeptRow,
  type ConsoleReviewGroup,
} from '../components/client/clientConsole.ts';
import { translations } from '../i18n/translations.ts';

function serviceRow(overrides: Partial<ServiceRow> = {}): ServiceRow {
  return {
    id: 'svc-1',
    code: 'SVC-1',
    name: 'Service one',
    description: null,
    standards: [{ id: 'st-1', code: 'STD-A', title: 'Standard A' }],
    ...overrides,
  } as ServiceRow;
}

function deptRow(overrides: Partial<ConsoleDeptRow> = {}): ConsoleDeptRow {
  return {
    departmentId: 'dept-1',
    departmentName: 'Legal',
    answerId: 'ans-1',
    answerStatus: 'approved',
    evaluationId: 'ev-1',
    evaluationVersion: 1,
    score: 100,
    notEvaluated: false,
    notApplicable: false,
    ...overrides,
  };
}

function reviewGroup(overrides: Partial<ConsoleReviewGroup> = {}): ConsoleReviewGroup {
  return {
    disclosureId: 'd1',
    disclosureCode: 'D1',
    disclosureTitle: 'Disclosure one',
    standardCode: 'STD-A',
    departments: [deptRow()],
    total: 1,
    approved: 1,
    clientApproved: 0,
    notApplicable: 0,
    completeness: 100,
    readyForClient: true,
    fullyClientApproved: false,
    incompleteDepartments: [],
    ...overrides,
  };
}

function queueRow(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    item_id: 'item-1',
    code: 'GRI-101-1',
    requirement: 'Requirement text',
    priority: 'high',
    weight: 3,
    esg_class: 'environmental',
    topic: null,
    objective: null,
    disclosure_code: 'D1',
    disclosure_title: 'Disclosure one',
    standard_code: 'STD-A',
    pillar: 'general',
    department_id: 'dept-1',
    department_code: 'LEGAL',
    department_name: 'Legal',
    evaluation_id: 'ev-1',
    evaluation_version: 1,
    score: 100,
    not_evaluated: false,
    not_applicable: null,
    na_reason: null,
    justification: null,
    evaluator_id: null,
    previous_score: null,
    answer_id: 'ans-1',
    answer_status: 'approved',
    answer_version: 1,
    answer_submitted_by: null,
    status: 'approved',
    ...overrides,
  } as QueueItem;
}

test('U4-3b service rail: review groups roll up under linked services with confirmed-path counts', () => {
  const services = [
    serviceRow(),
    serviceRow({ id: 'svc-2', code: 'SVC-2', name: 'Service two', standards: [{ id: 'st-2', code: 'STD-B', title: 'Standard B' }] }),
  ];
  const groups = [
    reviewGroup(),
    reviewGroup({
      disclosureId: 'd2', disclosureCode: 'D2', standardCode: 'STD-B',
      departments: [deptRow({ answerStatus: 'submitted' }), deptRow({ departmentId: 'dept-2', answerStatus: 'client_approved' })],
    }),
  ];
  const rolled = groupReviewByService(groups, services);
  assert.equal(rolled.length, 2);
  assert.equal(rolled[0].id, 'svc-1');
  assert.equal(rolled[0].fallback, false);
  assert.deepEqual([rolled[0].assigned, rolled[0].confirmed, rolled[0].pending], [1, 1, 0]);
  assert.deepEqual([rolled[1].assigned, rolled[1].confirmed, rolled[1].pending], [2, 1, 1]);
});

test('U4-3b service rail: unmatched standards stay visible under a standard-code fallback, never dropped', () => {
  const rolled = groupReviewByService([reviewGroup({ standardCode: 'STD-Z' })], [serviceRow()]);
  assert.equal(rolled.length, 1);
  assert.equal(rolled[0].fallback, true);
  assert.equal(rolled[0].code, 'STD-Z');
  assert.equal(rolled[0].assigned, 1);
});

test('U4-3b counts: approved/client_approved/N/A are the confirmed path, everything else pends', () => {
  assert.equal(isConfirmedRow({ answerStatus: 'approved', notApplicable: false }), true);
  assert.equal(isConfirmedRow({ answerStatus: 'client_approved', notApplicable: false }), true);
  assert.equal(isConfirmedRow({ answerStatus: 'submitted', notApplicable: true }), true);
  assert.equal(isConfirmedRow({ answerStatus: 'submitted', notApplicable: false }), false);
  assert.equal(isConfirmedRow({ answerStatus: 'draft', notApplicable: null }), false);
  const counts = countsForDeptRows([
    deptRow({ answerStatus: 'approved' }),
    deptRow({ departmentId: 'd2', answerStatus: 'client_approved' }),
    deptRow({ departmentId: 'd3', answerStatus: 'submitted' }),
    deptRow({ departmentId: 'd4', answerStatus: 'draft' }),
  ]);
  assert.deepEqual(counts, { assigned: 4, confirmed: 2, pending: 2 });
});

test('U4-3b services drill: queue items filter to the active service standards (read-only shaping)', () => {
  const rows = [
    queueRow({ item_id: 'a', standard_code: 'STD-A' }),
    queueRow({ item_id: 'b', standard_code: 'STD-B' }),
  ];
  assert.deepEqual(itemsForService(rows, ['STD-A']).map((row) => row.item_id), ['a']);
  assert.deepEqual(itemsForService(rows, ['STD-Z']), []);
});

test('U4-3b status labels reuse the gap-analysis vocabulary', () => {
  const t = { gapAnalysis: { stDraft: 'd', stSubmitted: 's', stApproved: 'a', stClientApproved: 'c', stReturned: 'r', stNotApplicable: 'n', stNotEvaluated: 'e' } };
  assert.equal(consoleStatusLabel('draft', t), 'd');
  assert.equal(consoleStatusLabel('submitted', t), 's');
  assert.equal(consoleStatusLabel('client_approved', t), 'c');
  assert.equal(consoleStatusLabel('unknown', t), 'e');
});

test('U4-3b staff: rejected lists prefill a fresh draft (G7: reject = whole list, resubmit as new version)', () => {
  assert.deepEqual(emptyDraftRow(), { email: '', name: '', departmentId: '', role: 'employee' });
  const prefilled = resubmitPrefill(
    [
      { email: 'a@c.test', name: 'A', department_id: null, department_name: 'Legal', role: 'employee' },
      { email: 'b@c.test', name: 'B', department_id: 'dept-9', department_name: null, role: 'client_admin' },
    ],
    [{ id: 'dept-1', name: 'Legal' }],
  );
  assert.equal(prefilled.length, 2);
  assert.equal(prefilled[0].departmentId, 'dept-1');
  assert.equal(prefilled[1].departmentId, 'dept-9');
  assert.equal(prefilled[1].role, 'client_admin');
  assert.deepEqual(resubmitPrefill([], []), [emptyDraftRow()]);
});

test('U4-3b i18n: every clientConsole key is paired AR/EN and non-empty', () => {
  const en = translations.en.clientConsole as Record<string, string>;
  const ar = translations.ar.clientConsole as Record<string, string>;
  assert.ok(en && ar, 'clientConsole block exists in both languages');
  for (const key of Object.keys(en)) {
    assert.equal(typeof ar[key], 'string', `ar missing: ${key}`);
    assert.ok(ar[key].length > 0, `ar empty: ${key}`);
  }
  for (const key of Object.keys(ar)) {
    assert.equal(typeof en[key], 'string', `en missing: ${key}`);
    assert.ok(en[key].length > 0, `en empty: ${key}`);
  }
});

test('U4-3b C-never-answers: no answer/attachment/N-A/evaluate/provisioning controls on the C surface', () => {
  const view = readFileSync('src/views/ClientConsoleView.tsx', 'utf8');
  const services = readFileSync('src/components/client/ClientServicesTab.tsx', 'utf8');
  const staff = readFileSync('src/components/client/ClientStaffSection.tsx', 'utf8');
  const helper = readFileSync('src/components/client/clientConsole.ts', 'utf8');
  const surface = view + services + staff + helper;
  // Answer + attachment writes (C NEVER answers/attaches — INV-C-NEVER-ANSWERS).
  // The read-only status vocabulary (not_evaluated / notEvaluated) is scrubbed
  // first so the pin only fires on real evaluate controls.
  for (const token of ['/api/answers', '/attachments', 'answer_type', 'setAnswer',
    'saveDraft', 'submitForApproval']) {
    assert.doesNotMatch(surface, new RegExp(token.replace(/[/.]/g, (c) => `\\${c}`)), `no answer control: ${token}`);
  }
  assert.doesNotMatch(
    surface.replace(/not_evaluated|notEvaluated|stNotEvaluated/g, ''),
    /evaluate/,
    'no evaluate control',
  );
  // N/A filing + evaluation correction (W-only per G2 / spec API-5).
  for (const token of ['assignments/na', 'naReason', 'NA_REASON', 'setNaReason',
    'correctionTitle', 'correctionReason', 'newScore', 'score0', 'score50', 'score100']) {
    assert.doesNotMatch(surface, new RegExp(token), `no evaluation control: ${token}`);
  }
  // Staff provisioning + secrets (W approve/provision/OTP; C draft/submit only).
  for (const token of ['staff-lists.*approve', 'staff-lists.*reject', 'oneTimePassword',
    'one_time_password', 'must_change_password', 'mustChange', 'password_hash']) {
    assert.doesNotMatch(surface, new RegExp(token, 'i'), `no provisioning control: ${token}`);
  }
  // Visibility/mask writes (W-only serviceVisibility route; forbidden columns never rendered).
  for (const token of ['/visibility', 'clientFieldMask', 'client_field_mask', 'show_gap', 'showGap',
    'show_corrective', 'showCorrective']) {
    assert.doesNotMatch(surface, new RegExp(token), `no mask control: ${token}`);
  }
  // Assignment writes (GE-only; C surface is read-only here).
  assert.doesNotMatch(surface, /\/api\/assignments/, 'no assignment writes');
  // Reused flows stay intact: confirm/return go through the existing ClientReviewView.
  assert.match(view, /ClientReviewView/, 'review tab reuses the existing confirm flow');
  assert.match(staff, /\/api\/staff-lists'/, 'draft endpoint kept');
  assert.match(staff, /\/submit/, 'submit endpoint kept');
});

test('U4-3b dept scoping: own-tenant only — no tenant picker, no cross-dept query wiring', () => {
  const view = readFileSync('src/views/ClientConsoleView.tsx', 'utf8');
  const services = readFileSync('src/components/client/ClientServicesTab.tsx', 'utf8');
  const staff = readFileSync('src/components/client/ClientStaffSection.tsx', 'utf8');
  const surface = view + services + staff;
  // No tenant list fetch and no tenant selector: the tenant is the session's own.
  assert.doesNotMatch(surface, /\/api\/clients['"/]/, 'no tenant list fetch');
  assert.doesNotMatch(surface, /setTenantId|tenantPicker|selectTenant/, 'no tenant picker');
  // No per-request department scoping params: the server scopes by session.
  // The ONE clientId query is the session's own tenant (ClientReviewView pattern).
  assert.doesNotMatch(surface, /[?&]departmentId=/, 'no dept picker query wiring');
  const clientIdUses = surface.match(/[?&]clientId=([^'"`\s]*)/g) ?? [];
  assert.ok(clientIdUses.length > 0, 'non-vacuity: the own-tenant review call is pinned');
  for (const use of clientIdUses) {
    assert.ok(
      use.includes('${encodeURIComponent(tenantId)}'),
      `clientId must be the session tenant only: ${use}`,
    );
  }
  // Staff departments come from the own-tenant department list only.
  assert.match(staff, /\/api\/departments/, 'own-tenant departments consumed');
  assert.doesNotMatch(staff, /\/api\/clients/, 'staff never touches the tenant list');
});

test('U4-3b API bindings: composition over existing endpoints only (no invented routes)', () => {
  const view = readFileSync('src/views/ClientConsoleView.tsx', 'utf8');
  const services = readFileSync('src/components/client/ClientServicesTab.tsx', 'utf8');
  const staff = readFileSync('src/components/client/ClientStaffSection.tsx', 'utf8');
  // The console itself issues no writes: all C writes live in the reused
  // ClientReviewView (confirm/return) and the staff draft/submit form.
  assert.doesNotMatch(view, /method\s*:\s*'(POST|PUT|PATCH|DELETE)'/, 'view performs no writes itself');
  assert.doesNotMatch(services, /method\s*:/, 'services tab performs no writes itself');
  for (const [name, source] of [['view', view], ['services', services], ['staff', staff]] as const) {
    const routes = source.match(/\/api\/[A-Za-z0-9/_${}:?.=-]+/g) ?? [];
    for (const route of routes) {
      const base = route.split('?')[0].replace(/\$\{[^}]*\}/g, ':param');
      assert.ok(
        base.startsWith('/api/client/dashboard')
        || base.startsWith('/api/client-review')
        || base.startsWith('/api/queue')
        || base.startsWith('/api/services')
        || base.startsWith('/api/departments')
        || base.startsWith('/api/staff-lists'),
        `${name}: unexpected API route ${route}`,
      );
    }
  }
});

test('U4-3b mount: client_admin gap-analysis mounts the console; nav matrix untouched', () => {
  const app = readFileSync('src/App.tsx', 'utf8');
  assert.match(app, /ClientConsoleView/, 'console mounted');
  assert.match(app, /user\?\.role === 'client_admin' \? <ClientConsoleView/, 'client-only mount');
  const nav = readFileSync('src/lib/navModel.ts', 'utf8');
  assert.doesNotMatch(nav, /clientConsole|client-console/, 'no nav-matrix change');
});

test('U4-3b file hygiene: new files stay under the 500-line bound', () => {
  for (const file of [
    'src/views/ClientConsoleView.tsx',
    'src/components/client/ClientServicesTab.tsx',
    'src/components/client/ClientStaffSection.tsx',
    'src/components/client/clientConsole.ts',
    'src/lib/u43b.test.ts',
  ]) {
    assert.ok(readFileSync(file, 'utf8').split('\n').length <= 500, `${file}: new-file bound`);
  }
});
