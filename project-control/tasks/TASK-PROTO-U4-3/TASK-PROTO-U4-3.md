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

## U4-3b Pre-Execution Gate Result (2026-11-18)
Smallest safe unit PASS (client console UI only: services read-only + confirm preliminary + staff draft/submit; no new endpoints — use existing ClientReview/staff routes; if a needed endpoint is missing → STOP, do not invent) · one objective PASS · no secrets PASS · rollback PASS (code revert) · acceptance testable PASS (C-flows live on disposable + QA + design review) · pre-step: allowlist the 2 Tera-owned (a) live screenshots exact paths in guard.
Gate Status: PASS → delegate (b).

## U4-3b Result: ACCEPTED 2026-11-18 (3 rounds, cap respected)
Evidence: u43b 12/12 · 471/472 (sole red = approved W-P5-01) · design APPROVE WITH NOTES (NOTE-1 fixed r2) · QA PARTIAL zero-fail, closed live by Tera on disposable preview: services read-only (zero answer inputs) · 2-1-3 head-preliminary→C-confirm→`client_approved` via UI · staff draft→submit (status `submitted`) · AR full-RTL + screenshots. Old C nav Staff Lists hidden r3 (console tab is the C surface; old view stays for P until (d)). No live shared contact. Follow-up: sibling screenshot allowlists ride pre-steps as established.

## U4-3c split + Pre-Execution Gate Result (2026-11-18)
(c) splits into **c1 API** (new W-bound routes + matrix deltas per spec API-2/5, zero-DDL) then **c2 UI console** (depends on c1; separate delegation after c1 Accepted). Smallest safe unit PASS (c1: backend only, no UI; explicit route list from spec) · one objective PASS · no secrets PASS · rollback PASS (code revert; no DDL) · acceptance testable PASS (matrix denials + N/A scope + delivery-metadata + QA harness) · SDA spec APPROVED_FOR_GATE.
Gate Status: PASS → delegate c1 (engineering-agent-typescript; SecurityAgent + Auditor + QA after).

## U4-3c1 STOP (2026-11-18) — zero-DDL infeasible, targets narrow
Executor read-only STOP (no writes): (1) 7 files needed beyond targets (routes.ts, admin.ts, adminProvisioning.ts, adminAssignments.ts, clientFieldMask.ts, domainAccess/capabilities tests) — mechanical, authorizable; (2) REAL gaps: W link/unlink, W approve/provision, complete-password, N/A lift each need narrow RLS branches (src/db); dept-matching override + delivery metadata + participating-departments PUT need persistable stores (no table exists). Spec DB-3 anticipated narrow-policy addition — now required.
Tera rulings: **Security Disposition HIGH confirmed** (profile §9 standing rule). **A:** targets widened in the c1 re-delegation below. **B:** separate SDA mini-design first (c-delta): exact RLS branch set + matching/delivery/participation store design (migration if needed), with SecurityAgent re-audit in the loop. No code until the delta spec is APPROVED_FOR_GATE.

## U4-3c-delta: APPROVED_FOR_GATE 2026-11-18
- Designer closed gaps (a)–(g) with exact predicates/shapes; Shield re-audit PASS on F1/F2/F3 (no weakening; N-13 covers C-lift via old branch).
- Owner approvals: DG-D1 temporary+must_change · DG-D2 visible-by-default · DG-D3 W-ack=revealed/completed-at-rotation · **DDL design APPROVED (Tera recommendation: no clean alternative; additive-only; live apply needs separate execution approval + backup)**.
- Delta spec: `task-engineering-reviews/TASK-PROTO-U4-3C-DELTA_TECHNICAL_SPECIFICATION.md` (+ round-2 F1/F2/F3 closure).

## U4-3c1 re-delegation (widened targets + delta spec)
Allowed: workspace.ts (new) · routes.ts + admin.ts (mount only) · adminAssignments.ts (N/A lift + match check) · adminProvisioning.ts (approve shift) · adminStaff.ts · serviceVisibility.ts + clientFieldMask.ts (vocab) · accessRegistry.ts · b17-content.sql (delta branches ONLY) · schema.sql (2 tables + 5 columns ONLY) · b17Readiness.ts (pins only) · scripts/u43c1-rehearse.ts (scratch proof, NEVER live) · u43c1.test.ts (new) + guard/capability/domain pins (enumerated).
Forbidden: UI · FIX behavior change · live/shared DB · secrets · commits.
Migration: construct + rehearse on scratch ONLY (no live apply — separate owner execution approval later, FIX pattern).

## U4-3c1 Result: ACCEPTED 2026-11-18 (3 rounds, cap respected)
Evidence: 10/10 new tests · 481/482 (sole red = approved W-P5-01) · rehearsal green (forward/idempotent/rollback, zero loss) · Shield PASS (F1 fixed r3, F2 documented) · Auditor CONDITIONAL satisfied · QA PARTIAL zero-fail (C7 → c2 live proof) · Post-Execution PASS · no live shared mutation. Full detail: AUD-0050 + activity log 2026-11-18.

## U4-3c2 Pre-Execution Gate Result (2026-11-18)
Smallest safe unit PASS (consultant console UI only; consumes c1 APIs — no new endpoints) · one objective PASS · no secrets PASS · rollback PASS (code revert) · acceptance testable PASS (W-flows live on disposable + QA + design review).
Gate Status: PASS → delegate (c2) (ui-designer; SecurityAgent spot-check on W delivery UI + QA live + design review).
Evidence: 10/10 new tests · 481/482 (sole red = approved W-P5-01) · lint/build clean · rehearsal green (forward/idempotent/link/participation/matching/approve/deliver/na-lift/rollback, zero loss) · Shield PASS (F1 fixed r3: frozen+suspended guards on deliver; F2 email-reserve documented as intentional until G1-i; suspension-on-approve: no pattern anywhere → no invented rule, recorded observation) · Auditor CONDITIONAL satisfied (Shield re-audit done here; QA run done; no live contact evidenced) · QA PARTIAL zero-fail (C7 live-server paths → c2 live proof; report filed by Tera — agent tool gap).
F2 recorded: RLS-deliver email value stays reserved until the G1-i email table lands; handler 400 remains the gate.
Suspended-tenant approve: pre-existing system-wide absence (no provisioning path ever enforced it) — NOT a c1 regression; no invented rule.
Post-Execution Review: PASS (in-target, no secrets, no live contact). No live shared mutation.

## U4-3b STOP resolution (2026-11-18)
Executor STOP packet: pre-step allowlist unmasked the W-P5-01 size bound (ServicesView 875, committed U4-2-FIX P5, untouched by this unit). Tera ruling: **option 3 — existing approved deviation applies** (W-P5-01 + ISS-012 follow-up; no new exception, no split inside this unit). Proceed to independent reviews + live C proof.

## U4-3b Result: ACCEPTED 2026-11-18 (3 rounds, cap respected)
Evidence: u43b 12/12 · 471/472 (sole red = approved W-P5-01) · design APPROVE WITH NOTES (NOTE-1 fixed r2) · QA PARTIAL zero-fail, closed live by Tera on disposable preview: services read-only (zero answer inputs) · 2-1-3 head-preliminary→C-confirm→`client_approved` via UI · staff draft→submit (status `submitted`) · AR full-RTL + screenshots. Old C nav Staff Lists hidden r3 (console tab is the C surface; old view stays for P until (d)). No live shared contact. Follow-up: sibling screenshot allowlists ride pre-steps as established.

## فهم القرار
فهمي: الموظف يرى خدمات قسمه ويجيب ويرفق؛ المدير يؤكد ويملأ القوائم؛ المستشار يطبّق الخدمة ويتحكم بالمرئي ويدبّر الحسابات؛ المنصة تخرج من التدبير.
الافتراضات المفتوحة: لا شيء — G1–G7 محسومة بموافقتك.
ما سيكشفه الاعتماد: بناء (a) فوراً؛ (c) و(d) بعده بالترتيب.
