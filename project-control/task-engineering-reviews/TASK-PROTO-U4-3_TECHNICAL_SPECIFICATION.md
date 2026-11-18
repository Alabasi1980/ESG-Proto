# TASK-PROTO-U4-3 — Technical Specification (design only, NOT execution-authorized)

> Status: DESIGN ONLY — Draft. No code, no migration, no live DB. This file is the
> sole allowed write target of this design task.
> Classification: **SDA_REQUIRED** (tenant-application writes · auth/permissions mutation —
> P→W/C provisioning shift · public API contract · cross-module behavior · approval state
> machine · background tenant writes). Impact overrides complexity.
> Governing product decisions: `prototype/OWNER_DECISIONS.md` OD-07, OD-11, OD-12, OD-13 ·
> Bindings: `prototype/B17_UI_BINDINGS.md` §§2–6 + §10 revision (incl. §6 staff matrix line 89,
> superseded per owner instruction below) · FIX program: `project-control/tasks/TASK-PROTO-U4-2-FIX/TASK-PROTO-U4-2-FIX.md`
> (CLOSED 2026-11-18, live-migrated) + `task-engineering-reviews/TASK-PROTO-U4-2-FIX_TECHNICAL_SPECIFICATION.md`
> (INV-1…10, API-5 matrix consumed as-is) · Technology profile: `prototype/TECHNOLOGY_PROFILE_DRAFT.md` (APPROVED).
> Task: TASK-PROTO-U4-3 (program, phased a→b→c→d, one delegation at a time).
> Designer: tera-software-designer (مصمم). Stage: Phase 5 (Execution Planning) → Pre-Execution Gate.

---

## CORE

### 1. Task Identity

| Field | Value |
|---|---|
| Task | TASK-PROTO-U4-3 (program — design only, NOT execution-authorized) |
| Title | Contextual screens + client application + staff relocation (U4-3) |
| Stage | Phase 5 (Execution Planning) → Pre-Execution Gate |
| Designer | tera-software-designer (مصمم) |
| Classification | SDA_REQUIRED |

### 2. Objective

Specify four phased units that move tenant-application work off the Services screen and off
P-provisioning into the correct hands, consuming the FIX program's live APIs without
redesigning them:

- (a) Employee services workspace: dept services → items (typed answers + independent
  attachments) + documents tab + initiatives tab. No new answer semantics.
- (b) Client console: linked services read-only + confirm dept preliminary approvals
  (extend ClientReview, no new approval semantics) + C staff-list fill part 1 (draft/submit own-tenant lists).
- (c) Consultant application console (in client workspace): link services to tenant +
  choose participating client departments + match to service departments + per-scope N/A
  (disclosure/item, reasoned) + client-visible column masks (existing visibility route) +
  W staff password completion + credential delivery (email OR one-time reveal).
- (d) Staff provisioning backend + delivery + P UI removal from provisioning
  (routes stay or retire — decision with rationale; WF-01 preserved: accounts only via approved flow).

### 3. In Scope / Out of Scope

**In scope (U4-3 only, phased a→b→c→d):**
- Employee contextual screens reusing FIX patterns (drill, drawer, banners) over the
  service-centric navigation (B17 §10).
- Client console read-only service views + ClientReview confirm/reopen extension.
- Consultant console inside the client workspace (W mode): service linking, participating
  departments, dept matching, per-scope N/A, visibility masks, staff password completion,
  credential delivery design for BOTH email and reveal options (one cut by owner answer G1).
- C staff-list fill part 1 (draft/submit own-tenant) as the front half of the relocated flow.
- Staff backend: keep WF-01 (accounts only via approved flow), OTP-once, hash-only storage,
  must_change_password; P UI removal from provisioning with explicit route fate decision.
- Audit for every tenant-application write; fail-closed unknown combinations.

**Out of scope (explicitly NOT this program):**
- Any change to FIX-sealed behavior: catalog CRUD, import (catalog-only), history, reopen,
  seal, copy-viewer, settings whitelist — consumed, not redesigned (INV-FIX-FROZEN).
- New answer semantics, new approval semantics, new scoring, new report levels.
- Production object storage (OD-06 demo-scale bytea stays), push/email infrastructure build
  (only specified as an option behind G1), new frameworks beyond the adapter principle (OD-07).
- Any P/C/E capability gain outside the matrices in §API-5; any UI-only authz fix.

### 4. Governing Sources (exact lines relied on)

| # | Source | Exact reliance |
|---|---|---|
| G-1 | OD-11 §1–2 | Final product, no demo language; service is first-class; no service hard-coded in nav/dashboards/reports; per-service screen + per-service import. |
| G-2 | OD-11 §3 | Link reflection: answer applies to linked items (even cross-service); group counted once; answer origin shown. (Consumed; U4-3 changes no scoring path.) |
| G-3 | OD-11 §4 role matrix | E answers/attaches own-dept only; C manages staff↔dept linking only + confirms dept preliminary approvals, never answers/attaches; W reviews + controls client-visible fields, never answers/attaches; P administers. |
| G-4 | OD-12 §1–2 | Typed answers (`answer_type`: text/number/boolean/date/file); attachment is an independent field; `attachment_required` blocks submit even with N/A. |
| G-5 | OD-12 §3 | Department document list: independent tab, filled by dept (submitted + files), sent to consultant; C read-only. |
| G-6 | OD-12 §4 + §8 eng. decision | Dept initiatives = assignment of a client-selected initiative to a dept, with performed flag + note + independent proof attachment; E fills, W/C read. |
| G-7 | OD-12 §5–6 | Free tags (≤10, ≤40 chars) on item/requirement/initiative row; `indicator_code` (e.g. `c (i)`) on items. |
| G-8 | OD-12 §7 | Free question = real requirement; per-service GENERAL bucket auto-created (`GENERAL-<CODE>` + `GENERAL` disclosure, `esg_class='general'`); no schema change. |
| G-9 | OD-13 §1–2 | Flexible service structure (no forced Standards→Disclosures→Items; groups + direct items via bucket convention, FIX D-1); one department per item (`items.department_id` single FK). |
| G-10 | OD-13 §3–4 + extra condition | Reopen-with-history before final (snapshot + `reopened`, history preserved); delete-with-work archives; approved copy immune even to full source removal (FIX DB-3 F1). |
| G-11 | OD-07 | One generic content model; per-service variance in adapters + settings, never new per-service tables. |
| G-12 | B17 §10 | Service-centric revision: P services catalogue; W/C linked-services list → service detail; E own-dept services → items; new item-links page; import from within the service. |
| G-13 | B17 §6 staff matrix line 89 + **owner instruction delta** | Recorded matrix: "P review/approve-provision/reject+OTP; C read/draft/submit/reject; E own draft/submit; W read/draft/submit/reject". **Owner instruction supersedes the P-provisioning leg**: C fills lists, **W (consultant in client workspace) provisions + delivers (email or reveal)**. Delta recorded in D-9/AP-5; P leg retired from UI (G3 decides route fate). |
| G-14 | FIX program (ACCEPTED + live-migrated) | Consumed APIs: catalog CRUD (standards/disclosures/items/bulk/history/service-delete), import preview/commit (catalog-only, `import.client_forbidden`), history/reopen/archive paths, seal (`POST /api/approved-copies/seal`), copy-viewer (`GET …/approved-copy`, works after source deletion), settings whitelist (`service.settings_unknown/invalid`, 8 KB). File:line evidence in FIX task file §§P1–P5S + closure proof. |
| G-15 | Current code facts (read-only) | `StandardsView.tsx` + `TaxonomyManage.tsx` (P patterns to retire from Services per FIX); `GapAnalysisView.tsx` + `EvaluationPanel.tsx` (E queue + typed answer/attachment flows to reuse); `ClientDashboardView` + `ClientReviewView` (C read + confirm/reopen to extend); `ClientDetailView` (W read-only workspace projection, mode fn `clientDetailMode`); `StaffListsView` + `routes/adminStaff.ts` + `routes/adminProvisioning.ts` + `lib/b11b.ts` (staff flow today incl. WF-01 + OTP-once + must_change_password); `routes/serviceVisibility.ts` (W-only `PATCH /workspace/services/:serviceId/visibility`, column guard); `routes/documents.ts` + `routes/departmentInitiatives.ts` + `lib/documents.ts` + `lib/departmentInitiatives.ts` (E dept content, W/C read). |
| G-16 | Profile `TECHNOLOGY_PROFILE_DRAFT.md` | First Task Rule (enumerate every affected read/write route + role/mode/tenant/service/dept; unknown fails closed); ORM rules (RLS/transaction-local tenancy, no live mutation in verification); Forbidden Defaults (no secrets, no impersonation, no implicit tenant scope). |

**Lifecycle-header note:** `OWNER_DECISIONS.md`, `B17_UI_BINDINGS.md`, task file carry no formal
Lifecycle Header. Accepted as owner-signed binding (same waiver as FIX DG-07); Tera to confirm
header requirement for prototype/ docs at gate. Non-blocking.

### 5. Decision Provenance

| Decision | Source | Authority | Status |
|---|---|---|---|
| D-1 No new answer semantics in (a): typed answers + independent attachments + correction history consumed as-is | OD-12 §1–2 (G-4) + FIX INV-4/INV-7 | Approved source | APPROVED_SOURCE |
| D-2 (a) documents + initiatives tabs consume existing dept-content contracts, E-writes / W,C-read | OD-12 §3–4 (G-5/G-6) + `documents.ts` / `departmentInitiatives.ts` | Approved source | APPROVED_SOURCE |
| D-3 (b) ClientReview extension = confirm/reopen only, disclosure-gated 409 preserved, no new semantics | OD-08 s2–s3 + existing ClientReview behavior (G-15) | Approved source | APPROVED_SOURCE |
| D-4 (c) service linking writes `client_services` only via consultant workspace; never from Services screen | INV-DEF-APP (FIX) + B17 §6 ClientDetail row | Approved source | APPROVED_SOURCE |
| D-5 (c) participating departments derived from `assignments` presence (no new table); matching = item→dept single FK | OD-13 §2 (G-9) + `adminAssignments.ts` ownership | Approved source (derivation) / TECHNICAL_CHOICE (no-DDL option) | APPROVED_SOURCE / TECHNICAL_CHOICE |
| D-6 (c) visibility masks extend the existing `client_field_mask` route; new U4-3 fields added to the mask vocabulary, same single-column guard | `serviceVisibility.ts` + `clientFieldMask.ts` (G-15) | Approved source (mechanism) / TECHNICAL_CHOICE (field list) | APPROVED_SOURCE / TECHNICAL_CHOICE |
| D-7 (c)+(d) credential delivery specified for BOTH options; build waits for G1 owner pick | Task open-owner-decision G1 | — | NEEDS_DECISION → G1 |
| D-8 (c) per-scope N/A specified as disclosure-vs-item with reason + report effects; build waits for G2 ruling | Task open-owner-decision G2 | — | NEEDS_DECISION → G2 |
| D-9 (d) provisioning actor moves P→W (owner instruction supersedes B17 §6 line 89 P leg); WF-01 preserved (accounts only via approved flow, OTP-once, hash-only, must_change_password) | Owner instruction (G-13) + `b11b.ts` S-11/WF-01 + `adminProvisioning.ts` | Approved source (shift + invariants) | APPROVED_SOURCE |
| D-10 (d) P provisioning fate: recommend UI-removal-only (routes kept, P denied by matrix, emergency use audited); full retire needs owner confirm | Task open-owner-decision G3 | Technical choice (recommendation) | NEEDS_DECISION → G3 |
| D-11 (c) dept matching UX: recommend auto-match by code + manual override table; needs owner confirm | Task open-owner-decision G4 | Technical choice (recommendation) | NEEDS_DECISION → G4 |
| D-12 Zero DDL for U4-3 (all units satisfiable on FIX-migrated schema); any G2 ruling requiring a scope column becomes a deferred migration, not smuggled in | OD-07 (G-11) + FIX DB-6 | Technical choice (needs gate eyes) | TECHNICAL_CHOICE |
| D-13 E-queue/C-review/W-workspace reads stay scoped by linked-service + own-dept/own-tenant; unknown combinations fail closed | Profile First Task Rule + existing scope predicates | Approved source | APPROVED_SOURCE |

### 6. Technical Invariants (must remain true before/after)

1. **INV-DEF-APP**: Services defines the catalog; client application (assignments, answers,
   approvals, evaluations, links, visibility, staff provisioning) is never written from the
   Services surface. Extended: the consultant console is the application-writing surface, not Services.
2. **INV-SINGLE-DEPT**: One item → at most one department; no multi-dept definition.
3. **INV-E-OWN-DEPT**: E reads/writes own-department assigned items only.
4. **INV-C-NEVER-ANSWERS / INV-W-NEVER-ANSWERS**: C and W never file answers or attachments.
5. **INV-FIX-FROZEN**: FIX-sealed behavior (catalog/import/history/reopen/seal/copy-viewer/
   settings whitelist) is consumed unchanged.
6. **INV-FREEZE**: Frozen scope (GE-final snapshot) refuses writes at API (409) + trigger backstop.
7. **INV-APPROVED-IMMUNE**: Sealed approved copies stay viewable after any source mutation.
8. **INV-HISTORY**: No silent overwrite; reopen snapshots; correction history appended.
9. **INV-TENANT-ISOLATION**: Cross-tenant reads/writes fail closed (403/404); W bound to A;
   C own-company; P-config vs P@T contexts separate; no implicit tenant scope.
10. **INV-AUDIT**: Every catalog/config/application mutation audited in-txn (existing vocabulary
    extended, never renamed). Credential delivery events audited WITHOUT secrets.
11. **INV-NO-SECRETS / INV-NO-PUSH / INV-NO-LIVE-DB**: No secrets in code/logs/reports; no push
    channel built; no live DB mutation during verification (isolated harness only).

### 7. Dependencies

- Code: FIX-sealed routes (`taxonomy.ts`, `routes/gri.ts` import, `routes/adminAssignments.ts`,
  seal/copy-viewer, settings whitelist); `routes/evaluations.ts` (queue/confirm/correct/N-A);
  `routes/documents.ts`, `routes/departmentInitiatives.ts`; `routes/serviceVisibility.ts` +
  `lib/clientFieldMask.ts`; `routes/adminStaff.ts` + `routes/adminProvisioning.ts` + `lib/b11b.ts`
  + `lib/password.ts`; `routes/_shared.ts` + `routes/initiativeScope.ts` (contexts/freeze);
  `server/scope.ts` + `server/access.ts` (tenant/dept predicates); `lib/answerValidation.ts`
  (typed answers); `lib/documents.ts`, `lib/departmentInitiatives.ts` validators.
- UI: `ServicesView.tsx`/`ServiceContentPanel.tsx` (FIX patterns to reuse: drill, drawer,
  banners); `StandardsView.tsx`, `GapAnalysisView.tsx`, `EvaluationPanel.tsx`,
  `ClientDashboardView`, `ClientReviewView`, `ClientDetailView`, `StaffListsView`;
  i18n AR/EN keys; `STYLE_CONTRACT.md` binding (via FIX P5).
- Decisions: OD-07/08/09/10/11/12/13; B17 §§2–6 + §10; FIX spec INV/API/DB modules;
  profile First Task Rule + Forbidden Defaults.
- Blocking inputs: G1–G4 owner answers (G1 gates (d) build; G2 gates (c) N/A build;
  G3 gates (d) route fate; G4 gates (c) matching UX). Program is spec-complete; builds wait per unit.

### 8. Side-Effect Registry

| Area | Effect | Handling |
|---|---|---|
| E workspace (a) | New service-centric E screens; queue grouped by service not GRI | UI-1; reads reuse `/api/queue` + typed-answer endpoints; no new semantics |
| C console (b) | ClientReview gains linked-service grouping + confirm-dept-preliminary affordance | UI-2; server confirm path unchanged; disclosure-gated 409 preserved |
| W console (c) | New consultant application console (link + departments + matching + N/A + masks + staff completion + delivery) | UI-3; writes enumerated in API-5; all W-bound-to-A, audited |
| Staff flow (d) | Provisioning actor P→W; P UI removal; C fill part 1 front half | UI-4 + API-5; WF-01 preserved; OTP-once; route fate per D-10/G3 |
| Services screen | Untouched by U4-3 (FIX P5 owns it) | No Services writes from application surfaces (INV-DEF-APP) |
| Reports/exports | N/A-scope ruling (G2) may change aggregates; masks may hide columns from C views | Reports filter by ruling; redaction via `client_field_mask`; no silent recount |
| Permissions | Auth matrix deltas in API-5 (W gains application writes in bound workspace; P loses provisioning UI; C gains list-fill; E unchanged) | Server enforcement required; no UI-only fix |
| Audit | New actions: `SERVICE_LINKED/UNLINKED`, `PARTICIPATING_DEPTS_SET`, `DEPT_MATCH_OVERRIDDEN`, `NA_SCOPE_SET/LIFTED`, `CLIENT_VISIBILITY_UPDATED` (exists), `STAFF_LIST_*` (exists), `STAFF_PROVISIONED_BY_W`, `CREDENTIAL_DELIVERED` (no secret payload), `STAFF_PASSWORD_COMPLETED` | Additive; existing names untouched |
| Storage | No new bytea tables; reveal path stores nothing extra; email path (if picked) needs secret handling design only | OD-06 cap preserved; delivery payloads never log secrets |
| Notifications | Reopen/credential-ready info uses existing inbox (no push built) | DG-04-descendant wording confirmed in P5 era; credential inbox carries no OTP |

### 9. Failure & Recovery

| Failure | Response | Recovery |
|---|---|---|
| Link service already linked / unmapped service | 409 `scope.service_unlinked` / unmapped notice; no partial link | Re-fetch links; link with explicit serviceId; audit attempt |
| Match override to non-participating dept | 400/403 refused; assignment unchanged | Pick participating dept or add it first (audited) |
| N/A on frozen scope / attachment-required item via shortcut | 409 (`FROZEN_SCOPE` / `assignment.na_attachment_required` preserved) | Append snapshot note only; or file N/A via full workflow WITH attachment |
| N/A lift after downstream approvals exist | Refused unless G2 lift authority satisfied; existing evaluations kept | Correction workflow with reason; history intact |
| Staff approve with empty/invalid rows / foreign dept | 400/403; whole batch rolls back (all-or-nothing preserved) | Fix rows → resubmit; no partial provisioning |
| OTP redisplay / second fetch | Refused (OTP-once); only hash stored | Forced-password reset flow (W-assisted completion, §SEC-3) |
| Email infra absent (reveal-only chosen) | No email path built; C relays credentials | One-time reveal panel (see §SEC-3); delivery audited |
| Email send failure (if email chosen) | Batch unaffected (accounts already provisioned in-txn); delivery status per-recipient `failed` | Retry delivery only (no re-provision); no OTP regeneration without reset flow |
| Cross-tenant / cross-dept write | 403/404 existing semantics; audited | No data leak; re-scope to own tenant/dept |
| Concurrent confirm / version conflict | 409 `item.version_conflict` style on evaluations/answers; stale write rolled back | Re-fetch, merge, retry |
| Migration need discovered (G2 scope column) | STOP: deferred migration proposal, not smuggled into a unit | Separate SDA_REQUIRED migration design |

### 10. Security Classification

- Trust boundaries: P (platform config, tenant-NULL or explicit-T) · W (consultant inside
  client A, bound workspace) · C (client_admin, own tenant) · E (own dept only). Server
  selects purpose/target; request values never trusted (profile First Task Rule).
- AuthN/Z: `authMiddleware` + `requireFreshPassword` (all writes) + `requireDomainAccess` on
  every new route; unknown combinations fail closed. See §API-5 matrix.
- Approval state machine (unchanged, extended only with N/A-scope + staff gates):
  `draft → submitted → approved(dept preliminary) → client_approved(C confirm) → GE-final(sealed copy)`
  with `reopened/returned` loops. C confirms dept preliminary (never answers); W provisions
  staff + sets N/A-scope + masks (never answers); E files own-dept work.
- Secrets: none in code/i18n/logs/reports (profile §8). OTPs: generated server-side,
  returned ONCE in the approve/provision response, hash-only storage, never logged;
  reveal panel shows once then hides (no refetch endpoint). Email option: SMTP endpoint +
  account live in env/secret store only; sending happens server-side; message bodies carry OTP
  but are never logged or audited (audit records delivery metadata only).
- Audit: all mutations in-txn; new actions whitelisted into `b17_audit_insert` branches.
- Threat assumptions: malicious/buggy P/W/C client (validate everything, code immutability,
  mask vocabulary closed); cross-tenant probing (fail closed + negative tests);
  frozen-scope bypass (API + trigger double wall); OTP interception/replay (once-only,
  forced rotation via must_change_password, delivery metadata without secrets);
  full-service deletion destroying evidence (immunity by FIX copy, untouched here).

### 11. Verification Strategy

- Unit (existing harness `node:test` + behavioral file-pin tests): mask vocabulary parser,
  dept-matching auto-map (code equality), staff-row validator (`b11b.ts` preserved),
  N/A-scope validator (reason required, attachment-required refusal), delivery-status
  transitions (no secret in payload), ClientReview grouping helper.
- API contract tests (P/W/C/E × each route in §API-2): allowed → 2xx, others → 403/404;
  matrix deltas in §API-5 pinned per route.
- **Negative tests (mandatory)**:
  - N-1 cross-tenant read of another tenant's services/assignments/staff-lists/copy → 403.
  - N-2 write to frozen scope (answer/N-A/mask/match/provision path) → 409 + trigger backstop.
  - N-3 C POST answer/attachment OR W POST answer/attachment → 403 (never-answer invariants).
  - N-4 E read/write outside own department (queue/item/document/initiative) → 403.
  - N-5 N/A-scope probe: item-N/A on attachment-required item via shortcut → 409
    `assignment.na_attachment_required`; disclosure-N/A semantics verified per G2 ruling.
  - N-6 staff provisioning by P-after-UI-removal (direct route call) → 403 with audit;
    emergency path (if kept per G3) requires explicit-T + audit, else 403.
  - N-7 OTP redisplay/second fetch → 404/403 (no secret); audit shows metadata only.
  - N-8 mask smuggling (unknown key / show_gap escalation via visibility route) → 400.
  - N-9 unbound/expired W workspace attempts application write → 403 `workspace.mode_mismatch`.
  - N-10 stale-version confirm/correct (evaluation/answer) → 409; history intact.
- Lint/tests/build green; zero literal colors (STYLE_CONTRACT); AR/EN + mobile/desktop passes;
  independent QA + SecurityAgent review per unit; no live DB in verification (isolated harness only).

### 12. Reviewers (suggested post-execution)

SecurityAgent (authz-shift matrix + OTP/delivery + freeze/N-A + RLS deltas), QA (E2E §UI-7 +
N-1…N-10), Auditor (audit vocabulary + history preservation + no-secret evidence), Tera (gate),
Majed (G1–G4 + any new gaps).

### 13. Engineering Review Decision

**REVISION_REQUIRED (narrow — four owner questions, builds sequenced)** — the design below is
gate-ready in all modules **except** G1–G4, which gate unit builds (not the spec): (a) and (b)
are buildable on approval; (c) N/A leg waits G2 + matching UX waits G4; (d) waits G1 (+G3 for
route fate). No invented behavior; defaults proposed where safe. On owner answers G1–G4 →
**APPROVED_FOR_GATE** per unit with no other change.

### 14. Design Gaps

| ID | Gap (owner-facing wording) | Impact | Proposed default |
|---|---|---|---|
| G1 | "لا توجد بنية بريد في المستودع (لا smtp/nodemailer/sendMail). لاعتماد الموظفين: (i) تزوّدون SMTP وحساباً (نتولى التكامل والأسرار)، أم (ii) نعتمد الكشف لمرة واحدة فقط (W يعرض، C يبلّغ) ولا يُبنى مسار بريد؟" | Gates (d) delivery build; both paths specified | Recommend (ii)-first unless owner supplies SMTP within the unit window; (i) needs secrets + retry design |
| G2 | "النطاق N/A: هل هو على مستوى الخدمة أم الإفصاح أم البند؟ وهل السبب إجباري؟ وكيف يؤثر على التقارير/النِّسب؟ ومن يملك رفعه (W فقط؟ أم C يقترح)؟" | Gates (c) N/A build + report math | Recommend: item + disclosure scopes, reason mandatory from closed list, excluded from aggregates (never zero), lift = W only with reason + audit; C may propose via reopen |
| G3 | "تقاعد توفير P: هل نحذف المسارات نهائياً أم نزيل الواجهة فقط ونُبقي المسارات للطوارئ مع تدقيق؟" | Gates (d) route fate | Recommend UI-removal-only (routes kept, P denied by matrix, emergency explicit-T + audit); full retire only on owner confirm |
| G4 | "مطابقة الأقسام: هل نطابق تلقائياً بالرمز مع جدول تجاوز يدوي، أم يدوياً بالكامل؟" | Gates (c) matching UX | Recommend auto-match by code + manual override table (audited), unmatched require explicit mapping before assignments |
| G5 (new) | "إكمال كلمة مرور الموظف بواسطة W: هل يضبط W كلمة أولى مؤقتة تُجبر على التغيير، أم يرسل رابط إعداد لمرة واحدة؟ وهل يُسمح لـ C بالمساعدة؟" | (c)/(d) credential-completion flow | Temporary + must_change_password preserved; C never sees secrets; reset via W-assisted flow only |
| G6 (new) | "أعمدة القناع الجديدة لحقول U4-3 (مستندات/مبادرات/حالة N/A): هل تُخفى عن C افتراضياً أم تُعرض؟" | (c) mask vocabulary | Default: new operational columns visible to C unless W hides; evidence bytes never masked-away from W |
| G7 (new) | "قوائم الموظفين — الجزء 1 (تعبئة C) مقابل التوفير (W): هل التقديم دفعة واحدة (≤200) أم دفعات؟ وهل رفض W يعيد القائمة كاملة أم صفوفاً؟" | (b)/(d) list lifecycle | Preserve current: batch ≤200 all-or-nothing; reject = whole list with reason; resubmit as new version |

---

## UI MODULE

### UI-1 Unit (a) — Employee services workspace (service-centric, E own-dept only)

- **Nav (B17 §10)**: «خدمات قسمي» list → service → own-department items. Titles derive from
  the service name; dashboards/reports aggregate by service (no GRI-fixed wording).
- **Service list**: linked services for own dept only (empty → «لا توجد خدمات مسندة لقسمك» +
  Refresh/contact-admin; never Import/Settings CTA). Each row: service name + counts
  (assigned/submitted/pending for MY dept) from `/api/queue` roll-up.
- **Service detail**: tabs `بنود | مستندات | مبادرات` (disclosures-grouped item list;
  FIX Content drill pattern reused: List→Detail, side panel drawer <2xl / sticky ≥2xl).
- **Items tab**: disclosure groups (incl. GROUP buckets + GENERAL direct items per FIX D-1)
  → item rows with typed input per `answer_type` (text/number/boolean/date/file), independent
  attachment affordance, `attachment_required` blocks submit (banner, not silent), tags +
  indicator_code display. Actions: save-draft / submit / request-correction-visible-history.
  Correction history drawer (`correction_history` + `item_versions` link) reused from FIX UI-2.
- **Documents tab**: dept document requirements (from `documents.ts` contract) with
  provided/note/tag patch + independent evidence files; status strip (مطلوب/مُقدَّم/مقبول).
  E-writes; W/C read elsewhere (not here).
- **Initiatives tab**: assigned initiatives (from client-selected set) with performed toggle +
  note + independent proof files; same drawer/banner patterns.
- **States**: skeleton rail + workspace (existing); honest empties per tab with the single
  relevant CTA (answer item / upload document / mark initiative); frozen banner
  («للقراءة — معتمد نهائياً») when GE-final; archived styling preserved.
- **A11y/i18n**: real tablist, dialog focus-trap + Escape + focus return, `bdi`/ltr for codes,
  logical RTL props only, `role=status/alert`; full AR/EN.

### UI-2 Unit (b) — Client console (C own-company read + confirm, never answers)

- **Linked services list** → service detail (content + dept answers + preliminary approvals,
  read-only except confirm/reopen). Reuses W/C service-detail projection with C redaction
  via `client_field_mask` (server-side; forbidden columns never rendered, not CSS-hidden).
- **ClientReview extension**: group by linked service → disclosure → dept rows; completeness
  bar per group; **confirm dept preliminary** / reopen-per-item with comment (existing
  disclosure-gated 409 preserved: incomplete depts named, no silent approve). No new semantics.
- **C staff-list fill part 1**: draft/create (email/name/dept/role rows ≤200, dept must exist),
  submit own-tenant lists, view results/reject-reasons; NO provisioning/reject/approve/OTP
  affordances (matrix: C draft authority only). Dept picker = own-company departments only.
- **Notifications**: own-company inbox only (existing); no audit view.

### UI-3 Unit (c) — Consultant application console (W bound-to-A only)

Single workspace section «تطبيق العميل / Client application» with steps (one primary action each):

1. **Link services**: link/unlink service↔tenant (explicit serviceId; unmapped → notice;
   unlink refused while tenant work exists unless archived-scope rule satisfied — same
   DG-02-descendant precondition as FIX service-delete, applied per link).
2. **Participating departments**: choose from tenant departments (checkbox set; derived
   participation = has ≥1 assignment; removing a dept with work refused 409).
3. **Dept matching**: auto-match service-dept-code ↔ client-dept-code + manual override
   table (per G4; unmatched items blocked from assignment until mapped). Override audited.
4. **Per-scope N/A**: disclosure-scope or item-scope toggle + mandatory reason (closed list
   from `b11b.ts` STAFF_NA_REASONS-analogous `naReason`) + justification; attachment-required
   items refuse shortcut (409 preserved); effect preview on reports (excluded, never zero).
   Lift authority per G2 (default W-only).
5. **Client-visible columns**: per-service mask panel on the existing visibility route;
   vocabulary = existing fields + U4-3 additions (G6); unknown keys refused 400; single-column
   guard preserved (writes ONLY `client_field_mask`).
6. **Staff password completion + delivery**: pending-accounts table (email, status
   must_change_password) → W sets temporary credential (forced rotation) OR triggers delivery:
   **email** (if G1-i) with per-recipient delivery status, OR **one-time reveal** (if G1-ii):
   OTP shown once in the approve response panel with copy + acknowledge, then hidden forever
   (no refetch endpoint; reload shows «تم التسليم — لا يمكن العرض مجدداً»).
- Guards: all steps require verified W-bound workspace (`workspace.mode_mismatch` → 403);
  no client selector; explicit A badge + Exit preserved (B17 §2).

### UI-4 Unit (d) — Staff provisioning backend surface + P UI removal

- **P UI**: provisioning roster/approve/reject/OTP panels REMOVED from platform views
  (explicit-T config surface keeps user directory read + suspend/reactivate only).
- **W UI**: draft/submit/reject lists (bound-A) + approve-provision (all-or-nothing) +
  OTP-once panel (reveal) or email-status panel; C UI: fill/submit/track only.
- **Pins**: OTP shown once; no secret in DOM after acknowledge (memory cleared on
  unmount/exit/tab-switch per B17 §7 transition rules); delivery metadata only in lists.

### UI-5 Data Bindings (all units)

| Element | Source entity/field | API | Params |
|---|---|---|---|
| E service list / counts | assignments+answers (own dept) | GET `/api/queue` | — (server-scoped) |
| E item editor (typed + attachment) | items + answers + evidence_files | existing answer/evidence endpoints (consumed) | `{value, expectedVersion}` / multipart file |
| E documents tab | document requirements + submissions | existing documents endpoints | `{provided, note, tags}` + files |
| E initiatives tab | initiative dept status + proof files | PATCH dept initiative + evidence | `{performed, note, expectedVersion}` |
| C service detail | linked services + answers (redacted) | GET service/queue projections | `serviceId` (linked only) |
| C confirm/reopen | evaluations | existing ClientReview confirm/reopen | `{comment?, expectedVersion?}` |
| C list fill | staff_lists + rows | POST `/api/staff-lists`, `…/:id/submit`, GET lists/depts | `{rows[]≤200}` own-tenant |
| W link services | client_services | NEW `POST/DELETE /api/workspace/client-services` | `{serviceId}` bound-A |
| W participating depts | departments × assignments | NEW `PUT /api/workspace/participating-departments` | `{departmentIds[]}` |
| W dept matching | items.department ↔ tenant depts | NEW `PUT /api/workspace/dept-matching` | `{mappings[{itemDeptKey, clientDeptId}]}` |
| W N/A scope | evaluations + answers | EXTEND `POST /assignments/na` (scope param) | `{itemId/disclosureId, scope, naReason, justification}` per G2 |
| W masks | client_services.client_field_mask | PATCH `/workspace/services/:serviceId/visibility` (exists) | `{clientFieldMask}` closed vocabulary |
| W provision + delivery | staff_lists → users | POST `…/:id/approve` (actor W) + NEW `POST …/:id/deliver` | approve returns OTPs once; deliver `{channel: email|reveal-ack}` |
| P directory (post-removal) | users (read/suspend only) | existing admin directory (read paths) | explicit-T only |

### UI-6 States / A11y (program-wide)

Reuse FIX P5 + B17 §7–8: neutral loading shell, epoch-scoped errors + Retry, dirty-draft guard
on editors, transition clearing (uploads/OTPs/caches) on Exit/switch, real tablist/dialog
semantics, logical RTL, AR/EN copy, honest empties, no new toast/skeleton/theme.

### UI-7 E2E Scenarios (for QA)

- E-1 E dept services → typed answers (each `answer_type`) + independent attachment +
  `attachment_required` blocks submit → banner. E-2 documents tab fill + evidence → W sees.
  E-3 initiatives performed + proof → C/W read. E-4 cross-dept access attempt → denied.
- C-1 linked services read-only (masked columns absent, not hidden). C-2 confirm dept
  preliminary → client_approved; incomplete group → 409 names depts. C-3 C answers attempt → 403.
  C-4 C drafts + submits staff list (own tenant); sees no approve/OTP.
- W-1 link/unlink service in bound workspace; cross-tenant link → 403. W-2 set participating
  depts; remove dept with work → 409. W-3 auto-match + override; unmatched blocks assignment.
  W-4 N/A disclosure-scope + item-scope with reason; attachment-required shortcut → 409;
  frozen → 409. W-5 mask change hides column from C view; smuggled key → 400.
  W-6 approve-provision → OTPs once; reload → no redisplay; delivery (email status OR reveal-ack).
- P-1 P provisioning UI absent; direct approve call → 403 + audit; directory read still works.
- AR + EN + mobile drawer passes for (a)–(d).

---

## API MODULE

### API-1 Conventions (unchanged, extended)

`authMiddleware` + `requireFreshPassword` (all writes) + `requireDomainAccess`; workspace
routes additionally assert `mode==='consultant' && role==='ge_admin'` (defence-in-depth beside
the matrix, same as `serviceVisibility.ts`); `domainTransaction` + tenant/dept predicates
(`ownTenant`, `resolveLinkedService`); codes immutable; natural-key upserts; audit in-txn;
`writeFailure`/`deferredFailure` shapes; unknown combos fail closed.

### API-2 Explicit route list

**CONSUME (no change — FIX + existing):** catalog CRUD (`POST /standards|/disclosures|/items/bulk`,
`GET /items/:id/history`, `DELETE /services/:id`), import preview/commit (+`/gri/*` alias),
seal + copy-viewer, settings whitelist, `/api/queue`, answer/evidence/documents/initiative
endpoints, `GET /staff-lists`, `POST /staff-lists`, `POST /staff-lists/:id/submit`,
`POST /staff-lists/:id/reject`, `PATCH /workspace/services/:serviceId/visibility`.

**ADD (U4-3, all W-bound unless noted):**

- `POST /api/workspace/client-services` `{serviceId}` → link (W bound-A; 409 if linked/work-conflict).
- `DELETE /api/workspace/client-services/:serviceId` → unlink (precondition: zero tenant work
  or archived-scope satisfied; else 409 `service.unlink_blocked`).
- `PUT /api/workspace/participating-departments` `{departmentIds[]}` → set (depts must belong
  to A; removal with work → 409).
- `PUT /api/workspace/dept-matching` `{mappings[{serviceDeptCode|itemDeptKey, clientDeptId}]}` →
  override table (unmatched → 400 `match.incomplete` on assignment attempts).
- `POST /assignments/na` EXTENDED `{scope: 'item'|'disclosure', itemId|disclosureId, departmentId?,
  naReason, justification?}` → scope-aware N/A (defaults per G2; attachment/freeze guards preserved).
- `POST /api/assignments/na/lift` `{scope, ref, reason}` → lift (default W-only; G2 decides).
- `POST /api/staff-lists` EXTENDED actor set: C (own-company) + W (bound-A draft authority,
  no provisioning) — behavior unchanged, matrix updated for W-in-workspace.
- `POST /api/staff-lists/:id/deliver` `{channel: 'email'|'reveal-ack', recipientIds?}` → delivery
  metadata (no secrets in request/response/log); email channel exists only if G1-i picked
  (else 400 `delivery.email_unavailable`).
- `POST /api/workspace/staff/:userId/complete-password` `{temporaryPassword}` → W-assisted
  completion (hash-only storage, must_change_password stays true until user rotates; G5 decides exact UX).

**CHANGE (matrix/backend only, no FIX behavior change):**

- `POST /staff-lists/:id/approve` actor P@T → **W bound-A** (owner delta G-13); OTP-once,
  all-or-nothing, explicit target = bound A (no explicit-T needed; mismatch → 403).
  Fate of P leg per G3 (UI-removal-only default: route keeps P-denied branch + audit).
- `POST /staff-lists/:id/reject` actors P@T + **W bound-A** (reason required); C unchanged (no reject).
- `PATCH /workspace/services/:serviceId/visibility` vocabulary extended (G6 additions);
  single-column guard unchanged.

**REMOVE from surfaces (no route deletion unless G3 confirms full retire):**

- P views stop calling approve/reject/OTP endpoints (UI removal); routes stay behind the
  matrix (default) or are deleted (only on G3 full-retire confirm + deprecation note).

### API-3 Request / Response / Errors

- Shapes keep `{error, code?}`; new codes: `service.link_conflict`, `service.unlink_blocked`,
  `match.incomplete`, `na.scope_invalid`, `na.reason_required`, `na.lift_forbidden`,
  `delivery.email_unavailable`, `delivery.failed`, `provision.actor_forbidden`,
  `service.mask_unknown_field` (exists as `service.mask_invalid` — extended, not renamed).
- Approve response: `{provisioned, accounts: [{email, oneTimePassword}]}` ONCE (existing shape,
  actor W); delivery response: `{delivered[], failed[], channel}` with NO secrets.
- N/A responses: `{evaluationId, notApplicable: true, scope, naReason}`; aggregates exclude
  N/A (never zero-fill).

### API-4 Idempotency / Compatibility

- Natural keys + `ON CONFLICT` retained; link/matching/dept-set are idempotent upserts;
  N/A re-post on existing evaluation → 409 (existing); delivery retry touches delivery-status
  only (no re-provision, no OTP regeneration); reveal-ack is idempotent acknowledgment.
- No breaking change to FIX routes or E/C read shapes; staff-list reads gain `deliveryStatus`
  (additive, nullable); visibility reads gain new vocabulary keys (additive).

### API-5 Auth matrix deltas (P/W/C/E) — the First-Task-Rule enumeration

| Route | P | W (bound-A) | C (own-tenant) | E (own-dept) |
|---|---|---|---|---|
| E queue/item/answer/attachment/documents/initiatives (existing) | — (config only) | read review | read | **allow own-dept only** (deny otherwise) |
| C service detail + ClientReview confirm/reopen | allow (config view) | read + review actions (no confirm) | **allow confirm/reopen own-tenant** (deny answer) | deny |
| `POST/DELETE /api/workspace/client-services` (NEW) | deny (platform links via config, not this route) | **allow bound-A** | deny | deny |
| `PUT …/participating-departments`, `PUT …/dept-matching` (NEW) | deny | **allow bound-A** | deny | deny |
| `POST /assignments/na` (+ scope ext.) / `…/na/lift` | deny* | **allow R+L bound-A** | deny (propose via reopen only) | deny |
| `PATCH …/visibility` (vocab ext.) | deny | **allow bound-A** | deny | deny |
| `GET /staff-lists` | allow P@T (read; post-removal: no action cols) | **allow bound-A** | allow own-company | deny |
| `POST /staff-lists` / `…/:id/submit` | deny | **allow draft/submit bound-A** (no provision) | **allow draft/submit own-company** | deny |
| `POST …/:id/approve` (actor shift) | **deny** (default; emergency explicit-T only if G3 keeps route) | **allow bound-A (provisions, OTP once)** | deny | deny |
| `POST …/:id/reject` | allow P@T (emergency) / default denied-UI | **allow bound-A (reason)** | deny | deny |
| `POST …/:id/deliver` (NEW) | deny | **allow bound-A** | deny (receives via relay/inbox, never secrets) | deny |
| `POST …/staff/:userId/complete-password` (NEW) | deny | **allow bound-A** | deny | deny (self-rotate via login flow only) |
| Seal / copy-viewer / catalog / import (FIX) | per FIX API-5 (unchanged) | per FIX (unchanged) | per FIX (unchanged) | per FIX (unchanged) |

\* P N/A shortcut stays refused by the matrix (existing comment: P/C/E refused before handler;
W R+L only) — unchanged.

**Owner delta made explicit:** B17 §6 line 89's "P review/approve-provision/reject+OTP" leg is
**superseded**: approve-provision + OTP + delivery belong to **W**; P retains directory
read/suspend only. C retains read/draft/submit (no reject/provision). Recorded per task instruction.

---

## DB / MIGRATION MODULE — zero-DDL design

### DB-1 No new tables (recommendation with rationale)

All four units are satisfiable on the FIX-migrated schema: `services/client_services`
(link + `client_field_mask`), `departments`, `assignments` (participation derivation),
`items` (single `department_id`), `answers/evaluations/evidence_files` (typed + independent
attachments + N/A columns), dept documents + initiative status tables (existing U4-1c),
`staff_lists` + rows, `users` (`must_change_password`, hash-only), `review_snapshots`
(freeze), `approved_service_copies` (untouched), `audit_log`. No `ALTER`, no backfill, no
`NOT VALID` — rollback = code revert.

### DB-2 If G2 forces a scope column (deferred, NOT smuggled)

Should the owner rule disclosure-level N/A as a first-class scope row (rather than a
set of item N/As + report filter), the migration is a separate SDA_REQUIRED design:
options (i) `na_scopes(client_id, scope_type, scope_ref, reason, …)` with RESTRICT-aware
aggregates, vs (ii) derived disclosure-N/A (all-items-N/A + report rule, zero DDL —
recommended default). U4-3 ships (ii) unless the owner explicitly orders (i).

### DB-3 Constraints / transactions

- Existing CHECKs (5 MB, status enums, `ON DELETE RESTRICT` on `item_versions`) untouched;
  new validators are handler-level (`documents.ts`/`departmentInitiatives.ts`/`b11b.ts` +
  new N/A-scope + mask-vocabulary validators in the same pure-helper discipline).
- Transaction boundaries: link/unlink (one txn + work-precondition counts + audit);
  participating-depts set (one txn, removal-with-work check first); matching override
  (one txn + audit); N/A scope set/lift (single txn: freeze check → evaluation/answer writes →
  audit; stale version → ROLLBACK + 409); approve-provision (existing all-or-nothing txn,
  actor W, OTP-once); delivery (separate txn AFTER provisioning; failures affect delivery
  status only, never accounts).
- RLS/GRANT: no change expected (W-bound-A UPDATE of own `client_services` row already
  admitted per `serviceVisibility.ts` comment); any gap found in build → narrow policy
  addition with SecurityAgent re-audit (same pattern as FIX P4-R2 branch).

---

## SECURITY / PROTOCOL MODULE

### SEC-1 Trust boundaries & identity

W actions bind to the verified workspace envelope (never `user.clientName`, URL, or storage —
B17 §2); every W route re-asserts `mode==='consultant'` + `tenantId===bound A`. C actions bind
to session own-company; E to own dept. P-config vs P@T separation preserved.

### SEC-2 Credential lifecycle (BOTH options, end-to-end)

- **Generation**: server-side CSPRNG (`generateOneTimePassword` pattern), `hashPassword`
  before store; plaintext exists only in the approve-response memory + (email option) the
  outbound message buffer. Never persisted, never logged, never audited.
- **(ii) Reveal-only (default if G1-ii)**: approve response panel shows each OTP once with
  copy + explicit acknowledge; acknowledge clears memory + sets `deliveryStatus='revealed-to-W'`;
  no GET endpoint returns OTPs (N-7 proves); C relays out-of-band; W/C inbox carries
  "credentials ready — contact your consultant" with no secret.
- **(i) Email (only if G1-i)**: owner supplies SMTP endpoint + account (env/secret store,
  never files); server-side send in the delivery txn; per-recipient status
  (`sent/failed`); retry = delivery-only; message contains OTP + forced-rotation instruction;
  send failures never roll back accounts; audit = `{channel:'email', delivered, failed}` only.
- **Completion**: provisioned accounts start `must_change_password=true`; login forces rotation
  before any action (S-11 preserved); W-assisted completion sets a temporary (same forced
  rotation); C/E never handle secrets.

### SEC-3 Wire / state sequence (provision → deliver → complete)

`approve (W, bound-A, all-or-nothing, OTP-once)` → `deliver (email statuses | reveal-ack)` →
`first-login forced rotation` → `active`. Every transition audited with metadata only.
Replay of reveal → refused; replay of delivery → idempotent status; replay of approve on
approved list → 409.

---

## WORKFLOW MODULE

- **Answers**: `draft → submitted → approved(dept preliminary) → client_approved(C confirm) →
  GE-final` + `reopened/returned` (FIX G-3 path: snapshot + history). Guards: own-dept (E),
  attachment-required blocks submit (even N/A), frozen → 409.
- **N/A scope** (pending G2): `proposed → set(W, reasoned, scope=item|disclosure) → lifted(W, reason)`
  or `C-proposes-via-reopen → W-decides`. Invalid transitions (lift with downstream GE-final,
  set on frozen without note-path, reason-less) refused with named codes.
- **Staff lists**: `draft → submitted(C|W) → approved(W, provisions) | rejected(W|P-emergency, reason)`;
  W/C can never mint `approved` except via the approve route (existing `WITH CHECK` pin +
  matrix). Delivery sub-state: `undelivered → emailed|revealed → completed(rotation done)`.
- **Linking/matching**: `unlinked → linked → participating-set → matched → assigned`; unlink /
  dept-removal with live work refused; unmatched blocks assignment (explicit, not silent).
- Concurrency: optimistic versions on evaluations/answers (`expectedVersion` → 409);
  approve/match/link single-txn with `FOR UPDATE` where FIX patterns require it.

---

## Handback checklist

- Spec path: `prototype-app/project-control/task-engineering-reviews/TASK-PROTO-U4-3_TECHNICAL_SPECIFICATION.md`
- Gaps: G1–G4 (owner decisions, build-gating per unit) + G5–G7 (new, proposed defaults)
- STOP/ASK: owner picks on G1 (email vs reveal-only), G2 (N/A scope semantics), G3 (P route fate), G4 (matching UX); (a)+(b) buildable on spec approval alone
- Decision: REVISION_REQUIRED (narrow: G1–G4) → APPROVED_FOR_GATE per unit on answers
- Return: completed + spec path + gap list + STOP/ASK
