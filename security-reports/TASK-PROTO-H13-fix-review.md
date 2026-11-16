# TASK-PROTO-H13 — Fix Review (الدرع / The Shield)

- Task: TASK-PROTO-H13 — platform-wide app theme (`app_settings`) + ISS-005 token fix
- Agent: security-agent · Mode: Fix Review / Preventive (defensive, static) · Session NEW
- Base: `f85b3a5` (== HEAD; work is uncommitted worktree) · Reviewed as diff-first, no trust in executor report
- Live DB: OFF-LIMITS (Tera's). Static only. No tests / DB / browser / network executed.

> هذا مراجعة دفاعية — لا أصدر قرار البوابة النهائي (PASS/FAIL). القرار للقاضي (`security-auditor`).

## Summary
No High/Critical defect found in the reviewed surface. **1 Medium** (test-guard red as landed — process, not runtime) and **1 Low/Unverified** (live table-ownership execution role, fail-closed). The security-critical mechanics (P-only role gate, purpose-gated writes, actor-bound audit, server-sourced resolution, no mass assignment, no secrets/deps, pin integrity) check out.

## Findings

### MEDIUM — SHIELD-H13-01: ratified-write guard is red on the untracked prototype screenshot (and will red on the two H13 reviewer reports)
- Evidence: `src/lib/b17TransactionInventory.test.ts:232-235` (`reviewerReports` set), `:238-239` (`controlInputs`), `:240-244` (`changed` = tracked diff + `git ls-files --others --exclude-standard`; `assert.ok(allowed.has(file))`).
- Fact (static): `git ls-files --others --exclude-standard` returns `project-control/prototypes/task-proto-h13/settings-app-theme.png`, which is in **none** of `allowed` / `reviewerReports` / `controlInputs` → the loop throws `Unapproved write: …settings-app-theme.png`. The guard cannot prove a green ratified set as the tree stands.
- Amplifier: the two reviewer artefacts are also not excluded — `project-control/qa-reports/TASK-PROTO-H13-QA.md` (QA) and `security-reports/TASK-PROTO-H13-fix-review.md` (this file). Once written they become untracked and fail the same assertion. (H12 had added its own two paths; H13 did not.)
- Impact: acceptance gate "full tests green / `git status` == ratified set (§5)" cannot be met; the byte-freeze guard loses its baseline evidence value. No runtime/privilege impact.
- Suggested close (Tera-owned files, I do not edit tests): add the two H13 report paths to `reviewerReports` by exact string; move the PNG outside the repo or admit its exact path deliberately. Disjoint: QA owns the QA report; Tera owns the pin edits.
- Status: **OPEN (static, confirmed)**.

### LOW / UNVERIFIED — SHIELD-H13-02: table ownership on the LIVE one-shot apply (fail-closed in code; live role not inspectable)
- Evidence: `src/db/schema.sql:1287-1309` (table + `ENABLE`/`FORCE RLS` + 3 policies), `src/db/b17-content.sql:1083-1095` (post-wipe re-assert), `src/db/b17Readiness.ts:90-109` (`STRUCTURE_SQL`: `tables`/`columns`/`policies`), `scripts/h13-app-theme-scratch.ts:249-262` (reversal/restore re-runs DDL **as the app role**; comments note `information_schema.columns` only lists tables the role can see).
- Analysis: `runMigrations` (`src/db/index.ts:139-161`) and the scratch both create/own `app_settings` as the app runtime role (`NOSUPERUSER`, `NOBYPASSRLS`, asserted at scratch `:138-139`). `STRUCTURE_SQL`'s `columns` component is `information_schema.columns`, which is privilege/ownership-sensitive → an owner≠app-role table with no grant is **invisible** → checksum mismatch vs `B17_CONTENT_SHAPE` → `verifyB17` throws `b17.schema_drift` (fail-closed). If the app somehow runs as owner, `FORCE ROW LEVEL SECURITY` still applies. So the code path and the script do **not** silently recreate the live defect Tera fixed.
- Residual (unverified): Tera's §4 live `pg_dump`/one-transaction SQL is run outside this repo under a role I cannot see. If it is executed as a role other than the app role **and** the app role is later `GRANT`ed visibility, the fingerprint could match while `relowner`≠app role (still no row-scope hole thanks to FORCE RLS, but migration/privilege drift).
- Suggested close (Tera, live step): after apply, assert `pg_get_userbyid(c.relowner)=current_user` for `app_settings` (same shape as `owner_is_app` in `CONTENT_AUTHORITY_SQL`, `b17Readiness.ts:76-77`), or apply as the app role.
- Status: **UNVERIFIED (live) / code path fail-closed**.

## Verified clean (static)
1. `b17-content.sql` = exactly two logical hunks (unified=0 shows `@@ 512/513` + `@@ 1066/1070`): (a) `APP_THEME_UPDATED` appended only to the **NULL-target** platform.config allowlist — `b17-content.sql:516-517`; actor clause `user_id::text=b17_setting('current_actor_id')` intact at `:480`; reachable only under `b17_platform_config()` = purpose `platform.config` + role `ge_admin` + actor set (`:270-274`). Tenant modes cannot produce that purpose: `domainTransaction` requires `live.mode==='platform'` (`src/server/routes/initiativeScope.ts:70`) and `platformConfigContext` throws 403 otherwise (`src/server/routes/_shared.ts:78-83`). NULL-target GUC is genuine (`setTenantContext` writes `''`; `b17_setting`=`nullif(...,'')` → IS NULL true — `src/db/index.ts:20-31`, `src/db/b17.sql:36-37`). (b) `app_settings` policies re-asserted post-wipe `b17-content.sql:1083-1095`; `b17.sql` really wipes all policies (`src/db/b17.sql:51-60`) and never blanket-creates a scope policy for `app_settings` (loop only covers enumerated tables `:114-125`) → no OR-combination widening. No other policy/table/definer touched; `b17.sql` and `b17ContentMigration.ts` unchanged.
2. `schema.sql:1287-1309`: table DDL only; `id CHECK (id=1)`; `ENABLE`+`FORCE RLS`; **no** `CHECK` on theme; **no** seed (absent row = auto). Matches contract §2(1).
3. `settings.ts`: P-only, `authMiddleware`+`requireDomainAccess` (GET) and `+requireFreshPassword` (PUT) `:82-83`; enum validated **before** `domainTransaction` `:51-58`; single-row upsert `id=1` `:62-66`; only `body.theme` read (no mass assignment); audit uses live actor `req.access!.actorId` inside the transaction `:67-74` matching `current_actor_id` GUC. Input parser is the hardened shared `jsonInput` (10 MB, utf-*, **duplicate-key rejection** `src/server/jsonInput.ts:83`, rejects→`{}`). SQL is parameterized (`$1`).
4. Resolution (`auth.ts:20-46`, `:146-155`; `session.ts:29-43`): server-sourced only (`SELECT theme FROM app_settings WHERE id=1`), zero request input; `normalizeAppThemeOption`/`normalizeTenantTheme`/`resolveAppTheme` make unknown/legacy/NULL settle on auto→tenant→`'ge'`; cannot crash. `loadAppTheme` runs under `SELECT USING(true)` pre-identity (display-only table: `id,theme,updated_at`, no tenant data).
5. UI: platform-only branch gated by `isGeAdmin = user?.role === 'ge_admin'` (`SettingsView.tsx:72`,`:590`); `client_admin` (`isAdmin` true) does **not** get the section; fetch guarded `if(!isGeAdmin) return` `:105-107`. New returns are server-owned; save calls `refreshUser()` `:139` and `ThemeContext` re-applies from `user.theme`. **Zero** literal hex / `dark:` / `slate|gray|zinc|neutral|stone` in touched views; `text-brand`-as-text count = 0; all classes are established tokens (`border-success` 15×, `border-danger` 43×, `shadow-xs` 64×).
6. ISS-005 conversions are className-only (no logic/JSX-order change): `App.tsx:116`, `SetupView.tsx:176`, `SettingsView.tsx:371,593,750,851`.
7. Pins: exactly two new `P` declarations (`accessRegistry.ts:229-235`), mounted once (`routes.ts:27,46-47`), census moved 95→97 / 99→101 / 87→89 / allowed 54→63 disclosed. The three re-measured sha256 pins **match the landed bytes exactly** (verified: auth.ts `5848271d…`, routes.ts `07449bdd…`, accessRegistry.ts `8f829377…`); `b17Readiness.ts:12-14,57` moves all three structure constants together; no sanctioned definer added. `b17-content.sql` two-hunk strip reproduces the base text (property test) and `auth.ts`/`routes.ts`/`accessRegistry.ts` moved from byte-compare to exact sha256 pins (disclosed, equivalent drift-detection strength).
8. No deps/lock/`.env` change (`package.json`,`bun.lock`,`.env.example` untouched); no secret literals in new files (the scratch only *sets* a random `JWT_SECRET`); endpoint surface minimal = exactly `GET|PUT /settings`.

## Unverified bounds (honest)
- The three structure constants (`PREDECESSOR_SHAPE`, `B17_SHAPE`, `B17_CONTENT_SHAPE`) cannot be re-measured statically; the falsifiability proof is `scripts/h13-app-theme-scratch.ts` (incl. reversal → `cf79a6a3…`). **Not run by me.** Tera must run it on its throwaway scratch before acceptance.
- Live `pg_dump`/apply role and post-apply `relowner` (SHIELD-H13-02) — live, off-limits.

## Decisions needed from Tera
1. SHIELD-H13-01: authorise the exact-path guard additions for the two H13 reports + decide the screenshot's fate (move out / exact admit). Required for a green suite.
2. SHIELD-H13-02: confirm the live apply runs as the app runtime role (or add the `relowner` assertion).

## Handback
Task ID: TASK-PROTO-H13
Agent: security-agent
Mode: Fix Review (static, diff-first)
Status: Done (1 Medium + 1 Low/Unverified, both outside my write scope)
Findings: 2 (High 0 · Medium 1 · Low 1 · Unverified 1 live)
Artifacts: security-reports/TASK-PROTO-H13-fix-review.md
Evidence: b17-content.sql:480,513-517,1083-1095 · schema.sql:1287-1309 · auth.ts:20-46,146-155 · session.ts:29-43 · settings.ts:33-83 · accessRegistry.ts:229-235 · routes.ts:27,46-47 · SettingsView.tsx:72,590 · App.tsx:116 · SetupView.tsx:176 · b17TransactionInventory.test.ts:232-244 · b17Readiness.ts:76-77,90-109 · scratch.ts:138-139,249-262 · jsonInput.ts:83
Unverified: structure-constant re-measure (scratch not run) · live apply role