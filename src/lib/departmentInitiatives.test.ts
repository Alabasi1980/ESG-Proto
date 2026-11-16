// TASK-PROTO-U4-1c (OD-12 §4/§8) — department initiative status contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stampsSubmission, validateInitiativeStatusPatch } from './departmentInitiatives.ts';

test('U4-1c initiative status: performed/note only, typed and bounded', () => {
  assert.deepEqual(validateInitiativeStatusPatch({ performed: true }), { ok: true, value: { performed: true } });
  assert.deepEqual(validateInitiativeStatusPatch({ note: ' done ' }), { ok: true, value: { note: 'done' } });
  assert.deepEqual(validateInitiativeStatusPatch({ performed: false, note: null }),
    { ok: true, value: { performed: false, note: null } });
  assert.equal(validateInitiativeStatusPatch({}).ok, false);
  assert.equal(validateInitiativeStatusPatch({ performed: 'yes' }).ok, false);
  assert.equal(validateInitiativeStatusPatch({ note: 'x'.repeat(4001) }).ok, false);
  assert.equal(validateInitiativeStatusPatch({ note: 5 }).ok, false);
  // The department never edits the initiative itself (title/sector/library/status id).
  for (const key of ['title', 'sector', 'initiativeId', 'clientInitiativeId', 'departmentId', 'submittedBy']) {
    assert.equal(validateInitiativeStatusPatch({ [key]: 'x' }).ok, false, key);
  }
  assert.equal(validateInitiativeStatusPatch(null as any).ok, false);
  assert.equal(validateInitiativeStatusPatch([] as any).ok, false);
});

test('U4-1c initiative status: the submission stamp is written once, on the first performed=true', () => {
  assert.equal(stampsSubmission(true, null), true);
  assert.equal(stampsSubmission(true, undefined), true);
  assert.equal(stampsSubmission(true, new Date()), false);
  assert.equal(stampsSubmission(false, null), false);
  assert.equal(stampsSubmission(undefined, null), false);
});

test('U4-1c round-2 (F-04/L-02): performed cannot be reset once the status is stamped', () => {
  const src = readFileSync('src/server/routes/departmentInitiatives.ts', 'utf8');
  // The lock is a zero-write refusal BEFORE the upsert, with the unit's own code.
  assert.ok(src.includes("code: 'initiatives.locked'"), 'own 409 code');
  assert.match(src, /if \(existing\?\.submitted_at && patch\.performed === false\)/);
  assert.ok(src.indexOf('initiatives.locked') < src.indexOf('INSERT INTO initiative_department_status'),
    'the refusal precedes the write');
  const locked = src.slice(src.indexOf('if (existing?.submitted_at'), src.indexOf('initiatives.locked'));
  assert.doesNotMatch(locked, /UPDATE|INSERT/, 'no write happens on the locked path');
  // The same shape guards the document submission (performed/provided symmetry).
  const docs = readFileSync('src/server/routes/documents.ts', 'utf8');
  assert.ok(docs.includes("code: 'documents.locked'"));
});

