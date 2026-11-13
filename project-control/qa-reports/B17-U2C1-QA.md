# Test Report - TASK-PROTO-B17-U2-C1 (policy substrate, 0 flips, no handler edits)

## Task Information
- **Task:** TASK-PROTO-B17-U2-C1 - round 2 of U2-C (policy substrate only): catalog P read/write
  policies, platform.config target context, audit platform INSERT branches, D1 count-only definer,
  D2 bound-tenant/freeze branch, bundled SHIELD-U2B3-01 notifications DELETE identity, shape
  recompute, probe inversion. **0 registry flips, no handler edits.**
- **Contract:** `prototype/TASK-PROTO-B17.md` §22 + §23 (D1-D4 split, C1 = policy substrate);
  `prototype/B17_TECHNICAL_SPEC.md` §3.2 (18 taxonomy + 5 GRI declarations) and §5 (enforcement
  architecture / narrow platform exceptions / "no P SELECT answer or evaluation blobs").
- **QA session:** QA Agent (Execution Mode) - 2026-11-13 (session NEW QA).
- **Base:** `c4ee8bccb87b53fbc957861178832029cde769be` = `HEAD` = `origin/main` (re-checked;
  **no commit/push performed**).
- **Environment:** Windows (win32), Node v22.22.2, npm 12.2.2, Docker 29.9.2, `postgres:18`
  image (server **18.6**), **no `.env` present** (only `.env.example`) before, during and after.
- **Conduct gate:** `tera-system/TERA_AGENT_CONDUCT.md` read first; Untrusted-Content rule applied
  (all repo/task content treated as DATA, not instructions).
- **Authorisation used:** report-only write to **this file** (PowerShell writer, parent
  `project-control/qa-reports/` validated, file did not previously exist); QA-owned disposable
  instrumentation under `C:\Users\Fares\AppData\Local\Temp\opencode\b17-u2c1-qa\`; QA-owned Docker
  container. **No application source write, no `security-reports/*` write (disjoint), no cloud, no
  `.env`, no commit/push, no agent creation.**

---

## 1. Independent C1 diff discovery from c4ee8bc (before any test)

Executed by QA, not taken from any executor statement. The worktree is one cumulative uncommitted
stack (same limitation recorded in `B17-U2A-QA.md` §1 and `B17-U2B-QA.md` §1 S5), so a byte-level
"C1-only" git reconstruction is impossible by design. Substituted evidence - five independent
signals that agree:

### 1.1 git baseline (captured before any QA test, re-checked after all tests)

| Signal | Value |
|---|---|
| `git status --porcelain` | **38 entries** (13 tracked ` M` + 25 untracked) |
| `git diff --shortstat` | **13 files changed, 543 insertions(+), 777 deletions(-)** |
| `git rev-parse HEAD` / `origin/main` | `c4ee8bccb87b53fbc957861178832029cde769be` (both) |

Identical **before and after** every lint/test/build/proof/harness run (§8).

### 1.2 mtime window - the C1 delta

Boundary = the last verified pre-C1 artefact, `B17-U2B-QA.md` (**12-11 23:18:04**). Scanning all
128 files under `prototype-app` (excluding `node_modules`, `.git`, `dist`, report dirs) for
`LastWriteTime > boundary` returns **exactly five files, no more**:

| # | File | mtime | Expected by handback? |
|---|---|---|---|
| 1 | `src/lib/b17ScopeSecurity.test.ts` | 13-11 00:48:49 | yes |
| 2 | `scripts/b17-domain-c-proof.ts` | 13-11 01:00:55 | yes |
| 3 | `src/db/b17-content.sql` | 13-11 01:02:19 | yes |
| 4 | `src/lib/b17DomainPolicies.test.ts` | 13-11 01:04:26 | yes |
| 5 | `src/db/b17Readiness.ts` | 13-11 01:05:40 | yes |

The next-newest file in the whole tree is `B17-U2B-QA.md` itself (12-11 23:18:04). **No sixth file
was written in the C1 window.**

### 1.3 In-source markers

Scanned 113 `.ts/.tsx/.sql/.json/.md/.html/.css` files (report dirs excluded):

| Marker | Hits | Files |
|---|---|---|
| `U2-C` | 11 | the 5 files above, only |
| `platform.config` | 30 | the 5 files above, only |
| `catalog_child_count` | 18 | the 5 files above, only |
| `SHIELD-U2B3-01` | 5 | `b17-content.sql`, `b17Readiness.ts`, `b17-domain-c-proof.ts` |

**None** of these markers occur in `b17.sql`, `b17ContentMigration.ts`, `workspace.ts`, `auth.ts`,
`routes/{session,system,gri,taxonomy,evaluations,initiatives,reports,admin}.ts`, `routes.ts`,
`access.ts`, `accessRegistry.ts`, `capabilities.ts`, `index.ts`, `schema.sql`, `server.ts`, any UI
file, `package.json` or `bun.lock`.

### 1.4 Recorded-hash manifest (`B17-U2D-QA.md` Appendix C, 111 files, recomputed by QA)

- **95 / 111 UNCHANGED**, **16 changed**, **0 missing**.
- Of the 16: **14 were last written before the C1 boundary** (11-11 21:53 .. 12-11 22:07, i.e. U1/
  U2D/U2-B0/U2-B rounds) - `routeGates.test.ts`, `routes/_shared.ts`, `routes/{actions,audit,
  notifications,storage}.ts`, `scripts/b17-{scope,workspace}-proof.ts`, `src/lib/b17ScopeProof.test.
  ts`, `src/lib/capabilities{,.test}.ts`, `src/server/{access,accessRegistry,scope}.ts`;
- the remaining **2 are the C1-expected files** `src/db/b17-content.sql` and `src/db/b17Readiness.ts`.

### 1.5 Emphasis list (task requirement: nothing else changed)

| Emphasis item | Evidence |
|---|---|
| `src/server/taxonomy.ts` | **UNCHANGED vs Appendix C** (`F4D56FA299BF`) **and** git-clean vs `c4ee8bc` |
| `src/server/routes/gri.ts` | **UNCHANGED vs Appendix C** (`AC5BC26E09AA`) **and** git-clean vs `c4ee8bc` |
| other handlers (`evaluations`, `initiatives`, `reports`, `admin`) | UNCHANGED vs Appendix C; git-clean |
| `src/server/access.ts` / `accessRegistry.ts` / `src/lib/capabilities.ts` (+test) | differ from Appendix C **but mtimes 12-11 21:05-21:06** = U2-B round 3 (pre-C1); no C1 marker |
| `src/db/b17.sql` | **UNCHANGED** - `ACE11265D876`, mtime 11-11 22:06 |
| `src/db/b17ContentMigration.ts` | **UNCHANGED** - `DDB940166912`, mtime 12-11 09:20 |
| workspace / session / auth / system / routes / index / schema / server.ts | all **UNCHANGED vs Appendix C**, all mtimes pre-C1 |
| UI (`src/views`, `src/components`, `src/context`, `src/i18n`, `App.tsx`) | git-clean; **no `.tsx`/`.css` file newer than the boundary** |
| `package.json`, `bun.lock` | **UNCHANGED** (`339663502CD3`, `1F6CC073E594`), mtimes 11-10 |
| `src/db/index.ts`, `src/db/schema.sql`, `server.ts` | UNCHANGED vs Appendix C, mtimes pre-C1 |

### 1.6 the new purpose is not wired into any handler

`platform.config` occurs **only** in the five C1 files (SQL + tests + proof). Grep of
`src/server/**` and `src/lib/**` excluding `*.test.ts`: **0 hits** - consistent with "no handler
edits" and with a dormant policy substrate (see OBS-O4).

**Result: the C1 diff is exactly the five expected files; no protected file was touched.**

---

## 2. npm lint / test / no-env build

| # | Command (cwd = `prototype-app`) | Result | Detail |
|---|---|---|---|
| 1 | `npm run lint` (`tsc --noEmit`) | **PASS** | exit 0, no diagnostics |
| 2 | `npm test` (`tsx --test src/**/*.test.ts`) | **PASS** | `# tests 164  # pass 164  # fail 0  # suites 5  # skipped 0`, exit 0 - **claimed 164 verified current** (re-run twice, identical) |
| 3 | `npm run build` (`vite build`) with **no `.env`** | **PASS** | exit 0; `ENV_PRESENT=FALSE` before and `ENV_AFTER=FALSE`; only the pre-existing >500 kB chunk warning |

The C1 tests are inside the 164: `U2-C1 substrate: catalog P policies, platform.config target
policies, audit branches, bound/freeze/count/DELETE-identity deltas` (ok), plus the two
`b17ScopeSecurity.test.ts` tests (ok 46/47) which now pin the two-member sanctioned definer set and
the D1 `REVOKE PUBLIC`/`GRANT TO CURRENT_USER`/`count_context`/`count_args` discipline.

---

## 3. Repository proof scripts (guards read before use)

`scripts/b17-domain-proof.ts` and `scripts/b17-workspace-proof.ts` guards read in full: explicit
`--allow-disposable-b17`; exactly one `--database-url=` from argv only; `postgres:` + loopback host
+ path matching `^/b17_[a-z0-9_]*scratch[a-z0-9_]*$`; no query/hash; owner non-empty and != `postgres`;
no dotenv import; `B17_SCRATCH_OPT_IN`; empty public schema asserted; non-superuser/non-BYPASSRLS
asserted; non-destructive contract stated in the header.

| Proof | Fresh scratch DB | Result |
|---|---|---|
| `scripts/b17-workspace-proof.ts` | `b17_u2c1_qa_ws2_scratch` | **PASS, exit 0** - incl. `all 74 remaining unactivated business declarations denied across anonymous/platform/consultant/client/employee` |
| `scripts/b17-domain-proof.ts` | `b17_u2c1_qa_dom2_scratch` | **PASS, exit 0** - incl. `registry truth: exactly 13 newly flipped (87 -> 74 UNACTIVATED), no other row changed, capabilities match`, `B0_RLS served=23 denied=17`, 13-route E2E green |
| `scripts/b17-scope-proof.ts` | - | **EXCLUDED by contract §15** - still contains `DELETE FROM assignments` (line 135); §15 forbids using it (see observation **S1**) |
| `scripts/b17-domain-c-proof.ts` (executor's own) | `b17_u2c1_qa_cproof_scratch` | **PASS, exit 0** (R1-R9 green) - run as a cross-check only, **not** used as QA evidence |

---

## 4. QA's OWN guarded non-destructive PG18 harness

**File:** `C:\Users\Fares\AppData\Local\Temp\opencode\b17-u2c1-qa\qa-harness.mts` (668 lines) -
**QA-written, independent assertions; not the executor's script.** Every expectation was re-derived
by QA from spec §3.2/§5 and task §22/§23.

**Container:** QA-owned `b17-u2c1-qa-20261113` (`postgres:18`, published **`127.0.0.1:38000` only**,
server **18.6**). Role **`b17u2c1qa`** = `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE
NOREPLICATION` (verified live: `rolsuper=f rolbypassrls=f row_security=on session_user=b17u2c1qa`).
Databases created, all owned by that role: `b17_u2c1_qa_scratch`, `b17_u2c1_qa_ws2_scratch`,
`b17_u2c1_qa_dom2_scratch`, `b17_u2c1_qa_cproof_scratch`. No other container touched; no ambient
`DATABASE_URL`/`PG*` used; no cloud DSN. Second role `b17u2c1qa_intruder` (no privileges) created for
the ACL/REVOKE test; `b17u2c1qa_owner2` created only for the readiness owner-drift probe.

**Guards re-implemented independently:** explicit `--allow-disposable-b17`; exactly one
`--database-url=`; protocol `postgres:`; host in {127.0.0.1, localhost, [::1]}; path matches
`^/b17_[a-z0-9_]*scratch[a-z0-9_]*$`; no query/hash; username non-empty and != `postgres`; ambient
`DATABASE_URL` asserted **absent** and then overwritten from argv only; `.env` asserted absent before
and after; `B17_SCRATCH_OPT_IN=YES`; synthetic `JWT_SECRET`; empty `public` schema asserted before
start; PG18 asserted.

**Non-destructive by construction:** INSERT-only seeding (tenants A/B, 3 departments, 4 users,
services GRI + probe service, 4 standards / 4 disclosures / 5 items incl. childless delete targets,
1 link, 2 memberships, 3 assignments, **3 answers incl. one CROSS-TENANT tenant-B answer**, 1
evaluation, 1 attachment, 2 freeze snapshots, 6 notifications, 3 audit rows + report/profile
fixtures, OD-10 content fixtures from the approved CSV keys). **Every** policy probe, write probe and
drift probe runs inside a transaction that ALWAYS rolls back; the harness writes **no committed
DELETE** against any business table (the only DELETE statements are rolled-back RLS probes, the same
pattern the previous QA rounds used). A fixed **20-table superuser census** is taken and compared at
the end.

**Real activation path:** `runMigrations()` (predecessor schema) -> seed -> `applyB17Offline`
(`applied`) -> `assertB17Ready()` -> `inventoryB17ContentOffline` -> `applyB17ContentOffline`
(`applied`, then idempotent `verified`) -> `STRUCTURE_SQL === B17_CONTENT_SHAPE`.

**Contexts are the real ones:** every probe sets the production GUCs through `setTenantContext` (the
helper `withTenantContext` uses) under FORCE RLS as the non-bypass owner: platform summary
(`purpose=work` and `purpose=workspace`, tenant-NULL), `platform.config` with target T / targetless,
W/C/E work contexts, and a no-context control. A **superuser** connection supplies the independent
row-count oracle (RLS bypassing, read-only).
---

## 5. Requirement-by-requirement results (through the REAL policy layer)

### (1) P catalog reads return TRUE global catalog rows under both P contexts - PASS

Four P contexts x six catalog tables, each compared against the **superuser oracle** (independent of
RLS and of the C1 policies):

| Context | services | standards | disclosures | items | service_standards | item_links |
|---|---|---|---|---|---|---|
| `purpose=work`, platform, tenant-NULL (`b17_platform_scope`) | 2 | 4 | 4 | 5 | 2 | 1 |
| `purpose=workspace`, platform, tenant-NULL | 2 | 4 | 4 | 5 | 2 | 1 |
| `purpose=platform.config`, target=T=A | 2 | 4 | 4 | 5 | 2 | 1 |
| `purpose=platform.config`, targetless | 2 | 4 | 4 | 5 | 2 | 1 |
| **superuser oracle** | **2** | **4** | **4** | **5** | **2** | **1** |

Row **content** (not just counts) also matches the oracle for `services.code` and `standards.code`
in all four contexts. Control: under W (tenant A) the standards count is **2 < 4**, i.e. the P result
is a real P grant, not a deny-all/empty artifact.

### (2) 12 taxonomy write declarations P-reachable; tenant-table mutation unreachable - PASS (with contract note D-1)

**Reachable (each statement executed, 1+ rows, always rolled back) under BOTH P contexts:**

| §3.2 write declaration | Statement | platform summary | platform.config(T) |
|---|---|---|---|
| POST `/services` | `INSERT INTO services` | 1 | 1 |
| POST `/services/:id/duplicate` | `INSERT INTO services` | 1 | 1 |
| PATCH `/services/:id` | `UPDATE services` | 1 | 1 |
| POST `/services/:id/standards` | `INSERT INTO service_standards` | 1 | 1 |
| DELETE `/services/:id/standards` | `DELETE FROM service_standards` | 1 | 1 |
| PATCH `/standards/:id` | `UPDATE standards` | 1 | 1 |
| DELETE `/standards/:id` | `DELETE FROM standards` | 1 | 1 |
| PATCH `/disclosures/:id` | `UPDATE disclosures` | 1 | 1 |
| DELETE `/disclosures/:id` | `DELETE FROM disclosures` | 1 | 1 |
| POST `/items` | `INSERT INTO items` | 1 | 1 |
| PATCH `/items/:id` | `UPDATE items` | 1 | 1 |
| DELETE `/items/:id` | `DELETE FROM items` | 1 | 1 |
| POST `/items/:id/links` (item/link CRUD) | `INSERT INTO item_links` | 1 | 1 |
| DELETE `/items/:id/links` (item/link CRUD) | `DELETE FROM item_links` | 1 | 1 |

**Unreachable - every attempt refused (42501 or exactly 0 rows), in every catalog context**
(platform summary, targetless `platform.config`, and `platform.config(target=B)` writing tenant A):

| Table | INSERT | UPDATE | DELETE |
|---|---|---|---|
| `client_services` | refused | refused | refused |
| `answers` | refused | refused | refused |
| `evaluations` | refused | refused | refused |
| `assignments` | refused | refused | refused |
| `departments` | refused | refused | refused |

**Static confirmation (pg_policies, exact inventory):** `client_services`, `answers` and
`evaluations` have **ZERO** write policies anywhere (only `b17_scope` / `b17_evaluations` /
`b17_internal_read` / `b17_count_read` SELECT). `departments`/`assignments` carry **only**
`b17_config_departments_insert` (INSERT), `b17_config_departments_update` (UPDATE),
`b17_config_assignments_insert` (INSERT) plus the pre-existing U1 `b17_departments_lock` (UPDATE,
`WITH CHECK(false)`, auth-purpose only). `answers`/`evaluations` SELECT under both P contexts = 0
rows (see (4)).

**D-1 (decision needed from Tera, see §6):** under `platform.config` **with an explicit target** the
sanctioned provisioning pair *does* succeed - `departments INSERT` 1 row, `departments UPDATE` 2
rows, `assignments INSERT` 1 row - while `assignments UPDATE` and `departments DELETE` are still
refused. Cross-target (`target=B` writing tenant A) is refused by `WITH CHECK`. QA treats this as
contract-mandated, not as an over-grant: task §22 requires GRI commit to retain "target-tenant
departments/assignments" provisioning and spec §5 sanctions "tenant setup/provisioning over validated
target clients/departments/users/client_services/assignments". **In every context other than
platform.config+explicit target, all five tenant tables are unreachable**, which is what the
handback's shorthand describes.

### (3) `b17_catalog_child_count` truthful integers + RAISES outside the sanctioned context - PASS

| Kind | ref | superuser oracle | helper under `platform.config(T=A)` | helper under `platform.config(T=B)` |
|---|---|---|---|---|
| `standard.disclosures` | std1 | 2 | 2 | 2 |
| `disclosure.items` | disc1 | 3 | 3 | 3 |
| `item.answers` | item1 | **3 (incl. the cross-tenant tenant-B answer)** | **3** | **3** |
| `item.evaluations` | item1 | 1 | 1 | 1 |
| `item.assignments` | item1 | 3 | 3 | 3 |
| `item.evidence` | item1 | 1 | 1 | 1 |

- Return type verified as `integer` via `pg_typeof` (a JS number, never a row/blob).
- The internal `scope.counts` purpose is restored inside the same transaction
  (`current_setting('app.current_purpose')` = `platform.config` immediately after the call).
- **Refusals - all RAISE, none returns a value or a silent 0:** platform summary (`work`),
  platform summary (`workspace`), W, C, E, no-context, wrong role under `platform.config`, missing
  actor under `platform.config` -> `b17.count_context`; bad kind -> `b17.count_args`; NULL ref ->
  `b17.count_args`.
- **ACL:** `SECURITY DEFINER`, exactly **one** EXECUTE grant (owner-only), live `b17_%` definer set
  == `['b17_catalog_child_count','b17_content_fact']` == `SANCTIONED_DEFINER_FUNCTIONS`; the
  unprivileged role `b17u2c1qa_intruder` gets **42501** on EXECUTE and
  `has_function_privilege(...)=false`.

### (4) `platform.config(T)`: target config reads + freeze for T only; blob denial under BOTH P contexts - PASS

| Check | platform summary | `platform.config(T=A)` | `platform.config(T=B)` | targetless config |
|---|---|---|---|---|
| `clients` rows | 0 | exactly tenant **A** | exactly tenant **B** | 0 |
| A departments | 0 | 2 | 0 | 2 (metadata only, OBS-O3) |
| B departments | 0 | **0 (foreign T)** | 1 | - |
| A assignments | 0 | 2 | **0** | 0 |
| freeze fact `is_scope_frozen(A, frozen item)` | **false** (tenant-NULL summary) | **true** | **false (foreign T)** | **false (no target)** |
| freeze fact `is_scope_frozen(B, frozen item)` | false | **false (foreign T)** | **true** | false |
| raw `review_snapshots` rows | 0 | 0 | - | - |
| `answers` rows / `value` column / UPDATE | 0 / 0 / refused | 0 / 0 / refused | - | 0 / 0 / refused |
| `evaluations` rows / `score` column / UPDATE | 0 / 0 / refused | 0 / 0 / refused | - | 0 / 0 / refused |

Control: under W(tenant A) the same queries return 2 answers / 1 evaluation, so the zeros above are
denial, not emptiness. Existing W freeze behaviour is unchanged (`is_scope_frozen(A,...)` = true
under `purpose=work`).

### (5) notifications DELETE user_id identity + trim still correct - PASS

| Probe | Context | Result |
|---|---|---|
| whole-table `DELETE FROM notifications` | C(tenant A), actor = C's own admin | **1 row** (only the actor's own member row); after that the actor sees **no other inbox** |
| `DELETE ... WHERE user_id = <E>` | C(A) | **0 rows** (identity) |
| `DELETE ... WHERE user_id = <GE>` | C(A) | **0 rows** (identity) |
| whole-table `DELETE` | W(A), platform actor | **0 rows** (a platform actor is not a tenant member) |
| whole-table `DELETE` | platform summary | **0 rows** |
| notify `INSERT` for E then `DELETE WHERE user_id = E` | C(A) | INSERT 1, **DELETE 2** (the seed row + the freshly inserted one = exactly the marked inbox); every other user/tenant/platform row survives |
| `SELECT` count | E / platform summary / W / C | 0 / 1 / 1 / 1 (B0 inboxes unchanged) |

### (6) readiness refuses dropped/rogue policy, definer set drift, ACL grant, owner change - and recovers - PASS

Each tamper ran inside its own transaction that was ALWAYS rolled back:

| Tamper | Refusal |
|---|---|
| `DROP POLICY b17_catalog_config_insert ON services` | `b17.schema_drift` |
| `CREATE POLICY b17_qa_rogue ON clients FOR SELECT USING(true)` | `b17.schema_drift` |
| `DROP POLICY b17_notifications_delete` (SHIELD-U2B3-01) | `b17.schema_drift` |
| `DROP POLICY b17_config_assignments_insert` | `b17.schema_drift` |
| `GRANT EXECUTE ON FUNCTION b17_catalog_child_count(text,uuid) TO PUBLIC` | `b17.content_authority_drift` (authority view specifically) |
| `ALTER FUNCTION b17_catalog_child_count(...) OWNER TO b17u2c1qa_owner2` | `b17.content_authority_drift` (authority view specifically) |
| `CREATE FUNCTION b17_qa_rogue_fn() ... SECURITY DEFINER` (extra `b17_*` definer) | `b17.content_authority_drift` **and** `b17.schema_drift` |

After every rollback: `assertB17Ready()` green, `STRUCTURE_SQL === B17_CONTENT_SHAPE`
(`7a13a70382653f70f2733072f068ad00`), and the count helper still returns the truthful value.

### (7) workspace/scope/domain proofs re-run green, registry 99/74 with zero flips, capabilities unchanged - PASS (scope proof excluded per §15 - S1)

| Item | Result |
|---|---|
| `b17-workspace-proof.ts` (fresh scratch) | **PASS, exit 0** - incl. all **74** unactivated declarations denied across 5 contexts |
| `b17-domain-proof.ts` (fresh scratch) | **PASS, exit 0** - registry truth `87 -> 74`, 13-route E2E green |
| `b17-scope-proof.ts` | **EXCLUDED** - still contains `DELETE FROM assignments` (line 135); contract §15 forbids it (S1). Scope behaviour covered by the 164 unit tests (`b17ScopeSecurity`, `b17DomainPolicies`, `b17ScopeProof`, `scope.test`) plus this harness's own RLS probes. |
| registry | **99 rows**, **74 UNACTIVATED**, 25 active - identical to the U2-B accepted state |
| the 23 taxonomy(18)+gri(5) declarations | **all UNACTIVATED** (0 flips) |
| `activeBusinessCapabilities()` | `['actions','storage','audit','notifications']` - unchanged |
| non-destructive closure | 20-table superuser census == the pre-probe seed (clients 2, departments 3, users 4, standards 4, disclosures 4, items 5, services 2, service_standards 2, item_links 1, assignments 3, answers 3, evaluations 1, evidence 1, notifications 6, audit_log 3, client_services 2, actions 0, esg_profile 1, report_settings 1, review_snapshots 2); `assertB17Ready()` green; no `.env` |

**Extra (contract §23 D3, executed independently by QA, read-only):** on the executor's scratch the
already-activated actions read excludes hidden corrective rows **for C at the policy layer** - C(A,
`show_corrective=true`) = 2 rows, C(H, `show_corrective=false`) = **0** rows, while W sees 2 and 1.
So **no `actions.ts` pre-authorisation is needed in C2** (matches `b17_actions`'s
`mode<>'client' OR b17_content_fact('corrective',...)` clause). Recorded as `D3 verified`, not as a
claim borrowed from the executor.

---

## 6. Observations / decision points / NOT VERIFIED

**D-1 (needs a Tera call): target-bound `departments`/`assignments` provisioning writes exist under
`platform.config`+explicit target.** QA did **not** apply the handback's literal "departments
mutation stays unreachable" here, because task §22 (GRI commit retains target-tenant
departments/assignments) and spec §5 (narrow platform provisioning over a validated target) both
require exactly this pair, and the harness proves it is *exactly* target-bound (targetless and
foreign-target attempts refused, `client_services`/`answers`/`evaluations` still refused under the
same context). If Tera intends the provisioning pair to land only with the C2 commit handler, that is
a timing decision, not a security fix - **no runtime path sets `purpose='platform.config'` today**
(§1.6), so nothing is reachable now. *Decision needed: ratify as-is, or defer the two policies to C2.*

**OBS-O1 - the count helper's guard does not additionally require `target_id`.**
`b17_catalog_child_count` raises unless `purpose='platform.config' AND actor IS NOT NULL AND
role='ge_admin'`; it does not check `target_id IS NOT NULL`, whereas task §23 D1 words the context as
"platform configuration **of an explicit target**". QA's measurement: a *targetless*
`platform.config` call succeeds, and its returned integer is **identical** to the with-target value,
because the counts are deliberately catalog-wide (scoping them to a target would re-open the
fail-open defect D1 exists to close). No additional row/blob becomes reachable. Recorded, not
converted to PASS-by-silence.

**OBS-O2 - the internal `scope.counts` purpose is a session GUC.** A caller that could set
`app.current_purpose='scope.counts'` directly would read `answers`/`evaluations` rows (the
`b17_count_read` policy admits them). Purpose is server-selected only (spec §5: "never a request
header"), no application code sets `scope.counts`, and this is the same construction already
accepted for `scope.internal` (B0/U2D) and `migration.inventory`. No request path exists today.

**OBS-O3 - targetless `platform.config` reads ALL department metadata** (`b17_config_departments_read`
admits every row when `target_id IS NULL`; clients and assignments stay target-bound and writes stay
target-bound). This is deliberate per the SQL comment (department validation for `POST /items`), but
spec §3.4 states `GET /departments` is "P configuration target T required". The route is
UNACTIVATED, so nothing exposes it today. *Note for C2: the handler must enforce the target before
querying, exactly as §3.4 says.*

**S1 (scope observation): `scripts/b17-scope-proof.ts` was NOT re-run.** The handback says
"workspace/scope/domain proofs", but contract §15 still forbids using that script (it contains
`DELETE FROM assignments`). QA prioritised the contract over the handback wording and covered scope
via the unit tests + own RLS probes instead. *Decision needed only if Tera wants the script itself
run despite §15.*

**NOT VERIFIED (recorded, not converted to PASS):**
- byte-level C1-only git reconstruction (single cumulative uncommitted stack since `c4ee8bc`);
  substituted with the five agreeing signals in §1.
- HTTP end-to-end behaviour of the 23 declarations - impossible by design while they are
  `UNACTIVATED` (that is C2's exit contract).
- `b17-domain-c-proof.ts` assertions were **not** adopted as evidence; QA ran its own harness. The
  executor's proof was executed only as a cross-check (exit 0).

---

## 7. Pass/Fail decision

# PASS - TASK-PROTO-B17-U2-C1 (policy substrate), on executed scope

- **Diff/scope: PASS.** The C1 delta is **exactly the five expected files** (mtime window, markers,
  recorded-hash manifest and git all agree); `taxonomy.ts`/`gri.ts` are byte-identical to `c4ee8bc`;
  `b17.sql`, `b17ContentMigration.ts`, workspace/session/auth, UI, `package.json`/`bun.lock` are
  hash-unchanged; access/registry/capabilities/scope differ only from the pre-C1 U2-B round.
  `platform.config` appears in no handler.
- **(1) PASS** - both P contexts (plus `workspace` and targetless variants) return the true global
  catalog rows/counts, equal to a superuser oracle; W stays scoped.
- **(2) PASS** - all 14 §3.2 taxonomy write declarations (the 12 catalog/config writes + the 2 link
  CRUD) reachable under both P contexts; `client_services`/`answers`/`evaluations` mutation
  unreachable everywhere (zero write policies); `departments`/`assignments` unreachable outside the
  contract-sanctioned target-bound provisioning pair (**D-1 flagged**). **No over-grant found.**
- **(3) PASS** - counts equal the independently counted real rows for all six kinds, **including the
  cross-tenant answer (3 = 2 A + 1 B)**, typed `integer`, purpose restored; six outsider contexts +
  role/actor/args all RAISE `b17.count_context` / `b17.count_args` - **never a silent 0**; REVOKE
  PUBLIC holds against an unprivileged role; definer set exact. **Counts are truthful.**
- **(4) PASS** - target config reads and the freeze fact resolve for T only; foreign T, targetless
  and tenant-NULL summaries all denied; raw snapshots hidden; `answers`/`evaluations` rows, values
  and mutations unreachable under **both** platform contexts (W sanity proves it is denial).
- **(5) PASS** - DELETE carries the recipient identity (own member rows only, cross-user = 0,
  platform-summary = 0) and the cap-trim still reaches exactly the marked inbox (1 -> 2) without
  touching any other row; P/W/C/E inboxes unchanged.
- **(6) PASS** - dropped policy / rogue policy / dropped SHIELD-U2B3-01 / dropped provisioning /
  PUBLIC ACL grant / owner change / rogue definer **all refused**, and readiness + the C1 structure
  fingerprint recover after rollback.
- **(7) PASS** - workspace proof and domain proof re-run green on fresh scratch DBs; registry still
  **99 rows / 74 UNACTIVATED / 0 flips**, all 23 taxonomy+gri declarations still UNACTIVATED,
  `activeBusinessCapabilities()` unchanged; scope proof excluded per §15 (**S1**); D3 verified
  independently at the policy layer.
- **lint 0 | test 164/164 (claim verified current) | no-env build 0 | QA harness G1-G7 PASS exit 0 |
  workspace proof exit 0 | domain proof exit 0 | executor's C proof exit 0 (cross-check only).**

**No §3.2/§5 failure, no over-grant and no untruthful count was found, so the task's FAIL condition
is not met.** Items **D-1**, **OBS-O1..O3** and **S1** are escalated to Tera rather than absorbed.

---

## 8. Concurrency / source integrity

- QA wrote **only this file** in the workspace (parent validated; file did not previously exist).
  Instrumentation lives only in `TEMP\opencode\b17-u2c1-qa\` (a `node_modules` junction to the app's
  `node_modules` was created there solely so module resolution works; nothing was written into the
  repo). `security-reports/*` untouched.
- Source integrity **before vs after all runs:** `git status --porcelain` still **38** entries;
  `git diff --shortstat` still **13 files, +543/-777**; `HEAD` still `c4ee8bc`; newest
  `src/`+`scripts/` mtime still **13-11 01:05:40** (i.e. **QA wrote no source**); **no `.env`**;
  `dist/` gitignored.
- QA-owned container `b17-u2c1-qa-20261113` stopped/removed after this report; pre-existing unrelated
  containers (`b17-u2b-r2-pg`, `b17-u2d-qa-20261112`, `esg-fixb3-pg`, ...) left untouched. No cloud,
  no commit/push, no app-source edit, no `security-reports/*` write, no agent creation.

---

## 9. Full output (key excerpts)

```text
$ npm run lint                     -> exit 0
$ npm test                         -> # tests 164  # pass 164  # fail 0  # suites 5  # skipped 0   (exit 0)
                                      Subtest: U2-C1 substrate: catalog P policies, platform.config target
                                      policies, audit branches, bound/freeze/count/DELETE-identity deltas
$ npm run build                    -> ENV_PRESENT=FALSE / ENV_AFTER=FALSE   (exit 0)

$ node --import tsx TEMP\...\qa-harness.mts --allow-disposable-b17 --database-url=...b17_u2c1_qa_scratch
SEED ok: tenants A/B, 2+1 departments, 4 users, catalog + linked + frozen fixtures, cross-tenant answer
PASS guards + seed-only fixtures + offline U1 then U2D/C1 content apply + readiness green (PG18, non-superuser, FORCE RLS)
PASS G1 catalog reads: 4 P contexts x 6 tables equal the superuser oracle (services=2, standards=4,
     disclosures=4, items=5, service_standards=2, item_links=1); W stays scoped
PASS G2 taxonomy writes: 14/14 declarations reachable under BOTH P contexts; client_services/answers/
     evaluations have ZERO write policies; departments/assignments writes only the target-bound
     provisioning pair (cross-target refused)
PASS G3 counts: 6 kinds x 2 targets equal the independently counted superuser rows (cross-tenant answer
     included), integer typed, purpose restored, 6 outsider contexts + role/actor/args all RAISE
     (never 0), REVOKE PUBLIC holds, definer set exact
PASS G4 platform.config(T): target config reads + freeze fact exact for T, foreign T and tenant-NULL
     summary denied, raw snapshots hidden, answers/evaluations rows+values unreachable under BOTH P
     contexts (W sanity green)
PASS G5 notifications: whole-table DELETE = actor-own member rows only (1), cross-user DELETE = 0 rows,
     GE-in-tenant and platform-summary DELETE = 0, cap-trim reaches exactly the marked inbox (1->2)
     leaving every other row intact, P/W/C/E inboxes unchanged
PASS G6 readiness: dropped policy / rogue policy / dropped SHIELD-U2B3-01 / dropped provisioning /
     PUBLIC ACL grant / owner change / rogue definer ALL refused, assertB17Ready + B17_CONTENT_SHAPE
     recover after rollback
PASS G7 registry truth: 99 rows / 74 UNACTIVATED / 25 active, all 23 taxonomy+gri still UNACTIVATED
     (0 flips), activeBusinessCapabilities() = actions,storage,audit,notifications
CLOSURE {"clients":2,"departments":3,"users":4,"standards":4,"disclosures":4,"items":5,"services":2,
     "service_standards":2,"item_links":1,"assignments":3,"answers":3,"evaluations":1,
     "evidence_attachments":1,"notifications":6,"audit_log":3,"client_services":2,"actions":0,
     "esg_profile":1,"report_settings":1,"review_snapshots":2}
PASS G7 non-destructive closure: 20-table superuser census identical to the pre-probe seed,
     readiness green, no row added or removed
QA_HARNESS_RESULT PASS groups=G1..G7 flips=0 registry=99/74 caps=actions,storage,audit,notifications
QA_HARNESS_DONE                                                                 (exit 0)

$ node --import tsx scripts/b17-workspace-proof.ts --allow-disposable-b17 --database-url=...ws2_scratch
PASS all 74 remaining unactivated business declarations denied across anonymous/platform/consultant/client/employee
B17_U1 isolated HTTP/RLS proof complete. No legacy business activation or release acceptance.   (exit 0)

$ node --import tsx scripts/b17-domain-proof.ts --allow-disposable-b17 --database-url=...dom2_scratch
PASS registry truth: exactly 13 newly flipped (87 -> 74 UNACTIVATED), no other row changed, capabilities match
B17_U2B round-3 proof complete: 13 routes flipped (87->74), E2E chain green ...                  (exit 0)

$ node --import tsx scripts/b17-domain-c-proof.ts --allow-disposable-b17 --database-url=...cproof_scratch
U2-C1 SUBSTRATE PROOF COMPLETE: R1-R9 green, 0 registry flips, catalog/P context negatives held.  (exit 0)

$ node --import tsx TEMP\...\d3-probe.mts     (read-only, policy layer)
RLS counts {"cA":2,"cH":0,"wA":2,"wH":1}  show_corrective A=true H=false
D3_PASS C sees only show_corrective=true rows (A=2, H=0) while W keeps both states (A=2, H=1)      (exit 0)
```

## QA Agent Signature
QA Agent (Execution Mode) - 2026-11-13 - verdict **PASS on executed scope**, with decision point
**D-1**, observations **OBS-O1..O3** and scope observation **S1** escalated to Tera. Own container
`b17-u2c1-qa-20261113` stopped/removed after this report; no application source written; no
commit/push; no `security-reports/*` write.
