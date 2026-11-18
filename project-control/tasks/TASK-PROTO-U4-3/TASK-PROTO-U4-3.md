# TASK-PROTO-U4-3 — Contextual screens + client application + staff relocation

Status: Design APPROVED_FOR_GATE (spec + owner approvals 2026-11-18) · Build Mode authorized («ابدأ U4-3» + «اعتمد توصياتك»).
Base: FIX program CLOSED (shared migrated, app boots new code).

Governing: `prototype/OWNER_DECISIONS.md` OD-11 (role matrix) / OD-12 (typed answers, independent attachments, dept documents, initiatives, tags) / OD-13 (single-dept, history, immunity) · `prototype/B17_UI_BINDINGS.md` §10 + staff matrix (as amended: C fills, W provisions+delivers) · `task-engineering-reviews/TASK-PROTO-U4-3_TECHNICAL_SPECIFICATION.md` (SDA_REQUIRED program spec) · `STYLE_CONTRACT.md` · `TECHNOLOGY_PROFILE_DRAFT.md`.
FIX APIs consumed unchanged (catalog, import, history, reopen, seal, copy-viewer, settings whitelist, visibility mask, documents, evidence, dept initiatives, assignments, answers, evaluations, approvals).

Owner decisions 2026-11-18 (binding):
- G1: reveal-only now (one-time credential display to C; C relays). Email integration deferred until owner supplies SMTP.
- G2: N/A at disclosure OR item level, reason mandatory, excluded from aggregates, W-only set/lift.
- G3: P provisioning UI-removal-only; routes stay audited for emergency.
- G4: dept auto-match by code + manual override.
- G5–G7: spec proposed defaults apply unless owner objects.

## Phases (one delegation at a time, handback → review → accept before next)

### a. Employee services workspace
Dept services → items (typed answers + independent attachments + mandatory-attachment enforcement) + documents tab + initiatives tab; reuse FIX patterns (drill, drawer, banners). No new answer semantics. E own-department only (existing matrix).
Suggested agent: ui-designer · Reviewers: design-reviewer + QA (E-flows live on disposable preview).
**Result 2026-11-18: ACCEPTED with waiver → (b) pre-step.** 2 rounds. Evidence: 11/11 new tests · 458/459 (sole red = guard on Tera-owned live screenshot, allowlist → (b) pre-step; W-P5-01 behind it, approved) · lint/build clean · design APPROVE WITH NOTES (both closed r2 or accepted variance) · QA PARTIAL zero-fail, closed live by Tera: E-1 draft→attach→submit→history on disposable preview (emp/Legal, 116→1 submitted) · E-2/E-3 honest empty states · AR full-RTL + screenshots · zero literal colours. ConfirmDialog distinct copy landed r2.
**Owner-found leak correction (round 3, 2026-11-18): ACCEPTED.** E surface showed W-only evaluation content (scores/outcome/N/A). Stripped in EmployeeItemDetail (view/tabs verified clean): no scores, outcomes, evaluator identity, N/A control, correction panel; history = action+comment+reason+actor/time, no score fields; neutral no-rating draft carrier (server authoritative). Absence pins (u43a +1): outcome/score/N/A/correction/evaluator strings + /\bscore\b/i. Suite 459/460 (sole red = approved W-P5-01). **Live re-proof (disposable, E session): zero evaluation strings on E item detail; draft+submit+attach present; screenshot `u43a-employee-no-scores-ar.png`.** Shared app rebooted on new code (10441) after verification.

### b. Client console
Linked services read-only + confirm dept preliminary approvals (extend ClientReview, no new approval semantics) + C staff-list draft/submit (own tenant).
Suggested agent: ui-designer (+ engineering-agent-typescript if staff API deltas needed) · Reviewers: QA + Auditor (matrix).

### c. Consultant application console (in client workspace)
Link services to tenant + participating client departments + code auto-match with override + per-scope N/A (G2) + client-visible column masks (existing route) + W staff password completion + one-time reveal delivery (G1).
Suggested agent: engineering-agent-typescript (new tenant-application writes) + ui-designer (console UI) · Reviewers: SecurityAgent (authz boundary P→W shift) + QA + Auditor. Needs SDA gate per spec.

### d. Staff backend + P UI removal
Provisioning via approved flow only (WF-01 preserved), credential delivery (reveal), audit; remove P provisioning UI (G3), routes stay. Reuses adminStaff/adminProvisioning/b11b.
Suggested agent: engineering-agent-typescript · Reviewers: SecurityAgent + QA + Auditor.

## Global invariants (every phase)
INV-DEF-APP (no client writes from Services screen) · E own-dept · C never answers · W never answers · single-department-per-item · N/A reasoned + W-only · reveal-only delivery (no email path built) · audit everything · no secrets · no push · no live shared-DB writes without backup + separate explicit approval.

## U4-3a Pre-Execution Gate Result (2026-11-18)
Smallest safe unit PASS (employee workspace UI only; existing answer/assignment/document/initiative APIs, no new endpoints) · one objective PASS · no secrets PASS · rollback PASS (code revert) · acceptance testable PASS (E-flows on disposable preview + QA + design review) · design source: FIX Services patterns (no new visual language) · UI acceptance per UI_ACCEPTANCE_GATE + STYLE_CONTRACT.
Gate Status: PASS → delegate (a).

## فهم القرار
فهمي: الموظف يرى خدمات قسمه ويجيب ويرفق؛ المدير يؤكد ويملأ القوائم؛ المستشار يطبّق الخدمة ويتحكم بالمرئي ويدبّر الحسابات؛ المنصة تخرج من التدبير.
الافتراضات المفتوحة: لا شيء — G1–G7 محسومة بموافقتك.
ما سيكشفه الاعتماد: بناء (a) فوراً؛ (c) و(d) بعده بالترتيب.
