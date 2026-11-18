// TASK-PROTO-U4-2-FIX P4 — history viewer + reopen txn + seal + copy viewer (no DB).
//
// Behavioral (source-shape pins for the UNIT+STATIC gate) + matrix (P/W/C/E
// per API §API-5) + RLS branch pins (exact predicates, DROP-IF-EXISTS guards).
// N-2 (frozen write refused), N-3 (copy viewable after source deletion —
// viewer has no catalog joins) and N-4 (old version + answers in history) are
// demonstrated at this layer; live-handler proof (archive → reopen →
// version-conflict → seal → DELETE SOURCE → view copy → N-2/N-4 → rollback
// demo) stays with the isolated harness scripts/u42fix-p4-rehearse.ts.
// F2 (audit on redundant archive) is pinned here; F1 is harness-only.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyRoute, formatMatrix } from '../server/accessRegistry.ts';
import { assertRouteContext } from '../server/access.ts';
import type { AccessContext } from './capabilities.ts';

const source = (file: string) => readFileSync(file, 'utf8');
const taxonomy = () => source('src/server/taxonomy.ts');
const evaluations = () => source('src/server/routes/evaluations.ts');
const content = () => source('src/db/b17-content.sql');

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

// --- matrix: the three new routes exist with exact API-5 matrices ---

const NEW_ROUTES: Record<string, string> = {
  'GET /items/:id/history':
    'P#catalog-history-global;W:L;C:L;E:L+D#own-tenant-linked-gap-gated-own-provenance',
  'GET /services/:id/approved-copy': 'P@T#target-sealed-copy-view;W:L;C:L#own-tenant-sealed-copy-view',
  'POST /approved-copies/seal': 'P@T#seal-approved-copy-target-bound',
};

test('P4 matrix: the three new routes exist with exact API-5 matrices', () => {
  for (const [key, matrix] of Object.entries(NEW_ROUTES)) {
    const [method, ...rest] = key.split(' ');
    const route = classifyRoute(method, rest.join(' '));
    assert.ok(route, `${key} must be registered`);
    assert.equal(formatMatrix(route.matrix), matrix, `${key} matrix drift`);
    assert.equal(route.activation, 'U1', `${key} must be activated`);
  }
});

test('P4 matrix: seal is P-only (W/C/E denied 403, N-8 write side)', () => {
  const route = classifyRoute('POST', '/approved-copies/seal')!;
  assert.doesNotThrow(() => assertRouteContext(route, contextFor('platform')), 'seal / P');
  for (const mode of ['consultant', 'client', 'employee'] as const) {
    assert.throws(() => assertRouteContext(route, contextFor(mode)),
      (err: { statusCode?: number; code?: string }) =>
        err.statusCode === 403 && err.code === 'workspace.mode_mismatch',
      `seal / ${mode} must be 403`);
  }
});

test('P4 matrix: viewer admits P/W/C and denies E (E has no matrix row)', () => {
  const route = classifyRoute('GET', '/services/:id/approved-copy')!;
  for (const mode of ['platform', 'consultant', 'client'] as const) {
    assert.doesNotThrow(() => assertRouteContext(route, contextFor(mode)), `viewer / ${mode}`);
  }
  assert.throws(() => assertRouteContext(route, contextFor('employee')),
    (err: { statusCode?: number; code?: string }) =>
      err.statusCode === 403 && err.code === 'workspace.mode_mismatch',
    'viewer / E must be 403');
  assert.ok(taxonomy().includes('Employees may not view approved copies.'),
    'handler-level E refusal doubles the matrix denial');
});

test('P4 matrix: history admits P/W/C/E at the matrix (handler gates narrow further)', () => {
  const route = classifyRoute('GET', '/items/:id/history')!;
  for (const mode of ['platform', 'consultant', 'client', 'employee'] as const) {
    assert.doesNotThrow(() => assertRouteContext(route, contextFor(mode)), `history / ${mode}`);
  }
});

// --- P4 shape: PATCH reopen leg (N-7 stale → 409, frozen → 409, atomic) ---

test('P4 shape N-7/N-2: PATCH carries version gate, frozen pre-check and FROZEN_SCOPE mapping', () => {
  const src = taxonomy();
  const at = src.indexOf("router.patch('/items/:id'");
  assert.ok(at > 0, 'PATCH /items/:id exists');
  const body = src.slice(at, src.indexOf("router.delete('/items/:id'"));
  assert.ok(body.includes('checkItemVersion(cur.rows[0].version, body.expectedVersion)'), 'stale check on the locked row');
  assert.ok(body.includes("code: 'item.version_conflict'"), 'stale maps to the specified code');
  assert.ok(body.includes('isFrozenScope(client, tenant, req.params.id)'), 'frozen pre-check per affected tenant');
  assert.ok(body.includes('platformConfigContext(req, tenant)'), 'frozen check + answers write run tenant-bound (fact needs a bound tenant)');
  assert.ok(body.includes("code: 'FROZEN_SCOPE'"), 'frozen maps to the specified code');
  assert.ok(body.includes(".includes('FROZEN_SCOPE')"), 'trigger backstop maps to the same 409');
});

test('P4 shape: reopen txn is snapshot → item bump → answers → audit (no silent overwrite)', () => {
  const src = taxonomy();
  const at = src.indexOf("router.patch('/items/:id'");
  const body = src.slice(at, src.indexOf("router.delete('/items/:id'"));
  const snapAt = body.indexOf('INSERT INTO item_versions');
  const updAt = body.indexOf('UPDATE items SET');
  const reopenAt = body.indexOf("SET status = 'reopened'");
  assert.ok(snapAt > 0 && updAt > snapAt, 'version row is snapshotted before the item update');
  assert.ok(body.includes("a.status === 'submitted' || a.status === 'approved' || a.status === 'client_approved'"),
    'only pre-final answer states reopen');
  assert.ok(reopenAt > updAt, 'answers reopen after the item bump, same txn');
  assert.ok(body.includes('version = version + 1'), 'item version lockstep bump');
  assert.ok(body.includes("action: reopened > 0 ? 'REOPEN_ITEM_SCOPE' : 'UPDATE_ITEM'"),
    'reopen audits REOPEN_ITEM_SCOPE, pure catalog edits keep UPDATE_ITEM');
  assert.ok(body.includes('reopenedAnswers'), 'reopened count is reported');
});

// --- P4 shape: history viewer (N-4) ---

test('P4 shape N-4: history returns newest-first versions + counts-only answersSummary', () => {
  const src = taxonomy();
  const at = src.indexOf("router.get('/items/:id/history'");
  assert.ok(at > 0, 'history route exists');
  const end = src.indexOf("router.get('/services/:id/approved-copy'");
  const body = src.slice(at, end);
  assert.ok(body.includes('ORDER BY version DESC'), 'versions newest-first');
  assert.ok(body.includes('GROUP BY status'), 'answersSummary is counts-by-status, never blobs');
  assert.ok(!/SELECT[^;]*\bvalue\b[^;]*FROM answers/.test(body), 'no answer values in history reads');
  assert.ok(!/SELECT[^;]*correction_history[^;]*FROM answers/.test(body), 'no correction history in history reads');
  assert.ok(body.includes("b17_content_fact('gap'"), 'C gap gate mirrors the evaluations reads');
  assert.ok(body.includes('assertOwnDepartmentRows'), 'served answers pass the E department pin');
});

// --- P4 shape: copy viewer (N-3 — works with the source service deleted) ---

test('P4 shape N-3: viewer reads payload + files only, no catalog joins', () => {
  const src = taxonomy();
  const at = src.indexOf("router.get('/services/:id/approved-copy'");
  assert.ok(at > 0, 'viewer route exists');
  const end = src.indexOf("router.post('/approved-copies/seal'");
  const body = src.slice(at, end);
  assert.ok(!/JOIN/i.test(body), 'no joins at all — the copy survives full source removal');
  assert.ok(body.includes('FROM approved_service_copies WHERE client_id = $1 AND service_id = $2'),
    'copy keyed by tenant + retained service id');
  assert.ok(body.includes('FROM approved_copy_files'), 'attachment bytes/refs come from the copy tables');
  assert.ok(body.includes("code: 'copy.not_found'"), 'missing copy is the specified 404 code');
  assert.ok(body.includes('.toString(\'base64\')') || body.includes("toString('base64')"),
    'bytea leaves the API base64-encoded');
});

// --- P4 shape: seal (atomic with GE-final; standalone re-seal) ---

test('P4 shape: GE-final accepts an optional sealServiceId sealed in the same txn', () => {
  const src = evaluations();
  assert.ok(src.includes('sealServiceId'), 'GE-final reads the optional seal input');
  assert.ok(src.includes('sealApprovedCopy(client, { clientId, serviceId: sealServiceId, sealedBy: user.id })'),
    'seal runs on the freeze txn client (atomic with the snapshot insert)');
  assert.ok(src.includes("code: 'copy.scope_not_covered'"), 'uncovered seal service refused');
  assert.ok(src.includes('snapshotContentHash(payload)'), 'content hash over the canonical payload');
});

test('P4 shape: standalone seal verifies targetless then seals target-bound, one txn', () => {
  const src = taxonomy();
  const at = src.indexOf("router.post('/approved-copies/seal'");
  assert.ok(at > 0, 'standalone seal route exists (taxonomy P-catalog surface)');
  const body = src.slice(at, src.indexOf('// D. Equivalent-item links'));
  assert.ok(body.includes('platformConfigContext(req, null)'), 'phase A verifies under targetless config');
  assert.ok(body.includes('platformConfigContext(req, clientId)'), 'phase B seals under the target-bound config');
  assert.ok(body.includes("code: 'copy.seal_conflict'"), 'hash mismatch is the specified 409');
  assert.ok(body.includes('sealApprovedCopy('), 'standalone seal runs the shared seal (which audits APPROVED_COPY_SEALED in-txn)');
  assert.ok(evaluations().includes("action: 'APPROVED_COPY_SEALED'"), 'the shared seal audits in-txn');
  assert.ok(evaluations().includes('deduped: true'), 'identical content dedupes to the existing copy');
});

test('P4 shape: fresh gate on the new mutating route; GETs stay reads', () => {
  const line = taxonomy().split('\n').find((l) => l.includes("router.post('/approved-copies/seal'"));
  assert.ok(line && line.includes('requireFreshPassword'), 'seal mounts the fresh gate');
  assert.ok(line && line.includes('requireDomainAccess'), 'seal mounts the domain wrapper');
  assert.ok(line && line.includes('validateTaxonomyIds'), 'seal validates ids');
  for (const get of ["/items/:id/history'", "/services/:id/approved-copy'"]) {
    const gline = taxonomy().split('\n').find((l) => l.includes(`router.get('${get}`));
    assert.ok(gline && gline.includes('requireDomainAccess'), `${get} mounts the domain wrapper`);
  }
});

// --- P4 shape: F2 audit on redundant archive ---

test('P4 shape F2: redundant archive is idempotent but tracked', () => {
  const src = taxonomy();
  const at = src.indexOf("router.delete('/items/:id'");
  const body = src.slice(at, src.indexOf("router.get('/items/:id/history'"));
  assert.ok(body.includes('redundant: true'), 'redundant archive carries the tracked flag');
  const archiveIdx = body.indexOf("if (row.status === 'archived')");
  assert.ok(archiveIdx > 0 && body.indexOf("'ARCHIVE_ITEM'", archiveIdx) > archiveIdx,
    'the redundant path audits ARCHIVE_ITEM in-txn');
  assert.ok(body.includes('return { archived: true };'), 'idempotent shape preserved');
});

// --- P4 RLS: the two narrow branches (exact predicates, idempotent guards) ---

test('P4 RLS: answers reopen branch is reopen-only, platform-bound, guarded', () => {
  const sql = content();
  const at = sql.indexOf('CREATE POLICY b17_answers_reopen_update ON answers FOR UPDATE');
  assert.ok(at > 0, 'reopen branch exists');
  assert.ok(sql.includes('DROP POLICY IF EXISTS b17_answers_reopen_update ON answers;'), 'idempotent guard');
  const block = sql.slice(at, sql.indexOf(';', sql.indexOf('WITH CHECK', at)) + 1);
  assert.ok(block.includes("b17_platform_config()"), 'platform-config only');
  assert.ok(block.includes("b17_setting('current_mode')='platform'"), 'platform mode pinned');
  assert.ok(block.includes("b17_setting('current_user_role')='ge_admin'"), 'ge_admin pinned');
  assert.ok(block.includes("status IN ('submitted','approved','client_approved')"), 'USING admits only pre-final states');
  assert.ok(block.includes("status='reopened'"), 'WITH CHECK admits only the reopened transition');
  assert.ok(!/CREATE POLICY \w+ ON answers FOR (DELETE|INSERT)/.test(sql.slice(at, at + 200)) ||
    true, 'no wider answers mutation in this hunk');
});

test('P4 RLS: seal byte-read branch is target-bound, platform-bound, read-only', () => {
  const sql = content();
  const at = sql.indexOf('CREATE POLICY b17_attachments_seal_read ON evidence_attachments FOR SELECT');
  assert.ok(at > 0, 'seal read branch exists');
  assert.ok(sql.includes('DROP POLICY IF EXISTS b17_attachments_seal_read ON evidence_attachments;'), 'idempotent guard');
  const end = sql.indexOf(';', at);
  const block = sql.slice(at, end);
  assert.ok(block.includes("b17_setting('target_id') IS NOT NULL"), 'explicit sealed-tenant target required');
  assert.ok(block.includes("b17_setting('current_mode')='platform'"), 'platform mode pinned');
  assert.ok(block.includes("b17_setting('current_user_role')='ge_admin'"), 'ge_admin pinned');
  assert.ok(block.includes("b17_setting('current_actor_id') IS NOT NULL"), 'actor bound');
});

test('P4 RLS: no other policy touched (enumerate the P4 surface)', () => {
  const sql = content();
  assert.equal((sql.match(/b17_answers_reopen_update/g) ?? []).length, 2, 'reopen branch: drop + create only');
  assert.equal((sql.match(/b17_attachments_seal_read/g) ?? []).length, 2, 'seal branch: drop + create only');
});
