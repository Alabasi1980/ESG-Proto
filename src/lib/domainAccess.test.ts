// B17 U2-A — registry/§3 matrix coverage table test (no DB needed).
//
// The oracle below is transcribed independently from B17_TECHNICAL_SPEC.md §3
// (§4 for the four workspace rows). It pins, for every mounted declaration:
//   - no route without matrix data, no extra invented matrix entry;
//   - the exact allowed contexts (role×mode), tenant-bearing shape and
//     service/department notes of the §3 row;
//   - parse/format round-trip so a future edit cannot silently drop a tag/note.
// Mounted coverage comes from assertRegistryCoverage, which routes.ts runs at
// import time against the real Express routers.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ACCESS_REGISTRY,
  LEGACY_ROUTES,
  WORKSPACE_ROUTES,
  classifyRoute,
  formatMatrix,
  parseMatrix,
  type RouteDeclaration,
} from '../server/accessRegistry.ts';
import {
  assertRouteActivated,
  assertRouteContext,
  requireDomainAccess,
} from '../server/access.ts';
import type { AuthenticatedRequest } from '../server/auth.ts';
import type { AccessContext } from './capabilities.ts';

/** 'METHOD path' → exact §3 matrix string (canonical format). */
const EXPECTED: Record<string, string> = {
  // §3.1 system + session (8 active declarations)
  'GET /db/status': 'PUBLIC#connection-booleans-only;P#diagnostics-via-valid-tab',
  'POST /db/migrate': 'PUBLIC#always-409-migrations.offline_only-no-HTTP-DDL',
  'GET /setup/status': 'PUBLIC#minimal-canSetup-needsMigration-no-enumeration',
  'POST /setup/admin': 'PUBLIC#once-only-empty-install-existing-install-403-no-authenticated-escape',
  'POST /auth/login': 'PUBLIC#credentials-existing-gates-new-revocable-session',
  'POST /auth/logout': 'PUBLIC#idempotent-without-session;SESSION#revoke-session-and-tabs-clear-cookie',
  'GET /auth/me': 'SESSION#authoritative-identity-no-client-work-fail-closed',
  'POST /auth/change-password': 'SESSION#own-session-remediation-no-platform-capability',
  // §3.2 taxonomy (18) + GRI/dashboard (5)
  'GET /services': 'P#catalog;W:L;C:L;E:L+D#minimal-content-metadata',
  'GET /disclosures': 'P#catalog;W:L;C:L;E:L+D#no-empty-parents-or-foreign-counts',
  'GET /items': 'P#catalog;W:L;C:L;E:L+D#explicit-filters-narrow-never-broaden',
  'POST /services': 'P#global-service-configuration',
  'PATCH /services/:id': 'P#global-service-configuration',
  'POST /services/:id/duplicate': 'P#global-service-configuration',
  'POST /services/:id/standards': 'P#global-service-standard-mapping',
  'DELETE /services/:id/standards': 'P#global-service-standard-mapping',
  'PATCH /standards/:id': 'P#catalog',
  'DELETE /standards/:id': 'P#catalog-existing-dependency-refusals',
  'PATCH /disclosures/:id': 'P#catalog',
  'DELETE /disclosures/:id': 'P#catalog-existing-dependency-refusals',
  'POST /items': 'P#catalog-not-tenant-evaluation-creation',
  'PATCH /items/:id': 'P#catalog-existing-freeze-dependency-checks',
  'DELETE /items/:id': 'P#catalog-existing-dependency-refusals',
  'POST /items/:id/links': 'P#catalog-equivalence-mapping',
  'DELETE /items/:id/links': 'P#catalog-equivalence-mapping',
  'GET /items/:id/links':
    'P#catalog-metadata-only-no-tenant-overlay;W:L;C:L;E:L+D#both-ends-linked-own-department-state-only',
  // TASK-PROTO-U4-2-FIX P2: catalog create/bulk + full-service removal (P only).
  'POST /standards': 'P#catalog',
  'POST /disclosures': 'P#catalog',
  'POST /items/bulk': 'P#catalog',
  'DELETE /services/:id': 'P#global-service-configuration',
  'POST /gri/preview': 'P#authenticate-before-upload-parser',
  'POST /gri/commit': 'P@T#explicit-target-plus-linked-serviceId-no-implicit-service-grant',
  'GET /gri/template': 'P#fetch-with-auth-tab-then-download',
  'GET /standards': 'P#catalog;W:L;C:L;E:L+D#content-metadata-remove-optional-auth',
  'GET /dashboard/stats': 'W:L+V;C:L+V#no-P-E-or-anonymous-global-dashboard',
  // §3.3 evaluations (15)
  'GET /queue': 'W:L;C:L;E:L+D#tenant-always-resolved-never-nullable',
  'POST /evaluations': 'E:L+D#draft-save-only-no-C-W-P-fresh-evaluation',
  'POST /evaluations/:id/submit': 'E:R+L+D#author-or-designated-head-existing-version-state-gates',
  'POST /evaluations/:id/approve': 'E:R+L+D#head-gate-preliminary-department-approval-only',
  'POST /evaluations/:id/return': 'E:R+L+D#same-department-head-gate-required-reason-comment',
  'PUT /evaluations/:id/correct': 'W:R+L;E:R+L+D#author-reason-version-prefinal-rules-C-P-denied',
  'GET /evaluations': 'W:R+L;C:R+L;E:R+L+D#item-history-not-general-audit-or-foreign-department',
  'POST /evaluations/:id/client-approve':
    'C:R+L#own-company-all-departments-completeness-distinct-approver-OD-08',
  'POST /evaluations/:id/client-return':
    'C:R+L#own-company-all-departments-return-reopen-gates-OD-08',
  'GET /client-review': 'W:L;C:L#no-tenant-selector-in-view',
  'GET /reviews/ge-check': 'W:R+L#existing-disclosure-tenant-scope-types',
  'POST /reviews/ge-final':
    'W:R+L#explicit-confirmation-complete-distinct-actor-freeze-whole-scope-preflight',
  'GET /reviews/snapshots': 'W#own-tenant-only-safe-metadata-for-inaccessible-mixed-snapshots',
  'GET /reviews/snapshots/:id':
    'W:R#full-blob-only-if-entire-payload-item-set-L-else-403-scope.not_visible',
  'POST /reviews/snapshots/:id/notes': 'W:R#append-only-2000-char-cap-same-full-scope-authorization',
  // §3.4 admin (25)
  'GET /clients': 'P#searchable-safe-per-linked-service-progress;C#own-minimal-company-row-not-enumeration',
  'POST /clients': 'P#tenant-creation-no-implicit-services-assessments',
  'GET /departments':
    'P@T#configuration-target-required;W#own-departments;C#own-departments;E#own-department-metadata-only',
  'PATCH /departments/:id/head': 'P@T#target-department-employee-same-T-active-W-C-E-denied',
  'GET /users': 'P@T#explicit-T-for-tenant-users-or-platform-scope-for-GE-accounts',
  'POST /users': 'P@T#provisioning-same-tenant-department-unique-email-audit',
  'PATCH /users/:id': 'P@T#provisioning-deactivate-reactivate-self-refusal-revoke-sessions',
  'GET /ge/overview': 'P#operational-totals-only-no-scores-answers-gap-breakdowns',
  'GET /clients/:id':
    'P@T#configuration-projection-no-assessments-credentials;W#own-company-projection;C#own-company-projection',
  'PATCH /clients/:id': 'P#suspend-unsuspend-only-on-clients-list-rename-industry-config',
  'GET /clients/:id/services':
    'P@T#target-configuration;W#bound-tenant;C#bound-tenant;E#assigned-service-projection-only',
  'POST /clients/:id/services': 'P@T#link-configuration-validate-tenant-service-audit',
  'PATCH /clients/:id/services/:serviceId': 'P@T#visibility-flag-configuration-only',
  'DELETE /clients/:id/services/:serviceId':
    'P@T#unlink-preserve-business-rows-revoke-visibility-immediately',
  'POST /services/link-all':
    'P#explicit-bulk-link-confirmation-audit-never-automatic-startup-backfill',
  'GET /assignments': 'P@T#target-configuration;W:L;C:L;E:L+D',
  'POST /assignments': 'P@T#item-belong-to-linked-service-same-T-department-freeze-checks',
  'DELETE /assignments': 'P@T#existing-answer-evaluation-blockers-freeze-no-delete-data-workaround',
  'POST /assignments/na': 'W:R+L#existing-GE-N/A-shortcut-guards-P-denied-creates-evaluation',
  'GET /staff-lists': 'P@T#target-provisioning;W#bound-A;C#own-company',
  'POST /staff-lists': 'C#own-company;W#bound-A-draft-authority-no-provisioning',
  'POST /staff-lists/:id/submit': 'C:R;W:R#draft-nonempty-tenant-gates-no-provisioning',
  'POST /staff-lists/:id/approve':
    'P@T#provisioning-exception-explicit-T-checked-all-or-nothing-OTP-once-W-denied',
  'POST /staff-lists/:id/reject': 'P@T#explicit-T;W:R#bound-A-reason-submitted-list-gates-no-provisioning',
  'GET /client/dashboard': 'W:L+V;C:L+V#E-P-denied',
  // TASK-PROTO-U4-1a (OD-11): W-only client field-mask writer, exact body.
  'PATCH /workspace/services/:serviceId/visibility':
    'W#consultant-controls-client-visible-fields-own-tenant-only-exact-body-clientFieldMask',
  // §3.5 actions (3), initiatives/profile (7), reports (4)
  'GET /actions':
    'W:L;C:L#own-company-item-or-service-linked-owner-department-in-company-all-departments',
  'POST /actions': 'W#owner-department-in-A-linked-item-or-explicit-linked-service-for-standalone',
  'PATCH /actions/:id': 'W#existing-GE-transitions;C#owned-start-work-and-evidence-only-WF-04-reasons',
  'GET /initiatives':
    'P#library-definition-edit-mapping-no-client-assign;W#selected-only-plus-view=eligible-picker-for-A;C#selected-only-no-eligible-or-library-view',
  'POST /initiatives':
    'P#library-upsert-optional-explicit-serviceIds-no-implicit-grant-or-selection',
  'PATCH /initiatives/:id': 'P#library-mapping-maintenance',
  'POST /initiatives/select':
    'W#server-tenant-A-initiative-eligible-through-linked-service-supplied-clientId-must-agree-only-P-C-E-denied',
  'DELETE /initiatives/select/:id':
    'W#resolve-A-selection-plus-current-linked-eligibility-id-remains-initiativeId-no-B-mutation',
  'POST /esg-profile/import':
    'P@T#explicit-T-plus-linked-serviceId-freeze-natural-key-upsert-no-W-C-E',
  'GET /esg-profile':
    'W#own-service-bound-profile-rows-aggregate;C#own-service-bound-profile-rows-aggregate-P-E-denied',
  'GET /report-settings':
    'P@T#explicit-T-configuration;W:L;C:L#linked-service-read-not-settings-module-permission',
  'PUT /report-settings': 'P@T#D-038-explicit-T-plus-linked-serviceId-W-C-E-denied',
  'GET /reports/index': 'W:R+L+V;C:R+L+V#D-038-and-incomplete-index-errors-no-P-E',
  'GET /reports/export':
    'W:R+L+V;C:R+L+V#same-authorized-dataset-as-index-including-error-payloads-no-P-E',
  // §3.6 storage (5), audit (1), notifications (4)
  'POST /answers/:id/attachments': 'E:R+L+D#own-assigned-parent-no-C-answer-editing-no-W-P-filing',
  'GET /answers/:id/attachments': 'W:R+L;C:R+L;E:R+L+D#metadata-only',
  'GET /answers/:id/attachments/:attachId/download':
    'W:R+L;C:R+L;E:R+L+D#attachId-belongs-to-that-answer-no-guessed-file',
  'DELETE /answers/:id/attachments/:attachId':
    'E:R+L+D#own-assigned-parent-plus-uploader;W:R+L#scoped-GE-admin-delete-authority-C-P-denied-freeze-remains',
  'GET /storage/usage':
    'P@T#configuration-aggregate-only;W:L;C:L;E:L+D#inline-evidence-usage-no-storage-settings-module',
  'GET /audit-log':
    'P#platform-events-only-client_id-IS-NULL-no-global-client-payloads;W#mandatory-A-filter-C-E-denied-even-as-delegates',
  'GET /notifications':
    'P#own-platform-notifications;W#own-A-notifications;C#own-company-notifications-E-denied',
  'GET /notifications/unread-count': 'P;W;C#same-exact-scope-as-inbox',
  'POST /notifications/:id/read': 'P;W;C#same-scope-plus-notification-ownership-else-404',
  'POST /notifications/read-all': 'P;W;C#own-unread-rows-in-current-permitted-scope-only',
  // §3.7 platform-wide app settings (TASK-PROTO-H13): P only, no tenant row.
  'GET /settings': 'P#platform-app-theme-read-absent-row-is-auto-no-tenant-payload',
  'PUT /settings': 'P#platform-app-theme-writer-enum-validated-audited-auto-stores-null',
  // TASK-PROTO-U4-1c (OD-12 §3–§8): document requirements (P), the department
  // lists (P@T read / W-C linked read / E own-department) and the unified
  // evidence-file surface (E own-department writes).
  'GET /services/:id/documents': 'P@T#client-service-document-requirements-catalog',
  'POST /services/:id/documents': 'P@T#client-document-requirement-create',
  'PATCH /services/:id/documents/:reqId': 'P@T#client-document-requirement-update',
  'DELETE /services/:id/documents/:reqId': 'P@T#client-requirement-delete-fk-restrict-refusal',
  'GET /requirements': 'P@T#read-only-target;W:L;C:L;E:L+D#own-department-submission-state-and-proof-metadata',
  'PATCH /requirements/:id': 'E:L+D#own-department-provided-note-tag-only-no-W-C-P-write',
  'POST /evidence/:entityType/:entityId/files': 'E:L+D#own-department-own-parent-5MB-mime-allowlist',
  'GET /evidence/:entityType/:entityId/files/:fileId/download': 'P@T#target-scope;W:L;C:L;E:L+D#parent-bound-no-guessed-file',
  'DELETE /evidence/:entityType/:entityId/files/:fileId': 'E:L+D#own-upload-own-department-locked-once-parent-submitted',
  'GET /initiatives/department': 'P@T#read-only-target;W:L;C:L;E:L+D#own-department-status-and-proof-metadata',
  'PATCH /initiatives/department/:id': 'E:L+D#performed-note-own-department-only',
  // §4 workspace lifecycle (4)
  'POST /workspace/tab': 'GE#fresh-GE-session-no-client-input-creates-P-row-generation-1',
  'GET /workspace': 'GE#tab-handle-reconcile-authoritative-envelope-no-broad-data',
  'POST /workspace/enter': 'P@T#platform-handle-plus-explicit-clientId-validated-atomically-P-to-W',
  'POST /workspace/exit': 'P;W#idempotent-from-platform-consultant-exits-to-platform-audited',
};

const key = (route: { method: string; path: string }) => `${route.method} ${route.path}`;

test('U2-A matrix oracle: every registry declaration matches its exact §3/§4 row, both directions', () => {
  const actualKeys = ACCESS_REGISTRY.map(key).sort();
  const expectedKeys = Object.keys(EXPECTED).sort();
  assert.deepEqual(actualKeys, expectedKeys,
    'registry keys must equal the §3 rows exactly (no route without an entry, no extra invented entry)');
  for (const route of ACCESS_REGISTRY) {
    assert.equal(formatMatrix(route.matrix), EXPECTED[key(route)],
      `matrix drift for ${key(route)}`);
    assert.ok(route.matrix.length > 0, `empty matrix for ${key(route)}`);
  }
});

test('U2-F final activation split: 0 UNACTIVATED; exact 105 business flips + 8 system/session + 4 workspace', () => {
  assert.equal(LEGACY_ROUTES.length, 113);
  assert.equal(LEGACY_ROUTES.filter((r) => r.activation === 'UNACTIVATED').length, 0);
  assert.equal(LEGACY_ROUTES.filter((r) => r.activation === 'U1').length, 113);
  assert.equal(WORKSPACE_ROUTES.length, 4);
  assert.ok(WORKSPACE_ROUTES.every((r) => r.activation === 'U1'));
  // Exactly the 13 U2-B + 23 U2-C + 11 U2-D + 15 U2-E + 22 U2-F round-1 + 3
  // U2-F round-2 rows are flipped, and nothing else moved: the eight
  // system/session rows plus those eighty-seven are the complete U1 legacy set
  // (no other registry row changed, task §2). All 3 rows of the §3.4
  // provisioning triple are now behind the R2-A substrate + lock-order proof.
  const FLIPPED = [
    'GET /audit-log',
    'GET /notifications', 'GET /notifications/unread-count',
    'POST /notifications/:id/read', 'POST /notifications/read-all',
    'POST /answers/:id/attachments', 'GET /answers/:id/attachments',
    'GET /answers/:id/attachments/:attachId/download',
    'DELETE /answers/:id/attachments/:attachId', 'GET /storage/usage',
    'GET /actions', 'POST /actions', 'PATCH /actions/:id',
    'GET /services', 'GET /disclosures', 'GET /items',
    'POST /services', 'PATCH /services/:id', 'POST /services/:id/duplicate',
    'POST /services/:id/standards', 'DELETE /services/:id/standards',
    'PATCH /standards/:id', 'DELETE /standards/:id',
    'PATCH /disclosures/:id', 'DELETE /disclosures/:id',
    'POST /items', 'PATCH /items/:id', 'DELETE /items/:id',
    'POST /items/:id/links', 'DELETE /items/:id/links', 'GET /items/:id/links',
    // TASK-PROTO-U4-2-FIX P2: the four P-only catalog rows (create/bulk + service removal).
    'POST /standards', 'POST /disclosures', 'POST /items/bulk', 'DELETE /services/:id',
    'POST /gri/preview', 'POST /gri/commit', 'GET /gri/template',
    'GET /standards', 'GET /dashboard/stats',
    'GET /initiatives', 'POST /initiatives', 'PATCH /initiatives/:id',
    'POST /initiatives/select', 'DELETE /initiatives/select/:id',
    'POST /esg-profile/import', 'GET /esg-profile',
    'GET /report-settings', 'PUT /report-settings', 'GET /reports/index', 'GET /reports/export',
    // U2-E E-1: the six evaluations/reviews READ declarations.
    'GET /queue', 'GET /evaluations', 'GET /client-review',
    'GET /reviews/ge-check', 'GET /reviews/snapshots', 'GET /reviews/snapshots/:id',
    // U2-E E-2: the nine evaluations/reviews WRITE declarations.
    'POST /evaluations', 'POST /evaluations/:id/submit', 'POST /evaluations/:id/approve',
    'POST /evaluations/:id/return', 'PUT /evaluations/:id/correct',
    'POST /evaluations/:id/client-approve', 'POST /evaluations/:id/client-return',
    'POST /reviews/ge-final', 'POST /reviews/snapshots/:id/notes',
    // U2-F round 1: the 22 NON-provisioning §3.4 admin declarations.
    'GET /clients', 'POST /clients', 'GET /departments', 'PATCH /departments/:id/head',
    'GET /users', 'GET /ge/overview', 'GET /clients/:id', 'PATCH /clients/:id',
    'GET /clients/:id/services', 'POST /clients/:id/services',
    'PATCH /clients/:id/services/:serviceId', 'DELETE /clients/:id/services/:serviceId',
    'POST /services/link-all', 'GET /assignments', 'POST /assignments', 'DELETE /assignments',
    'POST /assignments/na', 'GET /staff-lists', 'POST /staff-lists', 'POST /staff-lists/:id/submit',
    'POST /staff-lists/:id/reject', 'GET /client/dashboard',
    // U2-F round 2 (final): the provisioning triple behind the R2-A substrate
    // (platformConfigContext + users INSERT/UPDATE + provisioning audit) and
    // the §3(2) lock-order proof (parent §15).
    'POST /users', 'PATCH /users/:id', 'POST /staff-lists/:id/approve',
    // TASK-PROTO-H13: the P-only platform settings pair (app_settings).
    'GET /settings', 'PUT /settings',
    // TASK-PROTO-U4-1a: the W-only client-visibility writer.
    'PATCH /workspace/services/:serviceId/visibility',
    // TASK-PROTO-U4-1c: the department document list, the unified evidence-file
    // surface and the department initiative status (11 rows, appended last).
    'GET /services/:id/documents', 'POST /services/:id/documents',
    'PATCH /services/:id/documents/:reqId', 'DELETE /services/:id/documents/:reqId',
    'GET /requirements', 'PATCH /requirements/:id',
    'POST /evidence/:entityType/:entityId/files',
    'GET /evidence/:entityType/:entityId/files/:fileId/download',
    'DELETE /evidence/:entityType/:entityId/files/:fileId',
    'GET /initiatives/department', 'PATCH /initiatives/department/:id',
  ];
  assert.equal(FLIPPED.length, 105);
  assert.deepEqual(
    LEGACY_ROUTES.filter((r) => r.activation === 'U1').map((r) => `${r.method} ${r.path}`).sort(),
    [
      'GET /db/status', 'POST /db/migrate', 'GET /setup/status', 'POST /setup/admin',
      'POST /auth/login', 'POST /auth/logout', 'GET /auth/me', 'POST /auth/change-password',
      ...FLIPPED,
    ].sort(),
  );
});

test('U2-F: all twenty-five §3.4 admin rows activated; zero UNACTIVATED legacy rows remain', () => {
  const EVALUATIONS = ['GET /queue', 'POST /evaluations', 'POST /evaluations/:id/submit',
    'POST /evaluations/:id/approve', 'POST /evaluations/:id/return', 'PUT /evaluations/:id/correct',
    'GET /evaluations', 'POST /evaluations/:id/client-approve', 'POST /evaluations/:id/client-return',
    'GET /client-review', 'GET /reviews/ge-check', 'POST /reviews/ge-final',
    'GET /reviews/snapshots', 'GET /reviews/snapshots/:id', 'POST /reviews/snapshots/:id/notes'];
  const byKey = new Map(LEGACY_ROUTES.map((r) => [`${r.method} ${r.path}`, r]));
  assert.equal(EVALUATIONS.length, 15, 'the §3.3 evaluations group is still fifteen declarations');
  for (const key of EVALUATIONS) {
    assert.equal(byKey.get(key)?.activation, 'U1', `${key} must be activated`);
    // Matrix strings are transcribed data, never reworded by a flip.
    assert.ok((byKey.get(key)?.matrix.length ?? 0) > 0, key);
  }
  const remaining = LEGACY_ROUTES.filter((r) => r.activation === 'UNACTIVATED');
  assert.equal(remaining.length, 0, 'U2-F round 2 completes the flip: 3 → 0 exactly');
  assert.deepEqual(remaining.map((r) => `${r.method} ${r.path}`), [],
    'no legacy declaration is denied any more (the §3.4 provisioning triple flipped last)');
});

test('U2-A matrix well-formedness: parse/format round-trip and tenant/tag invariants', () => {
  for (const route of ACCESS_REGISTRY) {
    const spec = EXPECTED[key(route)];
    assert.deepEqual(parseMatrix(spec), [...route.matrix], `parse drift for ${key(route)}`);
    assert.equal(formatMatrix(parseMatrix(spec)), spec, `format drift for ${key(route)}`);
    for (const rule of route.matrix) {
      if (rule.context === 'P') assert.ok(rule.tenant === 'none' || rule.tenant === 'explicit');
      else if (rule.context === 'W' || rule.context === 'C' || rule.context === 'E')
        assert.equal(rule.tenant, 'own', `${key(route)} tenant`);
      else assert.equal(rule.tenant, 'none');
      for (const tag of rule.tags) assert.ok(['L', 'D', 'V', 'R'].includes(tag));
    }
  }
  assert.throws(() => parseMatrix('X'), /access\.matrix_context/);
  assert.throws(() => parseMatrix('W@T'), /access\.matrix_target/);
  assert.throws(() => parseMatrix('P:Z'), /access\.matrix_tag/);
});

test('U2-A mounted declarations are covered (routes.ts runs assertRegistryCoverage at import)', async () => {
  await import('../server/routes.ts');
  // Reaching this line means assertRegistryCoverage passed against every real
  // Express router: mounted method/path set === ACCESS_REGISTRY, no duplicates.
  assert.equal(ACCESS_REGISTRY.length, 117);
});

// ---------------------------------------------------------------------------
// SHIELD-U2A-01 / SHIELD-U2A-02 (task §17, mandatory U2-B round-1 edits).
// ---------------------------------------------------------------------------

const fakeCall = async (method: string, path: string) => {
  const req = { method, path } as unknown as AuthenticatedRequest;
  const res = {
    statusCode: 0 as number | undefined, body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  let nexted = false;
  await requireDomainAccess(req, res as never, (() => { nexted = true; }) as never);
  return { nexted, statusCode: res.statusCode, body: res.body as { error?: string; code?: string } };
};

test('SHIELD-U2A-01: requireDomainAccess itself refuses non-U1 activation before deriving any context', async () => {
  // U2-F round 2 drove the legacy UNACTIVATED set to ZERO, so no REAL
  // declaration exercises this ring any more. The refusal itself must stay
  // fail-closed for any future flip: prove it on a SYNTHETIC unactivated
  // declaration (pure, no DB) plus the wrapper's own unknown-route arm.
  const synthetic: RouteDeclaration = {
    method: 'POST', path: '/synthetic-unactivated', activation: 'UNACTIVATED',
    capability: 'admin', matrix: parseMatrix('P@T#synthetic-round-2-pin'),
  };
  assert.throws(() => assertRouteActivated(synthetic),
    (err: { statusCode?: number; code?: string }) =>
      err.statusCode === 403 && err.code === 'access.unactivated',
    'a fabricated UNACTIVATED declaration must be refused by the wrapper itself');
  const unknown = await fakeCall('GET', '/unknown');
  assert.equal(unknown.nexted, false, '/unknown must not reach a handler');
  assert.deepEqual([unknown.statusCode, unknown.body.code], [404, 'api.not_found']);
  // Activated declarations pass the wrapper's own gate (no throw) — including
  // the U2-F round-2 provisioning triple (POST /users, PATCH /users/:id,
  // POST /staff-lists/:id/approve).
  for (const route of ACCESS_REGISTRY.filter(r => r.activation === 'U1')) {
    assert.doesNotThrow(() => assertRouteActivated(route), `${route.method} ${route.path}`);
  }
  // Vacuous by design at 0 rows — the shape is retained so a future partial
  // flip re-proves the refusal loop instead of silently skipping it.
  const stillDenied = LEGACY_ROUTES.filter(r => r.activation === 'UNACTIVATED');
  assert.equal(stillDenied.length, 0, 'zero UNACTIVATED legacy rows after U2-F round 2');
  for (const route of stillDenied) {
    assert.throws(() => assertRouteActivated(route), (err: { statusCode?: number; code?: string }) =>
      err.statusCode === 403 && err.code === 'access.unactivated', `${route.method} ${route.path}`);
  }
});

const UUID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UUID_D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const contextFor = (mode: 'platform' | 'consultant' | 'client' | 'employee'): AccessContext => {
  const base = { actorId: UUID_A, sessionId: UUID_A, capability: 'probe' };
  if (mode === 'platform') return { ...base, role: 'ge_admin', mode, tenantId: null,
    departmentId: null, tabId: UUID_A, generation: 1 };
  if (mode === 'consultant') return { ...base, role: 'ge_admin', mode, tenantId: UUID_A,
    departmentId: null, tabId: UUID_A, generation: 1 };
  if (mode === 'client') return { ...base, role: 'client_admin', mode, tenantId: UUID_A,
    departmentId: null, tabId: null, generation: null };
  return { ...base, role: 'employee', mode, tenantId: UUID_A, departmentId: UUID_D,
    tabId: null, generation: null };
};

test('SHIELD-U2A-02: every derived mode/tenant is checked against the route\'s §3 matrix row', () => {
  const MODES = ['platform', 'consultant', 'client', 'employee'] as const;
  let allowed = 0, refused = 0;
  for (const route of ACCESS_REGISTRY) {
    const expected = parseMatrix(EXPECTED[key(route)]);
    for (const mode of MODES) {
      const access = contextFor(mode);
      const caller = { platform: 'P', consultant: 'W', client: 'C', employee: 'E' }[mode];
      const permit = expected.some(rule => rule.context === caller
        || (rule.context === 'GE' && access.role === 'ge_admin')
        || rule.context === 'PUBLIC' || rule.context === 'SESSION');
      if (permit) {
        assert.doesNotThrow(() => assertRouteContext(route, access),
          `${route.method} ${route.path} / ${mode} must be admitted`);
        allowed++;
      } else {
        assert.throws(() => assertRouteContext(route, access),
          (err: { statusCode?: number; code?: string }) =>
            err.statusCode === 403 && err.code === 'workspace.mode_mismatch',
          `${route.method} ${route.path} / ${mode} must be 403 workspace.mode_mismatch`);
        refused++;
      }
    }
  }
  assert.ok(allowed > 0 && refused > 0, 'the matrix table must exercise both outcomes');
  // The two directions named by task §17, on real registry rows.
  const platformTab = contextFor('platform'), consultantTab = contextFor('consultant');
  const wOnly = classifyRoute('POST', '/actions')!;        // §3.5: W only
  const pOnly = classifyRoute('POST', '/initiatives')!;    // §3.5: P only
  const pAndW = classifyRoute('GET', '/audit-log')!;       // §3.6: P;W — C/E denied
  assert.throws(() => assertRouteContext(wOnly, platformTab),
    (err: { statusCode?: number; code?: string }) => err.code === 'workspace.mode_mismatch');
  assert.throws(() => assertRouteContext(pOnly, consultantTab),
    (err: { statusCode?: number; code?: string }) => err.code === 'workspace.mode_mismatch');
  assert.doesNotThrow(() => assertRouteContext(pAndW, platformTab));
  assert.doesNotThrow(() => assertRouteContext(pAndW, consultantTab));
  assert.throws(() => assertRouteContext(pAndW, contextFor('client')),
    (err: { code?: string }) => err.code === 'workspace.mode_mismatch');
  assert.throws(() => assertRouteContext(pAndW, contextFor('employee')),
    (err: { code?: string }) => err.code === 'workspace.mode_mismatch');
  // Tenant shape must agree with the mode: platform without tenant, W/C/E with one.
  assert.throws(() => assertRouteContext(pAndW, { ...platformTab, tenantId: UUID_A }),
    (err: { code?: string }) => err.code === 'workspace.mode_mismatch');
  assert.throws(() => assertRouteContext(pAndW, { ...consultantTab, tenantId: null }),
    (err: { code?: string }) => err.code === 'workspace.mode_mismatch');
  const eRow = classifyRoute('POST', '/answers/2f9d5a1e-0000-4000-8000-000000000001/attachments')!;
  assert.throws(() => assertRouteContext(eRow, { ...contextFor('employee'), departmentId: null }),
    (err: { code?: string }) => err.code === 'workspace.mode_mismatch');
});

test('SHIELD-U2A-02: the wrapper\'s GE tab read uses the same FOR UPDATE lock as withWorkspace', () => {
  const source = readFileSync('src/server/access.ts', 'utf8');
  const locked = [...source.matchAll(/FROM workspace_tabs[^`]*`/g)].map(match => match[0]);
  assert.equal(locked.length, 2, 'withWorkspace and deriveDomainAccess each read the tab exactly once');
  for (const query of locked) assert.match(query, /FOR UPDATE/,
    'GE context attachment must lock the tab row like withWorkspace (task §17 SHIELD-U2A-02)');
});
