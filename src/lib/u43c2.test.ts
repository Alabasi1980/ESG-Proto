// TASK-PROTO-U4-3C unit (c2) — consultant console pins (no DB, no DOM).
//
// Behavioral pins for the W-only composition over the c1 + pre-existing APIs:
// code-equality auto-match (G4) + manual override, closed N/A reason list
// (G2), mask vocabulary incl. new G6 columns, OTP-once + reveal-once memory
// discipline, endpoint allowlist (c1 + allowed pre-existing only), paired
// AR/EN keys, and absence pins proving no P/C/E writes, no secrets, no
// tenant picker, no second visual language (zero literal colours).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { STAFF_NA_REASONS } from './b11b.ts';
import {
  CONSULTANT_API_ALLOWLIST,
  MASK_FIELDS,
  NA_REASONS,
  NEW_MASK_FIELDS,
  autoMatchServiceDepts,
  naStateRows,
  readMask,
  serviceDeptEntries,
} from '../components/consultant/consultantConsole.ts';
import { CLIENT_FIELD_MASK_VALUES } from './clientFieldMask.ts';
import { translations } from '../i18n/translations.ts';
import { labelOf } from './navModel.ts';

const view = readFileSync('src/views/ConsultantConsoleView.tsx', 'utf8');
const services = readFileSync('src/components/consultant/ConsultantServicesTab.tsx', 'utf8');
const matching = readFileSync('src/components/consultant/ConsultantMatchingTab.tsx', 'utf8');
const scope = readFileSync('src/components/consultant/ConsultantScopeTab.tsx', 'utf8');
const masks = readFileSync('src/components/consultant/ConsultantMasksTab.tsx', 'utf8');
const staff = readFileSync('src/components/consultant/ConsultantStaffTab.tsx', 'utf8');
const helper = readFileSync('src/components/consultant/consultantConsole.ts', 'utf8');
const surface = view + services + matching + scope + masks + staff + helper;

function queueRow(overrides: Record<string, unknown> = {}) {
  return {
    item_id: 'item-1',
    code: 'GRI-101-1',
    requirement: 'Requirement text',
    standard_code: 'STD-A',
    disclosure_code: 'D1',
    department_id: 'dept-1',
    department_code: 'LEGAL',
    department_name: 'Legal',
    not_applicable: false,
    na_reason: null,
    ...overrides,
  } as never;
}

// --- G4 auto-match: exact code equality, case-insensitive, deduped ---

test('U4-3c2 match: equality by code (case-insensitive, trimmed), rest unmatched', () => {
  const entries = [
    { serviceId: 'svc-1', serviceCode: 'S1', serviceDeptCode: 'LEGAL' },
    { serviceId: 'svc-1', serviceCode: 'S1', serviceDeptCode: ' legal ' },
    { serviceId: 'svc-1', serviceCode: 'S1', serviceDeptCode: 'OPS' },
  ];
  const depts = [{ id: 'd1', code: 'legal', name: 'Legal' }];
  const { matched, unmatched } = autoMatchServiceDepts(entries, depts);
  assert.equal(matched.length, 1);
  assert.deepEqual(matched[0], { serviceId: 'svc-1', serviceDeptCode: 'LEGAL', clientDeptId: 'd1' });
  assert.equal(unmatched.length, 1);
  assert.equal(unmatched[0].serviceDeptCode, 'OPS');
});

test('U4-3c2 match: entries derive from linked-service queue rows only', () => {
  const catalogue = [{ id: 'svc-1', code: 'S1', name: 'S one', standards: [{ id: 'st', code: 'STD-A', title: 'A' }] }] as never;
  const rows = [
    queueRow({ standard_code: 'STD-A', department_code: 'HR' }),
    queueRow({ standard_code: 'STD-A', department_code: '' }),
    queueRow({ standard_code: 'OTHER', department_code: 'HR' }),
  ];
  const entries = serviceDeptEntries(rows, catalogue, new Set(['svc-1']));
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0], { serviceId: 'svc-1', serviceCode: 'S1', serviceDeptCode: 'HR' });
});

// --- G2 closed reason list + N/A state shaping ---

test('U4-3c2 N/A: closed reason list is exactly the server-enforced vocabulary', () => {
  assert.deepEqual(NA_REASONS, STAFF_NA_REASONS);
  assert.deepEqual([...NA_REASONS], [
    'not-applicable',
    'legal-prohibitions',
    'confidentiality-constraints',
    'information-unavailable-incomplete',
  ]);
});

test('U4-3c2 N/A: state rows shape only N/A queue rows with reason', () => {
  const rows = naStateRows([
    queueRow({ item_id: 'i1', code: 'C1', disclosure_code: 'D1', department_name: 'Legal', not_applicable: true, na_reason: 'legal-prohibitions' }),
    queueRow({ item_id: 'i2' }),
  ]);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    itemId: 'i1', code: 'C1', disclosureCode: 'D1', departmentName: 'Legal', naReason: 'legal-prohibitions',
  });
});

// --- G6 mask vocabulary: additive, new columns flagged ---

test('U4-3c2 masks: full vocabulary incl. G6 additions, helper reads tolerantly', () => {
  assert.deepEqual([...MASK_FIELDS], [...CLIENT_FIELD_MASK_VALUES]);
  for (const field of ['documents', 'initiatives', 'na_status'])
    assert.ok((NEW_MASK_FIELDS as readonly string[]).includes(field), field);
  assert.deepEqual(readMask(['hint', 'na_status']), ['hint', 'na_status']);
  assert.deepEqual(readMask(null), []);
  assert.deepEqual(readMask('hint'), []);
});

// --- i18n: paired AR/EN consultantConsole keys ---

test('U4-3c2 i18n: every consultantConsole key exists non-empty in AR + EN', () => {
  const en = (translations.en as unknown as Record<string, Record<string, string>>).consultantConsole;
  const ar = (translations.ar as unknown as Record<string, Record<string, string>>).consultantConsole;
  assert.ok(en && ar, 'block present in both locales');
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ar).sort());
  assert.ok(Object.keys(en).length > 60, `key count ${Object.keys(en).length}`);
  for (const [key, value] of Object.entries(en)) {
    assert.ok(value.trim().length > 0, `en.${key} non-empty`);
    assert.ok((ar[key] ?? '').trim().length > 0, `ar.${key} non-empty`);
  }
  assert.match(ar.title, /[\u0600-\u06FF]/, 'ar title is Arabic');
});

// --- API bindings: c1 + pre-existing only (no invented routes) ---

test('U4-3c2 API bindings: every fetched route is allowlisted (c1 + existing)', () => {
  assert.ok(CONSULTANT_API_ALLOWLIST.length > 0, 'non-vacuity: allowlist non-empty');
  const routes = new Set<string>();
  for (const match of surface.matchAll(/['"`](\/[A-Za-z][A-Za-z0-9/_{}$:?.=-]*)['"`]/g)) {
    const route = match[1].split('?')[0].replace(/\$\{[^}]*\}/g, ':param');
    if (route.startsWith('/api/') || route.startsWith('/workspace/')) routes.add(route);
  }
  assert.ok(routes.size > 10, `non-vacuity: routes pinned (${routes.size})`);
  for (const route of routes) {
    assert.ok(
      CONSULTANT_API_ALLOWLIST.some((allowed) => route.startsWith(allowed)),
      `unexpected API route ${route}`,
    );
  }
  // c1 N/A + visibility + deliver legs are consumed (non-vacuous presence).
  for (const token of ['/api/assignments/na', '/na/lift', '/visibility', '/staff-lists/', '/staff/:userId/complete-password',
    '/workspace/client-services', '/workspace/participating-departments', '/workspace/dept-matching']) {
    assert.match(surface, new RegExp(token.replace(/[/.]/g, (c) => `\\${c}`)), `consumes ${token}`);
  }
});

// --- Absence pins: no P/C/E writes, no secrets, no tenant picker ---

test('U4-3c2 absence: W never answers/attaches and never confirms/corrects evaluations', () => {
  for (const token of ['/api/answers', '/attachments', 'answer_type', 'setAnswer',
    'saveDraft', 'submitForApproval', '/api/evaluations', 'correctionTitle', 'correctionReason',
    'newScore', 'evaluator_id', 'show_gap', 'show_corrective', 'showGap', 'showCorrective']) {
    assert.doesNotMatch(surface, new RegExp(token.replace(/[/.]/g, (c) => `\\${c}`)), `no control: ${token}`);
  }
});

test('U4-3c2 absence: no provisioning secrets and no invented mail/authn paths', () => {
  for (const token of ['password_hash', 'hashPassword', 'generateOneTimePassword',
    'localStorage', 'sessionStorage', 'nodemailer', 'smtp', 'sendMail',
    '/api/auth/change-password', '/api/gri/', '/api/approved-copies', '/seal', '/api/import']) {
    assert.doesNotMatch(surface, new RegExp(token.replace(/[/.]/g, (c) => `\\${c}`), 'i'), `no secret/foreign path: ${token}`);
  }
  // OTP-once discipline: the plaintext appears ONLY in the staff approve panel,
  // with the one-time warning, copy affordance and acknowledge-to-clear.
  const otpUses = surface.split('oneTimePassword').length - 1;
  assert.equal(otpUses, 3, `oneTimePassword stays in the OTP panel only (found ${otpUses})`);
  assert.match(staff, /acknowledgeButton/, 'acknowledge affordance present');
  assert.match(staff, /setOtps\(null\)/, 'OTP memory cleared on acknowledge');
  assert.match(staff, /React\.useEffect\(\(\) => \(\) => setOtps\(null\), \[\]\)/, 'OTP memory cleared on unmount/tab-switch');
  // The temporary password travels in exactly one POST body (never logged).
  assert.equal(surface.split('temporaryPassword').length - 1, 1, 'temporaryPassword in one body only');
  // Reveal-only honesty: no email form, the email channel surfaces its 400.
  assert.match(staff, /email_unavailable/, 'email_unavailable surfaced honestly');
});

test('U4-3c2 absence: own-tenant only — no tenant list, no tenant picker, no dept query wiring', () => {
  assert.doesNotMatch(surface, /\/api\/clients['"`]/, 'no tenant list fetch');
  assert.doesNotMatch(surface, /setTenantId|tenantPicker|selectTenant/, 'no tenant picker');
  assert.doesNotMatch(surface, /[?&]departmentId=/, 'no dept picker query wiring');
  // The one bound-tenant detail read + bound clientId bodies come from the session workspace.
  assert.match(view, /workspace\?\.client\?\.id/, 'tenant is the session workspace client');
  for (const token of ['clientId: tenantId']) {
    assert.ok(surface.includes(token), `bound tenant body: ${token}`);
  }
});

// --- Mount + nav: W gap-analysis only, labels otherwise untouched ---

test('U4-3c2 mount: W gap-analysis mounts the console; nav matrix untouched', () => {
  const app = readFileSync('src/App.tsx', 'utf8');
  assert.match(app, /ConsultantConsoleView/, 'console mounted');
  assert.match(app, /context === 'consultant' \? <ConsultantConsoleView/, 'W-only branch');
  // No nav-matrix change: presence, order and every context label are pinned
  // by navModel.test.ts — the console reuses the existing W gap-analysis slot.
  const nav = readFileSync('src/lib/navModel.ts', 'utf8');
  assert.doesNotMatch(nav, /consultantConsole|Client application/, 'no nav-matrix change');
  assert.equal(labelOf('gap-analysis', 'consultant').ar, 'تحليل الفجوات');
});

test('U4-3c2 vitality: skeleton, toasts, connection, search, animations, empty, dirty, tablist', () => {
  assert.match(surface, /animate-pulse/, 'skeleton shimmer');
  assert.match(surface, /aria-live="polite"/, 'toast live region');
  assert.match(surface, /navigator\.onLine|online/, 'connection status');
  assert.match(surface, /staffSearchPh|svcSearchPh/, 'real search inputs');
  assert.match(surface, /transition-colors/, 'micro-animations');
  assert.match(surface, /svcLinkedEmpty|staffEmpty|naEmpty|matchEmpty/, 'empty states');
  assert.match(surface, /beforeunload|ConfirmDialog/, 'dirty guard');
  assert.match(surface, /role="tablist"|role="tab"|role="tabpanel"/, 'real tablist');
  assert.match(surface, /dir="auto"|dir="ltr"/, 'bidi handling');
});

// --- File hygiene: ≤500 lines, zero literal colours ---

test('U4-3c2 file hygiene: new files stay under the 500-line bound', () => {
  for (const file of [
    'src/views/ConsultantConsoleView.tsx',
    'src/components/consultant/consultantConsole.ts',
    'src/components/consultant/ConsultantServicesTab.tsx',
    'src/components/consultant/ConsultantMatchingTab.tsx',
    'src/components/consultant/ConsultantScopeTab.tsx',
    'src/components/consultant/ConsultantMasksTab.tsx',
    'src/components/consultant/ConsultantStaffTab.tsx',
  ]) {
    const lines = readFileSync(file, 'utf8').split('\n').length;
    assert.ok(lines <= 500, `${file} has ${lines} lines (bound 500)`);
  }
});

test('U4-3c2 style: zero literal colours in the new surface', () => {
  for (const token of [/#[0-9a-fA-F]{3,8}\b/, /rgba?\(/, /hsla?\(/]) {
    assert.doesNotMatch(surface, token, `no literal colour: ${token}`);
  }
});

// TASK-PROTO-U4-3C2 round 2 (FINAL) — pins for the two reviewer notes only.

test('U4-3c2 NOTE-1: matching table headers come from i18n (no hardcoded EN)', () => {
  assert.doesNotMatch(matching, /Service code/, 'no hardcoded header: Service code');
  assert.doesNotMatch(matching, /Service dept code/, 'no hardcoded header: Service dept code');
  assert.match(matching, /s\.matchSvcCode/, 'header reads the i18n key');
  assert.match(matching, /s\.matchSvcDeptCode/, 'header reads the i18n key');
  const en = (translations.en as unknown as Record<string, Record<string, string>>).consultantConsole;
  const ar = (translations.ar as unknown as Record<string, Record<string, string>>).consultantConsole;
  assert.ok(en.matchSvcCode.trim().length > 0 && ar.matchSvcCode.trim().length > 0, 'matchSvcCode paired');
  assert.ok(en.matchSvcDeptCode.trim().length > 0 && ar.matchSvcDeptCode.trim().length > 0, 'matchSvcDeptCode paired');
});

test('U4-3c2 NOTE-2: scope switcher is a plain toggle group (no tab semantics)', () => {
  assert.doesNotMatch(scope, /role="tab"/, 'no tab role in the scope switcher');
  assert.doesNotMatch(scope, /role="tablist"/, 'no inner tablist in the scope switcher');
  assert.match(scope, /role="group"/, 'plain toggle group');
  assert.match(scope, /aria-pressed/, 'pressed state on the toggle buttons');
});
