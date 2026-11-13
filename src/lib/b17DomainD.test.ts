import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { domainTenant, domainFailure, textFilter, validateDomainIds } from '../server/routes/initiativeScope.ts';
import { serviceMappings } from '../server/routes/initiatives.ts';
import type { AuthenticatedRequest } from '../server/auth.ts';
import taxonomy from '../server/taxonomy.ts';
import gri from '../server/routes/gri.ts';

const A = '00000000-0000-4000-8000-000000000001', B = '00000000-0000-4000-8000-000000000002';
const req = (mode = 'consultant', body = {}, query = {}, params = {}) => ({
  access:{ mode,tenantId:mode === 'platform' ? null : A },body,query,params,
}) as unknown as AuthenticatedRequest;

test('U2-D boundaries: explicit platform T, bound own tenant, malformed and ambiguous inputs never broaden', () => {
  assert.equal(domainTenant(req()),A);
  assert.equal(domainTenant(req(),A),A);
  assert.throws(() => domainTenant(req(),B), /scope.tenant_mismatch/);
  assert.throws(() => domainTenant(req('platform')), /scope.id_required/);
  assert.equal(domainTenant(req('platform'),B),B);
  for (const bad of ['',null,[],{},'not-uuid']) {
    assert.throws(() => validateDomainIds(req('consultant',{}, { serviceId:bad })), /scope.id_invalid|scope.id_required/);
    assert.throws(() => validateDomainIds(req('consultant',{}, {},{ id:bad })), /scope.id_invalid|scope.id_required/);
  }
  assert.throws(() => validateDomainIds(req('consultant',{ clientId:B })), /scope.tenant_mismatch/);
  assert.throws(() => validateDomainIds(req('platform',{ clientId:A },{ clientId:B })), /scope.tenant_mismatch/);
  assert.throws(() => textFilter(['eligible']), /scope.filter_invalid/);
});

test('U2-D domain failures redact SQL diagnostics and preserve explicit public error codes', () => {
  const output = { statusCode:0,body:{} as any,status(n:number) { this.statusCode=n; return this; },json(body:unknown) { this.body=body; return this; } };
  domainFailure(output as never,{ message:'secret constraint diagnostic',code:'22P02' },'Operation failed');
  assert.equal(output.statusCode,500); assert.deepEqual(output.body,{ error:'Operation failed',code:undefined });
  domainFailure(output as never,{ statusCode:400,message:'scope.id_invalid',code:'scope.id_invalid' },'Operation failed');
  assert.equal(output.statusCode,400); assert.equal(output.body.code,'scope.id_invalid');
});

test('U2-D carryover validation runs after auth/mode but before domain SQL on every taxonomy/GRI route', () => {
  for (const router of [taxonomy,gri]) for (const layer of router.stack.filter((l:any) => l.route)) {
    const names = layer.route!.stack.map((l:any) => l.handle.name);
    const validation = names.findIndex((n:string) => ['validateTaxonomyIds','validateGriIds'].includes(n));
    assert.ok(validation > names.indexOf('authMiddleware'));
    assert.ok(validation > names.indexOf('requireDomainAccess'));
    assert.ok(validation < names.length-1);
  }
});

test('U2-D policy surface stays purpose/target/linked bound; count repair and sanctioned definer set are closed', () => {
  const sql = readFileSync('src/db/b17-content.sql','utf8');
  assert.match(sql,/CREATE FUNCTION b17_domain_config[\s\S]*?current_mode'\)='platform'[\s\S]*?target_id[\s\S]*?current_tenant_id[\s\S]*?b17_content_fact\('service',t,s\)/);
  assert.match(sql,/CREATE POLICY b17_selection_insert[\s\S]*?current_mode'\)='consultant'[\s\S]*?selected_by::text=b17_setting\('current_actor_id'\)/);
  assert.match(sql,/WHEN 'item.actions' THEN \(SELECT count\(\*\)::int FROM actions a WHERE a.item_id=ref\)/);
  assert.equal((sql.match(/SECURITY DEFINER\s*\nSET search_path/g) ?? []).length,2);
  for (const name of ['initiatives.ts','profileRoutes.ts','reports.ts','reportSettings.ts','reportData.ts']) {
    const source = readFileSync(`src/server/routes/${name}`,'utf8');
    assert.doesNotMatch(source,/contextFromUser|initiativeSelectionScope|evalClientScope|reportTenantScope/);
  }
});

// QA F1 / round 3 ruling: duplicate serviceIds -> 400 scope.duplicate_id
// BEFORE any SQL (case-insensitive), unknown DISTINCT well-formed ids keep 404.
test('U2-D F1: serviceIds duplicates are 400 scope.duplicate_id with zero pg statements', () => {
  const X = '00abcdef-0000-4000-8000-000000000001', Y = '00abcdef-0000-4000-8000-000000000002';
  assert.notEqual(X, X.toUpperCase(), 'fixture must be case-distinguishable');
  const original = pg.Client.prototype.query;
  const statements: string[] = [];
  (pg.Client.prototype as any).query = function (this: unknown, ...args: any[]) {
    statements.push(typeof args[0] === 'string' ? args[0] : String(args[0]?.text ?? ''));
    return (original as any).apply(this, args);
  };
  const outcome = (fn: () => unknown) => { try { return { ok: fn() }; } catch (e:any) { return { status:e.statusCode, code:e.code }; } };
  try {
    // Case-variant duplicate (the QA F1 shape), both orders, exact duplicate.
    assert.deepEqual(outcome(() => serviceMappings([X, X.toUpperCase()])), { status:400, code:'scope.duplicate_id' });
    assert.deepEqual(outcome(() => serviceMappings([X.toUpperCase(), X])), { status:400, code:'scope.duplicate_id' });
    assert.deepEqual(outcome(() => serviceMappings([X, X])), { status:400, code:'scope.duplicate_id' });
    assert.deepEqual(outcome(() => serviceMappings([X, X.toUpperCase(), Y])), { status:400, code:'scope.duplicate_id' });
    // Exact + malformed keep their 400s; DISTINCT well-formed ids pass the helper
    // (their unknown->404 is the SQL-path check proven by the U2D proof).
    assert.deepEqual(outcome(() => serviceMappings(['bad-id'])), { status:400, code:'scope.id_invalid' });
    assert.deepEqual(outcome(() => serviceMappings([X, Y])), { ok:[X, Y] });
  } finally { (pg.Client.prototype as any).query = original; }
  assert.deepEqual(statements, [], 'duplicate serviceIds must be refused before any pg query');
});

test('U2-D F1: both serviceIds handlers call the duplicate helper before their domain transaction', () => {
  const source = readFileSync('src/server/routes/initiatives.ts','utf8');
  let from = 0, checked = 0;
  for (;;) {
    const call = source.indexOf('serviceMappings(body.serviceIds)', from);
    if (call < 0) break;
    const txn = source.indexOf('domainTransaction(req', call);
    assert.ok(txn > call, 'serviceIds validation must precede the transaction/SQL path');
    checked++; from = call + 1;
  }
  assert.equal(checked, 2, 'POST /initiatives and PATCH /initiatives/:id both validate serviceIds first');
});
