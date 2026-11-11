// MICRO-FIX (OD-08 s3 + WF-02) — submit actor gate matrix (no DB needed).
//
// Allowed submitters = (1) the evaluation's author, or (2) the designated
// head of the evaluation's department (null head → author only). Everyone
// else — client_admin, ge_admin, non-author employees, cross-dept head —
// gets the bilingual 403. No test in the suite asserts the old behavior
// ("...or a tenant administrator may submit..."), so nothing needed updating.

import test from 'node:test';
import assert from 'node:assert/strict';
import { SUBMIT_REFUSAL, submitActorGate } from '../server/routes/evaluations.ts';

const AUTHOR = 'author-1';
const HEAD = 'head-1';
const MEMBER = 'member-1';
const OTHER_HEAD = 'other-head-9';
const CA = 'ca-1';
const GE = 'ge-1';

test('submit gate: author submits own draft (head assigned or not)', () => {
  for (const head of [HEAD, null]) {
    assert.deepEqual(
      submitActorGate({ callerId: AUTHOR, evaluatorId: AUTHOR, headUserId: head }),
      { ok: true }
    );
  }
});

test('submit gate: designated head submits (different user, head of dept)', () => {
  assert.deepEqual(
    submitActorGate({ callerId: HEAD, evaluatorId: AUTHOR, headUserId: HEAD }),
    { ok: true }
  );
});

test('submit gate: null head means author-only (member refused)', () => {
  const g = submitActorGate({ callerId: MEMBER, evaluatorId: AUTHOR, headUserId: null });
  assert.equal(g.ok, false);
  if (!g.ok) {
    assert.equal(g.status, 403);
    assert.equal(g.error, SUBMIT_REFUSAL);
  }
});

test('submit gate: client_admin submit refused (bilingual 403)', () => {
  const g = submitActorGate({ callerId: CA, evaluatorId: AUTHOR, headUserId: HEAD });
  assert.equal(g.ok, false);
  if (!g.ok) {
    assert.equal(g.status, 403);
    assert.equal(g.error, SUBMIT_REFUSAL);
  }
});

test('submit gate: ge_admin submit refused (bilingual 403)', () => {
  const g = submitActorGate({ callerId: GE, evaluatorId: AUTHOR, headUserId: HEAD });
  assert.equal(g.ok, false);
  if (!g.ok) assert.equal(g.status, 403);
});

test('submit gate: non-author same-dept employee refused when head assigned', () => {
  const g = submitActorGate({ callerId: MEMBER, evaluatorId: AUTHOR, headUserId: HEAD });
  assert.equal(g.ok, false);
  if (!g.ok) assert.equal(g.status, 403);
});

test('submit gate: head of ANOTHER dept refused (head identity is dept-scoped)', () => {
  const g = submitActorGate({ callerId: OTHER_HEAD, evaluatorId: AUTHOR, headUserId: HEAD });
  assert.equal(g.ok, false);
  if (!g.ok) assert.equal(g.status, 403);
});

test('submit gate: refusal is bilingual EN + AR with the exact EN contract', () => {
  assert.ok(SUBMIT_REFUSAL.includes(' / '), 'missing EN/AR separator');
  assert.match(
    SUBMIT_REFUSAL,
    /Only the evaluator or the department head may submit this evaluation\./
  );
  assert.ok(/[\u0600-\u06FF]/.test(SUBMIT_REFUSAL), 'missing Arabic half');
});
