# TASK-PROTO-H12 — Shield defensive fix review (D-H01-01: tenant theme from server)

- Task: `TASK-PROTO-H12` · Agent: security-agent (الدرع) · Mode: Fix Review / Preventive Review · Date: 2026-11-16 · **Session NEW**.
- Base: `4e13a82` (HEAD == base at review time; no commits made). ClientAppPath: `D:\Teranoo Work\Client01\prototype-app`.
- **Static only.** No tests, no DB, no browser, no network, no installs, no `.env`/secret/log reads, no subagents, no commit/push. No final gate decision (that is the Auditor); no live-shared-DB access (`127.0.0.1:55432` untouched).
- Sole write: this file. Parent `security-reports/` verified present; target verified absent before write; written via the task-authorised Node `node:fs` fallback. No source/test/control/audit writes.
- QA owns `project-control/qa-reports/TASK-PROTO-H12-QA.md` concurrently — disjoint, not read, not evidence here.
- Inputs read: `project-control/tasks/TASK-PROTO-H12/TASK-PROTO-H12.md`, `project-control/STYLE_CONTRACT.md`, `project-control/PROJECT_STATE.md`, plus the actual diff (`git diff 4e13a82`), route/matrix/auth/session/scope/db source, and both disclosed pin edits.
- فهمي: الثيم صار خاصية مستأجر يضبطها GE فقط عبر PATCH موجود، ويُبَث في الجلسة ويُعرض فقط. راجعتُ الثقة الحدودية (لا مُدخل طلب يصل إلى `identity.theme`)، سلطة الكتابة (P فقط + RLS مقيّد بالهدف)، وشكل الحمولة (لا بيانات إضافية غير العرض). لا مرتفع/حرج.

## 1. Diff-first discovery (independent)

- `git status --porcelain`: **10 modified + 2 untracked** = ratified set only. Modified: `src/App.tsx`, `src/context/AuthContext.tsx`, `src/context/ThemeContext.tsx`, `src/db/b17Readiness.ts`, `src/db/schema.sql`, `src/lib/b17TransactionInventory.test.ts`, `src/main.tsx`, `src/server/auth.ts`, `src/server/routes/adminClients.ts`, `src/server/routes/session.ts`. Untracked: `src/lib/themeSession.test.ts` (new test) + `project-control/tasks/TASK-PROTO-H12/TASK-PROTO-H12.md` (Tera-owned input). `git diff --stat`: 114 insertions / 45 deletions.
- **Forbidden surfaces empty-diff (verified):** `src/db/b17.sql`, `src/db/b17-content.sql`, `b17ContentMigration`, `access.ts`, `accessRegistry.ts`, `capabilities.ts`, `scope.ts`, `initiativeScope.ts`, `routes.ts`, `routes/admin.ts`, `_shared.ts`, `routes/adminCommon.ts`, every view/component, `src/styles/*`, `server.ts`, `vite.config.ts`, `package.json`/lockfiles, `.env`/`.env.example`, `scripts/*`.
- Allowlist arithmetic independently counted: `allowed` set = **exactly 54 entries**, matching `b17TransactionInventory.test.ts:175`. The 11 changed/untracked paths (task md excluded) are all members.

## 2. Review points — verified closures (static)

### 2.1 `auth.ts` tenant SELECT + `identity.user.theme` — SOUND
- Enum/single source + NULL-safe normalizer: `auth.ts:14-21` (`TENANT_THEMES=['ge','lime','dark']`, `normalizeTenantTheme` returns `'ge'` for any non-member incl. `null`/wrong-case/non-string; `includes` = SameValueZero, no coercion → cannot crash or spoof).
- Default before any tenant read: `auth.ts:115` `theme:'ge'`; overwritten only by the tenant row: `auth.ts:120-126` `SELECT name,suspended,theme ... FOR SHARE` then `identity.user.theme = normalizeTenantTheme(tenant.theme)`.
- **No request input reaches `identity.theme`**: the only assignment sources are the literal default and the DB column; no `req.body/query/headers` on this path (`auth.ts:95-139`).
- **RLS authority unchanged**: the SELECT runs after the pre-existing `setTenantContext(identityContext(identity,'auth.session'))` (`auth.ts:119`), same purpose/tenant/user as base; only a column was added to the projection. `b17_clients_read` row predicate is column-agnostic (`b17.sql:97-101`). No extra tenant fields: payload delta is `theme` only (`auth.ts:113-126`).
- JWT unaffected: `generateToken` signs `{id,sid,exp}` only (`auth.ts:57-60`) — theme is not token-resident, so a theme change takes effect via `/auth/me` without re-issuing credentials.

### 2.2 `session.ts` login / `/auth/me` — SOUND
- Login payload: `user` spread gains `theme` only (`session.ts:25-26,33-34,45`); no PII/operational flags added. `theme` starts `'ge'` and is set from the tenant row (`session.ts:30-34`).
- **Suspended path unchanged (byte-level)**: `if (tenant.suspended && user.role !== 'ge_admin') return { suspended:true }` (`session.ts:32`) executes **before** any theme assignment, and the caller returns `suspendedLoginBody()` with no user object (`session.ts:47`) — base ordering preserved (verified against `git show 4e13a82:src/server/routes/session.ts`).
- `/auth/me` shape untouched apart from identity inheritance: `{...identity.user, mustChangePassword, suspended}` (`session.ts:64-66`).
- `ge_admin` without a tenant keeps `'ge'` (`session.ts:26`, never enters the client branch).

### 2.3 `adminClients.ts` PATCH theme — SOUND (P-only, bounded, audited)
- **Enum validation before SQL**: `adminClients.ts:298-306` runs a typeof+membership check and returns `400 {code:'theme.invalid'}` **before** `domainTransaction` (`:308`); no SQL/transaction on an invalid value.
- **P-only by matrix, no bypass**: matrix row is `P#...` only (`accessRegistry.ts:161`); `assertRouteContext` refuses every other derived context with 403 `workspace.mode_mismatch` (`access.ts:110-119`, applied at `access.ts:156` and again inside the transaction `initiativeScope.ts:42/53`). Consultant GE (`W`), client (`C`), employee (`E`) cannot reach the handler. Route mounts `authMiddleware + requireFreshPassword + requireDomainAccess` (`routes/admin.ts:55`).
- **Target authority**: `platformTarget(req.params.id)` UUID-validates before SQL (`adminCommon.ts:27-29`, `scope.ts:7-13`); context is `platformConfigContext(live,target)` (`adminClients.ts:327`, `_shared.ts:78-83`); the UPDATE is additionally pinned row-wise by RLS `b17_admin_clients_update` `USING/WITH CHECK (id::text = b17_setting('target_id'))` (`b17-content.sql:946-950`) — the row cannot be any tenant other than the explicit target, and non-P modes are refused long before. Cross-tenant writes by C/W/E are impossible by construction; P's global reach is the owner decision (أ).
- **No mass assignment**: only `name`, `suspended`, `industry`, `theme` are read, each with its own shape check, each bound as a `$n` parameter; all other body keys are ignored (`adminClients.ts:281-306`). `sets` contains only fixed literals (no interpolation of values) — no injection surface. Invalid theme + other valid keys → single 400, no partial update.
- **Audit attribution is the real actor**: `req.access!.actorId` (`adminClients.ts:319`), which is re-derived inside the transaction from the live session (`initiativeScope.ts:39-42`), not from any pre-lock/request value. Payload records the **stored** `row.theme`, and only when the field was supplied (`:324`).
- No other writer of `clients.theme`: the only `UPDATE clients` in the server is this handler; `INSERT INTO clients` (`:182`, `system.ts:44`) omits the column and inherits the `'ge'` default.

### 2.4 `schema.sql` — additive only
- Appended block `schema.sql:1271-1284` uses the existing `IF NOT EXISTS` DO-block idiom (same as `departments.head_user_id` precedent `:1265-1269`): `ALTER TABLE clients ADD COLUMN theme TEXT NOT NULL DEFAULT 'ge';`.
- No `CHECK` constraint (business rule deliberately in the handler; test pins absence), no policy/ACL/role change, no column-level grants anywhere (schema has zero `GRANT` statements; policies are row-level only `schema.sql:288-294`). `b17.sql`/`b17-content.sql` untouched, so the definer/ACL surface is unchanged.
- Legacy/NULL reads are normalised at the session layer, so an out-of-band stored value degrades to `'ge'` instead of failing a row.

### 2.5 Frontend — no attacker-controlled theme path
- `?theme=` logic fully removed: independent grep of `src/`, `public/`, `index.html`, `server.ts`, `vite.config.ts` → **zero** `?theme=` / preview-constant references; only the new server-side `TENANT_THEMES` remains.
- `data-theme` value is a constrained ternary: `stored === 'lime' || stored === 'dark' ? stored : 'ge'` (`ThemeContext.tsx:18-19`), applied via `setAttribute` (`:25-27`) — fixed literals only; even a hostile server value cannot inject markup/attribute content, and unknown values fail closed to `'ge'`.
- No persistence/fetch/token handling introduced in `ThemeContext.tsx` (no `localStorage`, `fetch`, `URLSearchParams`, `window.location`; pinned by the new test). Auth token handling is unchanged (`AuthContext.tsx` is a **type-only** diff, `:12-14`).
- Provider order: `AuthProvider` outer, `ThemeProvider` inner (`main.tsx:7-15`); `App` no longer re-mounts either (`App.tsx:289-296`). All auth guards still evaluate inside `AuthProvider` (`App.tsx:28` `useAuth()`; loading/`!user`/suspended/must-change short-circuits `:112-133`), and `AuthProvider` renders children unconditionally before/after `/auth/me` resolves — guard evaluation order is unchanged; `ThemeProvider` only mirrors state (`useAuth` is legal because Auth is above it).

### 2.6 Secrets / dependencies / pins
- No secret material in the diff (grep for secret/password/token/key patterns returns only existing identifiers and comments). No dependency or lockfile change. No `.env` touched or read.
- The two disclosed pin edits were inspected (see §4).

## 3. Findings

| ID | Sev | Title | Evidence | Impact | Suggested fix | Closure |
|---|---|---|---|---|---|---|
| SHIELD-H12-01 | **Low** | `auth.ts` permanently removed from the byte-frozen inventory pin | `b17TransactionInventory.test.ts:99-107` (auth.ts deleted from the git-show byte-compare list) | Defense-in-depth pin lost for JWT secret handling, session issuance/verification and cookie-adjacent logic that H12 did **not** need to change. Disclosed and justified; not a live weakness. New pin is narrow (4 regexes, `themeSession.test.ts:43-48`). | Re-freeze `auth.ts` at the post-H12 bytes in a follow-up (or add a scoped pin for `getJwtSecret`/`sign`/`verify`) so future drift is caught again. | **Open — accepted residual** (Tera decides) |
| SHIELD-H12-02 | **Low** | Changed-set guard not extended to H12 reviewer artifacts → false-red risk | `b17TransactionInventory.test.ts:167-176`: `reviewerReports` is only the two B17-U2G paths; `controlInputs` adds only the task md. `git ls-files --others` includes `project-control/qa-reports/TASK-PROTO-H12-QA.md` and this `security-reports/TASK-PROTO-H12-fix-review.md` once they exist → "Unapproved write". | Gate brittleness / pressure to widen the allowlist later. No security bypass (guard still fails closed). | Add those **exact** paths to the exclusion sets (no globs), or document that `npm test` runs before reviewer artifacts land. Tera owns the guard text. | **Open — gap to Tera** |
| SHIELD-H12-03 | Info | PATCH response/audit echo the raw stored theme (not the normalised one) | `adminClients.ts:312` `RETURNING ... theme`, `:324` payload `row.theme` vs normalisation only on read (`auth.ts:124`) | None today: this endpoint only ever stores enum members; a legacy/direct-DB value would simply be echoed verbatim to P (display-only field, no authz input). | Optional: normalise `row.theme` in the response for symmetry. | Accepted (no action) |
| SHIELD-H12-04 | Info | Client duplicates the theme enum literal instead of a shared type | `AuthContext.tsx:14`, `ThemeContext.tsx:4,19` | If the server enum ever grows, the client silently falls back to `'ge'` (fail-closed display default). No token/permission implication. | Keep as-is, or document the enum in STYLE_CONTRACT/THEME_TOKENS when it grows. | Accepted (no action) |

Pre-existing, **out of H12 scope** (noted, not introduced): the auth token lives in `localStorage` (`AuthContext.tsx:30,69`) — an XSS-exposure pattern that predates this task and is unchanged by it.

## 4. The two disclosed pin edits — inspected

1. **`src/lib/b17TransactionInventory.test.ts`** — (a) `auth.ts` leaves the byte-identical list (see H12-01); (b) `b17Readiness.ts` comparison normalises **only** the three `export const …_SHAPE = '…';` lines and still requires every other code line byte-identical to base `048a6f25` (`:108-120`) — a logic edit still fails, and `B17_VERSION`/`SANCTIONED_DEFINER_FUNCTIONS`/`STRUCTURE_SQL`/`CONTENT_AUTHORITY_SQL` are **not** normalised; (c) allowlist 48→54 (count independently verified = 54, §1); (d) `controlInputs` excludes exactly one Tera-owned path. Bounded and disclosed. Residuals: H12-01, H12-02.
2. **`src/db/b17Readiness.ts`** — the three constants (`PREDECESSOR_SHAPE`, `B17_SHAPE`, `B17_CONTENT_SHAPE`, `:12-13,57`) plus comments. Within the ratified target ("constant + comment only"). Moving all three is structurally correct, because `STRUCTURE_SQL` fingerprints **every** public column at all three stages (`:90-109`), and `schema.sql` is the pre-U1 shape. **Values are unverified statically** (§5).

## 5. Static vs Unverified — honest bounds

Verified statically: diff scope/allowlist membership; ownership and matrix authority of the theme read and write; validation-before-SQL; audit attribution; parameterisation; RLS policy text and target binding; schema additivity; absence of other writers; frontend control-flow and the absence of any request-driven theme path; absence of secrets/dependency changes.

**Unverified (cannot be, in this session):**
- The three fingerprint constants vs a fresh PG18 scratch and the live ledger step (§4 of the task) — values are taken on trust from the executor; a wrong value fails **closed** (`b17.predecessor_drift` / `b17.schema_drift` → app refuses), i.e. availability, not a bypass. Tera/QA must confirm.
- `lint` / `npm test` / `build`, Semgrep/gitleaks, and the new `themeSession.test.ts` actually passing.
- Runtime behaviour: login/`/auth/me` really carrying the theme; theme switching on login/logout/refresh; the three themes rendering for the right roles; cross-tenant PATCH attempts returning 403 (verified statically via matrix + policy only).
- RLS enforcement at runtime and `/auth/me` behaviour for suspended tenants (the early return is verified in source only).
- `dist/` bundle state (build artifact; not part of the security surface reviewed).

## 6. Gaps / decisions needed from Tera

1. SHIELD-H12-02: extend the reviewer-artifact exclusions by exact path (QA + Shield H12 reports) or fix the ordering of `npm test`; do not widen to globs.
2. SHIELD-H12-01: schedule the `auth.ts` re-freeze so the inventory pin regains its pre-H12 coverage.
3. Confirm the three shape constants on fresh scratch + live ledger (§4) before the shared DB boots — the only blocking-availability item in this review.
4. Note for the style gate: `STYLE_CONTRACT.md` §5 asks "±0 lines" per migrated screen; `App.tsx` changes 4 lines for the task-authorised provider move (`TASK-PROTO-H12` §3). That is Tera's acceptance call, not a security finding.

## 7. Handback

```text
Task ID: TASK-PROTO-H12
Agent: security-agent (الدرع)
Mode: Fix Review / Preventive Review (static)
Status: Done (no blocker; 2 Low open to Tera, 2 Info accepted)
Findings: 4 (High 0 · Medium 0 · Low 2 · Info 2) · Unverified items: 6 (listed §5)
Artifacts: security-reports/TASK-PROTO-H12-fix-review.md
Evidence: auth.ts:14-21,113-126 · session.ts:25-35,45,62-66 · adminClients.ts:281-327 · access.ts:110-119,156 · accessRegistry.ts:161 · initiativeScope.ts:20-62 · b17-content.sql:946-950 · schema.sql:1271-1284 · ThemeContext.tsx:18-27 · main.tsx:7-15 · App.tsx:28,112-133,289-296 · b17TransactionInventory.test.ts:99-120,155-176
Unverified: shape constants vs fresh scratch/live ledger · lint/test/build scanners · runtime theme switching & session payload · runtime RLS · cross-tenant 403 (static only)
Decisions Needed from Tera: reviewer-artifact exclusions (H12-02) · auth.ts re-freeze (H12-01) · constant measurement confirmation
```