// B16 — client role realignment: dept-approval actor gate + stripped-matrix
// refusal contracts (no DB needed).
//
// 1. deptApproveActorGate (OD-08): dept members only; head-only when a head
//    is assigned; client_admin/ge_admin/cross-dept refused with the bilingual
//    path-pointing messages; self-approval ALLOWED at dept level and flagged
//    so the UI labels it preliminary.
// 2. Stripped-matrix refusals: every B16 403 is bilingual (EN + AR halves).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  B16_ACTION_CLOSE_REFUSAL,
  B16_ACTION_OPEN_REFUSAL,
  B16_CLIENT_ASSIGN_REFUSAL,
  B16_CLIENT_CORRECT_REFUSAL,
  B16_CLIENT_CREATE_EVAL_REFUSAL,
  B16_CLIENT_ESG_IMPORT_REFUSAL,
  B16_CLIENT_GRI_REFUSAL,
  B16_CLIENT_INITIATIVE_REFUSAL,
  B16_CLIENT_LEVEL_REFUSAL,
  B16_DEPT_APPROVAL_CLIENT_REFUSAL,
  B16_DEPT_APPROVAL_GE_REFUSAL,
  B16_CROSS_DEPT_APPROVAL_REFUSAL,
  B16_PRELIMINARY_LABEL_AR,
  B16_PRELIMINARY_LABEL_EN,
  b16HeadOnlyRefusal,
  deptApproveActorGate,
} from '../server/routes/_shared.ts';

const HEAD = 'head-1';
const MEM = 'mem-1';
const OTHER = 'other-9';
const DEPT = 'dept-legal';

function caller(id: string, role: string, departmentId?: string | null) {
  return { id, role, departmentId: departmentId ?? null };
}

// --- A2: dept actor gate ---

test('B16-A2: dept member approves when no head is assigned (no self-ban)', () => {
  const g = deptApproveActorGate({
    caller: caller(MEM, 'employee', DEPT),
    answerDepartmentId: DEPT,
    headUserId: null,
    evaluatorId: 'someone-else',
    submitterId: 'someone-else',
  });
  assert.deepEqual(g, { ok: true, selfApproved: false });
});

test('B16-A2: head-only when a head is assigned; member refused, head passes', () => {
  const refused = deptApproveActorGate({
    caller: caller(MEM, 'employee', DEPT),
    answerDepartmentId: DEPT,
    headUserId: HEAD,
    headDepartmentName: 'Legal',
    evaluatorId: 'someone-else',
    submitterId: 'someone-else',
  });
  assert.equal(refused.ok, false);
  if (!refused.ok) {
    assert.equal(refused.status, 403);
    assert.match(refused.error, /only the head/i);
  }
  const headOk = deptApproveActorGate({
    caller: caller(HEAD, 'employee', DEPT),
    answerDepartmentId: DEPT,
    headUserId: HEAD,
    evaluatorId: 'someone-else',
    submitterId: 'someone-else',
  });
  assert.deepEqual(headOk, { ok: true, selfApproved: false });
});

test('B16-A2 OD-08 s2: self-approval ALLOWED at dept level and flagged preliminary', () => {
  const selfHead = deptApproveActorGate({
    caller: caller(HEAD, 'employee', DEPT),
    answerDepartmentId: DEPT,
    headUserId: HEAD,
    evaluatorId: HEAD,
    submitterId: HEAD,
  });
  assert.deepEqual(selfHead, { ok: true, selfApproved: true });

  // Sole dept member (no head): own evaluation also passes flagged.
  const selfSolo = deptApproveActorGate({
    caller: caller(MEM, 'employee', DEPT),
    answerDepartmentId: DEPT,
    headUserId: null,
    evaluatorId: MEM,
    submitterId: MEM,
  });
  assert.deepEqual(selfSolo, { ok: true, selfApproved: true });

  // The preliminary label is plainly bilingual.
  assert.match(B16_PRELIMINARY_LABEL_EN, /pending client confirmation/);
  assert.ok(B16_PRELIMINARY_LABEL_AR.length > 0 && /[\u0600-\u06FF]/.test(B16_PRELIMINARY_LABEL_AR));
});

test('B16-A2: cross-dept employee refused even without a head', () => {
  const g = deptApproveActorGate({
    caller: caller(OTHER, 'employee', 'dept-hr'),
    answerDepartmentId: DEPT,
    headUserId: null,
    evaluatorId: 'x',
    submitterId: 'x',
  });
  assert.equal(g.ok, false);
  if (!g.ok) {
    assert.equal(g.status, 403);
    assert.equal(g.error, B16_CROSS_DEPT_APPROVAL_REFUSAL);
  }
});

test('B16-A2: head of ANOTHER department is still cross-dept (head ≠ pass)', () => {
  const g = deptApproveActorGate({
    caller: caller(OTHER, 'employee', 'dept-hr'),
    answerDepartmentId: DEPT,
    headUserId: OTHER, // head of HR, not of Legal
    evaluatorId: 'x',
    submitterId: 'x',
  });
  assert.equal(g.ok, false);
  if (!g.ok) assert.equal(g.status, 403);
});

test('B16-A2: client_admin refused (belongs to the department path)', () => {
  const g = deptApproveActorGate({
    caller: caller('ca', 'client_admin'),
    answerDepartmentId: DEPT,
    headUserId: null,
    evaluatorId: 'x',
    submitterId: 'x',
  });
  assert.equal(g.ok, false);
  if (!g.ok) {
    assert.equal(g.status, 403);
    assert.equal(g.error, B16_DEPT_APPROVAL_CLIENT_REFUSAL);
    assert.match(g.error, /client-approve/);
  }
});

test('B16-A2: ge_admin refused (GE acts at final approval)', () => {
  const g = deptApproveActorGate({
    caller: caller('ge', 'ge_admin'),
    answerDepartmentId: DEPT,
    headUserId: null,
    evaluatorId: 'x',
    submitterId: 'x',
  });
  assert.equal(g.ok, false);
  if (!g.ok) {
    assert.equal(g.status, 403);
    assert.equal(g.error, B16_DEPT_APPROVAL_GE_REFUSAL);
    assert.match(g.error, /final approval/);
  }
});

// --- B: stripped-matrix refusal contracts (bilingual, path-pointing) ---

test('B16-B: every stripped 403 is bilingual EN/AR with the correct path', () => {
  const table: Array<[string, string, RegExp]> = [
    ['client create evaluation', B16_CLIENT_CREATE_EVAL_REFUSAL, /client-review/],
    ['client correct', B16_CLIENT_CORRECT_REFUSAL, /[Rr]eturn/],
    ['client gri commit', B16_CLIENT_GRI_REFUSAL, /GE/],
    ['client esg import', B16_CLIENT_ESG_IMPORT_REFUSAL, /GE/],
    ['client report level', B16_CLIENT_LEVEL_REFUSAL, /reports \/ export/],
    ['client assign', B16_CLIENT_ASSIGN_REFUSAL, /read-only/],
    ['client action open', B16_ACTION_OPEN_REFUSAL, /GE/],
    ['client action close', B16_ACTION_CLOSE_REFUSAL, /GE/],
    ['client initiative select', B16_CLIENT_INITIATIVE_REFUSAL, /read-only/],
    ['dept client refusal', B16_DEPT_APPROVAL_CLIENT_REFUSAL, /client-approve/],
    ['dept ge refusal', B16_DEPT_APPROVAL_GE_REFUSAL, /final approval/],
    ['cross-dept refusal', B16_CROSS_DEPT_APPROVAL_REFUSAL, /own department/],
  ];
  for (const [name, msg, path] of table) {
    assert.ok(msg.includes(' / '), `${name}: missing EN/AR separator`);
    assert.ok(/[\u0600-\u06FF]/.test(msg), `${name}: missing Arabic half`);
    assert.match(msg, path, `${name}: missing correct-path pointer`);
  }
  assert.match(b16HeadOnlyRefusal('Legal'), /only the head/i);
});
