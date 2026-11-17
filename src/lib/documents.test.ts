// TASK-PROTO-U4-1c (OD-12 §3/§5/§6) — the pure contracts behind the department
// document list, the submission patch and the two item classifications.
// No DB: these are the same functions the handlers call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MAX_DOCUMENT_TAGS,
  MAX_TAG_LENGTH,
  MAX_EXPECTED_VERSION,
  EVIDENCE_ENTITY_TYPES,
  isEvidenceEntityType,
  normalizeIndicatorCode,
  normalizeTags,
  validateExpectedVersionInput,
  validateRequirementInput,
  validateSubmissionPatch,
} from './documents.ts';
import { classifyRoute, formatMatrix } from '../server/accessRegistry.ts';

test('U4-1c tags: array of ≤10 short strings, trimmed, deduped; anything else refused', () => {
  assert.deepEqual(normalizeTags(undefined), { ok: true, value: [] });
  assert.deepEqual(normalizeTags(null), { ok: true, value: [] });
  assert.deepEqual(normalizeTags([' a ', 'b', 'a']), { ok: true, value: ['a', 'b'] });
  const tooMany = Array.from({ length: MAX_DOCUMENT_TAGS + 1 }, (_, i) => `t${i}`);
  assert.equal(normalizeTags(tooMany).ok, false);
  assert.deepEqual(normalizeTags(Array.from({ length: MAX_DOCUMENT_TAGS }, (_, i) => `t${i}`)).ok, true);
  assert.equal(normalizeTags(['x'.repeat(MAX_TAG_LENGTH)]).ok, true);
  assert.equal(normalizeTags(['x'.repeat(MAX_TAG_LENGTH + 1)]).ok, false);
  for (const bad of ['tag', 5, { a: 1 }, [''], ['   '], [7], ['ok', null], ['line\nbreak']]) {
    assert.equal(normalizeTags(bad).ok, false, JSON.stringify(bad));
  }
});

test('U4-1c indicator code: optional, ≤40 chars, single line; null/empty collapse to NULL', () => {
  assert.deepEqual(normalizeIndicatorCode(undefined), { ok: true, value: null });
  assert.deepEqual(normalizeIndicatorCode(null), { ok: true, value: null });
  assert.deepEqual(normalizeIndicatorCode('   '), { ok: true, value: null });
  assert.deepEqual(normalizeIndicatorCode(' c (i) '), { ok: true, value: 'c (i)' });
  assert.equal(normalizeIndicatorCode('x'.repeat(41)).ok, false);
  assert.equal(normalizeIndicatorCode('x'.repeat(40)).ok, true);
  assert.equal(normalizeIndicatorCode('a\tb').ok, false);
  assert.equal(normalizeIndicatorCode(42).ok, false);
});

test('U4-1c item routes accept the two classifications with handler validation', () => {
  // The route composes the SAME two helpers (no schema CHECK), so a bad value is
  // a clean 400 before any SQL — asserted here at the contract level and in the
  // static route pin below.
  assert.deepEqual(normalizeTags(['water', 'energy']), { ok: true, value: ['water', 'energy'] });
  assert.equal(normalizeTags('water').ok, false);
  assert.equal(normalizeIndicatorCode('c (i)').ok, true);
  assert.equal(normalizeIndicatorCode('x'.repeat(41)).ok, false);
  const taxonomyRoutes = readFileSync('src/server/taxonomy.ts', 'utf8');
  assert.ok(taxonomyRoutes.includes('normalizeIndicatorCode(') && taxonomyRoutes.includes('normalizeTags('),
    'the item create/update handlers validate indicatorCode and tags');
  assert.ok(taxonomyRoutes.includes('indicator_code') && taxonomyRoutes.includes('tags = $'),
    'both columns are written by the existing item routes');
});

test('U4-1c requirement input: title required on create, partial patch needs one field', () => {
  const missing = validateRequirementInput({}, false);
  assert.deepEqual([missing.ok, !missing.ok && missing.code], [false, 'documents.title_required']);
  const created = validateRequirementInput({ title: '  Policy document  ', tags: ['hr'] }, false);
  assert.equal(created.ok, true);
  assert.equal(created.ok && created.value.title, 'Policy document');
  assert.deepEqual(created.ok && created.value.tags, ['hr']);
  assert.equal(validateRequirementInput({ title: 'x'.repeat(301) }, false).ok, false);
  assert.equal(validateRequirementInput({ title: 'T', description: 'x'.repeat(2001) }, false).ok, false);
  assert.equal(validateRequirementInput({ title: 'T', required: 'yes' }, false).ok, false);
  assert.equal(validateRequirementInput({ title: 'T', sortOrder: -1 }, false).ok, false);
  assert.equal(validateRequirementInput({ title: 'T', departmentId: 'not-a-uuid' }, false).ok, false);
  assert.ok(validateRequirementInput({ title: 'T', departmentId: null }, false).ok);
  assert.equal(validateRequirementInput({}, true).ok, false);
  assert.ok(validateRequirementInput({ required: false }, true).ok);
});

test('U4-1c submission patch: provided/note/tag only, typed and bounded', () => {
  assert.deepEqual(validateSubmissionPatch({ provided: true }), { ok: true, value: { provided: true } });
  assert.deepEqual(validateSubmissionPatch({ note: '  sent  ', tag: ' hr ' }),
    { ok: true, value: { note: 'sent', tag: 'hr' } });
  assert.deepEqual(validateSubmissionPatch({ note: null }), { ok: true, value: { note: null } });
  assert.equal(validateSubmissionPatch({}).ok, false);
  assert.equal(validateSubmissionPatch({ provided: 'true' }).ok, false);
  assert.equal(validateSubmissionPatch({ note: 'x'.repeat(4001) }).ok, false);
  assert.equal(validateSubmissionPatch({ tag: 'x'.repeat(41) }).ok, false);
  assert.equal(validateSubmissionPatch({ submittedBy: 'me' }).ok, false);
  assert.equal(validateSubmissionPatch({ requirementId: 'x' }).ok, false);
});

test('U4-1c evidence entity types are exactly the two contract parents', () => {
  assert.deepEqual([...EVIDENCE_ENTITY_TYPES], ['document_submission', 'initiative_status']);
  assert.equal(isEvidenceEntityType('document_submission'), true);
  assert.equal(isEvidenceEntityType('initiative_status'), true);
  for (const bad of ['answers', '', null, 5, ['x']]) assert.equal(isEvidenceEntityType(bad), false);
});

test('U4-1c matrix pins: the eleven new declarations carry their exact role rows', () => {
  const expected: Record<string, string> = {
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
  };
  assert.equal(Object.keys(expected).length, 11);
  for (const [key, matrix] of Object.entries(expected)) {
    const [method, path] = key.split(' ');
    const route = classifyRoute(method, path.replace(/:[^/]+/g, '00000000-0000-4000-8000-000000000000'));
    assert.ok(route, `${key} must be declared`);
    assert.equal(`${route.method} ${route.path}`, key);
    assert.equal(formatMatrix(route.matrix), matrix, `matrix drift for ${key}`);
    assert.equal(route.activation, 'U1', `${key} must be activated for this unit`);
    assert.equal(route.capability, key.includes('/initiatives/') ? 'departmentInitiatives' : 'documents');
  }
  // Writes are never offered to W/C/P: those rows exist only on the E reads.
  for (const key of ['PATCH /requirements/:id', 'POST /evidence/:entityType/:entityId/files',
    'DELETE /evidence/:entityType/:entityId/files/:fileId', 'PATCH /initiatives/department/:id']) {
    const [method, path] = key.split(' ');
    const route = classifyRoute(method, path.replace(/:[^/]+/g, '00000000-0000-4000-8000-000000000000'))!;
    assert.deepEqual(route.matrix.map((r) => r.context), ['E']);
  }
  // ROUND 2 (F-05/L-03): the four platform requirement rows are P@T — the
  // handler REQUIRES an explicit clientId, so no targetless P row may exist.
  for (const key of ['GET /services/:id/documents', 'POST /services/:id/documents',
    'PATCH /services/:id/documents/:reqId', 'DELETE /services/:id/documents/:reqId']) {
    const [method, path] = key.split(' ');
    const route = classifyRoute(method, path.replace(/:[^/]+/g, '00000000-0000-4000-8000-000000000000'))!;
    assert.deepEqual(route.matrix.map((r) => [r.context, r.tenant]), [['P', 'explicit']]);
  }
});

test('U4-1c round-2 pins: FK RESTRICT on submissions, no RLS-blind count guard', () => {
  const schema = readFileSync('src/db/schema.sql', 'utf8');
  const en = readFileSync('src/server/routes/documents.ts', 'utf8');
  const content = readFileSync('src/db/b17-content.sql', 'utf8');
  // H-01: the guarantee is the FK, in the schema AND in every policy that could
  // reach the row.
  assert.match(schema, /requirement_id UUID NOT NULL REFERENCES document_requirements\(id\) ON DELETE RESTRICT/);
  assert.ok(!/requirement_id UUID NOT NULL REFERENCES document_requirements\(id\) ON DELETE CASCADE/.test(schema),
    'the cascade FK is gone');
  // The misleading targetless count pre-check is REMOVED, not kept as a fast path.
  assert.ok(!/SELECT count\(\*\)::int AS n FROM document_submissions/.test(en),
    'no RLS-blind count pre-check remains');
  // ROUND 3 (G-02): a RESTRICT refusal surfaces as 23001 OR 23503.
  assert.ok(en.includes("fkErr?.code === '23001' || fkErr?.code === '23503'"),
    'both RESTRICT/FK SQLSTATEs map to the own 409 body');
  assert.ok(en.includes("code: 'documents.dependency'"));
  assert.ok(!/error:.*fkErr/.test(en), 'the FK diagnostic is never echoed');
  // F-05/L-03: requirements are client-scoped end to end.
  assert.match(schema, /ADD COLUMN client_id UUID NOT NULL REFERENCES clients\(id\) ON DELETE CASCADE/);
  assert.match(schema, /UNIQUE \(client_id, service_id, department_id, title\)/);
  assert.ok(content.includes('b17_document_requirements_read') &&
    content.includes("client_id::text=b17_setting('current_tenant_id')"),
    'the requirement read policy is client-scoped');
  assert.ok(en.includes('WHERE r.client_id = $1'), 'the department list is client-scoped');
  // R1 (G-01): the requirement audits are written with client_id = T, so the
  // audit policy needs the target-bound branch (shape guard only — behaviour is
  // proved end-to-end in scripts/u41c-e2e.ts).
  assert.ok(content.includes("action IN ('DOCUMENT_REQUIREMENT_CREATED','DOCUMENT_REQUIREMENT_UPDATED',"));
  assert.ok(en.includes('clientId: tenant'));
  // R3: the mode is decided BEFORE ownDepartment (platform has no department).
  for (const file of ['src/server/routes/documents.ts', 'src/server/routes/departmentInitiatives.ts']) {
    const src = readFileSync(file, 'utf8');
    assert.ok(src.includes("req.access!.mode === 'platform' ? null : ownDepartment(req.access!)"),
      `${file}: the platform branch never calls ownDepartment`);
    assert.ok(src.includes("live.access!.mode === 'platform' ? platformConfigContext(live, tenant) : readContext(live)"),
      `${file}: the P path uses platformConfigContext(T)`);
  }
});

test('U4-1c-PROTECT pins: shared anchor, optimistic revision, tenant-bound evidence', () => {
  // Shape of the version carrier: 0 = absent, >=1 = current; missing/empty,
  // non-integer, negative and overflow fail closed with the existing baseline.
  assert.deepEqual(validateExpectedVersionInput(0), { ok: true, value: 0 });
  assert.deepEqual(validateExpectedVersionInput(3), { ok: true, value: 3 });
  assert.deepEqual(validateExpectedVersionInput('2'), { ok: true, value: 2 });
  for (const bad of [undefined, null, '', 'x', 1.5, -1, MAX_EXPECTED_VERSION + 1, NaN, {}, []]) {
    const res = validateExpectedVersionInput(bad as any);
    assert.equal(res.ok, false, JSON.stringify(bad));
    if (!res.ok) assert.equal(res.code, 'version.required');
  }
  // The carrier is accepted but never becomes a patch field; unknown fields
  // are still refused without widening the write.
  assert.deepEqual(validateSubmissionPatch({ provided: true, expectedVersion: 0 }),
    { ok: true, value: { provided: true } });
  assert.equal(validateSubmissionPatch({ expectedVersion: 0 }).ok, false);
  assert.equal(validateSubmissionPatch({ provided: true, hacked: 1 } as any).ok, false);
  const schema = readFileSync('src/db/schema.sql', 'utf8');
  assert.match(schema, /ADD COLUMN version INTEGER NOT NULL DEFAULT 1/);
  // PROTECT round 3 (owner decision §20, FINAL): the selection link is never
  // deleted and never nulled — unselect archives the selection row in place
  // (same ID, history reconnects on reselect) and RESTRICT refuses a hard row
  // deletion only when linked records exist.
  assert.ok(schema.includes('initiative_department_status_selection_restrict'),
    'the selection FK is a single named RESTRICT backstop');
  assert.ok(schema.includes('REFERENCES client_initiatives(id) ON DELETE RESTRICT'),
    'hard deletion is refused only when linked statuses exist; unselect archives instead');
  assert.ok(schema.includes('ALTER TABLE initiative_department_status ALTER COLUMN client_initiative_id SET NOT NULL'),
    'the link stays NOT NULL (fail-closed: a nulled link aborts instead of orphaning)');
  assert.ok(!/ADD CONSTRAINT initiative_department_status_selection_setnull/.test(schema),
    'the round-2 SET NULL preserver is gone');
  assert.ok(schema.includes('DROP CONSTRAINT initiative_department_status_selection_setnull'),
    'the round-2 uncommitted SET NULL name is cleaned when present; fresh and upgrade converge');
  assert.ok(schema.includes('DROP CONSTRAINT initiative_department_status_client_initiative_id_fkey'),
    'the historical auto-named CASCADE is deterministically dropped before RESTRICT is added');
  assert.match(schema, /ADD COLUMN archived_at TIMESTAMP WITH TIME ZONE NULL/,
    'the selection carries a nullable archived marker (NULL = active, additive, no data edits)');
  assert.ok(schema.includes('REFERENCES document_requirements(id) ON DELETE RESTRICT'),
    'the documents requirement link keeps its RESTRICT backstop (unchanged)');
    const scope = readFileSync('src/server/routes/initiativeScope.ts', 'utf8');
  assert.ok(scope.includes('u41c-protect:v1'), 'canonical domain-separated anchor prefix');  assert.ok(scope.includes("pg_advisory_xact_lock(hashtextextended($1, 0))"),
    'single transaction-scoped advisory lock, no session lock');
  assert.ok(scope.includes('A version is required to save (optimistic locking). Reload the item and retry.'),
    'missing-version uses the existing evaluations baseline, never a new message');
  // PROTECT round 3 (§21, the ONE approved content change): the archive
  // UPDATE needs its own FOR UPDATE policy — without it RLS silently matches
  // 0 rows. Scoped identically to the delete policy, WITH CHECK identical.
  const policies = readFileSync('src/db/b17-content.sql', 'utf8');
  assert.ok(policies.includes('CREATE POLICY b17_selection_update ON client_initiatives FOR UPDATE USING'),
    'the approved archive UPDATE policy exists beside the delete policy');
  assert.match(policies, /CREATE POLICY b17_selection_update[\s\S]{0,600}WITH CHECK/,
    'its WITH CHECK mirrors the delete scope (no new grant, no retarget)');
  const docs = readFileSync('src/server/routes/documents.ts', 'utf8');
  assert.ok(docs.includes("u41cProtectLock(client, 'requirement'"),
    'requirement PATCH serializes on the requirement anchor');
  assert.ok(docs.includes('WHERE id = $6 AND version = $7 RETURNING *'),
    'document update is a conditional single-row write');
  assert.ok(docs.includes('"ownVersion"'), 'requirement list exposes the own revision');
  assert.ok(docs.includes("'version', s.version"), 'submission rows carry their revision');
  assert.ok(docs.includes('تغيّرت البيانات منذ فتحها. يرجى تحديثها ومراجعة التعديلات قبل الحفظ.'),
    'stale document edits use the owner-approved Arabic message');
  assert.ok(docs.includes('JOIN departments d ON d.id = st.department_id AND d.client_id = $2'),
    'initiative evidence parent is tenant-bound through selection + department');
  // PROTECT round 4 (M-01, fail-closed): evidence upload/delete resolve through
  // an ACTIVE selection only — an archived link reuses the existing
  // evidence.not_found 404, no new user-visible text.
  assert.ok(docs.includes('AND ci.archived_at IS NULL'),
    'archived selections resolve as absent on evidence writes (fail-closed 404)');
  assert.ok(docs.includes("u41cProtectLock(client, anchor.kind,"),
    'evidence upload/delete share the parent anchor with scoped revalidation');
  const init = readFileSync('src/server/routes/initiatives.ts', 'utf8');
  assert.ok(init.includes("u41cProtectLock(client, 'initiative', tenant, id)"),
    'select + unselect share the canonical natural-key anchor');
  // PROTECT round 3 (owner decision §20): unselect archives in place (same row
  // ID, always permitted for authorized W); reselect clears the flag instead
  // of INSERTing a duplicate. Tenant/eligibility/freeze + audit stay on the
  // path; no dependency refusal, no new user-visible text or code.
  assert.ok(init.includes('SET archived_at=NOW()'),
    'unselect sets the archived flag; the row (and its history) is never deleted');
  assert.ok(init.includes('SET archived_at=NULL'),
    'reselect clears the flag in place and reconnects history instead of duplicating');
  assert.ok(!/DELETE FROM client_initiatives/.test(init),
    'no selection-row DELETE remains on the API path (hard delete is refused by RESTRICT, proven at SQL level)');
  assert.ok(init.includes('AS archived'),
    'the selection list re-lists archived rows with their flag');
  assert.ok(!init.includes('لا يمكن إلغاء اختيار المبادرة لوجود بيانات أو مرفقات مرتبطة بها.'),
    'the superseded refuse-unselect message is gone from the unselect path');
  assert.ok(!init.includes("code: 'initiatives.dependency'"),
    'no dependency refusal code on the unselect path');
  assert.ok(!init.includes('23001'), 'no SQLSTATE mapping remains on the unselect path');
  assert.ok(init.includes('isFrozenScope(client, tenant)'), 'freeze stays on the select/unselect path');
  assert.ok(!init.includes("code: 'initiatives.unselected'") && !init.includes('لم يعد اختيارها سارياً'),
    'the round-2 notice flow is replaced by archive/refresh (no new text)');
  assert.ok(init.includes("action:'INITIATIVE_UNSELECTED'"), 'unselect still writes its audit');
});
