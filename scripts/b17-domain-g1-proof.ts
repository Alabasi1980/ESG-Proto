// Own fresh scratch + real mounted dispatcher. No dotenv, server.ts, production
// pause endpoints, migration edits, shared/showcase ports, or credential output.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import express from 'express';
import cookieParser from 'cookie-parser';
import pg from 'pg';
import { getPool,runMigrations } from '../src/db/index.ts';
import { applyB17Offline,assertB17Ready } from '../src/db/b17Readiness.ts';
import { inventoryB17ContentOffline,applyB17ContentOffline } from '../src/db/b17ContentMigration.ts';
import { verifyToken } from '../src/server/auth.ts';
import { hashTab } from '../src/server/access.ts';
import { LEGACY_ROUTES,classifyRoute } from '../src/server/accessRegistry.ts';
import api from '../src/server/routes.ts';
import { jsonInput } from '../src/server/jsonInput.ts';
import { globalJsonErrorHandler } from '../src/server/errorHandler.ts';
import { seedG1,siteCases,positiveWrites,type Case } from './b17-domain-g1-fixture.ts';
import { requests,winsBeforeAuthority,workWins,finalBoundary,assertLocksHeld,faultBeforeCommit,
  barrier,bounded,type Reply } from './b17-domain-g1-races.ts';

const args=process.argv.slice(2);
if (!args.includes('--allow-disposable-b17') || existsSync('.env') || process.env.DATABASE_URL || process.env.JWT_SECRET
  || Object.keys(process.env).some(k => /^PG(HOST|PORT|USER|PASSWORD|DATABASE|SERVICE)/.test(k)))
  throw new Error('Explicit isolated opt-in required; ambient config refused');
const one=(key:string) => {
  const values=args.filter(a => a.startsWith(`--${key}=`));
  if (values.length!==1) throw new Error(`One explicit ${key} required`);
  return new URL(values[0].slice(key.length+3));
};
const url=one('database-url'),oracleUrl=one('oracle-url');
if (!['postgres:','postgresql:'].includes(url.protocol) || url.hostname!=='127.0.0.1'
  || !/^\/b17_u2g_g1_scratch_\d+_\d+$/.test(url.pathname) || !url.port || url.search || url.hash
  || url.username!=='b17domainowner') throw new Error('Only own named loopback scratch accepted');
if (oracleUrl.protocol!==url.protocol || oracleUrl.host!==url.host || oracleUrl.pathname!==url.pathname
  || oracleUrl.username!=='postgres' || oracleUrl.search || oracleUrl.hash) throw new Error('Oracle must be exact same scratch');
process.env.DATABASE_URL=url.toString();process.env.JWT_SECRET=randomBytes(48).toString('hex');
process.env.B17_SCRATCH_OPT_IN='YES';
const pool=getPool(),oracle=new pg.Client({connectionString:oracleUrl.toString()});
const pass=(label:string) => console.log(`PASS ${label}`);
type Cx={token:string;handle?:string;generation?:number;sid:string;user:string};
const tables=['clients','departments','users','client_services','assignments','answers','evaluations',
  'approvals','actions','esg_profile','report_settings','review_snapshots','snapshot_notes','staff_lists',
  'staff_list_rows','evidence_attachments','notifications','audit_log','services','standards','disclosures','items',
  'service_standards','item_links','initiatives_library','client_initiatives','service_initiatives'];
async function fingerprint(excluded:string[]=[]) {
  const hashes:Record<string,string>={};
  for (const table of tables.filter(t => !excluded.includes(t))) hashes[table]=(await oracle.query(
    `SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'')) h FROM ${table} t`)).rows[0].h;
  return hashes;
}
let server:ReturnType<express.Express['listen']>|undefined;
try {
  await oracle.connect();
  assert.deepEqual((await pool.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0],
    {rolsuper:false,rolbypassrls:false});
  assert.equal(Math.floor(Number((await pool.query('SHOW server_version_num')).rows[0].server_version_num)/10000),18);
  assert.equal((await pool.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n,0);
  assert.equal((await runMigrations()).success,true);
  const s=await seedG1(),t=s.tenants.A,d=s.departments.A;
  const migration=await pool.connect();
  try {
    assert.equal(await applyB17Offline(migration),'applied');
    const inventory=await inventoryB17ContentOffline(migration,s.targets,s.sources);
    assert.equal(await applyB17ContentOffline(migration,inventory,s.sources),'applied');
  } finally {migration.release();}
  await assertB17Ready();
  assert.equal((await pool.query(`SELECT count(*)::int n FROM pg_class WHERE relnamespace='public'::regnamespace
    AND relrowsecurity AND NOT relforcerowsecurity`)).rows[0].n,0);
  pass('OWN empty PG18; runtime NOSUPERUSER/NOBYPASSRLS; FORCE; offline fixture activation; readiness unchanged');
  const app=express();
  app.use((req,_res,next) => requests.run(String(req.headers['x-g1-case'] ?? ''),next));
  app.use(jsonInput);app.use(cookieParser());app.use('/api',api);app.use(globalJsonErrorHandler);
  server=app.listen(0,'127.0.0.1');await new Promise<void>(r => server!.once('listening',r));
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
  async function raw(cx:Cx|undefined,method:string,path:string,body?:unknown,label='',multipart=false):Promise<Reply> {
    const headers:Record<string,string>={'x-g1-case':label};
    if (cx) headers.Authorization=`Bearer ${cx.token}`;
    if (cx?.handle) {headers['X-Workspace-Tab']=cx.handle;headers['X-Workspace-Version']=String(cx.generation);}
    let payload:BodyInit|undefined;
    if (multipart) {const f=new FormData();f.append('file',new Blob(['G1'],{type:'text/plain'}),'g1.txt');payload=f;}
    else if (body!==undefined) {headers['Content-Type']='application/json';payload=JSON.stringify(body);}
    const r=await fetch(base+path,{method,headers,body:payload,signal:AbortSignal.timeout(15000)});
    const bytes=await r.arrayBuffer();let data:any;
    if (r.headers.get('content-type')?.includes('application/json')) data=JSON.parse(new TextDecoder().decode(bytes));
    else data={byteLength:bytes.byteLength};
    return {status:r.status,data};
  }
  const okay=(r:Reply,status=200) => {assert.equal(r.status,status);return r;};
  async function context(who:Case['who'],workTenant=t):Promise<Cx> {
    const name=who==='P'||who==='W'?'ge':who==='C'?'cA':'eA';
    const login=okay(await raw(undefined,'POST','/auth/login',{email:`${name}@domain-d.invalid`,password:s.password}));
    const cx:Cx={token:login.data.token,sid:verifyToken(login.data.token)!.sid,user:s.users[name]};
    if (who==='P'||who==='W') {
      const tab=okay(await raw(cx,'POST','/workspace/tab',{}),201).data;
      cx.handle=tab.tabHandle;cx.generation=tab.generation;
      if (who==='W') cx.generation=okay(await raw(cx,'POST','/workspace/enter',{clientId:workTenant})).data.generation;
    }
    return cx;
  }
  const action=(cx:Cx,label:string,title=label) => raw(cx,'POST','/actions',{title,departmentId:d,serviceId:s.services.GRI},label);
  const logout=async (cx:Cx) => {okay(await raw(cx,'POST','/auth/logout',{}));};
  const cases=siteCases(s),keys=new Set(cases.map(c => {
    const route=classifyRoute(c.method,c.path.split('?')[0]);assert.ok(route);return `${route.method} ${route.path}`;
  }));
  const expected=LEGACY_ROUTES.filter(r => !['system','session'].includes(r.capability)
    && !['/gri/preview','/gri/template'].includes(r.path)).map(r => `${r.method} ${r.path}`);
  assert.equal(expected.length,85);assert.deepEqual([...keys].sort(),expected.sort());
  let refused=0;
  // Every entry has a non-vacuous hook at its own final boundary, after all
  // middleware; valid shapes reach authority even if the resource later conflicts.
  for (const [i,c] of cases.entries()) {
    const cx=await context(c.who),label=`site-${i}`;
    const before=await fingerprint();
    const result=await winsBeforeAuthority(label,'session',
      () => raw(cx,c.method,c.path,c.body,label,c.multipart),() => logout(cx));
    assert.equal(result.status,401,`${c.method} ${c.path}: final authority refusal`);
    assert.equal(result.data.code,'auth.invalid');assert.deepEqual(await fingerprint(),before);
    refused++;
    console.log(`SITE ${i+1} ${c.who} ${c.method} ${c.path.split('?')[0]} 401; business/audit/fanout delta=0`);
  }
  pass(`${refused}/${cases.length} request variants, 85/85 data route keys: logout wins; full business fingerprints unchanged`);
  let readLocks=0;
  for (const [i,c] of cases.filter(c=>c.method==='GET').entries()) {
    const cx=await context(c.who),label=`read-scope-${i}`;
    let inspected=0;
    const result=await finalBoundary(label,(sql,_params,client)=>{
      if (sql==='COMMIT') return (async()=>{
        const tab=cx.handle?(await oracle.query('SELECT id FROM workspace_tabs WHERE handle_hash=$1',[hashTab(cx.handle)])).rows[0].id:undefined;
        await assertLocksHeld(oracle,client,cx.sid,tab);inspected++;
      })();
    },()=>raw(cx,c.method,c.path,c.body,label));
    assert.equal(result.status,200,`${c.path}: positive scoped read`);assert.equal(inspected,1);
    if (c.who!=='P') {
      const check=(value:any):void=>{
        if (!value || typeof value!=='object') return;
        if ('client_id' in value && value.client_id!=null) assert.equal(value.client_id,t);
        for (const child of Object.values(value)) check(child);
      };
      check(result.data);
    }
    readLocks++;
    console.log(`READ ${c.who} ${c.path.split('?')[0]} 200; live sid/tab NOWAIT observation before COMMIT`);
  }
  pass(`${readLocks}/${cases.filter(c=>c.method==='GET').length} read variants: positive scope + held authority (P usage zero-count limitation retained)`);
  const p=await context('P');
  for (const read of [false,true]) {
    const w=await context('W'),label=`R1-${read?'read':'write'}`,before=await fingerprint();
    const r=await winsBeforeAuthority(label,'tab',()=>read?raw(w,'GET','/actions',undefined,label):action(w,label),async()=>{
      okay(await raw(w,'POST','/workspace/exit',{}));
    });
    assert.equal(r.status,409);assert.equal(r.data.code,'workspace.stale');
    const after=await fingerprint();delete before.audit_log;delete after.audit_log;assert.deepEqual(after,before);
    const count=(await oracle.query('SELECT count(*)::int n FROM actions WHERE title=$1',[label])).rows[0].n;
    assert.equal(count,0);pass(label);
  }
  for (const target of [false,true]) {
    const cx=await context('P'),label=`R3-${target?'target':'global'}`;
    const route=target?`/clients/${t}`:'/services',body=target?{name:'MUST NOT LAND'}:{code:label,name:'MUST NOT LAND'};
    const before=await fingerprint();
    const r=await winsBeforeAuthority(label,'tab',()=>raw(cx,target?'PATCH':'POST',route,body,label),async()=>{
      okay(await raw(cx,'POST','/workspace/enter',{clientId:t}));
    });
    assert.equal(r.status,409);assert.equal(r.data.code,'workspace.stale');
    const after=await fingerprint();delete before.audit_log;delete after.audit_log;assert.deepEqual(after,before);pass(label);
  }
  for (const read of [false,true]) {
    const cx=await context('W'),label=`R2-${read?'read':'write'}`;
    const tabB=okay(await raw(cx,'POST','/workspace/tab',{}),201).data;
    const wB:Cx={...cx,handle:tabB.tabHandle,generation:tabB.generation};
    okay(await raw(wB,'POST','/workspace/enter',{clientId:s.tenants.B}));wB.generation=2;
    await workWins(label,oracle,()=>read?raw(cx,'GET','/actions',undefined,label):action(cx,label),
      ()=>raw(cx,'POST','/workspace/exit',{}),'FROM workspace_tabs',async()=>{
        const r=okay(await raw(wB,'POST','/actions',{title:`B-${label}`,departmentId:s.departments.B,serviceId:s.services.S2}),201);
        assert.equal(r.data.client_id,s.tenants.B);
      });
    assert.equal((await raw(cx,'GET','/actions')).status,409);
    if (!read) assert.equal((await oracle.query('SELECT count(*)::int n FROM actions WHERE title=$1',[label])).rows[0].n,1);
  }
  for (const read of [false,true]) {
    const cx=await context('W'),label=`R5-${read?'read':'write'}`;
    await workWins(label,oracle,()=>read?raw(cx,'GET','/actions',undefined,label):action(cx,label),
      ()=>raw(cx,'POST','/auth/logout',{}),'FROM auth_sessions');
    assert.equal((await raw(cx,'GET','/actions')).status,401);
  }
  // C/E deactivation winners + rollback/recovery, through the real P handler.
  for (const who of ['E','C'] as const) {
    const cx=await context(who),id=cx.user,label=`R6-${who}`;
    const work=()=>who==='E'?raw(cx,'POST','/evaluations',{itemId:s.items[0],score:50},label)
      :raw(cx,'POST','/staff-lists',{rows:[{email:'g1@g1.invalid',name:'G1',departmentId:d,role:'employee'}]},label);
    const before=await fingerprint(['users','audit_log']);
    const r=await winsBeforeAuthority(label,'session',work,async()=>{
      okay(await raw(p,'PATCH',`/users/${id}`,{clientId:t,isActive:false}));
    });
    assert.equal(r.status,401);assert.deepEqual(await fingerprint(['users','audit_log']),before);
    okay(await raw(p,'PATCH',`/users/${id}`,{clientId:t,isActive:true}));
    assert.equal((await raw(cx,'GET',who==='E'?'/queue':'/actions')).status,401);
    const fresh=await context(who);assert.equal((await raw(fresh,'GET',who==='E'?'/queue':'/actions')).status,200);pass(label);
  }
  for (const who of ['E','C'] as const) {
    const cx=await context(who),second=await context(who),label=`R7-${who}`;
    await workWins(label,oracle,()=>who==='E'?raw(cx,'POST','/evaluations',{itemId:s.items[1],score:50},label)
      :raw(cx,'POST','/staff-lists',{rows:[{email:'g1-r7@g1.invalid',name:'G1',departmentId:d,role:'employee'}]},label),
    ()=>raw(p,'PATCH',`/users/${cx.user}`,{clientId:t,isActive:false}),
    'SELECT sid FROM auth_sessions WHERE user_id = $1 ORDER BY sid FOR UPDATE');
    assert.equal((await raw(second,'GET',who==='E'?'/queue':'/actions')).status,401);
    okay(await raw(p,'PATCH',`/users/${cx.user}`,{clientId:t,isActive:true}));
  }
  const identityCases=[['role','client_admin'],['role','ge_admin'],['department_id',s.department2],
    ['client_id',s.tenants.B],['must_change_password',true]] as const;
  for (const [column,value] of identityCases) {
    const cx=await context('E'),label=`R8-${column}-${String(value).slice(0,5)}`;
    const before=await fingerprint(['users']);
    const r=await winsBeforeAuthority(label,'session',()=>raw(cx,'POST','/evaluations',{itemId:s.items[2],score:50},label),async()=>{
      if (column==='role' && value==='client_admin') await oracle.query('UPDATE users SET role=$1,department_id=NULL WHERE id=$2',[value,cx.user]);
      else if (column==='client_id') await oracle.query('UPDATE users SET client_id=$1,department_id=$2 WHERE id=$3',[value,s.departments.B,cx.user]);
      else await oracle.query(`UPDATE users SET ${column}=$1 WHERE id=$2`,[value,cx.user]);
    });
    assert.ok([400,403,409].includes(r.status),`${label} refused by current binding/matrix`);
    assert.deepEqual(await fingerprint(['users']),before);
    await oracle.query(`UPDATE users SET role='employee',client_id=$1,department_id=$2,must_change_password=false WHERE id=$3`,[t,d,cx.user]);
    pass(label);
  }
  {
    const cx=await context('C'),label='R8-suspension';
    const r=await winsBeforeAuthority(label,'session',()=>raw(cx,'GET','/actions',undefined,label),async()=>{
      okay(await raw(p,'PATCH',`/clients/${t}`,{suspended:true}));
    });
    assert.equal(r.status,403);assert.equal(r.data.code,'tenant.suspended');
    okay(await raw(p,'PATCH',`/clients/${t}`,{suspended:false}));pass(label);
  }
  const w=await context('W'),e=await context('E');
  // Independent NOWAIT observations at the actual post-authority business query.
  let inspected=0;
  okay(await finalBoundary('held',(sql,_params,client)=>{
    if (sql.includes('INSERT INTO actions')) return (async()=>{
      const tab=(await oracle.query('SELECT id FROM workspace_tabs WHERE handle_hash=$1',[hashTab(w.handle!)])).rows[0].id;
      await assertLocksHeld(oracle,client,w.sid,tab);inspected++;
    })();
  },()=>action(w,'held')),201);
  assert.equal(inspected,1);pass('real sid/tab locks held at business INSERT');
  for (const fragment of ['INSERT INTO audit_log','COMMIT']) {
    const label=`rollback-${fragment==='COMMIT'?'commit':'audit'}`,before=await fingerprint();
    await faultBeforeCommit(label,fragment,()=>action(w,label));assert.deepEqual(await fingerprint(),before);
    const retry=okay(await action(w,`${label}-retry`,label),201);assert.ok(retry.data.id);
    assert.equal((await oracle.query('SELECT count(*)::int n FROM actions WHERE title=$1',[label])).rows[0].n,1);pass(label);
  }
  // Conflict wire body cannot escape a delayed ROLLBACK; real handler, real DB.
  const saved=okay(await raw(e,'POST','/evaluations',{itemId:s.items[3],score:50}),201);
  for (const version of [undefined,0]) {
    const arrival=barrier(),resume=barrier();let responded=false;
    await finalBoundary('conflict',sql=>sql==='ROLLBACK'?(async()=>{arrival.resolve();await resume.promise;})():undefined,async()=>{
      const request=raw(e,'POST','/evaluations',{itemId:s.items[3],score:100,version},'conflict').then(r=>{responded=true;return r;});
      try {await bounded(arrival.promise,'conflict rollback');assert.equal(responded,false);} finally {resume.resolve();}
      const r=await request;assert.equal(r.status,version===undefined?400:409);
      assert.equal(r.data.code,version===undefined?'version.required':'version.conflict');assert.ok(r.data.conflict);
    });
  }
  assert.equal((await oracle.query('SELECT version FROM evaluations WHERE id=$1',[saved.data.evaluation.id])).rows[0].version,1);
  pass('conflict exact structured body deferred until real ROLLBACK, original pair unchanged');
  {
    const draft=okay(await raw(e,'POST','/evaluations',{itemId:s.items[4],score:50}),201);
    const before=await fingerprint();
    await faultBeforeCommit('notify-fault','INSERT INTO notifications',()=>raw(e,'POST',
      `/evaluations/${draft.data.evaluation.id}/submit`,{version:1},'notify-fault'));
    assert.deepEqual(await fingerprint(),before);
    okay(await raw(e,'POST',`/evaluations/${draft.data.evaluation.id}/submit`,{version:1}));
    assert.equal((await oracle.query('SELECT status FROM answers WHERE id=$1',[draft.data.answer.id])).rows[0].status,'submitted');
    pass('notification failure rolls back business/version/history/audit/inbox; positive explicit retry submits');
  }
  {
    const before=await fingerprint();
    await faultBeforeCommit('deactivate-fault','INSERT INTO audit_log',()=>raw(p,'PATCH',`/users/${e.user}`,
      {clientId:t,isActive:false},'deactivate-fault'));
    assert.deepEqual(await fingerprint(),before);
    okay(await raw(e,'GET','/queue'));pass('deactivation audit fault rolls back user + session/tab revocations; old sid remains live');
  }
  // Fresh upload positive after the delayed-upload revocation case above.
  const upload=okay(await raw(e,'POST',`/answers/${saved.data.answer.id}/attachments`,undefined,'upload-positive',true),201);
  assert.equal((await oracle.query('SELECT size_bytes FROM evidence_attachments WHERE id=$1',[upload.data.id])).rows[0].size_bytes,2);
  for (const output of ['download','OTP'] as const) {
    const label=`settle-${output}`,arrival=barrier(),resume=barrier();let responded=false;
    await finalBoundary(label,sql=>sql==='COMMIT'?(async()=>{arrival.resolve();await resume.promise;})():undefined,async()=>{
      const request=(output==='download'
        ?raw(e,'GET',`/answers/${saved.data.answer.id}/attachments/${upload.data.id}/download`,undefined,label)
        :raw(p,'POST',`/staff-lists/${s.list}/approve`,{clientId:t},label)).then(r=>{responded=true;return r;});
      try {await bounded(arrival.promise,label);assert.equal(responded,false);} finally {resume.resolve();}
      const r=okay(await request);
      if (output==='download') assert.equal(r.data.byteLength,2);
      else assert.equal(typeof r.data.accounts?.[0]?.oneTimePassword,'string');
    });
    pass(`${output}: response/bytes emitted only after actual COMMIT`);
  }
  const approvedAgain=await raw(p,'POST',`/staff-lists/${s.list}/approve`,{clientId:t});
  assert.equal(approvedAgain.status,409);assert.equal(approvedAgain.data.accounts,undefined);
  {
    const cx=await context('C'),label='R8-C-to-E';
    const r=await winsBeforeAuthority(label,'session',()=>raw(cx,'GET','/actions',undefined,label),async()=>{
      await oracle.query("UPDATE users SET role='employee',department_id=$1 WHERE id=$2",[d,cx.user]);
    });
    assert.equal(r.status,403);
    await oracle.query("UPDATE users SET role='client_admin',department_id=NULL WHERE id=$1",[cx.user]);pass(label);
  }
  // service_initiatives is introduced by content activation: prepare this
  // isolated eligibility fixture via its real P configuration API afterwards.
  okay(await raw(p,'PATCH',`/initiatives/${s.library}`,{serviceIds:[s.services.GRI]}));
  const positives=positiveWrites(s);
  const key=(c:Case)=>{const r=classifyRoute(c.method,c.path.split('?')[0])!;return `${r.method} ${r.path}`;};
  const writeKeys=[...new Set(cases.filter(c=>c.method!=='GET').map(key))].sort();
  assert.equal(writeKeys.length,52);assert.deepEqual(positives.map(key).sort(),writeKeys);
  let positiveCount=0;
  for (const [i,c] of positives.entries()) {
    const cx=await context(c.who,c.tenant ?? t),label=`positive-${i}`;
    const notification=c.path.startsWith('/notifications');
    const before=await fingerprint(notification?['audit_log']:['audit_log','notifications']);
    const auditBefore=Number((await oracle.query('SELECT count(*)::int n FROM audit_log')).rows[0].n);
    let held=0;
    const result=await finalBoundary(label,(sql,_params,client)=>{
      if (sql==='ROLLBACK') return Promise.resolve();
      if (sql==='COMMIT') return (async()=>{
        const tab=cx.handle?(await oracle.query('SELECT id FROM workspace_tabs WHERE handle_hash=$1',[hashTab(cx.handle)])).rows[0].id:undefined;
        await assertLocksHeld(oracle,client,cx.sid,tab);held++;
      })();
    },()=>raw(cx,c.method,c.path,c.body,label,c.multipart));
    assert.ok([200,201].includes(result.status),`${key(c)} positive status ${result.status}`);
    const servicePreread=c.method==='PATCH' && /^\/services\/[^/]+$/.test(c.path) && typeof (c.body as any)?.code==='string';
    assert.equal(held,servicePreread?2:1,`${key(c)}: each inventoried boundary holds authority through settlement`);
    assert.notDeepEqual(await fingerprint(notification?['audit_log']:['audit_log','notifications']),before,
      `${key(c)}: must change real business state, never an audit-only or zero-row no-op`);
    const auditAfter=Number((await oracle.query('SELECT count(*)::int n FROM audit_log')).rows[0].n);
    assert.equal(auditAfter-auditBefore,notification?0:1,`${key(c)}: exact intended audit delta`);
    positiveCount++;
    console.log(`WRITE ${key(c)} ${result.status}; actual business delta; audit +${auditAfter-auditBefore}; held sid/tab through COMMIT`);
  }
  console.log(`COVERAGE final-refusal variants=${refused}/${cases.length}; data-route keys=85/85; static sites=84/84;
positive write routes=${positiveCount}/52 (non-noop business fingerprint + exact audit delta + NOWAIT locks);
positive read variants=${readLocks}/35 (scope + NOWAIT locks); R1-R10 representative races/rollback/output gates above.
NOT VERIFIED: exhaustive route×role×lifecycle interleaving cross-product; real COMMIT network-uncertainty outcomes.
Full previous workflow/freeze/provisioning/workspace proofs remain separate: run --previous. Not independent acceptance.`);
} finally {
  if (server) await new Promise<void>((resolve,reject)=>server!.close(error=>error?reject(error):resolve()));
  await pool.end();await oracle.end();
}
