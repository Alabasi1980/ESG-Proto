# QA Report — TASK-PROTO-H12 (tenant theme from the server, D-H01-01)

## Task Information
- **Task:** TASK-PROTO-H12 — server-enforced tenant theme (`clients.theme`, session broadcast, P-only write, `?theme=` removed).
- **Mode:** QA Execution Mode — **independent, neutral** (Session NEW). Conduct gate read first.
- **Date:** 2026-11-16 · **Branch:** local-only track, `HEAD = 4e13a82` (base), worktree carries the change set uncommitted.
- **Environment:** Windows 11 (win32) · Node v22.22.2 · npm 12.2.2 · Docker 29.9.2 · image `postgres:18` (own scratch) · PG18 scratch on loopback ephemeral port, generated creds, NOSUPERUSER/NOBYPASSRLS/FORCE, own volume, destroyed at end.
- **Isolation:** the live shared DB (`127.0.0.1:55432`, container `b17-showcase`) was **never connected to or modified**; `.env` was never read; no Aiven, no other container, no installs/commits/push/deploy.

## 1. Scope discovery (independent — not taken from the handback)
`git -C prototype-app status --porcelain --untracked-files=all` (base `4e13a82`):

    M src/App.tsx                              M src/main.tsx
    M src/context/AuthContext.tsx              M src/server/auth.ts
    M src/context/ThemeContext.tsx             M src/server/routes/adminClients.ts
    M src/db/b17Readiness.ts                   M src/server/routes/session.ts
    M src/db/schema.sql                        ?? src/lib/themeSession.test.ts
    M src/lib/b17TransactionInventory.test.ts  ?? project-control/tasks/TASK-PROTO-H12/TASK-PROTO-H12.md (Tera input)
    ?? security-reports/TASK-PROTO-H12-fix-review.md (Shield, disjoint/not inspected)

`git diff --stat 4e13a82` = 10 files, +114/−45. **Every path is inside §3 allowed targets. No view, component, style, print, matrix/registry/capabilities or dependency file is touched.** No `src/styles/*`, no `b17.sql`, no `b17-content.sql`, no route other than `PATCH /clients/:id`.

## 2. Executed evidence — own fresh PG18 scratch (schema → U1 → content)

| # | Check | Result |
|---|---|---|
| A0 | scratch app role `rolsuper=false`, `rolbypassrls=false` | PASS |
| A1 | `schema.sql` applies on an empty scratch (`runMigrations`) | PASS |
| A2 | `clients.theme` = `text`, `is_nullable=NO`, `column_default='ge'::text` | PASS |
| A3 | **no CHECK constraint** mentions theme | PASS |
| A4 | `clients` RLS enabled **and forced** | PASS |
| A5 | **`PREDECESSOR_SHAPE` == measured schema-only md5** = `6df697af6c8f04a95c799f1bd9640aff` | PASS |
| A6 | that md5 ≠ pre-H12 constant (`18851d69…`) | PASS |
| A7 | inventory bootstrap + 3 session users (ge_admin / client_admin / employee) | PASS |
| A8 | `applyB17Offline` (U1) = `applied` | PASS |
| A9 | **`B17_SHAPE` == measured post-U1 md5** = `a8dbb2d504cc945bea31e29e858e5437` | PASS |
| A10 | that md5 ≠ pre-H12 constant (`4b4e39e3…`) | PASS |
| A11 | `applyB17ContentOffline` (U2D) = `applied` | PASS |
| A12 | **`B17_CONTENT_SHAPE` == measured post-content md5** = `cf79a6a3827ab6037a28f629e4cbdb17` | PASS |
| A13 | that md5 ≠ pre-H12 constant (`5d5ddb93…`) | PASS |
| A14 | `assertB17Ready()` green on the fresh scratch | PASS |

**Falsifiability (the constants are measured, not plausible):**
| B7 | with `clients.theme` **dropped**, md5 = `5d5ddb9344225a53059da3f7d92bdd94` (= exactly the PRE-H12 content constant) | PASS |
| B8 | re-adding `theme TEXT NOT NULL DEFAULT 'ge'` returns md5 to `cf79a6a3…` (= new constant) | PASS |
| B9 | `assertB17Ready()` green after re-add | PASS |

**Stale ledger refuses / restore passes:** B1 stale content `structure_checksum` → `b17.version_drift` · B2 restore → green · B3 stale U1 `structure_checksum` → `b17.version_drift` · B4 restore → green · B5 tampered content `checksum` → `b17.version_drift` · B6 restore → green. **All PASS** (25/25 instrument checks).

## 3. Executed evidence — HTTP on the same scratch (real `server.ts`, `B17_SCRATCH_OPT_IN=YES`, loopback)

| # | Check | Result |
|---|---|---|
| D1 | `server.ts` boots only after activation | PASS |
| D2 | `POST /auth/login` ge_admin → `user.theme='ge'` (no tenant binding) | PASS |
| D3 | `GET /auth/me` → `user.theme='ge'` | PASS |
| D4/D5 | client_admin / employee **inherit** tenant theme `ge` | PASS |
| D6 | platform workspace tab (P context) | PASS |
| D7 | `PATCH {theme:'blue'}` → **400** `{code:'theme.invalid'}` (own code, before the transaction) | PASS |
| D8 | `PATCH {theme:'lime'}` → 200, **RETURNING carries `theme`** | PASS |
| D9 | audit row `CLIENT_UPDATED` payload `{"theme":"lime","suspended":false}` | PASS |
| D10/D11 | after the write, client_admin **login + /auth/me** and employee receive `lime` | PASS |
| D12 | a second tenant is untouched (still `ge`) | PASS |
| D13 | second change → `dark`, propagates on next login | PASS |
| D14/D15/D16 | **C refused 403** · **E refused 403** · **W (consultant) refused 403** (`workspace.mode_mismatch`) | PASS |
| D17 | workspace exit returns to platform | PASS |
| D18 | stored **unknown** value (`'blue'`) → session serves `ge` (200, no crash) | PASS |
| D19 | stored **NULL** is impossible — the `NOT NULL` write is rejected | PASS |
| D20 | a catalog edit that would allow NULL is refused **fail-closed** (503 `access.unavailable`) | PASS |
| D21 | column restored → session green, theme `ge` | PASS |
| D22/D23 | name-only PATCH unchanged; its audit payload carries **no** theme key | PASS |
| D24 | empty body still 400 · D25 unknown client still 404 | PASS |
| D26 | suspend still works **and the suspend wall is unchanged** (200 `{suspended:true}`, no data) | PASS |
| D27/D28 | unsuspend works; ge_admin still `ge` after every write | PASS |

**28/28 HTTP checks PASS. Total executed: 53/53.**

## 4. Executed gates (run by QA on the executor tree)

| Gate | Command | Actual result |
|---|---|---|
| Lint | `npm run lint` (`tsc --noEmit`) | **exit 0**, 0 diagnostics |
| Tests | `npm test` (`tsx --test src/**/*.test.ts`) | **234 tests, 234 pass, 0 fail** (baseline was 227; +7 = the new `themeSession.test.ts`) |
| Build | `npm run build` (`vite build`) | **exit 0**, 1691 modules, `dist/assets/index-*.js 543.19 kB` |

## 5. Static verification (item 5 + item 6)

- **`?theme=` : 0 occurrences** anywhere under the repo (excl. `node_modules`/`dist`); `URLSearchParams('theme')` = 0. Remaining `URLSearchParams` uses are unrelated query builders in `AuditLogView`/`ActionsView`/`InitiativesView`/`GeFinalView` (pre-existing).
- **`src/db/schema.sql`** — block at 1272–1282 matches the `clients.suspended` precedent exactly: `DO $$ … IF NOT EXISTS (SELECT 1 FROM information_schema.columns … table_name='clients' AND column_name='theme') THEN ALTER TABLE clients ADD COLUMN theme TEXT NOT NULL DEFAULT 'ge'; END IF; END $$;` — **no CHECK** (confirmed in the file and in the live catalog, A3).
- **`ThemeContext.tsx`** — reads `useAuth().user?.theme`, maps only `lime|dark` else `'ge'`, `useLayoutEffect(..., [theme])` (so login/refresh/logout re-apply), **no** `localStorage`, **no** `fetch`, **no** picker, **no** URL read.
- **Provider order** — `main.tsx`: `<AuthProvider><ThemeProvider><App/></ThemeProvider></AuthProvider>`; `App.tsx` mounts **neither** provider (comments only).
- **Zero literal-colour tokens introduced**: `(bg-white|text-black|slate-|gray-|zinc-|neutral-|stone-|dark:|#[0-9a-fA-F]{6})` = **0 hits in all 11 touched files**. (Pre-existing hits remain only in `ReportsView` print block — approved print exception — and false-positive `lg:` utilities in `Sidebar.tsx`; both untouched.)
- **Session broadcast shape** — `auth.ts` emits `theme:'ge'` by default then `normalizeTenantTheme(tenant.theme)` with `SELECT name,suspended,theme … FOR SHARE`; `session.ts` login does the same and `/auth/me` spreads `identity.user` (theme included), payload otherwise unchanged.
- **No test weakening beyond the two disclosed pins:** (i) `b17Readiness.ts` comparison now normalizes the three `*_SHAPE` constants and still requires **every other code line** to equal the G2 base (my A5/A9/A12 + B7/B8 re-measure the normalized values, so the normalization cannot hide a wrong constant); (ii) `auth.ts` **leaves** the byte-freeze list with an explicit comment that **every other** protected file stays byte-identical, and the allowed set moves 48 → **54** with exactly the 6 H12 paths (count asserted). Guard rails that still bind the changed server files and still pass: `detached` root counts (`auth.ts`:2, `routes/session.ts`:1), "session.ts has no `runMigrations|applyB17Offline|schema.sql`", `adminClients.ts` ≤ 500 lines, no alias imports of the four transaction wrappers.

## 6. Pass/Fail Decision

**✅ PASS** — every acceptance item of §2/§3/§5 is satisfied by independent evidence; 53/53 executed checks, 3/3 gates green, scope = ratified set only. No defect found that would justify FAIL or PARTIAL.

## 7. Findings / gaps for Tera (none blocking)

| Sev | Finding | Proposed routing |
|---|---|---|
| LOW | **Post-gate report artifacts trip the unapproved-write pin (verified).** The guard's ratified set (54) covers code writes; the two exclusion sets name only `project-control/qa-reports/B17-U2G-QA.md`, `security-reports/B17-U2G-fix-review.md` and the H12 task doc. With this report present: `npx tsx --test src/lib/b17TransactionInventory.test.ts` → 4/5, `error: 'Unapproved write: project-control/qa-reports/TASK-PROTO-H12-QA.md'`. With this report moved out (Shield's in flight): same test → 4/5, `error: 'Unapproved write: security-reports/TASK-PROTO-H12-fix-review.md'`. Full suite was **234/234 green** when run before either artifact existed. So `npm test` cannot be green again until both reports are committed and their exact paths added (precedent: B17-U2G rows). | Tera: commit both reports and extend the exclusion sets when landing; do **not** read the post-report failure as an implementation defect. |
| LOW | `auth.ts` loses byte-identity protection (necessary and disclosed). Its theme behaviour is now guarded only by regex assertions in `themeSession.test.ts` (enum default + SELECT text + normalize call), i.e. weaker than byte-equality for future unratified edits. | Tera/Shield: consider a content-hash pin or a narrower byte-freeze on the non-theme regions of `auth.ts` in a later batch. |
| LOW | A stored value outside the enum (e.g. `'blue'`) is accepted by the DB (by design — no CHECK) and served silently as `ge` until a P `PATCH` repairs it; nothing detects such a row. | Operating note: no action needed for this contract; a future admin read could surface `theme <> ALL('ge','lime','dark')` rows. |
| INFO | The PATCH audit payload records the applied `theme` but not the previous value (mirrors the existing `suspended`-only pattern, no before/after by design). | Note for the auditor; not a defect against this contract. |
| INFO | The empty-body 400 message changed to "Provide name, industry, suspended and/or theme to update." (the old text omitted `industry`). No frontend or test depends on the string (`GeOverviewView`/`ClientDetailView` read `data.error` only on failure). | None. |
| INFO | `npm run build` prints two pre-existing toolchain warnings (vite `__dirname` config note, >500 kB chunk) — unrelated to this task. | None. |

## 8. Not verified by QA (and why)

- **Browser-level theme application** (`data-theme` actually flipping in a real page, login→dark, logout→ge): no Playwright/E2E suite exists for theme, and the brief scoped item 5 to static/grep proof. Evidence stands on the provider code + build. `NOT VERIFIED` (visual).
- **Live shared-DB migration** (`127.0.0.1:55432` ALTER + ledger update): **Tera-owned** (§4); deliberately not executed by QA.
- **Semgrep / gitleaks** on the diff (§5 executor evidence) and the Shield security review: not run here (Shield's concurrent scope, disjoint file).
- **Consultant-mode *UI* inheritance**: server-side W refusal was executed (D16); the consultant-mode rendering path was not exercised in a browser.

## 9. Instrumentation (reproducibility)

Scripts and state live outside the repo, in `%TEMP%\opencode\b17-h12-qa-20261116-083950\` (`prep.mts`, `http.mts`); each run creates its own container `b17-h12-qa-<hex>` (own volume) and removes it. Generates its own credentials; no value is printed here or stored in this report. Sequence: `prep` (container → role/db → schema → bootstrap → U1 → content → drift/refuse/restore → column-tracking) then `http` (boot `server.ts` on the same scratch → session/PATCH suite → cleanup).

## QA Agent Signature
QA & Acceptance Agent (مُختبر) — Execution Mode · 2026-11-16 · report-only, no source/test/config writes.

