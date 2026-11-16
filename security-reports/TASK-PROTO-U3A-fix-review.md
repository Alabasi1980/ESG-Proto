# TASK-PROTO-U3-A - Fix Review (الدرع / The Shield)

- Task: TASK-PROTO-U3-A - workspace client layer + header plumbing + single stale-recovery retry
- Agent: security-agent (defensive) - Mode: Preventive/Fix Review, static, diff-first - Session NEW
- Base: `f46456c` -> HEAD `7cdcbfb` (`ce18aa6` feat + `7cdcbfb` docs); worktree clean
- Live DB / server / browser: OFF-LIMITS (Tera's). No execution, no installs, no subagents. Static only.
- Role bounds: I do not attack (red-team), do not write code, do not issue the gate decision (auditor).

> هذا مراجعة دفاعية — لا أصدر قرار البوابة النهائي (PASS/FAIL). القرار للقاضي (`security-auditor`).

## Summary
The core question - "can header plumbing leak across users/tabs, and can stale-recovery loop or re-auth silently?" - answers **no leak, no loop, no silent re-auth** on the reviewed surface. Server-side tab ownership is bound to `(handle_hash, session_id, user_id)` and every mint requires a fresh `ge_admin` session, so a client-side handle can never be re-pointed at another user. Two **Medium** findings are *not* leaks: (1) silent workspace-context reset from consultant back to platform on the `workspace.invalid` repair fallback; (2) the ratified-write guard is red on this round's own reviewer artefacts (same class as SHIELD-H13-01, process not runtime). Plus two Low (403/429 memoisation, unbounded mint cadence) and two Info.

## Findings

### MEDIUM - SHIELD-U3A-01: silent context reset W -> P on the `workspace.invalid` repair fallback
- Evidence: `src/lib/api.ts:109-116` (`repair`: `refresh()` -> else `resetWorkspace()` + `ensureTab()`), `src/lib/api.ts:130-134` (retry replays the same `init`), `src/lib/workspaceClient.ts:183-193` (`refresh` returns null on any `!res.ok`, including 409 `workspace.invalid`), `:225-235` (`reset` drops mode/client), `:125-148` (`createTab`), `src/server/workspace.ts:36-38` (mint = new row, `generation` 1, `mode` defaults to platform), `src/server/access.ts:51-53` (validated row), `src/server/routes/initiativeScope.ts:58,122-126` (W pins the tenant; P takes the explicit target).
- Fact (static): a 409 `workspace.invalid` means the tab row is gone (expired/revoked) and cannot be reconciled. `repair()` then mints a **new platform tab** and the original request is retried **successfully** under `mode='platform'`, while the session/UI still presents the consultant context. For any route that W-derives its tenant from the tab, the tenant pin (`scope.tenant_mismatch`, `scope.denied`) that would have refused a different target no longer applies; the audit record for the retried action is written with `mode='platform'` (`workspace.ts:48-58`, `initiativeScope.ts:43-47`).
- Impact: context/scope integrity + audit attribution, silently, with no user-visible signal (U3-A adds none; U3-B will). **Honest bound: not a privilege boundary crossing** - the actor is the same `ge_admin`, who may legitimately open P, and W-only routes still refuse with 403 `workspace.mode_mismatch` (`access.ts:110-119`). No cross-user or cross-role access.
- Suggested close (Tera/design, not mine): for a non-platform tab, do **not** silently re-mint on `workspace.invalid`; return the 409 and let the user re-enter the client (U3-B control). If keep, preserve the intent explicitly (re-`enter()` the same clientId and accept failure) rather than degrade to platform.
- Status: **OPEN (static, confirmed by code path; live behaviour is Tera's)**.

### MEDIUM - SHIELD-U3A-02: ratified-write guard is red on this round's reviewer artefacts (process, not runtime)
- Evidence: `src/lib/b17TransactionInventory.test.ts:231-239` (`reviewerReports` = B17-U2G/H12/H13 only), `:240-243` (`controlInputs` = H12/H13/U3 task contracts), `:244-248` (`changed` = tracked diff + `git ls-files --others --exclude-standard`; `assert.ok(allowed.has(file))`), `:205-208` (added exact paths), `:247` (`allowed.size` 64 -> 68).
- Fact (static): HEAD is clean, so `changed` will contain exactly the untracked reviewer artefacts. `project-control/qa-reports/TASK-PROTO-U3A-QA.md` (QA) and `security-reports/TASK-PROTO-U3A-fix-review.md` (this file) are in **none** of `allowed` / `reviewerReports` / `controlInputs` -> `Unapproved write: ...`. Same pattern SHIELD-H13-01 already recorded for H13.
- Impact: the acceptance criterion "full suite green" cannot hold while both reviewers have reported. No runtime/privilege impact. Secondary (pre-existing design, not introduced here): every U3-A file is committed, so the guard's `git diff HEAD` half is inert at HEAD.
- Suggested close: add the two U3-A report paths to `reviewerReports` by **exact string** (Tera owns test edits; QA owns its report; disjoint). Precedent: H13 round 2 did exactly this.
- Status: **OPEN (static, confirmed)**.

### LOW - SHIELD-U3A-03: any 403 other than password-change is memoised as "this session has no workspace" until re-login
- Evidence: `src/lib/workspaceClient.ts:134-139` (`if (code !== 'auth.password_change_required') unavailable = true`), `:143` (`401`/`429` also conclusive), `:162-170` (`ensureTab` short-circuits on `unavailable`), `:225-235` (`reset` is the only clear).
- Fact: the 403 branch is keyed on a single exception. Any other 403 - `origin.denied` (`access.ts:13-18`), `access.unactivated` (`access.ts:33`), `b17.*` readiness refusals, proxy/tenant-suspension 403s - is treated as permanent for the tab. Result: no tab, no workspace headers, and every later GE call degrades to `400 workspace.version_required` until logout/login. Same shape for `429` (`TAB_LIMIT`), i.e. up to the 30-min idle window after 20 leaked tabs.
- Impact: availability/confusing failure mode only; fail-closed (never grants). Suggested close: only `403 workspace.forbidden` should be conclusive.
- Status: **OPEN (static)**.

### LOW - SHIELD-U3A-04: tab minting has no rate limit; bound is TAB_LIMIT per session only
- Evidence: `src/server/workspace.ts:26-43` (mint: `ge_admin` + `assertFreshIdentity` + `count >= TAB_LIMIT` -> 429; no cadence/backoff), `src/lib/capabilities.ts:17-18` (`TAB_LIMIT=20`, `TAB_IDLE_MS=30min`), `src/lib/api.ts:109-116` (a client can reach a mint through `repair()`), `src/server/access.ts:34` (`assertSameOrigin`) + bearer requirement.
- Assessment (requested §3): **no path creates a tab without a GE session** - `createTab` needs a token (`workspaceClient.ts:126-127`), the server refuses non-`ge_admin` with 403 (`workspace.ts:30`), and C/E never reach a mint through AuthContext (`AuthContext.tsx:70,92`). Abuse is therefore self-scoped: a scripted GE session can mint at most 20 rows, each ≤30 min idle / session expiry. No privilege gain, no cross-tenant effect, bounded rows. Residual: no audit row for mint (only enter/exit are audited, `workspace.ts:54-58`), and a client can burn the session's own quota (self-DoS) before recovery.
- Suggested close (Tera scope decision): a mint-reason/audit row and/or a small per-session cadence limit, if B17 §4 intends one.
- Status: **INFO/LOW - accepted as bounded; open decision**.

### INFO - SHIELD-U3A-05: `ensureTab()` is probed for C/E from the transport
- Evidence: `src/lib/api.ts:76-82` (`ensureTab()` whenever a token exists and no tab header), `src/lib/workspaceClient.ts:134-139` (403 -> `unavailable`), `src/server/workspace.ts:30` (server refuses).
- Fact: contract §4 says "ensureTab not called for C/E"; AuthContext honours that (`AuthContext.tsx:70,92`), the transport cannot know the role and probes once per session. Server refuses with 403, no tab/headers are produced, no data is exposed (verified: `access.ts:148-154` ignores the header for non-GE). Spec-fidelity note only; consider a role hint or keeping as-is deliberately.

### INFO - SHIELD-U3A-06: bypass list is the only guard for non-business `/api` paths
- Evidence: `src/lib/api.ts:27-34` (`/api/auth/*`, `/api/workspace/*`, `/api/setup/*`, exact `/api/db/status`; anything not `/api/` bypassed), today's untouched call sites `src/views/SettingsView.tsx:285,307,341`, `src/views/SetupView.tsx:51`, `src/views/LoginView.tsx:32,41,57`, `src/views/ImportGRIView.tsx:117`.
- Fact: `/api/db/migrate` (infra, no session - `routes/_shared.ts:136-148`; always 409 `migrations.offline_only`) and `GET /api/gri/template` (P + auth-tab, `accessRegistry.ts:119`) are **not** in the bypass lists; no current `apiFetch` call site uses them, so nothing regresses. `ImportGRIView.tsx:117` is a browser navigation and can never carry the handle - it must **not** be "fixed" by putting the handle or token in a URL. Suggest adding both paths to `BYPASS_EXACT` deliberately in the next sweep.

## Verified clean (static, against the 7 requested areas)
1. **No cross-user / cross-tab leak.** Handle stored only in `sessionStorage` (`workspaceClient.ts:22,59-65,116-121`); module state is per page; `reset()` on logout and on login (`AuthContext.tsx:91,102`); no `localStorage` handle and no handle in any URL/log (grep of `src/**` for `X-Workspace|tabHandle|console.*`). Server binds ownership: `WHERE handle_hash=$1 AND session_id=$2 AND user_id=$3` (`access.ts:51-53`, `initiativeScope.ts:28-30`), so even a forged/copied client entry cannot address another user's tab. `Authorization` is set only when absent (`api.ts:70`), and workspace headers always override caller-supplied values (`api.ts:72-81`). Note (inherited, not U3-A): the **token** lives in `localStorage` (`AuthContext.tsx:32,87`) - pre-existing from earlier units, unchanged here.
2. **Stale recovery.** Exactly one reconcile + one retry, only for the two codes; a second 409 is returned (`api.ts:126-135`); 401 returns after one `clearAuth` and is never retried (`api.ts:122-125,134`); `repair()` cannot recurse into `apiFetch` (it calls `workspaceClient` directly). No loop: `send()` is called at most twice per `apiFetch`. No silent re-auth: `clearAuth` only clears (`api.ts:52-63`). Unit tests pin all five semantics (`api.test.ts:72-153`).
3. **Tab-limit abuse.** See SHIELD-U3A-04: bounded by `TAB_LIMIT=20` per session (`workspace.ts:32-34`), idle expiry `min(session.expiresAt, now+30min)` (`workspace.ts:36-38`, `access.ts:70-72`), `FOR UPDATE` tab lock preserved (`access.ts:51-53`), no mint without a GE session.
4. **AuthContext.** One clear path (`AuthContext.tsx:37-41`) reused by 401 (`:45-48`), `/auth/me` failure (`:72`) and logout (`:101`); `ensureTab` only for `ge_admin` (`:70,92`); login/logout semantics otherwise byte-equivalent (token set/removed, same state transitions, same `/api/auth/logout`). `resetWorkspace()` on both.
5. **Migration safety.** 21 views + `Sidebar.tsx:68` are line-local `fetch(` -> `apiFetch(` substitutions plus one import each; no JSX/class/logic/copy/state change (verified hunk by hunk). Public/auth/setup/db.status/change-password stay on raw `fetch` (list in INFO-06). No API path was rewritten; query strings preserved; no `/api/workspace` bare path is routed through `apiFetch`. Bypass is decided before any header work, and non-`/api/` + absolute URLs never receive session headers (`api.ts:30-34`, test `api.test.ts:168-177`).
6. **Guard edits judge.** `appTheme.test.ts:174-176` only tracks the transport rename (same request-shape assertion). `b17TransactionInventory.test.ts` adds **4 exact paths** (+118 word comment), no globs, no prefix matching, and increments the size pin 64 -> 68 in the same edit - access-control guards (`accessRegistry`, `capabilities`, RLS/policy pins, sha256 pins) are untouched. No weakening.
7. **No secrets/PII, no deps, no style drift.** New modules contain no literals beyond storage-key names; tests use fake `A...43` handles; `package.json`, `bun.lock`, `.env*`, `tsconfig`, `metadata.json`, `vite.config.ts`, `server.ts`, `src/server/**`, `src/db/**` all unchanged; no CSS/token file touched (diff name list = 2 new modules + 2 new tests + 2 test edits + 21 views + Sidebar + task md + 1 committed PNG).
8. **Replay safety of the retry.** A retried request only follows a **409 refusal** (not a 401, not success), and refusals are transactional rollbacks on the reviewed routes (`initiativeScope.ts:74-76`, `evaluations.ts:705-706`, `adminAssignments.ts:199-208`), so replaying a non-idempotent POST cannot double-apply. A `FormData` body is re-sendable; no call site uses a stream body.

## Unverified bounds (honest)
- I executed nothing: tests, typecheck, build, lint and the live proof (Settings catalogue, `workspace.invalid` gone) are QA/Tera's. I read the two new test files; their assertions match the code paths I traced.
- Real multi-tab isolation rests on the `sessionStorage` platform guarantee; the unit test simulates two stores. Browser "Duplicate tab" copies `sessionStorage` (shared handle, **same user + same session**) - server-side ownership makes that non-exploitable; the second tab recovers via 409 -> mint (bounded by TAB_LIMIT).
- Whether the 409-refusal-is-side-effect-free property holds on every mounted route is argued from transaction handling, not proven live.
- Live DB, RLS and readiness gates are out of scope here; nothing in this diff changes them.

## Decisions needed from Tera
1. SHIELD-U3A-01: accept silent P re-mint, or require "repair must not change mode/tenant" (return 409, re-enter via U3-B). This is the only item I would not wave through without a decision.
2. SHIELD-U3A-02: authorise the exact-string addition of `project-control/qa-reports/TASK-PROTO-U3A-QA.md` and `security-reports/TASK-PROTO-U3A-fix-review.md` to `reviewerReports` so the suite can be green with both reviewers reported.
3. SHIELD-U3A-03/04: whether the transient-403 memo and mint cadence belong in a U3 follow-up (not blockers).

## Handback
Task ID: TASK-PROTO-U3-A
Agent: security-agent
Mode: Fix Review / Preventive (static, diff-first)
Status: Done
Findings: 6 (High 0 - Medium 2 - Low 2 - Info 2)
Artifacts: security-reports/TASK-PROTO-U3A-fix-review.md
Evidence: api.ts:27-34,52-63,66-85,109-136 - workspaceClient.ts:19,22,59-65,86-148,162-193,225-235 - AuthContext.tsx:37-48,70,86-104 - access.ts:34,51-53,70-72,110-119,148-154 - workspace.ts:12,26-43,48-58 - initiativeScope.ts:28-47,58,122-126 - capabilities.ts:17-18 - Sidebar.tsx:68 - SettingsView.tsx:285,307,341 - ImportGRIView.tsx:117 - api.test.ts:59-188 - workspaceClient.test.ts:61-203 - b17TransactionInventory.test.ts:205-208,231-248 - appTheme.test.ts:174-176
Unverified: execution of tests/build/live proof (Tera/QA) - browser multi-tab guarantee - 409-refusal side-effect-freedom on all routes