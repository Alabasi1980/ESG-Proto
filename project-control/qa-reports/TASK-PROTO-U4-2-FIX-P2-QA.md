# Test Report — TASK-PROTO-U4-2-FIX P2

## Task Information
- **Task:** TASK-PROTO-U4-2-FIX P2 — Catalog CRUD API (P-only)
- **Contract:** project-control/tasks/TASK-PROTO-U4-2-FIX/TASK-PROTO-U4-2-FIX.md (P2 acceptance: catalog create/bulk/archive/service-delete + matrix 403s + N-1/N-6/N-7/N-8)
- **Test:** QA Agent Execution Mode (2026-11-17 UTC), clean session, contract + tests read from disk
- **Environment:** Windows PowerShell 5.1, prototype-app (react-example), scripts: lint=tsc --noEmit, test=tsx --test src/**/*.test.ts, build=vite build
- **Prohibitions honored:** no live/shared DB contact (127.0.0.1:55432 untouched), no .env secrets, no src/test edits, no commits, no code fixes

## Independent Scope Discovery (SCP-2026-08-16-001)
- `git status --short` (Independent Evidence): M project-control/tasks/TASK-PROTO-U4-2-FIX/TASK-PROTO-U4-2-FIX.md; M src/lib/b17TransactionInventory.test.ts; M src/lib/capabilities.test.ts; M src/lib/domainAccess.test.ts; M src/lib/taxonomy.ts; M src/server/accessRegistry.ts; M src/server/taxonomy.ts; ?? src/lib/u42fix-p2.test.ts (new P2 test file)
- `git diff --stat` (Independent Evidence): 7 files changed, 608 insertions, 35 deletions. numstat: src/server/taxonomy.ts +361/-22; src/lib/taxonomy.ts +210/-0; accessRegistry +5 (4 new P-only route lines); test-file deltas small (+14/-6, +2/-2, +12/-5)
- Scope verdict: all deltas in-target for P2 (catalog validators, bulk, version/archive, service-delete, P-only matrix). No out-of-scope drift observed. Untracked file is the expected P2 test itself, not drift.
- Executor statements: none relied upon. No handback content used as evidence.

## Commands Executed (Independent Evidence)
| # | Command | Exit | Result |
|---|---|---|---|
| 1 | `npm run lint` (tsc --noEmit) | 0 | PASS — clean, no output |
| 2 | `npm test` (full suite) | 0 | PASS — 398 pass, 0 fail (5 suites; TAP: tests 398, pass 398, fail 0, cancelled 0, skipped 0) |
| 3 | `npm run build` (vite build) | 0 | PASS — built in 1.01s, 1696 modules transformed (chunk-size warning only) |
| 4 | `npx tsx --test src/lib/u42fix-p2.test.ts` | 0 | PASS — 13 pass, 0 fail |

## Per-Criterion Verdicts (unit + static layer actually executed)
| Criterion | Verdict | Evidence (independent) |
|---|---|---|
| Catalog create (POST /standards, POST /disclosures validators) | PASS | P2 tests 1-2 ok: accepts code/title/category (+optional trimmed description/null default), refuses blanks/junk |
| Bulk subset DG-06 (answerType/priority/esgClass/attachment_required) | PASS | P2 test 3 ok: whitelisted subset exactly the DG-06 four, column mapping pinned |
| Bulk N-6 department refusal per-row | PASS | P2 test 4 ok: departmentId/department_id (incl. null, incl. alongside valid patch) refuse per-row (perRow=true, single-item message), never silent |
| Bulk shape 400s | PASS | P2 test 5 ok: unknown keys/bad values/empty/null/array/string are whole-request 400s (perRow=false) |
| N-7 version check (409 item.version_conflict) | PASS | P2 test 6 ok: stale expectedVersion 409 + code item.version_conflict; absent/compatible ok; malformed/non-positive/non-integer 400 |
| Archive behavior (archive-on-DELETE, live scope exclusion, history opt-in) | PASS (static) / NOT VERIFIED (live) | P2 test 12 ok: bulk iterates rows in lock order, missing rows are row errors, `i.status = active` live filter + includeArchived opt-in pinned. Live archive mutation NOT executed (no harness) |
| Service-delete DG-02 (preconditions + refusal + in-txn audit) | PASS (static+unit) / NOT VERIFIED (live) | P2 test 7 ok: refusal names every blocker kind, omits zero-count kinds. P2 test 13 ok: preconditions count item_versions/approved_service_copies/client_services/report_settings/document_requirements/esg_profile, code service.delete_blocked, SERVICE_DELETED audited. Live DELETE txn NOT executed |
| Matrix P-only registration (4 new routes) | PASS | P2 test 8 ok: POST /standards, POST /disclosures, POST /items/bulk, DELETE /services/:id each registered with exact P-only matrix (P#catalog / P#global-service-configuration) |
| Matrix denials W/C/E 403 = N-8 (+N-1 write side) | PASS | P2 test 9 ok: P admitted; consultant(W)/client(C)/employee(E) each throw 403 workspace.mode_mismatch on all four routes |
| N-1 (non-P write refused) | PASS (matrix layer) | Covered by P2 test 9 write-side denials above; live-handler N-1 NOT VERIFIED |
| N-6 row-level | PASS | P2 test 4 (see bulk N-6 row) |
| N-7 row-level | PASS | P2 test 6 (see version check row) |
| N-8 matrix | PASS | P2 tests 8-9 (see matrix rows) |
| Fresh-gate + in-txn audit + closed error-code set (shape) | PASS | P2 tests 10-11 ok: all four mutating declarations mount requireFreshPassword+requireDomainAccess+validateTaxonomyIds; CREATE_STANDARD/CREATE_DISCLOSURE/ARCHIVE_ITEM/SERVICE_DELETED audited; item.version_conflict/item.archived/service.delete_blocked wired; no settings whitelist (C3) and no REOPEN_ITEM_SCOPE half-reopen (C1) confirmed absent |
| Regression (full suite) | PASS | 398/398, 0 failures |

## NOT VERIFIED (exact untested scope — not PASS, per SCP-2026-08-16-001)
- Live handler/DB execution for every P2 route (POST /standards, POST /disclosures, POST /items/bulk, GET /items/:id/history, DELETE /services/:id, PATCH version-check/snapshot, archive-on-DELETE, named-settings PATCH validation): the P2 test file is pure-validator + matrix + static source-shape by design ("live-handler proof stays with QA on the isolated harness"); the tests create no isolated harness themselves, and this run was forbidden from touching 127.0.0.1:55432/shared DB/secrets. No live evidence exists in this run.
- GET /api/items/:id/history and named-settings PATCH validation have no dedicated P2 unit/static pins in the executed file beyond the suite at large; covered only by regression (no failures) — live proof outstanding.

## Pass/Fail Decision
- PARTIAL — all executed surface PASS (lint 0, full suite 398/398, build ok, P2 file 13/13; every acceptance criterion PASS at unit/static/matrix layer, zero failures). Untested scope exactly: live DB/handler proof on an isolated harness (never shared DB). Nothing failed; nothing was patched.

## Full Output (excerpts; complete TAP retained in tool log)
```text
npm run lint → EXIT:0 (clean)
npm test → # tests 398, # suites 5, # pass 398, # fail 0, EXIT:0
npm run build → 1696 modules transformed, built in 1.01s, EXIT:0
npx tsx --test src/lib/u42fix-p2.test.ts → # tests 13, # pass 13, # fail 0, EXIT:0
P2 subtests 1-13 all ok (ADD x2, bulk x3 incl. N-6, N-7, service-delete refusal, matrix x2 incl. N-8+N-1-write-side, shape x4)
```

## QA Agent Signature
QA Agent (Execution Mode) — 2026-11-17 — Independent Evidence only; executor handback treated as context, not evidence. Report written to project-control/qa-reports/TASK-PROTO-U4-2-FIX-P2-QA.md (only write performed).
