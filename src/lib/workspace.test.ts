import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import express from 'express';
import { validGeneration } from './capabilities.ts';
import { generateToken, verifyToken, presentedToken, revokePresentedSession, type AuthenticatedRequest } from '../server/auth.ts';
import { hashTab, assertSameOrigin } from '../server/access.ts';
import api from '../server/routes.ts';
import { LEGACY_ROUTES } from '../server/accessRegistry.ts';
import { jsonInput } from '../server/jsonInput.ts';
import { globalJsonErrorHandler } from '../server/errorHandler.ts';
import { readFileSync } from 'node:fs';

test('B17 signed identity requires UUID sid; sid-less legacy JWTs require re-login', () => {
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  try {
    const user = { id:randomUUID(),email:'fixture@example.test',name:'Fixture',role:'ge_admin' as const };
    assert.equal(verifyToken(generateToken(user)),null);
    const sid = randomUUID();
    assert.deepEqual(verifyToken(generateToken(user,sid)),{ id:user.id,sid });
    assert.equal(verifyToken(generateToken(user,'forged')),null);
    assert.equal(verifyToken(generateToken(user,sid,new Date(Date.now()-10000))),null);
    assert.equal(verifyToken('forged'),null);
  } finally { if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET=previous; }
});
test('B17 opaque handles hash independently and versions reject non-positive/ambiguous inputs', () => {
  const a=randomBytes(32).toString('base64url'), b=randomBytes(32).toString('base64url');
  assert.equal(a.length,43); assert.match(hashTab(a),/^[a-f0-9]{64}$/);
  assert.notEqual(hashTab(a),hashTab(b)); assert.notEqual(hashTab(a),a);
  for (const value of [undefined,null,'','0','-1','1.0','01','1, 2','NaN','2147483648',[],1]) assert.equal(validGeneration(value),false);
  for (const value of ['1','2','2147483647']) assert.equal(validGeneration(value),true);
});
test('B17 malformed/duplicate bearer never falls back to cookie, and writes reject foreign origins', () => {
  const req = { headers:{authorization:'bad'},cookies:{token:'cookie'},rawHeaders:[] } as unknown as AuthenticatedRequest;
  assert.equal(presentedToken(req),undefined);
  req.headers.authorization='Bearer token'; req.rawHeaders=['Authorization','Bearer token','Authorization','Bearer other'];
  assert.equal(presentedToken(req),undefined);
  const origin = { method:'POST',protocol:'http',get:(key:string)=>({ host:'127.0.0.1',origin:'https://foreign.test' })[key] } as AuthenticatedRequest;
  assert.throws(()=>assertSameOrigin(origin));
});
test('SHIELD-U1-01: logout rejects malformed/forged/sid-less bearers before DB access, never using a valid cookie', async () => {
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  try {
    const user = { id:randomUUID(),email:'fixture@example.test',name:'Fixture',role:'ge_admin' as const };
    const valid = generateToken(user,randomUUID());
    const parts = valid.split('.');
    parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
    for (const authorization of ['bad','Bearer invalid',`Bearer ${parts.join('.')}`,`Bearer ${generateToken(user)}`]) {
      const req = { headers:{authorization},cookies:{token:valid},rawHeaders:[] } as unknown as AuthenticatedRequest;
      await assert.rejects(()=>revokePresentedSession(req),{statusCode:401,code:'auth.invalid'});
    }
    const duplicate = { headers:{authorization:`Bearer ${valid}`},cookies:{token:valid},
      rawHeaders:['Authorization',`Bearer ${valid}`,'Authorization',`Bearer ${valid}`] } as unknown as AuthenticatedRequest;
    await assert.rejects(()=>revokePresentedSession(duplicate),{statusCode:401,code:'auth.invalid'});
    delete process.env.JWT_SECRET;
    await assert.rejects(()=>revokePresentedSession({headers:{authorization:`Bearer ${valid}`},rawHeaders:[]} as unknown as AuthenticatedRequest),
      error => error instanceof Error && error.message.includes('JWT_SECRET') && !('statusCode' in error));
  } finally { if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET=previous; }
});
test('B17 actual mounted dispatcher denies every business operation, including legacy public GET and multipart preview', async () => {
  const app=express(); app.use(jsonInput); app.use('/api',api); app.use(globalJsonErrorHandler);
  const server=app.listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
  try {
    for (const route of LEGACY_ROUTES.filter(route=>route.activation==='UNACTIVATED')) {
      const response=await fetch(base+route.path.replace(/:[^/]+/g,randomUUID()),{method:route.method});
      assert.equal(response.status,403,`${route.method} ${route.path}`);
      assert.equal((await response.json()).code,'access.unactivated');
    }
    assert.equal((await fetch(base+'/unknown')).status,404);
    assert.equal((await fetch(base+'/db/migrate',{method:'POST'})).status,409);
  } finally { await new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve())); }
});
test('U1V production and PostgreSQL proof mount the shared JSON parser, never a synthetic duplicate check',()=>{
  for (const file of ['server.ts','scripts/b17-workspace-proof.ts']) {
    const source=readFileSync(file,'utf8');
    assert.match(source,/import \{ jsonInput \} from ['"].*server\/jsonInput\.ts['"]/);
    assert.ok(source.indexOf('app.use(jsonInput)')<source.indexOf("app.use('/api',"));
    assert.doesNotMatch(source,/express\.json\(/);
  }
});
