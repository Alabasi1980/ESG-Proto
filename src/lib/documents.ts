// TASK-PROTO-U4-1c (OD-12 §3/§5/§7) — the pure contracts behind the department
// document list and the two item-classification helpers (indicator_code, tags).
//
// NO business CHECK constraints exist for any of this in schema.sql (task
// discipline: handler validation). This module is that single validation point,
// so every route and the (future) UI read the SAME rules:
//   - tags:     array of at most 10 strings, each 1..40 chars after trim;
//   - indicator: `c (i)`-style short code, at most 40 chars, single line;
//   - document requirement: service-owned, optional department binding;
//   - submission patch: ONLY provided / note / tag (department-owned row).
import { GENERAL_DISCLOSURE_CODE, GENERAL_STANDARD_PREFIX } from './generalBucket.ts';

export const MAX_DOCUMENT_TAGS = 10;
export const MAX_TAG_LENGTH = 40;
export const MAX_INDICATOR_CODE_LENGTH = 40;
export const MAX_DOCUMENT_TITLE_LENGTH = 300;
export const MAX_DOCUMENT_DESCRIPTION_LENGTH = 2000;
export const MAX_NOTE_LENGTH = 4000;

/** The two parents `evidence_files` may carry (contract §1.6). */
export const EVIDENCE_ENTITY_TYPES = ['document_submission', 'initiative_status'] as const;
export type EvidenceEntityType = (typeof EVIDENCE_ENTITY_TYPES)[number];
export function isEvidenceEntityType(value: unknown): value is EvidenceEntityType {
  return typeof value === 'string' && (EVIDENCE_ENTITY_TYPES as readonly string[]).includes(value);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Refusal = { ok: false; status: 400; code: string; error: string };
export type Accepted<T> = { ok: true; value: T };

const refuse = (code: string, error: string): Refusal => ({ ok: false, status: 400, code, error });

/** Trim + length/single-line check shared by tags and the indicator code. */
function cleanShortText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null; // no control chars/newlines
  return trimmed;
}

/** Free tags on an item / requirement / initiative row (OD-12 §5). */
export function normalizeTags(value: unknown): Accepted<string[]> | Refusal {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) return refuse('documents.tags_invalid', `tags must be an array of at most ${MAX_DOCUMENT_TAGS} strings.`);
  if (value.length > MAX_DOCUMENT_TAGS) {
    return refuse('documents.tags_invalid', `At most ${MAX_DOCUMENT_TAGS} tags are allowed.`);
  }
  const tags: string[] = [];
  for (const entry of value) {
    const tag = cleanShortText(entry, MAX_TAG_LENGTH);
    if (!tag) return refuse('documents.tags_invalid', `Each tag must be a non-empty string of at most ${MAX_TAG_LENGTH} characters.`);
    if (!tags.includes(tag)) tags.push(tag);
  }
  return { ok: true, value: tags };
}

/** Item indicator code, e.g. `c (i)` — matches the department workbook column. */
export function normalizeIndicatorCode(value: unknown): Accepted<string | null> | Refusal {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return refuse('items.indicator_code_invalid', 'indicatorCode must be a string.');
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > MAX_INDICATOR_CODE_LENGTH || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    return refuse('items.indicator_code_invalid', `indicatorCode must be a single line of at most ${MAX_INDICATOR_CODE_LENGTH} characters.`);
  }
  return { ok: true, value: trimmed };
}

// ---------------------------------------------------------------------------
// Document requirements (P-managed, service-owned, optional department binding).
// ---------------------------------------------------------------------------

export interface RequirementInput {
  title: string;
  description: string | null;
  required: boolean;
  sortOrder: number;
  departmentId: string | null;
  tags: string[];
}

function optionalUuid(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return UUID_RE.test(trimmed) ? trimmed : null;
}

/**
 * `partial=false` validates POST /services/:id/documents (title required);
 * `partial=true` validates PATCH (only the supplied fields, at least one).
 */
export function validateRequirementInput(
  body: Record<string, any>,
  partial = false,
): Accepted<Partial<RequirementInput>> | Refusal {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return refuse('documents.invalid', 'A JSON object body is required.');
  const value: Partial<RequirementInput> = {};
  if (body.title !== undefined || !partial) {
    if (typeof body.title !== 'string') return refuse('documents.title_required', 'title is required.');
    const title = body.title.trim();
    if (!title) return refuse('documents.title_required', 'title is required.');
    if (title.length > MAX_DOCUMENT_TITLE_LENGTH) {
      return refuse('documents.title_invalid', `title must be at most ${MAX_DOCUMENT_TITLE_LENGTH} characters.`);
    }
    value.title = title;
  }
  if (body.description !== undefined) {
    if (body.description !== null && typeof body.description !== 'string') {
      return refuse('documents.description_invalid', 'description must be a string or null.');
    }
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (description.length > MAX_DOCUMENT_DESCRIPTION_LENGTH) {
      return refuse('documents.description_invalid', `description must be at most ${MAX_DOCUMENT_DESCRIPTION_LENGTH} characters.`);
    }
    value.description = description || null;
  }
  if (body.required !== undefined) {
    if (typeof body.required !== 'boolean') return refuse('documents.required_invalid', 'required must be a boolean.');
    value.required = body.required;
  }
  if (body.sortOrder !== undefined) {
    const order = Number(body.sortOrder);
    if (!Number.isInteger(order) || order < 0 || order > 999999) {
      return refuse('documents.sort_order_invalid', 'sortOrder must be a non-negative integer.');
    }
    value.sortOrder = order;
  }
  if (body.departmentId !== undefined) {
    const departmentId = optionalUuid(body.departmentId);
    if (body.departmentId !== null && body.departmentId !== '' && departmentId === null) {
      return refuse('documents.department_invalid', 'departmentId must be a UUID or null.');
    }
    value.departmentId = departmentId;
  }
  if (body.tags !== undefined) {
    const tags = normalizeTags(body.tags);
    if (!tags.ok) return tags;
    value.tags = tags.value;
  }
  if (partial && Object.keys(value).length === 0) {
    return refuse('documents.empty_patch', 'Provide title, description, required, sortOrder, departmentId and/or tags.');
  }
  return { ok: true, value };
}

export interface SubmissionPatch {
  provided?: boolean;
  note?: string | null;
  tag?: string | null;
}

/** PROTECT revision bound: PG-integer optimistic revisions, 0 = absent. */
export const MAX_EXPECTED_VERSION = 2147483647;

/** Shape-only check for the shared expectedVersion input (authoritative
 * mismatch handling lives in the route, after the anchor + scoped reread). */
export function validateExpectedVersionInput(raw: unknown): Accepted<number> | Refusal {
  if (raw === undefined || raw === null || raw === '') {
    return refuse('version.required', 'A version is required to save (optimistic locking). Reload the item and retry.');
  }
  const numeric = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > MAX_EXPECTED_VERSION) {
    return refuse('version.required', 'A version is required to save (optimistic locking). Reload the item and retry.');
  }
  return { ok: true, value: numeric };
}

/** PATCH /requirements/:id — provided/note/tag only (OD-12 §3). `expectedVersion`
 * is accepted as the optimistic-revision carrier (validated separately) and is
 * never treated as a patch field. */
export function validateSubmissionPatch(body: Record<string, any>): Accepted<SubmissionPatch> | Refusal {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return refuse('documents.invalid', 'A JSON object body is required.');
  const allowed = new Set(['provided', 'note', 'tag', 'expectedVersion']);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) return refuse('documents.field_refused', `Only provided, note and tag may be updated (refused: ${key}).`);
  }
  if (body.expectedVersion !== undefined) {
    const checked = validateExpectedVersionInput(body.expectedVersion);
    if (!checked.ok) return checked;
  }
  const value: SubmissionPatch = {};
  if (body.provided !== undefined) {
    if (typeof body.provided !== 'boolean') return refuse('documents.provided_invalid', 'provided must be a boolean.');
    value.provided = body.provided;
  }
  if (body.note !== undefined) {
    if (body.note !== null && typeof body.note !== 'string') return refuse('documents.note_invalid', 'note must be a string or null.');
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (note.length > MAX_NOTE_LENGTH) return refuse('documents.note_invalid', `note must be at most ${MAX_NOTE_LENGTH} characters.`);
    value.note = note || null;
  }
  if (body.tag !== undefined) {
    if (body.tag !== null && typeof body.tag !== 'string') return refuse('documents.tag_invalid', 'tag must be a string or null.');
    const tag = typeof body.tag === 'string' ? body.tag.trim() : '';
    if (tag.length > MAX_TAG_LENGTH) return refuse('documents.tag_invalid', `tag must be at most ${MAX_TAG_LENGTH} characters.`);
    value.tag = tag || null;
  }
  if (Object.keys(value).length === 0) {
    return refuse('documents.empty_patch', 'Provide provided, note and/or tag.');
  }
  return { ok: true, value };
}

/** True for a row that belongs to the service's own GENERAL bucket, i.e. a
 * standard the general-bucket helper owns (used only for documentation/tests). */
export function isGeneralStandardCode(code: unknown): boolean {
  return typeof code === 'string' && code.startsWith(GENERAL_STANDARD_PREFIX);
}
export { GENERAL_DISCLOSURE_CODE };
