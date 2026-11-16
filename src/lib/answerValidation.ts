// TASK-PROTO-U4-1B (OD-12 §1–2) — the ONE typed-answer contract.
//
// WHY a focused module: the evaluation save/submit handlers must agree on the
// same answer/value semantics, and the rules are pure (no DB, no Express) so
// they can be unit-tested without a live database. `answers.value` is the
// answer (it is the only text column on the row); `items.answer_type` says how
// to read it; `items.attachment_required` is an INDEPENDENT submit-time
// requirement; `answer_type='file'` has no text value at all — the attachment
// IS the answer. Drafts are deliberately lenient (typed value validated only
// when present, attachments always optional); submit is strict.
//
// Not a schema/DB module: it never reads the database and never echoes a raw
// input value back in an error message (the handler owns the envelope).

import { isItemAnswerType, type ItemAnswerType } from './taxonomy.ts';

/** OD-12 §1: a text answer is a non-empty trimmed string of at most 10 000 chars. */
export const MAX_TEXT_ANSWER_LENGTH = 10_000;

/** Own wire codes (never PostgreSQL diagnostics). Emitted through the existing
 * evaluations write catch, which passes an own statusCode+code through and
 * collapses anything else to the route's static fallback. */
export const ANSWER_TYPE_INVALID = 'answer.type_invalid' as const;
export const ANSWER_ATTACHMENT_REQUIRED = 'answer.attachment_required' as const;

export type AnswerRefusalCode = typeof ANSWER_TYPE_INVALID | typeof ANSWER_ATTACHMENT_REQUIRED;

/** Non-reflective human messages: no raw input value is interpolated. */
export const ANSWER_TYPE_INVALID_MESSAGE = "The answer does not match this item's answer type.";
export const ANSWER_ATTACHMENT_REQUIRED_MESSAGE =
  'This item requires at least one attachment before it can be submitted.';

/** R3 (SHIELD L-03): submit metadata is resolved STRICTLY — a missing item row or
 * an unknown stored answer_type is a refusal, never a silent `text` default. */
export const ANSWER_TYPE_UNRESOLVED = 'answer.type_unresolved' as const;
export const ANSWER_ITEM_UNRESOLVED = 'answer.item_unresolved' as const;
export const ANSWER_TYPE_UNRESOLVED_MESSAGE = "The item's answer type could not be resolved.";
export const ANSWER_ITEM_UNRESOLVED_MESSAGE = 'The item metadata could not be resolved.';

/** R4/R2 (SHIELD L-04, round 3): ALL Unicode format characters (`\p{Cf}`) plus
 * the explicit soft-hyphen/BOM members do not make a text answer non-empty. A
 * NUL is refused outright (PostgreSQL TEXT cannot store it; failing before the
 * INSERT keeps it a 400 own-code, never a 500). */
const INVISIBLE_TEXT = /[\p{Cf}\uFEFF\u00AD]/gu;
const NUL = '\u0000';

/** The five legal values are the taxonomy set. `normalizeAnswerType` remains the
 * defensive READER (unknown stored value -> text) for legacy rows; the submit
 * gate uses `resolveAnswerType` so it never invents a type. */
export function normalizeAnswerType(value: unknown): ItemAnswerType {
  return isItemAnswerType(value) ? value : 'text';
}

export type ResolvedAnswerType =
  | { ok: true; type: ItemAnswerType }
  | { ok: false; code: typeof ANSWER_TYPE_UNRESOLVED; message: string };

/** Strict resolver for the submit metadata (R3). Unlike `normalizeAnswerType`,
 * this NEVER substitutes `text`: an unknown/missing stored type is refused. */
export function resolveAnswerType(value: unknown): ResolvedAnswerType {
  return isItemAnswerType(value)
    ? { ok: true, type: value }
    : { ok: false, code: ANSWER_TYPE_UNRESOLVED, message: ANSWER_TYPE_UNRESOLVED_MESSAGE };
}

/** Absent/blank covers `undefined`, `null` and a whitespace-only string. A
 * boolean `false` and the number `0` are real answers, never "absent".
 * R4: JavaScript `trim()` also eats U+FEFF (the BOM), so a string whose only
 * content is an invisible character must stay "present" and be refused by the
 * text rule instead of silently becoming absent. */
export function isBlankAnswerValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'string') return false;
  if (value.trim() !== '') return false;
  // No real whitespace-only short-circuit when an invisible char remains.
  return value.replace(INVISIBLE_TEXT, '') === value;
}

export type AnswerValueResult =
  | { ok: true; value: string; provided: boolean }
  | { ok: false; code: AnswerRefusalCode; message: string };

function invalidType(): { ok: false; code: AnswerRefusalCode; message: string } {
  return { ok: false, code: ANSWER_TYPE_INVALID, message: ANSWER_TYPE_INVALID_MESSAGE };
}

/** Strict signed decimal (integer/fraction/exponent). Deliberately rejects
 * `Infinity`, `NaN`, hex (`0x10`), grouped digits (`1,000`) and booleans: the
 * task says "finite numeric, signed", and a loose `Number()` would admit all
 * of those. */
const DECIMAL = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;

function canonicalNumber(raw: unknown): string | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? String(raw) : null;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!DECIMAL.test(trimmed)) return null;
  return Number.isFinite(Number(trimmed)) ? trimmed : null;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` AND a real calendar day (2024-02-29 yes, 2026-02-29 no). */
function canonicalDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const match = ISO_DATE.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(`${trimmed}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  // Round-trip catches overflow days (e.g. 2026-04-31 -> 2026-05-01).
  return date.getUTCFullYear() === year
    && date.getUTCMonth() + 1 === month
    && date.getUTCDate() === day
    ? trimmed
    : null;
}

function canonicalBoolean(raw: unknown): string | null {
  if (raw === true || raw === 'true') return 'true';
  if (raw === false || raw === 'false') return 'false';
  return null;
}

/**
 * Validate ONE typed answer value. `provided:false` means the caller supplied
 * nothing (draft leniency); `file` never accepts a text value. Unknown answer
 * types are validated as `text`.
 */
export function validateAnswerValue(answerType: unknown, rawValue: unknown): AnswerValueResult {
  const type = normalizeAnswerType(answerType);
  if (isBlankAnswerValue(rawValue)) return { ok: true, value: '', provided: false };
  // R4: a NUL can never reach PostgreSQL TEXT (it would surface as a 500); it is
  // a value/type refusal for every answer_type.
  if (typeof rawValue === 'string' && rawValue.includes(NUL)) return invalidType();

  switch (type) {
    case 'file':
      // The attachment is the answer; a text value is a type violation.
      return invalidType();
    case 'text': {
      if (typeof rawValue !== 'string') return invalidType();
      const value = rawValue.trim();
      // R4: invisible-only content is not an answer. Strip the zero-width/
      // soft-hyphen set for the non-empty check (the stored value keeps its
      // original trimmed form when real content exists).
      const visible = value.replace(INVISIBLE_TEXT, '').trim();
      if (value.length === 0 || value.length > MAX_TEXT_ANSWER_LENGTH || visible.length === 0) return invalidType();
      return { ok: true, value, provided: true };
    }
    case 'number': {
      const value = canonicalNumber(rawValue);
      return value === null ? invalidType() : { ok: true, value, provided: true };
    }
    case 'boolean': {
      const value = canonicalBoolean(rawValue);
      return value === null ? invalidType() : { ok: true, value, provided: true };
    }
    case 'date': {
      const value = canonicalDate(rawValue);
      return value === null ? invalidType() : { ok: true, value, provided: true };
    }
  }
}

export interface SubmitAnswerInput {
  answerType: unknown;
  /** A stored N/A-with-reason outcome satisfies the typed-answer requirement
   * (OD-12 §4, unchanged path) — but NOT `attachment_required`, which is an
   * independent item rule (see the decision note below). */
  notApplicable: boolean;
  /** The persisted `answers.value`. */
  value: unknown;
  attachmentCount: number;
  attachmentRequired: boolean;
}

export type SubmitAnswerResult = { ok: true } | { ok: false; code: AnswerRefusalCode; message: string };

/**
 * Submit-time gate (OD-12 §2–4). Drafts never call this.
 *
 * N/A decision (task §1 rule 4): N/A-with-reason satisfies the ANSWER
 * requirement — including `answer_type='file'`, whose attachment is otherwise
 * the answer. `attachment_required` is NOT bypassed by N/A: it is defined as an
 * independent requirement on the item ("blocks submission without an attachment
 * even if a written answer exists", OD-12 §2), and N/A is an outcome rather than
 * an answer. This is the literal reading of "attachments not required unless
 * item also attachment_required" and is pinned by the unit matrix.
 */
export function validateSubmitAnswer(input: SubmitAnswerInput): SubmitAnswerResult {
  const type = normalizeAnswerType(input.answerType);
  const attachmentCount = Number.isFinite(input.attachmentCount) && input.attachmentCount > 0
    ? input.attachmentCount
    : 0;

  if (input.notApplicable) {
    if (input.attachmentRequired && attachmentCount < 1) {
      return { ok: false, code: ANSWER_ATTACHMENT_REQUIRED, message: ANSWER_ATTACHMENT_REQUIRED_MESSAGE };
    }
    return { ok: true };
  }

  const value = validateAnswerValue(type, input.value);
  if (type === 'file') {
    // `validateAnswerValue` already refuses a non-empty text value for file.
    if (!value.ok) return { ok: false, code: value.code, message: value.message };
    if (attachmentCount < 1) {
      return { ok: false, code: ANSWER_ATTACHMENT_REQUIRED, message: ANSWER_ATTACHMENT_REQUIRED_MESSAGE };
    }
    return { ok: true };
  }

  // Non-file: the typed answer is mandatory at submit, whatever its type.
  if (!value.ok) return { ok: false, code: value.code, message: value.message };
  if (!value.provided) {
    return { ok: false, code: ANSWER_TYPE_INVALID, message: ANSWER_TYPE_INVALID_MESSAGE };
  }
  if (input.attachmentRequired && attachmentCount < 1) {
    return { ok: false, code: ANSWER_ATTACHMENT_REQUIRED, message: ANSWER_ATTACHMENT_REQUIRED_MESSAGE };
  }
  return { ok: true };
}
