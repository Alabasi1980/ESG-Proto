// TASK-PROTO-U4-3C (unit c1) — no-DB behavioral + matrix pins (node:test).
//
// Covers, without a database: the extended visibility vocabulary (G6/DG-D2),
// the seven new/changed route matrices (P/W/C/E × route, allowed → W only,
// others → 403 workspace.mode_mismatch via assertRouteContext), the handler
// source contracts (scope vocabulary, freeze/attachment guards preserved,
// P-denied approve branch, delivery metadata-only, complete-password
// single-column guard), the additive substrate pins (2 tables + 5 columns +
// 2 CHECKs in schema.sql; exact delta policy names + transition pins in
// b17-content.sql), and the no-secret grep pins for the delivery path.
//
// Live RLS/transaction behavior is proved on an isolated scratch by
// scripts/u43c1-rehearse.ts (NEVER live/shared DB); this file pins the
// byte-level contracts that the rehearsal executes against.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { classifyRoute } from '../server/accessRegistry.ts';
import { assertRouteContext } from '../server/access.ts';
import type { AccessContext } from './capabilities.ts';
import {
  CLIENT_FIELD_MASK_VALUES,
  parseClientFieldMask,
  parseVisibilityBody,
  storedClientFieldMask,
} from './clientFieldMask.ts';

const schema = readFileSync('src/db/schema.sql', 'utf8');
const content = readFileSync('src/db/b17-content.sql', 'utf8');
const workspace = readFileSync('src/server/routes/workspace.ts', 'utf8');
const assignments = readFileSync('src/server/routes/adminAssignments.ts', 'utf8');
const provisioning = readFileSync('src/server/routes/adminProvisioning.ts', 'utf8');
const staff = readFileSync('src/server/routes/adminStaff.ts', 'utf8');
const adminMounts = readFileSync('src/server/routes/admin.ts', 'utf8');
const routesMounts = readFileSync('src/server/routes.ts', 'utf8');

const UUID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const contextFor = (mode: 'platform' | 'consultant' | 'client' | 'employee'): AccessContext => {
  const base = { actorId: UUID_A, sessionId: UUID_A, capability: 'probe' };
  if (mode === 'platform') return { ...base, role: 'ge_admin', mode, tenantId: null,
    departmentId: null, tabId: UUID_A, generation: 1 };
  if (mode === 'consultant') return { ...base, role: 'ge_admin', mode, tenantId: UUID_A,
    departmentId: null, tabId: UUID_A, generation: 1 };
  if (mode === 'client') return { ...base, role: 'client_admin', mode, tenantId: UUID_A,
    departmentId: null, tabId: null, generation: null };
  return { ...base, role: 'employee', mode, tenantId: UUID_A,
    departmentId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', tabId: null, generation: null };
};

// --- Vocab extension (G6/DG-D2): additive, default-visible, fail-closed ---

test('U4-3C vocab: U4-3 operational columns added, attachment_required still unmaskable', () => {
  for (const field of ['documents', 'initiatives', 'na_status'])
    assert.ok((CLIENT_FIELD_MASK_VALUES as readonly string[]).includes(field), field);
  assert.ok(!(CLIENT_FIELD_MASK_VALUES as readonly string[]).includes('attachment_required'));
  assert.deepEqual(parseClientFieldMask(['documents', 'initiatives', 'na_status']),
    { ok: true, mask: ['documents', 'initiatives', 'na_status'] });
  assert.deepEqual(parseClientFieldMask(['documents', 'documents']), { ok: false });
  assert.deepEqual(parseClientFieldMask(['unknown']), { ok: false });
  assert.deepEqual(parseVisibilityBody({ clientFieldMask: ['na_status'] }),
    { ok: true, mask: ['na_status'] });
  assert.deepEqual([...storedClientFieldMask(['documents'])], ['documents']);
  for (const bad of [['documents', 'nope'], ['hint', null]] as const)
    assert.equal(storedClientFieldMask(bad).size, CLIENT_FIELD_MASK_VALUES.length);
});

// --- Matrix: 5 new workspace routes + lift + deliver are W-only; approve is W (P denied) ---

test('U4-3C matrix: new routes classify W-only; P/C/E fail closed', () => {
  const wOnly = [
    'POST /workspace/client-services',
    'DELETE /workspace/client-services/:serviceId',
    'PUT /workspace/participating-departments',
    'PUT /workspace/dept-matching',
    'POST /workspace/staff/:userId/complete-password',
    'POST /assignments/na/lift',
    'POST /staff-lists/:id/deliver',
    'POST /staff-lists/:id/approve',
  ];
  for (const key of wOnly) {
    const [method, path] = key.split(/ (.+)/);
    const route = classifyRoute(method, path.replace(/:[^/]+/g, 'resource'))!;
    assert.ok(route, `classified: ${key}`);
    assert.doesNotThrow(() => assertRouteContext(route, contextFor('consultant')), `${key} / W`);
    for (const mode of ['platform', 'client', 'employee'] as const)
      assert.throws(() => assertRouteContext(route, contextFor(mode)),
        (err: { code?: string }) => err.code === 'workspace.mode_mismatch', `${key} / ${mode}`);
  }
});

test('U4-3C mounts: workspace router + lift + deliver mounted once each', () => {
  for (const decl of [`router.post('/workspace/client-services'`, `router.delete('/workspace/client-services/:serviceId'`,
    `router.put('/workspace/participating-departments'`, `router.put('/workspace/dept-matching'`,
    `router.post('/workspace/staff/:userId/complete-password'`])
    assert.equal(workspace.split(decl).length - 1, 1, decl);
  assert.ok(adminMounts.includes(`router.post('/assignments/na/lift'`), 'na/lift mount');
  assert.ok(adminMounts.includes(`router.post('/staff-lists/:id/deliver'`), 'deliver mount');
  assert.ok(routesMounts.includes('workspaceAppRouter'), 'workspace app router mount');
});

// --- Handler contracts: error vocab, guards, P-denied branch, metadata-only ---

test('U4-3C N/A scope: vocab + preserved guards (assignment 403, freeze 409, attachment 409)', () => {
  for (const code of ['na.scope_invalid', 'na.reason_required', 'na.lift_forbidden',
    'match.incomplete', 'assignment.na_attachment_required', 'item.version_conflict'])
    assert.ok(assignments.includes(code), code);
  assert.ok(assignments.includes('not_applicable = false, not_evaluated = true'),
    'lift lands unevaluated (never direct-to-scored)');
  assert.ok(assignments.includes("score = NULL") && assignments.includes('na_reason = NULL'),
    'lift clears score + reason');
  assert.ok(assignments.includes('isFrozenScope'), 'freeze 409 preserved on set + lift');
});

test('U4-3C approve: W bound-A + P-denied branch kept; OTP-once shape unchanged', () => {
  assert.ok(provisioning.includes('provision.actor_forbidden'), 'P-denied code');
  assert.ok(provisioning.includes('ownTenant(req.access!'), 'bound-A tenant, request values never trusted');
  assert.ok(provisioning.includes('oneTimePassword'), 'OTP-once response shape preserved');
});

test('U4-3C delivery: metadata-only (no secret bytes); email refused 400', () => {
  const mask = (src: string) => src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\r\n]*/g, ' ')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
  const fnStart = staff.indexOf('export async function deliverStaffList');
  const fnEnd = staff.indexOf('/** §3.4 row 25');
  const body = mask(staff.slice(fnStart, fnEnd));
  for (const secret of ['oneTimePassword', 'password_hash', 'passwordHash', 'one_time_password', 'otp'])
    assert.ok(!new RegExp(secret, 'i').test(body), `no ${secret} in deliver path`);
  assert.ok(staff.includes('delivery.email_unavailable'), 'email channel → 400');
  for (const col of ['delivery_channel', 'delivery_status', 'revealed_by', 'revealed_at', 'reveal_acked_at'])
    assert.ok(staff.includes(col), `delivery column: ${col}`);
  assert.ok(staff.includes('CREDENTIAL_DELIVERED'), 'delivery audited, metadata only');
  const auditPayload = mask(staff.slice(staff.indexOf('CREDENTIAL_DELIVERED')));
  assert.ok(!/password|secret|otp/i.test(auditPayload.slice(0, 400)), 'audit payload carries no secret');
});

test('U4-3C complete-password: hash-only write, must_change preserved', () => {
  const body = workspace.slice(workspace.indexOf('completeStaffPassword'));
  assert.ok(/UPDATE users SET password_hash = \$1, updated_at = NOW\(\) WHERE id = \$2/.test(body),
    'single-column guard: writes ONLY password_hash (+ updated_at)');
  assert.ok(!/must_change_password = false|must_change_password=false/.test(body),
    'must_change_password never cleared on this path');
  assert.ok(body.includes('STAFF_PASSWORD_COMPLETED'), 'completion audited');
});

// --- Substrate pins (byte-traceable to the delta spec) ---

test('U4-3C delivery guards (Shield F1 round 3): suspended 403 + frozen 409 mirror the workspace siblings', () => {
  assert.ok(staff.includes('await assertDeliverTenant(client, tenant);'), 'suspended-tenant guard present');
  assert.ok(staff.includes("code: 'tenant.suspended'"), 'suspended → 403 tenant.suspended');
  assert.ok(staff.includes("throw Object.assign(new Error('Target tenant not found.'), { statusCode: 404 });"),
    'unknown tenant → 404, same as siblings');
  // Guard order mirrors workspace.ts siblings: active → frozen → list read.
  const gActive = staff.indexOf('await assertDeliverTenant(client, tenant);');
  const gFrozen = staff.indexOf('if (await isFrozenScope(client, tenant, null)) throw frozenWriteError();', gActive);
  const gRead = staff.indexOf('FROM staff_lists WHERE id = $1 AND client_id = $2 FOR UPDATE', gFrozen);
  assert.ok(gActive > 0 && gFrozen > gActive && gRead > gFrozen, 'active → frozen → read order');
});

test('U4-3C substrate: 2 tables + 5 columns + 2 CHECKs in schema.sql', () => {
  assert.ok(schema.includes('CREATE TABLE dept_match_overrides'), 'STORE-e table');
  assert.ok(schema.includes('UNIQUE(client_id, service_id, service_dept_code)'), 'override uniqueness');
  assert.ok(schema.includes('CREATE TABLE participating_departments'), 'STORE-g table');
  assert.ok(schema.includes('PRIMARY KEY (client_id, department_id)'), 'participation key');
  for (const col of ['delivery_channel', 'delivery_status', 'revealed_by', 'revealed_at', 'reveal_acked_at'])
    assert.ok(schema.includes(`column_name='${col}'`), `STORE-f column: ${col}`);
  for (const check of ['staff_lists_delivery_valid', 'staff_lists_delivery_status_valid'])
    assert.ok(schema.includes(check), `STORE-f CHECK: ${check}`);
  assert.ok(schema.includes('ALTER TABLE dept_match_overrides FORCE ROW LEVEL SECURITY'));
  assert.ok(schema.includes('ALTER TABLE participating_departments FORCE ROW LEVEL SECURITY'));
});

test('U4-3C substrate: exact delta policy set in b17-content.sql (RLS-a/b/c/d, STORE-e/g, F1 deliver)', () => {
  for (const policy of ['b17_consultant_links_insert', 'b17_consultant_links_delete',
    'b17_work_staff_read', 'b17_consultant_staff_rows_read',
    'b17_consultant_staff_approve_update', 'b17_consultant_users_provision_insert',
    'b17_consultant_staff_deliver_update', 'b17_consultant_staff_complete_password',
    'b17_consultant_evaluations_na_lift_update',
    'b17_match_override_read', 'b17_match_override_write',
    'b17_match_override_update', 'b17_match_override_delete',
    'b17_participating_read', 'b17_participating_write',
    'b17_participating_update', 'b17_participating_delete'])
    assert.ok(content.includes(`CREATE POLICY ${policy} ON`), `delta branch: ${policy}`);
  // Transition pins (Shield F1/F2 re-audit surface).
  assert.ok(content.includes("AND status = 'submitted'") && content.includes("AND status = 'approved'"),
    'b3 submitted→approved, deliver approved→approved');
  assert.ok(content.includes('decided_by::text = b17_setting'), 'approve decider = actor');
  assert.ok(content.includes('AND must_change_password = true'), 'provision/completion forced rotation');
  assert.ok(content.includes("AND role IN ('employee', 'client_admin')"), 'non-platform roles only');
  assert.ok(content.includes('AND not_applicable = false') && content.includes('AND not_evaluated = true'),
    'F2 lift lands unevaluated');
  // Existing platform branches untouched (emergency P@T preserved, no widening).
  assert.ok(content.includes('CREATE POLICY b17_admin_links_insert ON client_services FOR INSERT'),
    'platform link branch untouched');
  assert.ok(!/CREATE POLICY \w+ ON (answers|evaluations|approvals|users|clients|departments) FOR DELETE/.test(content),
    'no new DELETE widening on protected tables');
});
