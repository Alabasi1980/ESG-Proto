# Test Report — TASK-PROTO-U4-2-FIX P3 (service-scoped import, no client)

## Task Information
- **Task:** TASK-PROTO-U4-2-FIX P3 — Service-scoped import (`POST /import/preview|commit` + one-release `/gri/*` aliases, per-service template, column mapping, row-level errors, catalog-only commit)
- **Contract:** `project-control/tasks/TASK-PROTO-U4-2-FIX/TASK-PROTO-U4-2-FIX.md` (P3 section + P3 Pre-Execution Gate, 2026-11-17)
- **Agent:** QA Agent (Execution Mode), clean session, contract + tests read from disk
- **Date:** 2026-11-17
- **Environment:** Windows (win32/PowerShell 5.1), Node v22.22.2, vite v8.3.7, suite runner `tsx --test src/**/*.test.ts`
- **Forbidden respected:** no contact with 127.0.0.1:55432, no `.env`/secrets access, no src/test edits, no commits, no secrets in report

## 1. Independent Scope Discovery (SCP-2026-08-16-001)
- `git status --short` (actual): modified = contract doc (+P3 gate block), `src/lib/b17TransactionInventory.test.ts`, `src/lib/capabilities.test.ts`, `src/lib/domainAccess.test.ts`, `src/lib/griParser.ts`, `src/lib/routeGates.test.ts`, `src/server/accessRegistry.ts`, `src/server/routes/gri.ts`; untracked = `src/lib/u42fix-p3.test.ts` (new).
- `git diff --stat HEAD`: 8 files, 511 insertions / 234 deletions; `gri.ts` is the bulk (import-handler rewrite).
- Scope-drift check (own diff review, not executor claim): the four touched test files are P3-consequential pins only — route counts 113→116 / 105→108 flipped / registry 117→120, commit matrix P@T→P, BF-01 tenant-lock/freeze-recheck assertions replaced with absence assertions (+spec citation), inventory hash + allow-list re-pinned for `griParser.ts` + `u42fix-p3.test.ts`. **No out-of-scope drift found.**
- Executor statements treated as context only; every verdict below rests on the command outputs in §2.

## 2. Commands Executed (Independent Evidence)
| # | Command | Result |
|---|---|---|
| 1 | `npm run lint` (`tsc --noEmit`) | ✅ PASS — exit 0 (`LINT_EXIT:0`), no type errors |
| 2 | `npm test` (full suite) | ✅ PASS — **409 pass / 0 fail** / 0 skipped (`# pass 409`, `# fail 0`); includes P3 tests ok 328–338 (11/11) |
| 3 | `npm run build` (`vite build`) | ✅ PASS — exit 0 (`BUILD_EXIT:0`), 1696 modules, built in ~800ms (only pre-existing chunk-size + `__dirname` warnings) |
| 4 | `npx tsx --test src/lib/u42fix-p3.test.ts` (project runner; raw `node --test` cannot parse the repo TS — expected, NOT a failure) | ✅ PASS — **11 pass / 0 fail** |

## 3. Per-Criterion Verdicts (P3 acceptance surface)
| # | Criterion (contract §P3) | Verdict | Evidence (independent) |
|---|---|---|---|
| C1 | ServiceId-only commit (explicit `serviceId` mandatory; missing→400, malformed→400) | ✅ PASS | P3 tests 7, 10 pass; gri.ts lines verified: `scopeId(body.serviceId, true)` in preview, `scopeId(rawId, true)` + `text/csv` in template handler |
| C2 | clientId → 400 `import.client_forbidden` (negative test N-5) | ✅ PASS | P3 test 8 passes; gri.ts verified: `hasImportClientScope` checks body+query on preview/commit/template, `importClientForbidden` returns 400 + code; refusal precedes txn in commit handler |
| C3 | Zero provisioning (no departments/assignments/tenant writes) | ✅ PASS | P3 test 8 passes (banned tokens absent from commit body: `departmentsUpserted`, `assignmentsCreated`, `INSERT INTO departments`, `INSERT INTO assignments`, `normalizeDepartmentCode`, `liveImportTenant`, … file-wide); template/commit/preview carry no tenant selector |
| C4 | Row-level errors (row + column + code + message; rows stay previewable; commit refuses pre-txn) | ✅ PASS | P3 tests 2, 5 pass (parser N-5 + validator fail-closed incl. `import.bad_standards`); gri.ts `validateCommitStandards` runs before txn open |
| C5 | Unmapped-columns reporting (never silent; mapping consumes headers) | ✅ PASS | P3 tests 3, 4, 11 pass (`resolveUnmappedColumns`, `ImportColumnMapping`, additive-only vocabulary) |
| C6 | Auth denials (P-only; W/C/E → 403 `workspace.mode_mismatch` on registered aliases) | ✅ PASS | P3 test 6 passes (exact matrices `P#authenticate-before-upload-parser`, `P#service-scoped-catalog-commit-alias-no-client`, `P#fetch-with-auth-tab-then-download`); canonical `/import/*` declarations carry `authMiddleware + requireDomainAccess + validateGriIds` (test 7) |
| C7 | Per-service template route + frozen-skip per spec (no tenant ⇒ no determinable freeze; `skippedFrozen = 0`, no tenant-keyed freeze query) | ✅ PASS | P3 tests 9, 10 pass; no `SELECT is_scope_frozen` / BF-01 lock on the catalog path (routeGates pin updated with spec rationale) |

## 4. Overall Decision
- **PARTIAL** — zero failures across all statically verifiable criteria (C1–C7 PASS, lint/build/suite green), with exactly one documented untested part (NOT VERIFIED, not a silent gap):
  - **Untested:** live isolated-harness handler proof — real HTTP preview/commit/template against a scratch DB with a real `serviceId` (end-to-end 400-on-clientId over the wire, real catalog rows written, real CSV download). The P3 test file itself declares this out of scope for the no-DB suite ("Live-handler proof stays with QA on the isolated harness"), and live/shared DB contact is forbidden to this run. Same standing as P2 QA PARTIAL precedent.
- No FAIL. No code fix attempted (report only, per mode).

## 5. Full Output (excerpts; complete logs retained by tool harness)
- lint: `tsc --noEmit` clean, exit 0.
- full suite tail: `# tests 409 / # pass 409 / # fail 0`, incl. `ok 328–338` P3 block.
- P3 isolated: `1..11`, `# pass 11 / # fail 0`.
- build: `✓ built in ~800ms`, exit 0.
- direct `node --test` on the TS file fails with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` (expected — repo TS requires the `tsx` runner; recorded here so it is not mistaken for a test failure).

## QA Agent Signature
2026-11-17 — Execution Mode, independent run. Report-only; acceptance decision rests with Tera.
