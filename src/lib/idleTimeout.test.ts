import test from 'node:test';
import assert from 'node:assert/strict';
import { IDLE_TIMEOUT_MS, IDLE_WARNING_MS, idleSecondsRemaining, idleState } from './idleTimeout.ts';

test('B12 idle: thresholds are 30 min timeout / 28 min warning (S-01)', () => {
  assert.equal(IDLE_TIMEOUT_MS, 30 * 60 * 1000);
  assert.equal(IDLE_WARNING_MS, 28 * 60 * 1000);
});

test('B12 idle: active → warning → expired boundaries', () => {
  const t0 = 1_000_000;
  assert.equal(idleState(t0, t0), 'active');
  assert.equal(idleState(t0, t0 + IDLE_WARNING_MS - 1), 'active');
  assert.equal(idleState(t0, t0 + IDLE_WARNING_MS), 'warning');
  assert.equal(idleState(t0, t0 + IDLE_TIMEOUT_MS - 1), 'warning');
  assert.equal(idleState(t0, t0 + IDLE_TIMEOUT_MS), 'expired');
  assert.equal(idleState(t0, t0 + IDLE_TIMEOUT_MS + 60_000), 'expired');
});

test('B12 idle: countdown seconds remaining', () => {
  const t0 = 1_000_000;
  assert.equal(idleSecondsRemaining(t0, t0), 1800);
  assert.equal(idleSecondsRemaining(t0, t0 + IDLE_WARNING_MS), 120);
  assert.equal(idleSecondsRemaining(t0, t0 + IDLE_TIMEOUT_MS), 0);
  assert.equal(idleSecondsRemaining(t0, t0 + IDLE_TIMEOUT_MS + 5_000), 0);
});
