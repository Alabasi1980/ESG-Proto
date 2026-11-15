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
  const base='048a6f254a75bbe86b8ad7fd48e46348a1c60e10'; // G2 base = G1 evidence checkpoint
  for (const file of ['src/db/index.ts','src/db/b17.sql','src/db/b17-content.sql',
    'src/server/auth.ts','src/server/access.ts','src/server/workspace.ts','src/server/routes.ts',
    'src/server/accessRegistry.ts','src/lib/capabilities.ts','src/server/routes/admin.ts','src/server/routes/_shared.ts']) {
    assert.equal(readFileSync(file,'utf8').replace(/\r\n/g,'\n'),
      execFileSync('git',['show',`${base}:${file}`],{encoding:'utf8'}).replace(/\r\n/g,'\n'),file);
  }
  // G2 §12(2): b17Readiness.ts is COMMENT-ONLY this round (any logic/constant
  // change would strand the content-version contract — see the E1-04 note in
  // that file). Strip full-line comments + blanks; the remaining code lines
  // must equal the G2 base byte-for-byte (string constants included).
  const codeOnly=(text:string) => text.split('\n').map(line => line.replace(/\r$/,''))
    .filter(line => line.trim()!=='' && !line.trim().startsWith('//'));
  assert.deepEqual(codeOnly(readFileSync('src/db/b17Readiness.ts','utf8')),
    codeOnly(execFileSync('git',['show',`${base}:src/db/b17Readiness.ts`],{encoding:'utf8'})),
    'b17Readiness.ts may change comments only (G2 E1-04)');
  assert.ok(readFileSync('src/server/routes/adminClients.ts','utf8').split('\n').length<=500);
  const newFiles=['scripts/b17-domain-g2-run.ts','scripts/b17-domain-g2-od10.ts',
    'scripts/b17-domain-g2-census.ts','scripts/b17-domain-g2-mask.ts'];
  const allowed=new Set(['src/server/taxonomy.ts',
    'src/server/routes/actions.ts','src/server/routes/audit.ts','src/server/routes/gri.ts',
    'src/server/routes/notifications.ts','src/server/routes/storage.ts','src/server/routes/evaluations.ts',
    'src/server/routes/reports.ts','src/server/routes/initiatives.ts',
    'src/lib/routeGates.test.ts','src/lib/b17TransactionInventory.test.ts','src/db/b17Readiness.ts',
    // D-H01-06 (2026-11-15, owner-authorized): theme-center track H02a/H02b — 8 paths only.
    'src/App.tsx','src/components/Header.tsx','src/components/Sidebar.tsx','src/index.css',
    'src/main.tsx','src/context/ThemeContext.tsx','src/styles/tokens.css','src/styles/themes.css',
    // D-H01-07 (2026-11-15, owner-authorized): view-migration batch H03 — 2 paths only.
    // Exact files named in TASK-PROTO-H03 — no globs, no implicit paths (LoginView + DemoBanner → tokens).
    'src/views/LoginView.tsx','src/components/DemoBanner.tsx',
    ...newFiles]);
  // G1 ruling 4 (§11): the TWO reviewer-owned report paths are excluded from
  // the executor-scope guard by exact path only — never a glob/loophole — so
  // append-rounds stay green without weakening the guard.
  const reviewerReports=new Set(['project-control/qa-reports/B17-U2G-QA.md',
    'security-reports/B17-U2G-fix-review.md']);
  const changed=[...execFileSync('git',['diff','--name-only','HEAD'],{encoding:'utf8'}).trim().split('\n'),
    ...execFileSync('git',['ls-files','--others','--exclude-standard'],{encoding:'utf8'}).trim().split('\n')]
    .filter(Boolean).map(file => file.trim()).filter(file => !reviewerReports.has(file));
  assert.equal(allowed.size,26); // 16 (G2 base) + 8 (D-H01-06 theme track) + 2 (D-H01-07 H03 views)
  for (const file of changed) assert.ok(allowed.has(file),`Unapproved write: ${file}`);
  for (const file of newFiles) assert.ok(readFileSync(file,'utf8').split('\n').length<=500,`${file}: new-file bound`);
});

// G2 OBS-3 (G1 Shield observation): the pre-lock authority-capture ring above
// only walks files whose transaction boundaries are domainTransaction sites —
// adminProvisioning's are configurationTransaction sites, so it was never
// scanned. Same rule, extended surface: every `const/let x = req.(access|user|`
// identity)` capture must sit INSIDE one of its three transactions.
test('G2 OBS-3: adminProvisioning authority captures stay inside configurationTransaction boundaries', () => {
  const raw=readFileSync(path.join(root,'routes/adminProvisioning.ts'),'utf8');
  const code=mask(raw);
  const sites=[...code.matchAll(/\bconfigurationTransaction\s*\(\s*req\s*,/g)].map(m => {
    const start=m.index!;let end=start+m[0].length,depth=1;
    for (;end<code.length && depth;end++) {
      if (code[end]==='(') depth++;else if (code[end]===')') depth--;
    }
    return {start,end};
  });
  assert.equal(sites.length,3,'the three provisioning transactions are the scanned surface');
  const captures=[...code.matchAll(/\b(?:const|let)\s+\w+\s*=\s*req\.(?:access|user|identity)\b/g)];
  assert.ok(captures.length>=1,'non-vacuity: the file carries an authority capture to check');
  for (const local of captures)
    assert.ok(sites.some(site => local.index!>site.start && local.index!<site.end),
      `adminProvisioning pre-lock authority capture at offset ${local.index} outside configurationTransaction`);
});
