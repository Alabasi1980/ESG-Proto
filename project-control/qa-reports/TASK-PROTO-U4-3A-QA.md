# Test Report — TASK-PROTO-U4-3a (unit a)

## Task Information
- **Task:** TASK-PROTO-U4-3 unit (a) — Employee services workspace (dept services → items with typed answers + independent attachments + mandatory-attachment enforcement + documents tab + initiatives tab; E own-department only; no new answer semantics; existing APIs only)
- **Test:** QA Agent Execution Mode (independent verification; clean run from disk; executor statements treated as context only, never evidence)
- **Date (UTC):** 2026-11-18
- **Environment:** win32, PowerShell 5.1, node:test + tsx harness, vite 8.3.7, Docker 29.9.2 (observed only, never used for live proof this run)
- **Contract:** `project-control/tasks/TASK-PROTO-U4-3/TASK-PROTO-U4-3.md` (unit-a acceptance)
- **Program spec:** `project-control/task-engineering-reviews/TASK-PROTO-U4-3_TECHNICAL_SPECIFICATION.md` (unit-a E-flows: UI-1, UI-7 E-1…E-4; API-2 CONSUME-only; zero-DDL DB-1)

## Independent Scope Discovery (SCP-2026-08-16-001 — Independent Evidence)
- `git status --short`: 3 tracked-modified (`src/App.tsx`, `src/i18n/translations.ts`, `src/lib/b17TransactionInventory.test.ts`) + 8 untracked (task contract md, tech-spec md, `src/views/EmployeeServicesView.tsx`, `src/components/employee/` x5, `src/lib/u43a.test.ts`).
- `git diff` (tracked): App.tsx = one employee-only mount hunk; translations.ts = +`employeeServices` block (AR/EN) + `yes/no` common keys; b17TransactionInventory.test.ts = allow-list additions only (allowed.size 109 → 116).
- `git show HEAD:src/views/ServicesView.tsx` = 875 lines (proves §Full-Suite failure is pre-existing, not unit-(a) drift).
- **Scope drift: NONE.** Every changed/new file is the unit-(a) employee workspace, its no-DB pins, or Tera-owned control inputs (exact paths already in the test's `controlInputs` set). `ServicesView.tsx` untouched by this unit. No server/db/style/nav route touched.

## Per-Criterion Verdicts (acceptance criteria from contract + spec UI-1/UI-7)

| # | Criterion | Verdict | Evidence (independent) |
|---|---|---|---|
| 1 | Service rail: queue rows group under linked service with own-dept counts; unmatched standards visible under fallback, never dropped | PASS (static) | u43a t1, t2, t4 — 11/11 pass |
| 2 | E own-department enforcement (client pin + server 403) | PASS (static) / NOT VERIFIED-live | u43a t3 pins `scope.department_mismatch` by source; live cross-dept denial never exercised |
| 3 | Typed answers + independent attachments + `attachment_required` submit block incl. N/A path (OD-12) | PASS (static) / NOT VERIFIED-live | u43a t5 (incl. N/A-does-not-waive-attachment); no live submit exercised |
| 4 | Documents tab (own-status selection, strip states, documents contract only) | PASS (static) / NOT VERIFIED-live | u43a t7 + t10 (`/api/requirements` + `document_submission` only); no live PATCH exercised |
| 5 | Initiatives tab (own-status selection; initiatives contract only) | PASS (static) / NOT VERIFIED-live | u43a t7 + t10 (`/api/initiatives/department` + `initiative_status` only); no live PATCH exercised |
| 6 | No new answer semantics; UI over existing APIs only (no pickers, no assignment writes, no W-only `assignments/na` shortcut) | PASS | u43a t10 source guards (4 files) + B17 route inventory: 119 legacy, 0 unactivated |
| 7 | No new endpoints (consume queue/items/services/documents/initiatives as-is; view performs no writes) | PASS | u43a t10 (`method\s*:` absent in view) + mounted-dispatcher coverage test ok |
| 8 | Employee-only mount; nav matrix untouched | PASS | u43a t11 |
| 9 | i18n: every `employeeServices` key paired AR/EN, non-empty | PASS | u43a t9 |
| 10 | Status labels reuse gap-analysis vocabulary; disclosure drill in code order; frozen-refusal reactive banner | PASS | u43a t6, t8 + t10 (`isFrozenRefusal`) |
| 11 | `npm run lint` + `npm run build` | PASS | lint exit 0; build exit 0 (vite 778ms) |
| 12 | Full suite green | FLAG (1 pre-existing out-of-scope failure) | 459 tests: 458 pass, 1 fail — G1 `b17TransactionInventory` new-file bound on `src/views/ServicesView.tsx` (875 lines at HEAD; unit (a) never touched it) |
| 13 | Live E-flows on disposable preview (spec UI-7 E-1…E-4) | NOT VERIFIED-live | No harness booted this run (see §Live Assessment). Never PASS by default. |

## Test Results

| # | Command | Result | Detail |
|---|---|---|---|
| 1 | `npm run lint` (`tsc --noEmit`) | PASS | exit 0, no errors |
| 2 | `npm test` (full suite) | 458/459 | 1 fail: G1 new-file bound, `src/views/ServicesView.tsx: new-file bound` (expected true, actual false). Proven pre-existing: file is 875 lines at HEAD, unmodified by this unit (`git diff --name-only` excludes it). Out-of-scope drift from an earlier unit, charged as FLAG not unit FAIL. |
| 3 | `npm run build` (`vite build`) | PASS | exit 0; 1706 modules; only pre-existing chunk-size warning |
| 4 | `npx tsx --test src/lib/u43a.test.ts` | PASS 11/11 | rail grouping, fallback, own-dept pin, counts, submit-block mirror, disclosure drill, docs+inits selection, status labels, i18n pairing, composition guards, mount |

## Live E-Flow Assessment (disposable harness — NOT booted)
- Docker is available and shared stacks were observed read-only via `docker ps` (`b17-showcase` on 127.0.0.1:55432, `b17-p3s-verify`, `u42fix-preview`). **No contact made**: no exec/logs/DB connection against any shared container, port, or volume; `.env` never opened; no secrets handled or recorded.
- A correct live proof needs a bespoke seed+drive script for the U4-3a surface (tenant+dept+service+typed items with `attachment_required`+assignments+document requirements+initiative assignments+E accounts, then drive queue→draft→submit-block→documents→initiatives→cross-dept-409). No such script exists for U4-3a (`u41c-e2e.ts` covers U4-1c flows only; adapting its scratch seed + writing the drive layer is new harness construction with false-verdict risk if rushed).
- Per delegation, live E-1 (typed answers + attachment block), E-2 (documents), E-3 (initiatives), E-4 (cross-dept denial live) are therefore reported **NOT VERIFIED-live** — exact untested scope, never PASS.

## Observations for Tera (FLAG, not FAIL of this unit)
1. Pre-existing suite red: G1 new-file bound already fails at HEAD on `ServicesView.tsx` (875 > 500). Belongs to an earlier unit's drift; recommend a Tera ruling (raise bound vs. split file) outside U4-3a.
2. Pattern note: new U4-3a view files exceed the 500-line discipline the test enforces for older units (`EmployeeServicesView.tsx` 550, `EmployeeItemDetail.tsx` 780) but were added to `allowed`, not `newFiles`, so no bound applies. Tera may wish to extend the bound or accept the exception explicitly.
3. After filing this report, `project-control/qa-reports/TASK-PROTO-U4-3A-QA.md` will appear as untracked outside `reviewerReports` — the next executor must allow-list it exactly (same round pattern as U4-2-FIX P3/P4/P5 QA reports), or G1 will flag it as unapproved write.
4. No secrets, no live/shared-DB contact, no commits, no src edits made by QA. Executor handback (if any) was not used as evidence; all verdicts rest on the git/test/build outputs above.

## Pass/Fail Decision
- **PARTIAL** — static acceptance surface fully PASS (lint, build, u43a 11/11, composition/matrix/source guards); live E-flows E-1…E-4 NOT VERIFIED-live (exact scope above); one pre-existing out-of-scope suite failure flagged, not charged to this unit.

## QA Agent Signature
QA Agent (Execution Mode) — 2026-11-18. Report target: `project-control/qa-reports/TASK-PROTO-U4-3A-QA.md`. No code fixes made (report only, per mandate).