// Explicit disposable PostgreSQL 18 only. No dotenv import, ambient DB URL or token fixtures.
// node --import tsx scripts/b17-workspace-proof.ts --allow-disposable-b17 --database-url=<loopback named b17_*scratch* DB>
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import express from 'express';
import cookieParser from 'cookie-parser';
import { getPool, runMigrations, withTenantContext } from '../src/db/index.ts';
import { applyB17Offline, assertB17Ready, b17Source, STRUCTURE_SQL, B17_SHAPE } from '../src/db/b17Readiness.ts';
import { hashPassword, generateToken, verifyToken, type AuthenticatedRequest } from '../src/server/auth.ts';
import { hashTab, withWorkspace } from '../src/server/access.ts';
import { transitionWorkspace } from '../src/server/workspace.ts';
import apiRouter from '../src/server/routes.ts';
import { LEGACY_ROUTES } from '../src/server/accessRegistry.ts';
import { jsonInput } from '../src/server/jsonInput.ts';
import { globalJsonErrorHandler } from '../src/server/errorHandler.ts';

function guardedUrl(args: string[]): string {
  if (!args.includes('--allow-disposable-b17')) throw new Error('Explicit disposable B17 opt-in required.');
  const urls = args.filter(arg => arg.startsWith('--database-url='));
  if (urls.length !== 1) throw new Error('One explicit scratch database URL required; ambient URL is ignored.');
  const url = new URL(urls[0].slice('--database-url='.length));
  if (!['postgres:','postgresql:'].includes(url.protocol) || !['127.0.0.1','localhost','[::1]'].includes(url.hostname)
    || !/^\/b17_[a-z0-9_]*scratch[a-z0-9_]*$/.test(url.pathname) || url.search || url.hash
    || !url.username || url.username === 'postgres') throw new Error('Only named disposable loopback B17 owner database accepted.');
  return url.toString();
}
const databaseUrl = guardedUrl(process.argv.slice(2));
process.env.DATABASE_URL = databaseUrl;
process.env.JWT_SECRET = randomBytes(48).toString('hex');
process.env.B17_SCRATCH_OPT_IN = 'YES';
const pass = (label: string) => console.log(`PASS ${label}`);
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const fake = (token: string, handle: string, generation: number): AuthenticatedRequest => ({
  method:'POST',headers:{ authorization:`Bearer ${token}` },rawHeaders:[],
  get:(key:string)=>({ 'x-workspace-tab':handle,'x-workspace-version':String(generation) })[key.toLowerCase()],
} as unknown as AuthenticatedRequest);

async function startupMustRefuse() {
  const child = spawn(process.execPath, ['--import','tsx','server.ts'], {
    env:{ ...process.env,NODE_ENV:'production' },stdio:['ignore','pipe','pipe'],
  });
  let output=''; child.stdout.on('data',b=>{ output+=b; }); child.stderr.on('data',b=>{ output+=b; });
  const timer=setTimeout(()=>child.kill(),15000);
  try {
    const code=await new Promise<number|null>((resolve,reject)=>{ child.once('error',reject); child.once('exit',resolve); });
    assert.equal(code,1); assert.doesNotMatch(output,/Full-stack ESG/); assert.match(output,/Fatal server startup/);
  } finally { clearTimeout(timer); }
}

async function successfulRestart(check?: (base:string)=>Promise<void>) {
  const child=spawn(process.execPath,['--import','tsx','server.ts'],{env:{...process.env,NODE_ENV:'production'},stdio:['ignore','pipe','pipe']});
  const timer=setTimeout(()=>child.kill(),15000);
  try {
    const base=await new Promise<string>((resolve,reject)=>{
      child.once('error',reject); child.once('exit',()=>reject(new Error('Ready startup failed before listening.')));
      child.stdout.on('data',chunk=>{ const url=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; if (url) resolve(url+'/api'); });
    });
    if (check) await check(base);
  } finally { clearTimeout(timer); child.kill(); await new Promise(resolve=>child.once('exit',resolve)); }
}
async function waitForBlockedBy(pid:number) {
  for (let attempt=0;attempt<100;attempt++) {
    const row=(await getPool().query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked',[pid])).rows[0];
    if (row.blocked) return;
    await pause(20);
  }
  assert.fail('Expected a real PostgreSQL lock waiter, not a timing-only race assertion.');
}
async function bootstrapOnly(password:string) {
  const c=await getPool().connect(); try { await applyB17Offline(c); } finally { c.release(); }
  const app=express(); app.use(jsonInput); app.use(cookieParser()); app.use('/api',apiRouter); app.use(globalJsonErrorHandler);
  const server=app.listen(0,'127.0.0.1'); await new Promise<void>(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
  const client=process.argv.includes('--client-bootstrap-only');
  try {
    const create=()=>fetch(base+'/setup/admin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      email:'bootstrap@b17.invalid',name:'Bootstrap fixture',password,...(client?{clientName:'Fixture company',clientCode:'FIXTURE'}:{}),
    })});
    const responses=await Promise.all([create(),create()]);
    assert.deepEqual(responses.map(r=>r.status).sort(),[200,403]);
    const result=await responses.find(r=>r.status===200)!.json();
    assert.equal(result.user.role,client?'client_admin':'ge_admin'); assert.ok(verifyToken(result.token)?.sid);
    const me=await fetch(base+'/auth/me',{headers:{Authorization:`Bearer ${result.token}`}});
    assert.equal(me.status,200); assert.equal((await me.json()).user.id,result.user.id);
    const count=await withTenantContext({purpose:'auth.setup'},async db=>(await db.query('SELECT count(*)::int n FROM users')).rows[0].n);
    assert.equal(count,1); await assertB17Ready();
    pass(`once-only concurrent ${client?'client':'GE'} bootstrap preserves contract and creates a live sid without HTTP DDL`);
  } finally { await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve())); }
}

async function main() {
  const pool=getPool();
  const role=(await pool.query(`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`)).rows[0];
  assert.equal(role.rolsuper,false); assert.equal(role.rolbypassrls,false);
  assert.equal(Math.floor(Number((await pool.query('SHOW server_version_num')).rows[0].server_version_num)/10000),18);
  assert.equal((await pool.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'")).rows[0].n,0,
    'Scratch must start empty; never reset or replay an existing application DB.');
  assert.equal((await runMigrations()).success,true);
  await assert.rejects(assertB17Ready); await startupMustRefuse();
  pass('missing activation refuses actual startup before listening');
  const password=`Aa1!${randomBytes(20).toString('hex')}`;
  if (process.argv.includes('--bootstrap-only') || process.argv.includes('--client-bootstrap-only')) { await bootstrapOnly(password); return; }
  const seed=await withTenantContext({ role:'ge_admin' },async c=>{
    const tenants:string[]=[], departments:string[][]=[];
    for (const name of ['A','B','unrelated']) {
      const id=(await c.query('INSERT INTO clients(code,name) VALUES($1,$1) RETURNING id',[`B17-${name}`])).rows[0].id;
      tenants.push(id); const ds:string[]=[];
      for (const code of ['one','two']) ds.push((await c.query('INSERT INTO departments(client_id,code,name) VALUES($1,$2,$2) RETURNING id',[id,code])).rows[0].id);
      departments.push(ds);
    }
    const mk=async (name:string,role:string,tenant:string|null=null,department:string|null=null)=>(await c.query(
      'INSERT INTO users(email,password_hash,name,role,client_id,department_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id',
      [`${name}@b17.invalid`,await hashPassword(password),name,role,tenant,department])).rows[0].id as string;
    const ge=await mk('ge','ge_admin'), other=await mk('other','ge_admin');
    const ca=await mk('client','client_admin',tenants[0]);
    const ea=await mk('employee','employee',tenants[0],departments[0][0]);
    const ea2=await mk('employee2','employee',tenants[0],departments[0][1]);
    const eb=await mk('employeeB','employee',tenants[1],departments[1][0]);
    const standard=(await c.query("INSERT INTO standards(code,title,category) VALUES('B17','Fixture','Universal') RETURNING id")).rows[0].id;
    const disclosure=(await c.query("INSERT INTO disclosures(standard_id,code,title) VALUES($1,'B17','Fixture') RETURNING id",[standard])).rows[0].id;
    const item=(await c.query("INSERT INTO items(disclosure_id,code,requirement,priority,esg_class) VALUES($1,'B17','Fixture','high','governance') RETURNING id",[disclosure])).rows[0].id;
    for (const [t,d,u] of [[tenants[0],departments[0][0],ea],[tenants[0],departments[0][1],ea2],[tenants[1],departments[1][0],eb]]) {
      await c.query('INSERT INTO assignments(client_id,item_id,department_id) VALUES($1,$2,$3)',[t,item,d]);
      await c.query("INSERT INTO answers(client_id,item_id,department_id,submitted_by,status,value) VALUES($1,$2,$3,$4,'draft','preserve me')",[t,item,d,u]);
    }
    const service=(await c.query("SELECT id FROM services WHERE code='GRI'")).rows[0].id;
    await c.query('INSERT INTO client_services(client_id,service_id,show_gap,show_corrective) VALUES($1,$3,true,false),($2,$3,false,true)',[tenants[0],tenants[1],service]);
    await c.query('DELETE FROM client_services WHERE client_id=$1',[tenants[0]]);
    const links=(await c.query('SELECT * FROM client_services ORDER BY id')).rows;
    const answers=(await c.query('SELECT * FROM answers ORDER BY id')).rows;
    return { tenants,departments,ge,other,ca,ea,links,answers };
  });
  const admin=await pool.connect();
  try {
    await admin.query('CREATE POLICY unexpected ON clients FOR SELECT USING(true)');
    await assert.rejects(()=>applyB17Offline(admin),/predecessor_drift/);
    assert.equal((await admin.query("SELECT to_regclass('public.auth_sessions') AS t")).rows[0].t,null);
    await admin.query('DROP POLICY unexpected ON clients');
    // Real post-DDL fault: every security table/policy and ledger must roll back, not partially activate.
    await admin.query('BEGIN');
    await admin.query("SELECT set_config('app.b17_checksum',$1,true)",[b17Source().checksum]);
    await admin.query(b17Source().sql);
    await assert.rejects(()=>admin.query('SELECT 1/0'));
    await admin.query('ROLLBACK');
    assert.equal((await admin.query("SELECT to_regclass('public.app_schema_versions') AS t")).rows[0].t,null);
    assert.equal(await applyB17Offline(admin),'applied');
    assert.equal(await applyB17Offline(admin),'verified');
  } finally { admin.release(); }
  await assertB17Ready(); pass('strict predecessor, transactional failure, ledger-last activation and identical-version no-op');
  assert.equal((await pool.query(`SELECT bool_and(pg_get_userbyid(c.relowner)=current_user AND c.relrowsecurity
    AND c.relforcerowsecurity) AS safe FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r'`)).rows[0].safe,true);
  const app=express(); app.use(jsonInput); app.use(cookieParser()); app.use('/api',apiRouter); app.use(globalJsonErrorHandler);
  const server=app.listen(0,'127.0.0.1'); await new Promise<void>(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
  assert.equal(new URL(base).hostname,'127.0.0.1');
  const api=async(method:string,path:string,token?:string,body?:unknown,tab?:{tabHandle:string;generation:number},extra:Record<string,string>={},raw?:string)=>{
    const response=await fetch(base+path,{method,headers:{ ...(token?{Authorization:`Bearer ${token}`} : {}),
      ...(body!==undefined||raw!==undefined?{'Content-Type':'application/json'}:{}),
      ...(tab?{'X-Workspace-Tab':tab.tabHandle,'X-Workspace-Version':String(tab.generation)}:{}),...extra },
    body:raw??(body===undefined?undefined:JSON.stringify(body)) });
    return {status:response.status,json:await response.json(),cookie:response.headers.get('set-cookie')};
  };
  const login=async(name:string)=>{
    const r=await api('POST','/auth/login',undefined,{email:`${name}@b17.invalid`,password});
    assert.equal(r.status,200,`${name} login`); assert.ok(r.json.token);
    assert.match(r.cookie??'',/HttpOnly/); assert.match(r.cookie??'',/SameSite=Strict/); return r.json.token as string;
  };
  const tab=async(token:string)=>{
    const r=await api('POST','/workspace/tab',token,{}); assert.equal(r.status,201,JSON.stringify(r.json));
    assert.equal(r.json.generation,1); assert.equal(r.json.mode,'platform'); assert.equal(r.json.client,null); return r.json;
  };
  const context=(tenantId:string,departmentId:string|null=null,role='ge_admin',userId=seed.ge)=>({
    tenantId,departmentId,role,userId,mode:role==='employee'?'employee':'consultant',purpose:'work',
  });
  try {
    const ge=await login('ge'), ge2=await login('ge'), other=await login('other');
    const ca=await login('client'), employee=await login('employee');
    assert.equal((await api('POST','/auth/login',undefined,{email:'ge@b17.invalid',password:'wrong'})).status,401);
    assert.equal((await api('GET','/auth/me',generateToken({id:seed.ge,email:'',name:'',role:'ge_admin'}))).status,401);
    assert.equal((await api('POST','/workspace/tab',ca,{})).status,403);
    assert.equal((await api('POST','/workspace/tab',employee,{})).status,403);
    const t=await tab(ge), independent=await tab(ge);
    const unchanged=async()=>({
      tabs:await withTenantContext({purpose:'workspace',userId:seed.ge,sessionId:verifyToken(ge)!.sid},
        async c=>(await c.query('SELECT * FROM workspace_tabs ORDER BY id')).rows),
      audit:await Promise.all(seed.tenants.map(tenant=>withTenantContext(context(tenant),
        async c=>(await c.query('SELECT * FROM audit_log ORDER BY id')).rows))),
    });
    const duplicateBodies=[
      `{"clientId":"${seed.tenants[0]}","clientId":"${seed.tenants[1]}"}`,
      `{"clientId":"${seed.tenants[0]}","clientId":"${seed.tenants[0]}"}`,
      `{"clientId":"${seed.tenants[0]}","\\u0063lientId":"${seed.tenants[1]}"}`,
      `{"clientId":"${seed.tenants[0]}","scope":{"serviceId":1,"service\\u0049d":2}}`,
      `{"clientId":"${seed.tenants[0]}","scope":[{"nested":{"x":1,"\\u0078":2}}]}`,
    ];
    const rejectDuplicates=async(send:(raw:string)=>Promise<{status:number;json:any}>)=>{
      for (const raw of duplicateBodies) {
        const before=await unchanged(), refused=await send(raw);
        assert.equal(refused.status,400); assert.equal(refused.json.code,'json.duplicate_key');
        assert.deepEqual(await unchanged(),before,'Duplicate enter must preserve every tab field and all tenant audit rows');
      }
    };
    await rejectDuplicates(raw=>api('POST','/workspace/enter',ge,undefined,t,{},raw));
    await successfulRestart(async actualBase=>{
      await rejectDuplicates(async raw=>{
        const r=await fetch(actualBase+'/workspace/enter',{method:'POST',headers:{'Content-Type':'application/json',
          Authorization:`Bearer ${ge}`,'X-Workspace-Tab':t.tabHandle,'X-Workspace-Version':String(t.generation)},body:raw});
        return {status:r.status,json:await r.json()};
      });
    });
    pass('U1V raw duplicate/escaped/nested keys: shared-parser harness AND actual server return 400 with unchanged workspace/audit');
    assert.equal((await api('GET','/workspace',ge)).status,409);
    assert.equal((await api('GET','/workspace',ge,undefined,{...t,tabHandle:randomBytes(32).toString('base64url')})).status,409);
    assert.equal((await api('GET','/workspace',ge2,undefined,t)).status,409);
    assert.equal((await api('GET','/workspace',other,undefined,t)).status,409);
    assert.equal((await api('POST','/workspace/enter',ge,{clientId:seed.tenants[0]}, {...t,generation:-1})).status,400);
    assert.equal((await api('POST','/workspace/enter',ge,{clientId:seed.tenants[0]},t,{'X-Workspace-Version':''})).status,400);
    assert.equal((await api('POST','/workspace/enter',ge,{clientId:seed.tenants[0]},t,{Origin:'https://foreign.invalid'})).status,403);
    assert.equal((await api('POST','/workspace/enter',undefined,{clientId:seed.tenants[0]},t,{Cookie:`token=${ge}`})).status,401);
    assert.equal((await api('POST','/workspace/enter',ge,{clientId:[seed.tenants[0],seed.tenants[1]]},t)).status,400);
    assert.equal((await api('POST','/workspace/enter',ge,{clientId:randomUUID()},t)).status,404);
    const entered=await api('POST','/workspace/enter',ge,{clientId:seed.tenants[0]},t);
    assert.equal(entered.status,200,JSON.stringify(entered.json)); assert.equal(entered.json.generation,2);
    assert.equal(entered.json.client.id,seed.tenants[0]); assert.equal(entered.json.mode,'consultant');
    assert.equal((await api('POST','/workspace/exit',ge,{},t)).status,409);
    t.generation=2;
    assert.equal((await api('POST','/workspace/enter',ge,{clientId:seed.tenants[1]},t)).status,409);
    assert.equal((await api('GET','/workspace',ge,undefined,independent)).json.mode,'platform');
    const audit=await withTenantContext(context(seed.tenants[0]),async c=>(await c.query("SELECT user_id,client_id,payload FROM audit_log WHERE action='WORKSPACE_ENTER'")).rows);
    assert.equal(audit.length,1); assert.equal(audit[0].user_id,seed.ge); assert.equal(audit[0].payload.generation,2);
    assert.equal(audit[0].payload.sessionId,verifyToken(ge)!.sid); assert.ok(!JSON.stringify(audit).includes(t.tabHandle));
    assert.equal((await api('GET','/auth/me',ge)).json.user.role,'ge_admin');
    pass('real login, opaque hashed tab binding, actual GE audit, A entry, parallel P, invalid context/origin/version refusals');

    // Transition waits for a previously accepted transaction using the SAME session/tab locks.
    let release!:()=>void, locked!:()=>void, holder=0;
    const gate=new Promise<void>(resolve=>{release=resolve;}); const acquired=new Promise<void>(resolve=>{locked=resolve;});
    const held=withWorkspace(fake(ge,t.tabHandle,2),'workspace.read',async c=>{holder=(await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;locked();await gate;});
    await acquired; let exited=false;
    const exit=api('POST','/workspace/exit',ge,{},t).then(r=>{exited=true;return r;});
    try { await waitForBlockedBy(holder); assert.equal(exited,false); } finally { release(); }
    await held; const exitResult=await exit; assert.equal(exitResult.status,200); assert.equal(exitResult.json.generation,3);
    t.generation=3;
    assert.equal((await api('POST','/workspace/exit',ge,{},t)).json.generation,3);
    const switched=await api('POST','/workspace/enter',ge,{clientId:seed.tenants[1]},t);
    assert.equal(switched.status,200); assert.equal(switched.json.generation,4); t.generation=4;
    assert.equal(switched.json.client.id,seed.tenants[1]);
    const separate=await api('POST','/workspace/enter',ge,{clientId:seed.tenants[0]},independent);
    assert.equal(separate.status,200); independent.generation=2;
    assert.equal((await api('GET','/workspace',ge,undefined,independent)).json.client.id,seed.tenants[0]);
    assert.equal((await api('GET','/workspace',ge,undefined,t)).json.client.id,seed.tenants[1]);
    assert.equal((await api('GET','/workspace',ge,undefined,t,{'X-Workspace-Version':'999'})).json.generation,4);
    const exits=await withTenantContext(context(seed.tenants[0]),async c=>(await c.query("SELECT user_id,payload FROM audit_log WHERE action='WORKSPACE_EXIT'")).rows);
    assert.equal(exits.length,1); assert.equal(exits[0].user_id,seed.ge);
    pass('A→exit→P→B, explicit switch, idempotent exit, reconciliation, earlier transaction linearization');

    const faultTab=await tab(ge);
    await pool.query("ALTER TABLE audit_log ADD CONSTRAINT b17_proof_audit_failure CHECK(action<>'WORKSPACE_ENTER') NOT VALID");
    try {
      await assert.rejects(()=>withWorkspace(fake(ge,faultTab.tabHandle,1),'workspace.enter',
        (c,i,w)=>transitionWorkspace(c,i,w,seed.tenants[0])),/b17_proof_audit_failure/);
    } finally { await pool.query('ALTER TABLE audit_log DROP CONSTRAINT b17_proof_audit_failure'); }
    const afterFault=await api('GET','/workspace',ge,undefined,faultTab);
    assert.equal(afterFault.status,200); assert.equal(afterFault.json.generation,1); assert.equal(afterFault.json.mode,'platform');
    pass('real PostgreSQL audit failure rolls back transition; fault injection uses the lifecycle helper, not an HTTP success substitute');

    const capped=await Promise.all(Array.from({length:25},()=>api('POST','/workspace/tab',ge2,{})));
    assert.equal(capped.filter(r=>r.status===201).length,20); assert.equal(capped.filter(r=>r.status===429).length,5);
    for (const r of capped.filter(r=>r.status===429)) assert.equal(r.json.code,'workspace.limit');
    pass('concurrent issuance serializes to exactly 20 active tabs, no eviction');
    for (const [token,workspace] of [[undefined,t],[ge,t],[ge,faultTab],[ca,t],[employee,t]] as const) {
      for (const route of LEGACY_ROUTES.filter(r=>r.activation==='UNACTIVATED')) {
        const r=await api(route.method,route.path.replace(/:[^/]+/g,randomUUID()),token,undefined,workspace);
        assert.equal(r.status,403,`${route.method} ${route.path}`); assert.equal(r.json.code,'access.unactivated');
      }
    }
    const stillUnactivated = LEGACY_ROUTES.filter(r=>r.activation==='UNACTIVATED').length;
    pass(`all ${stillUnactivated} remaining unactivated business declarations denied across anonymous/platform/consultant/client/employee`);

    for (const tenantId of seed.tenants) {
      await withTenantContext(context(tenantId),async c=>{
        assert.deepEqual((await c.query('SELECT id FROM clients')).rows.map(r=>r.id),[tenantId]);
        assert.equal((await c.query('UPDATE clients SET name=name WHERE id=$1',[seed.tenants[tenantId===seed.tenants[0]?1:0]])).rowCount,0);
      });
    }
    await withTenantContext(context(seed.tenants[0],seed.departments[0][0],'employee',seed.ea),async c=>{
      const rows=(await c.query('SELECT department_id FROM answers')).rows;
      assert.equal(rows.length,1); assert.equal(rows[0].department_id,seed.departments[0][0]);
    });
    for (const ctx of [{},{role:'ge_admin'},{role:'ge_admin',mode:'consultant',userId:seed.ge},
      {role:'ge_admin',mode:'consultant',userId:seed.ge,tenantId:seed.tenants[0],purpose:null},
      {role:'ge_admin',mode:'platform',userId:seed.ge,purpose:'work',tenantId:seed.tenants[0]}]) {
      await withTenantContext(ctx,async c=>{
        assert.equal((await c.query('SELECT * FROM clients')).rows.length,0);
        assert.equal((await c.query('SELECT * FROM answers')).rows.length,0);
      });
    }
    const links=(await Promise.all(seed.tenants.map(tid=>withTenantContext(context(tid),async c=>(await c.query('SELECT * FROM client_services')).rows)))).flat();
    assert.deepEqual(links,seed.links);
    const answers=(await Promise.all(seed.tenants.map(tid=>withTenantContext(context(tid),async c=>(await c.query('SELECT * FROM answers')).rows)))).flat().sort((a,b)=>a.id.localeCompare(b.id));
    assert.deepEqual(answers,seed.answers);
    assert.equal((await pool.query('SELECT * FROM clients')).rows.length,0);
    pass('non-bypass table-owner FORCE RLS A/B/empty/null-purpose/platform/employee contexts; business rows and removed/unrelated memberships preserved');

    const sessionState=async(token:string)=>{
      const claims=verifyToken(token)!;
      return withTenantContext({purpose:'auth.logout',userId:claims.id,sessionId:claims.sid},async c=>({
        session:(await c.query('SELECT revoked_at FROM auth_sessions WHERE sid=$1',[claims.sid])).rows[0],
        tabs:(await c.query('SELECT revoked_at FROM workspace_tabs WHERE session_id=$1',[claims.sid])).rows,
      }));
    };
    const invalidations=[
      {name:'employee',id:seed.ea,client:seed.tenants[0],department:null,repairDepartment:seed.departments[0][0],tabs:false},
      {name:'employee',id:seed.ea,client:seed.tenants[1],department:seed.departments[0][0],repairDepartment:seed.departments[0][0],tabs:false},
      {name:'other',id:seed.other,client:null,department:seed.departments[0][0],repairDepartment:null,tabs:true},
    ];
    for (const invalid of invalidations) {
      const bearer=await login(invalid.name), ownedTab=invalid.tabs?await tab(bearer):null;
      const setBinding=(clientId:string|null,departmentId:string|null)=>withTenantContext({purpose:'auth.password',userId:invalid.id},
        c=>c.query('UPDATE users SET client_id=$2,department_id=$3 WHERE id=$1',[invalid.id,clientId,departmentId]));
      const before=await sessionState(bearer); assert.equal(before.session.revoked_at,null);
      if (ownedTab) { assert.equal(before.tabs.length,1); assert.equal(before.tabs[0].revoked_at,null); }
      await setBinding(invalid.client,invalid.department);
      const unusable=await api('GET','/auth/me',bearer);
      assert.equal(unusable.status,401); assert.equal(unusable.json.code,'auth.binding_invalid');
      assert.equal((await api('POST','/auth/logout',bearer,{})).status,200);
      const revoked=await sessionState(bearer); assert.ok(revoked.session.revoked_at);
      if (ownedTab) { assert.equal(revoked.tabs.length,1); assert.ok(revoked.tabs[0].revoked_at); }
      await setBinding(invalid.name==='employee'?seed.tenants[0]:null,invalid.repairDepartment);
      assert.equal((await api('GET','/auth/me',bearer)).status,401);
      if (ownedTab) assert.equal((await api('GET','/workspace',bearer,undefined,ownedTab)).status,401);
      assert.equal((await api('POST','/auth/logout',bearer,{})).status,200);
      assert.deepEqual(await sessionState(bearer),revoked);
    }
    assert.equal((await api('GET','/auth/me',employee)).status,200);
    assert.equal((await api('GET','/auth/me',other)).status,200);
    pass('SHIELD-U1-01: invalid department/company→logout→repair still rejects old bearer, persists sid/tab revocation, leaves other sessions usable');

    const malformed=['Bearer invalid',`Bearer ${generateToken({id:seed.other,email:'',name:'',role:'ge_admin'})}`];
    const forged=other.split('.'); forged[2]=(forged[2][0]==='A'?'B':'A')+forged[2].slice(1); malformed.push(`Bearer ${forged.join('.')}`);
    for (const authorization of malformed) {
      const refused=await api('POST','/auth/logout',undefined,{},undefined,{Authorization:authorization,Cookie:`token=${other}`});
      assert.equal(refused.status,401); assert.equal(refused.cookie,null);
    }
    assert.equal((await api('POST','/auth/logout',other,{},undefined,{Origin:'https://foreign.invalid'})).status,403);
    assert.equal((await api('POST','/auth/logout',undefined,{},undefined,{Cookie:`token=${other}`})).status,403);
    assert.equal((await sessionState(other)).session.revoked_at,null);
    assert.equal((await api('POST','/auth/logout')).status,200);
    pass('logout malformed/forged/sid-less bearer and foreign-origin/cookie-only refusals; credential-free idempotency');

    // Fault an actual HTTP revocation with a PostgreSQL lock timeout, without schema drift or mocks.
    const timeoutToken=await login('other'), timeoutTab=await tab(timeoutToken), timeoutClaims=verifyToken(timeoutToken)!;
    const setLockTimeout=async(value:string)=>{
      const clients=await Promise.all(Array.from({length:5},()=>pool.connect()));
      try { await Promise.all(clients.map(c=>c.query("SELECT set_config('lock_timeout',$1,false)",[value]))); }
      finally { clients.forEach(c=>c.release()); }
    };
    let unlock!:()=>void, announce!:()=>void;
    const lockedSession=new Promise<void>(resolve=>{announce=resolve;}), timeoutGate=new Promise<void>(resolve=>{unlock=resolve;});
    await setLockTimeout('200ms');
    const heldSession=withTenantContext({purpose:'auth.logout',userId:timeoutClaims.id,sessionId:timeoutClaims.sid},async c=>{
      await c.query('SELECT sid FROM auth_sessions WHERE sid=$1 FOR UPDATE',[timeoutClaims.sid]); announce(); await timeoutGate;
    });
    try {
      await lockedSession;
      const failedLogout=await api('POST','/auth/logout',timeoutToken,{});
      assert.equal(failedLogout.status,503); assert.equal(failedLogout.json.code,'access.unavailable'); assert.equal(failedLogout.cookie,null);
    } finally { unlock(); await heldSession; await setLockTimeout('0'); }
    const afterFailure=await sessionState(timeoutToken);
    assert.equal(afterFailure.session.revoked_at,null); assert.equal(afterFailure.tabs[0].revoked_at,null);
    assert.equal((await api('GET','/workspace',timeoutToken,undefined,timeoutTab)).status,200);
    assert.equal((await api('POST','/auth/logout',timeoutToken,{})).status,200);
    assert.ok((await sessionState(timeoutToken)).session.revoked_at);
    pass('real HTTP backend lock failure is not logout success, rolls back, preserves cookie/session, and allows explicit retry');

    await withTenantContext({purpose:'auth.password',userId:seed.ea},c=>c.query('UPDATE users SET department_id=$2 WHERE id=$1',[seed.ea,seed.departments[0][1]]));
    assert.equal((await api('GET','/auth/me',employee)).json.user.departmentId,seed.departments[0][1]);
    const expired=await login('other');
    await tab(expired);
    await withTenantContext({purpose:'auth.logout',userId:seed.other,sessionId:verifyToken(expired)!.sid},c=>c.query(
      "UPDATE auth_sessions SET created_at=clock_timestamp()-interval '1 hour',expires_at=clock_timestamp()-interval '1 second' WHERE sid=$1",[verifyToken(expired)!.sid]));
    assert.equal((await api('GET','/auth/me',expired)).status,401);
    const expiredBearer=generateToken({id:seed.other,email:'',name:'',role:'ge_admin'},verifyToken(expired)!.sid,new Date(Date.now()-10000));
    assert.equal(verifyToken(expiredBearer),null);
    assert.equal((await api('POST','/auth/logout',expiredBearer,{})).status,200);
    const expiredRevoked=await sessionState(expired);
    assert.ok(expiredRevoked.session.revoked_at); assert.equal(expiredRevoked.tabs.length,1); assert.ok(expiredRevoked.tabs[0].revoked_at);
    assert.equal((await api('POST','/auth/logout',expiredBearer,{})).status,200);
    assert.deepEqual(await sessionState(expired),expiredRevoked);
    const capTab=capped.find(r=>r.status===201)!.json;
    let release2!:()=>void, acquired2!:()=>void;
    const gate2=new Promise<void>(resolve=>{release2=resolve;}), ready2=new Promise<void>(resolve=>{acquired2=resolve;});
    const heldForLogout=withWorkspace(fake(ge2,capTab.tabHandle,1),'workspace.read',async c=>{
      holder=(await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;acquired2();await gate2;
    });
    await ready2; const logout=api('POST','/auth/logout',ge2,{});
    try { await waitForBlockedBy(holder); } finally { release2(); }
    await heldForLogout; assert.equal((await logout).status,200);
    assert.equal((await api('GET','/workspace',ge2,undefined,capTab)).status,401);
    pass('current department reload, DB-expired sid and logout/session lock race');

    const mutateUser=async(sql:string,values:unknown[])=>withTenantContext({purpose:'auth.password',userId:seed.ge},c=>c.query(sql,values));
    await mutateUser('UPDATE users SET must_change_password=true WHERE id=$1',[seed.ge]);
    assert.equal((await api('POST','/workspace/tab',ge,{})).status,403);
    assert.equal((await api('GET','/auth/me',ge)).json.user.mustChangePassword,true);
    assert.equal((await api('POST','/workspace/exit',ge,{},t)).status,200); t.generation=5;
    assert.equal((await api('POST','/auth/change-password',ge,{currentPassword:'wrong',newPassword:password})).status,400);
    assert.equal((await api('POST','/auth/change-password',ge,{currentPassword:password,newPassword:password})).status,200);
    const expiring=await tab(ge);
    await withTenantContext({purpose:'workspace',userId:seed.ge,sessionId:verifyToken(ge)!.sid},async c=>{
      await c.query("UPDATE workspace_tabs SET created_at=clock_timestamp()-interval '1 hour',expires_at=clock_timestamp()-interval '1 second' WHERE handle_hash=$1",[hashTab(expiring.tabHandle)]);
    });
    assert.equal((await api('GET','/workspace',ge,undefined,expiring)).status,409);
    assert.equal((await api('POST','/auth/logout',ge,{})).status,200);
    assert.equal((await api('GET','/auth/me',ge)).status,401);
    assert.equal((await api('GET','/workspace',ge,undefined,t)).status,401);
    const fresh=await login('ge'); await tab(fresh);
    let release3!:()=>void, acquired3!:()=>void;
    const gate3=new Promise<void>(resolve=>{release3=resolve;}), ready3=new Promise<void>(resolve=>{acquired3=resolve;});
    const live=await tab(fresh);
    const activeRead=withWorkspace(fake(fresh,live.tabHandle,1),'workspace.read',async c=>{
      holder=(await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;acquired3();await gate3;
    });
    await ready3; const deactivating=mutateUser('UPDATE users SET is_active=false WHERE id=$1',[seed.ge]);
    try { await waitForBlockedBy(holder); } finally { release3(); }
    await activeRead; await deactivating;
    assert.equal((await api('GET','/auth/me',fresh)).status,401);
    const revoked=await withTenantContext({purpose:'auth.revoke',userId:seed.ge},async c=>({
      sessions:(await c.query('SELECT revoked_at FROM auth_sessions')).rows,
      tabs:(await c.query('SELECT revoked_at FROM workspace_tabs')).rows,
    }));
    assert.ok(revoked.sessions.every(r=>r.revoked_at)); assert.ok(revoked.tabs.every(r=>r.revoked_at));
    pass('forced-password remediation/cleanup, expiry, logout and persisted deactivation revocation');

    assert.equal((await api('POST','/setup/admin',undefined,{email:'no@b17.invalid',password,name:'No'})).status,403);
    assert.equal((await api('POST','/db/migrate')).status,409);
    assert.deepEqual((await api('GET','/db/status')).json,{configured:true,connected:true});
    assert.deepEqual((await api('GET','/setup/status')).json,{canSetup:false,needsMigration:false});
    assert.equal((await runMigrations()).success,false);
    await assert.rejects(()=>pool.query(readFileSync('src/db/schema.sql','utf8')),/schema.empty_install_only/);
    assert.equal((await pool.query(STRUCTURE_SQL)).rows[0].checksum,B17_SHAPE);
    await pool.query('CREATE POLICY b17_proof_drift ON clients FOR SELECT USING(true)');
    try {
      await assert.rejects(assertB17Ready,/schema_drift/); await startupMustRefuse();
      assert.equal((await api('GET','/auth/me',other)).status,503);
    } finally { await pool.query('DROP POLICY b17_proof_drift ON clients'); }
    const ledger=await pool.connect();
    try { await ledger.query('BEGIN'); await ledger.query('ALTER TABLE app_schema_versions RENAME TO b17_hidden_version');
      await ledger.query('COMMIT'); await assert.rejects(assertB17Ready); }
    finally { await ledger.query('ALTER TABLE b17_hidden_version RENAME TO app_schema_versions'); ledger.release(); }
    await assertB17Ready(); await successfulRestart(); await assertB17Ready();
    const finalLinks=(await Promise.all(seed.tenants.map(tid=>withTenantContext(context(tid),async c=>(await c.query('SELECT * FROM client_services')).rows)))).flat();
    assert.deepEqual(finalLinks,seed.links);
    pass('rejected bootstrap/offline HTTP, old schema/initializer refusal, actual startup drift refusal, missing-version refusal, read-only restart readiness/no regrant');
    console.log('B17_U1 isolated HTTP/RLS proof complete. No legacy business activation or release acceptance.');
  } finally { await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve())); }
}
main().catch(err=>{ console.error('B17_U1 proof FAILED:',err instanceof Error?err.message:'unknown'); process.exitCode=1; })
  .finally(async()=>{ await getPool().end(); });
