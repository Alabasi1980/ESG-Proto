// TASK-PROTO-U4-1c (OD-12 §3/§5/§6) — the pure contracts behind the department
// document list, the submission patch and the two item classifications.
// No DB: these are the same functions the handlers call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MAX_DOCUMENT_TAGS,
  MAX_TAG_LENGTH,
  EVIDENCE_ENTITY_TYPES,
  isEvidenceEntityType,
  normalizeIndicatorCode,
  normalizeTags,
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
    'GET /services/:id/documents': 'P#service-document-requirements-catalog',
    'POST /services/:id/documents': 'P#catalog-document-requirement-create',
    'PATCH /services/:id/documents/:reqId': 'P#catalog-document-requirement-update',
    'DELETE /services/:id/documents/:reqId': 'P#catalog-requirement-delete-existing-submission-refusals',
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
});
