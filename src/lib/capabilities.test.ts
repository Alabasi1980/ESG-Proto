import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { LEGACY_ROUTES, ACCESS_REGISTRY, classifyRoute, assertRegistryCoverage } from '../server/accessRegistry.ts';
import { activeBusinessCapabilities, permittedPages, validBinding, type AccessContext } from './capabilities.ts';

test('B17 exact route inventory: all 95 legacy declarations classified once; 40 business routes still unactivated', () => {
  const files = ['src/server/taxonomy.ts', ...readdirSync('src/server/routes')
    .filter(name => name.endsWith('.ts')).map(name => `src/server/routes/${name}`)];
  const actual = files.flatMap(file => [...readFileSync(file,'utf8').matchAll(/router\.(get|post|put|patch|delete)\('([^']+)'/g)]
    .map(match => `${match[1].toUpperCase()} ${match[2]}`)).sort();
  assert.equal(actual.length, 95);
  assert.deepEqual(actual, LEGACY_ROUTES.map(route => `${route.method} ${route.path}`).sort());
  assert.equal(new Set(actual).size, actual.length);
  assert.equal(LEGACY_ROUTES.filter(route => route.activation === 'UNACTIVATED').length, 40);
  for (const route of LEGACY_ROUTES) {
    const path = route.path.replace(/:[^/]+/g, 'resource');
    assert.equal(classifyRoute(route.method, path), route);
    assert.equal(classifyRoute(route.method, path.toUpperCase() + '/'), route);
  }
  assert.equal(classifyRoute('GET', '/unknown'), undefined);
  assert.equal(classifyRoute('POST', '/workspace/not-enter'), undefined);
  // §19(3): tracked truthfully from registry activation, in first-appearance
  // order — U2-C added 'taxonomy' + 'gri' ahead of the U2-B capabilities.
  assert.deepEqual(activeBusinessCapabilities(),
    ['taxonomy', 'gri', 'actions', 'initiatives', 'reports', 'storage', 'audit', 'notifications']);
  assert.equal(activeBusinessCapabilities().includes('system'), false);
  assert.equal(activeBusinessCapabilities().includes('session'), false);
});
test('B17 mounted declaration coverage rejects missing, duplicate and new routes', () => {
  const stack = ACCESS_REGISTRY.map(route => ({ route: { path: route.path, methods: { [route.method.toLowerCase()]: true } } }));
  assert.doesNotThrow(() => assertRegistryCoverage([{ stack }]));
  assert.throws(() => assertRegistryCoverage([{ stack: stack.slice(1) }]));
  assert.throws(() => assertRegistryCoverage([{ stack: [...stack,stack[0]] }]));
  assert.throws(() => assertRegistryCoverage([{ stack: [...stack,{ route: { path:'/new',methods:{ get:true } } }] }]));
});
test('B17 pure bindings never derive platform from missing context', () => {
  const p: AccessContext = { actorId:'actor',sessionId:'session',role:'ge_admin',mode:'platform',tenantId:null,
    departmentId:null,tabId:'tab',generation:1,capability:'workspace.read' };
  assert.equal(validBinding(p),true);
  assert.deepEqual(permittedPages({ ...p,tabId:null }),[]);
  assert.equal(validBinding({ ...p,mode:'consultant',tenantId:null }),false);
  assert.equal(validBinding({ ...p,tenantId:'A' }),false);
  assert.ok(!permittedPages(p).includes('gap-analysis'));
  const w = { ...p,mode:'consultant' as const,tenantId:'A' };
  assert.ok(permittedPages(w).includes('gap-analysis'));
  assert.ok(!permittedPages(w).includes('settings'));
  assert.deepEqual(permittedPages({ ...p,role:'employee',mode:'employee',tenantId:'A',departmentId:'D',tabId:null,generation:null }),['gap-analysis']);
});
test('B17 runtime call-chain has no schema application; initializer guards before DDL and never regrants', () => {
  for (const file of ['server.ts','src/server/routes/system.ts','src/server/routes/session.ts']) {
    assert.doesNotMatch(readFileSync(file,'utf8'),/runMigrations|applyB17Offline|schema\.sql/);
  }
  const schema = readFileSync('src/db/schema.sql','utf8');
  assert.ok(schema.indexOf('schema.empty_install_only') < schema.indexOf('CREATE EXTENSION'));
  assert.doesNotMatch(schema,/INSERT INTO client_services/i);
  const server = readFileSync('server.ts','utf8');
  assert.ok(server.indexOf('await assertB17Ready()') < server.indexOf('app.listen('));
});
test('B17 U1V runtime roles require explicit membership in every mode', () => {
  const base: AccessContext = { actorId:'actor',sessionId:'session',role:'employee',mode:'employee',tenantId:'A',
    departmentId:'D',tabId:null,generation:null,capability:'work' };
  const modes = ['platform','consultant','client','employee'] as const;
  const invalidRoles: unknown[] = [undefined,null,'','auditor','GE_ADMIN','Employee','employee ',0,false,{},[],['employee'],new String('employee')];
  for (const role of invalidRoles) for (const mode of modes) for (const tabId of [null,'tab']) {
    const access = { ...base,role,mode,tabId,generation:tabId?1:null } as AccessContext;
    assert.equal(validBinding(access),false);
    assert.deepEqual(permittedPages(access),[]);
  }
  for (const role of ['ge_admin','client_admin','employee'] as const) for (const mode of modes) {
    const access = { ...base,role,mode,tenantId:mode==='platform'?null:'A',
      tabId:role==='ge_admin'?'tab':null,generation:role==='ge_admin'?1:null };
    const allowed = role==='ge_admin' ? mode==='platform'||mode==='consultant'
      : role==='client_admin' ? mode==='client' : mode==='employee';
    assert.equal(validBinding(access),allowed);
    assert.equal(permittedPages(access).length>0,allowed);
  }
});
