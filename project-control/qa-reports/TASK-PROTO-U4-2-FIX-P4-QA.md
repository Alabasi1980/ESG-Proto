# Test Report — TASK-PROTO-U4-2-FIX P4

## Task Information
- **Task:** TASK-PROTO-U4-2-FIX P4 — History / freeze / approved copy API
- **Test:** QA Agent Execution Mode, 2026-11-17/18 (UTC), independent clean run
- **Environment:** Windows, Node via prototype-app toolchain, own throwaway PG18 cluster on 127.0.0.1:55433 (script-created, removed afterwards)
- **Scope source:** contract project-control/tasks/TASK-PROTO-U4-2-FIX/TASK-PROTO-U4-2-FIX.md (P4 acceptance incl. F1/F2), src/lib/u42fix-p4.test.ts, scripts/u42fix-p4-rehearse.ts

## Independent Discovery (SCP-2026-08-16-001)
- git status: 10 modified + 2 new files. Modified: contract (Tera P4 gate text), src/db/b17-content.sql, src/db/b17Readiness.ts, src/lib/b17TransactionInventory.test.ts, src/lib/capabilities.test.ts, src/lib/domainAccess.test.ts, src/lib/u42fix-p2.test.ts, src/server/accessRegistry.ts, src/server/routes/evaluations.ts, src/server/taxonomy.ts. New: scripts/u42fix-p4-rehearse.ts, src/lib/u42fix-p4.test.ts.
- git diff review: every hunk is P4-surface (history viewer + PATCH reopen + seal + copy viewer + F2 + 2 RLS branches + mechanical count/sha re-pins + C1-guard closure in p2 test citing Tera round-2 ruling A). No out-of-scope drift. Contract delta is Tera-owned gate text, not executor drift.
- Methodology note: two early shell checks used broken quoting and returned unreliable values (.env existence, pg-bin). Both were re-run with correct quoting before any verdict. Lint/build/test outputs never used quoted paths and stand as first observed.
- Executor handback (if any) treated as context only; every verdict below rests on the listed Independent Evidence.

## Test Results

| # | Check | Verdict | Evidence |
|---|---|---|---|
| 1 | npm run lint (tsc --noEmit) | PASS | exit 0, clean |
| 2 | npm test (full suite) | PASS | 424 tests, 424 pass, 0 fail (contract baseline 409 + 15 new P4 = 424, arithmetic consistent) |
| 3 | npm run build (vite) | PASS | exit 0, built in ~763ms |
| 4 | P4 test file (15 tests) | PASS | 15 pass, 0 fail |
| 5 | P4 rehearsal on isolated harness | PASS | full SUMMARY captured (see below); every PASS line printed, zero asserts failed |

## Per-Criterion Verdicts (contract P4 acceptance + F1/F2)
- History matrix (GET history P/W/C/E, GET copy P@T/W/C, POST seal P@T, exact API-5 strings): PASS — tests 1-4 green; registry/matrix strings verified in source.
- Reopen atomicity — snapshot before bump, answers to reopened, REOPEN_ITEM_SCOPE audit: PASS — shape pins green + live reopen (version 1 to 2, 1 version row, answer reopened).
- Stale version refused 409 item.version_conflict, zero writes: PASS — shape pin + live stale attempt rejected, history count unchanged (1).
- Frozen scope refused 409 FROZEN_SCOPE (pre-check + trigger backstop): PASS — live N2_REFUSED=1, pre-edit values intact.
- Seal atomic with GE-final shape + standalone seal (targetless verify, target-bound seal, 409 copy.seal_conflict + ROLLBACK, idempotent re-seal dedupe): PASS — shape pins + live seal, mismatch rollback (still 1 copy), re-seal resolves to same copy id.
- N-3 copy viewable after DELETE SOURCE with bytes intact: PASS — live N3_COMPLETE=1, service_code/hash/payload + base64-identical bytes after full source removal.
- N-4 old version + reopened answers in history: PASS — live N4_VERSIONS=1 (version 1, Req, reason retained; counts-only answersSummary, no blobs/values).
- F2 audit on redundant archive (idempotent but tracked): PASS — shape pin (redundant flag + ARCHIVE_ITEM in-txn) + live audit count +1 on redundant path.
- Rollback leaves zero partial rows: PASS — live duplicate-version txn fully rolled back.
- RLS narrowness (reopen UPDATE reopen-only/platform-bound/guarded; seal SELECT target-bound/platform-bound/read-only; no other policy touched): PASS — tests 13-15 green. Second branch justification stated in-file (answers-tenant join would re-enter RLS denying P@T; cites Tera ruling B option a) and demonstrated live (targetless reads 0 rows, target-bound reads bytes).
- Isolation (no shared/live contact, no secrets): PASS — port 55433 hardcoded, code throws on 5432/55432; ambient PG env absent; .env exists but never read (code-verified); no secrets in outputs; scratch dirs removed (verified empty afterwards).
- Scope containment: PASS — diff in-target only (see Discovery).

## Rehearsal SUMMARY (verbatim)
- CONTENT_SHAPE=90967166a353283de10488a43c393ac8 (equals B17_CONTENT_SHAPE constant) CONTENT_SHA256=9d08ad5636a99fd7c86d45e6a2ae0239e91df7e428c460c58124c4b2b5261188 (equals inventory pin)
- SEAL_COPY=66a1c69a-c446-418b-a496-9995250db5cf FILES=1 N3_COMPLETE=1 N2_REFUSED=1 N4_VERSIONS=1
- COUNTS={"clients":2,"departments":2,"users":4,"services":1,"standards":1,"disclosures":1,"items":3,"client_services":0,"assignments":2,"answers":2,"item_versions":1,"approved_service_copies":1,"approved_copy_files":1,"audit_log":4} ZERO_LOSS=1 (services=1 is the untouched schema GRI seed)
- F1_LIVE_PROOF=archive,reopen,conflict,seal,reseal-idempotent,mismatch-rollback,delete-source,view-copy,n2,n4,rollback

## Observations (not failures)
- client_services=0 in final COUNTS is the expected FK cascade of the documented disaster-simulation DELETE (the API would refuse while copies exist per DG-02, proven first); the durability artifact (sealed copy + bytes) is fully intact. Script ledger asserts PASS.
- Live proof level is SQL-mirror on the isolated cluster (the contract-defined F1 mechanism), not HTTP route invocation; static matrix/shape pins cover the route layer. Recorded transparently per contract design.

## Pass/Fail Decision
- PASS — all acceptance criteria verified with independent evidence. Zero failures, zero NOT VERIFIED items. Ready for Tera acceptance decision.

## Full Output (excerpts)
- lint: tsc --noEmit clean, EXIT 0.
- test: 424 pass / 0 fail / 0 skipped; P4 file: 15 pass / 0 fail.
- build: vite v8.3.7, 1696 modules, EXIT 0 (chunk-size warning only).
- rehearsal: PASS archive / PASS F2 / PASS reopen atomic / PASS version conflict / PASS reopen-branch narrowness / PASS seal atomic / PASS seal-read target-bound / PASS seal mismatch rollback / PASS re-seal idempotent / PASS N-2 backstop / PASS N-2 intact / PASS DG-02 guard / PASS N-3 complete / PASS rollback / PASS zero-row-loss ledger; SUMMARY as above.

## QA Agent Signature
QA Agent (Execution Mode), 2026-11-18. No code written or modified; report-only. No commits, no live/shared DB contact, no secrets recorded.
