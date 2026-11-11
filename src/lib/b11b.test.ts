import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assignUnassignRefusal,
  generateOneTimePassword,
  isStaffListStatus,
  passwordChangeRequiredBody,
  stripSecrets,
  suspendedLoginBody,
  validateStaffListRows,
} from './b11b.ts';
import { applyShowGapFlags } from './reports.ts';

test('B11b staff rows: valid rows pass, duplicates/bad email/department refused', () => {
  const ok = validateStaffListRows([
    { email: 'A@x.test', name: 'A', departmentName: 'HR' },
    { email: 'b@x.test', name: 'B', departmentId: 'd1', role: 'client_admin' },
  ]);
  assert.equal(ok.ok, true);

  const dup = validateStaffListRows([
    { email: 'a@x.test', name: 'A', departmentName: 'HR' },
    { email: 'A@x.test', name: 'B', departmentName: 'HR' },
  ]);
  assert.equal(dup.ok, false);

  const bad = validateStaffListRows([{ email: 'nope', name: 'X', departmentName: 'HR' }]);
  assert.equal(bad.ok, false);

  const noDept = validateStaffListRows([{ email: 'c@x.test', name: 'C' }]);
  assert.equal(noDept.ok, false);
  if (!noDept.ok) assert.match(noDept.error, /non-existent department/);
});

test('B11b staff rows: empty array and oversize refused', () => {
  assert.equal(validateStaffListRows([]).ok, false);
  assert.equal(validateStaffListRows('x').ok, false);
  assert.equal(isStaffListStatus('submitted'), true);
  assert.equal(isStaffListStatus('bogus'), false);
});

test('B11b OTP: 16 chars, unique per call, never contains spaces', () => {
  const a = generateOneTimePassword();
  const b = generateOneTimePassword();
  assert.equal(a.length, 16);
  assert.equal(b.length, 16);
  assert.notEqual(a, b);
  assert.doesNotMatch(a, /\s/);
});

test('B11b unassign refusal names blockers (S-10 409 human)', () => {
  const msg = assignUnassignRefusal({ answers: 2, evaluations: 1 });
  assert.match(msg, /2 answer\(s\)/);
  assert.match(msg, /1 evaluation\(s\)/);
});

test('B11b visibility: show_gap=false redacts scores (S-09 flags wiring)', () => {
  const rows = [
    { score: 75, coveragePercentage: 50 },
    { score: null, coveragePercentage: 0 },
  ];
  const redacted = applyShowGapFlags(rows, { showGap: false, showCorrective: true });
  assert.equal(redacted[0].score, null);
  assert.equal(redacted[0].coveragePercentage, null);
  const visible = applyShowGapFlags(rows, { showGap: true, showCorrective: true });
  assert.equal(visible[0].score, 75);
});

test('B11b security shapes: suspended body carries no user data; stripSecrets drops hashes/OTPs', () => {
  const s = suspendedLoginBody();
  assert.equal(s.suspended, true);
  assert.ok(!('user' in s) && !('token' in s));

  const g = passwordChangeRequiredBody();
  assert.equal(g.code, 'auth.password_change_required');

  const cleaned = stripSecrets({
    id: '1',
    email: 'a@x',
    password_hash: 'secret',
    oneTimePassword: 'otp-plain',
    name: 'A',
  } as any);
  assert.ok(!('password_hash' in cleaned));
  assert.ok(!('oneTimePassword' in cleaned));
  assert.equal((cleaned as any).email, 'a@x');
});
