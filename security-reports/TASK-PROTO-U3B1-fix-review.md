# TASK-PROTO-U3-B1 — Shield review (context shell: nav model, identity, guards)

**Agent:** security-agent (الدرع) · **Mode:** Preventive/Fix Review (static) · **Session:** NEW
**Base → Head:** `c1e8f77` → `e90e3b7` (12 paths) · **ClientAppPath:** `D:\Teranoo Work\Client01\prototype-app`
**Inputs:** B1 contract, `B17_UI_BINDINGS.md` §2/§3, `STYLE_CONTRACT.md`, `src/lib/navModel.ts`,
`src/App.tsx`, `Sidebar`, `Header`, `AuthContext` (+ `workspaceClient.ts`, `api.ts`, `server/access.ts`,
`capabilities.ts` as enforcement ground truth), tests & inventory pins.
**Method:** diff-first, evidence = `file:line`. No code/test/control writes, no execution/build/tests,
no installs/commits, live DB untouched. **Live proof (P/C/E menus) is Tera's — not claimed here.**

**Verdict (static): 0 High · 0 Medium · 3 Low · 4 observed (accepted / out-of-scope).**
Deny-by-default is substantively real in the shell; remaining items are presentation-integrity
and one pre-existing poll/pill, all server-backed fail-closed.

## 1. Mandated review matrix

| # | Question | Result | Evidence |
|---|---|---|---|
| 1 | Deny-by-default real; guard before data effect; stale tab cannot survive role/mode change; unknown → zero pages | **PASS** | `App.tsx:33` (`activeTab` starts `null`), `App.tsx:126-127` (`resolvePage` → `currentPage`), `App.tsx:129-131` (state adopts resolved page), `App.tsx:329` (only `context && currentPage` mounts), `App.tsx:138-187` (one branch per page; `clients`/default → `null`), `App.tsx:201-206` (auth gates precede shell), `navModel.ts:240-250` (`requested` normalised/denied → landing), `navModel.ts:223-226` (presence + not pending + not target-only), `navModel.ts:253-262` (unknown/malformed role → `null`), `Sidebar.tsx:117` (`context ? menuPages : []` — no fallback menu) |
| 2 | Derivation cannot be spoofed: mode from verified mirror only (no URL/storage); C/E identity from session | **PASS w/ bound** | `navModel.ts:253-262` (mode meaningful only for `ge_admin`; C/E ignore it), `App.tsx:118-120` (mode = `workspace?.mode`, no URL/params — `App.tsx` has zero `location/localStorage/sessionStorage` use, only comment L117), `AuthContext.tsx:46-53` (`ensureTab()` → `currentTab()`, non-GE → `null`), `AuthContext.tsx:71-101` (identity from `/api/auth/me`). Bound = SHIELD-B1-01 / B1-02 |
| 3 | Identity block: no other tenant for P; W name from workspace envelope; no "Unrestricted" | **PASS** | `navModel.ts:289` (P: `value:null, secondary:null`), `navModel.ts:291` (W: `clientName` ← `workspace.client.name`), `navModel.ts:293/295` (C company; E dept+company), `Sidebar.tsx:122-128` (wiring: W=`workspace?.client?.name`, C/E=`user.*`), `Sidebar.tsx:199-215`, `Header.tsx:35-41,89-103`; "Unrestricted" string removed (`src` grep: only `navModel.test.ts:279` asserts absence) |
| 4 | E has no polling / no notifications fetch | **PASS w/ bound** | `Sidebar.tsx:103` (`canPoll = token && context!==null && context!=='employee'`), `Sidebar.tsx:105-113` (early return before `setInterval` L111), `Sidebar.tsx:240-244` (badge also gated). Server agrees: `accessRegistry.ts:225` `P;W;C`. Bound = SHIELD-B1-03 (`/api/db/status`) |
| 5 | Aliases: no duplicate, no bypass | **PASS** | `navModel.ts:153-156`, `206` (menu is model rows only → alias never a row), `navModel.ts:247-249` (alias first, then allow-check), tests `navModel.test.ts:135-149` (one highlight, cross-context alias not broadened) |
| 6 | Conditionals default OMIT; capability input not client-settable | **PASS** | `navModel.ts:185-187` (`conditional` kept only if `capabilities.includes(id)`), default `[]` at `:185,199,204,223,243`; prod callers pass no capabilities (`App.tsx:126`, `Sidebar.tsx:117`), only tests pass explicit sets |
| 6b | Test/pin edits judged for weakening | **PASS (additive)** | `b17TransactionInventory.test.ts:223-226` = +2 **exact** paths (no glob), `:254` size `68→70`; nothing removed; `navModel.test.ts` new, pins §3 verbatim + server cross-check `:240-262`, wiring `:264-283`; no `.skip/.only/todo` |
| 7 | No secrets, deps, style-token change | **PASS** | Diff paths = 6 src + 3 tests + contract + 3 png; **no** `package.json`, `.env`, `src/styles/*`, `index.css`; zero literal colours in new/changed source (grep), only token classes (`bg-surface-3`, `text-brand-text`, …); `bg-black/50` = pre-existing structural (STYLE_CONTRACT §2 L43) |

## 2. Findings

### SHIELD-B1-01 — Low — W mode + client name are re-hydrated from a mutable sessionStorage mirror without a server reconcile before first render
**Evidence:** `workspaceClient.ts:93-109` (`current()` trusts any `isTab`-shaped entry from
`sessionStorage['greenedge_workspace']`), `:83-89` (shape-only check: 43-char handle, gen>0, mode enum),
`:180-188` (`ensureTab()` returns the cached tab; `reconcile()` at `:225-241` is **not** called at shell start),
`AuthContext.tsx:51-52`, `App.tsx:118-120`, `Sidebar.tsx:124`, `Header.tsx:37`.
**Impact (static):** a user editing their own sessionStorage to `{mode:'consultant', client:{name:'…'}}` gets
the W menu and an arbitrary "consultant workspace · <name>" identity — a *self*-spoof of chrome, not of data.
**Bound (why Low):** every business call attaches `X-Workspace-Tab/Version` (`api.ts:72-81`) and the server
re-validates handle + generation + expiry (`access.ts:50-62`, `:132-147`) → `409 workspace.invalid/stale`;
no cross-tenant read, no privilege gain; C/E never consult `mode`.
**Tension:** `B17` §2 says W title/status comes "never … local storage"; the mirror is U3-A's approved design,
but B1 is the first consumer for *navigation + identity*.
**Recommend:** `await reconcile()` before the first protected render, or persist the handle only and re-fetch
`mode`/`client` at shell start. **Status: open (needs Tera routing — may be B2).**

### SHIELD-B1-02 — Low — `ge_admin` with no verified platform tab derives P and renders the full P menu
**Evidence:** `navModel.ts:258` (`ge_admin` + `mode !== 'consultant'` → `'platform'`, incl. `mode === null`),
`App.tsx:118-120`, `AuthContext.tsx:46-53` (`ensureTab()` may resolve `null` on 429/transport → `workspace` stays
`null`), codified by `navModel.test.ts:199`.
**Impact:** acceptance §1.6 says "missing binding → no pages"; here an unverified-tab GE sees P chrome
(menus only). **Bound:** all business routes fail closed (workspace handle required, `access.ts:50,132`); no data.
**Note:** deliberate — avoids a blank-shell flash while `POST /workspace/tab` is in flight. **Status: open —
Tera ruling (current behaviour is pinned by a passing test).**

### SHIELD-B1-03 — Low — E (and C) still poll `/api/db/status` every 15 s; the DB pill claims "PostgreSQL RLS"
**Evidence:** `App.tsx:109-113` (interval at `:111`, not context-gated), `App.tsx:97-107` (`/api/db/status`,
bypass prefix per `api.ts:15`), `Header.tsx:106-118` (pill rendered for every context incl. E;
text `PostgreSQL RLS` at `:115-117` vs B17 §4 "no W/C/E diagnostics or 'RLS proven' claim").
**Status: pre-existing, NOT introduced by B1** (pill + interval predate this diff; Header was in scope "identity
pill only"; B17 §4 is outside the mandated §2/§3 read). Boolean/tableCount only, no tenant data.
**Recommend:** route to Tera (B2 or a small follow-up) — gate interval and pill by context.

## 3. Observed / accepted (no severity)

1. **Conditionals omitted by design in B1:** no capability source is wired, so W/C cannot reach
   `esg-profile`/`reports` (`navModel.ts:185-187`; `App.tsx:126`, `Sidebar.tsx:117` pass default `[]`).
   Matches §3 "withhold until resolved"; confirm the functional gap is intended for B2.
2. **E CTA is a silent no-op:** `GapAnalysisView.tsx:108` calls `setActiveTab('import-gri')`; in E the guard
   sends it to the landing (`navModel.ts:248`). Safe, but a dead control (view content is B2/forbidden here).
3. **P `clients`** is matrix-truthful, hidden (`navModel.ts:59-63,204-207`) and unmountable (`:223-226`);
   P lands `ge-overview` — the documented B1 placeholder (task §1.3). `App.tsx:183-185` keeps a `null` branch.
4. **Header subtitle inheritance:** `Header.tsx:43-60` still switches legacy per-page subtitles, so E's
   "إفصاحات قسمي" page shows Gap-Analysis subtitle copy. Title is correct (`Header.tsx:31`); copy-only nit.
5. **Doc staleness:** `App.tsx:37-39` says "AuthContext type is frozen" though `AuthContext.tsx:19-32,135` was
   extended (allowed by the contract). No security effect.

## 4. Closures / open

| ID | Severity | State |
|---|---|---|
| SHIELD-B1-01 (mirror trust for W mode/name) | Low | **Open** — Tera routing |
| SHIELD-B1-02 (no-tab GE → P) | Low | **Open** — Tera ruling |
| SHIELD-B1-03 (E db poll + RLS pill) | Low | **Open** — pre-existing, out of B1 scope |
| Items 1,3,5,6,6b,7 | — | **Closed** (static evidence above) |
| Items 2,4 | — | **Closed with recorded bounds** (B1-01/02/03) |

## 5. Static bounds — what this review cannot prove
- No build/lint/test execution (Tera-reported green is taken as reported, not verified here).
- Browser behaviour (menu render counts per role, actual request traffic for E, no flash on redirect) is
  Tera's live proof.
- Server 409 behaviour for a tampered handle is read from `access.ts`, not exercised.
- `GET /api/db/status` payload (tableCount) reaches any caller incl. unauthenticated — pre-existing, ISS-006.

## 6. Decisions needed from Tera
1. Accept SHIELD-B1-01 as-is (U3-A mirror) or require `reconcile()` before first protected render?
2. Keep `ge_admin`+no-tab → P, or treat as "no pages" until the tab is verified (test currently pins P)?
3. Route SHIELD-B1-03 (db/status interval + "PostgreSQL RLS" pill) to B2 / follow-up, or accept?