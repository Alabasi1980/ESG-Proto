import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { guardedScopeProofUrl,guardedScopeProofUrls } from '../../scripts/b17-scope-proof.ts';

test('U2D proof refuses absent opt-in, nonloopback/unnamed scratch, ambiguous URLs and ambient DSN',()=>{
  const url=`postgresql://fixture:${randomBytes(20).toString('hex')}@127.0.0.1:54321/b17_unit_scratch`;
  const args=['--allow-disposable-b17',`--database-url=${url}`];
  assert.equal(guardedScopeProofUrl(args,{}),url);
  assert.throws(()=>guardedScopeProofUrl(args.slice(1),{}),/opt_in_required/);
  for(const key of ['DATABASE_URL','PGHOST','PGPASSWORD','PGSERVICEFILE'])
    assert.throws(()=>guardedScopeProofUrl(args,{[key]:'ambient'}),/ambient_dsn_refused/);
  for(const bad of [url.replace('127.0.0.1','remote.invalid'),url.replace('127.0.0.1','127.0.0.1.remote.invalid'),
    url.replace('b17_unit_scratch','application'),url+'?host=remote.invalid',url+'#fragment',url.replace('fixture:','postgres:')])
    assert.throws(()=>guardedScopeProofUrl(['--allow-disposable-b17',`--database-url=${bad}`],{}));
  assert.throws(()=>guardedScopeProofUrl([...args,args[1]],{}));
  assert.throws(()=>guardedScopeProofUrl([...args,'--env=.env'],{}));
});
test('round-3 SQL principal proof requires a separate explicit login on the SAME guarded scratch DB',()=>{
  const trusted=`postgresql://fixture:${randomBytes(20).toString('hex')}@127.0.0.1:54321/b17_unit_scratch`;
  const untrusted=trusted.replace('fixture:','b17_untrusted:');
  const args=['--allow-disposable-b17',`--database-url=${trusted}`];
  assert.throws(()=>guardedScopeProofUrls(args,{}),/untrusted_url_required/);
  assert.deepEqual(guardedScopeProofUrls([...args,`--untrusted-database-url=${untrusted}`],{}),{trusted,untrusted});
  for(const bad of [trusted,untrusted.replace('54321','54322'),untrusted.replace('b17_unit_scratch','b17_other_scratch'),
    untrusted.replace('127.0.0.1','remote.invalid')])
    assert.throws(()=>guardedScopeProofUrls([...args,`--untrusted-database-url=${bad}`],{}));
  assert.throws(()=>guardedScopeProofUrls([...args,`--untrusted-database-url=${untrusted}`,`--untrusted-database-url=${untrusted}`],{}));
});
