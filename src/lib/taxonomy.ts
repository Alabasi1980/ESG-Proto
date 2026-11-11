// B11a — taxonomy/services/items/links shared helpers (pure, no DB).
//
// WHY a separate module: routes.ts is already >4000 lines; the B11a batch
// (S-04/S-05/S-06/S-08) gets its own lib + router so the diff stays
// reviewable and unit-testable without a database.

export const ITEM_PRIORITIES = ['high', 'mid', 'low'] as const;
export type ItemPriority = (typeof ITEM_PRIORITIES)[number];

export const ESG_CLASSES = ['environmental', 'social', 'governance', 'general'] as const;
export type EsgClass = (typeof ESG_CLASSES)[number];

export const ITEM_ANSWER_TYPES = ['text', 'number', 'boolean', 'date', 'file'] as const;
export type ItemAnswerType = (typeof ITEM_ANSWER_TYPES)[number];

/** Mirrors enforce_item_weight_priority in schema.sql: weight is derived from priority. */
export function weightForPriority(priority?: string): number {
  return priority === 'high' ? 3 : priority === 'low' ? 1 : 2;
}

export function isItemPriority(value: unknown): value is ItemPriority {
  return typeof value === 'string' && (ITEM_PRIORITIES as readonly string[]).includes(value);
}

export function isEsgClass(value: unknown): value is EsgClass {
  return typeof value === 'string' && (ESG_CLASSES as readonly string[]).includes(value);
}

export function isItemAnswerType(value: unknown): value is ItemAnswerType {
  return typeof value === 'string' && (ITEM_ANSWER_TYPES as readonly string[]).includes(value);
}

/**
 * Canonical unordered pair for equivalent-item links (S-08).
 * Returns null when the pair is unusable (missing ids or self-link);
 * otherwise the two ids sorted so (a,b) and (b,a) map to one row.
 */
export function canonicalLinkPair(a: unknown, b: unknown): [string, string] | null {
  if (typeof a !== 'string' || typeof b !== 'string') return null;
  const x = a.trim();
  const y = b.trim();
  if (!x || !y || x === y) return null;
  return x < y ? [x, y] : [y, x];
}

export interface ValidatedItemInput {
  code: string;
  requirement: string;
  answerType: ItemAnswerType;
  hint: string | null;
  priority: ItemPriority;
  esgClass: EsgClass;
  objective: string | null;
  topic: string | null;
  reference: string | null;
  departmentId: string | null;
  sortOrder: number | null;
}

function asNullableText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

/**
 * Validates a POST /api/items body. Returns the sanitised value or a
 * { status, error } refusal the route can send verbatim.
 */
export function validateNewItem(
  body: Record<string, any>
): { ok: true; value: ValidatedItemInput } | { ok: false; status: number; error: string } {
  const disclosureId = typeof body.disclosureId === 'string' ? body.disclosureId.trim() : '';
  if (!disclosureId) {
    return { ok: false, status: 400, error: 'disclosureId is required.' };
  }
  const code = typeof body.code === 'string' ? body.code.trim() : '';
  if (!code) {
    return { ok: false, status: 400, error: 'code is required.' };
  }
  const requirement = typeof body.requirement === 'string' ? body.requirement.trim() : '';
  if (!requirement) {
    return { ok: false, status: 400, error: 'requirement is required.' };
  }
  const answerType = body.answerType === undefined ? 'text' : body.answerType;
  if (!isItemAnswerType(answerType)) {
    return {
      ok: false,
      status: 400,
      error: `answerType must be one of: ${ITEM_ANSWER_TYPES.join(', ')}.`,
    };
  }
  const priority = body.priority === undefined ? 'mid' : body.priority;
  if (!isItemPriority(priority)) {
    return { ok: false, status: 400, error: 'priority must be one of: high, mid, low.' };
  }
  const esgClass = body.esgClass === undefined ? 'general' : body.esgClass;
  if (!isEsgClass(esgClass)) {
    return {
      ok: false,
      status: 400,
      error: 'esgClass must be one of: environmental, social, governance, general.',
    };
  }
  let sortOrder: number | null = null;
  if (body.sortOrder !== undefined && body.sortOrder !== null && body.sortOrder !== '') {
    const n = Number(body.sortOrder);
    if (!Number.isInteger(n) || n < 0) {
      return { ok: false, status: 400, error: 'sortOrder must be a non-negative integer.' };
    }
    sortOrder = n;
  }
  const departmentId =
    typeof body.departmentId === 'string' && body.departmentId.trim() !== ''
      ? body.departmentId.trim()
      : null;
  return {
    ok: true,
    value: {
      code,
      requirement,
      answerType,
      hint: asNullableText(body.hint),
      priority,
      esgClass,
      objective: asNullableText(body.objective),
      topic: asNullableText(body.topic),
      reference: asNullableText(body.reference),
      departmentId,
      sortOrder,
    },
  };
}

/**
 * Editable item columns for PATCH /api/items/:id. Code + disclosure_id are
 * the natural key and are immutable (S-06) — the route refuses them with 400.
 */
export const IMMUTABLE_ITEM_FIELDS = ['code', 'disclosureId', 'disclosure_id'] as const;

/** Human blocker message for DELETE /api/items/:id when children reference it. */
export function itemDeleteRefusal(blockers: { answers: number; evaluations: number; assignments: number }): string {
  const parts: string[] = [];
  if (blockers.answers > 0) parts.push(`${blockers.answers} answer(s)`);
  if (blockers.evaluations > 0) parts.push(`${blockers.evaluations} evaluation(s)`);
  if (blockers.assignments > 0) parts.push(`${blockers.assignments} assignment(s)`);
  return `Cannot delete this item: ${parts.join(', ')} reference it. Remove the references first.`;
}
