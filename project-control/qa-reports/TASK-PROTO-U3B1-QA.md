# QA Report — TASK-PROTO-U3-B1 (independent Execution QA)

- **Task:** TASK-PROTO-U3-B1 — context shell: nav model, sidebar/header identity, landings, guards (`project-control/tasks/TASK-PROTO-U3-B1/TASK-PROTO-U3-B1.md`)
- **Governing:** `prototype/B17_UI_BINDINGS.md` §2 (contexts/landings/identity) + **§3 exact nav matrix (authoritative)**, §4/§7/§8 secondary · `project-control/STYLE_CONTRACT.md`
- **Agent:** QA & Acceptance Agent — Execution Mode, **session NEW**, first-contact (no prior state in this session)
- **ClientAppPath:** `D:\Teranoo Work\Client01\prototype-app`
- **Repo / range:** HEAD `e90e3b74d7317f1a3776970d754202a7f8792fcc`, base `c1e8f77` → `c1e8f77..HEAD` (2 commits: `98d679d` feat, `e90e3b7` docs)
- **Env:** win32, node v22.22.2, npm 12.2.2, tsc 7.0.2 (native), tsx 4.21, vite 8.3.7 — **no DB used**
- **Executor handback:** **Context only**. Every statement below was re-derived from `git`, the diff, executed lint/tests/build and my own adversarial suite (`%TEMP%\opencode\u3b1-qa\*`).
- **Live shared DB / browser:** **OFF-LIMITS** this run → no live login, no visual/network observation (see §8).
- **Write scope respected:** only this report (`node:fs`) + `%TEMP%\opencode\u3b1-qa\*`. No source/config/control writes, no installs, no commits, no subagents.
- **Date:** 2026-11-16

---

## 0. Independent scope discovery (before judging anything)

| Command | Result |
|---|---|
| `git rev-parse HEAD` | `e90e3b74d7317f1a3776970d754202a7f8792fcc` |
| `git status --porcelain` (before **and** after my run) | **empty** (build output `dist/` is gitignored → I introduced no tree drift) |
| `git diff --name-status c1e8f77 HEAD` | **12 paths** = 8 `src/` + 3 PNG (docs commit) + 1 task `.md` |
| `git diff --numstat c1e8f77 HEAD -- src` | `App +84/-38`, `Header +47/-28`, `Sidebar +79/-129`, `AuthContext +35/-7`, `translations +22/-3`, `b17TransactionInventory.test +9/-3`, `navModel.ts +296/-0` (A), `navModel.test.ts +283/-0` (A) |

**Changed source paths (8):** `src/lib/navModel.ts` (A), `src/lib/navModel.test.ts` (A), `src/App.tsx`, `src/components/Sidebar.tsx`, `src/components/Header.tsx`, `src/context/AuthContext.tsx`, `src/i18n/translations.ts`, `src/lib/b17TransactionInventory.test.ts`.
**Non-source (4, docs commit):** `TASK-PROTO-U3-B1.md`, `prototypes/task-proto-u3b1/ctx-{platform,client,employee}.png`.
**Verified untouched by name-status:** `src/server/**`, `src/db/**`, `src/styles/**`, `src/views/**`, `package.json`, `bun.lock`, `.env*`, `*.config.*`.

**Scope verdict: PASS** — every changed source path is inside the task's allowed targets; zero forbidden path (server/db/styles/tokens/print/views/deps/.env) was modified.

---

## 1. Criterion results (all 10 dispatch criteria, independently verified)

Legend: **PASS** = independently verified · **FAIL** = criterion not met (would fail the task) · findings F#= observed deviation recorded in §7.

### C1 — navModel matrix exactly matches §3 (IDs, order, AR/EN labels, aliases, E single item + E label) → **PASS**
- **Independent oracle:** I did not read the executor's expectations to judge them. My `ADV-1` **parses B17 §3's markdown table out of the document itself** (ID cell, AR, EN, P/W(A)/C/E columns, `*`, `target`, `alias only`) and deep-compares it against `navPages(context, ['esg-profile','reports'])` for all four contexts → **exact match** (ids, order, menu/target, AR, EN).
- Rendered/present counts (my `summary.mts`): P 9 numbered rows (**8 rendered** — `clients` withheld, F1) + 1 target (`client-detail`, order `null`), W 9 + 2 conditional, C 8 + 2 conditional, E **1** (`gap-analysis`).
- §3 numbering holes are correct conditional omissions (`staff-lists` 9 after `initiatives` 6 in W/C).
- Aliases: W `client-dashboard → dashboard` (alias only, not a page), C `dashboard → client-dashboard`; E label `إفصاحات قسمي / My department disclosures` (verified **character-for-character** against the §3 cell). The task file's `إفاحات قسمي` is a **typo in the dispatch**; the implementation correctly follows §3 (F9).
- `labelOf('gap-analysis', W/C)` = `تحليل الفجوات / Gap Analysis` (E override does not leak). ✓

### C2 — landings per §2 → **PASS**
`landingFor` = P `ge-overview` (§2 "Fresh login → ge-overview"), W `dashboard` ("Enter acknowledgment → dashboard"), C `client-dashboard`, E `gap-analysis`. `resolvePage(ctx, null)` returns each landing with `redirected:false` (my `ADV-8`). The §2 "Exit/reload/duplicate/invalid → `clients`" path is B2 and is explicitly declared once in `navModel.ts` L54-59 + task §1.3 (no invented page).

### C3 — guards: forbidden/absent/target-only → landing **before mount**, zero view render/fetch → **PASS**
- App wiring (read + my `ADV-9`/`ADV-16`): `resolvePage(context, activeTab)` → `currentPage` → **one** mount site `renderView(currentPage)`; **zero** `activeTab ===` in `App.tsx` (`grep` = 0); `case 'clients': default: return null` (fail-closed); Sidebar+Header receive `activeTab={currentPage}` (the resolved page), never the request.
- The only remaining `activeTab ===` occurrences are structural: `Sidebar.tsx:221` (`isActive` highlight) and `ImportGRIView.tsx` (**its own local preview-tab state**, L39 — unrelated to the shell).
- My `ADV-7`: for every context, target-only rows are never menu rows, never mountable, and resolve to the landing. P `client-detail` (target) → `ge-overview`, `redirected:true`.
- My `ADV-2`/`ADV-6`: every absent page in every context → landing; E deep tab (all 16 page ids) → `gap-analysis`.
- **Zero fetch/render** of a forbidden view is structural: `renderView` is the only instantiation path and `currentPage` is always `isPageAllowed` (my `ADV-5` asserts output ⊆ allowed for all 4×17 requests, incl. `null`/`undefined`/garbage). No module-scope `fetch`/`apiFetch`/`setInterval` exists in `src/views/*` (verified). See F10 for the literal "must not import" reading.
- Malformed role → `null` context → empty sidebar + `renderView` never called (my `ADV-3`: 11 hostile roles incl. `'GE_ADMIN'`, `'ge_admin '`, `''`, `null`, `undefined`, objects). Malformed mode → never `consultant` unless exactly `'consultant'` + bound client (`ADV-4`, 11 hostile modes).

### C4 — identity truthfulness (no "Unrestricted", P no tenant, W/C/E correct sources) → **PASS**
- **Strings vs §2 verbatim (my `ADV-13` parses §2's identity cells):** `platformAdmin = إدارة المنصة / Platform administration`, `consultantWorkspace = مساحة الاستشاري / Consultant workspace`, `company = الشركة / Company`, `department = القسم / Department` — exact, both languages, 4 distinct labels for 4 contexts.
- `shellIdentity('platform', …)` = `{value:null, secondary:null}` → **P renders no tenant and no client badge**; the only label is the platform administration label.
- Sources: W = `workspace.client.name` (**server workspace envelope**, not `user.clientName`); C = `user.clientName` = `clients.name` from DB (`src/server/routes/session.ts:31-35` — read-only cross-check); E = `user.departmentName` (own dept row scoped by `client_id`, L37-41) + company secondary. All three are the truthful authority the contract names.
- "Unrestricted" / "Enterprise Level (Unrestricted)" string **removed from both languages**; `notAssigned` key deleted from the interface and both language trees; zero dangling references; `ADV-14` asserts `translations.{en,ar}.auth.notAssigned === undefined` and no `Enterprise Level|Unrestricted` in the file. Header carries the same identity (`ADV-11`), no fake Exit control.
- F4 (low): the header pill hides the value below `sm` — recorded, not a truthfulness failure.

### C5 — E polling disabled; unread badge only P/W/C → **PASS**
- `Sidebar.tsx:103` `canPoll = Boolean(token) && context !== null && context !== 'employee'`; effect at L105-113 returns **before** `fetchUnread()`/`setInterval` when `!canPoll`, and resets the count to 0. Exactly **one** `setInterval` in the file (my `ADV-10`).
- `/api/notifications/unread-count` has exactly **one** call site in `src/` (Sidebar L89). The inbox `NotificationsView` is unreachable for E (no `notifications` page: `isPageAllowed('employee','notifications') === false`, `ADV-6`/`ADV-12`). `App.tsx` contains no notifications fetch (`ADV-12`).
- Badge JSX is gated by `item.id === 'notifications' && canPoll`; E has no such row at all.

### C6 — aliases produce ONE menu row → **PASS**
W menu contains `dashboard` only; C menu contains `client-dashboard` only (my `ADV-5`, all contexts: `!(includes(dashboard) && includes(client-dashboard))`). `pagesIn` never contains both.

### C7 — conditionals default OMIT and cannot be forced true without capability input → **PASS**
- Default (`navPages(ctx)`, no capabilities): `esg-profile`/`reports` absent for W **and** C; `menuPages` (what Sidebar calls) cannot show them; `isPageAllowed` false; `resolvePage` → landing (`ADV-2`).
- Forcing requires an explicit capability token: `navPages(ctx, ['esg-profile','reports'])` adds them **at §3 positions 7/8 with §3 labels** (`ADV-1`), and the proof is **per page** (`isPageAllowed('client','esg-profile',['reports']) === false`).
- Capability **noise** cannot invent rows: for P and E, `pagesIn(ctx, ['esg-profile','reports','clients','dashboard','bogus',''])` === default set (`ADV-2`); absent pages can never be unlocked by a token equal to their id.
- App and Sidebar pass **no** capability set at all (`ADV-9`/`ADV-10` assert `Sidebar` has no `menuPages(context, …)`), so "cannot be forced true without capability input" holds **structurally**, not only by test. Side effect/owner: **F2**.

### C8 — i18n keys both languages → **PASS**
New `contextIdentity` block exists in the `Translations` interface and in **both** `en` and `ar` trees, key-set parity, non-empty values (`ADV-14`). Nav labels are bilingual **inside `navModel`** (`{ar,en}`) and rendered via `label[lang]` / `labelOf(...)[lang]` — both languages delivered from one source (literal "via `translations.ts`" not used: F8). No new inline UI string in the touched shell components (`ADV-15`, heuristic allowlist of pre-existing literals).

### C9 — style: zero literal colours in touched files → **PASS**
Per-file scan of all 8 touched files with `(bg|text|border|ring|divide|fill|stroke|outline|shadow|decoration|placeholder|from|to|via)-(white|black|slate|gray|zinc|neutral|stone)-n`, `#hex`, `dark:`, `bg-[#…]`, `rgb()/hsl()`, plus `style={{color/background/…}}`: **0 hits** except `bg-black/50` (the drawer overlay, explicitly exempt in `STYLE_CONTRACT` §2) — verified in `ADV-17`. No new CSS file. New classes use existing tokens (`bg-surface-3`, `border-border`, `text-brand-text`, `text-muted`, `bg-warning-soft`…) and logical props.

### C10 — guards/tests: every test/pin edit enumerated, no weakening → **PASS** (enumeration in §2)

---

## 2. Test / pin edits — complete enumeration and weakening judgement

Only **two** test files appear in `c1e8f77..HEAD` (`git diff --name-status`), and the diff of the pin file contains **no deletions**.

| # | File | Edit | Judgement |
|---|---|---|---|
| T1 | `src/lib/navModel.test.ts` (new, 283 lines ≥ 500-line bound OK) | 11 `test()` cases: §3 matrix table (4 contexts), absent→landing, allowed→self + target/pending, aliases, landings, conditionals, E single item, derivation, identity, server-set cross-check (`permittedPages`), shell-wiring static asserts (incl. `doesNotMatch /activeTab\s*===/`) | **Additive; no existing assertion touched.** Stronger than typical: it also pins against `capabilities.ts::permittedPages` (the server-approved set) so a UI page absent server-side fails. |
| T2a | `src/lib/b17TransactionInventory.test.ts` | allowed-set **+= `src/lib/navModel.ts`, `src/lib/navModel.test.ts`** (exact paths) | Exact-path additions only — no glob, no folder, no wildcard. Additive. |
| T2b | same | `assert.equal(allowed.size, 68)` → **70** with the arithmetic note extended (`+2 U3-B1`) | Consistent (68+2=70); the count is still asserted, so the guard is not loosened. |
| T2c | same | `controlInputs += 'project-control/tasks/TASK-PROTO-U3-B1/TASK-PROTO-U3-B1.md'` | Same precedent as H12/H13/U3 (Tera-owned contract excluded from the executor-scope guard). Excludes **a doc**, never a source path. See F9 note. |

**No other test, pin, capability map, route registry, access registry or `domainAccess` census was modified.** No `it.skip`, no `todo`, no assertion removed, no expectation relaxed, no `try/catch` swallowing. **Verdict: no weakening.**

---

## 3. Commands executed by me (counts, not the executor's)

| # | Command | Result |
|---|---|---|
| E1 | `node_modules\.bin\tsc.exe --version` / `--noEmit` (== `npm run lint`) | **7.0.2 / exit 0**, zero diagnostics |
| E2 | `npm test` (`tsx --test src/**/*.test.ts`) | **282 tests · 5 suites · 282 pass · 0 fail · 0 cancelled · 0 skipped · 0 todo** (5.3 s) — **matches the expected 282/282**; derived base 271 + 11 new navModel tests (base NOT executed: no checkout allowed) |
| E3 | `npm run build` (`vite build`) | **exit 0** — 1694 modules, `dist/assets/index-KVkGTJ3w.js 555.89 kB` (gzip 138.49), 2 **pre-existing** warnings (`__dirname` config loader, chunk >500 kB) |
| E4 | `git status --porcelain` after E1-E3 | **empty** (`dist/` is gitignored) — no tree drift introduced by QA |
| E5 | my adversarial suite #1 `%TEMP%\opencode\u3b1-qa\adv.test.ts` | **12/12 pass** (`ADV-1…ADV-12`) |
| E6 | my adversarial suite #2 `%TEMP%\opencode\u3b1-qa\adv2.test.ts` | **5/5 pass** (`ADV-13…ADV-17`) |
| E7 | `summary.mts` matrix dump | P 10 / W 9(+2*) / C 8(+2*) / E 1 present rows; menus 8/9/8/1; landings as §2 |

**My adversarial cases (written by me, oracle = the documents, not the executor's tests):** doc-parsed §3 matrix (ADV-1); capability-noise immunity per context (ADV-2); 11 unknown/malformed roles and 11 malformed modes (ADV-3/4); alias loop/chain/cross-context/idempotence for all 4×17 requests (ADV-5); E deep tabs ×16 (ADV-6); target-only rows (ADV-7); `null`/`undefined`/garbage requests (ADV-8); App wiring static (ADV-9); Sidebar polling/badge/legacy-role removal (ADV-10); Header identity/no Exit (ADV-11); notifications call-site isolation (ADV-12); §2 identity strings parsed from the doc (ADV-13); i18n parity + removed key (ADV-14); inline-string heuristic (ADV-15); mount-branch ⊆ §3 + `clients` in the null group (ADV-16); literal-colour scan (ADV-17). *Three of my own first-draft assertions were wrong and were corrected against the documents (audit-log IS a W page; `gap-analysis` IS the E landing; a code comment mentions `localStorage`) — no implementation defect was involved, and no assertion was weakened to make a real failure disappear.*

---

## 4. Server / flow cross-checks (read-only)

- `capabilities.ts::permittedPages` = P 10 / W 12 / C 10 / E 1; the UI model never exceeds it (executor test + my reading). W's server list contains both `dashboard` and `client-dashboard`; the UI keeps exactly one as a page (alias) — §3-conformant.
- `deriveNavContext` semantics vs §2: `ge_admin + consultant + bound client → W`; `ge_admin` otherwise → P; `client_admin → C`; `employee → E`; anything else → `null`, and `AuthContext.adoptWorkspace` clears the mirror for non-GE roles. No URL/localStorage context authority (`ADV-9` code-level scan; the only `localStorage` mention in `App.tsx` is a comment).

---

## 5. Findings

| # | Severity | Finding | Owner / action |
|---|---|---|---|
| **F1** | **LOW** | **P sidebar renders 8 of §3's 9 rows**: `clients` (order 2) is in the truthful matrix (`navPages` returns it) but `menuPages` filters it via `PENDING_PAGE_IDS` because B1 has no Clients page. §3 exact matrix therefore holds in the model, not in the rendered menu. | B2 restores the row with the page. Correct choice for B1 (a rendered row cannot be honoured), documented in code + test T1. |
| **F2** | **LOW** | **`*` capability input has no producer:** `WorkspaceEnvelope` has no `capabilities` field (`workspaceClient.ts` L41-47) and App/Sidebar pass no capability set → `esg-profile`/`reports` are **permanently** withheld even for entitled W/C users. | Direction is §3-compliant ("withhold conditional links until resolved"); wiring needs `workspaceClient.ts`/server envelope, **not** a B1 allowed target → B2/U4. |
| **F3** | **LOW** | **Forbidden CTAs still rendered inside existing views** (`DashboardView` → `setActiveTab('import-gri')`, `('settings')`; `GapAnalysisView`/`StandardsView` → `'import-gri'`; `ImportGRIView` → `'dashboard'`). Clicks now bounce to the context landing (guard holds; nothing mounts/fetches), but §3-§6 says forbidden **controls** must not be rendered at all. | View-scope task (B1 forbids view content changes). Zero authority leak today. |
| **F4** | **LOW** | Header identity pill hides the tenant name below `sm` (`hidden sm:inline`) and truncates (`max-w-[12rem]/[14rem]`); §4 asks for the full client title to stay visible at narrow widths outside the drawer. Sidebar block shows it when the drawer is open (closed by default on mobile). | B2 header finalisation. Static finding — no visual run this session. |
| **F5** | INFO | **Context derivation is not gated on workspace resolution**: for a GE actor `workspace` is `null` until `adoptWorkspace()` resolves, so a P shell (`ge-overview`) can render for one frame(s) before a consultant tab is adopted. §7 wants a neutral shell while auth/workspace loads. | §7 transitions = B2. No cross-tenant data (the actor is GE). |
| **F6** | INFO | **Reload keeps the `sessionStorage` mirror** (`greenedge_workspace`), so a reload inside W re-derives W, while §7 says reload/new/duplicate → P → Clients. `ensureTab()` returns the persisted tab (L180-182). | U3-A owns the mirror; §7 transitions = B2. Flagged so B2 does not miss it. |
| **F7** | INFO | `navPages`/`menuPages` **throw** on an out-of-union context string (no runtime guard; type-level only). App only calls them with a non-null derived context, so it fails closed today. | Optional defensive hardening; no action needed for acceptance. |
| **F8** | INFO | `translations.ts` edit is a **deletion** (`notAssigned` key + 2 values) in a target described as "new keys only" — unavoidable: §1.4 requires removing "Enterprise Level (Unrestricted)". AR/EN parity and the interface were updated together; zero dangling references. | Accepted. |
| **F9** | INFO | **Dispatch typo**: task file writes E label `إفاحات قسمي`; §3 (authoritative) writes `إفصاحات قسمي`. The implementation matches **§3** — do not "fix" it to the typo. Also the 3 live screenshots in the docs commit are the executor's claim (**NOT VERIFIED**, live DB off-limits). | Tera/records only. |
| **F10** | INFO | **All views remain statically imported** in `App.tsx` (as in the base), so §1.6's literal "must not **import** forbidden views at all" is not met; instantiation/render/fetch is fully guarded and no view has module-scope `fetch`/`setInterval`/`await`. | Literal-reading gap only; no behavioural effect. If Tera wants `lazy()`/dynamic import, that is a separate decision (would also change the bundle). |

**Criterion-level failures: none.** No HIGH / MEDIUM findings.

---

## 6. What was executed vs. what is static vs. what is NOT VERIFIED

- **Executed (evidence):** lint (tsc 7.0.2), full test suite (282/282), production build, my 17 adversarial tests, git diff/status/numstat, matrix dump.
- **Static (source inspection, no runtime):** App guard wiring, absence of `activeTab ===` render, single mount site, Sidebar polling gate + badge condition, Header identity/no Exit, translations tree, style scan, pin-test enumeration, server-side identity sources.
- **NOT VERIFIED (recorded as such, never promoted to PASS):** (a) live login/landing per context (P `ge-overview`, C `client-dashboard`, E one menu item, role switching, forbidden deep-tab redirect in a real browser) — **live DB off-limits**; (b) zero **network requests** for forbidden views observed on the wire (inferred from code structure only, no browser); (c) the 3 executor screenshots as proof; (d) responsive/RTL visual acceptance (§4/§8) and axe/Playwright checks; (e) that an entitled W/C user sees `esg-profile`/`reports` (no capability producer exists — F2).

---

## 7. Verdict

**PASS** — all ten dispatch criteria independently verified, 282/282 tests green, lint and build clean, zero literal colours, zero test/pin weakening, no forbidden path touched.
Four LOW findings (F1-F4) are either B1-scope-limited by design (F1, F3, F2) or B2 header polish (F4); six INFO notes (F5-F10) are recorded for the B2/view tasks. Acceptance decision remains with Tera.

**QA Agent signature:** QA & Acceptance Agent (Execution Mode) — 2026-11-16
