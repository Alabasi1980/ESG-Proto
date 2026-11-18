// TASK-PROTO-U4-2-FIX P5S (OD-13 API-2 CHANGE) — server-side settings
// whitelist pins (no DB, no DOM). P5 shipped UI named fields but no server
// whitelist, so `{default_priority:'high',unknown_key:1}` reached 200.
// Now: unknown key → 400 service.settings_unknown (before any write);
// wrong value shape → 400 service.settings_invalid (established shape code);
// known set + `{}` → accepted (`{}` was accepted pre-P5S — preserved).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseServiceSettings } from './serviceSettings.ts';
import {
  SERVICE_SETTINGS_KNOWN_KEYS,
  checkServiceSettingsKeys,
} from './serviceSettings.ts';

const KNOWN_FULL = {
  default_answer_type: 'text',
  default_priority: 'high',
  default_esg_class: 'governance',
  attachment_required_default: true,
  report_visible_default: false,
};

test('P5S validator: closed key set mirrors the P5 UI named fields', () => {
  assert.deepEqual([...SERVICE_SETTINGS_KNOWN_KEYS], [
    'default_answer_type', 'default_priority', 'default_esg_class',
    'attachment_required_default', 'report_visible_default',
  ]);
});

test('P5S validator: known set accepted (full, partial, empty — empty was accepted pre-P5S)', () => {
  assert.deepEqual(checkServiceSettingsKeys(KNOWN_FULL), { ok: true });
  assert.deepEqual(checkServiceSettingsKeys({ default_priority: 'low' }), { ok: true });
  assert.deepEqual(checkServiceSettingsKeys({}), { ok: true });
  assert.deepEqual(parseServiceSettings(KNOWN_FULL), {
    ok: true, serialized: JSON.stringify(KNOWN_FULL),
  }, '8 KB cap path still serializes the known set');
});

test('P5S validator: unknown key refused with service.settings_unknown (live Tera gap)', () => {
  assert.deepEqual(
    checkServiceSettingsKeys({ default_priority: 'high', unknown_key: 1 }),
    { ok: false, code: 'service.settings_unknown', key: 'unknown_key' });
});

test('P5S validator: wrong value shape refused with service.settings_invalid', () => {
  for (const bad of [
    { default_answer_type: 'essay' },
    { default_priority: 'HIGH' },
    { default_esg_class: 'gov' },
    { attachment_required_default: 'yes' },
    { report_visible_default: 1 },
  ])
    assert.equal(checkServiceSettingsKeys(bad).ok, false, JSON.stringify(bad));
  const one = checkServiceSettingsKeys({ default_priority: 'urgent' });
  assert.deepEqual(one, { ok: false, code: 'service.settings_invalid', key: 'default_priority' });
});

test('P5S route: PATCH /services/:id refuses unknown/shape before any write, cap intact', () => {
  const taxonomy = readFileSync('src/server/taxonomy.ts', 'utf8');
  assert.ok(taxonomy.includes('checkServiceSettingsKeys(body.settings)'));
  assert.ok(taxonomy.includes("'service.settings_unknown'"));
  assert.ok(taxonomy.includes("code: 'service.settings_invalid'"));
  // Both refusals sit before the write: the check precedes the serialized
  // push into the UPDATE, which precedes the single domainTransaction write.
  const checkAt = taxonomy.indexOf('checkServiceSettingsKeys(body.settings)');
  const pushAt = taxonomy.indexOf('settings = $${params.length}::jsonb');
  assert.ok(checkAt !== -1 && pushAt !== -1 && checkAt < pushAt, 'whitelist before write');
  assert.ok(taxonomy.includes('parseServiceSettings(body.settings)'), '8 KB cap preserved');
});
