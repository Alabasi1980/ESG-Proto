// TASK-PROTO-U4-2-FIX P3 — service-scoped import (no client), no DB.
//
// Behavioral (pure parser + commit validator) + matrix (P-only on the
// registered aliases) + source-shape pins (N-5: import without clientId is a
// catalog commit with zero departments/assignments; row-level errors carry
// row + column + code + message; unmapped columns are reported, never silent).
// Live-handler proof stays with QA on the isolated harness. The canonical
// /import/* registry rows are a Tera-owned expansion (STOP/ASK in handback);
// this file pins the declarations mount the P-only wrapper so the matrix
// follows automatically once registered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyRoute, formatMatrix } from '../server/accessRegistry.ts';
import { assertRouteContext } from '../server/access.ts';
import type { AccessContext } from './capabilities.ts';
import { parseGRIFile, resolveUnmappedColumns } from './griParser.ts';
import { validateCommitStandards } from '../server/routes/gri.ts';

const source = (file: string) => readFileSync(file, 'utf8');
const gri = () => source('src/server/routes/gri.ts');
const parser = () => source('src/lib/griParser.ts');

const CLEAN_CSV = `Standard Code,Standard Title,Category,Disclosure Code,Disclosure Title,Item Code,Requirement,Priority,ESG Class,Answer Type,Hint
GRI 2,General Disclosures 2021,Universal,2-1,Organizational details,2-1-a,Report legal name,high,governance,text,Hint A
GRI 2,General Disclosures 2021,Universal,2-1,Organizational details,2-1-b,Report ownership,mid,governance,text,Hint B`;

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

// --- parser: clean sheet ---

test('P3 parser: clean sheet parses with empty rowErrors and empty unmappedColumns', () => {
  const res = parseGRIFile(CLEAN_CSV);
  assert.equal(res.summary.totalStandards, 1);
  assert.equal(res.summary.totalDisclosures, 1);
  assert.equal(res.summary.totalItems, 2);
  assert.deepEqual(res.rowErrors, []);
  assert.deepEqual(res.unmappedColumns, []);
  assert.deepEqual(res.errors, []);
});

// --- parser: row-level errors (row + column + code + message) ---

test('P3 parser N-5: missing requirement and missing item code surface as row-level errors, rows still previewable', () => {
  const csv = `Standard Code,Standard Title,Category,Disclosure Code,Disclosure Title,Item Code,Requirement
GRI 2,T,U,2-1,D,,,
GRI 2,T,U,2-1,D,2-1-b,`;
  const res = parseGRIFile(csv);
  assert.equal(res.standards.length, 1, 'rows stay previewable despite errors');
  const byCode = new Map(res.rowErrors.map((e) => [e.code, e]));
  assert.ok(byCode.has('import.missing_item_code'), 'item-code error present');
  assert.ok(byCode.has('import.missing_requirement'), 'requirement error present');
  for (const err of res.rowErrors) {
    assert.ok(Number.isInteger(err.row) && err.row >= 2, `row is a 1-indexed sheet row: ${err.row}`);
    assert.ok(typeof err.column === 'string' && err.column.length > 0, 'column named');
    assert.ok(typeof err.code === 'string' && err.code.startsWith('import.'), 'stable machine code');
    assert.match(err.message, new RegExp(`Row ${err.row}`), 'message carries the row number');
  }
});

// --- parser: unmapped columns reported, mapping consumes them ---

test('P3 parser: unknown headers land in unmappedColumns, never silently dropped', () => {
  const csv = `Standard Code,Disclosure Code,Item Code,Requirement,Weird Custom Col
GRI 2,2-1,2-1-a,Do the thing,x`;
  const res = parseGRIFile(csv);
  assert.deepEqual(res.unmappedColumns, ['Weird Custom Col']);
  assert.equal(res.summary.totalItems, 1, 'the mapped row still parses');
});

test('P3 parser: columnMapping renames a source header and clears it from unmappedColumns', () => {
  const csv = `Std,Disc,Code,My Req Col,Extra Col
GRI 2,2-1,2-1-a,Do the thing,x`;
  const unmapped = resolveUnmappedColumns(['Std', 'Disc', 'Code', 'My Req Col', 'Extra Col'],
    { standardCode: 'Std', disclosureCode: 'Disc', itemCode: 'Code', requirement: 'My Req Col' });
  assert.deepEqual(unmapped, ['Extra Col'],
    'mapping-consumed sources clear; truly unknown headers stay reported');
  const res = parseGRIFile(csv, {
    columnMapping: { standardCode: 'Std', disclosureCode: 'Disc', itemCode: 'Code', requirement: 'My Req Col' },
  });
  assert.deepEqual(res.unmappedColumns, ['Extra Col']);
  assert.equal(res.standards[0]?.disclosures[0]?.items[0]?.requirement, 'Do the thing');
  assert.deepEqual(res.rowErrors, [], 'mapped columns satisfy the row contract');
});

// --- commit validator: row-level refusal before any txn ---

test('P3 commit validator: valid mapped standards pass; junk fails closed with row-level codes', () => {
  const valid = [{
    code: 'GRI 2', title: 'T', category: 'Universal',
    disclosures: [{ code: '2-1', title: 'D', items: [{ code: '2-1-a', requirement: 'Do it' }] }],
  }];
  assert.deepEqual(validateCommitStandards(valid), []);
  assert.deepEqual(validateCommitStandards([])[0]?.code, 'import.bad_standards');
  assert.deepEqual(validateCommitStandards('nope')[0]?.code, 'import.bad_standards');
  const bad = [{
    code: '  ', title: 'T', category: 'U',
    disclosures: [{ code: '', title: 'D', items: [{ code: '', requirement: '' }] }],
  }];
  const codes = validateCommitStandards(bad).map((e) => e.code);
  assert.ok(codes.includes('import.missing_standard_code'), codes.join(','));
  assert.ok(codes.includes('import.missing_disclosure_code'), codes.join(','));
  assert.ok(codes.includes('import.missing_item_code'), codes.join(','));
  assert.ok(codes.includes('import.missing_requirement'), codes.join(','));
  const rows = validateCommitStandards(bad);
  for (const err of rows) {
    assert.ok(typeof err.column === 'string' && err.column.length > 0);
    assert.match(err.message, /Row \d+|missing/i);
  }
});

// --- matrix: registered aliases stay P-only (W/C/E denied) ---

test('P3 matrix: the one-release /gri/* aliases keep their exact P-only matrices', () => {
  assert.equal(formatMatrix(classifyRoute('POST', '/gri/preview')!.matrix), 'P#authenticate-before-upload-parser');
  assert.equal(formatMatrix(classifyRoute('POST', '/gri/commit')!.matrix),
    'P#service-scoped-catalog-commit-alias-no-client');
  assert.equal(formatMatrix(classifyRoute('GET', '/gri/template')!.matrix), 'P#fetch-with-auth-tab-then-download');
  for (const [method, path] of [['POST', '/gri/preview'], ['POST', '/gri/commit'], ['GET', '/gri/template']] as const) {
    const route = classifyRoute(method, path)!;
    assert.doesNotThrow(() => assertRouteContext(route, contextFor('platform')), `${method} ${path} / P`);
    for (const mode of ['consultant', 'client', 'employee'] as const) {
      assert.throws(() => assertRouteContext(route, contextFor(mode)),
        (err: { statusCode?: number; code?: string }) =>
          err.statusCode === 403 && err.code === 'workspace.mode_mismatch',
        `${method} ${path} / ${mode} must be 403`);
    }
  }
});

// --- handler-shape pins: canonical declarations mount the P-only wrapper ---

test('P3 shape: canonical import declarations exist with auth + domain wrapper + id validation', () => {
  const src = gri();
  for (const line of [
    "router.post('/import/preview', authMiddleware, requireFreshPassword, requireDomainAccess, validateGriIds, upload.single('file'), handleImportPreview);",
    "router.post('/gri/preview', authMiddleware, requireDomainAccess, validateGriIds, upload.single('file'), handleImportPreview);",
    "router.post('/import/commit', authMiddleware, requireFreshPassword, requireDomainAccess, validateGriIds, handleImportCommit);",
    "router.post('/gri/commit', authMiddleware, requireFreshPassword, requireDomainAccess, validateGriIds, handleImportCommit);",
    "router.get('/services/:id/import/template', authMiddleware, requireDomainAccess, validateGriIds, handleImportTemplate);",
    "router.get('/gri/template', authMiddleware, requireDomainAccess, validateGriIds, handleImportTemplate);",
  ]) {
    assert.ok(src.includes(line), `missing declaration: ${line}`);
  }
});

test('P3 N-5 shape: clientId supplied refuses 400 import.client_forbidden; zero provisioning', () => {
  const src = gri();
  assert.ok(src.includes("'import.client_forbidden'"), 'refusal code wired');
  assert.ok(src.includes('hasImportClientScope(req)'), 'client scope checked on every import path');
  assert.ok(src.includes('query as Record<string, unknown>).client_id'),
    'SHIELD-P3-01: query.client_id refused exactly like query.clientId (strict parity, never silently ignored)');
  const commitStart = src.indexOf('async function handleImportCommit');
  const commitEnd = src.indexOf("router.post('/import/commit'");
  assert.ok(commitStart > 0 && commitEnd > commitStart, 'commit handler bounds are locatable');
  const body = src.slice(commitStart, commitEnd);
  assert.ok(body.includes('import.client_forbidden'), 'commit refuses client scope first');
  assert.ok(body.includes('validateCommitStandards'), 'row errors refuse before the transaction');
  assert.ok(body.includes('service.not_found'), 'target service existence checked');
  assert.ok(body.includes("action: 'IMPORT_CATALOG_COMMITTED'"), 'catalog commit audited in-txn');
  assert.ok(body.includes('clientId: null'), 'audit row is NULL-tenant platform');
  for (const banned of ['deptToItemIds', 'normalizeDepartmentCode', 'liveImportTenant', 'resolveImportTenant',
    'pg_advisory_xact_lock', 'IMPORT_GRI_DISCLOSURES', 'departmentsUpserted', 'assignmentsCreated',
    'effectiveClientId', 'b17.freeze:', "b17_content_fact('service'",
    'INSERT INTO departments', 'INSERT INTO assignments', 'ON CONFLICT (client_id, code)']) {
    assert.ok(!body.includes(banned), `commit body must not contain ${banned}`);
  }
  assert.ok(!src.includes('normalizeDepartmentCode'), 'department helper deleted file-wide');
  assert.ok(!src.includes('liveImportTenant'), 'tenant resolver deleted file-wide');
});

test('P3 frozen-skip shape: exactly per spec — no tenant means no determinable freeze', () => {
  const src = gri();
  const commitStart = src.indexOf('async function handleImportCommit');
  const body = src.slice(commitStart, src.indexOf("router.post('/import/commit'"));
  assert.ok(body.includes('no freeze scope is determinable'), 'the without-tenant rationale is stated');
  assert.ok(body.includes('const skippedFrozen = 0'), 'frozen skip count is determinably zero');
  assert.ok(body.includes('skippedFrozenReason: string | null'), 'reason field preserved for shape stability');
  assert.ok(!body.includes('SELECT is_scope_frozen'), 'no tenant-keyed freeze query on the catalog path');
  assert.ok(body.includes('mappedStandards') && body.includes('unmappedStandards'),
    'mapped/unmapped vs the TARGET service kept; tenant part removed');
  assert.ok(!body.includes('before tenant assignments become authorized'),
    'old tenant-coupled setupNotice wording is gone');
});

test('P3 template shape: canonical per-service route validates service id, serves CSV download', () => {
  const src = gri();
  assert.ok(src.includes('IMPORT_TEMPLATE_CSV'), 'single template source for both routes');
  const at = src.indexOf('function handleImportTemplate');
  const body = src.slice(at, src.indexOf("router.get('/services/:id/import/template'"));
  assert.ok(body.includes('hasImportClientScope(req)'), 'template refuses client scope too');
  assert.ok(body.includes('req.params'), 'canonical service id comes from the path param');
  assert.ok(body.includes('scopeId(rawId, true)'), 'service id validated (400 scope.* on junk)');
  assert.ok(body.includes('text/csv'), 'CSV download preserved');
});

test('P3 parser shape: mapping contract and error vocabulary are additive only', () => {
  const src = parser();
  assert.ok(src.includes('unmappedColumns'), 'unmapped reporting exists');
  assert.ok(src.includes('rowErrors'), 'row-level errors exist');
  assert.ok(src.includes('ImportColumnMapping'), 'mapping type exported');
  assert.ok(src.includes('resolveUnmappedColumns'), 'mapping helper exported');
  assert.ok(src.includes('import.missing_requirement'), 'requirement code wired');
  assert.ok(src.includes('import.missing_item_code'), 'item-code code wired');
});
