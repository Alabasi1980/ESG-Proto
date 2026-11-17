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

// ---------------------------------------------------------------------------
// TASK-PROTO-U4-2-FIX P2 — catalog create / bulk / version validators (pure).
//
// WHY pure validators here: the same rules serve the routes and the no-DB
// unit matrix; the handlers stay thin (context + SQL + audit) and no product
// vocabulary (settings keys, bulk caps) is invented inside SQL strings.
// ---------------------------------------------------------------------------

export interface ValidatedStandardInput {
  code: string;
  title: string;
  category: string;
}

function nonEmptyText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t === '' ? null : t;
}

/** Validates a POST /api/standards body (code is the global natural key). */
export function validateNewStandard(
  body: Record<string, any>
): { ok: true; value: ValidatedStandardInput } | { ok: false; status: 400; error: string } {
  const code = nonEmptyText(body.code);
  if (!code) return { ok: false, status: 400, error: 'code is required.' };
  const title = nonEmptyText(body.title);
  if (!title) return { ok: false, status: 400, error: 'title is required.' };
  const category = nonEmptyText(body.category);
  if (!category) return { ok: false, status: 400, error: 'category is required.' };
  return { ok: true, value: { code, title, category } };
}

export interface ValidatedDisclosureInput {
  standardId: string;
  code: string;
  title: string;
  description: string | null;
}

/** Validates a POST /api/disclosures body ((standard_id, code) natural key). */
export function validateNewDisclosure(
  body: Record<string, any>
): { ok: true; value: ValidatedDisclosureInput } | { ok: false; status: 400; error: string } {
  const standardId = nonEmptyText(body.standardId);
  if (!standardId) return { ok: false, status: 400, error: 'standardId is required.' };
  const code = nonEmptyText(body.code);
  if (!code) return { ok: false, status: 400, error: 'code is required.' };
  const title = nonEmptyText(body.title);
  if (!title) return { ok: false, status: 400, error: 'title is required.' };
  return { ok: true, value: { standardId, code, title, description: asNullableText(body.description) } };
}

/**
 * Bulk-editable item columns (P2 ADD). Exactly the DG-06 subset: department
 * changes stay single-item and are refused here with a per-row error, never
 * applied and never silently dropped.
 */
export const BULK_PATCHABLE_FIELDS = ['answerType', 'priority', 'esgClass', 'attachment_required'] as const;
export type BulkPatchableField = (typeof BULK_PATCHABLE_FIELDS)[number];

export interface BulkPatchSet {
  key: BulkPatchableField;
  column: 'answer_type' | 'priority' | 'esg_class' | 'attachment_required';
  value: ItemAnswerType | ItemPriority | EsgClass | boolean;
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

/**
 * Validates the shared `patch` of POST /api/items/bulk. Department keys are
 * NOT malformed-request errors: the delegation requires a per-row refusal,
 * so they return perRow:true and the handler fans the message out to rows.
 */
export function validateBulkPatch(
  patch: unknown
):
  | { ok: true; sets: BulkPatchSet[] }
  | { ok: false; status: 400; error: string; perRow: boolean } {
  if (!isPlainObject(patch)) {
    return { ok: false, status: 400, error: 'patch must be an object.', perRow: false };
  }
  if ('departmentId' in patch || 'department_id' in patch) {
    return {
      ok: false,
      status: 400,
      error: 'Department changes stay single-item: PATCH /api/items/:id one item at a time.',
      perRow: true,
    };
  }
  const sets: BulkPatchSet[] = [];
  for (const [key, raw] of Object.entries(patch)) {
    if (key === 'answerType') {
      if (!isItemAnswerType(raw)) {
        return {
          ok: false, status: 400,
          error: `answerType must be one of: ${ITEM_ANSWER_TYPES.join(', ')}.`,
          perRow: false,
        };
      }
      sets.push({ key, column: 'answer_type', value: raw });
    } else if (key === 'priority') {
      if (!isItemPriority(raw)) {
        return { ok: false, status: 400, error: 'priority must be one of: high, mid, low.', perRow: false };
      }
      sets.push({ key, column: 'priority', value: raw });
    } else if (key === 'esgClass') {
      if (!isEsgClass(raw)) {
        return {
          ok: false, status: 400,
          error: 'esgClass must be one of: environmental, social, governance, general.',
          perRow: false,
        };
      }
      sets.push({ key, column: 'esg_class', value: raw });
    } else if (key === 'attachment_required') {
      if (typeof raw !== 'boolean') {
        return { ok: false, status: 400, error: 'attachment_required must be a boolean.', perRow: false };
      }
      sets.push({ key, column: 'attachment_required', value: raw });
    } else {
      return {
        ok: false, status: 400,
        error: `Unknown bulk field '${key}'. Bulk supports only: ${BULK_PATCHABLE_FIELDS.join(', ')}.`,
        perRow: false,
      };
    }
  }
  if (sets.length === 0) {
    return { ok: false, status: 400, error: 'patch must contain at least one bulk field.', perRow: false };
  }
  return { ok: true, sets };
}

/**
 * Optimistic-locking check for item writes (P1 `items.version`).
 * - No claim (undefined/null) → ok with no check: the current Services UI
 *   does not send versions yet (P5), so absence stays backward compatible.
 * - Malformed claim → 400 (never treated as "matches").
 * - Mismatch → 409 `item.version_conflict`.
 */
export function checkItemVersion(
  current: number,
  expected: unknown
):
  | { ok: true }
  | { ok: false; status: 400; error: string }
  | { ok: false; status: 409; code: 'item.version_conflict'; error: string } {
  if (expected === undefined || expected === null) return { ok: true };
  let n: number;
  if (typeof expected === 'number') n = expected;
  else if (typeof expected === 'string' && /^\d+$/.test(expected.trim())) n = Number(expected.trim());
  else {
    return { ok: false, status: 400, error: 'expectedVersion must be an integer.' };
  }
  if (!Number.isInteger(n) || n < 0) {
    return { ok: false, status: 400, error: 'expectedVersion must be an integer.' };
  }
  if (n !== current) {
    return {
      ok: false, status: 409, code: 'item.version_conflict',
      error: `Item changed since version ${n} (now at ${current}). Reload and retry.`,
    };
  }
  return { ok: true };
}

export interface ServiceDeleteBlockers {
  code: string;
  answers: number;
  evaluations: number;
  assignments: number;
  actions: number;
  versions: number;
  copies: number;
  links: number;
  reportSettings: number;
  requirements: number;
  profiles: number;
  serviceActions: number;
}

/**
 * Human 409 message for DELETE /api/services/:id (code
 * `service.delete_blocked` is attached by the handler). The item-level triple
 * reuses itemDeleteRefusal so the two delete paths can never word the same
 * blockers differently.
 */
export function serviceDeleteRefusal(b: ServiceDeleteBlockers): string {
  const parts: string[] = [];
  const itemWork = { answers: b.answers, evaluations: b.evaluations, assignments: b.assignments };
  if (b.answers + b.evaluations + b.assignments > 0) {
    parts.push(
      itemDeleteRefusal(itemWork).replace(' reference it. Remove the references first.', '')
    );
  }
  if (b.actions > 0) parts.push(`${b.actions} action(s)`);
  if (b.versions > 0) parts.push(`${b.versions} history version(s)`);
  if (b.copies > 0) parts.push(`${b.copies} approved copie(s)`);
  if (b.links > 0) parts.push(`${b.links} tenant link(s)`);
  if (b.reportSettings > 0) parts.push(`${b.reportSettings} report setting(s)`);
  if (b.requirements > 0) parts.push(`${b.requirements} document requirement(s)`);
  if (b.profiles > 0) parts.push(`${b.profiles} ESG profile row(s)`);
  if (b.serviceActions > 0) parts.push(`${b.serviceActions} service action(s)`);
  return `Cannot delete service '${b.code}': ${parts.join(', ')} reference it. Unlink or remove the blockers first.`;
}
