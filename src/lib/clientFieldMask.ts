// TASK-PROTO-U4-1a (OD-11 §4) — the ONE client field-mask contract.
//
// A client-service may hide a fixed set of ITEM columns from the CLIENT (C)
// role; the mask lives in `client_services.client_field_mask` (JSONB array).
// Masking is enforced SERVER-SIDE: masked values never leave the server for C.
// E/W/P are unaffected, and `attachment_required` is deliberately NOT maskable
// (it is a work requirement, not an internal scoring column — task §2 decision).
//
// Mask lookup lives with the other work-scope helpers (src/server/scope.ts); the
// C-context item projections that use these reducers are enumerated in the
// TASK-PROTO-U4-1a handback.

export const CLIENT_FIELD_MASK_VALUES = [
  'hint', 'priority', 'weight', 'esg_class', 'reference', 'topic', 'objective', 'sort_order',
] as const;

export type ClientFieldMaskValue = (typeof CLIENT_FIELD_MASK_VALUES)[number];

const MASKABLE: ReadonlySet<string> = new Set(CLIENT_FIELD_MASK_VALUES);
export const EMPTY_CLIENT_FIELD_MASK: ReadonlySet<string> = new Set<string>();
/** Fail-closed mask: EVERY maskable field hidden. Used when a stored value is
 * malformed/stale (not a valid whitelist array). `attachment_required` is not a
 * member, so it is never hidden. */
export const ALL_CLIENT_FIELD_MASK: ReadonlySet<string> = new Set(CLIENT_FIELD_MASK_VALUES);

export type ClientFieldMaskParse =
  | { ok: true; mask: ClientFieldMaskValue[] }
  | { ok: false };

/** Strict whitelist validation, no coercion. Unknown values AND duplicates are
 * refused (never normalised away): a caller that meant something else must see
 * the 400, never a silently narrowed or widened mask. Order is preserved. */
export function parseClientFieldMask(value: unknown): ClientFieldMaskParse {
  if (!Array.isArray(value) || value.length > CLIENT_FIELD_MASK_VALUES.length) return { ok: false };
  const mask: ClientFieldMaskValue[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !MASKABLE.has(entry)) return { ok: false };
    const field = entry as ClientFieldMaskValue;
    if (mask.includes(field)) return { ok: false };
    mask.push(field);
  }
  return { ok: true, mask };
}

/** Defensive read of a STORED JSONB value, FAIL-CLOSED (SHIELD-U41A-01):
 * - NULL/absent column → nothing hidden (no mask configured);
 * - a non-empty array of ONLY whitelist strings → exactly those fields;
 * - `[]` → nothing hidden;
 * - anything else (scalar/object/string, or an array with a non-string or an
 *   unknown member) → ALL maskable fields hidden. A corrupt/stale value must
 *   never leak what it failed to describe. `attachment_required` is outside the
 *   whitelist, so it is never hidden. */
export function storedClientFieldMask(value: unknown): ReadonlySet<string> {
  if (value === null || value === undefined) return EMPTY_CLIENT_FIELD_MASK;
  if (!Array.isArray(value)) return ALL_CLIENT_FIELD_MASK;
  if (value.length === 0) return EMPTY_CLIENT_FIELD_MASK;
  const mask = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string' || !MASKABLE.has(entry)) return ALL_CLIENT_FIELD_MASK;
    mask.add(entry);
  }
  return mask;
}

/** The ONLY body shape accepted by PATCH /workspace/services/:serviceId/
 * visibility. A consultant may change the client-visible columns, never any
 * other client_services column (money/flags/business rows) — RLS cannot
 * column-scope, so this exact-key contract is the column guard. */
export function parseVisibilityBody(body: unknown):
  | { ok: true; mask: ClientFieldMaskValue[] }
  | { ok: false } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false };
  const keys = Object.keys(body as Record<string, unknown>);
  if (keys.length !== 1 || keys[0] !== 'clientFieldMask') return { ok: false };
  return parseClientFieldMask((body as Record<string, unknown>).clientFieldMask);
}

/** Server-side redaction: delete every masked field present on the row.
 * `prefix` covers aliased projections (e.g. `other_` on GET /items/:id/links).
 * Mutates and returns the row — call sites own their freshly-built objects. */
export function stripMaskedFields<T extends Record<string, unknown>>(
  row: T, mask: ReadonlySet<string>, prefix = '',
): T {
  if (mask.size === 0) return row;
  for (const field of mask) delete row[prefix + field];
  return row;
}

/** Apply {@link stripMaskedFields} to every row of a projection. */
export function stripMaskedFieldsFromRows<T extends Record<string, unknown>>(
  rows: readonly T[], mask: ReadonlySet<string>, prefix = '',
): readonly T[] {
  for (const row of rows) stripMaskedFields(row, mask, prefix);
  return rows;
}
