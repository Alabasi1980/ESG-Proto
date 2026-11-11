import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_TRANSITIONS,
  actionTransitionRequiresAdmin,
  actionTransitionRequiresReason,
  canTransitionAction,
  isActionStatus,
  type ActionStatus,
} from './actions';

// --- WF-04 transition map ---

test('WF-04: open → in_progress only', () => {
  assert.deepEqual(ACTION_TRANSITIONS.open, ['in_progress']);
  assert.equal(canTransitionAction('open', 'in_progress'), true);
  assert.equal(canTransitionAction('open', 'closed'), false);
  assert.equal(canTransitionAction('open', 'awaiting_verification'), false);
  assert.equal(canTransitionAction('open', 'reopened'), false);
});

test('WF-04: in_progress → awaiting_verification only', () => {
  assert.equal(canTransitionAction('in_progress', 'awaiting_verification'), true);
  assert.equal(canTransitionAction('in_progress', 'closed'), false);
  assert.equal(canTransitionAction('in_progress', 'open'), false);
});

test('WF-04: awaiting_verification → closed | reopened', () => {
  assert.equal(canTransitionAction('awaiting_verification', 'closed'), true);
  assert.equal(canTransitionAction('awaiting_verification', 'reopened'), true);
  assert.equal(canTransitionAction('awaiting_verification', 'open'), false);
  assert.equal(canTransitionAction('awaiting_verification', 'in_progress'), false);
});

test('WF-04: closed → reopened only (never straight back to work)', () => {
  assert.equal(canTransitionAction('closed', 'reopened'), true);
  assert.equal(canTransitionAction('closed', 'open'), false);
  assert.equal(canTransitionAction('closed', 'in_progress'), false);
  assert.equal(canTransitionAction('closed', 'closed'), false);
});

test('WF-04: reopened → in_progress (rework restarts with the owner)', () => {
  assert.equal(canTransitionAction('reopened', 'in_progress'), true);
  assert.equal(canTransitionAction('reopened', 'closed'), false);
  assert.equal(canTransitionAction('reopened', 'open'), false);
});

test('WF-04: every other pair is refused', () => {
  const all: ActionStatus[] = ['open', 'in_progress', 'awaiting_verification', 'closed', 'reopened'];
  let allowed = 0;
  for (const from of all) {
    for (const to of all) {
      if (from !== to && canTransitionAction(from, to)) allowed++;
    }
  }
  // open→in_progress, in_progress→awaiting, awaiting→closed, awaiting→reopened,
  // closed→reopened, reopened→in_progress = exactly 6 legal transitions.
  assert.equal(allowed, 6);
});

// --- reason + admin gates ---

test('WF-04: reopened always requires a reason; other targets do not', () => {
  assert.equal(actionTransitionRequiresReason('reopened'), true);
  for (const s of ['open', 'in_progress', 'awaiting_verification', 'closed'] as const) {
    assert.equal(actionTransitionRequiresReason(s), false);
  }
});

test('WF-04: close/reopen are admin-only; work transitions are not', () => {
  assert.equal(actionTransitionRequiresAdmin('closed'), true);
  assert.equal(actionTransitionRequiresAdmin('reopened'), true);
  assert.equal(actionTransitionRequiresAdmin('in_progress'), false);
  assert.equal(actionTransitionRequiresAdmin('awaiting_verification'), false);
});

test('WF-04: status guard accepts the five states and rejects the rest', () => {
  for (const s of ['open', 'in_progress', 'awaiting_verification', 'closed', 'reopened']) {
    assert.equal(isActionStatus(s), true);
  }
  assert.equal(isActionStatus('archived'), false);
  assert.equal(isActionStatus(''), false);
  assert.equal(isActionStatus(null), false);
});
