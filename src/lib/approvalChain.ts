/**
 * Pure approval-chain / freeze / optimistic-locking / attachment decisions for
 * FIX-BATCH-9 (MP-44/45/46/47, S-15/17/18, M-10, WF-02/03/05, A-15, OD-06).
 *
 * These helpers encode the branching rules WITHOUT touching the database, so
 * they are unit-testable (`approvalChain.test.ts`). Routes call them first,
 * then perform the DB existence/RLS checks inside the tenant context.
 *
 * Production object-storage migration for attachments is explicitly out of
 * scope (OD-06, demo-scale): files stay in DB bytea with a 5 MB cap.
 */

import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// A. Client-approval gate (MP-44, S-17, WF-02)
// ---------------------------------------------------------------------------

/** Answer statuses that count as "at least dept-approved". */
export const DEPT_APPROVED_STATUSES = ['approved', 'client_approved'] as const;

/** Full answer-status domain after B9 (adds `client_approved`). */
export const ANSWER_STATUSES_B9 = [
  'draft',
  'submitted',
  'approved',
  'client_approved',
  'reopened',
  'returned',
] as const;

export interface DepartmentScopeRow {
  departmentId: string;
  departmentName: string;
  /** Current answer status for this department in the disclosure scope. */
  answerStatus: string | null;
  /** True when the linked evaluation is N/A with a stored reason. */
  notApplicable?: boolean | null;
}

export type ClientApproveGate =
  | { ok: true }
  | { ok: false; incomplete: string[] };

/**
 * A1: client approval is allowed ONLY when every department assignment for the
 * same disclosure is at least dept-approved (or N/A with reason). Returns the
 * names of the incomplete departments so the 409 message proves the refusal.
 */
export function clientApproveGate(rows: DepartmentScopeRow[]): ClientApproveGate {
  const rawIncomplete = rows
    .filter(
      (r) =>
        !(DEPT_APPROVED_STATUSES as readonly string[]).includes(r.answerStatus ?? '') &&
        !r.notApplicable
    )
    .map((r) => r.departmentName);
  const incomplete = Array.from(new Set(rawIncomplete));
  return incomplete.length === 0 ? { ok: true } : { ok: false, incomplete };
}

/** Human 409 message naming the incomplete departments (API uses code + this text). */
export function clientApproveRefusalMessage(incomplete: string[]): string {
  const uniqueIncomplete = Array.from(new Set(incomplete));
  return (
    `Client approval is blocked: ${uniqueIncomplete.length} department(s) are not dept-approved yet: ` +
    uniqueIncomplete.join(', ') +
    `. Every department in this disclosure must be approved (or marked N/A with a reason) first.`
  );
}

// ---------------------------------------------------------------------------
// B. GE final + freeze (MP-45, S-18/M-10, WF-03/WF-05)
// ---------------------------------------------------------------------------

export const GE_FINAL_SCOPES = ['disclosure', 'tenant'] as const;
export type GeFinalScope = (typeof GE_FINAL_SCOPES)[number];

export function isGeFinalScope(value: unknown): value is GeFinalScope {
  return typeof value === 'string' && (GE_FINAL_SCOPES as readonly string[]).includes(value);
}

export interface GeFinalCheckRow {
  itemId: string;
  code: string;
  answerStatus: string | null;
  notApplicable?: boolean | null;
  naReason?: string | null;
}

export type GeFinalGate =
  | { ok: true }
  | { ok: false; incomplete: string[] };

/**
 * B1: GE final freeze requires every in-scope evaluation to be client-approved
 * (or N/A with a stored reason). Returns offending item codes for the refusal.
 */
export function geFinalGate(rows: GeFinalCheckRow[]): GeFinalGate {
  const incomplete = rows
    .filter((r) => {
      if (r.answerStatus === 'client_approved') return false;
      if (r.notApplicable && r.naReason) return false;
      return true;
    })
    .map((r) => r.code);
  return incomplete.length === 0 ? { ok: true } : { ok: false, incomplete };
}

/** Deterministic content hash for a snapshot payload (hex sha256). */
export function snapshotContentHash(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

/** Stable (key-sorted) stringify so the hash is deterministic. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

// ---------------------------------------------------------------------------
// C. Optimistic locking (MP-46, A-15)
// ---------------------------------------------------------------------------

export interface VersionedOutcome {
  version: number;
  score: number | null;
  notEvaluated: boolean | null;
  notApplicable: boolean | null;
  naReason: string | null;
  evidenceNote: string | null;
  actorId: string | null;
  actorName: string | null;
  updatedAt: string | null;
}

export interface VersionConflict {
  conflict: true;
  expectedVersion: number | null;
  providedVersion: number | null;
  current: VersionedOutcome;
  attempted: { score?: unknown; flags?: unknown; evidenceNote?: unknown };
}

/**
 * C1: every mutating evaluation endpoint requires the caller's version.
 * Missing version → caller must reload (400); mismatch → 409 with BOTH
 * versions' {score, flags, evidence note, actor, time} for the mine-vs-theirs UI.
 */
export function checkVersion(
  current: VersionedOutcome | null,
  provided: unknown,
  attempted: VersionConflict['attempted']
): { ok: true } | { ok: false; status: 400 | 409; conflict: VersionConflict } {
  if (provided === undefined || provided === null || provided === '') {
    return {
      ok: false,
      status: 400,
      conflict: {
        conflict: true,
        expectedVersion: current?.version ?? null,
        providedVersion: null,
        current: current ?? emptyOutcome(),
        attempted,
      },
    };
  }
  const providedVersion = Number(provided);
  if (!Number.isInteger(providedVersion)) {
    return {
      ok: false,
      status: 400,
      conflict: {
        conflict: true,
        expectedVersion: current?.version ?? null,
        providedVersion: null,
        current: current ?? emptyOutcome(),
        attempted,
      },
    };
  }
  if (!current || current.version !== providedVersion) {
    return {
      ok: false,
      status: 409,
      conflict: {
        conflict: true,
        expectedVersion: current?.version ?? null,
        providedVersion,
        current: current ?? emptyOutcome(),
        attempted,
      },
    };
  }
  return { ok: true };
}

function emptyOutcome(): VersionedOutcome {
  return {
    version: 0,
    score: null,
    notEvaluated: null,
    notApplicable: null,
    naReason: null,
    evidenceNote: null,
    actorId: null,
    actorName: null,
    updatedAt: null,
  };
}

// ---------------------------------------------------------------------------
// D. Attachments 5 MB (MP-47, S-15, OD-06)
// ---------------------------------------------------------------------------

/** OD-06 demo-scale cap: 5 MiB, enforced in DB (CHECK) and API (human 400). */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5242880

/**
 * Small demo allowlist (OD-06). Production object-storage migration is out of
 * scope; keep this list tight until then.
 */
export const ALLOWED_ATTACHMENT_MIMES: Record<string, string[]> = {
  pdf: ['application/pdf'],
  png: ['image/png'],
  jpeg: ['image/jpeg'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  csv: ['text/csv'],
  txt: ['text/plain'],
};

const ALLOWED_MIME_SET = new Set(Object.values(ALLOWED_ATTACHMENT_MIMES).flat());

export type AttachmentRejection = { ok: false; code: 'attachments.oversize' | 'attachments.mime' } | { ok: true };

/** D1/D2: server-side re-check of size + mime (never trust the client). */
export function validateAttachment(input: { mime?: unknown; sizeBytes?: unknown }): AttachmentRejection {
  const size = typeof input.sizeBytes === 'number' ? input.sizeBytes : NaN;
  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, code: 'attachments.mime' };
  }
  if (size > MAX_ATTACHMENT_BYTES) {
    return { ok: false, code: 'attachments.oversize' };
  }
  const mime = typeof input.mime === 'string' ? input.mime.toLowerCase().trim() : '';
  if (!ALLOWED_MIME_SET.has(mime)) {
    return { ok: false, code: 'attachments.mime' };
  }
  return { ok: true };
}

/** D3: global demo-DB warning threshold (demo DB is 1 GB). */
export const STORAGE_WARN_BYTES = 800 * 1024 * 1024;

/** Human-readable byte readout for the Settings storage monitor. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 100 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
}
