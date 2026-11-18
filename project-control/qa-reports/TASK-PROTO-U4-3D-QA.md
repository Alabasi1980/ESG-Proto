# Test Report - TASK-PROTO-U4-3d

## Task Information
- **Task:** TASK-PROTO-U4-3d - Staff backend + P UI removal (G3 UI-removal-only; WF-01 preserved)
- **QA:** QA Agent Execution Mode (2026-11-18, independent clean run)
- **Env:** Windows 10.0.26300 / Node v22.22.2 / npm 12.2.2 / tsc via npm run lint / vite 8.3.7
- **Contract:** project-control/tasks/TASK-PROTO-U4-3/TASK-PROTO-U4-3.md (unit-d acceptance) + program spec TASK-PROTO-U4-3_TECHNICAL_SPECIFICATION.md (UI-4 + WF-01 + API-5 + E2E P-1)
- **Scope discovery (SCP-2026-08-16-001):** git status = 6 modified + 1 untracked (src/lib/u43d.test.ts); git diff --stat = 6 files (contract pre-step + translations + navModel + navModel.test + StaffListsView + b17 guard pins); no server/db/style paths touched; routes untouched per G3.

## Acceptance Criteria Verdicts

| # | Criterion (governing source) | Verdict | Independent Evidence |
|---|---|---|---|
| D1 | P provisioning UI absent: no approve/reject/provision/OTP affordances in StaffListsView (UI-4, E2E P-1 first half) | PASS | u43d.test.ts 4/4 (D1 pin green); git diff confirms removal: handleApprove/handleReject/lastOtps/rejectReason/KeyRound/OTP panel/approve+reject buttons deleted; grep-equivalent pins in test green |
| D2 | Read-only directory intact: lists fetch + draft submit + empty/refresh/badges/rows (UI-4) | PASS | u43d D2 pin green; view still calls GET /api/staff-lists + POST /:id/submit, keeps emptyText/statusLabels/refresh/rows.map |
| D3 | Read-only copy AR+EN replaces provisioning wording; W-ownership noted (UI-4/UI-6) | PASS | u43d D3 pin green; translations diff EN Read-only staff-list directory + AR read-only subtitle, both verified in git diff |
| D4 | UI-only: no server transaction / audit / server-db import; no secrets (global invariants) | PASS | u43d D4 pin green (no domainTransaction/recordAuditLog/server-db import); git diff --name-only HEAD shows zero src/server + zero src/db paths |
| D5 | Routes untouched per G3 UI-removal-only (emergency path stays audited, matrix-enforced) | PASS | git diff confirms no src/server/routes change; StaffListsView makes zero /approve /reject calls post-change |
| D6 | W surface unaffected (console Staff tab owns provisioning); P keeps page read-only; nav hides W staff-lists row | PASS with note | navModel.ts diff: W staff-lists row hidden (comment: console Staff tab covers it; P keeps page); navModel.test updated + green in full suite; standing-authority path, minimal 1-row change |
| D7 | Full suite + lint + build hygiene | PASS (sole red = pre-existing approved W-P5-01) | lint exit 0; build exit 0 (vite 1718 modules); full suite 503/504 pass 1 fail = G1 new-file bound ServicesView.tsx 875 lines, unmodified by (d), matches standing approved deviation W-P5-01 |
| D8 | Live proof: P sees no provisioning affordances; direct approve 403+audit; W/C flows unaffected on disposable preview + browser (E2E P-1 full, Tera-owned) | NOT VERIFIED-live | No preview bootable by QA in this run; forbidden surface (127.0.0.1:55432 / b17-showcase / .env) never touched; per delegation live proof is Tera-owned |

## Test Results

| # | Command | Result | Detail |
|---|---|---|---|
| 1 | npm run lint (tsc --noEmit) | PASS exit 0 | no output errors |
| 2 | npx tsx --test src/lib/u43d.test.ts | PASS 4/4 exit 0 | 4 pass 0 fail |
| 3 | npm test (full) | 503/504 exit 1 | sole fail G1 new-file bound ServicesView.tsx (875 lines, pre-existing approved W-P5-01, untouched by (d)) |
| 4 | npm run build (vite build) | PASS exit 0 | 1718 modules, built in ~780ms |
| 5 | Playwright E2E | SKIPPED | no tests/ dir, no playwright.config, no @playwright/test in devDeps; per-procedure step excluded |

## Playwright E2E Summary
- **Status:** SKIPPED (no E2E harness in repo)
- **Axe accessibility:** NOT APPLICABLE (no E2E harness; no new form/interactive surface beyond removal)

## Scope Drift Check (independent)
- Modified: TASK-PROTO-U4-3.md (U4-3d gate note only), translations.ts (subtitle AR+EN), navModel.ts + navModel.test.ts (W staff-lists hidden + pin), StaffListsView.tsx (removal), b17TransactionInventory.test.ts (allowlist u43d pin + c2 screenshot pre-step exact path).
- Untracked: src/lib/u43d.test.ts (the (d) pin file itself).
- No scope drift outside (d): zero server/db/style/secret/commit/push/live contact.
- Note D6: nav hide is a 1-row W-nav change consistent with program (W owns console Staff tab; P retains read-only page); recorded as in-scope, not drift.

## Pass/Fail Decision
- **Overall: PARTIAL (zero-fail, exact untested scope = live disposable-preview proof D8).**
- Static + unit + hygiene surface: PASS (D1-D7).
- D8 stays NOT VERIFIED-live (never PASS by QA); Tera-owned close required before ACCEPTED.
- No code fix attempted (report only, per mandate).

## Full Output (abridged)
- lint: EXIT 0
- u43d: TAP 4 pass 0 fail, EXIT 0
- full: tests 504 / pass 503 / fail 1 (not ok 103 G1 byte-unchanged: ServicesView.tsx new-file bound), EXIT 1
- build: vite built 1718 modules, EXIT 0

## QA Agent Signature
- QA Agent (Execution Mode), 2026-11-18, independent verification; Executor statements treated as context only.


