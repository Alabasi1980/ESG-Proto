# Test Report — TASK-PROTO-U4-1c-PROTECT round 2 (revised direction §17/§18)

## Task Information
- **Task:** TASK-PROTO-U4-1c-PROTECT — unselect-always-permitted + preservation (SET NULL) + version protocol + `initiatives.unselected` notice
- **Tester:** QA Agent (Execution Mode), session NEW, independent (no prior session context)
- **Date:** 2026-11-17 · **HEAD:** `4eb36e95480ac4a7b24227bf29b99414ea90d5aa` (matches expected `4eb36e9`)
- **Scope drift check:** `git status` shows only the §19-known inputs (task file, designer delta, round-3 QA/Shield reports, round-2 audit report, round-1→2 revised source/test/script files) plus routine `PROJECT_ACTIVITY_LOG`/`TERA_AUDIT_TRAIL` appends. No foreign changes — **no STOP**. `src/views/` untouched (zero diff).
- **Own scratch:** fresh disposable PG18 container `u41c-qa1-scratch` → DB `u41c_protect_71`, roles `u41cowner` (NOSUPERUSER/NOBYPASSRLS) + throwaway superuser pw; explicit opt-in; loopback only. Implementer containers/DBs never touched. No live/shared DB, no secrets in repo, no installs, no commits.

## References read
Conduct gate; task §§7–18 (plus §19 baseline); delta §§2,4,7 (full doc skimmed); `TECHNOLOGY_PROFILE_DRAFT.md`; `OWNER_DECISIONS.md` OD-07/11/12 — **OD-13 does not exist** in that file (minor reference gap, no verdict impact); `InitiativesView.tsx` ll.68–87,110–115; changed routes/libs/tests; implementer harness (read-only execution).

## Test Results

| # | Criterion (brief) | Result | Evidence |
|---|---|---|---|
| 1 | Unselect always permitted for authorized W; statuses+evidence preserved readable (SET NULL, no cascade) | ✅ PASS | Own harness run: `DELETE …/select` → 200; 2/2 statuses kept (`client_initiative_id NULL`), evidence bytes identical, list drops initiative, exactly +1 `INITIATIVE_UNSELECTED` audit |
| 2 | Detached-status write refused with EXACT wording + code `initiatives.unselected` (409) | ✅ PASS | `PATCH` detached → 409 deepEqual `{error:«هذه المبادرة لم يعد اختيارها سارياً لهذا العميل. يرجى تحديث القائمة قبل المتابعة.», code:initiatives.unselected}`; evidence upload on detached → 404; refusals add no audit; preserved file still downloads byte-identical |
| 3 | Version protocol: first-valid-wins with approved stale message; missing version 400 `version.required` | ✅ PASS | Same-version races (documents + initiatives) → `200,409`; stale → 409 `version.conflict` + «تغيّرت البيانات منذ فتحها. يرجى تحديثها ومراجعة التعديلات قبل الحفظ.»; missing/negative/fractional/overflow/string → 400 `version.required` baseline wording |
| 4 | Adversarial matrix rerun (own script, real routes, observed locks) | ✅ PASS | E/C unselect → 403 zero-write; foreign-tenant unselect → 403 zero-write; concurrent first-select → one insert + one `alreadySelected`, single row, both audited; delete-wins-then-submit commits (v2, stamp set, file gone); E1 list shows only D1 rows |
| 5 | Full suite green on own scratch | ✅ PASS | `npm run lint` (tsc) clean; `npm test` **372/372 pass, 0 fail**; harness 8/8 PASS; extras 5/5 assertions green |
| 6 | No UI change required; InitiativesView surfaces server error unchanged | ✅ PASS (static) | Zero `src/views/` diff; `toggleSelect` throws `data.error` verbatim into shared error box (ll.79–83,110–115). No live UI click executed — static only |
| 7 | Freeze rules preserved | ⚠️ STATIC ONLY | `isFrozenScope` checks intact pre+post anchor in POST/DELETE (ll.154/161/182/192); live freeze trigger (GE-final flow) NOT executed → NOT VERIFIED live |

## NOT VERIFIED (explicit, not PASS)
- Live/GE-final freeze trigger path; deployed-role/ACL equivalence (surrogate-role proof only, same bound as implementer); installed/live orphan inventory (no live access by design — committed CASCADE shape makes orphans impossible, upgrade proved byte-parity); OD-13 reference (nonexistent file).
- Freeze/orphan bounds above do not fail the unit: code paths unchanged, upgrade rehearsal green.

## Forbidden-action compliance
No source/test edits, no UI/other-file writes, no DB/live contact outside own scratch, no installs, no commits, no network exfil, no subagents. Only new file: this report.

## Pass/Fail Decision
- ✅ **PASS** — all 7 executed/static criteria green on independent scratch; 372/372 unit + 8/8 harness + 5/5 extras. Gaps above are bounded NOT-VERIFIED items, none blocking this unit. No parent acceptance issued (parent remains ESCALATED per task §7).

## Full Output (abridged)
```text
B17_SHAPE=37a454f2d8292e1ffe6b71f063a61add B17_CONTENT_SHAPE=dfcc24a6e364ffe25422f38985d553b2 CONTENT_SHA=4ff0f31c…
PASS upgrade rehearsal: committed(CASCADE) -> revised(SET NULL) with zero data loss + fresh/upgrade byte parity
PASS stale/missing/invalid versions fail closed with the two approved messages
PASS second writer observably waits on the canonical anchor (no sleep)
PASS same-version loser conflicts with the approved stale message; first valid save wins
PASS unselect preserves all statuses/evidence (submitted + drafts); list drops it; audit +1
PASS detached writes get exactly 409 initiatives.unselected; evidence upload 404s; download still works
PASS ABA guarded: stale ID never attaches; reselect + fresh create work; detached rows intact
PASS owner evidence lock intact; empty unselect keeps serial semantics
PASS E/C unselect denied 403 with zero writes
PASS foreign-tenant unselect refused 403 with zero writes
PASS concurrent first-select: one insert + one alreadySelected, single row, both audited
PASS delete-wins-then-submit commits cleanly; lock only blocks post-submit delete
npm test: 372 pass, 0 fail · tsc: clean
```

## QA Agent Signature
QA Agent (Execution Mode) — 2026-11-17 — independent scratch `u41c_protect_71` (destroyed after run; container retained for Tera disposal decision — see handback).