# TASK-PROTO-U3-B2 — Clients page (§5) + client-workspace lifecycle (§7) + B1 preconditions

Status: AUTHORISED — owner «اكمل» 2026-11-16. Base: expect `a218ba8`.
Governing: `B17_UI_BINDINGS.md` **§5 (Clients table), §7 (transitions/states), §2 (identity)**, `STYLE_CONTRACT.md`, B17 spec §4.
Inherited binding preconditions from B1 §5 rulings: SHIELD-B1-01 (reconcile W before first protected render), SHIELD-B1-03 (no C/E diagnostics/polling or RLS claim), QA F1 (clients row), QA F4 (narrow-width context pill).

## 1. Clients page (P, page id `clients`, order 2) — new `src/views/ClientsView.tsx`
Exactly §5: header + search (**البحث عن عميل / Search clients**, hint name-or-code, **بحث/مسح البحث/تحديث**; Enter/Search → `GET /api/clients?search=`; Clear reissues; real server results, stale-response rejection); table columns in order: **العميل** (name + LTR-isolated code), **الحالة** (نشط/موقوف emerald/rose badge; unknown ≠ Active), **الخدمات المرتبطة والتقدم** (per real `services[]`: mapped items, collection `submitted/assigned`, % only when assigned>0, pending, frozen fraction; zero-assignments → **لا توجد إسنادات** + `—`; `unmapped` → **الخدمة غير مربوطة بمعايير**; empty → **لا توجد خدمات مرتبطة**; missing counts → **غير متاح**), **الإجراءات** (visible wrapping buttons: **دخول مساحة العميل**، **إعداد العميل**، **إيقاف/إعادة تفعيل**; never hover-only). Empty/search-empty states + caption/headers + announced row count. Suspend/Unsuspend: confirmation naming client+action → `PATCH /api/clients/:id` → pending row feedback → authoritative refetch (no optimistic success; uncertain → refresh). Enter → §2 below. Configure → `client-detail` with explicit T + Back-to-Clients affordance.
`ge-overview` becomes totals-only (clients/active/suspended/services/pending staff lists) — remove assessment cards/suspend/bulk-link shortcuts there.

## 2. Workspace lifecycle (§7)
- **Enter**: confirm (discard pending edits warning when applicable) → state **جارٍ فتح مساحة العميل** → `POST /workspace/enter` → on success adopt envelope (mode consultant, client, generation), clear unread/filters/caches/old contents, land `dashboard`, focus heading. Duplicate clicks suppressed while pending. Failure → safe panel **تعذّر تأكيد مساحة العمل** + Retry (reconcile `GET /workspace` first; no guessed fallback, no blind replay).
- **Exit control** in the sticky Header for W at every width: **الخروج إلى العملاء**; on confirm → **جارٍ الخروج إلى العملاء** → `POST /workspace/exit` → P landing `clients` + refetch list; identical failure panel. No client selector anywhere; W(A) badge shows authoritative client name.
- **Reload/new/duplicated tab** = memory-only workspace per §7: on boot, if the mirror says consultant, reconcile then `POST /workspace/exit` and render P→`clients` (no W resume). Logout clears everything (existing path).
- **Reconcile-before-render (B1-01)**: W chrome renders only after `GET /api/workspace` confirms mode/tenant/generation for the stored handle; mismatch/invalid → exit-to-P path; failure → the panel above (never guessed W or P content).

## 3. Carryovers (explicit)
- **B1-03**: `db/status` polling + connection pill ONLY in P; C/E get no diagnostics and no "RLS proven" claim (§4).
- **F4**: context pill keeps full client title at narrow widths (wrap, not hidden).
- **F3 (narrow)**: remove forbidden-page CTAs that are visible today to C/E — enumerated: `DashboardView` "Import GRI Standards & Disclosures"; any other `import-gri`/`settings`/`initiatives-library` CTA reachable by non-permitted contexts (grep + list every removal in handback). Broader per-view CTA audit remains U4.
- **F2 (defer)**: `esg-profile`/`reports` conditionals stay omitted until a per-tenant entitlement exists (recorded; U4).

## 4. Targets
`src/views/ClientsView.tsx` (new) · `src/views/GeOverviewView.tsx` (totals-only) · `src/lib/navModel.ts` (clients row active; P landing stays ge-overview, exit→clients) · `src/App.tsx` (mount clients; transition states; boot exit-on-reload; polling gate) · `src/components/Header.tsx` (Exit + pill rules) · `src/context/AuthContext.tsx` (transition helpers) · `src/lib/workspaceClient.ts` (enter/exit already exist — add only what §2 needs, e.g. clear-on-transition) · `src/i18n/translations.ts` · enumerated CTA edits (DashboardView + list) · `src/lib/*.test.ts` (new tests + enumerated pin additions). Forbidden: server/db/styles/tokens/print/deps/.env/control docs; no other views.
## 5. Evidence
Unit tests (search/clear, progress math incl. zero/missing/mixed-freeze, badge truth, enter/exit state machine, boot-exit, reconcile-before-render, duplicate suppression, forbidden CTA absence, C/E no polling). lint/tests/build. Tera LIVE proof: P Clients table vs DB truth, Enter→W dashboard, Exit→P clients, reload→P, C/E unchanged, no flash. QA + Shield. Rounds 2.
## 6. فهم القرار
فهمي: المنصة تدير العملاء وتدخل مساحة أحدهم صراحةً وتخرج بزر دائم؛ الصفحة تعرض حقائق الخادم لا تقديرات.
الافتراضات: خادم §4 جاهز؛ لا تصميم جديد؛ إعادة التحميل تُلغي وضع المستشار.
ما سيكشفه القبول: أن الدخول/الخروج حدّان صادقان، وأن الجدول مطابق للمعتمد §5 بلا بيانات مزخرفة.

## 7. COMPLETE — accepted for local integration (2026-11-16)
- Rounds 1–3: Clients page (§5 verbatim: search/clear/refresh + stale epoch, columns, every progress fallback, badge truth, wrapping actions, confirmations, no optimistic success); enter/exit lifecycle with deterministic landings (§7), wrong-tenant guard, lost-workspace recovery; explicit-target ClientDetail with selector+tenant-list lookups removed for all contexts; **W read-only by MODE** (zero editor subtrees/fetches; suspend panel removed); B1 carries (reconcile-before-render, P-only polling/pill); forbidden CTAs removed (Dashboard/GapAnalysis/Standards); ge-overview totals-only.
- **QA: FAIL → PASS** (round-1 landing defect reproduced and fixed; recheck 28/28 model, 316/316) · **Shield: 0H/1M → all closed** (W read-only by mode, client.id binding, lost-workspace handler once-only, logout reset; 0 new findings).
- **Live proof (Tera):** Exit → Clients; reload-while-W → P Clients (no W resume); W ClientDetail = 0 buttons/0 forms/0 selects, read-only data present; screenshots clients-page.png, consultant-workspace.png, consultant-detail-readonly.png.
- **Accepted residuals:** notice shows if the follow-up refetch errors (N1); M3 Retry adopts server-confirmed mode without re-asserting the requested tenant (LOW, fail-closed); pins are behavioural + regex (improve at U4). **Still open → U4:** W-visible tenant selectors + /api/clients enumeration in ClientReviewView/GeFinalView (§3), Profile/Reports conditionals (no per-tenant entitlement yet), broader per-view CTA audit.
- Round cap: 3 used (third justified by recorded acceptance blocker). No push.
