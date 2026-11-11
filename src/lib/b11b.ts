// B11b — GE ops / client×service / manual assign / staff-list pure helpers.
//
// WHY a separate lib: routes.ts owns the DB/RLS wiring; this module owns the
// branchable decisions so they stay unit-testable without a database
// (same discipline as taxonomy.ts / reports.ts / tenantAccess.ts).
//
// Binding notes (not suggestions):
// - WF-01: client never creates accounts; only GE approval provisions.
// - S-09: suspended login → 200 {suspended:true} with no data (fail-closed).
// - S-10: unassign refused while answers/evaluations exist (409, human).
// - S-11/S-12: OTP appears ONLY in the single approval response; hash-only
//   storage; provisioned accounts start must_change_password=true; login
//   forces change before any other action. Never log passwords/OTPs.
// - S-13: client dashboard reuses dashboard math (drafts excluded via
//   gateDraftEvaluations, N/A excluded, coverage beside every score).

import { randomBytes } from 'crypto';

export const STAFF_LIST_STATUSES = ['draft', 'submitted', 'approved', 'rejected'] as const;
export type StaffListStatus = (typeof STAFF_LIST_STATUSES)[number];

export function isStaffListStatus(value: unknown): value is StaffListStatus {
  return typeof value === 'string' && (STAFF_LIST_STATUSES as readonly string[]).includes(value);
}

export const STAFF_NA_REASONS = [
  'not-applicable',
  'legal-prohibitions',
  'confidentiality-constraints',
  'information-unavailable-incomplete',
] as const;

export function isStaffNaReason(value: unknown): boolean {
  return typeof value === 'string' && (STAFF_NA_REASONS as readonly string[]).includes(value);
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export interface StaffRowInput {
  email: string;
  name: string;
  departmentId: string | null;
  departmentName: string | null;
  role: 'employee' | 'client_admin';
}

export type StaffListValidation =
  | { ok: true; rows: StaffRowInput[] }
  | { ok: false; status: 400; error: string };

/**
 * Validates POST /api/staff-lists rows (shape only; department existence and
 * tenant membership are checked in-route against the DB).
 * client_admin may propose employee (+ client_admin) rows; ge_admin role is
 * never provisioned through staff lists (403 in-route).
 */
export function validateStaffListRows(input: unknown): StaffListValidation {
  if (!Array.isArray(input) || input.length === 0) {
    return { ok: false, status: 400, error: 'rows (non-empty array) is required.' };
  }
  if (input.length > 200) {
    return { ok: false, status: 400, error: 'A staff list holds at most 200 rows per batch.' };
  }
  const seen = new Set<string>();
  const rows: StaffRowInput[] = [];
  for (let i = 0; i < input.length; i++) {
    const raw = (input as any[])[i] ?? {};
    const email = normalizeText(raw.email).toLowerCase();
    const name = normalizeText(raw.name);
    if (!email || !isValidEmail(email)) {
      return { ok: false, status: 400, error: `Row ${i + 1}: a valid email is required.` };
    }
    if (seen.has(email)) {
      return { ok: false, status: 400, error: `Row ${i + 1}: duplicate email '${email}' in this list.` };
    }
    seen.add(email);
    if (!name) {
      return { ok: false, status: 400, error: `Row ${i + 1}: name is required.` };
    }
    const roleRaw = normalizeText(raw.role) || 'employee';
    if (roleRaw !== 'employee' && roleRaw !== 'client_admin') {
      return { ok: false, status: 400, error: `Row ${i + 1}: role must be employee or client_admin.` };
    }
    const departmentId =
      typeof raw.departmentId === 'string' && raw.departmentId.trim() ? raw.departmentId.trim() : null;
    const departmentName = normalizeText(raw.departmentName ?? raw.department) || null;
    if (!departmentId && !departmentName) {
      return {
        ok: false,
        status: 400,
        error: `Row ${i + 1}: departmentId or departmentName is required (assigning to a non-existent department is forbidden).`,
      };
    }
    rows.push({ email, name, departmentId, departmentName, role: roleRaw as 'employee' | 'client_admin' });
  }
  return { ok: true, rows };
}

/**
 * Generates a one-time random password for staff provisioning.
 * Returned ONCE in the approval response; only its bcrypt hash is stored.
 * 16 chars from an unambiguous alphabet; crypto-backed.
 */
export function generateOneTimePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  const bytes = randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

/** Human 409 message for S-10 unassign refusal (answers/evaluations exist). */
export function assignUnassignRefusal(blockers: { answers: number; evaluations: number }): string {
  const parts: string[] = [];
  if (blockers.answers > 0) parts.push(`${blockers.answers} answer(s)`);
  if (blockers.evaluations > 0) parts.push(`${blockers.evaluations} evaluation(s)`);
  return `Cannot unassign: ${parts.join(' and ')} reference this assignment. Remove or N/A them first.`;
}

/** Human 403 when a client role attempts to provision accounts directly. */
export const CLIENT_PROVISION_REFUSAL =
  'Client accounts are provisioned only through GE approval of a submitted staff list. Direct account creation is forbidden (WF-01).';

/** Human 403 when assigning to a department outside the tenant. */
export function unknownDepartmentRefusal(): string {
  return 'Department not found in this tenant. Assigning to a non-existent department is forbidden.';
}

/** Suspended-login response shape (S-09): 200 with no user data. */
export function suspendedLoginBody(): { suspended: true; message: string } {
  return {
    suspended: true,
    message: 'This tenant is suspended. Contact the platform administrator.',
  };
}

/** Forced-change refusal (S-12): fail-closed 403 until the password changes. */
export const PASSWORD_CHANGE_REQUIRED_CODE = 'auth.password_change_required';
export function passwordChangeRequiredBody(): { error: string; code: string } {
  return {
    error: 'You must change your password before continuing. Set a new password first.',
    code: PASSWORD_CHANGE_REQUIRED_CODE,
  };
}

/**
 * Strips any secret-bearing keys from an object before it leaves the API.
 * Defence-in-depth for the MEDIUM binding condition (hash-never-in-response):
 * routes must never select password_hash, and this guard drops it if a
 * SELECT * ever slips through, plus any otp/oneTimePassword echoes.
 */
export function stripSecrets<T extends Record<string, any>>(row: T): T {
  if (!row || typeof row !== 'object') return row;
  const clone: Record<string, any> = { ...(row as any) };
  for (const key of [
    'password_hash',
    'passwordHash',
    'oneTimePassword',
    'one_time_password',
    'otp',
    'plainPassword',
    'plain_password',
  ]) {
    if (key in clone) delete clone[key];
  }
  return clone as T;
}
