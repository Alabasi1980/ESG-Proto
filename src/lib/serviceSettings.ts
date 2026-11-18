// TASK-PROTO-U4-1a (OD-11 §4, §1.2) — the per-service `settings` container
// contract. The column is `services.settings JSONB NOT NULL DEFAULT '{}'`;
// its shape/size rule lives HERE (no CHECK on purpose) and is applied by the
// single P writer, PATCH /services/:id (400 `service.settings_invalid`).

import { isEsgClass, isItemAnswerType, isItemPriority } from './taxonomy.ts';

/** Serialized (UTF-8) cap for the whole settings object. */
export const SERVICE_SETTINGS_MAX_BYTES = 8192;

/**
 * TASK-PROTO-U4-2-FIX P5S (OD-13 API-2 CHANGE) — the closed named-key set the
 * server accepts inside `services.settings`. Owner-visible mirror of
 * NAMED_SETTINGS_KEYS in ServiceSettingsPanel.tsx (the UI contract); the
 * server re-checks it because UI-only enforcement is bypassable by direct
 * API calls. Whole-object replace, ≤ 8 KB contract unchanged.
 */
export const SERVICE_SETTINGS_KNOWN_KEYS = [
  'default_answer_type',
  'default_priority',
  'default_esg_class',
  'attachment_required_default',
  'report_visible_default',
] as const;
export type ServiceSettingsKnownKey = (typeof SERVICE_SETTINGS_KNOWN_KEYS)[number];

export type ServiceSettingsKeysCheck =
  | { ok: true }
  // Unknown key — first offender named so the caller can echo it.
  | { ok: false; code: 'service.settings_unknown'; key: string }
  // Known key with a wrong value shape — reuses the established shape code.
  | { ok: false; code: 'service.settings_invalid'; key: string };

/**
 * Closed-set + value-shape check over an already-plain object (run AFTER
 * parseServiceSettings, so the 8 KB cap still applies first). Partial
 * objects and `{}` are accepted — that was the pre-P5S behavior for plain
 * objects and stays (whole-object replace, caller-supplied defaults).
 * Value shapes mirror the P5 UI named fields:
 * - default_answer_type: one of ITEM_ANSWER_TYPES
 * - default_priority: one of ITEM_PRIORITIES
 * - default_esg_class: one of ESG_CLASSES
 * - attachment_required_default / report_visible_default: boolean
 */
export function checkServiceSettingsKeys(value: object): ServiceSettingsKeysCheck {
  for (const key of Object.keys(value)) {
    if (!(SERVICE_SETTINGS_KNOWN_KEYS as readonly string[]).includes(key)) {
      return { ok: false, code: 'service.settings_unknown', key };
    }
  }
  const v = value as Record<string, unknown>;
  if ('default_answer_type' in v && !isItemAnswerType(v.default_answer_type))
    return { ok: false, code: 'service.settings_invalid', key: 'default_answer_type' };
  if ('default_priority' in v && !isItemPriority(v.default_priority))
    return { ok: false, code: 'service.settings_invalid', key: 'default_priority' };
  if ('default_esg_class' in v && !isEsgClass(v.default_esg_class))
    return { ok: false, code: 'service.settings_invalid', key: 'default_esg_class' };
  if ('attachment_required_default' in v && typeof v.attachment_required_default !== 'boolean')
    return { ok: false, code: 'service.settings_invalid', key: 'attachment_required_default' };
  if ('report_visible_default' in v && typeof v.report_visible_default !== 'boolean')
    return { ok: false, code: 'service.settings_invalid', key: 'report_visible_default' };
  return { ok: true };
}

export type ServiceSettingsParse =
  | { ok: true; serialized: string }
  | { ok: false };

/** Plain JSON object only (never null/array/scalar), serialized size ≤ 8 KB.
 * Serialization is the exact string persisted as JSONB, so the cap measured
 * here is the cap stored — no re-serialization can grow it afterwards. */
export function parseServiceSettings(value: unknown): ServiceSettingsParse {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ok: false };
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return { ok: false };
  }
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') > SERVICE_SETTINGS_MAX_BYTES)
    return { ok: false };
  return { ok: true, serialized };
}
