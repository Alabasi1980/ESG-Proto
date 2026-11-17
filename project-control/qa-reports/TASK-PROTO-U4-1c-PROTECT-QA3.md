# Test Report — TASK-PROTO-U4-1c-PROTECT-QA3 (round-4, independent)

## Task Information
- **Task:** TASK-PROTO-U4-1c-PROTECT round 4 (§23: archived-write refusal + guard allowlist + M-01 fail-closed + re-verification)
- **Tester:** QA Agent (Execution Mode), Session NEW, independent (no prior session context)
- **Date:** 2026-11-17 · **HEAD:** `4eb36e95480ac4a7b24227bf29b99414ea90d5aa` (matches expected `4eb36e9`)
- **Scope drift:** `git status` = 18 modified + 7 untracked, all §19-known + §§20–23-authorized (task file, designer delta, round-3 QA/Shield reports, round-1/2 audit report, revised source/test/script files, own scratch harness) plus routine Tera-owned activity-log appends (2 lines each). No foreign changes — **no STOP**. `src/views/` zero diff (no UI change).
- **Own scratch:** disposable PG18.6 container `u41c-qa3-scratch` → DB `u41c_protect_73`, role `u41cowner` NOSUPERUSER/NOBYPASSRLS (verified `rolsuper=f, rolbypassrls=f`), FORCE RLS via schema; explicit opt-in (`--allow-disposable-b17`, named loopback DB, no ambient `DATABASE_URL`/`JWT_SECRET`/`PG*`); generated throwaway creds in TEMP only (deleted); implementer containers/DBs never touched; no live/shared/production DB or credentials. Container + creds destroyed after run.

## References read
Conduct gate (`tera-system/TERA_AGENT_CONDUCT.md`, passed); task §§17–23; delta §§1–8 (full skim); `TECHNOLOGY_PROFILE_DRAFT.md`; `OWNER_DECISIONS.md` OD-07/11/12 — **OD-13 absent on disk** (reference gap, no verdict impact); changed routes/libs/tests; implementer harness `scripts/u41c-protect-scratch.ts` (read-only execution); SEC1/SEC2 + AUD01 (static, read-only).

## Test Results (all on OWN scratch, real routers, observed locks)

| # | Criterion | Result | Independent evidence |
|---|---|---|---|
| 1 | Round-4 archived-evidence block: upload on archived → 404 `evidence.not_found`; delete on archived → 404; no audit; bytes preserved; proof stays downloadable | PASS | Harness: `upArc 404 evidence.not_found`, `delArc 404 evidence.not_found`, `files=1` unchanged, refusals `+0 audit`, download `200 'submitted-b'` |
| 2 | Live post-submit evidence lock: append allowed, delete refused | PASS | Live delete `409 evidence.locked` (harness, real route); upload path has no `submitted_at` refusal in `documents.ts` (static) — append stays open; prior round-2 behavioral proof stands |
| 3 | Version protocol + exact approved wording | PASS | Stale → `409 version.conflict` + byte-identical `تغيّرت البيانات منذ فتحها. يرجى تحديثها ومراجعة التعديلات قبل الحفظ.`; missing/non-integer/negative/fractional/overflow → `400 version.required` baseline; first-valid-wins (`200,409`, observed anchor wait, no sleep) |
| 4 | Reselect path reconnects history, no duplicates | PASS | POST reselect `alreadySelected:false`, SAME selection ID, still 1 row, 2/2 statuses attached, PATCH `v2→v3`, no duplicate status row |
| 5 | Freeze rules | PASS (live) | Frozen tenant unselect → `409 scope.frozen`, zero writes, `+0 audit` (snapshot rows immutable, run last) |
| 6 | Upgrade/rollback zero data loss + fresh/upgrade parity | PASS | Committed CASCADE + seed → working-tree upgrade: statuses/evidence/audit byte-identical, checksum converges to fresh fingerprint; downgraded shape differs (falsifiable) |
| 7 | Migration fingerprint unchanged where claimed | PASS | Harness fresh `B17_SHAPE=c9d5a9e24ec9bf9128d17822d9f1ed1a`, `B17_CONTENT_SHAPE=c1f87f043bffa8ad3c939c7993f2ab2e`, `CONTENT_SHA=8c165c40…` — identical to round-3 QA2 values and `b17Readiness.ts` constants; no schema move in round-4 beyond round-3 |
| 8 | Full suite green (`lint` + `test`) before this report existed | PASS | `npm run lint` (tsc) clean; `npm test` **372/372 pass, 0 fail** |
| 9 | Guard allowlist covers the two round-3 review reports | PASS | `b17TransactionInventory.test.ts` reviewer-set now includes `PROTECT-QA2.md` + `PROTECT-SEC2.md` (the QA2 FAIL-10 staleness is closed) |

## Playwright E2E Summary
- **Status:** SKIPPED — no Playwright harness in this repo (`tests/` + `playwright.config.*` absent); the authorized behavioral proof is the real-router scratch harness above (HTTP + barrier/lock observation), which is stronger than a UI click-path for this DB/state-machine unit. UI surface (`InitiativesView` error box) unchanged — static only, no live UI run.

## NOT VERIFIED (explicit, not PASS)
- Deployed-role/ACL equivalence (surrogate-role proof only, same bound as implementer); installed/live orphans (no live access by design); pool-max-5 deadlock; UI `archived` display (static only: `InitiativesView` renders server error text unchanged); E/C unselect + foreign-tenant unselect 403 paths (not exercised by the round-4 harness; pre-existing matrix, unchanged); OD-13 (nonexistent reference).
- Procedural: this new QA3 report path is not yet in the G1 `reviewerReports` allowlist, so a future `npm test` will flag it exactly as QA2/SEC2 were flagged — implementer must allowlist this exact path (Tera decision, QA cannot edit).

## Forbidden-action compliance
No source/test/control/reviewer edits; no installs/commits/push/deploy/subagents; no live/shared/prod DB, credentials, or network exfil (one harness echo printed throwaway scratch URLs — loopback-only container destroyed, creds deleted, redacted here). Only new file: this report.

## Pass/Fail Decision
- **PASS** — all 9 executed criteria green on independent scratch (harness 13/13 + 372/372 unit + lint clean). M-01 (SEC2) is closed behaviorally: archived evidence writes fail closed with the existing 404, no new wording. Gaps above are bounded NOT-VERIFIED items, none blocking this unit. No parent acceptance issued (parent remains ESCALATED per task §7; collision unit separate).

## Full Output (abridged, secrets redacted)
```text
B17_SHAPE=c9d5a9e24ec9bf9128d17822d9f1ed1a B17_CONTENT_SHAPE=c1f87f043bffa8ad3c939c7993f2ab2e CONTENT_SHA=8c165c40…
PASS upgrade rehearsal: committed(CASCADE) -> revised(archive+RESTRICT) with zero data loss + fresh/upgrade byte parity
PASS stale/missing/invalid versions fail closed with the two approved messages
PASS second writer observably waits on the canonical anchor (no sleep)
PASS same-version loser conflicts with the approved stale message; first valid save wins
PASS unselect archives in place; lists re-show it archived with full history; audit +1
PASS archived writes fail closed (baseline 404, no audit); preserved proof stays downloadable
PASS reselect reconnects history on the same ID with zero duplication
PASS unselect observably waits on the anchor (no sleep); sole waiter commits first
PASS unselect-vs-submit both orders preserve data; waiter fails closed without overwrite
PASS archive UPDATE is load-bearing on b17_selection_update (0 rows without it, rolled back)
PASS owner evidence lock intact on the live row
PASS RESTRICT refuses hard delete only when linked records exist
PASS freeze rules hold live: frozen scope refuses archive with zero writes
npm test: 372 pass, 0 fail · tsc: clean
```

## QA Agent Signature
QA Agent (Execution Mode) — 2026-11-17 — independent scratch `u41c_protect_73` (destroyed; container removed; creds deleted).
