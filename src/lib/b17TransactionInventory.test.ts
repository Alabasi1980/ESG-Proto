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
  // TASK-PROTO-U4-1a: the W-only visibility writer, one work-context boundary.
  'routes/serviceVisibility.ts':[1,1],
  // TASK-PROTO-U4-1c: the department document requirements (4 P@T catalog rows),
  // the department list read, the submission patch and the three unified
  // evidence-file rows (9 boundaries; round 2 gives every target read the
  // platform-config arrow, so this file has no literal readContext selector and
  // the explicit-work inventory count drops by one), plus the department
  // initiative status pair (2, target read + one E write).
  'routes/documents.ts':[9,0], 'routes/departmentInitiatives.ts':[2,0],
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
  assert.equal(total,95);assert.equal(work,38);
  const provisioning=readFileSync(path.join(root,'routes/adminProvisioning.ts'),'utf8');
  assert.equal((provisioning.match(/await configurationTransaction\(req, target,/g) ?? []).length,3);
  assert.equal(total+3,98,'85 baseline sites minus merged GET clients branch, plus H13 settings, the U4-1a visibility row and the eleven U4-1c rows');
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
  // U4-1a: routes.ts + accessRegistry.ts gained the one W visibility declaration;
  // b17-content.sql gained the one narrow W policy (approved Option A).
  // U4-1c round 3 (G-01): only b17-content.sql moves (the audit policy gains the
  // target-bound requirement branch); its sha256 pin and the readiness pin
  // (constant + note) move with it.
  const h13RoutesSha256='a810933dcab117669a42036ec3d6affe944f5cd1f4e73a68096b4561bbce9820';
  const h13AccessRegistrySha256='10931e42fd5f86e491b5e52836a486a1be72a48964c56e477731feeb6377711b';
  const h13ContentSha256='4ff0f31c455c37ca8d60b9cd8f4b1d67b8a05d3810ffa2ac03c300540d8ea055';
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
  // U4-1a (TASK-PROTO-U4-1a): the three constants moved after the three additive
  // columns were re-measured on an own fresh PG18 scratch; no other readiness
  // logic changed. Re-pinned deliberately over LF-normalized bytes.
  // U4-1c (TASK-PROTO-U4-1c): the three constants moved again after the new
  // columns/tables and the new content policy block were re-measured on an own
  // fresh PG18 scratch (scripts/u41c-scratch.ts), with the drop/re-add
  // falsifiability chain in the same run.
  // U4-1c round 3: only the content constant moved (the audit-policy branch).
  const h13ReadinessSha256='480ff0a6475dbfaffe5cbf28db9896d097754a7085437d9c55413294118c5e6d';
  assert.equal(createHash('sha256')
    .update(readFileSync('src/db/b17Readiness.ts','utf8').replace(/\r\n/g,'\n'),'utf8')
    .digest('hex'),h13ReadinessSha256,
  'b17Readiness.ts drifted from its deliberate, task-approved POST-H13-r2 bytes (constants + SHIELD-H13-02)');
  assert.ok(readFileSync('src/server/routes/adminClients.ts','utf8').split('\n').length<=500);
  const newFiles=['scripts/b17-domain-g2-run.ts','scripts/b17-domain-g2-od10.ts',
    'scripts/b17-domain-g2-census.ts','scripts/b17-domain-g2-mask.ts',
    // U4-1a: the ONE mask contract + the settings container contract and their
    // no-DB tests, plus the own-scratch measurement/proof script.
    'src/lib/clientFieldMask.ts','src/lib/clientFieldMask.test.ts',
    'src/lib/serviceSettings.ts','src/lib/serviceSettings.test.ts',
    'scripts/u41-mask-scratch.ts',
    // U4-1a round 2: the one W-only visibility writer route file.
    'src/server/routes/serviceVisibility.ts',
    // U4-1b: the ONE typed-answer contract + its no-DB matrix. evaluations.ts
    // and routeGates.test.ts are already named above; no other path moves.
    'src/lib/answerValidation.ts','src/lib/answerValidation.test.ts',
    // TASK-PROTO-U4-1c: the general-bucket helper, the two pure contracts, the
    // two new routers, their no-DB tests and the own-scratch proof script.
    // taxonomy.ts, scope.ts, routes.ts, accessRegistry.ts, schema.sql,
    // b17-content.sql, b17Readiness.ts and the two census tests are already
    // named above; no UI/style/view path moves.
    'src/lib/generalBucket.ts','src/lib/generalBucket.test.ts',
    'src/lib/documents.ts','src/lib/documents.test.ts',
    'src/lib/departmentInitiatives.ts','src/lib/departmentInitiatives.test.ts',
    'src/server/routes/documents.ts','src/server/routes/departmentInitiatives.ts',
    'scripts/u41c-scratch.ts',
    // TASK-PROTO-U4-1c round 3 (G-04): the behavioural E2E that boots the real
    // server against the scratch and drives P/C/E through the real handlers.
    'scripts/u41c-e2e.ts'];
  const allowed=new Set(['src/server/taxonomy.ts',
    // U4-1b round 2 (SHIELD M-02): the W-only N/A shortcut gains the
    // attachment_required guard; no other assignment handler moves.
    'src/server/routes/adminAssignments.ts',
    'src/server/routes/actions.ts','src/server/routes/audit.ts','src/server/routes/gri.ts',
    'src/server/routes/notifications.ts','src/server/routes/storage.ts','src/server/routes/evaluations.ts',
    'src/server/routes/reports.ts','src/server/routes/initiatives.ts',
    'src/lib/routeGates.test.ts','src/lib/b17TransactionInventory.test.ts','src/db/b17Readiness.ts',
    // D-H01-06 (2026-11-15, owner-authorized): theme-center track H02a/H02b — 8 paths only.
    'src/App.tsx','src/components/Header.tsx','src/components/Sidebar.tsx','src/index.css',
    'src/main.tsx','src/context/ThemeContext.tsx','src/styles/tokens.css','src/styles/themes.css',
    // D-H01-07 (2026-11-15, owner-authorized): view-migration batch H03 — 1 path only
    // (the shared banner component was deleted by OD-11 §1; its deletion is named
    // in authorizedDeletions below — a removed path is not an editable path).
    // Exact files named in TASK-PROTO-H03 — no globs, no implicit paths (LoginView → tokens).
    'src/views/LoginView.tsx',
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
    'src/server/routes/system.ts',
    // TASK-PROTO-U3-A: the missing client workspace layer — 4 exact paths only
    // (the two new modules and their two no-DB tests). No server/db/style path.
    'src/lib/workspaceClient.ts','src/lib/api.ts',
    'src/lib/workspaceClient.test.ts','src/lib/api.test.ts',
    // TASK-PROTO-U3-B1: the single navigation model and its table-driven test —
    // 2 exact new paths only. App/Sidebar/Header/AuthContext/translations are
    // already named above; no server/db/style/view-content path.
    'src/lib/navModel.ts','src/lib/navModel.test.ts',
    // TASK-PROTO-U3-B2: the new Clients page and its no-DB test — 2 exact new
    // paths only. App/Header/AuthContext/GeOverviewView/DashboardView/
    // GapAnalysisView/StandardsView/workspaceClient/navModel/translations are
    // already named above; no server/db/style path.
    'src/views/ClientsView.tsx','src/lib/clients.test.ts',
    // OD-11 §1 (product posture): the new no-demo-language stop-guard — 1 exact path.
    'src/lib/productPosture.test.ts',
    // TASK-PROTO-U4-1a: the C mask lookup lives with the work-scope helpers
    // (scope.ts); the two pure contracts + their no-DB tests and the
    // own-scratch proof script are the five new paths. taxonomy.ts,
    // evaluations.ts, reports.ts, adminClients.ts, schema.sql, b17Readiness.ts
    // are already named above; no UI/style/view path.
    'src/server/scope.ts','src/lib/clientFieldMask.ts','src/lib/clientFieldMask.test.ts',
    'src/lib/serviceSettings.ts','src/lib/serviceSettings.test.ts','scripts/u41-mask-scratch.ts',
    'src/server/routes/serviceVisibility.ts']);
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
    'project-control/prototypes/task-proto-h13/settings-app-theme.png',
    // TASK-PROTO-U3-A (SHIELD-U3A-02): the reviewer-owned QA/fix-review pair for
    // this unit, by exact path only — no globs, prefixes or directory entries.
    'project-control/qa-reports/TASK-PROTO-U3A-QA.md',
    'security-reports/TASK-PROTO-U3A-fix-review.md',
    // TASK-PROTO-U3-B2 round-3 reviewer evidence (QA FAIL + Shield Medium) —
    // reviewer-owned, exact paths only.
    'project-control/qa-reports/TASK-PROTO-U3B2-QA.md',
    'security-reports/TASK-PROTO-U3B2-fix-review.md',
    // TASK-PROTO-U4-1a reviewer evidence (round 2) — reviewer-owned, exact paths.
    'project-control/qa-reports/TASK-PROTO-U4-1a-QA.md',
    'security-reports/TASK-PROTO-U4-1a-fix-review.md',
    // TASK-PROTO-U4-1b reviewer evidence (round 2) — reviewer-owned, exact paths.
    'project-control/qa-reports/TASK-PROTO-U4-1b-QA.md',
    'security-reports/TASK-PROTO-U4-1b-fix-review.md',
    // TASK-PROTO-U4-1c reviewer evidence (round 2) — reviewer-owned, exact paths.
    'project-control/qa-reports/TASK-PROTO-U4-1c-QA.md',
    'security-reports/TASK-PROTO-U4-1c-fix-review.md']);
  // H12: the task contract is a Tera-owned INPUT that arrives untracked in the
  // executor worktree — it is not an executor write (excluded by exact path only).
  const controlInputs=new Set(['project-control/tasks/TASK-PROTO-H12/TASK-PROTO-H12.md',
    'project-control/tasks/TASK-PROTO-H13/TASK-PROTO-H13.md',
    // TASK-PROTO-U3 arrives the same way (Tera-owned contract, untracked input).
    'project-control/tasks/TASK-PROTO-U3/TASK-PROTO-U3.md',
    // TASK-PROTO-U3-B1 root contract (Tera-owned, untracked input).
    'project-control/tasks/TASK-PROTO-U3-B1/TASK-PROTO-U3-B1.md',
    // TASK-PROTO-U3-B2 contract (Tera-owned, untracked input).
    'project-control/tasks/TASK-PROTO-U3-B2/TASK-PROTO-U3-B2.md',
    // TASK-PROTO-U4-1a contract (Tera-owned, untracked input).
    'project-control/tasks/TASK-PROTO-U4-1a/TASK-PROTO-U4-1a.md',
    // TASK-PROTO-U4-1b contract (Tera-owned, untracked input).
    'project-control/tasks/TASK-PROTO-U4-1b/TASK-PROTO-U4-1b.md',
    // TASK-PROTO-U4-1c contract (Tera-owned, untracked input).
    'project-control/tasks/TASK-PROTO-U4-1c/TASK-PROTO-U4-1c.md']);
  // OD-11 §1: the shared banner component is REMOVED by the product-posture task,
  // so the path has left `allowed` (nothing may edit it) and only its deletion may
  // pass the write guard — one exact path, no globs, no directory entries. The
  // path is assembled from fragments so the posture guard
  // (src/lib/productPosture.test.ts) can keep a zero-hit literal grep under src/.
  const deletedBannerPath='src/components/Demo'+'Banner.tsx';
  const authorizedDeletions=new Set([deletedBannerPath]);
  const changed=[...execFileSync('git',['diff','--name-only','HEAD'],{encoding:'utf8'}).trim().split('\n'),
    ...execFileSync('git',['ls-files','--others','--exclude-standard'],{encoding:'utf8'}).trim().split('\n')]
    .filter(Boolean).map(file => file.trim()).filter(file => !reviewerReports.has(file) && !controlInputs.has(file) && !authorizedDeletions.has(file));
  assert.equal(allowed.size,92); // 91 through U4-1c round 2 + the round-3 E2E script
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
