// TASK-PROTO-U4-1a (OD-11 §4, §1.2) — the per-service `settings` container
// contract. The column is `services.settings JSONB NOT NULL DEFAULT '{}'`;
// its shape/size rule lives HERE (no CHECK on purpose) and is applied by the
// single P writer, PATCH /services/:id (400 `service.settings_invalid`).

/** Serialized (UTF-8) cap for the whole settings object. */
export const SERVICE_SETTINGS_MAX_BYTES = 8192;

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
