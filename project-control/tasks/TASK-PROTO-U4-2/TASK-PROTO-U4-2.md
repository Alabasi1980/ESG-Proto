# TASK-PROTO-U4-2 — Services workspace (P): flexible, sectioned, uncluttered

Status: AUTHORISED — owner «ابدأ» 2026-11-16 + design latitude («فكر كمصمم ومبدع»).
Base: `020f6ea` (clean tree after PROTECT). Governing: `STYLE_CONTRACT.md` (binding), `B17_UI_BINDINGS.md` §10 revision, OD-07/11/12, OD-11 §5 (no clutter, List→Detail, one primary action).

## 1. Product intent (owner)
Working with services must feel flexible and smooth: professional organisation, clear sections, easy to operate. Same standard will govern the contextual screens (U4-3) and the cross-service item-linking screen (U4-4) — build reusable patterns now, do not invent a different language per screen.

## 2. Screen architecture (binding)
Master–detail, no page-scroll walls:
- **Left rail (240–288px):** compact service cards — name (AR/EN), code, tiny counters (standards · items), status chip, search field above, «+ خدمة جديدة» primary action. Active card highlighted.
- **Right workspace:** sticky header (service name + code + 2 secondary actions max), then **tabs**: `overview` · `content` · `rules` · `settings` · `import`. One visible primary action per tab.
- **Content tab:** breadcrumb + three-level drill (معيار → إفصاح → بند) with counts; row click opens a **detail side panel** (edit in place, no navigation away); inline add at each level; search/filter within level; bulk-select for assigned actions; empty states per level with the single relevant CTA.
- **Overview:** definition (code/name/description), counts, linked clients count, last import, and a short «حالة المحتوى» strip — read-only summary, no editing here.
- **Rules / Settings:** grouped fields in cards, one save button each (settings JSONB + service rules), inline validation messages.
- **Import:** drag-drop zone + format hint + explicit target confirmation; per-service wording (GRI importer is one option, not the screen's identity).
- **States:** skeleton while loading, honest empty states, failure box with retry, success inline (no toast library). All text AR/EN via i18n; logical RTL properties only.

## 3. Reuse & technical
- New `src/views/ServicesView.tsx` (+ at most two small presentational components under `src/components/services/`); mount for **P only** on the existing `standards` nav id, relabeled «الخدمات / Services» in P context; W/C keep current behaviour untouched this unit.
- Data: reuse existing endpoints (`/api/services`, `/api/standards`, `/api/disclosures`, `/api/items`, `/api/clients`, service create/duplicate/link, `PATCH /api/services/:id` for settings) via `apiFetch`; no new API, no server change. Where an endpoint lacks a needed field, show what exists honestly — never invent data.
- Tokens/components from STYLE_CONTRACT only; no literal colours, no page CSS, no new dependency.
- Targets: `src/views/ServicesView.tsx` (new) · `src/components/services/*` (max 2 new) · `src/lib/navModel.ts` (P label only) · `src/App.tsx` (mount for P) · `src/i18n/translations.ts` · `src/lib/*.test.ts` (new behavioural tests + enumerated pin updates). Forbidden: server/db, other views, styles/tokens, deps, env, control docs, live DB.

## 4. Evidence
Unit tests for level drill/counters/search/empty states/tab gating; lint/tests/build green; colour grep zero; Tera screenshots P (AR) + one EN pass; design-reviewer independent review; QA functional pass. Rounds 2.
## 5. فهم القرار
فهمي: شاشة خدمات واحدة تخدم كل الخدمات، بلا ازدحام، تُدار فيها التعريفات والمحتوى والقواعد والإعدادات والاستيراد.
الافتراضات: المنصة فقط تستخدمها الآن؛ النمط نفسه سيُعاد استخدامه في الشاشات السياقية والربط.
ما سيكشفه القبول: أن إدارة خدمة كاملة ممكنة بلا تنقل مبعثر ولا شاشات مكرّرة.

## 6. Round 2 — fixes applied; live re-verification partial
- Independent design review verdict was REVISE (5 P1 + P2). Round 2 fixed: sticky workspace header (removed clipping overflow), responsive item editor (drawer below xl), Rules field widths/max-heights, panel text wrap, Overview definition alignment (bdi isolation), unsaved-draft guard, friendly error copy, rail total counter, aria-controls/tab keyboard, unlink confirmation, edit icon, pluralisation, moderated counters.
- Owner instructions applied: «Import GRI Data» removed from the platform sidebar (import lives in Services → Import); Services section removed from Settings & Database. Staff Lists relocation to client account + GE-consultant password provisioning is RECORDED for U4-3, not implemented here.
- Verification: lint clean, 385/385 tests, build ok, zero literal colours, enumerated pin edits. Tera live check: menu cleaned (verified), bdi present; sticky/drawer behaviour at 1152px and full AR/EN walkthrough NOT re-verified by Tera in this round — design re-review remains the gate.
## 7. Owner review 2026-11-17 — REOPENED (not closed)

- Status correction: U4-2 was **never Accepted/Closed** (no registry closure; re-review ended REVISE-narrow + final polish landed without a fresh visual sign-off). It returns to **Needs Fix** as `TASK-PROTO-U4-2-FIX`.
- Owner answers (binding, recorded as OD-13 in `prototype/OWNER_DECISIONS.md`):
  1. Flexible service structure — yes (standards/disclosures not mandatory; groups or direct items allowed; item details are not a level).
  2. One department per item — no multi-department assignment in the service definition.
  3. Editing an approved item before final approval — reopen for the client + keep old item/answers as viewable history (per Tera recommendation).
  4. Deleting an item with work on a non-approved client — remove from current scope, preserve answers/attachments/approvals in history.
  5. Extra binding condition — an approved client service must survive **unchanged even if the source service is fully removed** (complete viewable copy: definition + content + scope + results + attachment references).
## 8. Design handback 2026-11-17 (tera-software-designer, NEW session)

- Spec: `project-control/task-engineering-reviews/TASK-PROTO-U4-2-FIX_TECHNICAL_SPECIFICATION.md` (518 lines, design only, no code/DB). Classification SDA_REQUIRED. Decision: REVISION_REQUIRED narrow (DG-01) → APPROVED_FOR_GATE on confirmation.
- DG-01 resolved by Tera (no owner round-trip): «النقاط 1–8» هي بنود المراجعة الثمانية نفسها؛ الأربعة المجاب عنها + الشرط الإضافي مسجلة في OD-13، والبنود 2/3/5/7 تعليمات مباشرة في §7 أعلاه. FIX = §7 كما هو مكتوب.
- Remaining defaults for owner one-line confirmation (DG-02…DG-06): full-service delete refused while tenant work/copies exist (else archive); GRI adapter first + mapping framework; reopen notifies assigned dept inbox + `reopened` status; approved copy duplicates attachment bytes (absolute immunity, demo-scale monitored); bulk edit = answerType/priority/esgClass/attachment_required with per-row version checks.
- Suggested post-execution reviewers: SecurityAgent + QA + Auditor. Next: Pre-Execution Gate → phased execution (catalog CRUD → import → history/freeze/copy → screen), no U4-3 interleaving, no live DB mutation without backup + explicit approval.
