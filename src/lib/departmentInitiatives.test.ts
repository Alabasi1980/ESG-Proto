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

test('U4-1c-PROTECT initiative status: revision carrier, conditional write, shared anchor', () => {
  // The carrier is accepted but never becomes a patch field; unknown fields
  // are still refused and an empty patch (carrier only) stays refused.
  assert.deepEqual(validateInitiativeStatusPatch({ performed: true, expectedVersion: 0 }),
    { ok: true, value: { performed: true } });
  assert.equal(validateInitiativeStatusPatch({ expectedVersion: 0 } as any).ok, false);
  for (const bad of ['x', 1.5, -1, 2147483648, NaN, {}, '']) {
    assert.equal(validateInitiativeStatusPatch({ performed: true, expectedVersion: bad as any }).ok, false,
      JSON.stringify(bad));
  }
  assert.equal(validateInitiativeStatusPatch({ performed: true, expectedVersion: '2' as any }).ok, true);
  const src = readFileSync('src/server/routes/departmentInitiatives.ts', 'utf8');
  assert.ok(src.includes("u41cProtectLock(client, 'initiative',"),
    'status PATCH serializes on the canonical natural-key anchor');
  assert.ok(src.includes('AND client_id = $2 AND initiative_id = $3'),
    'post-wait reread binds the SAME original selection ID + tenant + library ID');
  assert.ok(src.includes('WHERE id = $5 AND version = $6 RETURNING *')
    || src.includes('version = version + 1'),
    'status update is a conditional single-row write with no retry');
  assert.ok(src.includes('"ownVersion"'), 'initiative list exposes the own revision');
  assert.ok(src.includes("'version', st.version"), 'status rows carry their revision');
  assert.ok(src.includes('تغيّرت البيانات منذ فتحها. يرجى تحديثها ومراجعة التعديلات قبل الحفظ.'),
    'stale initiative edits use the owner-approved Arabic message');
});

test('U4-1c-PROTECT round 3: archived selections are readable but not writable (baseline 404)', () => {
  // Owner decision §20: the round-2 `initiatives.unselected` notice flow is
  // replaced by archive/refresh — no new user-visible text, reuse baseline
  // codes. Writes bind the SAME selection ID as ACTIVE; an archived selection
  // fails closed with the existing not-found path (the client refreshes and
  // re-lists it as archived); reselect clears the flag on the same row.
  const src = readFileSync('src/server/routes/departmentInitiatives.ts', 'utf8');
  assert.ok(!src.includes("code: 'initiatives.unselected'"),
    'no unselected notice remains on the status path');
  assert.ok(!src.includes('لم يعد اختيارها سارياً'),
    'the round-2 notice text is gone from the status path');
  assert.ok(src.includes('AND archived_at IS NULL'),
    'selection reads bind the active flag pre- and post-lock');
  assert.ok(src.includes('(ci.archived_at IS NOT NULL) AS archived'),
    'the department list re-lists archived selections with their history');
  assert.ok(src.includes('تغيّرت البيانات منذ فتحها. يرجى تحديثها ومراجعة التعديلات قبل الحفظ.'),
    'stale edits keep the byte-identical owner-approved Arabic message');
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

