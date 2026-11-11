import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED_ATTACHMENT_MIMES,
  MAX_ATTACHMENT_BYTES,
  STORAGE_WARN_BYTES,
  checkVersion,
  clientApproveGate,
  clientApproveRefusalMessage,
  formatBytes,
  geFinalGate,
  snapshotContentHash,
  stableStringify,
  validateAttachment,
} from './approvalChain';

// --- A1: client-approve gate (prove refusal when any department pending) ---

test('A1: gate passes when every department is dept-approved or client-approved', () => {
  const gate = clientApproveGate([
    { departmentId: 'd1', departmentName: 'Finance', answerStatus: 'approved' },
    { departmentId: 'd2', departmentName: 'Ops', answerStatus: 'client_approved' },
    { departmentId: 'd3', departmentName: 'Legal', answerStatus: null, notApplicable: true },
  ]);
  assert.deepEqual(gate, { ok: true });
});

test('A1: gate refuses and NAMES the incomplete departments', () => {
  const gate = clientApproveGate([
    { departmentId: 'd1', departmentName: 'Finance', answerStatus: 'approved' },
    { departmentId: 'd2', departmentName: 'Ops', answerStatus: 'submitted' },
    { departmentId: 'd3', departmentName: 'Legal', answerStatus: 'draft' },
    { departmentId: 'd4', departmentName: 'HR', answerStatus: null },
  ]);
  assert.equal(gate.ok, false);
  if (!gate.ok) {
    assert.deepEqual(gate.incomplete, ['Ops', 'Legal', 'HR']);
    const msg = clientApproveRefusalMessage(gate.incomplete);
    assert.match(msg, /Ops/);
    assert.match(msg, /Legal/);
    assert.match(msg, /HR/);
  }
});

test('A1: deduplicates incomplete department names when multiple items are assigned to same department', () => {
  const gate = clientApproveGate([
    { departmentId: 'd3', departmentName: 'Legal', answerStatus: 'draft' },
    { departmentId: 'd3', departmentName: 'Legal', answerStatus: 'draft' },
    { departmentId: 'd3', departmentName: 'Legal', answerStatus: 'draft' },
  ]);
  assert.equal(gate.ok, false);
  if (!gate.ok) {
    assert.deepEqual(gate.incomplete, ['Legal']);
    const msg = clientApproveRefusalMessage(gate.incomplete);
    assert.equal(
      msg,
      'Client approval is blocked: 1 department(s) are not dept-approved yet: Legal. Every department in this disclosure must be approved (or marked N/A with a reason) first.'
    );
  }
});

test('A1: submitted/returned/draft never count as dept-approved', () => {
  for (const status of ['submitted', 'returned', 'draft', 'reopened']) {
    const gate = clientApproveGate([{ departmentId: 'd', departmentName: 'X', answerStatus: status }]);
    assert.equal(gate.ok, false);
  }
});

// --- B1: GE-final gate ---

test('B1: GE final requires client-approved (or N/A with reason) everywhere', () => {
  assert.deepEqual(
    geFinalGate([
      { itemId: 'i1', code: '2-1-a', answerStatus: 'client_approved' },
      { itemId: 'i2', code: '2-1-b', answerStatus: null, notApplicable: true, naReason: 'legal-prohibitions' },
    ]),
    { ok: true }
  );
  const refused = geFinalGate([
    { itemId: 'i1', code: '2-1-a', answerStatus: 'client_approved' },
    { itemId: 'i2', code: '2-1-b', answerStatus: 'approved' },
    { itemId: 'i3', code: '2-1-c', answerStatus: null, notApplicable: true, naReason: null },
  ]);
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.deepEqual(refused.incomplete, ['2-1-b', '2-1-c']);
});

test('B1: snapshot hash is deterministic and content-sensitive', () => {
  const payload = { scope: 'tenant', items: [{ itemId: 'a', score: 100 }], aggregate: 100 };
  const h1 = snapshotContentHash(payload);
  const h2 = snapshotContentHash({ aggregate: 100, items: [{ score: 100, itemId: 'a' }], scope: 'tenant' });
  assert.equal(h1, h2);
  assert.equal(h1.length, 64);
  assert.notEqual(h1, snapshotContentHash({ ...payload, aggregate: 50 }));
  assert.equal(stableStringify({ b: 1, a: 2 }), '{"a":2,"b":1}');
});

// --- C1: optimistic locking ---

const current = {
  version: 3,
  score: 50,
  notEvaluated: false,
  notApplicable: false,
  naReason: null,
  evidenceNote: 'old note',
  actorId: 'u1',
  actorName: 'Sara',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

test('C1: matching version passes', () => {
  assert.deepEqual(checkVersion(current, 3, {}), { ok: true });
});

test('C1: stale version gets 409 WITH the current outcome (mine-vs-theirs)', () => {
  const res = checkVersion(current, 2, { score: 100 });
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.status, 409);
    assert.equal(res.conflict.expectedVersion, 3);
    assert.equal(res.conflict.providedVersion, 2);
    assert.equal(res.conflict.current.score, 50);
    assert.equal(res.conflict.current.evidenceNote, 'old note');
    assert.equal(res.conflict.current.actorName, 'Sara');
  }
});

test('C1: missing/garbage version is 400 (reload required), not a silent win', () => {
  for (const bad of [undefined, null, '', 'abc', 1.5]) {
    const res = checkVersion(current, bad, {});
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.status, 400);
  }
});

// --- D: 5 MB boundary + mime allowlist ---

test('D: 5242880 bytes is accepted, 5242881 is rejected with the oversize key', () => {
  assert.equal(MAX_ATTACHMENT_BYTES, 5242880);
  assert.deepEqual(
    validateAttachment({ mime: 'application/pdf', sizeBytes: 5242880 }),
    { ok: true }
  );
  assert.deepEqual(
    validateAttachment({ mime: 'application/pdf', sizeBytes: 5242881 }),
    { ok: false, code: 'attachments.oversize' }
  );
});

test('D: only the small allowlist passes the mime check', () => {
  const allowed = Object.values(ALLOWED_ATTACHMENT_MIMES).flat();
  assert.deepEqual(allowed.length, 6);
  for (const mime of allowed) {
    assert.deepEqual(validateAttachment({ mime, sizeBytes: 10 }), { ok: true });
  }
  for (const bad of ['application/x-msdownload', 'application/javascript', 'image/svg+xml', '', undefined]) {
    const res = validateAttachment({ mime: bad, sizeBytes: 10 });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.code, 'attachments.mime');
  }
});

test('D3: storage warn threshold is 800 MB with human readout', () => {
  assert.equal(STORAGE_WARN_BYTES, 800 * 1024 * 1024);
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(5242880), '5 MB');
  assert.equal(formatBytes(800 * 1024 * 1024), '800 MB');
});
