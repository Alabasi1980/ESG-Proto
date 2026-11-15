// Isolated sequencing tests exercise the real withSession + domain boundary.
// Only Pool.connect is substituted; no server/database or ambient credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { generateToken, type AuthenticatedRequest } from '../server/auth.ts';
import { domainTransaction, DeferredRefusal, deferredFailure } from '../server/routes/initiativeScope.ts';
import { readContext, platformConfigContext } from '../server/routes/_shared.ts';
import { LEGACY_ROUTES } from '../server/accessRegistry.ts';
import { TAB_IDLE_MS } from './capabilities.ts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const [actor,sid,tenant,dept,tabId,other] = [1,2,3,4,5,6].map(id);
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise,resolve };
};
test('G1 real boundary on fake checked-out client: live authority, context, parity and settlement', async t => {
  const priorSecret = process.env.JWT_SECRET, priorUrl = process.env.DATABASE_URL;
  process.env.JWT_SECRET = randomBytes(48).toString('hex');
  process.env.DATABASE_URL = 'postgres://unused@127.0.0.1:1/b17_unit_scratch';
  const original = pg.Pool.prototype.connect;
  let role = 'ge_admin', boundTenant: string | null = tenant, boundDept: string | null = dept;
  let revoked = false, active = true, password = false, suspended = false;
  let tab: any, clock = new Date(), sessionExpiry: Date;
  let checkouts = 0, released = 0, business = 0;
  let block: { sql: string; arrived: ReturnType<typeof gate>; proceed: ReturnType<typeof gate> } | undefined;
  const statements: string[] = [], settings = new Map<string,string>();
  const reset = () => {
    role = 'ge_admin'; boundTenant = tenant; boundDept = dept;
    revoked = false; active = true; password = false; suspended = false;
    clock = new Date(); sessionExpiry = new Date(Date.now()+3600000);
    tab = { id:tabId,mode:'consultant',client_id:tenant,generation:2,expires_at:new Date(Date.now()+600000) };
    checkouts = released = business = 0; statements.length = 0; settings.clear(); block = undefined;
  };
  const client = {
    async query(sql: string, params: any[] = []) {
      statements.push(sql);
      if (block && sql.includes(block.sql)) { block.arrived.resolve(); await block.proceed.promise; }
      let rows: any[] = [];
      if (sql === 'SELECT set_config($1, $2, true)') settings.set(params[0],params[1]);
      else if (sql.includes('FROM auth_sessions')) rows = revoked ? [] : [{ expires_at:sessionExpiry }];
      else if (sql.includes('FROM users WHERE id=$1')) rows = [{ id:actor,email:'unit@g1.invalid',name:'Unit',role,
        client_id:boundTenant,department_id:boundDept,is_active:active,must_change_password:password }];
      else if (sql.includes('FROM clients WHERE id=$1')) rows = [{ name:'Unit tenant',suspended }];
      else if (sql.includes('FROM departments WHERE id=$1')) rows = [{ name:'Unit department' }];
      else if (sql.includes('FROM workspace_tabs')) {
        assert.equal(params[1],sid); assert.equal(params[2],actor); rows = tab ? [tab] : [];
      } else if (sql === 'SELECT clock_timestamp() AS now') rows = [{ now:clock }];
      else if (sql.includes('UPDATE workspace_tabs')) assert.deepEqual(params,[tabId,sessionExpiry,TAB_IDLE_MS]);
      return { rows,rowCount:rows.length };
    },
    release() { released++; },
  };
  (pg.Pool.prototype as any).connect = async () => { checkouts++; return client; };
  const req = (path = '/services', method = 'GET', headers: Record<string,string> = {}): AuthenticatedRequest => {
    const token = generateToken({ id:actor,role:'employee',name:'stale',email:'stale@g1.invalid' },sid,sessionExpiry);
    const h: Record<string,string> = { authorization:`Bearer ${token}`,'x-workspace-tab':'a'.repeat(43),'x-workspace-version':'2',...headers };
    return { method,path,headers:h,get:(k:string) => h[k.toLowerCase()],
      user:{ id:other,role:'employee' },access:{ role:'employee',mode:'employee',tenantId:other,departmentId:other },
    } as unknown as AuthenticatedRequest;
  };
  const operation = async (c: pg.PoolClient) => { assert.equal(c,client); business++; return 'settled'; };
  const refusal = async (request: AuthenticatedRequest, code: string, selector?: any) => {
    await assert.rejects(domainTransaction(request,operation,selector), (e: any) => e.code === code);
    assert.equal(business,0); assert.equal(statements.at(-1),'ROLLBACK'); assert.equal(released,1);
  };
  try {
    await t.test('one checkout; session→user→tab→business→commit→release, work P exception', async () => {
      reset(); const r = req(); tab.mode='platform'; tab.client_id=null;
      await domainTransaction(r, async c => {
        assert.equal(r.user!.id,actor); assert.equal(r.access!.role,'ge_admin');
        assert.equal(settings.get('app.current_purpose'),'work');
        assert.equal(settings.get('app.current_tenant_id'),'');
        return operation(c);
      },readContext);
      assert.equal(checkouts,1); assert.equal(released,1); assert.equal(business,1);
      assert.equal(statements[0],'BEGIN'); assert.equal(statements.at(-1),'COMMIT');
      const at = (fragment: string) => statements.findIndex(sql => sql.includes(fragment));
      assert.ok(at('FROM auth_sessions') < at('FROM users'));
      assert.ok(at('FROM users') < at('FROM workspace_tabs'));
      assert.ok(at('FOR UPDATE') < at('UPDATE workspace_tabs'));
    });
    for (const liveRole of ['client_admin','employee']) await t.test(`stale GE becomes live ${liveRole}`, async () => {
      reset(); role=liveRole;
      const r = req(); r.access!.role='ge_admin';
      await domainTransaction(r,async c => {
        assert.equal(r.access!.tenantId,tenant); assert.equal(r.access!.departmentId,dept);
        assert.equal(r.access!.tabId,null); return operation(c);
      },readContext);
      assert.equal(statements.some(sql => sql.includes('FROM workspace_tabs')),false);
    });
    await t.test('stale lower role becomes GE: tab required, no employee fallback', async () => {
      reset(); await refusal(req('/services','GET',{'x-workspace-tab':''}),'workspace.invalid');
    });
    for (const code of ['auth.invalid','auth.password_change_required','tenant.suspended','auth.binding_invalid'])
      await t.test(code, async () => {
        reset(); role='employee';
        if (code === 'auth.invalid') revoked=true;
        if (code === 'auth.password_change_required') password=true;
        if (code === 'tenant.suspended') suspended=true;
        if (code === 'auth.binding_invalid') boundDept=null;
        await refusal(req(),code);
      });
    for (const bad of [undefined,'','-1','0','1.5','01','2147483648','2,2']) await t.test(`invalid generation ${bad}`, async () => {
      reset(); const r=req(); (r.headers as any)['x-workspace-version']=bad;
      await refusal(r,'workspace.version_required');
    });
    await t.test('stale generation', async () => { reset(); tab.generation=3; await refusal(req(),'workspace.stale'); });
    await t.test('missing tab row (bound lookup parameters checked)', async () => { reset(); tab=null; await refusal(req(),'workspace.invalid'); });
    await t.test('expiry after tab wait is refused', async () => { reset(); tab.expires_at=new Date(0); await refusal(req(),'workspace.invalid'); });
    await t.test('session expiry while queued at tab lock is rechecked', async () => {
      reset();const arrived=gate(),proceed=gate();block={sql:'FROM workspace_tabs',arrived,proceed};
      const work=refusal(req(),'auth.invalid');
      try {await arrived.promise;clock=new Date(Date.now()+7200000);} finally {proceed.resolve();}
      await work;
    });
    await t.test('unknown role closed by live user gate', async () => { reset(); role='other'; await refusal(req(),'auth.invalid'); });
    await t.test('wrong current mode denied before business', async () => { reset(); tab.mode='platform';tab.client_id=null;await refusal(req('/actions'),'workspace.mode_mismatch'); });
    await t.test('cookie-only mutation rejected without checkout', async () => {
      reset(); const r=req('/services','POST'); delete r.headers.authorization;
      await assert.rejects(domainTransaction(r,operation),/auth.invalid/); assert.equal(checkouts,0);
    });
    await t.test('unknown and unactivated routes refuse without checkout', async () => {
      reset(); await assert.rejects(domainTransaction(req('/unknown'),operation),/api.not_found/);
      const route=LEGACY_ROUTES.find(r => r.path==='/services' && r.method==='GET')!, prior=route.activation;
      try { route.activation='UNACTIVATED'; await assert.rejects(domainTransaction(req(),operation),/access.unactivated/); }
      finally { route.activation=prior; }
      assert.equal(checkouts,0);
    });
    await t.test('Auto null/config target and explicit T use live actor', async () => {
      for (const target of [undefined,null,other]) {
        reset();tab.mode='platform';tab.client_id=null;
        await domainTransaction(req('/services','POST'),async c => {
          assert.equal(settings.get('app.current_purpose'),'platform.config');
          assert.equal(settings.get('app.target_id'),target ?? ''); return operation(c);
        },target);
      }
    });
    await t.test('selector identity/purpose/target mismatches never broaden', async () => {
      for (const delta of [{ userId:other },{ role:'ge_admin',mode:'platform' },{ tenantId:other },
        { tabId:other },{ sessionId:other },{ departmentId:other },{ purpose:'auth.session' },{ targetId:other }]) {
        reset();role='employee';await refusal(req(),'scope.denied',(live:AuthenticatedRequest) => ({ ...readContext(live),...delta }));
      }
      reset();tab.mode='platform';tab.client_id=null;
      await refusal(req(),'scope.denied',(live:AuthenticatedRequest) => ({ ...platformConfigContext(live,tenant),tenantId:other }));
      reset();role='employee';
      await assert.rejects(domainTransaction(req(),operation,{} as never),/scope.denied/);
      assert.equal(checkouts,0);
    });
    for (const settlement of ['COMMIT','ROLLBACK']) await t.test(`output waits for ${settlement}`, async () => {
      reset(); role='employee'; const arrived=gate(), proceed=gate(); block={sql:settlement,arrived,proceed};
      let emitted=false;
      const body={ error:'version required',code:'version.required',conflict:{ attempted:{ score:50 } } };
      const work=domainTransaction(req(),async c => {
        await operation(c); if (settlement==='ROLLBACK') throw new DeferredRefusal(400,body); return body;
      },readContext).then(() => { emitted=true; },error => {
        deferredFailure({ status(n:number) { assert.equal(n,400);return this; },json(value:unknown) { assert.deepEqual(value,body);emitted=true; } } as never,error);
      });
      try { await arrived.promise; assert.equal(emitted,false); assert.equal(released,0); }
      finally { proceed.resolve(); await work; }
      assert.equal(emitted,true); assert.equal(released,1);
    });
    await t.test('audit failure rolls back, never commits; explicit retry remains possible', async () => {
      reset(); role='employee';
      await assert.rejects(domainTransaction(req(),async c => { await operation(c);throw new Error('audit fault'); },readContext),/audit fault/);
      assert.equal(statements.at(-1),'ROLLBACK');assert.ok(!statements.includes('COMMIT'));
      reset();role='employee';assert.equal(await domainTransaction(req(),operation,readContext),'settled');
    });
    await t.test('GE lock/refresh SQL matches withWorkspace and includes every validation code', () => {
      const source=readFileSync('src/server/routes/initiativeScope.ts','utf8');
      const workspace=readFileSync('src/server/access.ts','utf8').split('export async function withWorkspace')[1].split('// ---------------------------------------------------------------------------')[0];
      const normalize=(s:string) => s.replace(/\s+/g,' ').trim();
      for (const sql of workspace.matchAll(/`(SELECT id,mode[\s\S]*?|UPDATE workspace_tabs[\s\S]*?)`/g))
        assert.ok(normalize(source).includes(normalize(sql[1])), 'same locked read/idle refresh SQL');
      for (const code of ['workspace.invalid','workspace.version_required','workspace.stale','auth.invalid'])
        assert.ok(source.includes(`'${code}'`));
    });
  } finally {
    pg.Pool.prototype.connect=original;
    if (priorSecret===undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET=priorSecret;
    if (priorUrl===undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL=priorUrl;
  }
});
