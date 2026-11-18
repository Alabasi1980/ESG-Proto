# TASK-PROTO-U4-2-FIX — Execution contract (phased)

Status: Draft — design APPROVED_FOR_GATE (OD-13 + defaults approved 2026-11-17) · awaiting Build Mode authorization («ابدأ»).
Base: HEAD fd77c04 (clean) · shared DB on PROTECT shape c1f87f04 · app boots (27545).

Governing: `prototype/OWNER_DECISIONS.md` OD-07/11/12/13 · `TASK-PROTO-U4-2.md` §§7–8 · `task-engineering-reviews/TASK-PROTO-U4-2-FIX_TECHNICAL_SPECIFICATION.md` (SDA_REQUIRED, INV-1…10, N-1…N-8) · `STYLE_CONTRACT.md` · `TECHNOLOGY_PROFILE_DRAFT.md`.
Owner-approved defaults (2026-11-17): delete-refused-while-work-exists · reopen notifies dept inbox + `reopened` · copy duplicates attachment bytes · bulk = field subset + per-row versions.

## Phases (one delegation at a time, handback → review → accept before next)

### P1 — DB migration (additive only)
New: `items.version/status/archived_at/archive_reason` · `item_versions` (RESTRICT) · `approved_service_copies` + `approved_copy_files` · RLS/GRANT mirror + audit whitelist additions. No DDL to existing rows (defaults, NOT VALID where needed); GROUP-bucket ensure lazy. Zero-data-loss conditions per DB §DB-6. Verification on isolated harness DB only — **no live shared mutation in P1** (live apply is a separate explicit approval with backup).
Suggested agent: engineering-agent-typescript · Reviewers: Auditor (diff-first) + SecurityAgent (RLS deltas).
**Result 2026-11-17: ACCEPTED.** 3 rounds (build + pin auth + Shield fixes — cap respected, no round 4). Evidence: lint clean · 385/385 · build ok · rehearsal MIGRATED_EQUALS_FRESH + zero loss + CALIBRATION_OK (isolated :55433) · Shield CLOSED-ALL (4/4) · QA PASS (qa-reports/TASK-PROTO-U4-2-FIX-P1-QA.md) · Auditor CONDITIONAL satisfied (C1 QA + C2 Shield evidences on file). Security Disposition: CLOSED (findings fixed + re-verified). Post-Execution Review: PASS (diff in-target, no secrets, no live contact). No live mutation performed.

### P2 — Catalog CRUD API (P-only)
ADD `POST /api/standards`, `POST /api/disclosures`, `POST /api/items/bulk`, `GET /api/items/:id/history`, `DELETE /api/services/:id` (DG-02 preconditions), named-settings validation on `PATCH /services/:id`, version-check + snapshot-on-PATCH and archive-on-DELETE for items. Auth matrix §API-5. Negative tests N-1/N-6/N-7/N-8.
**Result 2026-11-17: ACCEPTED with 2 follow-ups → P4.** 2 rounds. Evidence: 13/13 new tests · 398/398 suite · lint/build clean · Shield PASS (1 Low SHIELD-P2-01 re-audit-on-redundant-archive → documented follow-up, no silent hiding) · QA PARTIAL (zero failures; untested = live handler proof on isolated harness) · Auditor pattern as P1 (static-traceable, QA/Security-gated).
Follow-ups (P4 must close): (F1) live isolated-harness proof of P2+P4 handler paths (archive/reopen/version/seal); (F2) SHIELD-P2-01 re-audit vs idempotent-silent on redundant archive. U-01/U-02 closed on chain+registry evidence + P4 live proof.
Deferred legs confirmed: single-PATCH version+snapshot+reopen → P4 (one txn per spec DB-5); named-settings whitelist → P5 with its UI.

### P3 — Service-scoped import (no client)
`POST /api/import/preview|commit` (+ one-release `/gri/*` aliases), per-service template `GET …/import/template`, column mapping, row-level errors, catalog-only commit (400 on clientId, no provisioning), frozen-skip preserved. Negative test N-5.
**Result 2026-11-17: ACCEPTED with 1 pre-step → P4.** 3 rounds (build/registry/one-line Shield fix — cap respected). Evidence: 11/11 new tests · 408/409 suite (single red = guard registration of reviewer-owned P3 QA report, product green) · lint/build clean · Shield PASS (P3-01 fixed in r3; P3-02 frozen-skip always-0 CONFIRMED as final reading: no tenant ⇒ no determinable freeze; tenant freeze stays enforced on answers/evaluations paths — no bypass) · QA PARTIAL zero-fail (live proof → F1 in P4).
P4 pre-step: allowlist `qa-reports/TASK-PROTO-U4-2-FIX-P3-QA.md` exact path in guard (Tera-owned control artifact), suite green before P4 work starts.

### P4 — History / freeze / approved copy API
PATCH/DELETE reopen+archive paths (answers→`reopened`, `REOPEN_ITEM_SCOPE`), `POST /api/approved-copies/seal` in GE-final txn, `GET …/approved-copy` (works after source deletion). Negative tests N-2/N-3/N-4.
**P4 pre-step:** allowlist `qa-reports/TASK-PROTO-U4-2-FIX-P3-QA.md` exact path in guard → suite green before P4 work.
**P4 must close:** (F1) live isolated-harness proof of P2+P4 handler paths (archive/reopen/version/seal + N-2/N-3/N-4 incl. approved-copy view after source deletion); (F2) SHIELD-P2-01 → emit audit row also on redundant archive (idempotent but tracked) — Tera decision 2026-11-17.
**P4 RLS rule:** ONE narrow branch only — P-config answers UPDATE for the reopen path (plus viewer-read gaps for copy tables ONLY if P1 RLS proves insufficient; verify first, state the finding).
**Result 2026-11-17: ACCEPTED.** 2 rounds (STOP-packet + rulings A/B/C). Evidence: 15/15 new tests · 424/424 suite · lint/build clean · F1 harness green (N3_COMPLETE/N2_REFUSED/N4_VERSIONS/zero-loss/rollback) · Shield PASS (0 blocking; U1/U2 accepted notes) · QA PASS (full) · Auditor CONDITIONAL with 2 Tera-closed conditions: (1) Shield P4 PASS confirmed — verdict PASS, 0 High/Med/Low-blocking, file:line evidence, session ses_e141a51a (no artifact file: review was read-only by design; verdict recorded here); (2) executor semgrep unevidenced → substituted by auditor's independent clean re-scan (zero in P4 hunks), recorded waiver. Ruling B (2nd branch) JUSTIFIED + live-verified. DG-04 notify leg refined: audit-trail + visible reopened status now; inbox push wording/channel → P5 UI decision (needs owner wording). Post-Execution PASS; no live mutation.

### P5 — Services screen correction
Tabs `overview·content·settings·import` (Rules deleted, JSON editor deleted, no client/department controls, bulk-edit bar, history drawer, GROUP/direct rendering, import mapping UX). STYLE_CONTRACT binding; design-reviewer + QA pass. E-1…E-9.

## Global invariants (every phase)
INV-DEF-APP (no client writes from Services) · INV-SINGLE-DEPT · INV-CODE-IMMUTABLE · INV-FREEZE · INV-APPROVED-IMMUNE · INV-HISTORY · INV-IMPORT-SAFE · INV-TENANT-ISOLATION · INV-AUDIT. No secrets in code/logs/reports. No push. No live DB writes without backup + separate explicit approval.

## Pre-Execution Gate Result (FIX program)
| Check | Result | Notes |
|---|---|---|
| Linked to approved scope (OD-13 + §7) | PASS | Exact provenance G-1…G-13 in spec |
| Smallest safe units (P1…P5 sequential) | PASS | One delegation at a time |
| No scope expansion in P1 | PASS | Additive DDL only; no UI/API in P1 |
| Secrets plan redacted | PASS | .env only, never in files |
| Rollback path | PASS | Additive → previous code runs; drop-new-tables fallback |
| SDA_REQUIRED satisfied | PASS | Spec APPROVED_FOR_GATE, DG-01 resolved, no open gap |
| Model: current sufficient with safeguards | PASS | Small units + independent reviewers per phase |

Gate Status: PASS — Build Mode authorized by owner («ابدأ» 2026-11-17).
Defaults approval recorded: AUD-0039 + activity log 2026-11-17 → spec decision now APPROVED_FOR_GATE (DG-01 resolved by Tera mapping; DG-02…DG-06 defaults approved as written above).
Required Action: delegate P1 only.

## P2 Pre-Execution Gate Result (2026-11-17)
Smallest safe unit PASS (catalog CRUD + item version/archive paths only; import/history-viewer/seal stay P3/P4) · one objective PASS · no deferrable work PASS · no secrets PASS · rollback PASS (code revert; no DDL in P2) · acceptance testable PASS (N-1/N-6/N-7/N-8 + matrix 403s).
Gate Status: PASS → delegate P2.

## P3 Pre-Execution Gate Result (2026-11-17)
Smallest safe unit PASS (import path only: preview/commit aliases + template + mapping + catalog-only commit; no catalog CRUD changes, no history/seal) · one objective PASS · no secrets PASS · rollback PASS (code revert; no DDL in P3) · acceptance testable PASS (N-5 + row-level errors + zero-provisioning proof).
Gate Status: PASS → delegate P3.

## P4 Pre-Execution Gate Result (2026-11-17)
Smallest safe unit PASS (history viewer + PATCH reopen + seal + copy viewer + F1/F2 only; import/catalog/screen untouched) · one objective PASS · no secrets PASS · rollback PASS (code revert; ONE narrow additive RLS branch, drop-policy fallback) · acceptance testable PASS (N-2/N-3/N-4 + live harness + matrix).
Gate Status: PASS → delegate P4.

## P5 Pre-Execution Gate Result (2026-11-17)
Smallest safe unit PASS (Services screen correction only; no API/DB changes — P1→P4 endpoints consumed as built) · one objective PASS · no secrets PASS · rollback PASS (code revert) · acceptance testable PASS (E-1…E-9 + design-reviewer + QA) · design source: TASK-PROTO-U4-2 screen + spec UI module (no new visual language) · UI acceptance per UI_ACCEPTANCE_GATE + STYLE_CONTRACT.
Gate Status: PASS → delegate P5 (ui-designer, then design-reviewer + QA).

## فهم القرار
فهمي: الإصلاح خمس مراحل متسلسلة تبدأ بالقاعدة (إضافية فقط، بلا مساس بالحيّ) ثم الواجهات البرمجية ثم الشاشة، وكل مرحلة تُقبل قبل التالية.
الافتراضات المفتوحة: لا شيء تقني — الافتراضات الأربعة اعتمدها المالك.
ما سيكشفه الاعتماد: أن أول تفويض (P1) يبدأ فور «ابدأ» بلا أسئلة إضافية.
