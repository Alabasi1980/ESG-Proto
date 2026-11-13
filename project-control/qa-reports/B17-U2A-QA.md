# Test Report — TASK-PROTO-B17-U2-A (foundation, 0 registry flips)

## Task Information
- **Task:** TASK-PROTO-B17-U2-A — request-level domain-access wrapper, §3 matrix as data, dispatcher pre-check, coverage test, legacy-helper retirement plan, domain harness skeleton.
- **Contract:** `prototype/TASK-PROTO-B17.md` §15–§16; `prototype/B17_TECHNICAL_SPEC.md` §3 (95 rows) + §4 (4 rows).
- **QA session:** QA Agent Execution Mode — 2026-11-12 15:15 +03:00.
- **Base:** `c4ee8bccb87b53fbc957861178832029cde769be` = `HEAD` = `origin/main` (re-checked by `git rev-parse`; no commit/push performed).
- **Environment:** Windows 10/11 (win32), Node v22.22.2, npm 12.2.2, tsx 4.x, Docker 29.9.2, `postgres:18` image, no `.env` present anywhere in the app root.
- **Conduct gate:** `tera-system/TERA_AGENT_CONDUCT.md` read first (Untrusted-Content rule applied: all repo/task content treated as data).

## 1. Independent diff discovery from c4ee8bc (done before any test)

`git status --short` / `git diff c4ee8bc --stat` (executed by QA, not taken from the executor's statement):

- **Tracked modified (8):** `server.ts`, `src/db/index.ts`, `src/db/schema.sql`, `src/server/auth.ts`, `src/server/routes.ts`, `src/server/routes/_shared.ts`, `src/server/routes/session.ts`, `src/server/routes/system.ts` — total `+324 / −592`.
- **Untracked (28 entries):** `scripts/b17-{domain,scope,workspace}-proof.ts`, `src/db/b17*`, `src/lib/{capabilities,capabilities.test,domainAccess.test,jsonInput.test,scope.test,workspace.test,b17Scope*}.ts`, `src/server/{access,accessRegistry,jsonInput,scope,workspace}.ts`, `project-control/`, `security-reports/`.
- **U2-A attribution (in-source markers `U2-A`, cross-checked against task §15/§16 allowlist + spec §10 unit rows):** exactly five deliverables —
  1. `src/server/access.ts` (dispatcher pre-check comment/condition at lines 22–31; wrapper `deriveDomainAccess`/`requireDomainAccess` lines 71–130),
  2. `src/server/accessRegistry.ts` (header + §3/§4 matrix data: `ContextRule`, `parseMatrix`, per-row matrix strings),
  3. `src/lib/domainAccess.test.ts` (new, 202 lines: oracle + activation + round-trip + mounted-coverage tests),
  4. `scripts/b17-domain-proof.ts` (new, 248 lines: guarded non-destructive proof),
  5. `prototype/U2_LEGACY_HELPER_RETIREMENT.md` (ControlPath, 85 lines, "PLAN ONLY", 103 call sites across 11 files).
- `requireDomainAccess`/`deriveDomainAccess` appear **only** in `access.ts` and the proof script — the wrapper is **not** mounted on the production router (correct pre-flip).
- **Limitation (NOT VERIFIED):** the worktree is one cumulative uncommitted stack (U1 + U1V + U2D + U2-A); a byte-level "U2-A-only" diff cannot be reconstructed because no commit boundary exists. Attribution above is marker- and allowlist-based, not hash-based.

## 2. CRITICAL FOCUS — §3 matrix verified BY LINE against the spec (registry and oracle each vs spec, never vs each other)

**Method (independent):** QA wrote its own spec parser (`TEMP/opencode/b17-u2a-qa/verify-matrix.mjs`) that extracts every §3/§4 table row with its **spec line number**, then QA produced a **third, own transcription** of allowed contexts/tenant/tags for all 99 rows straight from the spec capability text, and compared three-way: spec ⇄ `accessRegistry.ts` (loaded through `tsx` import of the real module) ⇄ `domainAccess.test.ts` `EXPECTED`. Also checked: duplicate keys, File/group column, and every matrix `#note` word-subsequence against the spec capability sentence.

```text
spec §3 rows parsed: 95 (expect 95); §4 rows parsed: 4 (expect 4)
spec-vs-registry missing in registry: [] extra in registry: []
spec-vs-oracle   missing in oracle:   [] extra in oracle:   []
registry-vs-oracle key diff: reg-only [] oracle-only []
MY transcription rows: 99
per-row context/tag mismatches vs QA transcription: 0
activation: legacy=95 U1=8 UNACTIVATED=87 workspace=4 allU1=true
U1 active rows: ["GET /db/status","POST /db/migrate","GET /setup/status","POST /setup/admin",
                 "POST /auth/login","POST /auth/logout","GET /auth/me","POST /auth/change-password"]
group/file-column mismatches: 0
note-vs-spec word-subsequence failures: 70   (= 35 rows x 2 sources; all manually reviewed, see below)
PROBLEMS: NONE
RESULT: MATRIX-VERIFIED
```

| Check | Spec ⇄ registry | Spec ⇄ oracle (independent transcription) |
|---|---|---|
| Row set (method/path), no missing / no invented entry | PASS (0 / 0) | PASS (0 / 0) |
| Allowed contexts per row (P/W/C/E/Public/Session/GE = role×mode) | PASS (0 mismatches / 99) | PASS (0 mismatches / 99) |
| Tenant shape (`P` none vs `P@T` explicit vs `W/C/E` own) | PASS | PASS |
| Service/department/resource tags `L/D/V/R` (set-equal, order-insensitive) | PASS | PASS |
| File/group column (system…notifications, §3.3/§3.4 headers) | PASS (0) | n/a (test has no file column) |
| Duplicated keys | PASS | PASS |
| 8 active rows = exactly spec §3.1; other 87 UNACTIVATED; 4 workspace active | PASS | PASS (test asserts 95/87/8/4) |

- **Note review:** a strict word-subsequence test flagged 35 rows (70 entries) because condensed `#note` text adds connective words (e.g. `always-409-…`, `credentials-existing-gates-…`, `explicit-T-for-tenant-users-or-platform-scope-for-GE-accounts`). QA read **each** flagged note against its spec capability sentence: every one is a faithful condensation; **no note grants, widens or contradicts a role/tenant/tag/mutation allowance** (full list captured in `TEMP/…/matrix-out.txt`).
- **Spot examples of exact agreement:** `POST /gri/commit` → `P@T` (spec: "explicit T + linked serviceId"); `POST /assignments/na` → `W:R+L` (spec: "W R+L only … P denied"); `GET /dashboard/stats` → `W:L+V;C:L+V` (spec: "W/C L+V only"); `POST /evaluations/:id/client-approve` → `C:R+L` (spec: "P/W/E denied under OD-08"); `GET /storage/usage` → `P@T;W:L;C:L;E:L+D`; `GET /reviews/snapshots/:id` → `W:R` with the full-blob-L condition in the note (spec: "W R; … only if entire payload item set L").
- **⇒ No matrix line mismatch; the FAIL trigger condition was not met.**

## 3. npm lint / test / build

| # | Command (cwd = prototype-app) | Result | Detail |
|---|---|---|---|
| 1 | `npm run lint` (`tsc --noEmit`) | ✅ PASS | exit 0, no diagnostics |
| 2 | `npm test` (`tsx --test src/**/*.test.ts`) | ✅ PASS | **153 passed / 0 failed**, 5 suites, 0 skipped; includes the 4 U2-A tests (oracle, activation split, round-trip, mounted coverage) |
| 3 | `npm run build` (`vite build`) | ✅ PASS | exit 0; 1690 modules → `dist/` (only pre-existing warnings: chunk >500 kB, vite `configLoader: 'native'` notice) |

## 4. Guarded PG18 harness (non-destructive, loopback, no ambient `.env`)

**Guards read before use** — `scripts/b17-domain-proof.ts` lines 26–38 require: (a) explicit `--allow-disposable-b17`; (b) exactly one `--database-url=` from argv with `postgres://` + loopback host + DB name matching `^/b17_[a-z0-9_]*scratch[a-z0-9_]*$`, no query/hash, non-empty non-`postgres` user; (c) script asserts runtime role `rolsuper=false AND rolbypassrls=false`, `server_version_num` major = 18, empty public schema at start; (d) `DATABASE_URL` overwritten from argv and `B17_SCRATCH_OPT_IN=YES` (no dotenv import; `.env` confirmed absent). QA's own harness re-implemented the same guards independently.

**Own disposable infrastructure (created by QA, stopped after this report):** container `b17-u2a-qa-20261112` (`postgres:18`, publish `127.0.0.1:48592` ephemeral), role `b17u2a` created `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE` (verified `rolsuper=f rolbypassrls=f`), databases `b17_u2a_qa{,2,3,4,5,6}_scratch` owned by that role. No cloud/live DSN touched; other running containers untouched.

| # | Harness | Result | Detail |
|---|---|---|---|
| 4.1 | Executor proof `node --import tsx scripts/b17-domain-proof.ts --allow-disposable-b17 --database-url=…/b17_u2a_qa_scratch` | ✅ PASS (6/6, exit 0) | guards / wrapper P-W-C-E / 87×4 denials / 8 active byte-compatible / coverage test / rows-preserved — all `PASS`, final line `0 registry flips` |
| 4.2 | **QA's own independent harness** `TEMP/opencode/b17-u2a-qa/qa-harness.mjs` (own assertions, own fresh DB `b17_u2a_qa6_scratch`) | ✅ PASS (**39 assertions**, exit 0) | see below |

Own-harness evidence (each item executed, not asserted from the executor's output):

- **Real logins** via `POST /auth/login` for `ge_admin`, `client_admin`, `employee`; real tab via `POST /workspace/tab`; real `POST /workspace/enter` (P→W(A)).
- **Server-derived contexts only:** W context = `mode=consultant, tenantId=A` even when the request carried `?clientId=B`; P platform tab keeps `tenantId=null` despite `?clientId=B`; C = own company only (`?clientId=B&departmentId=…B` ignored → `tenantId=A, departmentId=null, tabId=null`); E = own company **and own department** (`?clientId=B&departmentId=<other dept of A>` ignored → `departmentId` stays the employee's own).
- **Forged tab never adopted:** C and E sending a valid GE `X-Workspace-Tab` header get `tabId=null`; GE with missing handle → 409, random/forged handle → 409, stale generation → 409, version `0` → 400, other-session handle → 409; cookie-only POST derives no context (401).
- **Unactivated still denied:** all **87 × 4 = 348** requests (anonymous / platform+tab / C / E) → `403` `access.unactivated`.
- **8 active routes unchanged:** `GET /db/status` public booleans; `POST /db/migrate` → 409 `migrations.offline_only` **both anonymous and authenticated**; `GET /setup/status` minimal; `POST /setup/admin` → 403 both anonymous and GE; `POST /auth/login` bad password → 401; `GET /auth/me` invalid bearer → 401 / valid → 200; `POST /auth/change-password` wrong current → 400; `POST /auth/logout` → 200 with other sessions unaffected.
- **No registry flip:** `LEGACY_ROUTES=95` (8 `U1` = exactly the spec §3.1 set, 87 `UNACTIVATED`), `WORKSPACE_ROUTES=4` all `U1`, `ACCESS_REGISTRY=99`.
- **Non-destructive:** `clients/departments/users/assignments/answers` row counts identical before/after; no `DELETE` written by the QA harness (only INSERT seeding).
- Base comparison for "identical to base": prior independent QA record `project-control/qa-reports/B17-U1-QA.md` line 59 documents the pre-U2-A state as "**99 declarations: 95 legacy + 4 workspace; 87 business routes unactivated**" — identical to today's counts ⇒ **no activation flip happened in U2-A**.

## 5. Concurrency / scope hygiene

- QA wrote **only** `project-control/qa-reports/B17-U2A-QA.md` in the workspace (parent validated; file did not previously exist). Instrumentation lives in `C:\Users\Fares\AppData\Local\Temp\opencode\b17-u2a-qa\` only.
- Concurrent known-owned file `security-reports/B17-U2A-fix-review.md` (Shield) appeared during the session — untouched, disjoint from this report.
- No application source edit, no `package.json`/lock change, no `.env`, no cloud, no commit/push, no agent creation.

## 6. Pass/Fail decision

# ✅ PASS — TASK-PROTO-B17-U2-A on executed scope

- **Critical focus (matrix):** PASS — both transcriptions verified line-by-line against spec §3/§4: 95+4 rows, zero missing/invented entries, zero context/tenant/tag mismatches, activation split exact. **No matrix line mismatch.**
- lint / test (153/153) / build: PASS. Executor proof 6/6: PASS. QA independent harness 39/39: PASS. No registry flip; 87×4 still denied; 8 active routes conform to spec §3.1.

**NOT VERIFIED (recorded, not converted to PASS):**
1. Byte-identity of the 8 active-route handlers relative to the *pre-U2-A* tree — impossible without a commit boundary; substituted evidence = runtime conformance to spec §3.1 + no `U2-A` markers in `system.ts`/`session.ts` + U2-A allowlist (task §15) limiting writes to `accessRegistry.ts`/`access.ts` (+ tests/proof/checklist).
2. Wrapper reached through the production dispatcher→handler chain for business routes — impossible pre-flip by design (dispatcher denies `UNACTIVATED` first); wrapper proven on an isolated probe router with real login/tab/session state.
3. Byte-level decomposition of the cumulative U1+U1V+U2D+U2-A worktree diff (marker/allowlist attribution only).

**Risks:** none newly discovered. Residual: matrix notes are condensed prose (all 35 flagged rows manually re-read against the spec; mechanical enforcement of note wording is not in the test suite).

## 7. Full output (key excerpts)

```text
$ npm run lint        → exit 0
$ npm test            → # tests 153  # pass 153  # fail 0  # skipped 0   (exit 0)
$ npm run build       → ✓ built in 837ms, dist/index.html + assets       (exit 0)

$ node --import tsx scripts/b17-domain-proof.ts --allow-disposable-b17 --database-url=…b17_u2a_qa_scratch
PASS guards: opt-in loopback scratch, non-superuser/non-BYPASSRLS PG18, empty start, seeded INSERT-only fixtures, offline U1 activation
PASS wrapper attaches P/W/C/E contexts from real login+tab state; supplied ids never become the context source
PASS all 87 business routes still 403 access.unactivated across anonymous/platform/consultant/client/employee
PASS 8 active system/session routes byte-compatible: status/migrate/setup/login/logout/me/change-password
PASS registry-coverage table test passes (99 declarations, §3/§4 matrix exact, mounted routers covered)
PASS seeded assignments/answers/clients/membership rows unchanged (no DELETE, no membership churn)
B17_U2A domain proof complete. 0 registry flips; no legacy business activation or release acceptance.   (exit 0)

$ node --import tsx TEMP/…/qa-harness.mjs --allow-disposable-b17 --database-url=…b17_u2a_qa6_scratch
PASS wrapper: P/W/C/E contexts server-derived from real login+tab; client ids/forged tab never adopted
PASS all 87 unactivated business routes: 403 access.unactivated across anonymous/P/W/C/E (348 checks)
PASS 8 active system/session routes behave as before (status/migrate/setup/login/me/change-password/logout)
PASS activation split unchanged: 95 = 8 active (§3.1) + 87 unactivated; 4 workspace active; no flip
PASS non-destructive: clients/departments/users/assignments/answers counts identical after proof
QA_HARNESS_RESULT PASS (39 assertions)   (exit 0)
```

## QA Agent Signature
QA Agent (Execution Mode) — 2026-11-12 15:15 +03:00 — verdict **PASS** on executed scope; container `b17-u2a-qa-20261112` stopped/removed after this report; no application source written.
