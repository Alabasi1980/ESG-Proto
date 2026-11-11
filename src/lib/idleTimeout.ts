// B12 (S-01: idle timeout) — pure, unit-testable idle-state decision.
//
// Rule: 30 minutes of inactivity → auto logout; at 28 minutes the UI shows
// a bilingual warning with a countdown. Any pointer/key/touch activity
// resets the clock. The React wiring (listeners + timers) lives in App.tsx;
// this module owns the threshold math so it stays testable without a DOM.

export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const IDLE_WARNING_MS = 28 * 60 * 1000;

export type IdleState = 'active' | 'warning' | 'expired';

/**
 * Returns the idle state for `nowMs` given the last-activity timestamp.
 * Boundaries: exactly at warning → 'warning'; at/after timeout → 'expired'.
 */
export function idleState(lastActivityMs: number, nowMs: number): IdleState {
  const idleFor = nowMs - lastActivityMs;
  if (idleFor >= IDLE_TIMEOUT_MS) return 'expired';
  if (idleFor >= IDLE_WARNING_MS) return 'warning';
  return 'active';
}

/** Whole seconds remaining until auto logout (0 when already expired). */
export function idleSecondsRemaining(lastActivityMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((IDLE_TIMEOUT_MS - (nowMs - lastActivityMs)) / 1000));
}
