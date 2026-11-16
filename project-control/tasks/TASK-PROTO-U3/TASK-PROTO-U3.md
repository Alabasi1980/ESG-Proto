# TASK-PROTO-U3 — UI structure: workspace layer + context navigation (split A/B)

Status: CONTRACT READY — A authorised first; B after A's review.
Base: HEAD at dispatch (`git rev-parse HEAD`; expected `f46456c`).
Owner authorisation: B17 parent contract §2 (approved navigation/contexts) + explicit «اكمل» continuation.
Governing: `STYLE_CONTRACT.md` (binding), `B17_UI_BINDINGS.md` (§2 contexts/landings, §3 exact nav IDs+labels+order, §7 states), B17 spec §4 (workspace API) §9.

## Why (diagnosed, not assumed)
The UI has **no workspace layer**: zero `X-Workspace-Tab` is ever sent (grep: server-side only). Therefore every GE call to P/W-context routes fails or degrades (`workspace.invalid`), Settings shows "No services yet" despite 541 items, and ISS-004's empty employee dashboard is really the un-split navigation. This unit builds the missing layer; it is not a patch on individual screens.

## U3-A — workspace client layer (this unit)
1. **New `src/lib/workspaceClient.ts`** (module state, no React): 
   - `ensureTab()` → POST `/api/workspace/tab` once per browser tab; store `{handle,generation,mode,client}` in **sessionStorage** (workspace is browser-tab-local per spec §3 — never localStorage, never shared across tabs); 
   - `headers()` → `X-Workspace-Tab` + `X-Workspace-Version` when present; 
   - `refresh()` → GET `/api/workspace` (reconcile) and update generation/mode/client; 
   - `enter(clientId)` / `exit()` → POST endpoints, update state from the envelope; 
   - `reset()` on logout (clear sessionStorage entry).
2. **`src/lib/api.ts`**: single `apiFetch(path, init)` that (a) adds `Authorization: Bearer <token>` from the existing token store, (b) adds workspace headers for GE users when a tab exists (or ensures one for GE-authenticated requests), (c) on `409 workspace.stale|workspace.invalid` performs one `refresh()` + retry, (d) on `401` clears auth (existing behaviour preserved), (e) never for `/api/auth/*`, `/api/workspace/*`, `/api/db/status`, `/api/setup/*`.
3. **Mechanical migration**: replace `fetch('/api/...')` with `apiFetch(...)` across `src/views/*` and any component performing authenticated calls (53 call sites) — **call-site change only**: no JSX, class, logic, copy or state change; diffs must be line-local.
4. **Provider wiring**: `AuthContext` triggers `ensureTab()` for `ge_admin` after login/refresh and `reset()` on logout; a stale-tab recovery path is visible only through the retry (no new UI).
5. **Evidence**: unit tests for header building/retry/one-shot semantics (no DB); LIVE proof on the shared DB via Tera (Settings services list populates; P/W endpoints stop returning `workspace.invalid`); `git diff` shows only call-site substitutions in views.

## U3-B — context navigation (next unit, contract later)
Sidebar/landing per B17_UI_BINDINGS §2/§3 (four contexts, allowed menus, employee без dashboard, platform landing, enter/exit header control), denied views not mounted, truthful empty states. Depends on U3-A.

## Allowed write targets (U3-A)
`src/lib/workspaceClient.ts` (new) · `src/lib/api.ts` (new) · `src/context/AuthContext.tsx` (wiring) · `src/views/*.tsx` + `src/components/*.tsx` (**call-site substitution only — state each file touched**) · `src/lib/*.test.ts` · `src/i18n/translations.ts` (only if a string is needed — none expected).
**Forbidden:** server code, db, styles/tokens, JSX/class/logic/copy changes in views, print, deps, `.env`, live DB writes, control docs.

## Acceptance
- Every authenticated call carries the tab headers for GE; C/E unaffected.
- 409 stale → exactly one refresh+retry, no loops; 401 → single logout path (unchanged).
- Two browser tabs do not share the handle (sessionStorage semantics proven by test).
- Settings services list shows the real catalogue for platform; `workspace.invalid` disappears from normal flows.
- Style contract untouched (no colour/class change); lint/tests/build green; evidence + independent QA; Shield light (auth-header plumbing).

## فهم القرار
فهمي: المنصة تحتاج «تبويب مساحة» يُنشأ تلقائياً ويُرافق كل طلب، والخروج/الدخول يحدّثان الجيل، والاختيار يبقى لكل تبويب متصفح.
الافتراضات: الخادم جاهز (U1/U2-G)؛ لا تغيير مصفوفة؛ لا تصميم جديد — الربط فقط.
ما سيكشفه القبول: أن كل شاشات المنصة تتوقف عن «الفشل الصامت» بلا لمس أي شاشة.
