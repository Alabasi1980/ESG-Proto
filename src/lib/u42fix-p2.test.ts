// TASK-PROTO-U4-2-FIX P2 — catalog CRUD + item version/archive paths (no DB).
//
// Behavioral (pure validators) + matrix (P-only writes, W/C/E denied) +
// source-shape pins (fresh gate, in-txn audit, closed error-code set).
// N-1/N-6/N-7/N-8 are demonstrated at this layer; live-handler proof stays
// with QA on the isolated harness. Single-item PATCH reopen (snapshot +
// answers→reopened) is DELIBERATELY absent here — it needs a platform.config
// answers-update RLS branch that P1 did not ship and P2 may not add
// (STOP/ASK C1); this file pins that the handler does NOT half-reopen.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyRoute, formatMatrix } from '../server/accessRegistry.ts';
import { assertRouteContext } from '../server/access.ts';
import type { AccessContext } from './capabilities.ts';
import {
  BULK_PATCHABLE_FIELDS,
  checkItemVersion,
  serviceDeleteRefusal,
  validateBulkPatch,
  validateNewDisclosure,
  validateNewStandard,
} from './taxonomy.ts';

const source = (file: string) => readFileSync(file, 'utf8');
const taxonomy = () => source('src/server/taxonomy.ts');

// --- catalog create validators (ADD) ---

test('P2 ADD: validateNewStandard accepts code/title/category, refuses blanks', () => {
  const res = validateNewStandard({ code: 'GRI 400', title: 'Topic', category: 'social' });
  assert.equal(res.ok, true);
  if (res.ok) assert.deepEqual(res.value, { code: 'GRI 400', title: 'Topic', category: 'social' });
  for (const body of [{}, { code: '  ', title: 't', category: 'c' }, { code: 'c', category: 'c' },
    { code: 'c', title: 't' }, { code: 'c', title: 't', category: '' }]) {
    const r = validateNewStandard(body);
    assert.equal(r.ok, false, JSON.stringify(body));
    if (!r.ok) assert.equal(r.status, 400);
  }
});

test('P2 ADD: validateNewDisclosure accepts optional description, refuses junk', () => {
  const res = validateNewDisclosure({ standardId: 's1', code: '2-1', title: 'Details' });
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.value.description, null);
  const full = validateNewDisclosure({ standardId: 's1', code: '2-1', title: 't', description: '  d ' });
  assert.equal(full.ok, true);
  if (full.ok) assert.equal(full.value.description, 'd');
  for (const body of [{}, { code: 'c', title: 't' }, { standardId: 's', title: 't' },
    { standardId: 's', code: 'c' }, { standardId: '  ', code: 'c', title: 't' }]) {
    assert.equal(validateNewDisclosure(body).ok, false, JSON.stringify(body));
  }
});

// --- bulk validator (DG-06: subset + per-row versions, dept stays single) ---

test('P2 bulk: the whitelisted subset is exactly the DG-06 four', () => {
  assert.deepEqual([...BULK_PATCHABLE_FIELDS], ['answerType', 'priority', 'esgClass', 'attachment_required']);
  const res = validateBulkPatch({ answerType: 'number', priority: 'high', esgClass: 'social', attachment_required: true });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.deepEqual(res.sets.map((s) => s.column), ['answer_type', 'priority', 'esg_class', 'attachment_required']);
  }
});

test('P2 bulk N-6: department keys refuse per-row (never applied, never silent)', () => {
  for (const patch of [{ departmentId: 'd1' }, { department_id: 'd1' },
    { departmentId: null }, { priority: 'high', departmentId: 'd1' }]) {
    const r = validateBulkPatch(patch);
    assert.equal(r.ok, false, JSON.stringify(patch));
    if (!r.ok) {
      assert.equal(r.perRow, true, 'department refusal must fan out to rows, not 400 the request');
      assert.match(r.error, /single-item/);
    }
  }
});

test('P2 bulk: unknown keys and bad values are whole-request 400s', () => {
  for (const patch of [{ weight: 3 }, { requirement: 'x' }, { code: 'c' }, {},
    { answerType: 'essay' }, { priority: 'urgent' }, { esgClass: 'planet' },
    { attachment_required: 'yes' }, { attachment_required: 1 }]) {
    const r = validateBulkPatch(patch);
    assert.equal(r.ok, false, JSON.stringify(patch));
    if (!r.ok) {
      assert.equal(r.status, 400);
      assert.equal(r.perRow, false, 'shape errors fail the request before any row runs');
    }
  }
  assert.equal(validateBulkPatch(null).ok, false);
  assert.equal(validateBulkPatch([]).ok, false);
  assert.equal(validateBulkPatch('priority').ok, false);
});

// --- optimistic version check (N-7) ---

test('P2 N-7: stale expectedVersion is 409 item.version_conflict; absent is compatible', () => {
  assert.deepEqual(checkItemVersion(3, 3), { ok: true });
  assert.deepEqual(checkItemVersion(1, undefined), { ok: true });
  assert.deepEqual(checkItemVersion(1, null), { ok: true });
  const stale = checkItemVersion(4, 3);
  assert.equal(stale.ok, false);
  if (!stale.ok) {
    assert.equal(stale.status, 409);
    assert.equal((stale as { code?: string }).code, 'item.version_conflict');
  }
  const malformed = checkItemVersion(1, 'abc');
  assert.equal(malformed.ok, false);
  if (!malformed.ok) assert.equal(malformed.status, 400);
  assert.equal(checkItemVersion(1, -1).ok, false);
  assert.equal(checkItemVersion(1, 1.5).ok, false);
});

// --- service-delete refusal message ---

test('P2 service delete: refusal names every blocker kind', () => {
  const msg = serviceDeleteRefusal({
    code: 'SVC-1', answers: 2, evaluations: 0, assignments: 1, actions: 0, versions: 1,
    copies: 0, links: 3, reportSettings: 0, requirements: 0, profiles: 1, serviceActions: 0,
  });
  assert.match(msg, /SVC-1/);
  assert.match(msg, /2 answer\(s\)/);
  assert.match(msg, /1 assignment\(s\)/);
  assert.match(msg, /1 history version\(s\)/);
  assert.match(msg, /3 tenant link\(s\)/);
  assert.match(msg, /1 ESG profile row\(s\)/);
  assert.doesNotMatch(msg, /evaluation/);
  assert.doesNotMatch(msg, /copie/);
  assert.doesNotMatch(msg, /action\(s\)/);
});

// --- matrix: new routes exist and are P-only (N-1, N-8) ---

const UUID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UUID_D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const contextFor = (mode: 'platform' | 'consultant' | 'client' | 'employee'): AccessContext => {
  const base = { actorId: UUID_A, sessionId: UUID_A, capability: 'probe' };
  if (mode === 'platform') {
    return { ...base, role: 'ge_admin', mode, tenantId: null, departmentId: null, tabId: UUID_A, generation: 1 };
  }
  if (mode === 'consultant') {
    return { ...base, role: 'ge_admin', mode, tenantId: UUID_A, departmentId: null, tabId: UUID_A, generation: 1 };
  }
  if (mode === 'client') {
    return { ...base, role: 'client_admin', mode, tenantId: UUID_A, departmentId: null, tabId: null, generation: null };
  }
  return { ...base, role: 'employee', mode, tenantId: UUID_A, departmentId: UUID_D, tabId: null, generation: null };
};

const NEW_P_ONLY: Record<string, string> = {
  'POST /standards': 'P#catalog',
  'POST /disclosures': 'P#catalog',
  'POST /items/bulk': 'P#catalog',
  'DELETE /services/:id': 'P#global-service-configuration',
};

test('P2 matrix: the four new routes exist with exact P-only matrices', () => {
  for (const [key, matrix] of Object.entries(NEW_P_ONLY)) {
    const [method, ...rest] = key.split(' ');
    const route = classifyRoute(method, rest.join(' '));
    assert.ok(route, `${key} must be registered`);
    assert.equal(formatMatrix(route.matrix), matrix, `${key} matrix drift`);
  }
});

test('P2 matrix N-8 (+N-1 write side): P admitted; W/C/E denied 403 on every new write', () => {
  for (const key of Object.keys(NEW_P_ONLY)) {
    const [method, ...rest] = key.split(' ');
    const route = classifyRoute(method, rest.join(' '))!;
    assert.doesNotThrow(() => assertRouteContext(route, contextFor('platform')), `${key} / P`);
    for (const mode of ['consultant', 'client', 'employee'] as const) {
      assert.throws(() => assertRouteContext(route, contextFor(mode)),
        (err: { statusCode?: number; code?: string }) =>
          err.statusCode === 403 && err.code === 'workspace.mode_mismatch',
        `${key} / ${mode} must be 403`);
    }
  }
});

// --- handler-shape pins (static evidence for the UNIT+STATIC gate) ---

test('P2 shape: new mutating declarations carry the fresh-password gate on-line', () => {
  const lines = taxonomy().split('\n');
  for (const key of ['POST /standards', 'POST /disclosures', 'POST /items/bulk', 'DELETE /services/:id']) {
    const [method, path] = [key.split(' ')[0].toLowerCase(), key.split(' ')[1]];
    const line = lines.find((l) => l.includes(`router.${method}('${path}'`));
    assert.ok(line, `${key} declaration exists`);
    assert.ok(line.includes('requireFreshPassword'), `${key} mounts the fresh gate`);
    assert.ok(line.includes('requireDomainAccess'), `${key} mounts the domain wrapper`);
    assert.ok(line.includes('validateTaxonomyIds'), `${key} validates ids`);
  }
});

test('P2 shape: new actions are audited in-txn; the closed error-code set holds', () => {
  const src = taxonomy();
  for (const action of ['CREATE_STANDARD', 'CREATE_DISCLOSURE', 'ARCHIVE_ITEM', 'SERVICE_DELETED']) {
    assert.ok(src.includes(`action: '${action}'`), `${action} audited`);
  }
  for (const code of ['item.version_conflict', 'item.archived', 'service.delete_blocked']) {
    assert.ok(src.includes(`'${code}'`), `${code} wired`);
  }
  assert.ok(!src.includes('service.settings_unknown'),
    'no settings whitelist yet (C3) — the branch stays byte-identical');
  // TASK-PROTO-U4-2-FIX P4 (Tera round-2 ruling A): the C1 guard has served
  // its purpose — P4 implements the full reopen leg (version gate + snapshot
  // + answers→reopened + REOPEN_ITEM_SCOPE, one txn, behind the P-config
  // answers-update RLS branch). The reopen behavior is pinned in
  // src/lib/u42fix-p4.test.ts; this file keeps the P2 audit/code pins only.
  assert.ok(src.includes('REOPEN_ITEM_SCOPE'),
    'P4 now owns the reopen leg (C1 closed by the RLS decision + P4 implementation)');
});

test('P2 shape: bulk never aborts siblings; archive leaves the live scope', () => {
  const src = taxonomy();
  assert.ok(src.includes('for (const entry of ordered)'), 'bulk iterates rows in lock order');
  const bulkStart = src.indexOf("router.post('/items/bulk'");
  const bulkEnd = src.indexOf("router.patch('/items/:id'");
  assert.ok(bulkStart > 0 && bulkEnd > bulkStart, 'bulk handler bounds are locatable');
  const bulkBody = src.slice(bulkStart, bulkEnd);
  assert.ok(!bulkBody.includes('Item not found.\'), { statusCode'),
    'missing bulk rows are row errors, never request aborts');
  assert.ok(src.includes("i.status = 'active'"), 'live reads exclude archived items');
  assert.ok(src.includes('includeArchived'), 'P history opt-in is additive');
});

test('P2 shape: service delete checks every CASCADE/NO-ACTION child before removal', () => {
  const src = taxonomy();
  const at = src.indexOf("router.delete('/services/:id'");
  assert.ok(at > 0, 'DELETE /services/:id exists');
  const body = src.slice(at, src.indexOf('export default router'));
  for (const table of ['item_versions', 'approved_service_copies', 'client_services',
    'report_settings', 'document_requirements', 'esg_profile']) {
    assert.ok(body.includes(table), `precondition counts ${table}`);
  }
  assert.ok(body.includes('service.delete_blocked'), 'refusal carries the specified code');
  assert.ok(body.includes('SERVICE_DELETED'), 'removal audits in the same txn');
});
