# TASK-PROTO-U3-B2 — Defensive Fix Review (Shield / الدرع)

- Task: TASK-PROTO-U3-B2 — Clients page (§5) + client-workspace lifecycle (§7) + B1 preconditions
- Agent: security-agent (الدرع) · Mode: Preventive Review (static, first pass) · Session: NEW
- ClientAppPath: `D:\Teranoo Work\Client01\prototype-app` · Diff base: `a218ba8` → HEAD (`f293822` + `9772a0f`)
- Status: **Done (static)** — findings recorded, no gate decision issued (that is the Auditor's)
- Governing read: B2 contract, `B17_UI_BINDINGS.md` §2/§3/§5/§6/§7, `STYLE_CONTRACT.md`, B17 spec §4

## 1. Scope actually reviewed (diff-first)

Changed files (`git diff --name-status a218ba8 HEAD`): `App.tsx`, `components/Header.tsx`,
`context/AuthContext.tsx`, `i18n/translations.ts`, `lib/navModel.ts`, `lib/workspaceClient.ts`,
`views/ClientsView.tsx` (new), `views/ClientDetailView.tsx`, `views/GeOverviewView.tsx`,
`views/DashboardView.tsx`, `views/GapAnalysisView.tsx`, `views/StandardsView.tsx`, 4 test files,
task record + 2 prototype PNGs.

No change to `src/server/**`, `src/db/**`, `src/styles/**`, `.env`, `package.json`, `bun.lock` —
**server/db/style/deps/secrets untouched** (also pinned by `b17TransactionInventory.test.ts` +2 paths only).

## 2. Findings

### SHIELD-U3B2-01 — Medium — W (consultant) Client Detail still renders P-only editor subtrees
**Evidence:** `src/views/ClientDetailView.tsx:296` (`isGe = user?.role === 'ge_admin'` — the W actor *is*
`ge_admin`), then `:339-343` unlink, `:345-367` show_gap/show_corrective flags + save, `:371-387` link-service
select, `:390-401` suspend/unsuspend panel, `:411-433` assignment form, `:440-444` unassign, `:448-478` N/A
form, `:510-541` department-head designation, `:547-557` users roster; `:101-110` fetches `/api/services`
+ `/api/items` on mount for every context.
Reachable in W: `src/lib/navModel.ts:123` (`client-detail` order 2, menu true for consultant) →
`src/App.tsx:278` mounts `ClientDetailView` for non-platform contexts.
**Impact:** §6 requires W Client Detail to be *read-only* and §3 requires forbidden controls to be
**not rendered** (not merely refused). Today they are rendered **enabled** in W. No authority is gained —
server backstop verified statically: `src/server/accessRegistry.ts:155,161,163,164,165,168,169` are P@T-only
(W refused) and `src/server/routes/adminCommon.ts:38-42` sends non-platform callers through
`ownTenant()` (foreign id ⇒ 403 `scope.tenant_mismatch`); `POST /assignments/na` is legitimately W
(`:170`). The users card is server-redacted for W (`src/server/routes/adminClients.ts:254-262` strips email /
`is_active` / `must_change_password`).
**Also (§5/§6):** the suspend panel must exist **only on Clients**; it is still present on Client Detail and
B2 makes P Client Detail newly reachable (`src/App.tsx:489` explicit-T mount).
**Fix:** gate editors on the resolved nav **context** (platform) instead of `user.role`; delete the suspend
panel from Client Detail per §5; skip the catalog fetch outside P.
**Status:** OPEN (Tera disposition + Engineering fix).

### SHIELD-U3B2-02 — Low — Enter confirmation binds mode only, not the client
**Evidence:** `src/lib/workspaceClient.ts:374-385` (`enterVerified` → `reconcile('consultant')`) and
`:225-241` (`reconcile` compares `mode` only).
**Impact:** if the server answers `consultant` for a different tenant than the row clicked (server-side race
/bug), W chrome is adopted with the **server's** client name — display stays truthful and nothing foreign is
shown, but the user silently lands in client B after asking for A. §7 "Enter → W(A)".
**Fix:** reject unless `confirm.tab.client?.id === clientId` (treat mismatch as `invalid`).
**Status:** OPEN (Low).

### SHIELD-U3B2-03 — Low — Mid-session invalid/expired consultant handle keeps W chrome visible
**Evidence:** `src/lib/api.ts:124-125` (never re-mints a consultant handle — correct, no silent mode change)
with no consumer that triggers the B2 exit path; grep shows no `workspace.invalid` handler in
`AuthContext.tsx` / `App.tsx`.
**Impact:** §7 expects invalid/expired → verified P → Clients; instead every request fails and the W badge /
client name stay on screen. All reads fail closed (no data), and the always-visible Exit recovers
(`exitBusy` → failure panel → Retry → `recoverWorkspace('adopt')`, `workspaceClient.ts:414-434`).
**Status:** OPEN (Low) — acceptable only if Tera accepts manual recovery.

### SHIELD-U3B2-04 — Low — Fresh-login landing can be skipped after logout in the same page
**Evidence:** `src/App.tsx:181-184` applies `bootLanding` only when `activeTab === null`; `activeTab` is
never reset on logout (all `setActiveTab` sites, `App.tsx:170,182,202,212,221`).
**Impact:** GE → GE re-login without a page reload lands on the previous page instead of §2 `ge-overview`.
Role change is still deny-by-default (`resolvePage` redirects). No data/authority impact.
**Status:** OPEN (Low, cosmetic/§2).

### SHIELD-U3B2-05 — Low (informational) — Suspend success notice precedes the authoritative refetch
**Evidence:** `src/views/ClientsView.tsx:182` (success notice) vs `:188` (`await load(...)`).
**Impact:** the status column never flips optimistically (good); but if the refetch fails, a success notice
sits above a load error. Not an authorization issue.
**Status:** OPEN (Low).

### Open item (pre-existing, outside B2 targets → U4)
`src/views/ClientReviewView.tsx:72,179` and `src/views/GeFinalView.tsx:75,204` still call `GET /api/clients`
and render tenant selectors under `isGe` — i.e. visible in W, contradicting §3 "no client selector anywhere".
Enumeration is refused in W (`accessRegistry.ts:152` is P/C) and queue/final reads bind `ownTenant`
(`src/server/routes/evaluations.ts:1419,1599,1672,1857`) ⇒ foreign id 403. **No leak; UI-policy gap → U4.**

## 3. Verified closures (no finding)

| Check | Evidence |
|---|---|
| No W→W switch | `clients` is P-only (`navModel.ts:110` vs consultant block `:121-134`); Enter exists only on Clients; per-view pin `navModel.test.ts` "clients is a P only" |
| No silent mode change | `api.ts:119-130` (consultant never re-minted to platform); `workspaceClient.ts:225-241` (`mode_changed` never adopted); `exitVerified` `:389-397` adopts only a 2xx envelope |
| Failure paths render no W/P content | `App.tsx:128` + `:384-416` — full-screen `checking/opening/closing/failed`, entire shell unmounted |
| Duplicate suppression | `workspaceClient.ts:346-356` claim + `ClientsView.tsx:193,443` + `Header.tsx` `exitBusy` + `App.tsx:207,440` |
| Boot-exit correctness | `AuthContext.tsx:120-160` (mirror consultant ⇒ `checking` ⇒ `runBootWorkspace`); `workspaceClient.ts:441-481` reconcile→exit, failure ⇒ `failed` (never W, never guessed P) |
| Logout during transition | `AuthContext.tsx:97-105` (`clearSession`), `:289-298` (+`reset()` epoch/claim `workspaceClient.ts:283-295`) — no W render (`user` null) |
| P target not spoofable | `ClientDetailView.tsx:62-72` (`resolveTargetClientId`); source is the Clients row via `App.tsx:225-227,489`; no URL/storage input; bare P `client-detail` routes to `clients` (`App.tsx:164-167`) |
| Tenant enumeration removed from detail | no `GET /api/clients` in `ClientDetailView.tsx` (grep: only `:127` detail and service rows) |
| W/C cannot read another tenant | `adminCommon.ts:34-43` + `ownTenant`; matrix `accessRegistry.ts:160,162` ⇒ 403 |
| Suspend truth | `ClientsView.tsx:163-190` (confirm names client+action, `PATCH` body `{suspended}` only, no optimistic flip, refetch, unknown status has no action); server `adminClients.ts:287-326` audits `CLIENT_SUSPENDED/UNSUSPENDED` |
| §5 projections only | rows render name/code/status/counts; server payload counts-only (`adminClients.ts:120-135,155-159`); no scores/gaps/answers |
| Header/pill | `Header.tsx` pill behind `context === 'platform'`; `App.tsx:146-154` poll P-only and off during transitions; "PostgreSQL RLS" claim removed (pinned) |
| GeOverview totals-only | suspend/link-all/aggregateScore removed (`GeOverviewView.tsx` diff), role-gated fetch |
| F3 CTAs | no `setActiveTab('import-gri'|'settings'|'initiatives')` anywhere in `views/` (grep: 0) |
| Style | forbidden-color scan over changed TSX/TS: 0 hits (`dark` matches are theme-name identifiers only) |

## 4. Pins judged

- `navModel.test.ts`: `PENDING_PAGE_IDS.length === 0`, `clients` mountable for P / absent for W/C/E,
  `workspaceExitLanding() === 'clients'`, Header P-only pill + no RLS claim, App phase gates. **Honest** but
  regex-based.
- `b17TransactionInventory.test.ts`: allow-list +2 exact paths (`ClientsView.tsx`, `clients.test.ts`) — no
  server/db/style path added. **Honest.**
- `clients.test.ts`: pure §5 helpers (status/counts/percent/freeze/unmapped/epoch) + view-wiring regex ·
  `doesNotMatch /group-hover:|opacity-0/` (not hover-only). **Honest.**
- **Gap in pins:** nothing pins the W Client Detail read-only rule, which is why SHIELD-U3B2-01 passes CI.

## 5. Honest static bounds

No execution: no test/lint/build, no browser, no server, no DB (`live DB off-limits`). Server 403 claims are
static reads of `accessRegistry.ts` / `ownTenant` / route handlers, **not** observed responses. SessionStorage
tampering was reasoned about, not exercised. Live proof (Clients table vs DB, Enter→W, Exit→P, reload→P, no
flash, C/E unchanged) remains **Tera's** to run.

## 6. Disposition summary

| Severity | Count | IDs |
|---|---|---|
| High | 0 | — |
| Medium | 1 | U3B2-01 |
| Low | 4 | U3B2-02, -03, -04, -05 |
| Unverified | 0 | — |

**No Security Disposition (LOW/MEDIUM/HIGH/CRITICAL) is issued here** — that is Tera's call; this report is
input for the Auditor. Highest-priority item for Tera: **U3B2-01** (§6 read-only W Client Detail, §5
suspend-only-on-Clients).
