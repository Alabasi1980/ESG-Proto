// G1 static reconciliation: 85 baseline sites -> 84 final sites. GET /clients'
// two historical branches now share ONE boundary, with the branch chosen live.
// These are source guards, not a claim of per-site HTTP/DB positive coverage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root=path.resolve('src/server');
const inventory: Record<string,[number,number]> = {
  'taxonomy.ts':[19,4], 'routes/gri.ts':[3,2], 'routes/evaluations.ts':[14,14],
  'routes/actions.ts':[3,3], 'routes/storage.ts':[5,5], 'routes/audit.ts':[1,1],
  'routes/notifications.ts':[4,4], 'routes/adminClients.ts':[8,0],
  'routes/adminDirectory.ts':[3,0], 'routes/adminAssignments.ts':[4,1],
  'routes/adminStaff.ts':[5,3], 'routes/adminPlatformOps.ts':[2,0],
  'routes/initiatives.ts':[5,0], 'routes/profileRoutes.ts':[2,0],
  'routes/reportSettings.ts':[2,0], 'routes/reports.ts':[1,0],
  // TASK-PROTO-H13: the two P-only settings declarations (GET + PUT), both on
  // the standard wrapper with an explicit platform-configuration selector and no
  // readContext work fallback.
  'routes/settings.ts':[2,0],
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
  assert.equal(total,83);assert.equal(work,37);
  const provisioning=readFileSync(path.join(root,'routes/adminProvisioning.ts'),'utf8');
  assert.equal((provisioning.match(/await configurationTransaction\(req, target,/g) ?? []).length,3);
  assert.equal(total+3,86,'85 baseline sites minus merged GET clients branch, plus the two H13 settings rows');
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
  // H13 (TASK-PROTO-H13): routes.ts and accessRegistry.ts leave the byte-compare
  // inventory for the same reason auth.ts did in H12 — they now carry the two
  // approved settings declarations — and join it as exact POST-H13 sha256 pins.
  // Every other listed file must still be byte-identical to the G2 base.
  for (const file of ['src/db/index.ts','src/db/b17.sql',
    'src/server/access.ts','src/server/workspace.ts','src/lib/capabilities.ts',
    'src/server/routes/admin.ts','src/server/routes/_shared.ts']) {
    assert.equal(readFileSync(file,'utf8').replace(/\r\n/g,'\n'),
      execFileSync('git',['show',`${base}:${file}`],{encoding:'utf8'}).replace(/\r\n/g,'\n'),file);
  }
  // SHIELD-H12-01 (re-measured by H13): auth.ts POST-H12 barrier — sha256 measured
  // over LF-normalized bytes (same normalization as the byte-compare above, so a
  // CRLF checkout cannot move the pin). Any auth.ts change must move this constant
  // in the same approved edit; an unexplained mismatch is a real drift alarm.
  // H13 adds the global app theme resolution (app_settings read + precedence),
  // and moves routes.ts / accessRegistry.ts out of the byte-freeze inventory for
  // the same reason (settings mount + the two P-only declarations).
  // TASK-PROTO-H13 round 2 (QAF-02): b17-content.sql is re-frozen as a WHOLE-FILE
  // sha256 over LF-normalized bytes (CRLF→LF — the exact normalization the
  // *Source() helpers apply before executing the file, so a CRLF checkout cannot
  // move the pin). It leaves the G2 byte-compare above because H13 legitimately
  // appends two reviewed hunks (the APP_THEME_UPDATED audit action and the
  // app_settings policy re-assert); their semantics are asserted in
  // src/lib/appTheme.test.ts, and ANY future change to this file — including a
  // third hunk — must move this constant deliberately under an approved task.
  const h13AuthSha256='5848271d5e7f8fefb56424d10993fb5d56b38bf583a6ccf590b1ea857c978dde';
  const h13RoutesSha256='07449bdde26497b457d268702a564b4222be429d3a51f4f713a4dfa929324129';
  const h13AccessRegistrySha256='8f829377f4c42120f5201b3ff94f687e867034f755dbe4ba7f9be182488d0f86';
  const h13ContentSha256='dd9d580d428f8c4a476ef66518c469683c2279222e291a6256c6516100501ccc';
  const postH12Pins: Record<string,string> = {
    'src/server/auth.ts': h13AuthSha256,
    'src/server/routes.ts': h13RoutesSha256,
    'src/server/accessRegistry.ts': h13AccessRegistrySha256,
    'src/db/b17-content.sql': h13ContentSha256,
  };
  for (const [file,pin] of Object.entries(postH12Pins)) {
    assert.equal(createHash('sha256')
      .update(readFileSync(file,'utf8').replace(/\r\n/g,'\n'),'utf8')
      .digest('hex'),pin,
    `${file} drifted from its deliberate, task-approved POST-H12/H13 bytes (SHIELD-H12-01 pin)`);
  }
  // G2 §12(2): b17Readiness.ts was COMMENT-ONLY in G2; H12 moved the three
  // STRUCTURE_SQL constants (clients.theme) and H13 round 2 adds the narrow
  // ownership defense (SHIELD-H13-02) — a deliberate, reviewed code change. It is
  // therefore re-frozen as a WHOLE-FILE sha256 over LF-normalized bytes (CRLF→LF,
  // the same normalization as the pins above, so a CRLF checkout cannot move it).
  // Lossless replacement for the old "code lines must equal the G2 base" diff:
  // any further change — code OR constant — must update this pin deliberately.
  const h13ReadinessSha256='01b3ab8c70545201cc492a3e6577a3946492812a721f07fe38f995750ff407e9';
  assert.equal(createHash('sha256')
    .update(readFileSync('src/db/b17Readiness.ts','utf8').replace(/\r\n/g,'\n'),'utf8')
    .digest('hex'),h13ReadinessSha256,
  'b17Readiness.ts drifted from its deliberate, task-approved POST-H13-r2 bytes (constants + SHIELD-H13-02)');
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
    // D-H01-07 standing authority — TASK-PROTO-H10a/H10b view batch: 4 exact paths (named, no globs).
    'src/views/DashboardView.tsx','src/views/ClientDashboardView.tsx',
    'src/views/GeOverviewView.tsx','src/views/EsgProfileView.tsx',
    // D-H01-07 standing authority — TASK-PROTO-H10-3 view batch (+ H10-3): 3 missing
    // paths only; GeOverviewView/EsgProfileView were already named above (no duplicates).
    'src/views/SettingsView.tsx','src/views/StaffListsView.tsx','src/views/ServicesManage.tsx',
    // D-H01-07 standing authority — TASK-PROTO-H11 view batch (H11a guard + H11b): 3 missing
    // paths only; no duplicates with the batches named above.
    'src/views/GapAnalysisView.tsx','src/views/StandardsView.tsx','src/views/InitiativesView.tsx',
    // D-H01-07 standing authority — TASK-PROTO-H12 P1/P2 view batch (Gap Analysis + Standards
    // wrappers named by that task): 4 missing paths only; no duplicates with the batches above.
    'src/views/EvaluationPanel.tsx','src/views/ClientReviewView.tsx',
    'src/views/GeFinalView.tsx','src/views/TaxonomyManage.tsx',
    // D-H01-07 standing authority — TASK-PROTO-H13 P3 view batch (P3a + P3b): 4 missing
    // paths only; Actions/Notifications (P3a) and Reports/AuditLog (P3b) — no duplicates.
    'src/views/ActionsView.tsx','src/views/NotificationsView.tsx',
    'src/views/ReportsView.tsx','src/views/AuditLogView.tsx',
    // D-H01-07 standing authority — TASK-PROTO-H14 P4/P5 view batch (P4 + P5): 3 missing
    // paths only; ClientDetailView/SetupView (P4) and ImportGRIView (P5) — no duplicates.
    'src/views/ClientDetailView.tsx','src/views/SetupView.tsx','src/views/ImportGRIView.tsx',
    // D-H01-01 (TASK-PROTO-H12): server-owned tenant theme — 6 exact paths only
    // (schema column, session broadcast, the single P writer, the context type,
    // and the new no-DB test). App.tsx/main.tsx/ThemeContext.tsx/b17Readiness.ts
    // were already named above.
    'src/db/schema.sql','src/server/auth.ts','src/server/routes/session.ts',
    'src/server/routes/adminClients.ts','src/context/AuthContext.tsx','src/lib/themeSession.test.ts',
    // H13 (TASK-PROTO-H13): 5 exact paths only — the new P-only settings router,
    // its no-DB test, the two census-pin test files the flip updates, and the
    // own-scratch measurement/proof script. schema.sql/auth.ts/session.ts/routes.ts/
    // accessRegistry.ts/App.tsx/SettingsView.tsx/SetupView.tsx/b17Readiness.ts are
    // already named above; b17-content.sql is named below (policy substrate).
    'src/server/routes/settings.ts','src/lib/appTheme.test.ts',
    'src/lib/capabilities.test.ts','src/lib/domainAccess.test.ts',
    'scripts/h13-app-theme-scratch.ts',
    // Tera-authorized by H13 item 1: the AR/EN copy for the new section.
    'src/i18n/translations.ts',
    // H13: the settings row in the mounted coverage assertion + the two P-only
    // declarations (both leave the byte-freeze inventory for the sha256 pins above).
    'src/server/routes.ts','src/server/accessRegistry.ts',
    // H13 (Tera-authorized second append): the audit action allowlist + the
    // app_settings policy re-assert, and only those two hunks.
    'src/db/b17-content.sql',
    ...newFiles,
    // Owner-authorized persistent shared-DB infra (showcase script + container/DB) — exact path only.
    'scripts/b17-showcase.ts',
    // ISS-006 (Tera-approved micro-task): the public /api/db/status diagnostics
    // reply gains a tableCount — one hunk in routes/system.ts, no other path.
    'src/server/routes/system.ts']);
  // G1 ruling 4 (§11): reviewer-owned report paths are excluded from the
  // executor-scope guard by exact path only — never a glob/loophole — so
  // append-rounds stay green without weakening the guard.
  // SHIELD-H12-02 / QA LOW: the TWO TASK-PROTO-H12 reviewer reports join the same
  // exact-string exclusion (no globs, no patterns, no prefix matching).
  // TASK-PROTO-H13 round 2 (QAF-01 / SHIELD-H13-01): the H13 QA report, the H13
  // Shield report and the ONE Tera-captured evidence artifact join it — three
  // exact strings, still no globs, prefixes or directory entries.
  const reviewerReports=new Set(['project-control/qa-reports/B17-U2G-QA.md',
    'security-reports/B17-U2G-fix-review.md',
    'project-control/qa-reports/TASK-PROTO-H12-QA.md',
    'security-reports/TASK-PROTO-H12-fix-review.md',
    'project-control/qa-reports/TASK-PROTO-H13-QA.md',
    'security-reports/TASK-PROTO-H13-fix-review.md',
    'project-control/prototypes/task-proto-h13/settings-app-theme.png']);
  // H12: the task contract is a Tera-owned INPUT that arrives untracked in the
  // executor worktree — it is not an executor write (excluded by exact path only).
  const controlInputs=new Set(['project-control/tasks/TASK-PROTO-H12/TASK-PROTO-H12.md',
    'project-control/tasks/TASK-PROTO-H13/TASK-PROTO-H13.md']);
  const changed=[...execFileSync('git',['diff','--name-only','HEAD'],{encoding:'utf8'}).trim().split('\n'),
    ...execFileSync('git',['ls-files','--others','--exclude-standard'],{encoding:'utf8'}).trim().split('\n')]
    .filter(Boolean).map(file => file.trim()).filter(file => !reviewerReports.has(file) && !controlInputs.has(file));
  assert.equal(allowed.size,64); // 16 (G2 base) + 8 (D-H01-06 theme track) + 2 (D-H01-07 H03 views) + 1 (persistent shared-DB showcase) + 4 (H10a/H10b views) + 3 (H10-3 views: Settings/StaffLists/ServicesManage) + 3 (H11 views: GapAnalysis/Standards/Initiatives) + 4 (P1/P2 views: EvaluationPanel/ClientReviewView/GeFinalView/TaxonomyManage) + 4 P3 (views: Actions/Notifications/Reports/AuditLog) + 3 P4/P5 (views: ClientDetailView/SetupView/ImportGRIView) + 6 H12 (theme: schema/auth/session/adminClients/AuthContext type/theme tests) + 9 H13 (settings router, appTheme test, capabilities/domainAccess census pins, own-scratch proof script, b17-content policy substrate, translations copy, routes mount, accessRegistry declarations) + 1 ISS-006 (routes/system.ts db/status tableCount)
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
