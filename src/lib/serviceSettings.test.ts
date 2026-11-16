// TASK-PROTO-U4-1a §1.2/§3 — per-service settings container contract (pure).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SERVICE_SETTINGS_MAX_BYTES, parseServiceSettings } from './serviceSettings.ts';

test('U4-1a settings: plain objects only; the persisted string is the measured one', () => {
  assert.equal(SERVICE_SETTINGS_MAX_BYTES, 8192);
  assert.deepEqual(parseServiceSettings({}), { ok: true, serialized: '{}' });
  const nested = { rule: 'attachment', mode: 'required', thresholds: { a: 1, b: [2, 3] } };
  assert.deepEqual(parseServiceSettings(nested), { ok: true, serialized: JSON.stringify(nested) });
  for (const bad of [null, [], 'rule', 5, true, undefined])
    assert.deepEqual(parseServiceSettings(bad), { ok: false }, JSON.stringify(bad));
});

test('U4-1a settings: the 8 KB serialized cap is exact and byte-based (UTF-8)', () => {
  const atCap = { x: 'a'.repeat(SERVICE_SETTINGS_MAX_BYTES - 8) };
  assert.equal(Buffer.byteLength(JSON.stringify(atCap), 'utf8'), SERVICE_SETTINGS_MAX_BYTES);
  assert.equal(parseServiceSettings(atCap).ok, true, 'exactly 8 KB is accepted');

  const overCap = { x: 'a'.repeat(SERVICE_SETTINGS_MAX_BYTES - 7) };
  assert.equal(Buffer.byteLength(JSON.stringify(overCap), 'utf8'), SERVICE_SETTINGS_MAX_BYTES + 1);
  assert.deepEqual(parseServiceSettings(overCap), { ok: false }, '8 KB + 1 byte is refused');

  // Multi-byte characters: the cap counts stored bytes, not characters.
  const multibyte = { x: 'é'.repeat(4093) }; // 2 bytes each in UTF-8
  assert.ok(Buffer.byteLength(JSON.stringify(multibyte), 'utf8') > SERVICE_SETTINGS_MAX_BYTES);
  assert.deepEqual(parseServiceSettings(multibyte), { ok: false });
});

test('U4-1a settings: PATCH /services/:id keeps the validator and the 400 code', () => {
  const taxonomy = readFileSync('src/server/taxonomy.ts', 'utf8');
  assert.ok(taxonomy.includes('parseServiceSettings(body.settings)'));
  assert.ok(taxonomy.includes("code: 'service.settings_invalid'"));
  assert.ok(taxonomy.includes("sets.push(`settings = $${params.length}::jsonb`)"));
});
