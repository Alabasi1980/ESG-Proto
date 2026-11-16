// TASK-PROTO-U4-1a — client field mask (pure contract + C-projection pins).
// No DB: the mask reducers are pure and the enumerated application points are
// pinned against source so a future projection cannot quietly stop redacting.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ALL_CLIENT_FIELD_MASK,
  CLIENT_FIELD_MASK_VALUES,
  EMPTY_CLIENT_FIELD_MASK,
  parseClientFieldMask,
  parseVisibilityBody,
  storedClientFieldMask,
  stripMaskedFields,
  stripMaskedFieldsFromRows,
} from './clientFieldMask.ts';
import { linkOtherItem } from '../server/taxonomy.ts';
import { classifyRoute } from '../server/accessRegistry.ts';
import { assertRouteContext } from '../server/access.ts';
import type { AccessContext } from './capabilities.ts';

const taxonomy = readFileSync('src/server/taxonomy.ts', 'utf8');
const evaluations = readFileSync('src/server/routes/evaluations.ts', 'utf8');
const reports = readFileSync('src/server/routes/reports.ts', 'utf8');
const adminClients = readFileSync('src/server/routes/adminClients.ts', 'utf8');
const scope = readFileSync('src/server/scope.ts', 'utf8');
const schema = readFileSync('src/db/schema.sql', 'utf8');
const visibilityRoute = readFileSync('src/server/routes/serviceVisibility.ts', 'utf8');

test('U4-1a mask whitelist is exact and attachment_required is NOT maskable', () => {
  assert.deepEqual([...CLIENT_FIELD_MASK_VALUES].sort(),
    ['esg_class', 'hint', 'objective', 'priority', 'reference', 'sort_order', 'topic', 'weight']);
  assert.ok(!(CLIENT_FIELD_MASK_VALUES as readonly string[]).includes('attachment_required'),
    'attachment_required is a work requirement, never an internal scoring column (§2 decision)');
});

test('U4-1a parse: whitelist array, order preserved, unknown/dupes/non-array refused', () => {
  const full = parseClientFieldMask([...CLIENT_FIELD_MASK_VALUES]);
  assert.deepEqual(full, { ok: true, mask: [...CLIENT_FIELD_MASK_VALUES] });
  assert.deepEqual(parseClientFieldMask([]), { ok: true, mask: [] });
  assert.deepEqual(parseClientFieldMask(['weight', 'hint']), { ok: true, mask: ['weight', 'hint'] });
  for (const bad of [
    null, undefined, 'hint', 5, true, {}, { hint: true }, ['hint', 'hint'],
    ['hint', 'unknown'], ['attachment_required'], [1], [null], [' hint'],
    [...CLIENT_FIELD_MASK_VALUES, 'weight'],
  ]) assert.deepEqual(parseClientFieldMask(bad), { ok: false }, JSON.stringify(bad));
});

test('U4-1a stored read FAIL-CLOSED: NULL means unset; malformed/stale hides ALL maskable fields', () => {
  // Unset (NULL column) and the explicit empty array are the ONLY "show all" states.
  assert.equal(storedClientFieldMask(null), EMPTY_CLIENT_FIELD_MASK);
  assert.equal(storedClientFieldMask(undefined), EMPTY_CLIENT_FIELD_MASK);
  assert.equal(storedClientFieldMask([]), EMPTY_CLIENT_FIELD_MASK);
  // Valid array semantics are unchanged.
  assert.deepEqual([...storedClientFieldMask(['hint', 'weight'])].sort(), ['hint', 'weight']);
  // Malformed / stale values are not "show all" — they hide EVERY maskable field.
  for (const bad of [{ hint: true }, 'hint', 5, true, ['hint', 'not_a_field'], [7],
    ['hint', null], ['hint', {}]]) {
    const mask = storedClientFieldMask(bad);
    assert.deepEqual([...mask].sort(), [...CLIENT_FIELD_MASK_VALUES].sort(), JSON.stringify(bad));
    assert.equal(mask, ALL_CLIENT_FIELD_MASK);
  }
  assert.ok(![...ALL_CLIENT_FIELD_MASK].includes('attachment_required'));
});

test('U4-1a links projection: attachment_required present; masked keys ABSENT (not null), never attachment_required', () => {
  const row = {
    other_id: 'other', other_code: 'C', other_requirement: 'R', other_answer_type: 'text',
    other_priority: 'high', other_weight: 3, other_esg_class: 'social', other_objective: 'o',
    other_topic: 't', other_hint: 'h', other_attachment_required: true,
    disclosure_code: 'D', disclosure_title: 'T', standard_code: 'S',
  };
  const visible = linkOtherItem(row);
  assert.equal(visible.attachment_required, true, 'QAF-01: otherItem carries attachment_required');
  assert.equal(visible.weight, 3);

  const masked = linkOtherItem(row, new Set(['weight', 'hint', 'esg_class', 'priority']));
  for (const key of ['weight', 'hint', 'esgClass', 'priority'])
    assert.ok(!(key in masked), `QAF-02: ${key} must be ABSENT, not null`);
  assert.equal(masked.attachment_required, true, 'attachment_required is never maskable');

  // Fail-closed: the ALL mask hides every projected maskable field and nothing else.
  const all = linkOtherItem(row, ALL_CLIENT_FIELD_MASK);
  for (const key of ['priority', 'weight', 'esgClass', 'objective', 'topic', 'hint'])
    assert.ok(!(key in all), key);
  for (const key of ['id', 'code', 'requirement', 'answerType', 'attachment_required',
    'disclosureCode', 'disclosureTitle', 'standardCode']) assert.ok(key in all, key);
});

test('U4-1a strip: masked keys gone, unmasked + attachment_required kept, prefix supported', () => {
  const row: Record<string, unknown> = {
    id: 'i1', code: 'C', requirement: 'R', answer_type: 'text',
    hint: 'h', priority: 'high', weight: 3, esg_class: 'social', reference: 'r',
    topic: 't', objective: 'o', sort_order: 4, attachment_required: true,
  };
  stripMaskedFields(row, new Set(['hint', 'weight']));
  for (const gone of ['hint', 'weight']) assert.ok(!(gone in row), gone);
  for (const kept of ['id', 'code', 'requirement', 'answer_type', 'priority', 'esg_class',
    'reference', 'topic', 'objective', 'sort_order', 'attachment_required'])
    assert.ok(kept in row, kept);

  const links: Record<string, unknown> = {
    other_id: 'i2', other_hint: 'h', other_weight: 3, other_priority: 'low',
    other_attachment_required: false, disclosure_code: 'D',
  };
  stripMaskedFields(links, new Set(['hint', 'weight']), 'other_');
  assert.ok(!('other_hint' in links) && !('other_weight' in links));
  assert.equal(links.other_priority, 'low');
  assert.equal(links.other_attachment_required, false);

  const noop = { id: 'x', hint: 'h' };
  assert.equal(stripMaskedFields(noop, EMPTY_CLIENT_FIELD_MASK), noop);
  assert.deepEqual(noop, { id: 'x', hint: 'h' }, 'an empty mask never mutates a row');

  const rows = [{ id: 'a', hint: '1' }, { id: 'b', hint: '2' }];
  stripMaskedFieldsFromRows(rows, new Set(['hint']));
  assert.deepEqual(rows, [{ id: 'a' }, { id: 'b' }]);
});

test('U4-1a enumerated C-projection application points are pinned', () => {
  const count = (source: string, needle: string) => source.split(needle).length - 1;
  // GET /items (key deletion) + GET /items/:id/links (linkOtherItem builds then deletes).
  assert.equal(count(taxonomy, 'maskedItemFields('), 2, 'taxonomy: items list + links');
  assert.equal(count(taxonomy, 'stripMaskedFields('), 1, 'GET /items deletes keys in place');
  assert.ok(count(taxonomy, 'linkOtherItem(') >= 2, 'links destructures through linkOtherItem');
  assert.ok(taxonomy.includes("esg_class: 'esgClass'"), 'column→key alias map for the links projection');
  // GET /queue + GET /evaluations (per-item history header).
  assert.equal(count(evaluations, 'maskedItemFields('), 2, 'evaluations: queue + item history');
  // GET /reports/index + /reports/export (single-service index projection).
  assert.equal(count(reports, 'serviceFieldMask('), 1, 'reports: one service-bound mask read');
  assert.equal(count(evaluations, 'stripMaskedFields('), 2);
  assert.equal(count(reports, 'stripMaskedFields('), 1);
  // SHIELD-U41A-01: the lookup validates the RAW stored value in one fail-closed place.
  assert.ok(scope.includes('storedClientFieldMask(row.mask)'));
  assert.ok(!scope.includes('jsonb_array_elements_text(cs.client_field_mask)'));
});

test('U4-1a attachment_required is returned by the item projections', () => {
  assert.ok(taxonomy.includes('i.attachment_required'), 'GET /items');
  assert.ok(taxonomy.includes('o.attachment_required AS other_attachment_required'), 'links');
  assert.equal((evaluations.match(/i\.attachment_required/g) ?? []).length, 3,
    'queue + item history + GE scope rows');
});

test('U4-1a P writers validate at the boundary (no CHECK in the schema)', () => {
  assert.ok(adminClients.includes("code: 'service.mask_invalid'"));
  assert.ok(adminClients.includes('parseClientFieldMask'));
  assert.ok(taxonomy.includes("code: 'service.settings_invalid'"));
  assert.ok(taxonomy.includes('parseServiceSettings'));
  assert.match(schema, /ALTER TABLE items ADD COLUMN attachment_required BOOLEAN NOT NULL DEFAULT false;/);
  assert.match(schema, /ALTER TABLE services ADD COLUMN settings JSONB NOT NULL DEFAULT '\{\}'::jsonb;/);
  assert.match(schema, /ALTER TABLE client_services ADD COLUMN client_field_mask JSONB NULL;/);
  assert.ok(!/CHECK[^;]*(client_field_mask|settings)/i.test(schema.slice(schema.indexOf('TASK-PROTO-U4-1a'))),
    'U4-1a deliberately adds no CHECK business rule');
});

test('U4-1a visibility body: exactly {clientFieldMask}; any other column/field refused', () => {
  assert.deepEqual(parseVisibilityBody({ clientFieldMask: ['hint'] }), { ok: true, mask: ['hint'] });
  assert.deepEqual(parseVisibilityBody({ clientFieldMask: [] }), { ok: true, mask: [] });
  for (const body of [
    {}, null, undefined, [], 'clientFieldMask', 5,
    { showGap: false }, { showCorrective: false }, { show_gap: false },
    { clientFieldMask: ['hint'], showGap: false },
    { clientFieldMask: ['hint'], show_gap: false },
    { client_field_mask: ['hint'] }, { clientFieldMask: ['unknown'] },
  ]) assert.deepEqual(parseVisibilityBody(body), { ok: false }, JSON.stringify(body));
});

test('U4-1a route is ONE W declaration: W admitted, C/E/P 403 workspace.mode_mismatch', () => {
  const route = classifyRoute('PATCH',
    '/workspace/services/22222222-2222-4222-8222-222222222222/visibility')!;
  assert.ok(route, 'declaration is mounted/registered');
  assert.equal(route.activation, 'U1');
  assert.deepEqual(route.matrix.map((rule) => rule.context), ['W']);
  const base = { actorId: 'actor', sessionId: 'session', capability: 'probe' } as const;
  const tab = { ...base, role: 'ge_admin' as const, mode: 'consultant' as const,
    tenantId: '11111111-1111-4111-8111-111111111111', departmentId: null, tabId: 'tab', generation: 1 };
  assert.doesNotThrow(() => assertRouteContext(route, tab));
  const denied: AccessContext[] = [
    { ...base, role: 'ge_admin', mode: 'platform', tenantId: null, departmentId: null, tabId: 'tab', generation: 1 },
    { ...base, role: 'client_admin', mode: 'client', tenantId: tab.tenantId, departmentId: null, tabId: null, generation: null },
    { ...base, role: 'employee', mode: 'employee', tenantId: tab.tenantId, departmentId: 'dept', tabId: null, generation: null },
  ];
  for (const access of denied) assert.throws(() => assertRouteContext(route, access),
    (err: { code?: string }) => err.code === 'workspace.mode_mismatch', access.mode);
});

test('U4-1a visibility route writes ONLY client_field_mask (handler is the column guard)', () => {
  assert.ok(visibilityRoute.includes('requireFreshPassword'));
  assert.ok(visibilityRoute.includes('requireDomainAccess'));
  assert.ok(visibilityRoute.includes('parseVisibilityBody(req.body)'));
  assert.ok(visibilityRoute.includes("'CLIENT_SERVICE_VISIBILITY_UPDATED'"));
  assert.ok(visibilityRoute.includes('resolveLinkedService(client, access, serviceId)'));
  assert.equal((visibilityRoute.match(/UPDATE client_services SET client_field_mask/g) ?? []).length, 1);
  assert.ok(!/show_(?:gap|corrective)\s*=/.test(visibilityRoute),
    'no other client_services column may be written by this route');
});

test('U4-1a W policy substrate: one narrow consultant row, no other policy added', () => {
  const content = readFileSync('src/db/b17-content.sql', 'utf8');
  assert.equal((content.match(/CREATE POLICY b17_consultant_service_visibility ON client_services FOR UPDATE/g) ?? []).length, 1);
  assert.ok(content.includes("b17_setting('current_mode')='consultant'"));
  assert.ok(content.includes("client_id::text = b17_setting('current_tenant_id')"));
  assert.ok(content.includes('TASK-PROTO-U4-1A (OD-11: consultant controls client-visible fields)'));
});
