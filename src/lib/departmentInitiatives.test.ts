// TASK-PROTO-U4-1c (OD-12 §4/§8) — department initiative status contract.
import test from 'node:test';
import assert from 'node:assert/strict';
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
