# Test Report — TASK-PROTO-U4-1c-PROTECT-QA2 (round-3 archive-flag, independent)

## Task Information
- **Task:** TASK-PROTO-U4-1c-PROTECT — round-3 archive-flag (§20) + §21 single UPDATE policy
- **Tester:** QA Agent (Execution Mode), Session NEW, independent
- **Date:** 2026-11-17 · **HEAD:** `4eb36e9` (matches expected `4eb36e9`)
- **Scope drift:** `git status` = §19-known modified (18) + untracked task/delta/PROTECT-QA/AUD01/SEC1/scratch + NEW `SEC2.md` (Shield round-3, 09:43 today, report-set — no STOP) + routine activity-log appends. `src/views/` zero diff. No live/shared DB touch; implementer containers untouched.
- **Own scratch:** disposable PG18 `u41c-qa2-scratch` → DB `u41c_protect_72`, roles `u41cowner` NOSUPERUSER/NOBYPASSRLS + throwaway superuser pw; explicit opt-in; loopback only; FORCE RLS via schema; destroyed after run (creds in TEMP only, deleted).

## References read
Conduct gate; task §§7–21; delta §§1–8; `TECHNOLOGY_PROFILE_DRAFT.md`; `OWNER_DECISIONS.md` OD-07/11/12 — **OD-13 absent on disk** (reference gap, no verdict impact); `initiatives.ts`; harness `u41c-protect-scratch.ts`; SEC2 (static, read-only).

## Results

| # | Criterion | Verdict | Evidence (own scratch) |
|---|---|---|---|
| 1 | Archive preserves all statuses/evidence incl. drafts | ✅ PASS | DELETE → 200; 2/2 kept (submitted v2 + draft), same selection ID, evidence bytes identical, lists re-show `archived:true` with history, audit exactly +1; idempotent repeat 200 +0 audit |
| 2 | Reselect reconnects, no duplicates | ✅ PASS | POST → 200 `alreadySelected:false`; SAME row ID, still 1 selection row, 2/2 attached, PATCH v2→v3, no duplicate status row |
| 3 | No silent delete/overwrite; version first-wins | ✅ PASS | Same-version races → `200,409`; stale → 409 `version.conflict` + owner Arabic (§13); 2nd writer observably waits on canonical anchor; unselect-vs-submit both orders preserve data, loser 404s |
| 4 | Version protocol + exact owner wording | ✅ PASS | Stale Arabic byte-identical `تغيّرت البيانات منذ فتحها. يرجى تحديثها ومراجعة التعديلات قبل الحفظ.`; missing/non-int/negative/fractional/overflow → 400 `version.required` baseline; `initiatives.unselected` retired per §20 (archived PATCH → baseline 404 `scope.not_found`, no audit) |
| 5 | Freeze rules | ✅ PASS (bounded) | Live: frozen tenant unselect → 409 `scope.frozen`, zero writes, +0 audit. L-02 (no freeze on PATCH/evidence) pre-existing, unchanged — out of scope |
| 6 | Scope/tenant isolation | ⚠️ BOUNDED PASS | Observed: E2 sees own-dept only; C status PATCH 403 zero-write; cross-tenant `clientId` → 400 `initiatives.field_refused`; fabricated ID 404. E/C unselect 403 + foreign-tenant unselect NOT exercised by round-3 harness → NOT VERIFIED (no claim) |
| 7 | Migration parity fresh-vs-upgraded | ✅ PASS | Committed CASCADE+seed → working-tree upgrade: zero data loss, byte parity, converges to fresh fingerprint; RESTRICT named, `archived_at` NULL-able, link NOT NULL |
| 8 | Rollback / no-partial-write | ✅ PASS | Without `b17_selection_update` archive UPDATE = silent 0 rows (rolled back, policy intact); with policy exactly 1 row; refused hard delete preserves link; empty selection deletes cleanly |
| 9 | Audit completeness | ✅ PASS | +1 on select/archive/reselect-path; +0 on refusals/idempotent repeat; in-transaction with versions |
| 10 | Full suite green (`lint` + `test`) | ❌ FAIL | `lint` clean; `test` **371/372** — `not ok 103` G1: `Unapproved write: security-reports/TASK-PROTO-U4-1c-PROTECT-SEC2.md` (pin allows SEC1, not the new SEC2). No behavior failure; pin staleness only — implementer must remeasure, QA cannot edit |
| 11 | SEC2 M-01 evidence-on-archived | 🛑 DECISION BLOCK | Harness PROVES append+delete on archived link stay permitted while status PATCH 404s (consistent run). SEC2 rates this MEDIUM inconsistency — accept append-on-archived or add active-selection predicate (existing 404). Blocks acceptance until Tera/Majed decides |

## NOT VERIFIED (explicit, not PASS)
E/C unselect 403 paths; foreign-tenant unselect; deployed-role/ACL equivalence (surrogate-role only); installed/live orphans; pool-5 deadlock; UI `archived` display (static only); OD-13.

## Forbidden-action compliance
No source/test/control/reviewer edits; no installs/commits/push/deploy/subagents; no live/shared/prod DB or credentials (throwaway scratch only; one npm-notice echoed throwaway URLs — container destroyed + creds deleted, no live secret). Only new file: this report.

## Verdict
- ❌ **FAIL** — behavioral proof 12/12 PASS on independent scratch, but criterion 10 fails (371/372 pin) and M-01 needs an owner decision. No parent acceptance issued (parent remains ESCALATED; collision unit separate).

## Full Output (abridged, secrets redacted)
```text
B17_SHAPE=c9d5a9e24ec9bf9128d17822d9f1ed1a B17_CONTENT_SHAPE=c1f87f043bffa8ad3c939c7993f2ab2e
PASS upgrade rehearsal: committed(CASCADE) -> revised(archive+RESTRICT) zero loss + byte parity
PASS stale/missing/invalid versions fail closed with the two approved messages
PASS second writer observably waits on the canonical anchor (no sleep)
PASS same-version loser conflicts with approved stale message; first valid save wins
PASS unselect archives in place; lists re-show archived with history; audit +1
PASS archived writes fail closed (baseline 404, no audit); evidence appendable + downloadable
PASS reselect reconnects history on same ID, zero duplication
PASS unselect-vs-submit both orders preserve data; waiter fails closed
PASS archive UPDATE load-bearing on b17_selection_update (0 rows without, rolled back)
PASS owner evidence lock intact on live row
PASS RESTRICT refuses hard delete only with linked records
PASS freeze rules hold live: frozen scope 409 scope.frozen, zero writes
npm test: 371 pass, 1 fail (G1 SEC2 allowlist) · tsc: clean
```

## QA Agent Signature
QA Agent (Execution Mode) — 2026-11-17 — scratch `u41c_protect_72` + container destroyed; creds deleted.
