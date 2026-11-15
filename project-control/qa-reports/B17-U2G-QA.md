# Test Report — TASK-PROTO-B17-U2-G (G1)

## Task Information
- **Task:** TASK-PROTO-B17-U2-G — integrated server exit, G1 cross-cutting session/tab lifecycle linearization repair
- **اختبار:** QA Agent Execution Mode — independent verification (2026-11-15)
- **Base:** aa76695d1ea699aa0ba83a009507013e76e5265a (= HEAD, independently confirmed via git rev-parse)
- **البيئة:** Windows, Node v22.22.2, npm 12.2.2, Docker 29.9.2, postgres:18 (local image, --pull=never)
- **ClientAppPath:** D:\Teranoo Work\Client01\prototype-app | ControlPath: D:\Teranoo Work\Client01\prototype
- **Authority:** RUN_TESTS + report-only. Fallback writes used ONLY for this report + TEMP instrumentation under %TEMP%\opencode\b17-u2g-qa-*. No source/test/config/control/audit writes by QA.

## Verdict: PASS

Every G1 acceptance criterion was independently executed or statically proven; none failed. No PARTIAL: the only untested items are named under "NOT VERIFIED" and are outside this unit's acceptance list (G2 obligations are explicitly out of G1 scope).

## 1. Independent scope discovery (executor claims = Context only)

| Check | Result |
|---|---|
| git status --porcelain | exactly 18 modified + 6 new = 24 files, matching delta §6 ratify list one-for-one; zero extra paths |
| git rev-parse HEAD | aa76695d1ea699aa0ba83a009507013e76e5265a = base |
| git diff --stat | 18 files, +668/-530; new files 54-342 lines (all <=500) |
| Protected files | accessRegistry/auth/access/workspace/routes/admin/_shared/scope/capabilities + all src/db/* absent from git status; inventory test additionally byte-compares them to git show base — PASS |
| adminClients.ts | 475 lines (<=500 bound held) |
| Concurrent writers | security-reports/B17-U2G-fix-review.md absent at check time (Shield = known disjoint writer); my report absent -> created |
| Cleanup | no b17-u2g-* containers before/after; no stray dirs; no leftover proof processes; owner b17-showcase untouched (Up 9h, 127.0.0.1:62360) |

## 2. Test results

| # | الاختبار | النتيجة | التفاصيل |
|---|---|---|---|
| 1 | npm run lint (tsc --noEmit) | ✅ PASS | exit 0, 0 errors |
| 2 | npm test (tsx --test src/**/*.test.ts) | ✅ PASS | 223 pass / 0 fail / 0 skipped, exit 0 |
| 3 | npm run build (no-env, dist only) | ✅ PASS | exit 0; only pre-existing >500kB chunk advisory |
| 4 | G1 live proof scripts/b17-domain-g1-run.ts --allow-disposable-b17 (own fresh named PG18 scratch; container auto-removed) | ✅ PASS | exit 0 — see §3 |
| 5 | Prior proofs --previous (11 enumerated: domain, c, d, e1, e2, e2b, e2c, f1, f2, f3, workspace) on own fresh scratch | ✅ PASS | exit 0; 132 PASS / 0 FAIL; container removed |
| 6 | Playwright E2E / axe | ⏭️ SKIPPED | no playwright.config.*, no tests/ dir, backend-only unit (task §9: UI acceptance N/A) |

Key unit tests inside #2: G1 every business call site classified (ok 58); G1 no detached roots/aliases (59); G1 pair refusals/early responses outside callbacks (60); G1 protected byte-unchanged (61); G1 real boundary fake-client (75); U2-F R2 Shield-2 table-scoped pin (117); U2-F R3 Low-1 discovery non-vacuous (118).

## 3. Live proof results (real mounted routes.ts dispatcher, ephemeral loopback, own PG18)

```text
PASS OWN empty PG18; runtime NOSUPERUSER/NOBYPASSRLS; FORCE; offline fixture activation; readiness unchanged
87/87 request variants, 85/85 data route keys: logout wins at final boundary; full business fingerprints unchanged
35/35 read variants: 200 + live sid/tab NOWAIT observation before COMMIT (P usage zero-count gap retained)
PASS R1-write / R1-read — exit wins W -> 409 workspace.stale; actions/audit delta = 0
PASS R3-global / R3-target — P enter wins config -> 409 stale; no config/audit writes
LOCK R2-write/R2-read: exit blocked on tab; one work COMMIT; second tab (tenant B) wrote concurrently; then exit settled
LOCK R5-write/R5-read: logout blocked on sid; one work COMMIT; afterwards old sid 401
PASS R6-E / R6-C — deactivate wins -> 401, zero late writes, reactivate + fresh login works
LOCK R7-E / R7-C — work wins deactivate; revoker blocked at target sessions ORDER BY sid FOR UPDATE (not users UPDATE)
PASS R8 role->client_admin, role->ge_admin, department_id, client_id, must_change_password, suspension, C->E
PASS real sid/tab locks held at business INSERT (oracle FOR UPDATE NOWAIT -> 55P03)
PASS rollback-audit / rollback-commit (fault BEFORE actual COMMIT; fingerprint identical; explicit retry succeeds once)
PASS notification failure rolls back business+version+history+audit+inbox; retry submits
PASS deactivation audit fault rolls back user + session/tab revocations; old sid still live
PASS conflict body (400 version.required / 409 version.conflict + conflict payload) deferred until real ROLLBACK; pair version unchanged
PASS download bytes only after actual COMMIT; PASS OTP only after actual COMMIT; 2nd approve 409 with no OTP
COVERAGE refusals=87/87; data-route keys=85/85; static sites=84/84;
positive writes=52/52 (non-noop business fingerprint + exact audit delta + NOWAIT locks); positive reads=35/35
COMPLETED 1 owned scratch proof(s); Owned scratch container removed
--- --previous: COMPLETED 11 owned scratch proof(s); 132 PASS; 0 FAIL; container removed
```

## 4. Acceptance criteria — executed / static / unverified split

### Executed (live HTTP + real DB on own scratch)
1. Same-transaction live identity/session/tab authority through business+audit+fanout+settlement: 87/87 logout-wins refusals with zero business/audit/fanout fingerprint delta; positive writes hold sid (+tab for GE) through COMMIT observed via oracle NOWAIT; revocation winners (exit/logout/deactivation) block until work settles, and after ack old generation/sid refuses 409/401. ✅
2. Deterministic race proofs both winners: exit vs work (R1/R2), logout vs work (R5; R4 inside site loop), deactivation vs work (R6/R7), P enter vs config (R3 global+target), live identity change (R8 x7 incl. C->E and suspension), multipart final-DB-acquisition delay (site 40 upload -> 401; fresh upload 201), two tabs (R2 parallel tenant-B write while A held — proves B not serialized by A's tab lock). ✅
3. Deferred conflict/download/OTP after ROLLBACK/COMMIT with unchanged wire shapes (error/code/conflict preserved; no 499 anywhere). ✅
4. P-work/config context exceptions: live positive reads — P /services, /disclosures, /items, /items/:id/links, /standards (work context via readContext selector), P /audit-log, /notifications, /storage/usage?clientId=T, /users without T (GE-accounts, Wk), /clients; config sites use CfgØ/CfgT selectors; W/C reads unaffected. ✅
5. Site census: independent recount = 81 domainTransaction sites + 3 configurationTransaction = 84; 85 baseline − merged GET /clients branch = 84; live route-key census 85/85 (classifyRoute asserted per case). ✅
6. Guard regressions rerun via 11 prior proofs: G-SHARED scope.shared_ambiguous, pair versions lockstep + 400/409, BF-01 freeze lock 1717005 both directions, unlink -> next ge-final scope.unmapped, OTP-once hash-only, provisioning target-session-before-user (no deadlock, old bearer 401), report-settings gates 409/422, tab cap 20, skipped W->W, logout/expiry races. ✅

### Static / unit
7. No stale req.user/req.access captures before the final boundary: TEMP node instrumentation over all src/server/*.ts — zero authority reads, zero res.* responses, zero pool.query, zero nested lifecycle boundaries in/out of final domainTransaction/configurationTransaction spans, except sanctioned helper bodies (initiativeScope, adminCommon, _shared.requireFreshPassword, configurationTransaction itself), each of which reads only post-refresh values; inventory test enforces the same mechanically. ✅
8. Matrix/route keys/policies byte-equal to base (git status + byte-compare test). ✅
9. R3-1: table-scoped sensitiveStars (alias/quoted/schema/JOIN aware; COUNT(*) and SELECT * FROM services excluded) + forbiddenProjection (value/correction_history/payload/score/justification) over reachable CfgØ sources incl. borrowed helpers; non-vacuity for platformConfigContext(req), (req,null), (req,undefined), platformGlobalContext, domainTransaction(req,op), ,null, ,undefined, selector live=>platformConfigContext(live), ,platformGlobalContext, forwarded target=null; unclassified selector throws. ✅
10. Lock order/nesting: unit proves BEGIN -> sessions -> users -> tab FOR UPDATE -> idle refresh -> business -> COMMIT, one checkout; provisioning SELECT sid ORDER BY sid FOR UPDATE before users UPDATE (static) + R7 live block observation. ✅
11. Selector safety: identity/purpose/target mismatch vectors all scope.denied (unit); Auto: P->CfgØ, non-P->Wk; explicit work selectors retained at taxonomy/audit/notifications/storage-usage/users-without-T (delta §4 exceptions). ✅

### NOT VERIFIED (named; none are G1 acceptance criteria)
- Exhaustive route x role x lifecycle interleaving cross-product (proof's own disclosure).
- Real COMMIT network-uncertainty outcomes (in-process untestable; static handling only).
- Multipart parser-stream delay variant (final-DB-acquisition delay exercised instead — delta §9.2 permits either).
- G2 obligations: E3-02 sweep, E1-04 ledger/version, OD-10 inventory, full 95+4 census, legacy-helper retirement — explicitly G2, not G1.

## 5. Findings

| # | Severity | Finding | Impact |
|---|---|---|---|
| F1 | LOW | taxonomy.ts GET /items/:id/links throws DeferredRefusal but its catch calls only boundaryFailure; the body survives via the generic res.status(err.statusCode).json fallback. Correct today (body is exactly {error}), but an extra field added later would be silently dropped. audit.ts hand-rolls instanceof DeferredRefusal instead of deferredFailure (identical behavior now). | Latent maintenance fragility only — no current wire-shape or settlement defect; not a G1 blocker. |
| F2 | INFO | Build emits pre-existing >500kB chunk-size advisory (vite). | None (advisory, pre-existing). |
| F3 | INFO | Proof log stderr lines = handler console.error on intended injected faults/refusals; assertions around them all passed. | None. |

No HIGH/MEDIUM findings. No acceptance criterion failed.

## 6. Gaps reported to Tera (QA wrote no system files)
1. F1 (LOW) — optional routing to AGENT_GAPS_LOG per improvement policy; QA has no write permission there.
2. G2 obligation set remains open by design (delta §12); G1 does not close it.
3. Playwright/axe E2E absent by project shape (no UI change, no harness) — skip recorded, not silently omitted.

## 7. Compliance
[CP] Allowed Write Targets ✓ (report + TEMP only) | No secrets ✓ | In scope ✓ | No source/test/config/control/audit writes ✓ | Own scratch only, cleaned ✓ | Owner showcase/Aiven/secrets untouched ✓

## QA Agent Signature
QA Agent (Execution Mode), 2026-11-15 — independent session; all executor handback claims treated as Context only and re-derived from git status/diff, source reads, and executed runs.
﻿
---

## 8. ADDENDUM — post-report unit re-run and precise classification (SCP task §10 edge case)

After this report file was created at the pre-approved path, `npm test` was re-run deliberately to observe the interaction:

```text
EXIT=1
not ok 61 - G1 protected policies, route keys, auth/lifecycle and capabilities are byte-unchanged
  error: 'Unapproved write: project-control/qa-reports/B17-U2G-QA.md'
# tests 223 / # pass 222 / # fail 1
```

**Classification (independent, no test weakening):**
- The single failing assertion is the executor-scope drift guard enumerating `git ls-files --others --exclude-standard`. Its only hit is **QA's own report** at `project-control/qa-reports/B17-U2G-QA.md` — the exact path Tera pre-approved for this reviewer in task §10 (a known concurrent-writer path, alongside Shield's `security-reports/B17-U2G-fix-review.md`, which will trip the same assertion when written).
- This is **NOT an executor code/scope failure**. Evidence: the identical suite ran **223/223 green BEFORE this report existed** (saved run: `%TEMP%\opencode\b17-u2g-qa-npmtest.txt`, `# pass 223 / # fail 0`), and independent `git status`/`git diff` verified the executor write set is exactly the 24 ratified targets — all source-file assertions inside test 61 (byte-unchanged protected files, allowlist membership of the 24) still pass in the post-report run; the failure occurs only at the untracked-file enumeration loop, and it names a report artifact, not source.
- Pre-existing tracked QA reports (B17-U1..U2F) are absent from `--others` because they were committed in earlier rounds; this unit is pre-commit (no commit authority for QA).
- **No test was weakened, no gitignore/commit/source edit was made.** Resolution belongs to Tera (commit the reviewer reports, ignore the path, or record the classification).

**Verdict unchanged: PASS** — all G1 acceptance criteria verified; the lone test failure is a mechanical flag on QA's own authorised artifact, re-verified green at the executor-clean base state.

---

# Test Report - TASK-PROTO-B17-U2-G (G2 section)

> APPEND (2026-11-15). The G1 section above is preserved verbatim; everything below is the independent G2 verification.

## G2 Task Information
- **Task:** TASK-PROTO-B17-U2-G G2 (round 2 of 3): E3-02 error-envelope sweep, E1-04 content-version reconciliation, OD-10 isolated inventory proof, full 99-declaration census, legacy-helper no-any-client audit, G1-folded test hygiene, E3-01 close-or-carry.
- **Agent/QA:** QA Agent (Execution Mode), independent session; executor handback treated as Context only, never Evidence.
- **Base (disk-is-truth):** `048a6f254a75bbe86b8ad7fd48e46348a1c60e10` = HEAD, independently confirmed via `git rev-parse HEAD` (origin/main `c4ee8bccb87b53fbc957861178832029cde769be`).
- **Environment:** Windows, Node v22.22.2, npm 12.2.2, Docker 29.9.2, postgres:18 (local image, `--pull=never`).
- **Authority:** RUN_TESTS + report-only. Fallback writes used ONLY for this report (G2 append) and TEMP instrumentation under `%TEMP%\opencode\b17-u2g-qa-g2*` (parents verified). No source/test/config/control/audit writes by QA.
- **Concurrent writers:** `security-reports/B17-U2G-fix-review.md` modified by Shield (disjoint path, not read as evidence); `project-control/qa-reports/B17-U2G-QA.md` = this file.

## G2 Verdict: PASS
All seven G2 goals (task section 12) were independently executed or statically proven; none failed. No PARTIAL. Two named residuals sit outside the acceptance list (globalJsonErrorHandler disclosed carry; unreachable-PG catches) and are recorded under NOT VERIFIED + Gaps.

## 1. Independent scope discovery (executor claims = Context only)
| Check | Result |
|---|---|
| `git status --porcelain` | exactly **10 modified + 4 new** = ratified G2 set: `src/db/b17Readiness.ts`, `src/lib/{routeGates,b17TransactionInventory}.test.ts`, `src/server/taxonomy.ts`, `src/server/routes/{actions,audit,evaluations,gri,notifications,storage}.ts` + `scripts/b17-domain-g2-{run,od10,census,mask}.ts`; zero other executor paths (reports.ts/initiatives.ts allowed but untouched) |
| `git rev-parse HEAD` / `048a6f2` | identical (`048a6f254a75bbe86b8ad7fd48e46348a1c60e10`); base confirmed |
| Protected set | auth/access/workspace/routes/accessRegistry/capabilities/admin/_shared/scope + all `src/db/*.sql`/`b17ContentMigration.ts` absent from git status; unit test additionally byte-compares them vs base |
| Line bounds | all 4 new scripts <=500 lines (58/235/326/222); no touched file over bound |
| Concurrent writers | Shield report modified (owned); my report absent of G2 content until this append |
| Cleanup | no `b17-u2g-*`/`b17-u2g-qa-probe*` containers before/after (all `--rm`); owner `b17-showcase` Up, `127.0.0.1:62360`, untouched; no leftover proof processes; TEMP only under preapproved dir |

## 2. G2 test results (commands + actual results)
| # | Command | Result | Detail |
|---|---|---|---|
| 1 | `npm run lint` (tsc --noEmit) | PASS | exit 0, 0 errors |
| 2 | `npm test` (tsx --test src/**/*.test.ts) | PASS | **227 pass / 0 fail / 0 skipped** (G1 = 223; +4 new G2 tests: E3-02 pin #123, SHIELD-U2G-01 ring #124, legacy-helper audit #125, OBS-3 #62) |
| 3 | `npm run build` (no-env, dist only) | PASS | exit 0; only pre-existing >500kB chunk advisory (known F2) |
| 4 | `node --import tsx scripts/b17-domain-g2-run.ts --allow-disposable-b17` (own fresh named PG18 scratch, container auto-removed) | PASS | exit 0: OD-10 + E1-04 (10 PASS lines), census (495 cells), mask (E3-02 table + 10 own-body + 3 PG-collapse probes) |
| 5 | `node --import tsx scripts/b17-domain-g1-run.ts --previous --allow-disposable-b17` (11 prior proofs, own fresh scratch) | PASS | **132 PASS / 0 FAIL**, container removed |
| 6 | QA own probe round 1 (`%TEMP%\...\probe\qa-probe.ts`, own fresh scratch) | 24 pass / 3 fail | the 3 fails were QA harness bugs (raw CRLF hash vs documented LF normalization; app-role ledger UPDATE blocked by FORCE RLS default-deny; W used on P-only route) - corrected in round 2, never a system defect |
| 7 | QA own probe round 2 (`qa-probe2.ts`, own fresh scratch) | PASS | **13/13**, exit 0, container removed |
| 8 | QA pin-mutation challenge (`pin-mutate.js`, verbatim extraction of the pin algorithm) | PASS | real corpus: 0 violations / 23 sanctioned echoes / counts == reviewed table; 3/3 injected violations detected (top-level echo, unguarded catch echo, tail-after-guard echo) |
| 9 | Playwright E2E / axe | SKIPPED | no playwright.config.*, no tests/ dir, backend-only unit (task 9: UI acceptance N/A) |

## 3. E3-02 (goal 1) - classification evidence
**Before/after table (executor mask, executed on my scratch):** 47 raw catch echoes at base -> **0 unguarded after**, per file: actions 3->0, audit 1->0, evaluations 8->0 (6 own-guarded), gri 6->0 (2 guarded), notifications 4->0, storage 5->0, taxonomy 20->0 (2 guarded), _shared 0->0 (2 guarded).

**QA independent per-catch enumeration (own logic, `%TEMP%\...\catch-enum.js`):** **109 catches** under `src/server`; 96 call a sanctioned helper (writeFailure/readFailure/domainFailure/catalogFailure/actionFailure/auditFailure/griFailure/inboxFailure/storageFailure/evalWriteFailure/deferredFailure/boundaryFailure/sendAuthError), 9 carry an own-error guard, 12 catch-body echo sites ALL inside a guard span, **0 flagged** (no raw echo, no template/`String(err)`/stack leak anywhere). The 11 no-helper/no-guard catches were each read manually: jsonInput -> `next(error)`; 6 inner `dbErr` catches translate `23505` -> own 409 then rethrow (taxonomy x4, adminProvisioning x2, adminStaff, initiatives); reports x2 -> local `failure()` (422 guard + domainFailure). Helper-region echoes (11 more) are inside the reviewed collapse helpers = 23 total, matching the pin's exact EXPECTED table.

**Wire equality for own errors:** mechanically identical at every `err.statusCode || 500` site (base vs new); the three base-hardcoded-500 gri catches have no reachable own-statusCode thrower (parseGRIFile never throws; standards/dashboard contain no own throw). Executed exact-body probes: 14 own bodies byte-equal (round 1: taxonomy write 409/400, reports export/index 400, initiatives, evaluations correct 404, taxonomy validate 400, + executor's 10 and double-submit 409; round 2: initiatives P-only 400, storage read 404).

**PG/unknown collapse executed:** executor mask 3 (audit `since` cast 22007, storage uuid cast 22P02, notifications uuid cast) + QA own audit `until` cast -> all exactly `500 {error: <static fallback>}`, no PG text, no SQLSTATE. Folded items verified in diff: taxonomy `DeferredRefusal` arms now `deferredFailure`; audit hand-rolled `instanceof` replaced by `deferredFailure` (byte-identical body). Multer non-size branch collapses library message to static own body (status/code preserved; oversize branch untouched).

**Pin test:** real and non-vacuous (test green + my mutation challenge above).

## 4. E1-04 (goal 2) - evidence
- Constant `B17_CONTENT_VERSION = 'B17_U2D'` unchanged; `b17-content.sql` header `-- B17_U2D.` and guard `version='B17_U2D'` name the same label; `b17ContentMigration.ts` INSERT binds the constant (static reads).
- `src/db/b17Readiness.ts` **comment-only**: `git diff --numstat` = 19 insertions / 0 deletions, every added line is a comment (QA script-checked); unit test codeOnly (comments/blanks stripped) byte-compares worktree vs base.
- Four-way on fresh apply (od10, executed): constant <-> ledger row <-> `B17_CONTENT_SHAPE` <-> live STRUCTURE_SQL; QA round 2 independently recomputed: ledger checksum == sha256(LF-normalized b17-content.sql) (`0c7df814924d...` both), structure_checksum == constant, label == B17_U2D.
- Drift REFUSED + restore RECOVERED: od10 cycles (ledger checksum, structure_checksum, version label -> `version_drift`; live catalog -> `schema_drift`) + QA's own oracle cycles (`version_drift`, `schema_drift`, both green after restore). App role cannot see/UPDATE the ledger under FORCE RLS default-deny (QA round-1 harness observation, not a defect).

## 5. OD-10 (goal 3) - evidence (od10 executed on own scratch)
Dry-run ALWAYS ROLLBACK: 0 temp `b17_inventory%` policies, ledger stays exactly `[B17_U1]`, all 24 business-table hashes unchanged, repeat dry-run deepEqual, `verifyB17Content` still `content_required`. Ambiguous/unidentified REFUSED with zero writes: unknown source, unknown batch (`lineage_ambiguous`), unknown client, duplicate target, empty targets, tampered `before_state_drift`, apply-time `source_unknown`. Apply: every non-binding business row byte-identical; `esg_profile`/`report_settings` changed ONLY `service_id` (to GRI, nowhere else); no pre-existing `service_standards` pair removed, exactly the inventoried pairs added; `already_applied` then `applied -> verified` idempotence. Sanctioned functions only (`inventoryB17ContentOffline`/`applyB17ContentOffline`/`parseB17ContentSources`/`verifyB17*`/`assertB17Ready`/`applyB17Offline`); **zero execution/import of `scripts/b17-scope-proof.ts`** (grep: only "never runs" comments in the four g2 scripts).

## 6. Census (goal 4) - evidence (census executed on own scratch)
`CENSUS cells=495 (99x5) served=208 refused=287 statuses={"200":104,"201":2,"400":30,"401":92,"403":210,"404":51,"409":6}`; exact status/code per cell through the REAL mounted dispatcher (express + jsonInput + cookieParser + `/api` router + global handler); negative route `404 api.not_found`; both outcomes exercised (>150 each). Registry/matrix/capabilities **byte-stable vs 048a6f2** (git status + census `git show` byte-compare). `99 = 95 legacy + 4 workspace`, **0 UNACTIVATED** (all `U1`). QA independent challenges: text-parse recount of `accessRegistry.ts` = 99 declaration rows (95 + 4 workspace), spec section 3 arithmetic (8+18+5+15+25+3+7+4+5+1+4 = 95) matches; audit matrix row matches spec 3.6 (`P#platform-events...;W#mandatory-A-filter-C-E-denied`); 5 own sample cells executed (C audit 403 mode_mismatch, E dashboard 403, anon read 401 auth.invalid, P audit 200, unknown route 404 api.not_found).

## 7. Legacy-helper audit (goal 5) - evidence
QA greps over `src/server`: `contextFromUser(` call sites = **exactly 1** (`_shared.ts` inside `requireFreshPassword`; definition at line 45 is not a call); `optionalAuthMiddleware` = definition only in `auth.ts` (0 mounts); 8 retired helpers (`b11bOwnTenantScope`, `b11bAssertTenantActive`, `b11bRequireGeAdmin`, `b11bAssertPasswordFresh`, `evalClientScope`, `evalDepartmentScope`, `reportTenantScope`, `initiativeSelectionScope`) = **0 live call sites**; `isAuditReader` = definition + comment only, 0 calls; taxonomy local context builder gone. Test `G2 legacy-helper audit` green (exactly one sanctioned site, inside the fresh gate). `prototype/U2_LEGACY_HELPER_RETIREMENT.md` completion section (recorded by Tera, round 2/G2): MET - QA's independent measurements match it point-for-point.

## 8. Folded hygiene (goal 6) - evidence
- **SHIELD-U2G-01 evaluations ring:** absent at base (verified `git show 048a6f2` has no `FROM/JOIN evaluations` ring), re-added on targetless-platform paths; test green with in-test non-vacuity (roots >= 3; synthetic targetless reader flagged; prose-only mention excluded).
- **OBS-3 adminProvisioning pre-lock:** new test pins all 3 `configurationTransaction` sites, >= 1 authority capture required, every capture inside a boundary; green. Original inventory pre-lock ring untouched (diff = additions only).
- **Scope guard two-path exclusion:** exact `Set` of `project-control/qa-reports/B17-U2G-QA.md` and `security-reports/B17-U2G-fix-review.md` - no glob, no directory rule; `allowed.size == 16` asserted; every other changed/untracked path still fails the guard (executor-scope protection remains real; the G1 addendum firing is the historical proof it does fire). Post-append `npm test` re-run below exercises both excluded paths being modified.

## 9. E3-01 (goal 7) - CARRIED (recorded here per contract)
**Disclosure-scope pre-lock freeze window = accepted fail-closed boundary (carry, no redesign).** Per U2-E ruling: the in-lock freeze recheck is tenant-only; disclosure-scope freeze checks run pre-lock, so a dangling assignment can be provisioned into a frozen disclosure. Writes into that frozen scope remain refused by the `FROZEN_SCOPE` trigger and the immutable snapshot is untouched - no content corruption, no subset freeze; tenant-scope window closed; disclosure-scope window fails closed downstream. No trigger/freeze change was made or needed this round (source diff contains none). Close-or-carry decision: **CARRY accepted**.

## 10. Acceptance split (G2)
**Executed:** lint/test/build; g2-run (OD-10 + E1-04 + census + mask) on own fresh scratch; 11 prior proofs (132 PASS); QA round-1 (24) + round-2 (13) probes; pin-mutation challenge; post-append suite re-run (section 12).
**Static:** full per-catch E3-02 enumeration (109) + pin table; b17Readiness comment-only; registry recount; legacy-helper greps; hygiene source review (ring presence/absence vs base, exclusion exactness, allowed=16); OD-10 sanctioned-import review; secret-literal scan of the diff (none); E3-01 no-code-change confirmation.
**NOT VERIFIED (named; none is a G2 acceptance criterion):** (a) `globalJsonErrorHandler` is not a `catch`, is pre-existing, is outside the G2 write surface, and was disclosed by the executor - QA demonstrated concretely that an escaped PG-shaped error echoes message+SQLSTATE there (residual, see Gaps); (b) PG-diagnostic collapse in taxonomy/gri is runtime-unreachable by design (strict id pre-validation / parser never throws) - helper treatment is static-only, disclosed by the mask script; QA instead proved their own-error paths live; (c) Playwright/axe E2E absent by project shape; (d) QA round-1 harness bugs (section 2 #6) - corrected, re-proven green in round 2.

## 11. Findings
| # | Severity | Finding | Impact |
|---|---|---|---|
| G2-F1 | LOW | `globalJsonErrorHandler` (errorHandler.ts, unchanged, not in G2 allowed targets) echoes `err.message`+`code` for any escaped error with no own-vs-PG discrimination; demonstrated by QA's own route. The pin discloses it as a residual (indirection) and pins it only via errorHandler.test.ts (JSON-not-HTML, status, no stack). | Latent: a PG diagnostic escaping every route catch would echo. No such path found; all route catches collapse. Fix belongs to a future allowed-target decision (route it through writeFailure semantics), not this round. |
| G2-F2 | INFO | Build emits pre-existing >500kB chunk advisory (vite). | None (known F2). |
| G2-F3 | INFO | Proof/`npm test` stderr lines = handler `console.error` on intended injected faults/refusals; all assertions around them passed. | None (known F3). |
No HIGH/MEDIUM findings. No acceptance criterion failed.

## 12. Post-append suite re-run (scope-guard observation)
Run after this G2 section existed on disk (this report modified) and with Shield's `security-reports/B17-U2G-fix-review.md` also modified by its concurrent owner:
```text
npm test (this report already containing the G2 section + Shield G2 report already modified):
# tests 227 / # pass 227 / # fail 0 / # skipped 0   EXIT=0
```

## 13. Gaps reported to Tera (QA wrote no system files)
1. G2-F1 globalJsonErrorHandler hardening = improvement-policy/AGENT_GAPS_LOG candidate; requires an allowed-target decision (errorHandler.ts not in the G2 ratified set). Not a G2 failure.
2. Round-1 QA harness defects (CRLF hash, app-role ledger UPDATE under RLS, P-only route context) = QA-internal, corrected; recorded for transparency.
3. Playwright/axe E2E absent by project shape - skip recorded, not silently omitted (as in G1).

## Compliance
[CP] Allowed Write Targets: report + TEMP only | No secrets (outputs contain no credential values; generated creds never printed) | In scope | No source/test/config/control/audit writes | Own scratch only, all containers `--rm` and removed | Owner showcase/Aiven/secrets untouched | Never ran `scripts/b17-scope-proof.ts` | No install/commit/push/deploy/subagents/network upload.

## QA Agent Signature
QA Agent (Execution Mode), 2026-11-15 - G2 independent verification; all executor handback claims treated as Context only and re-derived from git status/diff, source reads, and executed runs.