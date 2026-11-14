// B17 U2-A: one row per existing declaration + the exact §3 domain matrix as data
// (spec §3 tables; §4 rows for the workspace lifecycle). Activation stays an
// explicit per-sub-unit flip: correct matrix data alone never activates a route,
// and the dispatcher pre-check in access.ts keeps denying UNACTIVATED routes.

/** Role×mode contexts. P/W = ge_admin platform/consultant tab; C = client_admin; E = employee. */
export type MatrixContext = 'PUBLIC' | 'SESSION' | 'GE' | 'P' | 'W' | 'C' | 'E';
/** §3 predicate tags: L linked-service, D own-department+assignment, V visibility flags, R resource ownership. */
export type MatrixTag = 'L' | 'D' | 'V' | 'R';

export interface ContextRule {
  context: MatrixContext;
  /** P: none = platform-global, explicit = named validated target T. W/C/E: own server-derived tenant. */
  tenant: 'none' | 'explicit' | 'own';
  tags: readonly MatrixTag[];
  /** Short §3 service/department/flow note where the row specifies one. */
  note?: string;
}

export interface RouteDeclaration {
  method: string;
  path: string;
  activation: 'U1' | 'UNACTIVATED';
  capability: string;
  matrix: readonly ContextRule[];
}

const CONTEXTS: readonly MatrixContext[] = ['PUBLIC', 'SESSION', 'GE', 'P', 'W', 'C', 'E'];
const TAGS: readonly MatrixTag[] = ['L', 'D', 'V', 'R'];

/** Format: `CONTEXT[@T][:L+D][#note]`, rules joined by `;` (e.g. `W:L;C:L;E:L+D#tenant-never-nullable`). */
export function parseMatrix(spec: string): ContextRule[] {
  return spec.split(';').map((part) => {
    const hash = part.indexOf('#');
    const head = hash === -1 ? part : part.slice(0, hash);
    const note = hash === -1 ? undefined : part.slice(hash + 1);
    const colon = head.indexOf(':');
    const rawContext = colon === -1 ? head : head.slice(0, colon);
    const rawTags = colon === -1 ? '' : head.slice(colon + 1);
    const explicit = rawContext.endsWith('@T');
    const context = (explicit ? rawContext.slice(0, -2) : rawContext) as MatrixContext;
    if (!CONTEXTS.includes(context)) throw new Error(`access.matrix_context:${rawContext}`);
    if (explicit && context !== 'P') throw new Error(`access.matrix_target:${rawContext}`);
    const tags = rawTags ? (rawTags.split('+') as MatrixTag[]) : [];
    for (const tag of tags) if (!TAGS.includes(tag)) throw new Error(`access.matrix_tag:${tag}`);
    const tenant: ContextRule['tenant'] = explicit ? 'explicit'
      : context === 'W' || context === 'C' || context === 'E' ? 'own' : 'none';
    return { context, tenant, tags, ...(note ? { note } : {}) };
  });
}

export function formatMatrix(rules: readonly ContextRule[]): string {
  return rules.map((rule) => {
    const head = rule.context + (rule.tenant === 'explicit' ? '@T' : '')
      + (rule.tags.length ? `:${rule.tags.join('+')}` : '');
    return rule.note ? `${head}#${rule.note}` : head;
  }).join(';');
}

// `active` is either a blanket boolean (every declaration of the group) or the
// EXACT set of `METHOD path` keys to flip (U2-E E-1: six evaluations READ rows
// only, task §2 — the nine write rows of the same group stay UNACTIVATED).
// An unknown key is a typo, never a silent no-op: it fails closed here.
const group = (capability: string, entries: readonly string[],
  active: boolean | readonly string[] = false): RouteDeclaration[] => {
  const named: readonly string[] | null = Array.isArray(active) ? active as readonly string[] : null;
  const flipped = new Set<string>();
  const rows: RouteDeclaration[] = entries.map((entry) => {
    const [route, matrix] = entry.split('|');
    if (!matrix) throw new Error(`access.matrix_missing:${route}`);
    const [method, path] = route.split(' ');
    const key = `${method} ${path}`;
    const on = active === true || (named !== null && named.includes(key));
    if (on) flipped.add(key);
    return { method, path, capability, activation: on ? 'U1' : 'UNACTIVATED', matrix: parseMatrix(matrix) };
  });
  if (named && flipped.size !== named.length) throw new Error('access.activation_unknown');
  return rows;
};

// One row per existing declaration, deliberately separate from future role eligibility.
// Matrix strings transcribed from B17_TECHNICAL_SPEC.md §3 (§4 for workspace rows).
export const LEGACY_ROUTES: readonly RouteDeclaration[] = [
  ...group('system', [
    'GET /db/status|PUBLIC#connection-booleans-only;P#diagnostics-via-valid-tab',
    'POST /db/migrate|PUBLIC#always-409-migrations.offline_only-no-HTTP-DDL',
    'GET /setup/status|PUBLIC#minimal-canSetup-needsMigration-no-enumeration',
    'POST /setup/admin|PUBLIC#once-only-empty-install-existing-install-403-no-authenticated-escape',
  ], true),
  ...group('session', [
    'POST /auth/login|PUBLIC#credentials-existing-gates-new-revocable-session',
    'POST /auth/logout|PUBLIC#idempotent-without-session;SESSION#revoke-session-and-tabs-clear-cookie',
    'GET /auth/me|SESSION#authoritative-identity-no-client-work-fail-closed',
    'POST /auth/change-password|SESSION#own-session-remediation-no-platform-capability',
  ], true),
  ...group('taxonomy', [
    'GET /services|P#catalog;W:L;C:L;E:L+D#minimal-content-metadata',
    'GET /disclosures|P#catalog;W:L;C:L;E:L+D#no-empty-parents-or-foreign-counts',
    'GET /items|P#catalog;W:L;C:L;E:L+D#explicit-filters-narrow-never-broaden',
    'POST /services|P#global-service-configuration',
    'PATCH /services/:id|P#global-service-configuration',
    'POST /services/:id/duplicate|P#global-service-configuration',
    'POST /services/:id/standards|P#global-service-standard-mapping',
    'DELETE /services/:id/standards|P#global-service-standard-mapping',
    'PATCH /standards/:id|P#catalog',
    'DELETE /standards/:id|P#catalog-existing-dependency-refusals',
    'PATCH /disclosures/:id|P#catalog',
    'DELETE /disclosures/:id|P#catalog-existing-dependency-refusals',
    'POST /items|P#catalog-not-tenant-evaluation-creation',
    'PATCH /items/:id|P#catalog-existing-freeze-dependency-checks',
    'DELETE /items/:id|P#catalog-existing-dependency-refusals',
    'POST /items/:id/links|P#catalog-equivalence-mapping',
    'DELETE /items/:id/links|P#catalog-equivalence-mapping',
    'GET /items/:id/links|P#catalog-metadata-only-no-tenant-overlay;W:L;C:L;E:L+D#both-ends-linked-own-department-state-only',
  ], true),
  ...group('gri', [
    'POST /gri/preview|P#authenticate-before-upload-parser',
    'POST /gri/commit|P@T#explicit-target-plus-linked-serviceId-no-implicit-service-grant',
    'GET /gri/template|P#fetch-with-auth-tab-then-download',
    'GET /standards|P#catalog;W:L;C:L;E:L+D#content-metadata-remove-optional-auth',
    'GET /dashboard/stats|W:L+V;C:L+V#no-P-E-or-anonymous-global-dashboard',
  ], true),
  ...group('evaluations', [
    'GET /queue|W:L;C:L;E:L+D#tenant-always-resolved-never-nullable',
    'POST /evaluations|E:L+D#draft-save-only-no-C-W-P-fresh-evaluation',
    'POST /evaluations/:id/submit|E:R+L+D#author-or-designated-head-existing-version-state-gates',
    'POST /evaluations/:id/approve|E:R+L+D#head-gate-preliminary-department-approval-only',
    'POST /evaluations/:id/return|E:R+L+D#same-department-head-gate-required-reason-comment',
    'PUT /evaluations/:id/correct|W:R+L;E:R+L+D#author-reason-version-prefinal-rules-C-P-denied',
    'GET /evaluations|W:R+L;C:R+L;E:R+L+D#item-history-not-general-audit-or-foreign-department',
    'POST /evaluations/:id/client-approve|C:R+L#own-company-all-departments-completeness-distinct-approver-OD-08',
    'POST /evaluations/:id/client-return|C:R+L#own-company-all-departments-return-reopen-gates-OD-08',
    'GET /client-review|W:L;C:L#no-tenant-selector-in-view',
    'GET /reviews/ge-check|W:R+L#existing-disclosure-tenant-scope-types',
    'POST /reviews/ge-final|W:R+L#explicit-confirmation-complete-distinct-actor-freeze-whole-scope-preflight',
    'GET /reviews/snapshots|W#own-tenant-only-safe-metadata-for-inaccessible-mixed-snapshots',
    'GET /reviews/snapshots/:id|W:R#full-blob-only-if-entire-payload-item-set-L-else-403-scope.not_visible',
    'POST /reviews/snapshots/:id/notes|W:R#append-only-2000-char-cap-same-full-scope-authorization',
  ], [
    // U2-E E-2 (task §2): ALL fifteen §3.3 evaluations/reviews declarations are
    // now retrofitted (6 reads in E-1 + 9 writes here) — 34 → 25 UNACTIVATED.
    // Listed explicitly so the flip set stays auditable and a typo in a key
    // fails closed (access.activation_unknown) instead of silently flipping.
    'GET /queue', 'POST /evaluations', 'POST /evaluations/:id/submit',
    'POST /evaluations/:id/approve', 'POST /evaluations/:id/return',
    'PUT /evaluations/:id/correct', 'GET /evaluations',
    'POST /evaluations/:id/client-approve', 'POST /evaluations/:id/client-return',
    'GET /client-review', 'GET /reviews/ge-check', 'POST /reviews/ge-final',
    'GET /reviews/snapshots', 'GET /reviews/snapshots/:id', 'POST /reviews/snapshots/:id/notes',
  ]),
  ...group('admin', [
    'GET /clients|P#searchable-safe-per-linked-service-progress;C#own-minimal-company-row-not-enumeration',
    'POST /clients|P#tenant-creation-no-implicit-services-assessments',
    'GET /departments|P@T#configuration-target-required;W#own-departments;C#own-departments;E#own-department-metadata-only',
    'PATCH /departments/:id/head|P@T#target-department-employee-same-T-active-W-C-E-denied',
    'GET /users|P@T#explicit-T-for-tenant-users-or-platform-scope-for-GE-accounts',
    'POST /users|P@T#provisioning-same-tenant-department-unique-email-audit',
    'PATCH /users/:id|P@T#provisioning-deactivate-reactivate-self-refusal-revoke-sessions',
    'GET /ge/overview|P#operational-totals-only-no-scores-answers-gap-breakdowns',
    'GET /clients/:id|P@T#configuration-projection-no-assessments-credentials;W#own-company-projection;C#own-company-projection',
    'PATCH /clients/:id|P#suspend-unsuspend-only-on-clients-list-rename-industry-config',
    'GET /clients/:id/services|P@T#target-configuration;W#bound-tenant;C#bound-tenant;E#assigned-service-projection-only',
    'POST /clients/:id/services|P@T#link-configuration-validate-tenant-service-audit',
    'PATCH /clients/:id/services/:serviceId|P@T#visibility-flag-configuration-only',
    'DELETE /clients/:id/services/:serviceId|P@T#unlink-preserve-business-rows-revoke-visibility-immediately',
    'POST /services/link-all|P#explicit-bulk-link-confirmation-audit-never-automatic-startup-backfill',
    'GET /assignments|P@T#target-configuration;W:L;C:L;E:L+D',
    'POST /assignments|P@T#item-belong-to-linked-service-same-T-department-freeze-checks',
    'DELETE /assignments|P@T#existing-answer-evaluation-blockers-freeze-no-delete-data-workaround',
    'POST /assignments/na|W:R+L#existing-GE-N/A-shortcut-guards-P-denied-creates-evaluation',
    'GET /staff-lists|P@T#target-provisioning;W#bound-A;C#own-company',
    'POST /staff-lists|C#own-company;W#bound-A-draft-authority-no-provisioning',
    'POST /staff-lists/:id/submit|C:R;W:R#draft-nonempty-tenant-gates-no-provisioning',
    'POST /staff-lists/:id/approve|P@T#provisioning-exception-explicit-T-checked-all-or-nothing-OTP-once-W-denied',
    'POST /staff-lists/:id/reject|P@T#explicit-T;W:R#bound-A-reason-submitted-list-gates-no-provisioning',
    'GET /client/dashboard|W:L+V;C:L+V#E-P-denied',
  ], [
    // U2-F (task §2): ALL TWENTY-FIVE §3.4 admin rows are retrofitted —
    // round 1 flipped the 22 non-provisioning rows (25 -> 3), ROUND 2 (final)
    // flips the provisioning triple behind the R2-A substrate + §3(2) lock-order
    // proof (3 -> 0). Listed explicitly so a typo in a key fails closed
    // (access.activation_unknown) instead of silently flipping, and so the
    // matrix strings above stay transcribed data no flip may reword.
    'GET /clients', 'POST /clients', 'GET /departments', 'PATCH /departments/:id/head',
    'GET /users', 'POST /users', 'PATCH /users/:id', 'GET /ge/overview',
    'GET /clients/:id', 'PATCH /clients/:id',
    'GET /clients/:id/services', 'POST /clients/:id/services',
    'PATCH /clients/:id/services/:serviceId', 'DELETE /clients/:id/services/:serviceId',
    'POST /services/link-all', 'GET /assignments', 'POST /assignments', 'DELETE /assignments',
    'POST /assignments/na', 'GET /staff-lists', 'POST /staff-lists', 'POST /staff-lists/:id/submit',
    'POST /staff-lists/:id/approve', 'POST /staff-lists/:id/reject', 'GET /client/dashboard',
  ]),
  ...group('actions', [
    'GET /actions|W:L;C:L#own-company-item-or-service-linked-owner-department-in-company-all-departments',
    'POST /actions|W#owner-department-in-A-linked-item-or-explicit-linked-service-for-standalone',
    'PATCH /actions/:id|W#existing-GE-transitions;C#owned-start-work-and-evidence-only-WF-04-reasons',
  ], true),
  ...group('initiatives', [
    'GET /initiatives|P#library-definition-edit-mapping-no-client-assign;W#selected-only-plus-view=eligible-picker-for-A;C#selected-only-no-eligible-or-library-view',
    'POST /initiatives|P#library-upsert-optional-explicit-serviceIds-no-implicit-grant-or-selection',
    'PATCH /initiatives/:id|P#library-mapping-maintenance',
    'POST /initiatives/select|W#server-tenant-A-initiative-eligible-through-linked-service-supplied-clientId-must-agree-only-P-C-E-denied',
    'DELETE /initiatives/select/:id|W#resolve-A-selection-plus-current-linked-eligibility-id-remains-initiativeId-no-B-mutation',
    'POST /esg-profile/import|P@T#explicit-T-plus-linked-serviceId-freeze-natural-key-upsert-no-W-C-E',
    'GET /esg-profile|W#own-service-bound-profile-rows-aggregate;C#own-service-bound-profile-rows-aggregate-P-E-denied',
  ], true),
  ...group('reports', [
    'GET /report-settings|P@T#explicit-T-configuration;W:L;C:L#linked-service-read-not-settings-module-permission',
    'PUT /report-settings|P@T#D-038-explicit-T-plus-linked-serviceId-W-C-E-denied',
    'GET /reports/index|W:R+L+V;C:R+L+V#D-038-and-incomplete-index-errors-no-P-E',
    'GET /reports/export|W:R+L+V;C:R+L+V#same-authorized-dataset-as-index-including-error-payloads-no-P-E',
  ], true),
  ...group('storage', [
    'POST /answers/:id/attachments|E:R+L+D#own-assigned-parent-no-C-answer-editing-no-W-P-filing',
    'GET /answers/:id/attachments|W:R+L;C:R+L;E:R+L+D#metadata-only',
    'GET /answers/:id/attachments/:attachId/download|W:R+L;C:R+L;E:R+L+D#attachId-belongs-to-that-answer-no-guessed-file',
    'DELETE /answers/:id/attachments/:attachId|E:R+L+D#own-assigned-parent-plus-uploader;W:R+L#scoped-GE-admin-delete-authority-C-P-denied-freeze-remains',
    'GET /storage/usage|P@T#configuration-aggregate-only;W:L;C:L;E:L+D#inline-evidence-usage-no-storage-settings-module',
  ], true),
  ...group('audit', [
    'GET /audit-log|P#platform-events-only-client_id-IS-NULL-no-global-client-payloads;W#mandatory-A-filter-C-E-denied-even-as-delegates',
  ], true),
  ...group('notifications', [
    'GET /notifications|P#own-platform-notifications;W#own-A-notifications;C#own-company-notifications-E-denied',
    'GET /notifications/unread-count|P;W;C#same-exact-scope-as-inbox',
    'POST /notifications/:id/read|P;W;C#same-scope-plus-notification-ownership-else-404',
    'POST /notifications/read-all|P;W;C#own-unread-rows-in-current-permitted-scope-only',
  ], true),
];
export const WORKSPACE_ROUTES = group('workspace', [
  'POST /workspace/tab|GE#fresh-GE-session-no-client-input-creates-P-row-generation-1',
  'GET /workspace|GE#tab-handle-reconcile-authoritative-envelope-no-broad-data',
  'POST /workspace/enter|P@T#platform-handle-plus-explicit-clientId-validated-atomically-P-to-W',
  'POST /workspace/exit|P;W#idempotent-from-platform-consultant-exits-to-platform-audited',
], true);
export const ACCESS_REGISTRY = [...LEGACY_ROUTES, ...WORKSPACE_ROUTES];

const patterns = ACCESS_REGISTRY.map(route => ({ route, pattern: new RegExp('^' + route.path.split('/')
  .map(segment => segment.startsWith(':') ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('/') + '/?$', 'i') }));
export function classifyRoute(method: string, path: string): RouteDeclaration | undefined {
  return patterns.find(({ route, pattern }) => route.method === (method === 'HEAD' ? 'GET' : method)
    && pattern.test(path))?.route;
}

export function assertRegistryCoverage(routers: readonly { stack: any[] }[]): void {
  const actual = routers.flatMap(router => router.stack.filter(layer => layer.route).flatMap(layer =>
    Object.keys(layer.route.methods).map(method => `${method.toUpperCase()} ${layer.route.path}`)));
  const expected = ACCESS_REGISTRY.map(route => `${route.method} ${route.path}`);
  if (new Set(actual).size !== actual.length || new Set(expected).size !== expected.length
    || actual.length !== expected.length || expected.some(key => !actual.includes(key))) {
    throw new Error('access.registry_drift');
  }
}
