import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import * as XLSX from 'xlsx';
import type { AccessContext } from './capabilities.ts';
import { parseB17ContentSources } from '../db/b17ContentMigration.ts';
import { itemQuery,scopeId,assertWorkScope,SCOPED_ITEM_SQL,scopedInitiatives,
  assertActionBinding,resolveLinkedService } from '../server/scope.ts';

const access = (mode: AccessContext['mode'] = 'consultant'): AccessContext => ({actorId:randomUUID(),sessionId:randomUUID(),
  role:mode === 'employee' ? 'employee' : mode === 'client' ? 'client_admin' : 'ge_admin',mode,
  tenantId:mode === 'platform' ? null : randomUUID(),departmentId:mode === 'employee' ? randomUUID() : null,
  tabId:['platform','consultant'].includes(mode) ? randomUUID() : null,
  generation:['platform','consultant'].includes(mode) ? 1 : null,capability:'test'});
const stub = (rows: unknown[]) => ({query:async()=>({rows,rowCount:rows.length})}) as unknown as pg.PoolClient;

test('scope predicates are fixed, parameterized EXISTS and department assignment, never service fan-out',()=>{
  const a=access('employee'),service=randomUUID(),id=randomUUID();
  const q=itemQuery(a,{serviceId:service,itemId:id});
  assert.deepEqual(q.values,[a.tenantId,service,a.departmentId,null,null,id]);
  assert.match(SCOPED_ITEM_SQL,/EXISTS/);assert.match(SCOPED_ITEM_SQL,/assignments/);
  assert.doesNotMatch(q.text,/LEFT JOIN|UNION|assigned_user_id/);
  assert.ok(!q.text.includes(a.tenantId!));
});
test('unknown/malformed bindings and array/object/duplicate-like resource filters fail closed',()=>{
  for(const value of ['',[],{},['a','b'],'a,b',';DROP TABLE items',3]) assert.throws(()=>scopeId(value),{code:'scope.id_invalid'});
  assert.equal(scopeId(undefined),null);assert.throws(()=>scopeId(null,true),{code:'scope.id_required'});
  for(const a of [access('platform'),{...access(),role:'unknown'},{...access('employee'),departmentId:null}])
    assert.throws(()=>assertWorkScope(a as AccessContext),{code:'scope.denied'});
  assert.throws(()=>itemQuery(access(),{standardId:[randomUUID(),randomUUID()]}));
  for(const filter of ['standardId','disclosureId','itemId','serviceId'])
    assert.throws(()=>itemQuery(access(),{[filter]:null}),{code:'scope.id_required'});
});
test('initiative eligible/library never broadens client or employee access',async()=>{
  const db=stub([]);
  for(const [a,view] of [[access('client'),'eligible'],[access('client'),'library'],[access('employee'),'selected'],[access(),'library']] as const)
    await assert.rejects(()=>scopedInitiatives(db,a,view),{code:'scope.initiatives_denied'});
  assert.deepEqual(await scopedInitiatives(db,access()),[]);
  await assert.rejects(()=>scopedInitiatives(db,access('client'),['eligible']),{code:'scope.view_invalid'});
});
test('service choice uses links, not report defaults; standalone actions require explicit service',async()=>{
  const a=access(),s=randomUUID();
  assert.equal(await resolveLinkedService(stub([]),a),null);
  assert.equal(await resolveLinkedService(stub([{service_id:s}]),a),s);
  await assert.rejects(()=>resolveLinkedService(stub([{service_id:s},{service_id:randomUUID()}]),a),{code:'service.required'});
  await assert.rejects(()=>resolveLinkedService(stub([]),a,s),{code:'scope.service_unlinked'});
  await assert.rejects(()=>assertActionBinding(stub([{id:randomUUID()}]),a,{departmentId:randomUUID()}),{code:'service.required'});
  await assert.rejects(()=>assertActionBinding(stub([]),a,{departmentId:randomUUID(),serviceId:s}),{code:'scope.department_mismatch'});
});
test('existing XLSX parses quoted commas/newlines; source keys reject missing/duplicate provenance',()=>{
  const gri='Standard Code,Disclosure Code,Item Code,Requirement\nGRI 2,2-1,2-1-1,"Legal, name\ncontinued"';
  const profile='pillar,department,topic,parameter\nENV,ESG,T,P';
  const sources=parseB17ContentSources(gri,profile);
  assert.equal(sources.griKeys.length,1);assert.equal(JSON.parse(sources.griKeys[0])[3],'Legal, name\ncontinued');
  assert.throws(()=>parseB17ContentSources(`${gri}\nGRI 2,2-1,2-1-1,"Legal, name\ncontinued"`,profile),/source_duplicate/);
  assert.throws(()=>parseB17ContentSources('wrong,headers\na,b',profile),/source_headers/);
});
test('approved source extracts are parsed read-only with actual headers',()=>{
  const paths=['../../../prototype/GRI_SOURCE_EXTRACT.csv','../../../prototype/ESG_PROFILE_EXTRACT.csv'];
  const csv=paths.map(path=>readFileSync(new URL(path,import.meta.url),'utf8'));
  for(let n=0;n<csv.length;n++){
    const book=XLSX.read(csv[n].replace(/^\uFEFF/,''),{type:'string',raw:true});
    const rows=XLSX.utils.sheet_to_json<Record<string,unknown>>(book.Sheets[book.SheetNames[0]],{defval:''});
    const expected=n===0?'Standard Code':'pillar';
    assert.ok(expected in rows[0],JSON.stringify({source:n,headers:Object.keys(rows[0])}));
  }
  const parsed=parseB17ContentSources(csv[0],csv[1]);
  assert.ok(parsed.griKeys.length>0);assert.ok(parsed.profileKeys.length>0);
});
