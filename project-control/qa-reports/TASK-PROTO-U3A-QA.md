# QA Report - TASK-PROTO-U3-A (independent Execution QA)

- **Task:** TASK-PROTO-U3-A - workspace client layer (contract `project-control/tasks/TASK-PROTO-U3/TASK-PROTO-U3.md`, section U3-A)
- **Agent:** QA & Acceptance Agent - Execution Mode, **session NEW**
- **ClientAppPath:** `D:\Teranoo Work\Client01\prototype-app`
- **Repo / base:** HEAD `7cdcbfbf8947f0ffd08b53632042f78e104f7fc57`, base `f46456c` -> reviewed range `f46456c..HEAD` (2 commits: `ce18aa6` feat, `7cdcbfb` docs)
- **Date:** 2026-11-16
- **Env:** Windows (win32), node v22.22.2, npm 12.2.2, tsx 4.21, vite 8.3.7, tsc 7.x (no DB used)
- **Executor handback:** treated as **Context only**. Every claim below was re-derived from `git`, diff analysis, executed tests and static contracts.
- **Live shared DB:** **NOT touched** (OFF-LIMITS per dispatch). No installs, no commits, no subagent, no writes outside the two allowed paths.

---

## 0. Independent discovery (done before judging anything)

| Command | Result |
|---|---|
| `git rev-parse HEAD` | `7cdcbfbf8947f0ffd08b53632042f78e104f7fc57` |
| `git diff --name-status f46456c..HEAD` | **30 paths** = 28 `src/` + 2 control artifacts |
| `git status --porcelain` (before + after my run) | empty (build output is gitignored) |
| `git diff --numstat ... src/views src/components` | 21 files, +88/-88 net (each file +1 import) |

**Changed source paths (28):** `src/lib/workspaceClient.ts` (A), `src/lib/api.ts` (A), `src/lib/workspaceClient.test.ts` (A), `src/lib/api.test.ts` (A), `src/lib/appTheme.test.ts` (M), `src/lib/b17TransactionInventory.test.ts` (M), `src/context/AuthContext.tsx` (M), `src/components/Sidebar.tsx` (M), and **20** `src/views/*.tsx` (M).
**Control artifacts (2, docs commit only):** the U3 contract file and `project-control/prototypes/task-proto-u3a/settings-services-workspace-fixed.png`.
**Untouched (verified by name-status):** `src/server/**`, `src/db/**`, `src/styles/**`, `src/i18n/translations.ts`, `package.json`, `package-lock.json`, `*.config.*`.

**Scope verdict:** every source path sits inside the contract's allowed write targets. No forbidden path was modified.

---

## 1. `src/lib/workspaceClient.ts` - PASS

| # | Requirement | Evidence | Result |
|---|---|---|---|
| 1.1 | single-flight `ensureTab` | `pending` promise (L56/166-169); my **QA-6**: two parallel first `apiFetch` -> exactly **1** `POST /api/workspace/tab` | PASS |
| 1.2 | **sessionStorage only** | handle key `greenedge_workspace` written only through `tabStorage()` (sessionStorage, L59-65 / L117); `localStorage` appears **only** at L70 reading the pre-existing token key `greenedge_token` - no workspace data in localStorage (executor test asserts `Object.keys(local) === ['greenedge_token']`) | PASS |
| 1.3 | `headers()` adds tab+version **only when present** | L173-180: `{}` when no tab, else both; my **QA-10** (returns `{}`, writes nothing) and **QA-1** (both headers on the wire) | PASS |
| 1.4 | refresh/enter/exit update generation/mode/client | `adopt()` L104-122; my **QA-4** (refresh bumps version 1->2, retry sends 2); executor test (enter -> mode `consultant` + client, exit -> platform gen 4). The handle is correctly preserved because the server envelope carries **no** `tabHandle` on GET/enter/exit (`workspace.ts` L19-21) | PASS |
| 1.5 | `reset()` clears | L225-235 clears memory + sessionStorage entry; executor test + my **QA-10** follow-up | PASS (see F1 for the in-flight race) |
| 1.6 | corrupt entries discarded | `isTab()` L76-82 + hydration L86-102; my **QA-9** with 5 hostile payloads (non-JSON, short handle, `generation:0`, rogue mode, non-base64url char) - each dropped **and** replaced by a valid entry | PASS |

**Server cross-check (read-only: `src/server/workspace.ts`, `access.ts`):** handle regex `^[A-Za-z0-9_-]{43}$` (matches `randomBytes(32).toString('base64url')`), version regex `^[1-9]\d*$`, column `generation integer NOT NULL DEFAULT 1 CHECK(generation>0)` (`src/db/b17.sql:28`) - the client's 43-char / `generation > 0` validation mirrors the server exactly and cannot reject a legitimate tab.

## 2. `src/lib/api.ts` - PASS

| # | Requirement | Evidence | Result |
|---|---|---|---|
| 2.1 | Bearer **only when the call site did not set it** | L69-70 `if (!headers.get('Authorization'))`; my **QA-1**: call-site `Bearer call-site` survives unchanged while workspace headers are still added | PASS |
| 2.2 | workspace headers on authenticated GE calls (ensure on first call) | `prepare()` L71-82; my **QA-1**, **QA-6** | PASS |
| 2.3 | **exactly one** refresh+retry, only for `workspace.stale` / `workspace.invalid` | L126-135; **QA-4** (stale then invalid: 4 requests = tab, call, refresh, call - the second 409 is returned as-is); **QA-5** (401 on the retry: 4 requests, auth cleared once); **QA-2** (409 with no code: 2 requests, no refresh/retry); other business 409 (`reports.gate_incomplete`) passes straight through (executor test) | PASS |
| 2.4 | bypass list exact | L27-34; **QA-3**: `/api/db/status?full=1` stays raw; lookalikes `/api/db/statusX` and `/api/workspace2` are **not** bypassed (correct); a non-`/api/` absolute URL never receives session headers (executor test) -> no token can leak to a foreign origin | PASS |
| 2.5 | 401 unchanged, single path | L122-125 + L134; `setUnauthorizedHandler` is the only clear-auth route; **QA-5** (hook fired exactly once) | PASS |

## 3. Call-site migration - PASS (my own diff analysis, not the executor's numbers)

Parsed `git diff -U0 f46456c..HEAD -- src/views src/components` and paired every `-`/`+` line:

- **21 files, 21 import lines, 88 `fetch(` -> `apiFetch(` occurrences, 0 non-mechanical pairs, 0 unpaired lines.**
  Rule applied: `added === before.replace(/(?<![A-Za-z0-9_$.])fetch\(/g,'apiFetch(')` - any single character of JSX, className, copy, ordering, logic or handler drift would have failed the match.
- Independent colour/palette re-scan per touched file, base vs HEAD (`#[0-9a-fA-F]{3,6}`, `rgba(`, `bg-white|text-black|slate-|gray-|zinc-|neutral-|stone-|dark:|translate-[xy]-`): **0 deltas** across all 28 touched files -> the two known exemptions (print block, `translate-*` substring false positive) were not touched either.
- **Deliberately-raw sites (7 in `views/` + `components/`), judged individually:**

| File:line | Path | Class | Verdict |
|---|---|---|---|
| LoginView:32 | `/api/setup/status` | PUBLIC (`accessRegistry`) | genuinely unauthenticated: OK |
| LoginView:41 | `/api/db/status` | PUBLIC | OK (also on the bypass list) |
| LoginView:57 | `/api/auth/login` | PUBLIC | OK |
| SettingsView:285 | `/api/db/status` | PUBLIC | OK |
| SettingsView:307 | `/api/db/migrate` | PUBLIC (always 409, `system.ts:30`) | OK - raw is the behaviour-preserving choice (migrating would have added a Bearer) |
| SettingsView:341 | `/api/auth/change-password` | SESSION, sends its own Bearer | OK |
| SetupView:51 | `/api/setup/admin` | PUBLIC | OK |

- Outside the 21-file set but audited: `App.tsx` (3 raw: `/api/auth/me`, `/api/db/status`, `/api/auth/change-password`) and `AuthContext` (2 raw: `/api/auth/me`, `/api/auth/logout`) - all bypass-class, unchanged, so no authenticated call was missed.
- Transport audit: `fetch()` is the **only** client transport (no axios / XHR / EventSource / WebSocket / sendBeacon anywhere under `src/` outside `src/server/`) -> an unmigrated authenticated path cannot exist.

## 4. `src/context/AuthContext.tsx` - PASS

- **Single clear path:** the only `removeItem('greenedge_token')` in `src/` is `clearSession` (L38); `refreshUser`'s failure branch (L72) and `logout` (L101) both call it - the three inline statements it replaced are identical (verified in the diff).
- **`ensureTab` only for `ge_admin`:** L70 (`data.user?.role === 'ge_admin'`) and L92 (`newUser.role === 'ge_admin'`); C/E never request a tab.
- **`reset` on login/logout:** L91 (after the token is written, before the new session's `ensureTab` - ordering correct) and L102.
- 401 hook registered/unregistered in an effect (L45-48).

## 5. Guard files - 3 changes, **no weakening**

1. `src/lib/appTheme.test.ts` (1 hunk, +3/-1): `fetch\('\/api\/settings'` -> `apiFetch\('\/api\/settings'` plus 2 comment lines. The assertion still requires the same path, still requires `{ headers:`, and still requires `method: 'PUT'`, `await refreshUser()` and the theme-clamp expression. Strictness is **equivalent**, and it now pins the authenticated transport. Not a weakening.
2. `src/lib/b17TransactionInventory.test.ts` (2 hunks): `allowed` += **4 exact paths** (`workspaceClient.ts`, `api.ts`, `workspaceClient.test.ts`, `api.test.ts`) - exactly the 4 authorised new files, no glob/prefix; the census pin `64 -> 68` is arithmetically consistent; **no protected path was removed**.
3. Same file: `controlInputs` += **1 exact path** (the U3 contract) - identical to the H12/H13 precedent, exact string, no glob.
   The byte-freeze/sha256 pins, `reviewerReports` (QA/Shield exclusivity) and the `new-file <= 500 lines` bound are untouched. No `.only` / `.skip` / tautological assertion exists in any of the 4 test files; top-level test counts of both edited files are unchanged (11 and 5).

## 6. Executed results

| # | Command (cwd = `prototype-app`) | Result |
|---|---|---|
| 6.1 | `npm test` (`tsx --test src/**/*.test.ts`) | **# tests 263, # pass 263, # fail 0** (subtests 1..223), 5.98 s |
| 6.2 | `npm run lint` (`tsc --noEmit`) | exit **0**, no diagnostics |
| 6.3 | `npm run build` (`vite build`) | exit **0** - 1693 modules transformed; `dist/index.html 1.08 kB`, css 48.99 kB, js 551.17 kB; built in 688 ms |
| 6.4 | **My own harness** (`%TEMP%\opencode\u3a-qa\qa-independent.test.mts`, run with the repo's tsx) | **10/10 pass** |

My harness is independent of the executor's fakes/tests (real `Response`/`Headers`, fresh module instances wherever hydration was under test): QA-1 call-site Bearer preserved; QA-2 code-less 409 pass-through; QA-3 bypass boundaries incl. lookalikes; QA-4 stale->invalid single retry; QA-5 401 after repair clears once; QA-6 parallel first calls -> 1 tab; QA-7 reset/in-flight race; QA-8 `enter()` without a handle; QA-9 five hostile storage payloads; QA-10 `headers()` empty and side-effect-free.

## 7. Style contract - PASS

No literal colour, palette family, `dark:` variant or inline colour `style` appears on any **added** line of the 28 touched files (0 findings); base-vs-HEAD literal-colour counts are identical per file (0 deltas). The two known exemptions (print block, `translate-*` substring) are outside the added lines and were not touched. No class/RTL/JSX change was possible by construction - the line-pair equality proof in section 3 leaves no room for one.

---

## Findings

| ID | Sev | Finding |
|---|---|---|
| **F1** | **LOW** | `reset()` does not cancel an in-flight `createTab()`: the late reply re-`adopt()`s a handle after logout (proved by QA-7). Impact is bounded and self-healing - the handle is bound server-side to the revoked `session_id`/`user_id`, so it can only draw one `409 workspace.invalid` that the repair path absorbs, and both `login()` and `logout()` reset again. No cross-session exposure. Suggest an epoch guard in a later unit. |
| **F2** | **LOW (latent, U3-B)** | `enter()` / `exit()` cannot adopt the server envelope when module memory holds no handle, because the transition envelope carries no `tabHandle` (`workspace.ts` L19-21): `transition()` then throws `workspace.transition_failed` with `status:200` although the server succeeded (proved by QA-8). No consumer exists today (`enter`/`exit` are exported but unused) and the provider guarantees a handle first; U3-B must call `enter()` only after `ensureTab()` resolved. |
| **F3** | **LOW** | `repair()` drops the handle whenever `refresh()` fails for a non-409 reason (network/500) and creates a fresh tab. Each such cycle consumes one `TAB_LIMIT` slot (20 per session, `capabilities.ts:17`); at the limit the tab endpoint answers 429, `ensureTab` then marks the session unavailable and GE calls travel without headers until re-login. Unlikely (rows are only created by this path, and reloads reuse the sessionStorage handle) but worth recording. |
| **F4** | INFO | Contract 2(b) says "ensure one **for GE-authenticated** requests"; `api.ts` has no role knowledge and calls `ensureTab()` for **every** authenticated request. For C/E sessions this costs exactly one `403 workspace.forbidden` probe per browser tab, after which `unavailable` suppresses repetition and no header is ever attached. Behaviourally correct and documented in-file; noted only because it differs from the literal wording. |
| **F5** | INFO | `reset()`'s doc comment says "server revokes it"; `workspace.ts` exposes no revoke endpoint, so the row survives until idle/session expiry. Comment inaccuracy only. |
| **F6** | INFO | The docs commit added 2 control paths (contract copy + evidence PNG). Evidence only, no code; strictly outside the contract's allowed write targets (recorded, not a code defect). |
| **F7** | INFO | The `b17TransactionInventory` executor-scope guard reads `git diff HEAD` + untracked files, so it is vacuous once the executor has committed. This report substitutes an independent scope proof (`f46456c..HEAD`: 28 src paths, all inside the allowlist). |

---

## Verdict

**PASS** - items 1-7 verified by executed and static evidence; **0 FAIL**, **0 High/Medium** findings; 3 LOW + 4 INFO.

**NOT VERIFIED (explicitly outside my scope): the live acceptance clause** - "Settings services list shows the real catalogue; `workspace.invalid` disappears from normal flows" on the shared DB. The shared DB was declared OFF-LIMITS for this session, so that clause must be closed by Tera's live proof; the executor's screenshot and claim are Context only.

## QA Signature
QA & Acceptance Agent (Execution Mode) - 2026-11-16 - report written via `node:fs` to `project-control/qa-reports/TASK-PROTO-U3A-QA.md`; scratch in `%TEMP%\opencode\u3a-qa\*`. Repository left clean apart from this report (`git status` = one untracked report file).