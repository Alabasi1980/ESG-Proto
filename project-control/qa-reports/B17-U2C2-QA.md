# Test Report — TASK-PROTO-B17-U2-C2 (23 taxonomy+GRI retrofits + first flips, 74→51)

## Task Information
- **Task:** TASK-PROTO-B17-U2-C2 — round 3 of U2-C: retrofit + activate the 18 taxonomy and 5 GRI/dashboard
  declarations through `requireDomainAccess → readContext/platformConfigContext → scope/RLS → handler`,
  flip the registry 74→51, capabilities/retirement/tests, full E2E harness + QA/Shield.
- **Contract:** `prototype/TASK-PROTO-B17.md` §22/§23/§24 + `prototype/B17_TECHNICAL_SPEC.md` §3.2
  (23 rows, L/D/V/R, refusal codes) and §6 (visibility/dedupe). §24 C2 preconditions binding:
  server-set purpose/target only; taxonomy DELETE pre-checks under `platform.config` using the count
  helper; `GET /departments` stays P@T; fresh scratch DBs; full 23-flip E2E + QA/Shield.
- **QA session:** QA Agent (Execution Mode) — 2026-11-13 (session NEW QA).
- **Base:** `c4ee8bccb87b53fbc957861178832029cde769be` = `HEAD` = `origin/main` (re-checked before and
  after all runs; **no commit/push performed**).
- **Environment:** Windows (win32), Node v22.22.2, npm, Docker `postgres:18` (server 18.x, asserted
  `server_version_num` major 18 inside the harness), **no `.env`** (only `.env.example`) before,
  during and after every command.
- **Conduct gate:** `tera-system/TERA_AGENT_CONDUCT.md` read first; Untrusted-Content rule applied
  (all repo/task content treated as DATA, not instructions).
- **Authorisation used:** report-only write to **this file** (PowerShell writer, parent
  `project-control/qa-reports/` validated, file did not previously exist); QA-owned disposable
  instrumentation under `C:\Users\Fares\AppData\Local\Temp\opencode\b17-u2c2-qa\`; QA-owned Docker
  container. **No application source write, no `security-reports/*` write (disjoint), no cloud, no
  `.env`, no commit/push, no agent creation.**

---

## 1. Independent C2 diff discovery from c4ee8bc (before any test)

Executed by QA, not taken from any executor statement. The worktree is one cumulative uncommitted
stack (same limitation recorded in `B17-U2A-QA.md` §1 and `B17-U2C1-QA.md` §1), so a byte-level
"C2-only" git reconstruction is impossible by design. Substituted evidence — five independent
signals that agree:

### 1.1 git baseline (captured before any QA test, re-identical after all runs)

| Signal | Value |
|---|---|
| `git status --porcelain` | **40 entries** (15 tracked ` M` + 25 untracked) |
| `git diff --shortstat` | **15 files changed, 828 insertions(+), 944 deletions(-)** |
| `git rev-parse HEAD` / `origin/main` | `c4ee8bccb87b53fbc957861178832029cde769be` (both) |

C1 recorded **38 entries / 13 files +543/−777**; the delta is exactly **`taxonomy.ts` + `gri.ts`**
(both git-clean at C1) → tracked ` M` went 13→15, entries 38→40. Untracked count unchanged (25).

### 1.2 mtime window — the C2 delta

Boundary = the last verified pre-C2 artefact, `B17-U2C1-QA.md` (**13-11 02:27:58**). Scanning all
files under `prototype-app` (excluding `node_modules`, `.git`, `dist`, report dirs) for
`LastWriteTime > boundary` returns **exactly eight files, no more** — re-checked after every run:

| # | File | mtime | Expected by contract? |
|---|---|---|---|
| 1 | `src/server/routes/_shared.ts` | 13-11 02:40:15 | yes (platformConfigContext) |
| 2 | `src/server/routes/gri.ts` | 13-11 02:49:34 | yes (handler) |
| 3 | `src/server/accessRegistry.ts` | 13-11 02:50:09 | yes (flips) |
| 4 | `src/lib/capabilities.test.ts` | 13-11 02:50:43 | yes |
| 5 | `src/lib/domainAccess.test.ts` | 13-11 02:51:04 | yes |
| 6 | `scripts/b17-domain-proof.ts` | 13-11 03:12:46 | yes (1 of 2 proof scripts) |
| 7 | `scripts/b17-domain-c-proof.ts` | 13-11 03:14:25 | yes (2 of 2 proof scripts) |
| 8 | `src/server/taxonomy.ts` | 13-11 03:17:49 | yes (handler) |

ControlPath (`prototype/`): only `U2_LEGACY_HELPER_RETIREMENT.md` (02:52:11, expected) and
`TASK-PROTO-B17.md` (02:32:03 — Tera's own §24 contract update, not an app-source write).
The next-newest app file is `B17-U2C1-QA.md` itself. **No ninth file was written in the C2 window**,
and the same scan after all QA runs still returns these eight (QA wrote no source).

### 1.3 In-source markers

Scanned `.ts/.tsx/.sql/.json/.md/.html/.css` (report dirs excluded):

| Marker | Files |
|---|---|
| `U2-C2` | `scripts/b17-domain-proof.ts`, `src/server/routes/gri.ts` — only |
| `platformConfigContext` | `routes/_shared.ts` (definition), `taxonomy.ts`, `routes/gri.ts`, `b17-domain-proof.ts` — only |
| `domain-c` / `b17-domain-c` | `scripts/b17-domain-c-proof.ts` — only |

**None** of these markers occur in `b17-content.sql`, `b17Readiness.ts`, `b17.sql`,
`b17ContentMigration.ts`, `access.ts`, `scope.ts`, `capabilities.ts`, `workspace.ts`, `auth.ts`,
`routes/{session,system,actions,audit,notifications,storage,evaluations,initiatives,reports,admin}.ts`,
`routes.ts`, `index.ts`, `schema.sql`, `server.ts`, any UI file, `package.json` or `bun.lock`.

### 1.4 Recorded-hash manifest (`B17-U2D-QA.md` Appendix C, 111 files, recomputed by QA)

- **93 / 111 UNCHANGED**, **18 changed**, **0 missing** (C1: 95 unchanged / 16 changed).
- Of the 18: **13 last written before the C2 boundary** (11-11 21:53 .. 13-11 01:05 — U1/U2D/U2-B/
  U2-B0/U2-B/U2-C1 rounds): `routeGates.test.ts`, `routes/_shared.ts`,
  `routes/{actions,audit,notifications,storage}.ts`, `scripts/b17-{scope,workspace}-proof.ts`,
  `src/lib/b17ScopeProof.test.ts`, `src/lib/capabilities{,.test}.ts`,
  `src/server/{access,accessRegistry,scope}.ts`, **`src/db/b17-content.sql` + `src/db/b17Readiness.ts`
  (the C1 files — unchanged since C1)**;
- the remaining **5 changed IN the C2 window**: `_shared.ts`, `gri.ts`, `taxonomy.ts`,
  `capabilities.test.ts`, `accessRegistry.ts` — of which **`taxonomy.ts` and `gri.ts` are newly
  changed** (both were byte-identical to Appendix C at C1: `F4D56FA299BF` / `AC5BC26E09AA`).

### 1.5 Emphasis list (task requirement: NOTHING else changed)

| Emphasis item | Evidence |
|---|---|
| `src/server/taxonomy.ts` | mtime in C2 window, hash **72A504164F8F** — changed, as expected |
| `src/server/routes/gri.ts` | mtime in C2 window, hash **E6D5429052A6** — changed, as expected |
| other handlers (`evaluations`, `initiatives`, `reports`, `admin`) | git-clean vs `c4ee8bc`, not in window |
| handlers outside the 2 that are tracked (`actions/audit/notifications/storage/session/system`) | differ from Appendix C only from pre-C2 rounds; mtimes 12-11 20:59–21:10, no C2 marker |
| `src/server/access.ts` / `src/lib/scope.ts` | **UNCHANGED vs Appendix C** (`6B15A2632E6A` / `86C3AEAC2060`), mtimes 12-11 (pre-C2) |
| `src/server/accessRegistry.ts` / `_shared.ts` / `capabilities.test.ts` | changed in C2 window — **expected** (flips + purpose binding + tests) |
| `src/lib/capabilities.ts` | **UNCHANGED vs Appendix C** (`EB5EA731BD36`, mtime 12-11 21:05) — truthful caps are registry-derived |
| **`src/db/b17-content.sql` / `src/db/b17Readiness.ts`** | **UNTOUCHED this round** — `C348C82845DF` / `72B090688DE5`, mtimes **13-11 01:02:19 / 01:05:40** (= C1 values), no C2 marker; `B17_CONTENT_SHAPE` still `7a13a70382653f70f2733072f068ad00` (C1-recorded) |
| `src/db/b17.sql` | **UNCHANGED** — `ACE11265D876`, mtime 11-11 22:06 |
| `src/db/b17ContentMigration.ts` | **UNCHANGED** — `DDB940166912`, mtime 12-11 09:20 |
| workspace / session / auth / routes.ts / index / schema / server.ts | all UNCHANGED vs Appendix C, all mtimes pre-C2 |
| UI (`src/views`, `src/components`, `src/context`, `src/i18n`, `App.tsx`) | git-clean; **no `.tsx`/`.css` file newer than the boundary** |
| `package.json`, `bun.lock` | **UNCHANGED** — `339663502CD3` / `1F6CC073E594`, mtimes 11-10 |
| `prototype/U2_LEGACY_HELPER_RETIREMENT.md` | in window (02:52:11) — expected; contains the `U2-C2` `taxonomy.ts` + `routes/gri.ts` **DONE** rows |

**C2-window content of `_shared.ts` (observed):** `platformConfigContext` (server-selected purpose
`platform.config`, target only as a function argument, refuses non-P) plus its C2 comment, and the
`FRESH_GATE_ALLOWLIST` `POST /gri/preview` entry with its U2-C comment (auth+wrapper before multer,
no DB write). Byte-level decomposition of these lines against a C1 snapshot is impossible on the
cumulative stack — recorded as observed content, not as a git-proven line split.

**Result: the C2 diff is exactly the expected set (8 app files + retirement doc); no protected file
was touched.**

---

## 2. npm lint / test / no-env build

| # | Command (cwd = `prototype-app`) | Result | Detail |
|---|---|---|---|
| 1 | `npm run lint` (`tsc --noEmit`) | **PASS** | exit 0, no diagnostics (run before the harness AND after all runs) |
| 2 | `npm test` (`tsx --test src/**/*.test.ts`) | **PASS** | `# tests 164  # pass 164  # fail 0  # suites 5  # skipped 0`, exit 0 — **claimed 164 verified current twice** (pre-harness and post-all-runs) |
| 3 | `npm run build` (`vite build`) with **no `.env`** | **PASS** | exit 0; `ENV_PRESENT=FALSE` before, `ENV_AFTER=FALSE`; only the pre-existing >500 kB chunk warning |

The C2 tests are inside the 164: `U2-C activation split: 51 business routes UNACTIVATED, 44 legacy
(8 system/session + 13 U2-B + 23 U2-C flips) + 4 workspace active` (domainAccess.test.ts) and
`B17 exact route inventory: … 51 business routes still unactivated` (capabilities.test.ts) — both ok.

---

## 3. Repository proof scripts (guards read before use)

`scripts/b17-domain-c-proof.ts` **guards read in full before any execution** (task requirement):
explicit `--allow-disposable-b17`; exactly one `--database-url=` from argv only (ambient ignored);
protocol `postgres:`; host in {127.0.0.1, localhost, [::1]}; path `^/b17_[a-z0-9_]*scratch[a-z0-9_]*$`;
no query/hash; owner non-empty and != `postgres`; synthetic `JWT_SECRET`; `B17_SCRATCH_OPT_IN=YES`;
non-superuser/non-BYPASSRLS asserted; PG18 asserted; empty `public` schema asserted; header states
the non-destructive contract (seed-only, every probe in an always-rolled-back transaction). QA
re-implemented the same guards independently in its own harness (plus an explicit ambient
`DATABASE_URL`-absent assertion and a loopback superuser `--oracle-url=`).

| Proof | Fresh scratch DB | Result |
|---|---|---|
| `scripts/b17-workspace-proof.ts` | `b17_u2c2_qa_ws_scratch` (recreated) | **PASS, exit 0** — incl. `PASS all 51 remaining unactivated business declarations denied across anonymous/platform/consultant/client/employee` (count computed dynamically from the registry) |
| `scripts/b17-domain-proof.ts` | `b17_u2c2_qa_dom_scratch` | **PASS, exit 0** — `PASS U2-C2 E2E: all 23 taxonomy/GRI routes exercised end-to-end — every §3 allowed context served, every disallowed context refused with its status/code`; `36 routes flipped (87 -> 51 UNACTIVATED: 13 U2-B + 23 U2-C)`; I5/I6/I7 (commit/dashboard/zero-link) green |
| `scripts/b17-scope-proof.ts` | — | **EXCLUDED by contract §15** — still contains `DELETE FROM assignments` (line 135, re-confirmed); §15 forbids using it. Scope behaviour covered by the 164 unit tests (`scope.test`, `b17Scope*`, `b17DomainPolicies`) + QA's own RLS probes (same disposition as `B17-U2C1-QA.md` S1) |
| `scripts/b17-domain-c-proof.ts` (executor's C1 probe) | `b17_u2c2_qa_cproof_scratch` | **PASS, exit 0** (cross-check only, not adopted as QA evidence) — `U2-C1 SUBSTRATE PROOF COMPLETE (re-run post-C2): R1-R9 green, exactly 23 taxonomy/gri flips, catalog/P context negatives held` |

---

## 4. QA's OWN guarded non-destructive PG18 harness

**File:** `C:\Users\Fares\AppData\Local\Temp\opencode\b17-u2c2-qa\qa-harness.mts` — **QA-written,
independent assertions; not the executor's script.** Every expectation was re-derived by QA from
spec §3.2/§6 and task §22/§24. Executed from cwd `prototype-app` (the offline initializer resolves
`src/db/schema.sql` from cwd) with a `node_modules` junction in TEMP so no repo file is written.

**Container:** QA-owned `b17-u2c2-qa-20261113` (`postgres:18`, published **`127.0.0.1:38022` only**).
Role **`b17u2c2qa`** = `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION` (asserted live:
`rolsuper=false rolbypassrls=false row_security=on`; **every** RLS table `relforcerowsecurity=true`
checked AFTER schema apply). Databases, all owned by that role: `b17_u2c2_qa_scratch` (harness),
`b17_u2c2_qa_ws_scratch`, `b17_u2c2_qa_dom_scratch`, `b17_u2c2_qa_cproof_scratch` (proofs).
No other container touched; no ambient `DATABASE_URL`/`PG*` used (ambient asserted **absent**, then
overwritten from argv only); `.env` asserted absent before and after.

**Guards re-implemented independently:** `--allow-disposable-b17`; exactly one `--database-url=`;
loopback + named `b17_*scratch*` path + no query/hash + owner != `postgres`; a separate
`--oracle-url=` restricted to loopback **superuser on the same scratch DB** (independent row oracle);
`B17_SCRATCH_OPT_IN=YES`; synthetic `JWT_SECRET`; empty `public` schema asserted before start.

**Non-destructive by construction:** INSERT-only seeding (tenants A/B/D/Z, 5 departments, 9 users,
3 services + schema `GRI`, 4 standards incl. the OD-10 CSV key + 2 purpose-seeded childless delete
throwaways, 6 disclosures, 6 items, 7 assignments, **3 answers incl. one CROSS-TENANT tenant-B
answer**, 2 evaluations, 3 item links, 5 `client_services`, 1 tenant-scope freeze snapshot,
OD-10 content fixtures from the approved CSV keys). Every drift probe runs inside a transaction that
ALWAYS rolls back. The only committed DELETEs are of QA's own purpose-seeded childless catalog
throwaways (`Q2C2-DEL-S`, `Q2C2-DEL-D`) and the API-created `Q2C2-DELITEM`, each tracked with an
exact expected delta; **every tenant/business row set is asserted identical at the end**
(`client_services` byte-identical, seed `service_standards` rows all present, answers/evaluations/
assignments/users/clients/notifications/snapshots unchanged).

**Real activation path:** `runMigrations()` (predecessor schema) → seed → `applyB17Offline`
(`applied`) → `assertB17Ready()` → `inventoryB17ContentOffline` → `applyB17ContentOffline`
(`applied`, then idempotent `verified`) → `STRUCTURE_SQL === B17_CONTENT_SHAPE ===
7a13a70382653f70f2733072f068ad00` (the C1-recorded fingerprint).

**Real E2E chain:** the harness boots the production Express stack (`jsonInput → cookieParser →
/api router → globalJsonErrorHandler` — i.e. the REAL `accessDispatcher`, `requireDomainAccess`,
`readContext`/`platformConfigContext`, `scope.ts` predicates and handlers), listens on loopback,
logs in the seeded fixtures, creates a platform tab and four entered consultant tabs (A/B/D/Z), and
drives all probes over real HTTP with real `Authorization` + `X-Workspace-Tab`/`X-Workspace-Version`
headers. Expected read/dashboard values come from an **independent superuser §6 oracle** (canonical
`linkedItem` + own-department assignment, implemented by QA) plus the app's own pure
`gateDraftEvaluations`/`calculateAggregateScore` functions — never hardcoded counts.

---

## 5. Requirement-by-requirement results

### (1) Exactly 23 flips 74→51, no other registry row changed, caps truthful — **PASS**

- `ACCESS_REGISTRY` = **99** rows (95 business + 4 workspace); UNACTIVATED = **51**
  (74 − 23); active business = **44** (8 system/session + 13 U2-B + 23 U2-C).
- The 23 flipped keys are **exactly** the §3.2 list (18 taxonomy incl. `GET /items/:id/links` +
  5 gri incl. `GET /dashboard/stats`), each now `activation:'U1'` with capability `taxonomy`/`gri`.
- The 51 remaining UNACTIVATED are **exactly** `{evaluations:15, admin:25, initiatives:7, reports:4}`
  — zero taxonomy/gri rows remain denied, and **no previously-active row moved** (active set is
  exactly system 4, session 4, taxonomy 18, gri 5, actions 3, storage 5, audit 1, notifications 4).
- `activeBusinessCapabilities()` (registry-derived, feeds `workspace.ts:20`) returns exactly
  `['taxonomy','gri','actions','storage','audit','notifications']` — **truthful (6 entries)**.
- The repository workspace proof independently denies **all 51** remaining declarations across
  anonymous/P/W/C/E; the domain proof independently re-derives `87 → 51`.

### (2) All 23 END-TO-END through the real dispatcher→wrapper→scope→handler — **PASS**

**Coverage bookkeeping:** §3.2 yields **39 allowed combinations** (5 reads × P/W/C/E = 20;
14 P writes × P = 14; preview/commit/template × P = 3; dashboard × W/C = 2) and **76 disallowed**
probes (23 anon + 42 write-role + 9 gri-role + 2 dashboard-role). The harness exercised
**39/39 allowed** and **76/76 disallowed**, asserted at the end (`mark.size === 39`).

**Allowed reads (P catalog full / W-C `L` / E `L+D`):** for each of `GET /services`,
`/disclosures`, `/items`, `/standards`, `/items/:id/links` × P/W/C/E, the response id-set equals
the independent §6 oracle exactly, and every per-row child count (`standard_count`,
`disclosure_count`, `item_count`) equals the authorized-children-only oracle:

| Check | Result |
|---|---|
| P | full global catalog (services 3→5 after write phase, standards incl. never-mapped `Q2C2-SN`, items incl. unmapped `I4`) — equal to superuser truth |
| W(A) | linked-only sets; `W(B)` sees **only** `GRI` (never A-only `S2`/`Y`); counts = oracle |
| C(A) | same linked scope as W; foreign `clientId` → **403**; own → 200 |
| E(A,dept one) | `L+D` sets: only own-assigned children; `DA1.item_count = 1` (not 2 — no foreign counts); disclosures/standards with **zero authorized children are absent** (no empty parents); services = linked services having own assigned items (`Y` excluded — its only item is dept-two) |
| E links | exactly the both-ends-L+D link `I1↔I5`; `I2`/`I3` ends absent; `evaluation = null`; no answer values anywhere in the payload |
| P links | both ends, `evaluation = null` for every link (**catalog metadata only, no tenant overlay**); supplied `clientId` → **403** |
| zero links | `C(Z)`, `E(Z)`, `W(Z)` all return `[]` on all four list reads while P sees >0 — **empty, never all**; `GET /items/:id/links` for Z → generic **404** |

**14 P writes — targetless `platform.config`:** every write ran `dispatcher → requireDomainAccess
(platform mode) → platformConfigContext(req) (targetless) → C1 catalog RLS → handler` and returned
2xx: `POST /services` 201, `PATCH /services/:id` 200 (+ immutable-code 400), `POST …/duplicate` 201
(`linksCopied` = exact live link count), `POST/DELETE /services/:id/standards` 201/200 (net zero),
`PATCH /standards/:id` 200, `PATCH /disclosures/:id` 200, `POST /items` 201,
`PATCH /items/:id` 200 (**weight re-derived by trigger: priority high → weight 3**),
`POST/DELETE /items/:id/links` 201/200 (net zero), plus the three delete declarations in (3).
Every audit row written by them is a **NULL-client catalog-config action** (the targetless
`platform.config` branch) — no target ever supplied. 15 executable call sites in `taxonomy.ts`
(14 writes; `PATCH /services` has an extra read) pass **no request input** as target.

**GRI (`gri.ts`):**

| Probe | Result |
|---|---|
| anon `POST /gri/preview` with **garbage multipart** | **401** (parser never ran — a parse/multer outcome would be 400/500) |
| anon `POST /gri/preview` plain + `GET /gri/template` | **401 / 401** (no `window.location` bypass) |
| W/C/E preview (multipart for W) | **403 workspace.mode_mismatch before multer** |
| P preview JSON + real multipart file | **200** with parsed `standards`/`summary` (template CSV) |
| P template | **200**, `text/csv`, attachment body |
| commit **missing** serviceId | **400 `scope.id_required`** |
| commit **bad** serviceId | **400 `scope.id_invalid`** |
| commit **unlinked** serviceId (B + service `Y`) | **403 `scope.service_unlinked`** |
| commit **missing** explicit T | **400** (choose-a-tenant) |
| commit well-formed but **nonexistent** T | **404** generic |
| commit **success** (T=A, serviceId=GRI linked) | **200** — standards 2 / disclosures 2 / items 2 inserted; **departmentsUpserted 1** (`import-dept`, only in A) + **assignmentsCreated 2** (both new rows in the provisioned department; all 7 seed assignments preserved); **`client_services` and `service_standards` byte-identical before/after** (zero mutation, no implicit grant, no guessed mapping); `mappedStandards`/`unmappedStandards` equal the live mapping (**1/1**) and `setupNotice` states `1 imported standard(s)…` truthfully; audit `IMPORT_GRI_DISCLOSURES` attributed to T=A |
| commit **freeze-skip** (T=D, tenant-scope snapshot) | **200**, `skipped = skippedFrozen = 2`, reason reported, **0 departments / 0 assignments provisioned**, no `Q2C2-FZ*` item rows created, catalog id-sets unchanged |

**Dashboard (`GET /dashboard/stats`):**

| Context | Result |
|---|---|
| W(A) | 200; `itemsCount`/`standardsCount`/`totalCount`/all score fields **equal the independent oracle** (evaluated 1, coverage 20%, partialGap 1, aggregate 50 — computed from oracle rows via the app's own pure functions) |
| overlap dedupe | A is linked to 3 services sharing standards: naive per-service item sum = **11**, response `itemsCount` = **6** = distinct linked items — **each item counted exactly once** (numerator AND denominator scoped) |
| C(A) (`show_gap=true`) | response **deep-equal** to W(A) (no redaction when gaps visible) |
| W(D) (`show_gap=false`) | **not gated**: `evaluatedCount = 0` as a **number** (not null), coverage 0 — GE review retains access |
| **C(D) hidden** | **every one of the 10 score/gap/coverage fields is `null`** (`aggregateScore, evaluatedCount, applicableCount, notApplicableCount, notEvaluatedCount, coverageRatio, coveragePercentage, fullGapCount, partialGapCount, noGapCount`) while `hasData=true`, `standardsCount=3`, `itemsCount=5`, `totalCount=5` stay truthful — never a fabricated 0 |
| C(Z)/W(Z) zero links | `hasData=false`, zeros/null — truthful empty, not a global dashboard |
| P / E / anonymous | **403 / 403 / 401** (no P/E/anonymous global dashboard) |
| `show_corrective` | NOT-APPLICABLE to stats (no corrective metric) — recorded, not invented (§23 D3) |

**Disallowed matrix (76 probes):** anon → **401** on all 23; W/C/E on the 14 P-only writes,
preview/commit/template → **403 `workspace.mode_mismatch`**; P and E on dashboard → **403**.
After the whole batch: services/standards/disclosures/items/`client_services`/`service_standards`
byte-identical, zero audit rows, zero `%EVIL%` rows — **denied writes had zero side effects**.
Dispatcher also still refuses `GET /queue` (UNACTIVATED) with `403 access.unactivated` and unknown
routes with JSON 404.

### (3) DELETE pre-checks — truthful counts BEFORE any delete, §3 refusals, no CASCADE — **PASS**

| Refusal | Independent superuser count | HTTP result |
|---|---|---|
| `DELETE /standards/:id` (SA) | disclosures under SA = **3** (incl. the QA throwaway) | **409**, message contains `3 disclosure(s)` |
| `DELETE /disclosures/:id` (DA1) | items = **3** (I1 + I2 + API-created Q2C2-DELITEM) | **409**, message contains `3 item(s)` |
| `DELETE /items/:id` (I1) | answers = **3 = 2 tenant-A + 1 CROSS-TENANT tenant-B**, evaluations = **1**, assignments = **3** | **409**, message states `3 answer(s), 1 evaluation(s), 3 assignment(s)` |

After the three refusals: standards/disclosures/items/answers/evaluations/assignments id-sets all
**unchanged** (pre-checks run before any DELETE statement; `b17_catalog_child_count` is the only
count source and it RAISEs outside `platform.config` — proven in C1 and re-proven by the c-proof
re-run). Success path: childless `Q2C2-DEL-S`/`Q2C2-DEL-D` and the API-created item delete with
`{deleted:true}`, and **only** those rows disappear — answers/evaluations/assignments id-sets stay
identical (**zero CASCADE**; the `ON DELETE CASCADE` children of items/disclosures/standards were
never reachable because the counts were truthful).

### (4) Filters — explicit invalid/duplicate → 400 `scope.id_invalid`, never broaden — **PASS**

- `GET /disclosures?standardId=not-a-uuid` → **400 `scope.id_invalid`**; repeated
  `?standardId=…&standardId=…` → **400** (never last-key-wins); `GET /items?disclosureId=zzz` and
  duplicated `disclosureId` → **400**.
- Valid filter **narrows**: `?disclosureId=DA1` → exactly `[I1,I2]` for P/W and `[I1]` for E;
  `?disclosureId=<unmapped DN1>` → `[]` for W(A) while P still sees `[I4]` — a filter can only
  narrow, never broaden.
- `GET /items/:id/links?clientId=a&clientId=b` → **400 `scope.id_invalid`**; P + `clientId` →
  **403**; C foreign `clientId` → **403**; C own → 200.

### (5) `platformConfigContext` is server-selected and refuses non-P — **PASS**

- Direct in-process calls: purpose is the constant `platform.config`; target/tenant come **only**
  from the function argument (default `null` = targetless posture of §24 ruling 3).
- A hostile `req.body/query/params` carrying `purpose`/`target_id`/`targetId` is **ignored**
  (`purpose='platform.config'`, target = the server argument or `null`).
- Refuses every non-P context (`consultant`, `client`, `employee`, platform+`client_admin`,
  platform+`employee`, missing access) with **403 `scope.denied`**.
- Static: the function body reads **no** `req.body/query/params`; `taxonomy.ts` call sites are all
  `platformConfigContext(req)`; the single `gri.ts` call is `platformConfigContext(req,
  effectiveClientId)` (validated by `resolveImportTenant` + existence check, never a raw request
  value); no call passes raw request input as target. Zero `optionalAuthMiddleware` mounts remain
  anywhere in `src/server` (definition in `auth.ts` only); `gri.ts` no longer imports it; taxonomy's
  local `contextFromUser`/`b11bRequireGeAdmin` are gone from executable code (comment mentions
  excluded); `U2_LEGACY_HELPER_RETIREMENT.md` carries the `U2-C2` **DONE** rows for both files.

### (6) Readiness refuses drift; proofs re-run green — **PASS**

Inside transactions that ALWAYS rolled back: `DROP POLICY b17_catalog_config_insert ON services` →
`b17.schema_drift`; rogue `CREATE POLICY … ON clients` → `b17.schema_drift`;
`GRANT EXECUTE … b17_catalog_child_count … TO PUBLIC` → `b17.content_authority_drift`.
After every rollback: `assertB17Ready()` green, `STRUCTURE_SQL === B17_CONTENT_SHAPE =
7a13a70382653f70f2733072f068ad00`, live `b17_%` SECURITY DEFINER set exactly
`{b17_catalog_child_count,b17_content_fact}`. Workspace + domain + C1 probe proofs re-run **green on
fresh scratch DBs** (§3); scope proof excluded per §15 (see §6 S1).

---

## 6. Findings / observations / NOT VERIFIED

**F1 (escalated — needs a Tera ruling): malformed explicit T on `POST /gri/commit` → HTTP 500.**
Measured on the activated route: `clientId: "not-a-uuid"` returns
`500 {"error":"invalid input syntax for type uuid: \"not-a-uuid\""}` — a raw PostgreSQL error echoed
to the client. Spec §4 promises **400 malformed input** (and `{error,code}` envelopes). The refusal
still holds (no over-grant, no write), but the status contract is wrong. **Inherited from base**
(`resolveImportTenant`/`normalizeId` at `c4ee8bc:src/lib/tenantAccess.ts` already lacked UUID
validation; `tenantAccess.ts` is git-clean this round) — **newly reachable again because C2
re-activated the route**. Well-formed states are all correct: missing T → 400, nonexistent T → 404,
missing/bad/unlinked serviceId → 400/400/403.

**F2 (escalated — same class, wider surface): non-UUID path `:id` on retrofitted taxonomy routes →
HTTP 500.** Measured: `PATCH /standards/not-a-uuid`, `PATCH /services/not-a-uuid`,
`DELETE /disclosures/not-a-uuid`, `GET /items/not-a-uuid/links` each return
`500 {"error":"invalid input syntax for type uuid: \"not-a-uuid\""}` (spec §4: 400 malformed input;
spec §3 preamble: inaccessible resources → generic 404). **Inherited from base** — the same
`WHERE id = $1` queries with `req.params.id` exist in `c4ee8bc:src/server/taxonomy.ts` (verified via
`git show`), and the C2 retrofit did not add path-id validation. Query-string filters DO comply
(400 `scope.id_invalid`, §5(4)). No over-grant: the 500 is deny-by-crash, nothing is exposed beyond
the reflected input string.

*Decision needed from Tera:* F1/F2 are **spec §4 error-contract deviations, not §3 capability
failures** (every §3 context/status in the matrix held; no over-grant; zero `client_services`
mutation). QA does not absorb them into silence: if Tera reads "any §3 failure" to include the §3/§4
status-code contract, both become FAIL items for a bounded fix — §23's 4th-round ceiling is already
pre-authorised for exactly this class of C2 residual.

**S1 (scope observation): `scripts/b17-scope-proof.ts` was NOT re-run.** The task's phrase
"workspace/scope/domain + C1 probe proofs" collides with contract §15 ("never use the repository
proof containing `DELETE FROM assignments`" — line 135 re-confirmed present). QA prioritised the
owner contract over the handback wording (same disposition as `B17-U2C1-QA.md` S1) and covered
scope via the 164 unit tests + its own RLS probes. *Decision needed only if Tera wants the script
itself run despite §15.*

**OBS-O1 — `_shared.ts` C2 decomposition** cannot be byte-proven against a C1 snapshot (cumulative
uncommitted stack); recorded as observed content in §1.5.

**OBS-O2 — commit audit count:** three `IMPORT_GRI_DISCLOSURES` rows exist (OD-10 seed + commit A +
freeze commit D), each with an explicit non-null target — consistent with §24's ratified
target-bound audit branch.

**NOT VERIFIED (recorded, not converted to PASS):**
- byte-level C2-only git reconstruction (single cumulative uncommitted stack since `c4ee8bc`);
  substituted with the five agreeing signals in §1.
- HTTP E2E through a real browser/UI (not required by this task's evidence list; UI untouched).
- Semgrep CLI scoped scan (not part of this session's instruction set; not run by QA this round).
- The executor's proof-script assertions were executed as **cross-checks only** (exit 0 each);
  QA's verdict rests on QA's own harness.

---

## 7. Pass/Fail decision

# PASS — TASK-PROTO-B17-U2-C2, on the task's enumerated acceptance criteria

- **Diff/scope: PASS.** The C2 delta is **exactly the expected set** — 8 app files in the mtime
  window (taxonomy.ts, gri.ts, accessRegistry.ts, _shared.ts, capabilities.test.ts,
  domainAccess.test.ts + the 2 proof scripts), plus `U2_LEGACY_HELPER_RETIREMENT.md` in ControlPath;
  git tracked-M grew by exactly taxonomy+gri; markers confined to those files;
  `b17-content.sql`/`b17Readiness.ts` **untouched this round** (C1 hashes/mtimes + C1 shape
  fingerprint held); handlers outside the 2, `access.ts`/`scope.ts`, `b17.sql`, migration,
  workspace/session/auth, UI, `package.json`/`bun.lock` all hash-unchanged.
- **(1) PASS** — exactly **23 flips 74→51**, the 51 remaining are precisely
  evaluations/admin/initiatives/reports, no other row moved, `activeBusinessCapabilities()` truthful
  with 6 registry-derived entries; workspace proof denies all 51.
- **(2) PASS** — **39/39 allowed combinations** served end-to-end through the real
  dispatcher→wrapper→scope→handler with oracle-equal data (P full / W-C L / E L+D children-only /
  Z empty-never-all / no P overlay on links); **76/76 disallowed** refused with the §3 status/code
  (anon 401 ×23 — including unauthenticated GRI preview/template **401 before multer/parser** —
  and 403 `workspace.mode_mismatch` for every wrong mode) with zero side effects; **14 P writes**
  under targetless `platform.config`; commit **400/400/403** for missing/bad/unlinked serviceId,
  **400/404** for missing/nonexistent T, success provisions depts+assignments with **byte-identical
  `client_services` and `service_standards`**, truthful unmapped `setupNotice` (1/1 vs live
  mapping), freeze-skip honoured (2/2 skipped, zero provisioning); dashboard W/C L+V with
  **all 10 score/gap/coverage fields nulled for hidden C while counts stay**, overlap-dedupe
  **11 → 6** with numbers, no P/E/anonymous access.
- **(3) PASS** — all three §3 dependency refusals 409 with counts equal to the independent
  superuser tally (**incl. the cross-tenant answer 3 = 2+1**) **before any delete**; zero rows move
  on refusal; success deletes remove only QA's own throwaways with **zero CASCADE**.
- **(4) PASS** — explicit invalid/duplicate filters → **400 `scope.id_invalid`**, filters only ever
  narrow, foreign/malformed `clientId` on links → 403/400.
- **(5) PASS** — `platformConfigContext` purpose/target are server-side only (hostile request fields
  ignored), refuses every non-P context with **403 `scope.denied`**, zero request input reaches
  purpose/target anywhere, zero optional-auth mounts, legacy helpers retired.
- **(6) PASS** — readiness refuses dropped/rogue policy and PUBLIC definer grant inside
  always-rolled-back transactions and recovers; workspace/domain/C1-probe proofs re-run green on
  fresh scratch DBs (scope proof excluded per §15 — S1).
- **lint 0 | test 164/164 (claim verified current, twice) | no-env build 0 | QA harness
  `QA_HARNESS_RESULT PASS groups=G0..G11` exit 0 | workspace/domain/c-proofs exit 0.**

**The task's FAIL conditions are not met:** no §3 context/capability failure was found, **no
over-grant** was found (every disallowed context refused with the specified status/code), and
**`client_services`/`service_standards` were byte-identical across every probe** (zero mutation, no
implicit grant, no guessed mapping). Findings **F1/F2** (spec §4 malformed-input status codes,
inherited from base, newly reachable via activation) and observation **S1** are escalated to Tera
rather than absorbed — see §6 for the ruling requested.

---

## 8. Concurrency / source integrity

- QA wrote **only this file** in the workspace (parent validated; file did not previously exist).
  All instrumentation lives in `TEMP\opencode\b17-u2c2-qa\` (harness, probes, logs, git baselines;
  a `node_modules` junction to the app's — no repo file written). `security-reports/*` untouched.
- Source integrity **before vs after all lint/test/build/proof/harness runs:** `git status
  --porcelain` still **40** entries; `git diff --shortstat` still **15 files, +828/−944**; `HEAD`
  still `c4ee8bc`; newest `src`/`scripts` mtime still **13-11 03:17:49** (`taxonomy.ts`, i.e. QA wrote
  no source); the mtime window still contains exactly the same 8 files; emphasis hashes byte-stable
  (table §1.5); **no `.env`**; `dist/` gitignored (build only).
- QA-owned container `b17-u2c2-qa-20261113` (loopback `127.0.0.1:38022` only) stopped/removed after
  this report; pre-existing unrelated containers (`b17-u2b-r2-pg`, `b17-u2d-qa-20261112`,
  `esg-fixb3-pg`, …) left untouched. No cloud, no commit/push, no app-source edit, no
  `security-reports/*` write, no agent creation.

---

## 9. Full output (key excerpts)

```text
$ npm run lint                       -> exit 0
$ npm test                           -> # tests 164  # pass 164  # fail 0  # suites 5  # skipped 0   (exit 0)
                                        Subtest: U2-C activation split: 51 business routes UNACTIVATED,
                                        44 legacy (8 system/session + 13 U2-B + 23 U2-C flips) + 4 workspace active
$ npm run build  (no .env)           -> ENV_PRESENT=FALSE / ENV_AFTER=FALSE   (exit 0)

$ node --import tsx TEMP\...\qa-harness.mts --allow-disposable-b17 --database-url=...b17_u2c2_qa_scratch
                                        --oracle-url=postgres://...@127.0.0.1:38022/b17_u2c2_qa_scratch
PASS G0 guards+activation: loopback named scratch, --allow, non-superuser/non-BYPASSRLS PG18 FORCE RLS,
     empty start, INSERT-only seed, offline U1 + content activation, readiness green, C1 shape fingerprint held
PASS G1 registry: 99 rows, exactly the 23 taxonomy(18)+gri(5) flipped 74->51, no other row moved,
     capabilities truthful = taxonomy,gri,actions,storage,audit,notifications
PASS G2 HTTP server on loopback + real logins + 1 platform tab + 4 entered consultant tabs (A/B/D/Z)
PASS G3 reads: 5 read declarations x P/W/C/E match the independent L/L+D oracle (sets+child counts),
     P has no tenant overlay, E sees only both-ends-L+D, W(B) scoped, Z zero-links empty-never-all,
     invalid/duplicate filters 400 scope.id_invalid and never broaden, foreign clientId 403
PASS G4 disallowed matrix: 76/76 probes (anon 401 x23, P/W/C/E 403 workspace.mode_mismatch) with ZERO
     side effects; dispatcher still refuses UNACTIVATED + unknown routes
PASS G5 14/14 P writes succeed end-to-end (dispatcher->wrapper->platformConfigContext(targetless)->
     RLS->handler), trigger-derived weight holds, link create/unlink nets zero, every audit row is a
     NULL-client targetless platform.config catalog action
PASS G6 DELETE pre-checks: truthful b17_catalog_child_count vs independent superuser rows (incl. the
     cross-tenant answer 3=2+1) BEFORE any delete, all three §3 dependency refusals 409 with exact
     counts, zero rows moved on refusal, success deletes remove ONLY the QA throwaways with zero CASCADE
PASS G7 GRI: unauthenticated preview/template 401 BEFORE multer/parser (garbage multipart included),
     W/C/E preview 403 before parser, P preview+template+multer 200, commit missing/bad/unlinked
     serviceId = 400/400/403 + missing T 400 + ghost T 404, SUCCESS provisions depts+assignments for
     explicit T with ZERO client_services/service_standards mutation and truthful unmapped setupNotice,
     freeze-skip honoured (2/2 skipped, zero provisioning, zero frozen rows)
PASS G8 dashboard: W/C L+V numbers equal the independent oracle (items 6, naive overlap sum 11 ->
     deduped), C(A) identical, W(D) ungated (0 not null), hidden-gap C nulls ALL 10 score/gap/coverage
     fields while hasData/standards/items/totalCount stay truthful, Z empty, P/E/anonymous denied
PASS G9 platformConfigContext: constant purpose, server-selected target (hostile body/query/params
     ignored), refuses every non-P context with 403 scope.denied; 15+1 call sites pass no request
     input; legacy helpers retired; zero optional-auth mounts; retirement doc DONE
PASS G10 readiness: dropped policy / rogue policy / PUBLIC definer grant ALL refused inside
     always-rolled-back transactions; assertB17Ready + structure fingerprint recover; sanctioned
     definer set exact
PASS G11 census: every protected row set identical end-to-end (client_services FULLY byte-identical,
     seed mappings survive, only DUP copies + declared deltas), 14 targetless catalog audits + 3
     explicit-T import audits, exactly 39/39 allowed combinations exercised, readiness green, no .env
QA_HARNESS_RESULT PASS groups=G0..G11 registry=99/51 flips=23 caps=6 disallowed=76/76 allowed=39/39
     writes=14/14 deletes=refusals3+successes3 commit=success+freeze dashboard=redaction+dedupe   (exit 0)

$ node --import tsx scripts/b17-workspace-proof.ts  (...ws_scratch, fresh)
PASS all 51 remaining unactivated business declarations denied across anonymous/platform/consultant/client/employee
B17_U1 isolated HTTP/RLS proof complete. No legacy business activation or release acceptance.   (exit 0)

$ node --import tsx scripts/b17-domain-proof.ts    (...dom_scratch, fresh)
PASS U2-C2 E2E: all 23 taxonomy/GRI routes exercised end-to-end — every §3 allowed context served,
     every disallowed context refused with its status/code
B17 U2 proof complete: 36 routes flipped (87 -> 51 UNACTIVATED: 13 U2-B + 23 U2-C), sections B/H/I
     green, C1 substrate re-verified, no release acceptance.                                  (exit 0)

$ node --import tsx scripts/b17-domain-c-proof.ts  (...cproof_scratch, fresh)
U2-C1 SUBSTRATE PROOF COMPLETE (re-run post-C2): R1-R9 green, exactly 23 taxonomy/gri flips,
     catalog/P context negatives held.                                                        (exit 0)
$ scripts/b17-scope-proof.ts  -- EXCLUDED by contract §15 (contains DELETE FROM assignments, line 135)

$ probe (activated scratch, real HTTP): malformed explicit T on POST /gri/commit
MALFORMED_CLIENTID {"status":500,"body":{"error":"invalid input syntax for type uuid: \"not-a-uuid\""}}   -> F1
PATCH /standards/not-a-uuid -> 500 {"error":"invalid input syntax for type uuid: \"not-a-uuid\""}         -> F2
```

## QA Agent Signature
QA Agent (Execution Mode) — 2026-11-13 — verdict **PASS on the task's enumerated acceptance
criteria**, with findings **F1/F2** (spec §4 malformed-input status codes, inherited from base,
newly reachable via activation) and scope observation **S1** escalated to Tera for ruling. Own
container `b17-u2c2-qa-20261113` stopped/removed after this report; no application source written;
no commit/push; no `security-reports/*` write.
