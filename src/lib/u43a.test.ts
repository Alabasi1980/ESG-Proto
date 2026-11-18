// TASK-PROTO-U4-3 unit (a) — employee services workspace pins (no DB, no DOM).
//
// Behavioral pins for the E-only composition over the existing APIs as built:
// service grouping with own-dept counts from the queue roll-up, client-side
// own-department pinning (the server 403 path is pinned by source), the
// mandatory-attachment submit-block mirror (server stays authoritative),
// document/initiative own-status selection, paired AR/EN keys, and source
// pins proving no new endpoints, no pickers, and no W-only shortcut usage.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import type { QueueItem } from '../views/EvaluationPanel.tsx';
import type { ServiceRow } from '../components/services/ServiceRail.tsx';
import {
  countsForItems,
  docStatus,
  filterOwnDepartment,
  groupByDisclosure,
  groupQueueByService,
  pickOwnStatus,
  queueStatusLabel,
  submitBlockReason,
} from '../components/employee/employeeWorkspace.ts';
import { translations } from '../i18n/translations.ts';

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
    department_id: 'dept-own',
    department_code: 'LEGAL',
    department_name: 'Legal',
    evaluation_id: null,
    evaluation_version: null,
    score: null,
    not_evaluated: true,
    not_applicable: null,
    na_reason: null,
    justification: null,
    evaluator_id: null,
    previous_score: null,
    answer_id: null,
    answer_status: null,
    answer_version: null,
    answer_submitted_by: null,
    status: 'not_evaluated',
    ...overrides,
  } as QueueItem;
}

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

test('U4-3a service rail: queue rows group under their linked service with own-dept counts', () => {
  const services = [
    serviceRow(),
    serviceRow({ id: 'svc-2', code: 'SVC-2', name: 'Service two', standards: [{ id: 'st-2', code: 'STD-B', title: 'Standard B' }] }),
  ];
  const rows = [
    queueRow({ item_id: 'a', standard_code: 'STD-A', answer_status: 'submitted', status: 'submitted' }),
    queueRow({ item_id: 'b', standard_code: 'STD-A', answer_status: 'draft', status: 'draft' }),
    queueRow({ item_id: 'c', standard_code: 'STD-B', answer_status: null, status: 'not_evaluated' }),
  ];
  const groups = groupQueueByService(rows, services);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].id, 'svc-1');
  assert.equal(groups[0].fallback, false);
  assert.deepEqual([groups[0].assigned, groups[0].submitted, groups[0].pending], [2, 1, 1]);
  assert.deepEqual([groups[1].assigned, groups[1].submitted, groups[1].pending], [1, 0, 1]);
});

test('U4-3a service rail: unmatched standards stay visible under a standard-code fallback, never dropped', () => {
  const groups = groupQueueByService([queueRow({ standard_code: 'STD-Z' })], [serviceRow()]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].fallback, true);
  assert.equal(groups[0].code, 'STD-Z');
  assert.equal(groups[0].assigned, 1);
});

test('U4-3a negative: foreign-department rows are pinned out client-side (server refuses with 403)', () => {
  const rows = [
    queueRow({ item_id: 'own', department_id: 'dept-own' }),
    queueRow({ item_id: 'foreign', department_id: 'dept-other' }),
  ];
  const kept = filterOwnDepartment(rows, 'dept-own');
  assert.deepEqual(kept.map((row) => row.item_id), ['own']);
  assert.deepEqual(filterOwnDepartment(rows, null), []);
  assert.deepEqual(filterOwnDepartment(rows, undefined), []);
  const server = readFileSync('src/server/routes/evaluations.ts', 'utf8');
  assert.match(server, /scope\.department_mismatch/, 'cross-dept denial path stays pinned');
});

test('U4-3a counts: submitted covers submitted/approved/client_approved, the rest is pending', () => {
  const rows = [
    queueRow({ answer_status: 'submitted', status: 'submitted' }),
    queueRow({ answer_status: 'approved', status: 'approved' }),
    queueRow({ answer_status: 'client_approved', status: 'client_approved' }),
    queueRow({ answer_status: 'returned', status: 'returned' }),
    queueRow({ answer_status: null, status: 'not_evaluated' }),
  ];
  assert.deepEqual(countsForItems(rows), { assigned: 5, submitted: 3, pending: 2 });
});

test('U4-3a submit block mirror: mandatory attachment enforced, incl. the N/A path (OD-12)', () => {
  // Free item with an answer submits.
  assert.equal(submitBlockReason({ answerType: 'text', attachmentRequired: false, attachmentCount: 0, notApplicable: false, provided: true }), null);
  // Missing typed answer blocks.
  assert.equal(submitBlockReason({ answerType: 'number', attachmentRequired: false, attachmentCount: 0, notApplicable: false, provided: false }), 'answer');
  // attachment_required blocks even with a written answer.
  assert.equal(submitBlockReason({ answerType: 'text', attachmentRequired: true, attachmentCount: 0, notApplicable: false, provided: true }), 'attachment');
  // N/A satisfies the answer but NOT attachment_required.
  assert.equal(submitBlockReason({ answerType: 'text', attachmentRequired: true, attachmentCount: 0, notApplicable: true, provided: false }), 'attachment');
  assert.equal(submitBlockReason({ answerType: 'text', attachmentRequired: false, attachmentCount: 0, notApplicable: true, provided: false }), null);
  // file items: the attachment IS the answer.
  assert.equal(submitBlockReason({ answerType: 'file', attachmentRequired: false, attachmentCount: 0, notApplicable: false, provided: false }), 'attachment');
  assert.equal(submitBlockReason({ answerType: 'file', attachmentRequired: true, attachmentCount: 2, notApplicable: false, provided: false }), null);
});

test('U4-3a disclosure drill: items group by disclosure in code order', () => {
  const rows = [
    queueRow({ item_id: 'a2', code: 'A-2', disclosure_code: 'D1', disclosure_title: 'One' }),
    queueRow({ item_id: 'a1', code: 'A-1', disclosure_code: 'D1', disclosure_title: 'One' }),
    queueRow({ item_id: 'b2', code: 'B-2', disclosure_code: 'D2', disclosure_title: 'Two' }),
  ];
  const groups = groupByDisclosure(rows);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].code, 'D1');
  assert.deepEqual(groups[0].rows.map((row) => row.item_id), ['a1', 'a2']);
});

test('U4-3a documents + initiatives: own-department status selection and strip states', () => {
  assert.equal(docStatus(false), 'required');
  assert.equal(docStatus(true), 'provided');
  const statuses = [
    { id: 's1', departmentId: 'dept-other', performed: true, note: null, submittedAt: null, version: 1, files: [] },
    { id: 's2', departmentId: 'dept-own', performed: false, note: 'n', submittedAt: null, version: 2, files: [] },
  ];
  assert.equal(pickOwnStatus(statuses, 'dept-own')?.id, 's2');
  assert.equal(pickOwnStatus(statuses, 'dept-gone'), null);
  assert.equal(pickOwnStatus([], 'dept-own'), null);
});

test('U4-3a status labels reuse the gap-analysis vocabulary', () => {
  const t = { gapAnalysis: { stDraft: 'd', stSubmitted: 's', stApproved: 'a', stClientApproved: 'c', stReturned: 'r', stNotApplicable: 'n', stNotEvaluated: 'e' } };
  assert.equal(queueStatusLabel('draft', t), 'd');
  assert.equal(queueStatusLabel('submitted', t), 's');
  assert.equal(queueStatusLabel('client_approved', t), 'c');
  assert.equal(queueStatusLabel('unknown', t), 'e');
});

test('U4-3a i18n: every employeeServices key is paired AR/EN and non-empty', () => {
  const en = translations.en.employeeServices as Record<string, string>;
  const ar = translations.ar.employeeServices as Record<string, string>;
  assert.ok(en && ar, 'employeeServices block exists in both languages');
  for (const key of Object.keys(en)) {
    assert.equal(typeof ar[key], 'string', `ar missing: ${key}`);
    assert.ok(ar[key].length > 0, `ar empty: ${key}`);
  }
  for (const key of Object.keys(ar)) {
    assert.equal(typeof en[key], 'string', `en missing: ${key}`);
    assert.ok(en[key].length > 0, `en empty: ${key}`);
  }
});

test('U4-3a composition guards: UI over existing APIs only — no pickers, no assignment writes, no W-only shortcut', () => {
  const view = readFileSync('src/views/EmployeeServicesView.tsx', 'utf8');
  const detail = readFileSync('src/components/employee/EmployeeItemDetail.tsx', 'utf8');
  const docs = readFileSync('src/components/employee/EmployeeDocumentsTab.tsx', 'utf8');
  const inits = readFileSync('src/components/employee/EmployeeInitiativesTab.tsx', 'utf8');
  for (const [name, source] of [['view', view], ['detail', detail], ['docs', docs], ['inits', inits]] as const) {
    // No client/department pickers: identity is the session's (no query wiring).
    assert.doesNotMatch(source, /[?&](departmentId|clientId)=/, `${name}: no picker query wiring`);
    // The W-only N/A shortcut is untouched by the employee surface.
    assert.doesNotMatch(source, /assignments\/na/, `${name}: no N/A shortcut`);
    // No assignment or staff-list writes from the employee workspace.
    assert.doesNotMatch(source, /\/api\/(assignments|staff-lists)/, `${name}: no assignment writes`);
  }
  // The workspace consumes the queue without scoping params (server scopes).
  assert.match(view, /\/api\/queue'/, 'queue consumed as-is');
  assert.match(view, /\/api\/items'/, 'item metadata consumed as-is');
  assert.match(view, /\/api\/services'/, 'service catalogue consumed as-is');
  assert.doesNotMatch(view, /method\s*:/, 'view performs no writes itself');
  // Frozen-scope refusals surface the reactive banner, never invented state.
  assert.match(view, /isFrozenRefusal/, 'frozen refusal handled');
  assert.match(detail, /isFrozenRefusal/, 'detail frozen refusal handled');
  // Documents/initiatives tabs touch only their own contracts (no invented fields).
  assert.match(docs, /\/api\/requirements/, 'documents contract consumed');
  assert.match(docs, /document_submission/, 'unified document evidence entity');
  assert.match(inits, /\/api\/initiatives\/department/, 'initiatives contract consumed');
  assert.match(inits, /initiative_status/, 'unified initiative evidence entity');
  assert.doesNotMatch(docs + inits, /\/api\/(evaluations|answers|assignments|staff-lists|services|items|queue)/, 'tab-scoped reads/writes only');
});

test('U4-3a round 3 (owner ruling): no evaluation content renders on the employee surface', () => {
  const view = readFileSync('src/views/EmployeeServicesView.tsx', 'utf8');
  const detail = readFileSync('src/components/employee/EmployeeItemDetail.tsx', 'utf8');
  const docs = readFileSync('src/components/employee/EmployeeDocumentsTab.tsx', 'utf8');
  const inits = readFileSync('src/components/employee/EmployeeInitiativesTab.tsx', 'utf8');
  const helper = readFileSync('src/components/employee/employeeWorkspace.ts', 'utf8');
  const surface = view + detail + docs + inits + helper;
  // Score rubric / evaluation-outcome UI keys are never referenced.
  for (const token of ['outcomeSection', 'outcomeScore', 'outcomeNotEvaluated', 'outcomeNA',
    'score0', 'score50', 'score100', 'scoreLabel']) {
    assert.doesNotMatch(surface, new RegExp(token), `no rubric: ${token}`);
  }
  // N/A filing control (state, reason list, payload) is gone; correction
  // (outcome editing) is gone; no evaluator identity is read.
  for (const token of ['naReason', 'NA_REASON', 'setMode', 'setScore', 'setNaReason',
    'correctionTitle', 'correctionDesc', 'correctionReason', 'applyCorrection',
    'correctOutcome', 'correctNaReason', 'newScore', 'evaluator', 'item.score']) {
    assert.doesNotMatch(surface, new RegExp(token), `no evaluation control: ${token}`);
  }
  // No score word anywhere on the surface (case-insensitive, whole word).
  assert.doesNotMatch(surface, /\bscore\b/i, 'no score word renders');
  // Flows unchanged: draft + submit-for-approval + attachments + status words.
  assert.match(detail, /\/api\/evaluations'/, 'draft endpoint kept');
  assert.match(detail, /\/evaluations\/\$\{encodeURIComponent\(evalId\)\}\/submit/, 'submit endpoint kept');
  assert.match(detail, /\/attachments/, 'attachments kept');
  assert.match(detail, /saveDraft/, 'save-draft kept');
  assert.match(detail, /submitForApproval/, 'submit-for-approval kept');
  assert.match(detail + view, /queueStatusLabel/, 'plain status words kept');
});

test('U4-3a mount: employee landing mounts the workspace; nav matrix untouched', () => {
  const app = readFileSync('src/App.tsx', 'utf8');
  assert.match(app, /EmployeeServicesView/, 'workspace mounted');
  assert.match(app, /user\?\.role === 'employee' \? <EmployeeServicesView/, 'employee-only mount');
  const nav = readFileSync('src/lib/navModel.ts', 'utf8');
  assert.doesNotMatch(nav, /employeeServices/, 'no nav-matrix change');
});
