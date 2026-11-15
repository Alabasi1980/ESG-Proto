// Harness-memory interception of the FINAL business checkout, identified from
// its actual boundary call stack, never "the second session SELECT". All hooks
// are route/operation/client specific and restored in finally. No app hooks.
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';

export type Reply={status:number;data:any};
export const requests=new AsyncLocalStorage<string>();
export const barrier=() => {
  let resolve!:()=>void;const promise=new Promise<void>(r => {resolve=r;});
  return {promise,resolve};
};
export async function bounded<T>(promise:Promise<T>, label:string, ms=12000):Promise<T> {
  let timer:ReturnType<typeof setTimeout>|undefined;
  try { return await Promise.race([promise,new Promise<never>((_,reject) => {
    timer=setTimeout(() => reject(new Error(`Missing barrier/settlement: ${label}`)),ms);
  })]); } finally { clearTimeout(timer); }
}
type Hook=(sql:string,params:any[],client:pg.Client)=>Promise<void>|undefined;
export async function finalBoundary<T>(label:string,hook:Hook,operation:()=>Promise<T>):Promise<T> {
  const pp=pg.Pool.prototype as any,cp=pg.Client.prototype as any;
  const connect=pp.connect,query=cp.query;
  const clients=new WeakMap<object,string>();let intercepted=0;
  pp.connect=function(...args:any[]) {
    const stack=new Error().stack ?? '';
    const final=/\b(?:domainTransaction|configurationTransaction)\b/.test(stack);
    const name=requests.getStore();
    const result=connect.apply(this,args);
    if (final && name===label) return Promise.resolve(result).then((client:pg.Client) => {
      clients.set(client,label);return client;
    });
    return result;
  };
  cp.query=function(...args:any[]) {
    if (clients.get(this)===label && requests.getStore()===label && typeof args[0]==='string') {
      const wait=hook(args[0],Array.isArray(args[1])?args[1]:[],this);
      if (wait) { intercepted++;return wait.then(() => query.apply(this,args)); }
    }
    return query.apply(this,args);
  };
  try { const result=await operation();assert.ok(intercepted>0,`${label}: actual final boundary intercepted`);return result; }
  finally { pp.connect=connect;cp.query=query; }
}
export async function winsBeforeAuthority(label:string,phase:'session'|'tab',work:()=>Promise<Reply>,winner:()=>Promise<void>) {
  const arrived=barrier(),resume=barrier();let hits=0,task:Promise<Reply>|undefined;
  return finalBoundary(label,(sql) => {
    if ((phase==='session'?sql.includes('FROM auth_sessions'):sql.includes('FROM workspace_tabs')) && hits++===0)
      return (async () => {arrived.resolve();await resume.promise;})();
  },async () => {
    task=work();
    try {await bounded(arrived.promise,label);await bounded(winner(),`${label}: winner`);}
    finally {resume.resolve();}
    const result=await bounded(task,label);assert.equal(hits,1,`${label}: unique final authority hook`);
    return result;
  });
}
export async function waitForBlocked(oracle:pg.Client,fragment:string) {
  for (let i=0;i<400;i++) {
    await oracle.query('SELECT pg_stat_clear_snapshot()');
    const rows=(await oracle.query(`SELECT pid,pg_blocking_pids(pid) blockers FROM pg_stat_activity
      WHERE datname=current_database() AND usename='b17domainowner' AND state='active'
      AND wait_event_type='Lock' AND position($1 in query)>0`,[fragment])).rows;
    if (rows.some(r => r.blockers.length>0)) return;
    await new Promise(r => setTimeout(r,15));
  }
  assert.fail(`No actual blocked revoker observed: ${fragment}`);
}
export async function workWins(label:string,oracle:pg.Client,work:()=>Promise<Reply>,
  revoke:()=>Promise<Reply>,blockedSql:string,parallel?:()=>Promise<void>) {
  const arrived=barrier(),resume=barrier();let commits=0,workTask:Promise<Reply>|undefined,revokeTask:Promise<Reply>|undefined;
  return finalBoundary(label,sql => {
    if (sql==='COMMIT') { commits++;return (async()=>{arrived.resolve();await resume.promise;})(); }
  },async () => {
    workTask=work();let acknowledged=false;
    try {
      await bounded(arrived.promise,label);
      revokeTask=revoke().then(r => {acknowledged=true;return r;});
      await bounded(waitForBlocked(oracle,blockedSql),`${label}: actual lock`);
      assert.equal(acknowledged,false,`${label}: revoker cannot acknowledge before work settles`);
      if (parallel) await bounded(parallel(),`${label}: other tab`);
    } finally {resume.resolve();}
    const [worked,revoked]=await bounded(Promise.all([workTask,revokeTask!]),label);
    assert.ok(worked.status>=200 && worked.status<300,`${label}: real work succeeded (${worked.status})`);
    assert.equal(revoked.status,200);assert.equal(commits,1);
    console.log(`LOCK ${label}: revoker blocked; one work COMMIT; revocation settled`);
    return worked;
  });
}
export async function faultBeforeCommit(label:string,fragment:string,work:()=>Promise<Reply>) {
  let injected=0;
  const result=await finalBoundary(label,sql => {
    if (sql.includes(fragment)) { injected++;return Promise.reject(new Error('G1 injected pre-settlement fault')); }
  },work);
  assert.equal(injected,1);assert.equal(result.status,500);return result;
}
export async function assertLocksHeld(oracle:pg.Client,client:pg.Client,sid:string,tab?:string) {
  // Use the supplied exact-scratch oracle itself; NEVER infer a different DSN.
  for (const [sql,id] of [['SELECT sid FROM auth_sessions WHERE sid=$1 FOR UPDATE NOWAIT',sid],
    ...(tab ? [['SELECT id FROM workspace_tabs WHERE id=$1 FOR UPDATE NOWAIT',tab]]:[])]) {
    await oracle.query('BEGIN');
    try {await assert.rejects(oracle.query(sql,[id]),(e:any)=>e.code==='55P03');}
    finally {await oracle.query('ROLLBACK');}
  }
  assert.ok((client as any).processID>0);
}
