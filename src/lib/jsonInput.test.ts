import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { gzipSync, deflateSync } from 'node:zlib';
import { jsonInput, JSON_BODY_LIMIT } from '../server/jsonInput.ts';
import { globalJsonErrorHandler } from '../server/errorHandler.ts';

async function harness(run: (send: (body: string | Buffer, headers?: Record<string,string>) => Promise<{
  status: number; body: any; type: string | null;
}>, state: { mode: string; clientId: string | null; generation: number; audit: unknown[]; calls: number }) => Promise<void>) {
  const state = {mode:'platform',clientId:null as string|null,generation:1,audit:[] as unknown[],calls:0};
  const app = express();
  app.use(jsonInput);
  app.post('/workspace/enter',(req,res)=>{
    state.calls++;
    state.mode='consultant'; state.clientId=req.body.clientId ?? null; state.generation++;
    state.audit.push({clientId:state.clientId,generation:state.generation});
    if (req.get('X-Inspect-Depth')==='yes') {
      let depth=0, value=req.body;
      while (Array.isArray(value)) { assert.equal(value.length,1); depth++; value=value[0]; }
      assert.deepEqual(value,{}); res.json({depth}); return;
    }
    res.json(req.body);
  });
  app.use(globalJsonErrorHandler);
  const server = app.listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>server.once('listening',resolve));
  try {
    await run(async(body,headers={})=>{
      const r=await fetch(`http://127.0.0.1:${(server.address() as {port:number}).port}/workspace/enter`,{
        method:'POST',headers:{'Content-Type':'application/json',...headers},body:typeof body==='string'?body:new Uint8Array(body),
      });
      return {status:r.status,body:await r.json(),type:r.headers.get('content-type')};
    },state);
  } finally { await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())); }
}

test('U1V shared parser refuses duplicate decoded keys at every object depth before state/audit changes', async t=>{
  const logs: unknown[][]=[];
  t.mock.method(console,'error',(...args: unknown[])=>logs.push(args));
  const cases = [
    '{"clientId":"A","clientId":"B"}',
    '{"clientId":"A","clientId":"A"}',
    String.raw`{"clientId":"A","\u0063lientId":"B"}`,
    String.raw`{"\u0063lientId":"A","client\u0049d":"B"}`,
    '{"clientId":"A","scope":{"serviceId":1,"serviceId":2}}',
    String.raw`{"scope":[{"a":[{}, {"clientId":1,"client\u0049d":2}]}]}`,
    '[{"a":1,"a":2}]',
    '{"":1,"":2}',
    '{"__proto__":1,"__proto__":2}',
    '{"constructor":1,"constructor":2}',
    String.raw`{"a/b":1,"a\/b":2}`,
    String.raw`{"a\"b":1,"a\u0022b":2}`,
    String.raw`{"a\\b":1,"a\u005cb":2}`,
    '{"😀":1,"\\ud83d\\ude00":2}',
    '{"اسم":1,"\\u0627سم":2}',
    String.raw`{"\ud800":1,"\uD800":2}`,
    '{"secret-body-marker":1,"secret-body-marker":2}',
  ];
  await harness(async(send,state)=>{
    for (const raw of cases) {
      const before=structuredClone(state);
      const response=await send(raw);
      assert.equal(response.status,400,raw);
      assert.deepEqual(response.body,{error:'Duplicate JSON object key',code:'json.duplicate_key'});
      assert.match(response.type!,/application\/json/);
      assert.deepEqual(state,before,'Rejected enter must not reach a handler or change state/audit');
    }
    const duplicate='{"clientId":"A","\\u0063lientId":"B"}';
    const le=Buffer.from('\ufeff'+duplicate,'utf16le');
    for (const [body,headers] of [[gzipSync(duplicate),{'Content-Encoding':'gzip'}],
      [deflateSync(duplicate),{'Content-Encoding':'deflate'}],
      [le,{'Content-Type':'application/json; charset=utf-16le'}],
      [Buffer.from(le).swap16(),{'Content-Type':'application/json; charset=utf-16be'}]] as const) {
      const before=structuredClone(state), response=await send(body,headers);
      assert.equal(response.status,400); assert.equal(response.body.code,'json.duplicate_key');
      assert.deepEqual(state,before);
    }
  });
  assert.ok(logs.length>=cases.length);
  assert.ok(!JSON.stringify(logs).includes('secret-body-marker'));
});

test('U1V valid JSON values, string escapes and independent key scopes retain native JSON semantics', async()=>{
  const cases = [
    '', '{}', '[]', ' \r\n\t { "clientId": "A", "scope": [true,false,null,{},[]] } \t',
    String.raw`{"clientId":"A","text":"} , \"clientId\": \"B\" { [ ] : , \\ \b \f \n \r \t \/ \u0000"}`,
    '{"same":{"key":1},"other":{"key":2},"list":[{"key":3},{"key":4}]}',
    String.raw`{"a\\b":1,"a/b":2,"a\"b":3,"😀":4,"\ud800":5,"é":6,"é":7}`,
    '{"__proto__":{"x":1},"constructor":2,"toString":3,"":4}',
    '{"n":[0,-0,1,-2,0.5,-0.5,1E+4,2e-3,1e400,12345678901234567890]}',
  ];
  await harness(async send=>{
    for (const raw of cases) {
      const response=await send(raw);
      assert.equal(response.status,200);
      // HTTP JSON serialization normalizes -0 and Infinity, exactly as with express.json.
      assert.deepEqual(response.body,JSON.parse(JSON.stringify(raw===''?{}:JSON.parse(raw))));
    }
    const deep=await send('['.repeat(15000)+'{}'+']'.repeat(15000),{'X-Inspect-Depth':'yes'});
    assert.equal(deep.status,200); assert.deepEqual(deep.body,{depth:15000});
    const raw='{"clientId":"A","text":"اسم 😀"}';
    const le=Buffer.from('\ufeff'+raw,'utf16le');
    for (const [body,charset] of [[le,'utf-16le'],[Buffer.from(le).swap16(),'utf-16be']] as const) {
      const response=await send(body,{'Content-Type':`application/json; charset=${charset}`});
      assert.equal(response.status,200); assert.deepEqual(response.body,JSON.parse(raw));
    }
    for (const [body,encoding] of [[gzipSync(raw),'gzip'],[deflateSync(raw),'deflate']] as const) {
      const response=await send(body,{'Content-Encoding':encoding});
      assert.equal(response.status,200); assert.deepEqual(response.body,JSON.parse(raw));
    }
  });
});

test('U1V malformed/strict-root JSON stays 400 JSON without body disclosure or state/audit changes', async t=>{
  const logs: unknown[][]=[];
  t.mock.method(console,'error',(...args: unknown[])=>logs.push(args));
  const cases=['{','[','{"a" 1}','{"a":}','{"a":1,}','[1,]','{"a":01}','{"a":-}',
    '{"a":1.}','{"a":1e+}','{"a":True}','{"a":undefined}','{}{}','[]null','true','null','42','"text"',' ',
    '{"a":"\\x00"}','{"a":"\\u123Z"}','{"a":"\\u12"}',
    '{"a":"raw\nnewline"}','{"a":"unterminated}','{"a":"slash\\',
    '{"secret-body-marker":invalid}', 'secret-body-marker'];
  await harness(async(send,state)=>{
    for (const raw of cases) {
      const before=structuredClone(state);
      const response=await send(raw);
      assert.equal(response.status,400,raw);
      assert.deepEqual(response.body,{error:'Malformed JSON'});
      assert.match(response.type!,/application\/json/);
      assert.deepEqual(state,before);
    }
  });
  assert.ok(!JSON.stringify(logs).includes('secret-body-marker'));
});

test('U1V JSON bound remains 10 MiB including inflated bodies; charset and content-type behavior stays closed', async t=>{
  t.mock.method(console,'error',()=>{});
  await harness(async(send,state)=>{
    const prefix='{"value":"',suffix='"}';
    const exact=prefix+'x'.repeat(JSON_BODY_LIMIT-prefix.length-suffix.length)+suffix;
    assert.equal(Buffer.byteLength(exact),JSON_BODY_LIMIT);
    assert.equal((await send(exact)).status,200);
    for (const [body,headers] of [[exact+' ',{}],[gzipSync(exact+' '),{'Content-Encoding':'gzip'}],
      ['{}',{'Content-Type':'application/json; charset=iso-8859-1'}]] as const) {
      const before=structuredClone(state);
      const response=await send(body,headers);
      assert.equal(response.status,typeof body==='string'&&body==='{}'?415:413);
      assert.equal(typeof response.body.error,'string');
      assert.deepEqual(state,before);
    }
    const response=await send('{"clientId":"A","clientId":"B"}',{'Content-Type':'text/plain'});
    assert.equal(response.status,200); assert.deepEqual(response.body,{}); // Not interpreted as JSON.
  });
});
