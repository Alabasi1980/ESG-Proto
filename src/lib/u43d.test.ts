// TASK-PROTO-U4-3d (G3 UI-removal-only): the P staff-list surface is a
// read-only directory. No approve/reject/provision/OTP affordances may exist
// in StaffListsView; routes stay behind the matrix (server untouched).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const view = readFileSync('src/views/StaffListsView.tsx', 'utf8');
const i18n = readFileSync('src/i18n/translations.ts', 'utf8');

test('U4-3d: no P provisioning affordances in StaffListsView', () => {
  for (const needle of [
    'handleApprove', 'handleReject', 'lastOtps', 'oneTimePassword',
    'rejectReason', 'approveBtn', 'rejectBtn', 'otpTitle', 'otpWarning',
    'rejectReasonPh', 'KeyRound',
  ]) assert.doesNotMatch(view, new RegExp(needle), `view must not reference ${needle}`);
  assert.doesNotMatch(view, /\/approve/, 'no approve route call');
  assert.doesNotMatch(view, /\/reject/, 'no reject route call');
  assert.doesNotMatch(view, /\bprovision/i, 'no provisioning copy');
  assert.doesNotMatch(view, /\bOTP\b/, 'no OTP copy');
});

test('U4-3d: read-only directory surface intact', () => {
  assert.match(view, /\/api\/staff-lists/, 'lists fetch stays');
  assert.match(view, /\/api\/staff-lists\/\$\{id\}\/submit/, 'draft submit stays');
  assert.match(view, /t\.staffLists\.emptyText/, 'empty state stays');
  assert.match(view, /statusLabels/, 'status badges stay');
  assert.match(view, /t\.common\.refresh/, 'refresh stays');
  assert.match(view, /l\.rows\.map/, 'row details stay');
});

test('U4-3d: read-only copy replaces provisioning wording (AR+EN)', () => {
  assert.doesNotMatch(i18n, /provisions accounts/, 'EN provisioning subtitle gone');
  assert.doesNotMatch(i18n, /ينشئ الحسابات/, 'AR provisioning subtitle gone');
  assert.match(i18n, /Read-only staff-list directory/, 'EN read-only note present');
  assert.match(i18n, /consultant workspace/, 'EN W-ownership note present');
  assert.match(i18n, /للقراءة فقط/, 'AR read-only note present');
  assert.match(i18n, /مساحة عمل المستشار/, 'AR W-ownership note present');
});

test('U4-3d UI-only: no server transaction or secret surface', () => {
  assert.doesNotMatch(view, /\bdomainTransaction\s*\(/, 'no transaction boundary');
  assert.doesNotMatch(view, /\brecordAuditLog\s*\(/, 'no audit write');
  assert.doesNotMatch(view, /from '.*\.\.\/server\//, 'no server import');
  assert.doesNotMatch(view, /from '.*\.\.\/db\//, 'no db import');
});
