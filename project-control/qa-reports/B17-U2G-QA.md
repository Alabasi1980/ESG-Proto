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
