# TASK-PROTO-U3-B1 — context shell: nav model, sidebar/header identity, landings, guards

Status: AUTHORISED — owner «اعتمد وابدأ» 2026-11-16. Base: HEAD at dispatch (expect `c1e8f77`).
Governing: `B17_UI_BINDINGS.md` §2 (contexts/landings/identity), §3 (**exact nav matrix — authoritative**), §7 (states), §8 (RTL/a11y), `STYLE_CONTRACT.md` (binding), B17 spec §3.
Split: **B1 = shell only** (no Clients page, no Enter/Exit flow — B2 owns §5 + §7 transitions).

## 1. Behaviour
1. **Single nav model** (`src/lib/navModel.ts`): contexts `platform | consultant | client | employee`; per §3 exact page IDs, AR/EN labels, order, and per-context presence. Aliases: W `client-dashboard`→`dashboard`; C `dashboard`→`client-dashboard`; E uses `gap-analysis` with label **إفاحات قسمي / My department disclosures**. Conditionals (§3 `*`): `esg-profile`/`reports` only when the workspace/tenant capability set reports them (server truth from the workspace envelope `capabilities`; C/E derive from their session) — never guessed true.
2. **Context derivation**: `ge_admin` + workspace mode `platform` → P; mode `consultant` + client → W(A); `client_admin` → C; `employee` → E. Mode read from `workspaceClient.currentTab()`; refresh on login and when the tab mirror changes. No URL/localStorage context.
3. **Landings** (§2): fresh P login → `ge-overview`; W after acknowledged enter → `dashboard`; C → `client-dashboard`; E → `gap-analysis`. Invalid/absent tab for GE → P at `clients` placeholder landing = `ge-overview` until B2 (state this once, no invented page).
4. **Sidebar** renders ONLY from the nav model: exact order/labels above, existing Lucide icons (reuse nearest existing), active highlight, unread badge only for P/W/C (E: no polling — stop the interval for E). Identity block truthful: P → **إدارة المنصة / Platform administration** (no tenant, no "Unrestricted"); W → **مساحة الاستشاري / Consultant workspace** + full client name; C → **الشركة / Company** + name; E → **القسم / Department** + department/company. Remove the hardcoded "Enterprise Level (Unrestricted)" text.
5. **Header**: context pill reflecting the same identity (sticky, exists today) — Exit control is **B2**; do not add it now, do not fake it.
6. **Guards (deny-by-default, before mount/fetch)**: App resolves the requested tab through the nav model; a tab absent from the current context is **not mounted, not fetched, not polled** — redirect to the context landing (no flash of the old view). Unknown/malformed role or missing binding → no pages (existing auth gates preserved). Rendering must not import/instantiate forbidden views at all.
7. **RTL/a11y**: labels via i18n both languages; logical props only; current page announced (existing patterns); no new palette/colors (style contract).

## 2. Allowed targets
`src/lib/navModel.ts` (new) + `src/lib/navModel.test.ts` (new) · `src/components/Sidebar.tsx` · `src/components/Header.tsx` (identity pill only) · `src/App.tsx` (context derivation, landing, guard, mount switch) · `src/context/AuthContext.tsx` (expose workspace mode into context state if needed — minimal) · `src/i18n/translations.ts` (new keys only) · `src/lib/b17TransactionInventory.test.ts` (exact-path additions for this task's artefacts only, enumerated).
**Forbidden:** server/db/styles/tokens/print, Clients page, Enter/Exit controls, deps, `.env`, control docs (Tera writes), any view content change beyond unmount rules.

## 3. Acceptance evidence
- Table-driven unit tests: nav model matrix (4 contexts × all page IDs: present/absent/label/order/alias), guard resolution (forbidden tab → landing, zero render), landing per context.
- `git status` = ratified set; lint/tests/build green (report counts); zero literal colours; `?theme=`/localStorage context absent.
- Tera runs the LIVE proof: P login lands `ge-overview`; C lands `client-dashboard`; E sees exactly ONE menu item (no dashboard/reports/etc., no notification polling); switching roles shows the right menus; forbidden deep tab redirects.
- Reviews: QA (execution) + Shield light (auth/context plumbing). Rounds: 2.

## 4. فهم القرار
فهمي: كل دور يرى قائمته المعتمدة فقط، والهبوط يتبع السياق، والمسار الممنوع لا يُركّب أصلاً.
الافتراضات: قدرات الخادم هي مصدر الشرطية؛ لا صفحة عملاء بعد (B2)؛ الهوية في الشريط تصبح صادقة.
ما سيكشفه القبول: أن الاختلاف الحقيقي بين المنصة/المستشار/العميل/الموظف أصبح مرئياً ومحكوماً من نموذج واحد.

## 5. COMPLETE — accepted (2026-11-16)
- Round 1 delivered: navModel (single source, §3 matrix), context derivation, landings, truthful identity, deny-by-default guards, E single-item menu with polling off. 282/282, lint 0, build 0.
- **Live proof (Tera):** P menu = GE Operations/Standards/Initiatives Library/Import/Settings/Staff Lists/Audit/Notifications, landing GE Operations, identity Platform administration, no 'Unrestricted' · C menu = Client Dashboard/Client Detail/Standards/Gap Analysis/Actions/Assigned Initiatives/Staff Lists/Notifications, landing Client Dashboard · **E = exactly one item (My department disclosures), no dashboard, no polling**. Screenshots prototypes/task-proto-u3b1/ctx-{platform,client,employee}.png.
- **Reviews:** QA **PASS** (10/10 criteria, adversarial oracle parsed from the bindings doc itself) · Shield **0H/0M/3Low**.
- **Rulings:** (1) SHIELD-B1-01 (W mirror trust before first render) → **binding precondition for B2**: reconcile GET /api/workspace before mounting W chrome; no privilege impact today (server validates every call). (2) SHIELD-B1-02 (GE without tab → P menus) → **keep**: §7 requires 'verified P → Clients'; the 'no pages' clause targets unknown role/binding, which stays enforced. (3) SHIELD-B1-03 (E/C db-status polling + RLS pill claim) → **defect for B2** (§4 forbids W/C/E diagnostics/RLS claims). (4) QA F1 (clients row) / F2 (conditionals producer) / F3 (stray CTAs in views) / F4 (narrow-width pill) → **B2 scope**; INFO typo in this contract corrected (إفصاحات). (5) Static-import interpretation accepted; lazy loading deferred.
- **ISS-004 resolved by B1** (employee no longer has a dashboard; only own-department disclosures). Round cap 2/2, no push.
