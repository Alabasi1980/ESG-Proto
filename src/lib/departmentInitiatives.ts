// TASK-PROTO-U4-1c (OD-12 §4/§8) — department initiative status contract.
//
// One row per (selected client initiative × department): did the department
// perform it, with a note and independent proof files. The employee writes it;
// W/C only read. No CHECK constraint exists in schema.sql, so this module is the
// single validation point for PATCH /initiatives/department/:id.
import { MAX_NOTE_LENGTH } from './documents.ts';

export interface InitiativeStatusPatch {
  performed?: boolean;
  note?: string | null;
}

export type InitiativeRefusal = { ok: false; status: 400; code: string; error: string };

/** performed / note only — the department never edits the initiative itself. */
export function validateInitiativeStatusPatch(
  body: Record<string, any>,
): { ok: true; value: InitiativeStatusPatch } | InitiativeRefusal {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, code: 'initiatives.invalid', error: 'A JSON object body is required.' };
  }
  const allowed = new Set(['performed', 'note']);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) {
      return { ok: false, status: 400, code: 'initiatives.field_refused',
        error: `Only performed and note may be updated (refused: ${key}).` };
    }
  }
  const value: InitiativeStatusPatch = {};
  if (body.performed !== undefined) {
    if (typeof body.performed !== 'boolean') {
      return { ok: false, status: 400, code: 'initiatives.performed_invalid', error: 'performed must be a boolean.' };
    }
    value.performed = body.performed;
  }
  if (body.note !== undefined) {
    if (body.note !== null && typeof body.note !== 'string') {
      return { ok: false, status: 400, code: 'initiatives.note_invalid', error: 'note must be a string or null.' };
    }
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (note.length > MAX_NOTE_LENGTH) {
      return { ok: false, status: 400, code: 'initiatives.note_invalid',
        error: `note must be at most ${MAX_NOTE_LENGTH} characters.` };
    }
    value.note = note || null;
  }
  if (Object.keys(value).length === 0) {
    return { ok: false, status: 400, code: 'initiatives.empty_patch', error: 'Provide performed and/or note.' };
  }
  return { ok: true, value };
}

/** A department status row becomes a submission the first time `performed` is
 * recorded true; that timestamp is what locks its proof files (mirror U4-1b). */
export function stampsSubmission(performed: boolean | undefined, submittedAt: unknown): boolean {
  return performed === true && (submittedAt === null || submittedAt === undefined);
}
