// G1 static reconciliation: 85 baseline sites -> 84 final sites. GET /clients'
// two historical branches now share ONE boundary, with the branch chosen live.
// These are source guards, not a claim of per-site HTTP/DB positive coverage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root=path.resolve('src/server');
const inventory: Record<string,[number,number]> = {
  'taxonomy.ts':[19,4], 'routes/gri.ts':[3,2], 'routes/evaluations.ts':[14,14],
  'routes/actions.ts':[3,3], 'routes/storage.ts':[5,5], 'routes/audit.ts':[1,1],
  'routes/notifications.ts':[4,4], 'routes/adminClients.ts':[8,0],
  'routes/adminDirectory.ts':[3,0], 'routes/adminAssignments.ts':[4,1],
  'routes/adminStaff.ts':[5,3], 'routes/adminPlatformOps.ts':[2,0],
  'routes/initiatives.ts':[5,0], 'routes/profileRoutes.ts':[2,0],
  'routes/reportSettings.ts':[2,0], 'routes/reports.ts':[1,0],
};
const mask=(s:string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g,
  text => text.replace(/[^\r\n]/g,' '));
function boundaries(src:string) {
  const code=mask(src);
  return [...code.matchAll(/\bdomainTransaction\s*\(/g)].map(m => {
    const start=m.index!;let end=start+m[0].length, depth=1;
    for (;end<code.length && depth;end++) {
      if (code[end]==='(') depth++;else if (code[end]===')') depth--;
    }
    return { start,end,text:src.slice(start,end),code:code.slice(start,end) };
  });
}
function corpus() {
  const result:Record<string,string>={};
  const walk=(dir:string) => {
    for (const entry of readdirSync(dir,{withFileTypes:true})) {
      const full=path.join(dir,entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) result[path.relative(root,full).split(path.sep).join('/')]=readFileSync(full,'utf8');
    }
  };
  walk(root);return result;
}
test('G1 every business call site is classified, explicit P-work exceptions retained', () => {
  let total=0,work=0;
  for (const [file,[count,workCount]] of Object.entries(inventory)) {
    const src=readFileSync(path.join(root,file),'utf8'), sites=boundaries(src);
    assert.equal(sites.length,count,file);
    const explicitWork=sites.filter(site => /,\s*readContext\s*\)$/.test(site.text));
    assert.equal(explicitWork.length,workCount,`${file}: explicit work context classification`);
    for (const site of sites) {
      assert.doesNotMatch(site.code,/\bres\s*\./,`${file}: response inside unsettled transaction`);
      assert.doesNotMatch(site.code.slice(site.code.indexOf('(')+1),/\b(?:withTenantContext|withSession|withWorkspace|deriveDomainAccess|getPool|assertB17Ready|domainTransaction)\s*\(/,
        `${file}: no nested lifecycle/pool/readiness boundary`);
    }
    // Snapshots of authority must be bound only within the final callback.
    for (const local of mask(src).matchAll(/\b(?:const|let)\s+\w+\s*=\s*req\.(?:access|user|identity)\b/g)) {
      assert.ok(sites.some(site => local.index!>site.start && local.index!<site.end),
        `${file}: pre-lock authority capture at offset ${local.index}`);
    }
    total+=sites.length;work+=explicitWork.length;
  }
  assert.equal(total,81);assert.equal(work,37);
  const provisioning=readFileSync(path.join(root,'routes/adminProvisioning.ts'),'utf8');
  assert.equal((provisioning.match(/await configurationTransaction\(req, target,/g) ?? []).length,3);
  assert.equal(total+3,84,'85 baseline sites minus merged GET clients branch');
  const clients=readFileSync(path.join(root,'routes/adminClients.ts'),'utf8');
  assert.match(boundaries(clients)[0].text,/live\.access!\.mode === 'platform' \? platformGlobalContext\(live\) : readContext\(live\)/);
  const directory=readFileSync(path.join(root,'routes/adminDirectory.ts'),'utf8');
  assert.match(boundaries(directory).at(-1)!.text,/target \? platformConfigContext\(live, target\) : readContext\(live\)/);
});

test('G1 no detached business roots, aliases or unclassified domain callers anywhere under server', () => {
  const detached:Record<string,number>={'auth.ts':2,'routes/session.ts':1,'routes/system.ts':2,'routes/_shared.ts':1};
  for (const [file,src] of Object.entries(corpus())) {
    const code=mask(src),calls=(code.match(/\bwithTenantContext\s*\(/g) ?? []).length;
    assert.equal(calls,detached[file] ?? 0,`${file}: detached roots`);
    assert.doesNotMatch(src,/\b(?:withTenantContext|domainTransaction|withSession|withWorkspace)\s+as\s+\w+/,
      `${file}: alias requires inventory classification`);
    if (!(file in inventory) && file!=='routes/initiativeScope.ts') assert.equal(boundaries(src).length,0,file);
    if (file!=='routes/system.ts') assert.doesNotMatch(code,/\b(?:pool|getPool\(\))\s*\.\s*(?:query|connect)\s*\(/,file);
  }
});

test('G1 pair refusals and every early response stay outside unsettled callbacks', () => {
  const evals=readFileSync(path.join(root,'routes/evaluations.ts'),'utf8');
  assert.doesNotMatch(evals,/__VERSION_CONFLICT_RESPONSE_SENT__|statusCode:\s*499/);
  const gate=evals.slice(evals.indexOf('async function enforcePairVersion'),evals.indexOf('/** B12 (S-23): item code'));
  assert.doesNotMatch(mask(gate),/\bres\b/);
  assert.equal((gate.match(/throw new DeferredRefusal/g) ?? []).length,2);
  assert.equal((evals.match(/await enforcePairVersion\(/g) ?? []).length,6);
  const provisioning=readFileSync(path.join(root,'routes/adminProvisioning.ts'),'utf8');
  assert.ok(provisioning.indexOf('validateNewUser(')>provisioning.indexOf('await configurationTransaction(req'));
  const deactivate=provisioning.slice(provisioning.indexOf('export async function deactivateUser'));
  assert.ok(deactivate.indexOf('targetId === req.access!.actorId')>deactivate.indexOf('await configurationTransaction(req'));
});

test('G1 protected policies, route keys, auth/lifecycle and capabilities are byte-unchanged', () => {
  const base='aa76695d1ea699aa0ba83a009507013e76e5265a';
  for (const file of ['src/db/index.ts','src/db/b17.sql','src/db/b17-content.sql',
    'src/server/auth.ts','src/server/access.ts','src/server/workspace.ts','src/server/routes.ts',
    'src/server/accessRegistry.ts','src/lib/capabilities.ts','src/server/routes/admin.ts','src/server/routes/_shared.ts']) {
    assert.equal(readFileSync(file,'utf8').replace(/\r\n/g,'\n'),
      execFileSync('git',['show',`${base}:${file}`],{encoding:'utf8'}).replace(/\r\n/g,'\n'),file);
  }
  assert.ok(readFileSync('src/server/routes/adminClients.ts','utf8').split('\n').length<=500);
  const newFiles=['src/lib/domainTransaction.test.ts','src/lib/b17TransactionInventory.test.ts',
    ...['run','proof','races','fixture'].map(name=>`scripts/b17-domain-g1-${name}.ts`)];
  const allowed=new Set([...Object.keys(inventory).filter(file=>file!=='routes/reports.ts').map(file=>`src/server/${file}`),
    'src/server/routes/initiativeScope.ts','src/server/routes/adminProvisioning.ts','src/lib/routeGates.test.ts',...newFiles]);
  const changed=[...execFileSync('git',['diff','--name-only','HEAD'],{encoding:'utf8'}).trim().split('\n'),
    ...execFileSync('git',['ls-files','--others','--exclude-standard'],{encoding:'utf8'}).trim().split('\n')].filter(Boolean);
  assert.equal(allowed.size,24);
  for (const file of changed) assert.ok(allowed.has(file.trim()),`Unapproved write: ${file}`);
  for (const file of newFiles) assert.ok(readFileSync(file,'utf8').split('\n').length<=500,`${file}: new-file bound`);
});
