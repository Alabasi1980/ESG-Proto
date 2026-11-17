# TASK-PROTO-U4-2-FIX — Technical Specification (design only, NOT execution-authorized)

> Status: DESIGN ONLY — Draft. No code, no migration, no live DB. This file is the
> sole allowed write target of this design task.
> Classification: **SDA_REQUIRED** (DB schema/migration · auth/permissions mutation ·
> public API contract · cross-module behavior · approval state machine). Impact overrides complexity.
> Governing product decisions: `prototype/OWNER_DECISIONS.md` OD-07, OD-11, OD-12, OD-13.
> Task scope: `project-control/tasks/TASK-PROTO-U4-2/TASK-PROTO-U4-2.md` §7 FIX scope.
> Technology profile: `prototype/TECHNOLOGY_PROFILE_DRAFT.md` (APPROVED).

---

## CORE

### 1. Task Identity

| Field | Value |
|---|---|
| Task | TASK-PROTO-U4-2-FIX (Draft — design only, NOT execution-authorized) |
| Title | Services workspace correction — faithful implementation of owner review 2026-11-17 (OD-13) |
| Stage | Phase 5 (Execution Planning) → Pre-Execution Gate |
| Designer | tera-software-designer (مصمم) |
| Classification | SDA_REQUIRED |

### 2. Objective

Correct the Services workspace (P only) so that owner review 2026-11-17 (OD-13) is
faithfully implemented: flexible service structure, one department per item,
reopen-with-history before final approval, delete-preserves-history on non-approved
clients, and an approved client-service copy that survives **even full removal of the
source service** — with service-definition vs client-application strictly separated,
no client/department writes from Services, and an import that never requires or
provisions a client scope.

### 3. In Scope / Out of Scope

**In scope (FIX only, no U4-3):**
- Full CRUD for standards / disclosures / items from the Services screen, at every
  supported level (incl. groups and direct items).
- Retire standalone Rules tab → per-item settings + bulk edit inside Content.
- Remove JSON settings editor → identity form + named fields only.
- Service-scoped import redesign: per-service template download, column mapping,
  preview, row-level errors; **no client required, no assignment writes**.
- Remove all client/department linking UI from Services (bulk-assign bar,
  import target-client picker, department auto-provisioning on import).
- Service-definition vs client-application separation rule (design + enforcement points).
- Reflection-before-approval + freeze-after-approval semantics incl. full-removal immunity.
- Approval-state-machine-aware edit/delete paths (reopen-with-history,
  delete-preserves-history, approved-copy capture).

**Out of scope (explicitly NOT this task):**
- U4-3 contextual screens and U4-4 cross-service linking (reuse patterns only).
- Staff Lists relocation, GE-consultant password provisioning (recorded for U4-3).
- New services beyond GRI file format (column-mapping framework only; one parser today).
- Production object-storage migration (OD-06 demo-scale bytea stays).
- Any change to W/C/E behavior outside the auth-matrix deltas in §API-5.

### 4. Governing Sources (exact lines relied on)

| # | Source | Exact reliance |
|---|---|---|
| G-1 | OD-13.1 | "هيكل الخدمة مرن… لا يُفرض تسلسل Standards → Disclosures → Items. تُدعم البنى: معيار ← إفصاح ← بنود، أو مجموعة ← بنود، أو بنود مباشرة. Item details هي تفاصيل البند وليست مستوى إضافياً." |
| G-2 | OD-13.2 | "البند لقسم واحد: لا يُسند البند نفسه لأكثر من قسم في تعريف الخدمة." |
| G-3 | OD-13.3 | "تعديل بند معتمد مبدئياً قبل الاعتماد النهائي… يُعاد فتح البند للعميل، ويُحفظ البند القديم وإجاباته كسجل تاريخي… لا تُمحى الإجابة القديمة ولا تُحوَّل بصمت." |
| G-4 | OD-13.4 | "حذف بند من خدمة عليها عمل لعميل غير معتمد: يُزال من المطلوب الحالي للعميل غير المعتمد، مع حفظ إجاباته ومرفقاته واعتماداته السابقة في التاريخ (لا حذف نهائي)." |
| G-5 | OD-13.5 (extra binding condition) | "يجب أن توجد آلية قوية للحفاظ على الخدمة المعتمدة لعميل بحيث لا تتأثر بأي تغيير لاحق على الخدمة الأصلية — حتى لو أُزيلت الخدمة كاملة… النسخة المعتمدة تبقى كاملة وقابلة للعرض (تعريف + محتوى + نطاق + نتائج + مراجع المرفقات)." |
| G-6 | OD-07 | One generic content model (standards → disclosures → items); per-service variance lives in adapters + settings, never new per-service tables. |
| G-7 | OD-11.2 | Service is first-class; no service hard-coded in nav/dashboards/reports; per-service screen + per-service import. |
| G-8 | OD-11.3 | Link reflection: an answer applies to linked items (even cross-service); group evaluated once; answer origin shown. (Reflection-before-approval.) |
| G-9 | OD-11.4 | Role matrix P/W/C/E incl. P owns services/content/rules/settings/users/import + GE-final work; C never answers; W never answers; E own-department items only. |
| G-10 | OD-12.1/12.2 | Typed answers (answer_type), attachment as independent field, attachment_required blocks submit even with N/A. |
| G-11 | OD-12.7 | Free question = real requirement; per-service GENERAL bucket auto-created (standard `GENERAL-<CODE>-<suffix>`, disclosure `GENERAL`); no schema change. Proved by `src/lib/generalBucket.ts` + `ensureGeneralBucket` in service create/duplicate/PATCH backfill. |
| G-12 | TASK-PROTO-U4-2 §7 | FIX scope list (full CRUD, retire Rules tab, remove JSON editor, service-scoped import, no client/department writes in Services, separation rule, reflection + freeze incl. full-removal immunity, designer first). |
| G-13 | Current code facts | `src/server/taxonomy.ts`: service code immutable; standard/disclosure codes immutable; no POST /standards, POST /disclosures, DELETE /services; item DELETE hard-deletes with 409 refusal on any blocker (answers/evaluations/assignments/actions); `src/server/routes/gri.ts` commit REQUIRES explicit clientId + linked serviceId and auto-provisions departments/assignments under tenant advisory lock; `src/server/routes/adminAssignments.ts` owns assignment writes; `is_scope_frozen` resolves disclosure via `items.disclosure_id` (freeze triggers in `src/db/schema.sql` + `src/db/b17-content.sql`); `serviceSettings.ts` 8 KB JSONB contract. |

### 5. Decision Provenance

| Decision | Source | Authority | Status |
|---|---|---|---|
| D-1 Flexible levels via GENERAL + GROUP bucket convention, zero DDL | OD-13.1 + OD-12.7 (G-11 pattern) | Approved source (owner pattern), extended by analogy to groups | TECHNICAL_CHOICE (needs gate eyes, behavior fully covered by G-1/G-11) |
| D-2 Single department per item = existing `items.department_id` (one FK), UI single-select, no multi-assign in definition | OD-13.2 | Approved source | APPROVED_SOURCE |
| D-3 Reopen-with-history = `item_versions` snapshot + answers→`reopened` + correction_history append (trigger already enforces) | OD-13.3 + existing `enforce_answer_correction_history` trigger | Approved source + technical choice (table shape) | APPROVED_SOURCE (behavior) / TECHNICAL_CHOICE (table shape) |
| D-4 Delete-with-work = archive (status flag), never hard delete when tenant work exists; scope removal = per-client assignment delete allowed with history retained | OD-13.4 | Approved source | APPROVED_SOURCE |
| D-5 Approved-copy immunity = frozen deep-copy tables (`approved_service_copies` + `approved_copy_files`), self-contained payload incl. attachment bytes | OD-13.5 | Approved source (mechanism is the only one surviving full CASCADE removal) | TECHNICAL_CHOICE (mechanism; see DB §DB-3 comparison) |
| D-6 Import becomes catalog-only (no clientId, no department/assignment provisioning) | OD-13 scope + TASK §7 ("no client requirement, no assignment writes") | Approved source | APPROVED_SOURCE |
| D-7 Retire Rules tab + JSON editor; named settings fields | TASK §7 | Approved source | APPROVED_SOURCE |
| D-8 Assignment writes leave the Services surface (routes stay under admin/U4-3 authority) | TASK §7 + `adminAssignments.ts` ownership | Approved source | APPROVED_SOURCE |
| D-9 Column-mapping framework with GRI as first adapter | OD-07 adapter principle + TASK §7 | Approved source (principle) / TECHNICAL_CHOICE (mapping UX shape) | APPROVED_SOURCE / TECHNICAL_CHOICE |
| D-10 Points 6–8 of the 8-point review have no recorded text | OD-13 header ("النقاط 1–8") vs 5 recorded sub-points | — | NEEDS_DECISION → DG-01 |

### 6. Technical Invariants (must remain true before/after)

1. **INV-DEF-APP**: Services defines the catalog; client application (assignments,
   answers, approvals, evaluations) is never written from the Services surface.
2. **INV-SINGLE-DEPT**: An item carries at most one department (`items.department_id`);
   no multi-department definition, no parallel department answers for one item
   (existing `b17_content_fact('writable')` denial preserved).
3. **INV-CODE-IMMUTABLE**: Service / standard / disclosure / item codes are natural
   keys and immutable (existing 400s preserved).
4. **INV-REFLECT-BEFORE-APPROVE**: Linked items reflect answers pre-approval exactly
   once per group with visible origin (OD-11.3); this FIX changes no scoring path.
5. **INV-FREEZE-AFTER-APPROVE**: Frozen scope (tenant snapshot, or disclosure snapshot
   via `is_scope_frozen`) refuses writes at API (409) and trigger level; only
   append-only snapshot notes pass.
6. **INV-APPROVED-IMMUNE**: A GE-final approved client-service copy is fully
   self-contained (definition + content + scope + results + attachment bytes/refs)
   and remains viewable after ANY source mutation **including full source-service
   removal**. No live FK from the copy to catalog/tenant work rows.
7. **INV-HISTORY**: No silent overwrite and no hard loss: item edits with prior
   tenant answers snapshot first (G-3); deletes with tenant work archive first
   (G-4); answer edits keep appending `correction_history` (existing trigger).
8. **INV-IMPORT-SAFE**: Import never requires a client, never provisions
   departments/assignments, never mutates `client_services`, never touches frozen
   rows (skip-with-reason preserved from current commit).
9. **INV-TENANT-ISOLATION**: Cross-tenant reads/writes fail closed (403/404
   existing semantics); P catalog vs P@T config contexts stay separate
   (`b17_platform_scope` vs `b17_platform_config`); RLS/FORCE RLS untouched.
10. **INV-AUDIT**: Every catalog/config mutation appends an `audit_log` row in the
    same transaction (existing action vocabulary extended, never renamed).

### 7. Dependencies

- Code: `taxonomy.ts` (catalog routes), `routes/gri.ts` (import), `routes/adminAssignments.ts`
  (assignment ownership boundary), `lib/serviceSettings.ts` + test, `lib/generalBucket.ts`,
  `lib/taxonomy.ts` (validators), `lib/documents.ts` (indicator/tags), `scope.ts` + `access.ts`
  + `routes/_shared.ts` + `routes/initiativeScope.ts` (contexts/freeze), `db/schema.sql` +
  `db/b17-content.sql` (triggers/RLS/facts — read-only here).
- UI: `ServicesView.tsx`, `ServiceContentPanel.tsx`, `ServiceRail.tsx`, i18n keys.
- Decisions: OD-07/11/12/13; profile `TECHNOLOGY_PROFILE_DRAFT.md` (First Task Rule,
  ORM rules, Forbidden Defaults, gate additions).
- Blocking input: DG-01 (owner confirms points 6–8 vs FIX scope default).

### 8. Side-Effect Registry

| Area | Effect | Handling |
|---|---|---|
| Services screen | Tabs `overview·content·settings·import`; Rules tab + JSON editor + bulk-assign + client pickers removed | UI §UI-1; i18n key cleanup (no orphan keys) |
| U4-3 / U4-4 | Reuse Content drill + side-panel + import patterns | No change now; patterns documented in UI §UI-6 |
| Reports/exports | Archived items excluded from live scope; frozen/approved reads prefer approved copy when service removed | Report/export queries filter `items.status='active'`; copy viewer is additive |
| Import (GRI) | Commit no longer tenant-bound; departments/assignments provisioning deleted from this path | API §API-3; tenant provisioning (if still wanted anywhere) is a U4-3/admin concern, NOT re-added here |
| Permissions | New P-only routes; approved-copy read matrix (P+W+C-own-tenant, E denied); Services UI drops all assignment calls | API §API-5 matrix; no C/E capability gain |
| Audit | New actions: `CREATE_STANDARD`, `CREATE_DISCLOSURE`, `ARCHIVE_ITEM`, `REOPEN_ITEM_SCOPE`, `APPROVED_COPY_SEALED`, `SERVICE_DELETED`, `IMPORT_CATALOG_COMMITTED` | Additive; existing names untouched |
| Freeze/scoring | Untouched semantics; disclosure-scope freeze keeps resolving via non-null `items.disclosure_id` (why D-1 avoids nullable FK) | DB §DB-2 rationale |
| Storage | Approved copies + copied attachment bytes grow DB (demo-scale; monitor per OD-06) | DB §DB-3 trade-offs; storage note in copy viewer |

### 9. Failure & Recovery

| Failure | Response | Recovery |
|---|---|---|
| Import file with row errors | Commit refused (400 + per-row errors); nothing written (single txn, validation before upsert) | Fix file → re-preview; `import_batch_id` makes retry idempotent |
| Partial import crash mid-commit | Txn rolls back whole commit (existing atomicity); preview artefacts are not persisted | Re-run commit with same batch id (upsert idempotent) |
| Edit on frozen scope | 409 `FROZEN_SCOPE` (API pre-check) + trigger backstop | Append `snapshot_notes` only; no silent bypass |
| Edit on approved-but-not-final item | Snapshot to `item_versions`, answers→`reopened`, audit `REOPEN_ITEM_SCOPE` | Old version + answers viewable in history drawer; re-submit workflow resumes |
| Delete item/service with blockers | Archive path (not hard delete); full-service delete refused while any approved copy seal is missing for approved tenants (DG-02 preconditions) | Unarchive via P action (audit); history intact |
| Cross-tenant access | 403/404 existing semantics; new copy-viewer checks `client_id` ownership server-side | No data leak; audit the attempt |
| Concurrent edits | Optimistic `version` on items (new column, same pattern as answers/evaluations A-15) → 409 on stale write | Re-fetch, merge, retry |
| Copy hash mismatch on seal | Seal refused; copy not marked complete | Re-run seal in same txn; `content_hash` recomputed |
| Migration failure | Forward-only DDL is additive + idempotent (DO-blocks); rollback = stop writing new tables, old paths untouched | Zero-data-loss conditions §DB-6 |

### 10. Security Classification

- **Trust boundaries**: P (platform config, tenant-NULL or explicit-T) · W (consultant
  inside client A) · C (client_admin, own tenant) · E (own department only). Server
  selects purpose/target; request values never trusted (profile First Task Rule).
- **AuthN/Z**: `authMiddleware` + `requireFreshPassword` (writes) + `requireDomainAccess`
  on every new route; unknown combinations fail closed.
- **Approval state machine**:
  `draft → submitted → approved(dept) → client_approved → GE-final(sealed copy)` with
  `reopened/returned` loops. Transitions: E files; dept head preliminary; C confirms;
  GE finalizes + seals copy. Pre-final catalog edit ⇒ snapshot + reopen (G-3). Post-final
  ⇒ frozen (INV-5); post-final catalog edit ⇒ new version + optional re-seal, never
  mutation of the sealed copy (INV-6).
- **Secrets**: None in code/i18n/logs (profile §8). Attachment bytes stay in DB
  (OD-06 cap 5 MB CHECK preserved, incl. copy table).
- **Audit**: All mutations audited in-txn; new actions whitelisted into the
  `b17_audit_insert` config branches (same pattern as existing catalog actions).
- **Threat assumptions**: Malicious/buggy P client (validate everything, code
  immutability, size caps), cross-tenant probing (fail closed + tests), frozen-scope
  bypass attempts (API + trigger double wall), full-service deletion destroying
  evidence (immunity by physical copy, INV-6).

### 11. Verification Strategy

- Unit (existing harness `node:test` + behavioral file-pin tests): bucket convention
  (GENERAL/GROUP code shape, idempotence), settings named-field validator, content-tree
  collapse rules, `item_versions` snapshot trigger logic, copy `content_hash` stability.
- API contract tests (P/W/C/E × each route in §API-2): allowed → 2xx, others → 403/404.
- **Negative tests (mandatory)**: (N-1) cross-tenant read of another tenant's items,
  assignments, approved copy → 403; (N-2) write to frozen scope (answer/item/import
  row) → 409 + trigger error; (N-3) delete source service fully, then view approved
  copy (definition + content + scope + results + attachment bytes) → 200 complete;
  (N-4) edit approved-not-final item → old version + answers in history, status
  `reopened`; (N-5) import without clientId → 200 catalog commit, zero departments/
  assignments created; (N-6) assign second department to one item → 400;
  (N-7) stale-version item PATCH → 409; (N-8) C/E POST to any new catalog route → 403.
- Lint/tests/build green; zero literal colors; AR/EN visual passes; independent
  design-reviewer + QA functional pass (rounds per TASK §4 pattern).

### 12. Reviewers (suggested post-execution)

SecurityAgent (auth matrix + freeze/immunity + RLS deltas), QA (E2E §UI-7 + N-1..N-8),
Auditor (audit vocabulary + history preservation), Tera (gate), Majed (DG-01 owner answer).

### 13. Engineering Review Decision

**REVISION_REQUIRED (narrow, single owner question)** — the design below is
gate-ready in all modules **except** DG-01: the OD-13 header cites review points
1–8 but only sub-points 1–5 + the extra condition are recorded. Proposed default
(let the gate proceed on it unless the owner corrects): FIX scope = TASK §7 as
written (the 5 answers + extra condition); unrecorded points 6–8 are assumed covered
by the U4-3 records (staff lists, GE-consultant password) or withdrawn. One-line
owner confirmation closes DG-01 → decision becomes APPROVED_FOR_GATE with no other change.

### 14. Design Gaps

| ID | Gap (owner-facing wording) | Impact | Proposed default |
|---|---|---|---|
| DG-01 | "مراجعة 2026-11-17 تذكر النقاط 1–8، لكن المسجّل في OD-13 هو خمسة بنود + الشرط الإضافي. هل نطاق الإصلاح هو هذه البنود الخمسة + الشرط فقط، أم توجد بنود 6–8 تحتاج تصميماً؟" | Gate-blocking question | FIX = §7 as written; 6–8 assumed U4-3/withdrawn |
| DG-02 | "حذف خدمة كاملة: هل يُسمح به فقط بعد ختم نسخة معتمدة لكل عميل معتمد، أم يُمنع نهائياً عند وجود أي عميل مرتبط؟" | Service DELETE preconditions | Refuse delete while any approved/unapproved tenant work exists except pure-empty services (archive otherwise); owner to confirm |
| DG-03 | "صيغ الاستيراد لغير GRI (CBB/MSX…) غير معرّفة بعد — أي أعمدة إلزامية لكل خدمة؟" | Column-mapping catalog per service | Ship GRI adapter + mapping framework; new formats need owner sheet (OD-07 revisit trigger) |
| DG-04 | "إعادة الفتح: هل يُخطر العميل/القسم تلقائياً، ومن يعيد التقديم؟" | Reopen notification + resume UX | Notify assigned dept inbox (existing notify fan-out) + status `reopened`; owner confirms wording |
| DG-05 | "نسخ المرفقات في النسخة المعتمدة تستهلك مساحة (5MB×ملفات) — هل نقبل التكلفة أم مراجع فقط مع منع حذف المرفقات الأصلية؟" | Storage vs integrity | Default: copy bytes (immunity is absolute per OD-13.5); monitor per OD-06 |
| DG-06 | "التحرير الجماعي (bulk edit): هل يشمل نقل الأقسام/الأولويات معاً، وكيف تُعالج تعارضات الإصدارات؟" | Bulk semantics | Bulk = answerType/priority/esgClass/attachment_required only, per-row version check, per-row result; department change stays single-item |
| DG-07 | Lifecycle headers: `OWNER_DECISIONS.md` / task file carry no formal Lifecycle Header (MBA check per governance). Accepted here as owner-signed binding; Tera to confirm header requirement for prototype/ docs. | Process | Non-blocking; confirm at gate |

---

## UI MODULE — corrected Services screen

### UI-1 Structure (tabs after FIX)

`overview · content · settings · import` — **Rules tab deleted**, JSON editor deleted.

- **Rail** (unchanged pattern): search + create + counters; counts now computed over
  flexible tree (standards + groups + direct items).
- **Overview**: definition (code/name/description), counts (standards/groups/direct
  items/disclosures/items), linked-clients count (read-only), last catalog import,
  content-state strip. No editing here (unchanged rule).
- **Content**: flexible drill + full CRUD + bulk edit + history (UI-2).
- **Settings**: (a) identity form (code read-only, name, description); (b) **named
  fields** replacing JSON: per-service flags the service needs (e.g. answer modes,
  attachment defaults, visibility defaults — exact field list = DG-03-adjacent,
  schema stays `services.settings` JSONB ≤ 8 KB via `parseServiceSettings`); (c) save
  per card with inline validation. Raw JSON textarea removed.
- **Import** (service-scoped, no client): template download (per-service columns) →
  file pick → column-mapping table → preview (counts + row-level errors) → commit.
  No client picker, no assignment step, no department provisioning mention.

### UI-2 Content tab — flexible levels + full CRUD

Tree root for one service = ordered union of:
1. linked **standards** → disclosures → items (existing shape);
2. **groups** → items (a group = disclosure under the service's auto `GROUP-<CODE>-<suffix>`
   standard, `category='group'`; rendered as "مجموعة / Group", collapsible, NOT labeled معيار);
3. **direct items** (the service's `GENERAL` disclosure under `GENERAL-<CODE>-<suffix>`;
   rendered as "بنود مباشرة / Direct items", NOT labeled إفصاح).

- Breadcrumb adapts: `الكل › [standard › disclosure | group | direct] › item`.
- Item details open in the existing side panel (drawer < 2xl, sticky ≥ 2xl) — details
  are never a tree level (G-1).
- CRUD affordances: create standard (dialog: title + category), create
  disclosure/group (dialog: code + title + description + parent standard/group),
  create item (existing inline form + department **single-select**, indicator_code,
  tags, attachment_required toggle, answerType, priority), edit in side panel (all
  mutable fields incl. department single-select), delete with confirm → archive path
  messaging ("سيُؤرشف مع حفظ التاريخ" vs "حذف نهائي" when no work exists).
- **Bulk edit bar** (replaces bulk-assign): checkbox selection → bulk panel for
  answerType/priority/esgClass/attachment_required → per-row result summary
  (ok/conflict/validation-error). No client/department controls anywhere.
- **History affordance**: per-item "السجل / History" opens drawer section listing
  `item_versions` (old field snapshots, who/when/why) + link to answer history
  (existing audit/correction trail). Deleted-with-work items show archived state +
  retained history.

### UI-3 Data Bindings

| Element | Source entity/field | API | Params |
|---|---|---|---|
| Rail cards | `services` + counts | GET `/api/services`, `/standards`, `/disclosures`, `/items` | — (client-side roll-up, existing) |
| Standards/groups nodes | `standards` (+`service_standards` link) | GET list; POST `/api/standards`; PATCH/DELETE `/api/standards/:id` | `{title, category}` / `{title, category}` |
| Disclosures nodes | `disclosures` | GET list; POST `/api/disclosures`; PATCH/DELETE `/api/disclosures/:id` | `{standardId, code, title, description}` |
| Items rows/panel | `items` (+ dept name) | GET `/items?disclosureId=`; POST `/api/items`; PATCH/DELETE `/api/items/:id` | full item field set incl. single `departmentId` |
| Bulk edit | `items` set | POST `/api/items/bulk` | `{ids[], patch, expectedVersions{}}` |
| History drawer | `item_versions` | GET `/api/items/:id/history` | — |
| Identity form | `services` | PATCH `/api/services/:id` | `{name, description}` |
| Named settings | `services.settings` | PATCH `/api/services/:id` | `{settings: <named object>}` |
| Duplicate | services | POST `/api/services/:id/duplicate` | `{code, name?}` |
| Link/unlink standard | `service_standards` | POST/DELETE `/api/services/:id/standards` | `{standardId}` |
| Import template | per-service columns | GET `/api/services/:id/import/template` | — (download) |
| Import preview/commit | parse + catalog upsert | POST `/api/import/preview`, POST `/api/import/commit` | `{serviceId, rows, columnMapping}` → `{standards[]}` |
| Approved copy viewer | `approved_service_copies` | GET `/api/services/:id/approved-copy?clientId=` (P/W/C-own) | read-only, works after source deletion |

### UI-4 States

Skeleton rail + workspace (existing); honest empty states per level with the single
relevant CTA (create standard / create group / add direct item / import); failure box
with retry (existing `friendlyError`, never raw browser strings); success inline;
dirty-draft guard on panel close (existing); frozen-scope banner when service content
is under GE-final snapshot ("للقراءة — معتمد نهائياً"); archived-item styling.

### UI-5 Accessibility

Keep all U4-2 patterns: real tablist (roving tabindex, arrows/Home/End, persistent
panels), dialog focus trap + Escape + focus return, `bdi`/ltr isolation for codes,
logical RTL properties only, labeled controls, `role=status/alert` for notices.
History drawer and mapping table follow the same dialog/table semantics.

### UI-6 E2E Scenarios (for QA)

E-1 create service → GENERAL + GROUP buckets auto-exist → add direct item (no
standard/disclosure touched). E-2 create group → add items → move item group→direct
(PATCH disclosure path? no — item edit keeps disclosure; moving = archive + recreate
under target with history note; DG-04-adjacent, default documented). E-3 full item
lifecycle: create → set single dept → bulk-edit priority → history shows versions.
E-4 approved-not-final edit → reopen banner + history intact + resume submit. E-5
delete item with work → archived + history viewable + removed from live scope. E-6
import: template → map columns → preview row errors → commit (no client) → counts.
E-7 delete source service (empty) → gone; delete with approved tenant → refused
(DG-02). E-8 view approved copy after source removal → complete (N-3). E-9 AR + EN +
mobile drawer passes.

---

## API MODULE — route deltas

### API-1 Conventions (unchanged)

P-only writes (`authMiddleware` + `requireFreshPassword` + `requireDomainAccess`,
`platformConfigContext`/`platform.config`); reads per existing matrix; codes immutable
(400); natural-key upserts (409 on conflict); refusal counts via
`b17_catalog_child_count` before deletes; `catalogFailure` byte-preserving errors;
audit in-txn.

### API-2 Explicit route list

**KEEP (no change):** `GET /services|/standards|/disclosures|/items|/items/:id/links`,
`POST /services`, `PATCH /services/:id` (identity), `POST /services/:id/duplicate`,
`POST|DELETE /services/:id/standards`, `POST|DELETE /items/:id/links`,
`GET /gri/dashboard/stats` (non-Services).

**CHANGE:**
- `POST /gri/preview` → `POST /api/import/preview` (alias kept 1 release): accepts
  `{serviceId, file|rows, columnMapping?}`; returns `{summary, rows, errors[]`
  (row-level: row number, column, code, message), `warnings[]`, `unmappedColumns[]`}.
  No auth weakening (P only). No client context.
- `POST /gri/commit` → `POST /api/import/commit` (alias kept): accepts
  `{serviceId, standards[] (mapped), importBatchId?}`; **drops `clientId` entirely**
  (400 `import.client_forbidden` if supplied); catalog upsert only; keeps
  frozen-row skip-with-reason (catalog rows are global — skip applies to rows under
  disclosure snapshots only where determinable without tenant; tenant-wide skip loop
  removed with client scope); removes department auto-provisioning + assignment
  provisioning + tenant advisory-lock provisioning block + `setupNotice` tenant part
  (kept: mapped/unmapped vs target service). Audit `IMPORT_CATALOG_COMMITTED`.
- `PATCH /services/:id` settings branch: keeps 8 KB contract, adds **named-field
  schema validation** (whitelist of known keys per service-kind; unknown keys → 400
  `service.settings_unknown`); raw-JSON acceptance stays server-side (UI just stops
  offering free JSON).
- `PATCH /items/:id`: adds version check (`expectedVersion` → 409 on stale),
  snapshot-to-`item_versions` when tenant answers exist in
  `(submitted, approved, client_approved)` and scope unfrozen (reopen path: answers→
  `reopened`, audit `REOPEN_ITEM_SCOPE`); frozen → 409 (unchanged).
- `DELETE /items/:id`: blocker>0 → **archive** (`status='archived'`, `archived_at`,
  `archive_reason`, audit `ARCHIVE_ITEM`) instead of 409; blockers=0 → hard delete
  (unchanged). Archived items excluded from all live reads; history endpoints keep them.
- `PATCH /standards/:id`, `PATCH /disclosures/:id`: unchanged rules (code immutable,
  no moves) — now also used by group/disclosure CRUD UX.

**ADD (all P-only unless noted):**
- `POST /api/standards` `{code, title, category}` → 201 (409 on code).
- `POST /api/disclosures` `{standardId, code, title, description?}` → 201 (409 natural key).
- `POST /api/items/bulk` `{ids[], patch(whitelisted), expectedVersions{}}` → per-row
  `{id, ok, error?}` (207 multi-status semantics via 200 + row results; never partial silent).
- `GET /api/items/:id/history` → `{versions[], answersSummary?}` (P; W own-tenant via
  readContext — matrix §API-5).
- `DELETE /api/services/:id` → preconditions (DG-02 default): refuse (409) when any
  tenant work (answers/evaluations/assignments) or approved copy exists; else hard
  delete service + buckets + links (catalog CASCADE), audit `SERVICE_DELETED`. P only.
- `GET /api/services/:id/import/template` → per-service CSV (columns for the service
  kind; GRI columns = current sample). P only.
- `POST /api/approved-copies/seal` (GE-finalize path, P only): `{clientId, serviceId}`
  → deep-copies definition + content + scope + results + attachment bytes into
  `approved_service_copies` + `approved_copy_files`, `content_hash`, audit
  `APPROVED_COPY_SEALED`. Must run in the same txn as the GE-final snapshot insert.
- `GET /api/services/:id/approved-copy?clientId=` → sealed copy (P; W own-tenant;
  C own-tenant read). Works with source deleted (no catalog joins).

**REMOVE from Services surface (no route deletion where owned elsewhere):**
- Services UI stops calling `POST /api/assignments`, `DELETE /assignments`
  (bulk-assign bar deleted; routes stay for admin/U4-3 authority — NOT deleted here).
- Import `clientId` + department provisioning deleted from import path (code removal
  in `gri.ts` commit).
- Rules-tab endpoints: none (it reused PATCH items — bulk route supersedes for bulk).

### API-3 Request / Response / Errors (new + changed)

- Errors keep `{error, code?}` shape; new codes: `import.client_forbidden`,
  `service.settings_unknown`, `item.version_conflict`, `item.archived`,
  `service.delete_blocked`, `copy.seal_conflict`, `copy.not_found`.
- Preview/commit responses include row-level errors; commit returns
  `{standardsCount, disclosuresCount, itemsCount, inserted, updated, skipped,
  skippedFrozen[], importBatchId, mappedStandards, unmappedStandards, setupNotice}`.
- Bulk returns per-row results; history returns versions newest-first with
  `{version, snapshot, changedBy, changedAt, reason}`.

### API-4 Idempotency / Compatibility

- Natural keys + `ON CONFLICT` retained everywhere; `import_batch_id` dedupes retries;
  `ensureGeneralBucket`-style ensure for GROUP bucket (same idempotent helper pattern).
- Aliases `/gri/preview|/gri/commit` kept one release, then removed (announced).
- No breaking change to W/C/E read shapes; `items` reads gain `status` field (additive);
  archived rows excluded by default (`?includeArchived=` opt-in for P history views).

### API-5 Auth matrix deltas (P/W/C/E)

| Route | P | W | C | E |
|---|---|---|---|---|
| POST/PATCH/DELETE standards/disclosures/items/bulk, service CRUD/duplicate/link | allow (config ctx) | deny | deny | deny |
| POST import preview/commit, GET import template | allow | deny | deny | deny |
| POST seal approved copy | allow (with GE-final) | deny | deny | deny |
| GET approved copy | allow | own-tenant allow | own-tenant allow | deny |
| GET item history | allow | own-tenant allow | own-tenant allow (gap-gated like evaluations) | own-dept allow (own provenance only) |
| Assignment writes from Services | — (UI removed) | unchanged elsewhere | unchanged | unchanged |

---

## DB / MIGRATION MODULE

### DB-1 Schema delta options — (a) flexible levels

- **O1 — Bucket convention (RECOMMENDED)**: zero DDL. Direct items live in the
  existing GENERAL bucket (OD-12.7, proven). Groups live in a new per-service
  `GROUP-<SLUG>-<SUFFIX>` standard (`category='group'`, disclosure `GENERAL`-style
  container rows as group entries) auto-ensured by a `ensureGroupBucket` helper
  mirroring `generalBucket.ts` (same idempotence contract, called in service
  create/duplicate + PATCH backfill). UI collapses these containers (not labeled
  معيار/إفصاح). **Why**: `is_scope_frozen` + `b17_content_fact('linked'/'frozen'/
  'parent.*')` all resolve via non-null `items.disclosure_id`; nullable FKs would
  force rewriting freeze triggers, RLS facts, and refusal counters — unacceptable
  blast radius for a presentation-level flexibility.
- **O2 — Nullable hierarchy (REJECTED)**: `items.disclosure_id NULL` +
  `items.service_id` direct link + `CHECK (exactly one parent)`. Rejected: breaks
  freeze resolution, catalog facts, unique index `(disclosure_id, code)`, and every
  join in taxonomy/gri/admin paths; backfill + trigger rewrites + re-audit required.

### DB-2 Schema delta — (b) edit history

- **H1 — `item_versions` table (RECOMMENDED)**:
  `id UUID PK, item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,`
  `version INT NOT NULL, snapshot JSONB NOT NULL (full item row), changed_by UUID,`
  `changed_at TIMESTAMPTZ DEFAULT NOW(), reason TEXT, UNIQUE(item_id, version)`.
  Written by the PATCH handler (not a trigger — needs actor + reason) before UPDATE
  whenever tenant answers exist; `items.version INT DEFAULT 1` added for optimistic
  locking; `items.status TEXT DEFAULT 'active' CHECK ('active','archived')` +
  `archived_at`, `archive_reason` for the delete path. `ON DELETE RESTRICT` on
  versions guarantees history survives (service/item hard delete only when zero work).
- **H2 — audit-only (REJECTED as sole mechanism)**: audit payloads are not
  query-shaped for history UX and lack version ordering guarantees; audit stays as
  the second record, not the history store.

### DB-3 Schema delta — (c) approved-service copy immune to source removal

- **F1 — Frozen deep copy (RECOMMENDED)**:
  `approved_service_copies(id PK, client_id FK CASCADE, service_id UUID NULL (no FK — survives source delete), service_code TEXT NOT NULL, sealed_at, sealed_by, content_hash TEXT NOT NULL, payload JSONB NOT NULL (definition + content + scope + results + attachment refs), status TEXT DEFAULT 'sealed')`
  + `approved_copy_files(id PK, copy_id FK CASCADE, answer_ref TEXT, file_name, mime, size_bytes INT CHECK ≤ 5MB, data BYTEA NOT NULL)`.
  Self-contained: zero FKs into catalog or tenant work (only `client_id` CASCADE —
  copy dies with its tenant, never with its service). Viewer reads payload + files only.
- **F2 — Versioned-content references (REJECTED)**: snapshots pointing at live
  `items/answers/attachments` rows. Fails OD-13.5 by construction: full source removal
  (CASCADE from services/standards/disclosures/items → answers → attachments)
  destroys the referenced rows; RESTRICT guards would merely forbid deletion instead
  of surviving it.
- **Storage/audit trade-offs**: F1 duplicates bytes (demo-scale acceptable; OD-06
  monitor extended to copy tables; production needs object storage — recorded, not
  this task). Audit: `APPROVED_COPY_SEALED` with `content_hash` enables later
  integrity re-verification (`seal --verify` recomputes hash).

### DB-4 Constraints

- New CHECKs: `items.status`, `approved_copy_files` 5 MB cap (mirrors OD-06),
  `approved_service_copies.status`; `item_versions.version > 0`.
- `ON DELETE RESTRICT` on `item_versions.item_id`; NO FK from copies to catalog.
- Existing triggers untouched (answer correction history, frozen backstops,
  weight-from-priority, audit append-only); new trigger: none required (handler-owned writes).

### DB-5 Transaction boundaries

- Service create/duplicate/PATCH-backfill: existing single txn + bucket ensures.
- Import commit: single txn (catalog only; tenant advisory lock provisioning block removed).
- Item PATCH with history: `SELECT … FOR UPDATE` (existing) → insert version → UPDATE
  item (version+1) → reopen answers → audit; one txn, stale version → ROLLBACK + 409.
- Item DELETE with work: `FOR UPDATE` → blocker counts → archive UPDATE → audit; one txn.
- GE-finalize + seal: snapshot insert + copy insert + files insert + audit; one txn;
  hash computed over canonical payload before insert; mismatch → ROLLBACK.

### DB-6 Migration order / Backfill / Rollback / Zero-data-loss

1. **Order**: M1 add `items.version/status/archived_at/archive_reason` (nullable-safe
   defaults) → M2 create `item_versions` → M3 create copy tables →
   M4 RLS/GRANTS mirror tenant pattern (ge_admin + same-tenant reads; E denied on
   copies) + audit-insert whitelist additions → M5 code deploy (handlers) →
   M6 GROUP-bucket ensure runs lazily on service save (no mass backfill writes).
2. **Backfill**: none over existing rows (all new columns default; buckets lazy +
   idempotent). Optional offline `backfillGroupBuckets` mirrors `backfillGeneralBuckets`.
3. **Rollback**: forward additive only; rollback = deploy previous code (new tables
   unread, harmless) or drop new tables (no dependents). No destructive DDL ships.
4. **Zero-data-loss conditions**: no `ALTER … DROP`, no data rewrite, no FK added to
   existing rows without `NOT VALID` + verify; every new write path inserts-before-
   updates; archive-before-delete; copy-before-source-delete (enforced by
   `service.delete_blocked` preconditions + DG-02).

---

## Handback checklist

- Spec path: `prototype-app/project-control/task-engineering-reviews/TASK-PROTO-U4-2-FIX_TECHNICAL_SPECIFICATION.md`
- Gaps: 7 (DG-01 gate-blocking question; DG-02..DG-06 technical defaults proposed; DG-07 process note)
- STOP/ASK: owner one-liner on DG-01 (confirm FIX = 5 sub-points + extra condition; else supply points 6–8 text)
- Decision: REVISION_REQUIRED (narrow: DG-01 only) → APPROVED_FOR_GATE on confirmation
