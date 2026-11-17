# Test Report — TASK-PROTO-U4-2-FIX P1 (DB migration, additive only)

## Task Information
- **Task:** TASK-PROTO-U4-2-FIX P1 — DB migration (additive only)
- **Contract:** project-control/tasks/TASK-PROTO-U4-2-FIX/TASK-PROTO-U4-2-FIX.md (§P1)
- **Harness:** scripts/u42fix-p1-rehearse.ts (isolated throwaway PG18 on 127.0.0.1:55433; never 127.0.0.1:55432, never .env)
- **QA:** QA Agent (Execution Mode), clean session, independent run 2026-11-17/18
- **Environment:** Windows + Node (npm), PG18 bin C:\Program Files\PostgreSQL\18\bin, workdir prototype-app
- **Evidence class:** all verdicts below rest on Independent Evidence (command output observed this run). Executor statements treated as context only.

## Independent Scope Discovery (SCP-2026-08-16-001)
- `git status --short` (HEAD fd77c04, branch main): M project-control/PROJECT_ACTIVITY_LOG.md, M project-control/TASK_REGISTRY.md, M project-control/TERA_AUDIT_TRAIL.md, M project-control/tasks/TASK-PROTO-U4-2/TASK-PROTO-U4-2.md, M src/db/schema.sql, M src/db/b17-content.sql, M src/db/b17Readiness.ts, M src/lib/b17TransactionInventory.test.ts, M src/lib/themeSession.test.ts; untracked: project-control/task-engineering-reviews/, project-control/tasks/TASK-PROTO-U4-2-FIX/, scripts/u42fix-p1-rehearse.ts.
- `git diff --stat` (tracked): schema.sql +114/-?, b17-content.sql +97, b17Readiness.ts +22/-? (pins PREDECESSOR 5120cf74→61462b72, B17 c9d5a9e2→e1bb70b6, CONTENT c1f87f04→0e6bf990; comment-only basis note, no version bump B17_U2D).
- Scope verdict: in-scope P1 delta = src/db/* + pin updates + rehearsal script. project-control/* doc edits and untracked review dirs are out-of-P1-code-scope drift (docs only, no production-logic effect); not a failure. No src/server, src UI, or live-DB files touched.

## Test Results

| # | Check (QA_REQUIRED) | Result | Independent Evidence |
|---|---|---|---|
| 1 | `npm run lint` (`tsc --noEmit`) | PASS | `npm run lint` EXIT:0, no errors |
| 2 | Full `npm test` (incl. pin tests b17TransactionInventory + themeSession) | PASS | `tests 385, suites 5, pass 385, fail 0, cancelled 0, skipped 0` EXIT:0. Pin suites observed green (G1 boundary inventory ok 162; H12 theme pins ok 308-314). |
| 3 | `npm run build` (`vite build`) | PASS | EXIT:0, 1696 modules transformed, built in ~719ms (chunk-size warning only, pre-existing). |
| 4 | Rehearsal: fresh install + migrate + rerun `MIGRATED_EQUALS_FRESH` | PASS | SUMMARY `MIGRATED_EQUALS_FRESH=true`; `migrated-shape == fresh-shape`; `rerun is idempotent` PASS; fresh pins in SUMMARY equal committed b17Readiness pins (PREDECESSOR 61462b72…/B17 e1bb70b6…/CONTENT 0e6bf990…). |
| 5 | Zero row loss over seeded pre-PROTECT copy | PASS | `SEEDED {clients:2,departments:2,users:5,services:2,standards:1,disclosures:1,items:2,client_services:1,assignments:1,answers:1}` then `forward migration applies; row counts identical` PASS; `COUNTS=` in SUMMARY identical. |
| 6 | Tightened-matrix assertions (RESTRRICT/RLS/immutability/audit/rollback/N-3 analogue) | PASS | All observed PASS: defaults version=1/status=active; RESTRICT on versions + copies reference no catalog; 6 policies exact names; RLS enabled+forced on 3 tables; status+5MB CHECK refusals; history matrix (W linked/C gap-gated/E provenance-pinned/foreign E denied + show_gap=false denial); copy actor-binding + N-3 copy survives service DELETE; RLS matrix (ge_admin all, same-tenant W/C, cross-tenant isolated, E denied, anon empty); E copy-insert refused; copies UPDATE/DELETE 0 rows; versions UPDATE/DELETE 0 rows; 6 new audit actions NULL-tenant admitted; seal NULL-tenant refused; unknown action refused; rollback legacy read intact. |
| 7 | `CALIBRATION_OK` (HEAD-byte pin reproduction) | PASS | SUMMARY `CALIBRATION_OK=true`; log `calibration: HEAD bytes reproduce the committed predecessor pin` + `HEAD bytes reproduce all three committed pins on this PG18`. |
| 8 | Isolation (no live/shared contact, no secrets) | PASS | Ran with `--allow-disposable-u42fix --own-scratch-ignore-env-file`; pre-check confirmed no DATABASE_URL/JWT_SECRET/PG* env; log shows throwaway cluster on port 55433 only; scratch dir removed in finally; no secret printed (trust-auth random password, loopback only). |

## Playwright E2E Summary
- **Status:** SKIPPED (not required) — P1 is DB-migration-only, no UI change; §12 precondition (UI change / tests/ dir trigger) not met. No axe check applicable (no new UI/forms).

## Pass/Fail Decision
- **PASS** — every QA_REQUIRED criterion verified by independent execution this run; rehearsal SUMMARY meets all four expected signals (MIGRATED_EQUALS_FRESH=true, zero row loss, tightened-matrix assertions, CALIBRATION_OK). No PARTIAL scope (nothing untestable; no missing tool). No FAIL. Ready for acceptance decision by Tera.

## Full Output (excerpts)
```text
LINT: npm run lint → EXIT:0 (tsc --noEmit clean)
TEST: # tests 385 / # suites 5 / # pass 385 / # fail 0 / # cancelled 0 / # skipped 0 / EXIT:0
BUILD: vite v8.3.7, 1696 modules transformed, dist assets emitted, built in 719ms, EXIT:0
REHEARSAL (exit 0, port 55433 only):
  PASS own PG18 cluster up; app role is NOSUPERUSER/NOBYPASSRLS
  FRESH PREDECESSOR_SHAPE=61462b72e42c5b27911eb7087c756abd B17_SHAPE=e1bb70b605f9a59be49cf1c25a396c0a B17_CONTENT_SHAPE=0e6bf990aec442804b3504e559a97cc3
  FRESH CONTENT_SHA256=781b8afe736c38c1eb0685b567dece1838de8e760723bff37c4a795257cdeac3 B17_SQL_SHA256=ace11265d876b6f18229dd62efa1db693cd8df00ecd0ea6012b448694406d8d6
  PASS calibration: HEAD bytes reproduce the committed predecessor pin
  PASS calibration: HEAD bytes reproduce all three committed pins on this PG18
  SEEDED {"clients":2,"departments":2,"users":5,"services":2,"standards":1,"disclosures":1,"items":2,"client_services":1,"assignments":1,"answers":1}
  PASS forward migration applies; row counts identical
  PASS existing items carry defaults version=1 status=active (no rewrite)
  PASS RESTRICT on versions; copies reference no catalog table
  PASS six new policies present with exact names (SHIELD-P1-01: versions append-only)
  PASS status + 5MB CHECKs refuse out-of-domain rows
  PASS rerun idempotent; migrated-shape == fresh-shape
  PASS item delete with versions (RESTRICT) refused
  PASS history matrix: W linked, C gap-gated, E provenance-pinned, foreign E denied
  PASS C non-gap history refused after show_gap=false
  PASS W file on another sealer copy refused
  PASS copy files actor-bound: only the sealer extends their own sealed copy
  PASS N-3 analogue: copy intact after source service DELETE (no catalog FK)
  PASS RLS matrix: ge_admin all, same-tenant W/C read, cross-tenant isolated, E denied, anon empty
  PASS E inserting a copy refused
  PASS copies immutable: UPDATE/DELETE touch 0 rows
  PASS versions append-only (SHIELD-P1-01): UPDATE/DELETE touch 0 rows
  PASS six new audit actions admitted NULL-tenant (SHIELD-P1-04: seal is target-bound only)
  PASS seal audited NULL-tenant refused
  PASS unknown audit action refused
  PASS rollback = stop writing new tables (or drop them); legacy reads green, counts intact
  SUMMARY
  PREDECESSOR_SHAPE=61462b72e42c5b27911eb7087c756abd B17_SHAPE=e1bb70b605f9a59be49cf1c25a396c0a B17_CONTENT_SHAPE=0e6bf990aec442804b3504e559a97cc3
  CONTENT_SHA256=781b8afe736c38c1eb0685b567dece1838de8e760723bff37c4a795257cdeac3
  MIGRATED_EQUALS_FRESH=true COUNTS={"clients":2,"departments":2,"users":5,"services":2,"standards":1,"disclosures":1,"items":2,"client_services":1,"assignments":1,"answers":1}
  CALIBRATION_OK=true
```

## QA Agent Signature
QA Agent (Execution Mode) — 2026-11-17/18 run. No code fixes made; no commits; no live/shared DB contact; no secrets in report. Report file only; handback follows (≤40 lines).
