/**
 * Pure WF-04 action lifecycle rules (BATCH B8 / MP-40).
 *
 * Transition map (binding):
 *   open → in_progress → awaiting_verification → closed
 *   awaiting_verification → closed | reopened (reason required)
 *   closed → reopened (reason required)
 *   reopened → in_progress (rework restarts with the owning department)
 *
 * Anything else is refused (409 in routes). Transitions INTO closed/reopened
 * are admin-only (client_admin / ge_admin); exceeding employees get 403.
 * Closing an action NEVER touches evaluations (routes only UPDATE actions).
 */

export type ActionStatus =
  | 'open'
  | 'in_progress'
  | 'awaiting_verification'
  | 'closed'
  | 'reopened';

export const ACTION_STATUSES: readonly ActionStatus[] = [
  'open',
  'in_progress',
  'awaiting_verification',
  'closed',
  'reopened',
];

export function isActionStatus(value: unknown): value is ActionStatus {
  return (
    typeof value === 'string' &&
    (ACTION_STATUSES as readonly string[]).includes(value)
  );
}

/** Allowed next states for every WF-04 state. */
export const ACTION_TRANSITIONS: Record<ActionStatus, ActionStatus[]> = {
  open: ['in_progress'],
  in_progress: ['awaiting_verification'],
  awaiting_verification: ['closed', 'reopened'],
  closed: ['reopened'],
  reopened: ['in_progress'],
};

export function canTransitionAction(
  from: ActionStatus,
  to: ActionStatus
): boolean {
  return ACTION_TRANSITIONS[from].includes(to);
}

/** `reopened` always needs a recorded reason (appended to audit_log). */
export function actionTransitionRequiresReason(to: ActionStatus): boolean {
  return to === 'reopened';
}

/** Verify/close/reopen are admin-only; employees get 403 in routes. */
export function actionTransitionRequiresAdmin(to: ActionStatus): boolean {
  return to === 'closed' || to === 'reopened';
}
