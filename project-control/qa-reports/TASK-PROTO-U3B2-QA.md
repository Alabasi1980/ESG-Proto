# QA Report — TASK-PROTO-U3-B2 (independent Execution QA, Session NEW)

- **Task:** TASK-PROTO-U3-B2 — Clients page (§5) + client-workspace lifecycle (§7) + B1 preconditions
- **Base:** `a218ba8`. Reviewed tip: `9772a0f` (docs) on top of `f293822` (feat).
- **Agent:** QA Agent — Execution Mode. Session: NEW (no executor handback trusted).
- **Environment:** Windows `win32`, PowerShell 5.1, Node v22.22.2, local `tsx` 4.21.0, `vite` build.
- **Governing oracle:** `B17_UI_BINDINGS.md` §2/§3/§5/§6/§7 + `STYLE_CONTRACT.md` + task §1–§5 (oracle derived by QA, not from executor tests).
- **Live DB:** off-limits (not touched). No source/config/control writes; report-only.

## Verdict: **FAIL** (1 acceptance criterion failed; all other criteria PASS)

- **Failed criterion:** §7 / task §2 landing for **Exit → Clients** and **reload/new-tab → P → Clients**. Both land `ge-overview`, not `clients`. Root cause and severity in **F1**.
- **Not failed by security/identity:** no W resume, no identity leak, no forbidden data, no RLS claim. The Clients page itself is reachable via the P sidebar row.
- Per the task rule "Failed criterion = FAIL not PARTIAL", this is FAIL (not PARTIAL). Everything else is clean.

## 1. Independent scope discovery

`git diff --name-status a218ba8` (working tree == HEAD, clean except Shield's untracked `security-reports/…fix-review.md`, not mine):

```
A project-control/prototypes/task-proto-u3b2/{clients-page,consultant-workspace}.png
A project-control/tasks/TASK-PROTO-U3-B2/TASK-PROTO-U3-B2.md
M src/App.tsx  M src/components/Header.tsx  M src/context/AuthContext.tsx
M src/i18n/translations.ts  M src/lib/{navModel,b17TransactionInventory.test,navModel.test,workspaceClient.test,workspaceClient}.ts
A src/lib/clients.test.ts
M src/views/{ClientDetailView,DashboardView,GapAnalysisView,GeOverviewView,StandardsView}.tsx
A src/views/ClientsView.tsx
```

- **Forbidden scope check:** `git diff --name-only a218ba8 HEAD -- src/server` and `… -- src/db` and `… -- src/styles/tokens` = **empty**. Zero server/db/style edits. ✔
- All edited files match task §4 target list; no unlisted view edited (only the enumerated CTA views). ✔

## 2. Commands executed (independent evidence)

| # | Command | Result |
|---|---|---|
| 1 | `npm run lint` (`tsc --noEmit`) | **EXIT 0** — 0 errors |
| 2 | `npm test` (`tsx --test src/**/*.test.ts`) | **EXIT 0** — `# tests 309 / pass 309 / fail 0 / skipped 0 / cancelled 0 / todo 0`, 5 suites (~6.7s) |
| 3 | `npm run build` (`vite build`) | **EXIT 0** — 1695 modules; `index.js 576.17 kB`; only the pre-existing >500 kB chunk-size warning |
| 4 | QA independent oracle (`%TEMP%\opencode\u3b2-qa-oracle.mts`, my own derivation) | **19/19 PASS** (see §8) |
| 5 | QA landing simulation (`%TEMP%\opencode\u3b2-qa-landing.mts`, real `resolvePage` + App effect-order model) | fresh-login→`ge-overview` PASS; reload-while-W→`ge-overview` **FAIL(want clients)**; explicit Exit→`ge-overview` **FAIL(want clients)** |

Test count **309/309** matches the expected figure.

## 3. §5 Clients fidelity (ClientsView.tsx) — PASS

Oracle: `B17 §5` columns/fallbacks + task §1. Evidence = source read + independent helper oracle (oracle items §8.1–8.6).

| Requirement | Evidence | Verdict |
|---|---|---|
| Header/order P page `clients` (order 2), mountable | `navModel.ts:110`; `resolvePage('platform','clients')={'clients',false}` (oracle) | PASS |
| Search box **البحث عن عميل/Search clients**, hint **الاسم أو الرمز/Name or code**, **بحث/مسح البحث/تحديث** | `ClientsView.tsx:273-307`; `translations` EN/AR match | PASS |
| Enter/Search → `GET /api/clients?search=`; Clear reissues empty; Refresh reissues applied | `load()` :119-144; `clearSearch` :151-154; `refresh` :156-158 | PASS |
| Real server results; no cosmetic filter/sort/pagination | `setRows(data)` only :132; no `.filter(`/`.sort(` | PASS |
| Stale-response epoch rejection | `queryRef` + `isCurrentQuery` guards at :129/:134/:138 (oracle 8.6) | PASS |
| Columns order **العميل/الحالة/الخدمات المرتبطة والتقدم/الإجراءات** + `<caption>` + `aria-live` row count | `:382-388`, `:381` caption, `:325-331` count | PASS |
| العميل = name + **LTR-isolated code**; no row/name-click entry | `:398-399` (`dir="ltr"`), no onClick on row | PASS |
| Status badge truth: false→نشط emerald, true→موقوف rose, **unknown ≠ Active** | `readStatus` :48-52 (oracle 8.1); unknown renders `—` + `aria-label` :258 | PASS |
| Progress: mapped items, collection `submitted/assigned`, **% only if assigned>0**, pending = **server** `pendingPairCount`, frozen `frozen/assigned` | `readProgress` :65-75 (oracle 8.3/8.4/8.5); renderCollection :204-224; renderFrozen :226-238 | PASS |
| `assigned=0` → **لا توجد إسنادات** + `—` (never 0%/100%) | `:208-213`, `:230-232` (oracle 8.3) | PASS |
| missing/invalid counts → **غير متاح/Unavailable**, not zeros | `readCount` :42-44 (oracle 8.2); `renderCount` :201-202 | PASS |
| `unmapped` → **الخدمة غير مربوطة بمعايير**; mapped-but-unassigned distinguishable | `:416-425`, `isUnmapped` :77-79 (oracle 8.5) | PASS |
| empty services → **لا توجد خدمات مرتبطة** | `:403-404` | PASS |
| Actions visible + wrapping (never hover-only): **دخول مساحة العميل/إعداد العميل/إيقاف-إعادة تفعيل** | `:438-471` `flex-wrap` + `whitespace-normal`; no `group-hover`/`opacity-0` | PASS |
| Suspend/Unsuspend: confirm names **client+action** → `PATCH /api/clients/:id` → pending row → authoritative refetch | `toggleSuspend` :163-190; `suspendConfirm '{action} {name}'` | PASS |
| No optimistic success; uncertain → error + retry; refetch authoritative | status never mutated locally; `finally { await load(...) }` :188 | PASS (LOW nit N1) |
| Enter disabled while transition pending; suspended rows still enterable | `disabled={transitionBusy||busy}` :443; only busy/transition gate | PASS |
| Empty states + Refresh / search-empty + Clear | `:347-375`; `emptyTitle/emptySearchTitle` | PASS (LOW nit N2) |

`ge-overview` is totals-only: per-client assessment cards, suspend and bulk-link removed (`GeOverviewView.tsx` full rewrite; `/api/ge/overview` returns `totals{clients,active,suspended,services,pendingStaffLists}` — `adminPlatformOps.ts:31-39`). ✔

## 4. §7 lifecycle state machine — FAIL (landings only)

Oracle: `B17 §7` transitions table + task §2. Module-level behaviour verified by QA's own stub oracle (§8.10–8.19); landing verified by App effect model (§2 cmd 5).

| Event | Expected | Observed | Verdict |
|---|---|---|---|
| Enter: confirm → **جارٍ فتح مساحة العميل** → `POST /workspace/enter` → `GET /workspace` confirm → W dashboard/title/badge; focus heading | §7 | `enterVerified` POST then reconcile('consultant') (oracle 8.14); `handleEnter` sets `dashboard`; phase `opening` covers shell; focus effect | PASS |
| Enter wrong-mode confirm → failure, no guessed W | §7 | oracle 8.15 `{ok:false,'failed'}` | PASS |
| Exit control W-only, every width; confirm → **جارٍ الخروج إلى العملاء** → `POST /workspace/exit` → **P landing `clients`** | §7/§2 | control visible W-only (`Header.tsx:context==='consultant'`), phase `closing`, exit POST → P; **landing = `ge-overview`** | **FAIL (F1)** |
| Duplicate suppression (Enter/Exit) | §7 | reducer no-op while pending + module single-flight `claim` (oracle 8.17/8.18); button disabled | PASS |
| Failure/lost response → safe panel **تعذّر تأكيد مساحة العمل** + Retry **reconciles first**, no blind replay | §7 | `retryWorkspace`→`recoverWorkspace` GET-first (oracle 8.19); App `failed` panel | PASS |
| Reload/new/duplicated tab while **W → P, no W resume** | §7 | boot: reconcile→exit→P; **mirror not resumed** (oracle 8.10); **landing = `ge-overview`** not `clients` | **FAIL (F1)** |
| Reload transport failure → safe panel, not guessed P | §7 | oracle 8.11 `failed`, single attempt, mirror stays consultant | PASS |
| Invalid/stale handle → verified P | §7 | oracle 8.12 409→clear+`POST /tab` P | PASS |
| Exit/boot P landing = `clients` | §2 table | `workspaceExitLanding()` returns `'clients'` (oracle 8.9) but never reaches state, see F1 | **FAIL (F1)** |

## 5. B1 carryovers — PASS

- **Reconcile-before-render (B1-01):** `workspaceBlocked = ge_admin && phase!=='idle'` (App:128) makes App render only the named transition/recovery state; W chrome never renders before `GET /workspace` confirms (oracle 8.10 shows mode+generation confirmed on boot).
- **db/status polling + pill P-only:** effect gated `context!=='platform' || workspaceBlocked → setDbConnected(null); return;` (App:146-154); Header pill behind `context === 'platform'` (Header); the `PostgreSQL RLS` string is gone (grep). No C/E diagnostics, no RLS claim. ✔
- **Narrow-width identity title (F4):** Header context pill `flex-wrap … max-w-full`, name `whitespace-normal break-words`, old `hidden sm:inline truncate` removed (grep + `hidden sm:inline` absent). Title `h2` uses `break-words` not `truncate`. ✔

## 6. ClientDetail explicit-target-only / selector removal — PASS

- `resolveTargetClientId` (:39-54): C→own session company; W(consultant)→workspace client; P→**explicit id only**; E/unknown→`null` (oracle 8.7).
- P without an explicit target → `null` and App routes `client-detail`→`clients` (`platformDetour`, App:164-167, `:276` `context==='platform' ? null : <ClientDetailView/>`). No first-client default.
- **Selector + tenant list fully removed for ALL contexts:** no `<select>`, no `tenants`/`fetchTenants`/`setSelected`, and **no `GET /api/clients` list request** (only `/api/clients/:id`, `/…/:id/services`, catalogs `/api/services`,`/api/items`) (oracle 8.8).
- W/C derive their own client; handlers preserved (build+309 tests green; named handlers intact).

## 7. Forbidden CTA removals — PASS

Enumerated removals (all in touched files):
- `DashboardView.tsx`: removed **Import GRI** empty-state button, **Configure DB/Settings** empty-state button, and header **Import** button (only `setActiveTab` for nav remain).
- `GapAnalysisView.tsx`: removed **Import-GRI** empty-state button.
- `StandardsView.tsx`: removed **Import-GRI** empty-state button.
- `GeOverviewView.tsx`: removed per-client **Suspend** control and **bulk-link (link-all)** shortcut (totals-only now).

Remaining visible forbidden CTAs caused by these files: **none**. Grep of `src/**/*.tsx` for `import-gri`/`'settings'`/`initiatives-library` yields only nav-model/icon maps and P-guarded `switch` branches (`App.tsx`, `Sidebar.tsx`, `Header.tsx`) — not rendered as CTAs in W/C/E. (Broader U4 CTA audit out of scope.)

## 8. Pins — enumeration + weakening judgment

New/edited pins:
- `src/lib/clients.test.ts` (**new**): pure-helper asserts + source-regex pins (server query, epoch, confirm/refetch, fallbacks, column order, caption/aria-live, no hover-only). Additive.
- `src/lib/navModel.test.ts`: `PENDING_PAGE_IDS.length===0`; `clients` now allowed/menu for P; new landing test (`workspaceExitLanding==='clients'`); shell-wiring pins (`workspacePhase` gates, boot landing strings, AuthContext helpers).
- `src/lib/workspaceClient.test.ts`: additive state-machine pins (phases, claim, boot exit, boot fail, invalid→P, enter/exit verified, retry).
- `src/lib/b17TransactionInventory.test.ts`: `allowed.size 70→72`, +2 exact paths (`ClientsView.tsx`, `clients.test.ts`), +1 control input (task md). Exact-path only, no globs.

**Weakening judgment: no substantive weakening.**
- Two existing assertions were *replaced*, both justified by required new behaviour: (a) the old "Header has no Exit" pin → "W carries Exit / db pill P-only" (Exit is now required); (b) the old blanket `doesNotMatch(app,/activeTab\s*===/)` → a narrower regex that still forbids every raw-tab comparison **except** the required `client-detail && !clientConfig` detour, plus a positive pin for that guard. → **LOW observation N3** (narrow, justified relaxation; not a loophole).
- No test was silently deleted; all removals have a delivered replacement.

## 9. Style contract (touched files) — PASS

- Zero literal colours (`#rrggbb`), zero `slate|gray|zinc|neutral|stone-<n>`, zero `dark:`, zero `bg-white/text-black`, zero arbitrary colour values (`bg-[#…]`/inline colour style) in touched files. Only hit was `ReportsView.tsx` print block (`text-black`/`slate-3xx`) — untouched and explicitly **print-exempt** (STYLE_CONTRACT §5). → FLAG, pre-existing, not a B2 file.
- Logical properties only: no `pl-/pr-/ml-/mr-/left-/right-`/`text-left/right`/`float-*` in touched views/components; `ps/pe/ms/me/start/end/text-start` used. ✔
- Tokens reused (`bg-surface-2`, `border-border`, `bg-brand`, `bg-success-soft text-success-text`, `bg-danger-soft`, `bg-warning-soft`). ✔

## 10. Findings

| ID | Severity | Finding |
|---|---|---|
| **F1** | **MEDIUM (fidelity) / LOW (operational)** | **Exit and reload land P→`ge-overview`, not §7 `clients`.** Root cause: the raw-tab normaliser `useEffect([currentPage,activeTab])` (`App.tsx:169-171`) runs on every commit — including while `loading` and while the transition screen is shown — so it coerces `activeTab` to the current-context landing (`ge-overview` during `checking` with a null workspace; `dashboard`→`ge-overview` during `closing` with a still-consultant workspace) **before** the `bootLanding` effect / `handleExit` pre-set can hold. The `bootLanding` effect only applies when `activeTab===null` (`:180-184`). Result: `clients` is never the Exit/boot landing (page still reachable via the P sidebar `العملاء` row). **No W resume, no identity leak, no forbidden data, no RLS claim.** Proven deterministically by the landing simulation (reproduces the recorded reload deviation and predicts the same for Exit). This is the recorded LOW deviation **plus the same root cause also affecting explicit Exit** (previously unrecorded). Live re-confirm recommended (live DB off-limits here). |
| N1 | LOW | Suspend success notice is set at 2xx **before** the authoritative refetch resolves (`setNotice` then `await load` in `finally`). Status is not optimistically mutated, so no false state — wording/ordering nit only. |
| N2 | LOW | AR empty title "لا يوجد عملاء **بعد**" vs binding "لا يوجد عملاء" (extra "بعد"); EN matches. Cosmetic. |
| N3 | LOW | `navModel.test` raw-tab pin narrowed to permit the required `client-detail` detour (see §8). Justified, still guards all other raw-tab use. |
| N4 | LOW | DB pill reuses `t.settings.connected='Connected & Responsive'` / `disconnected='Disconnected / Unreachable'` rather than the binding's exact **متصل/Connected · غير متصل/Disconnected**. P-only, no RLS claim — wording only. |

## 11. NOT VERIFIED

- **Live server/DB truth:** live DB is off-limits; the §5 rows vs DB, Enter→W dashboard, Exit→P, reload→P, C/E unchanged and "no flash" could not be executed. Server routes/response shapes were only **statically** confirmed to exist and match (`adminClients.ts` P search branch with `mappedItemCount/assignedPairCount/submittedPairCount/pendingPairCount/frozenPairCount/unmapped`; `adminPlatformOps.ts` totals incl. `active`,`pendingStaffLists`; `admin.ts` `PATCH /clients/:id`).
- **Screenshot content:** `clients-page.png` (107 KB) and `consultant-workspace.png` (135 KB) exist but their live depiction is not asserted.
- **App-level landing** was proven by a **faithful static model** of App's effects + the real `resolvePage` resolver (no DOM harness installed; installs forbidden). The model reproduces the executor/Tera-recorded reload deviation exactly, which is strong corroboration; a live mount confirmation is still recommended.

## 12. QA Agent Signature

QA Agent — Execution Mode · independent oracle (`u3b2-qa-oracle.mts` 19/19) + landing model (`u3b2-qa-landing.mts`) · lint 0 / tests 309/309 / build 0.
Decision is Tera's. **Verdict: FAIL** — solely on §7 Exit/boot landing to Clients (F1); all §5 table fidelity, B1 carries, ClientDetail target rules, CTA removals, pins, style, lint/tests/build PASS. Findings + severity above; no source/config/control writes beyond this report and `%TEMP%\opencode\u3b2-qa-*`.
