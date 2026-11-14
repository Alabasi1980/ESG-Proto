# Independent QA Report — TASK-PROTO-B17-U2-E (phase E-1, six read flips)

## 1. Verdict

**PASS.** Executed independently in this session (no executor result adopted). No §3 failure and no over-grant found.
Scope: E-1 only — six evaluations/reviews READ declarations activated (40 → 34 UNACTIVATED); the nine write rows remain UNACTIVATED (E-2).
Report-only artifact; no application source, `.env`, dependency, schema, cloud, commit, push or agent change was made by QA.

## 2. Authority, base and independently discovered delta

- Conduct gate re-read first (`tera-system/TERA_AGENT_CONDUCT.md`); unit contract `prototype/TASK-PROTO-B17-U2-E.md` §§2–6; spec `prototype/B17_TECHNICAL_SPEC.md` §3.3 (15 rows), §4, §5 read before testing.
- Base verified by execution: `HEAD = f5f4cc2882481644c992a0ddabecd658d05bb806` (code `5834806` + U2-D evidence `f5f4cc2`), local only, no network/fetch.
- QA-discovered tracked delta vs `f5f4cc2`: **10 files, 327 insertions, 175 deletions** + 1 untracked file = 11 files:
  `scripts/b17-domain-c-proof.ts`, `scripts/b17-domain-d-proof.ts`, `scripts/b17-domain-proof.ts`, `src/db/b17-content.sql`,
  `src/db/b17Readiness.ts`, `src/lib/capabilities.test.ts`, `src/lib/domainAccess.test.ts`, `src/server/accessRegistry.ts`,
  `src/server/routes/evaluations.ts`, `src/server/scope.ts`, untracked `scripts/b17-domain-e1.ts` (340 lines, <500).
- All 11 fall inside task §5 allowlist; `src/db/b17.sql`, `schema.sql`, `b17ContentMigration.ts`, `package.json`, `package-lock.json`,
  `server.ts`, `src/server/auth.ts`: `git diff --exit-code f5f4cc2 -- <set>` → **exit 0 (unchanged)**.
- **`src/lib/scoring.ts` and `src/lib/approvalChain.ts` byte-unchanged vs base: `git diff --exit-code f5f4cc2 -- …` → exit 0.**
- ControlPath (`prototype/`, not a git repo): `U2_LEGACY_HELPER_RETIREMENT.md` carries the U2-E row; QA verified its line claims against source —
  mounts L285/1005/1338/1513/1747/1788, `readContext` L308/1029/1343/1533/1752/1792, remaining legacy CTX **8** sites
  (422, 568, 700, 896, 1094, 1236, 1599, 1838) + `evalClientScope` L411/def L103; base file had 14 `contextFromUser(` and 3 `evalClientScope(`
  occurrences (6 CTX + 1 call site retired = matches the row). Only control file written in the last 36 h besides Tera's task/audit docs.
- Concurrent `security-reports/B17-U2E-fix-review.md` (Shield) observed as an untracked/disjoint owned file; **not read, not used**, QA did not stop.

## 3. Registry truth — EXACTLY six flips, nothing else moved

QA-authored comparison of base vs worktree `accessRegistry.ts` (both imported and diffed programmatically):

| Measure | Base `f5f4cc2` | Worktree |
|---|---:|---:|
| LEGACY_ROUTES | 95 | 95 (row order identical) |
| `U1` | 55 | **61** |
| `UNACTIVATED` | 40 | **34** |
| WORKSPACE_ROUTES `U1` | 4 | 4 |

Changed rows (**exactly 6**, all `UNACTIVATED → U1`, no matrix/capability/order change):
`GET /queue`, `GET /evaluations`, `GET /client-review`, `GET /reviews/ge-check`, `GET /reviews/snapshots`, `GET /reviews/snapshots/:id`.
No other registry row changed. `activeBusinessCapabilities()` truthful: `['taxonomy','gri','evaluations','actions','initiatives','reports','storage','audit','notifications']` (9).

## 4. Static checks (executed, not adopted)

| Check | Result |
|---|---|
| `npm run lint` (`tsc --noEmit`) | **PASS, exit 0** (no errors) |
| `npm test` (node:test) | **PASS, exit 0 — 176 tests / 176 pass / 0 fail / 5 suites / 0 skipped / 0 cancelled** (claimed 176 verified; includes new `ok 60` and `ok 61` U2-E E-1 tests) |
| `npm run build` (no-env: `.env` absent, `DATABASE_URL`/`JWT_SECRET`/`PG*` cleared) | **PASS, exit 0** — 1690 modules, built in 691 ms (pre-existing chunk-size/config warnings only) |

## 5. Own guarded non-destructive PG18 harness

QA-created only: Docker `postgres:18` container `b17-u2e-qa-20261113` (`2cd12c6e530f…`), loopback `127.0.0.1:11138`, fresh named
`b17_u2e_*_scratch` databases (6), owners `b17_qa_runtime` / `b17domainowner` / `b17domainoutsider` all `NOSUPERUSER NOBYPASSRLS
NOCREATEDB NOCREATEROLE`; every run used `--allow-disposable-b17`, one explicit `--database-url`, no ambient `.env`/`DATABASE_URL`/`JWT_SECRET`,
empty start, seed-only fixtures, FORCE RLS verified by the scripts. Pre-existing containers were neither used nor altered.
Harness incidents (infrastructure only, not application defects): `b17-domain-d-proof.ts` run 1 failed on the hardcoded `b17domainoutsider`
password expectation and run 2 on the hardcoded `b17domainowner` role name; QA recreated those roles (same generated password) and dropped +
recreated **its own** scratch DB twice for clean empty starts; run 3 green. No business row was DELETEd/UPDATEd by QA; the only QA DDL was
drop/recreate of disposable scratch DBs and one policy drop + exact restore in the drift probe (§6.5).

| Proof (fresh scratch each) | Result | PASS lines |
|---|---|---:|
| `scripts/b17-domain-e1.ts` (QA run on `b17_u2e_e1_scratch`) | **exit 0** | 11 |
| `scripts/b17-domain-c-proof.ts` (`b17_u2e_c_scratch`) | **exit 0** — R1–R9 green | 11 |
| `scripts/b17-domain-d-proof.ts` (`b17_u2e_d_scratch`, own `--oracle-url`) | **exit 0** — D0–D7 green (D6 drift refuses+recovers; D7 `51→40→34`) | 10 |
| `scripts/b17-workspace-proof.ts` (`b17_u2e_ws_scratch`) | **exit 0** — incl. “all **34** remaining unactivated business declarations denied” | 15 |
| `scripts/b17-domain-proof.ts` (`b17_u2e_domain_scratch`) | **exit 0** — incl. **34×4 = 136** unactivated denials, **53 flips (87→34)**, readiness drift refusal + recovery section | 31 |
| **Total** | **5/5 green, 0 failures** | **78** |

## 6. E-1 contract results (real dispatcher → requireDomainAccess → readContext('work') → scope.ts → handler, under FORCE RLS)

Executed by QA via `b17-domain-e1.ts`; every number below is from this session's run.

- **P1 `GET /queue`**: W **5**, C **5**, E(d.A) **4** (own department only), E2(dept2) **1**; unlinked item and foreign-tenant row excluded; W sees only own-tenant departments.
- **P2 `GET /evaluations`**: W/C/E served with R+L(+D); entity-scoped history (2 rows, `entity_type='evaluations' AND entity_id=$1`, not the general audit); E receives only its own department's answer array; **G-SHARED fail-closed: shared evaluation `null` for E *and* E2, W still reads it**; refusals — anon **401 `auth.invalid`**, P **403 `workspace.mode_mismatch`**, E2 foreign department **404 `scope.not_found`**, W unlinked item **404 `scope.not_found`**, malformed id **400 `scope.id_invalid`**, foreign `clientId` **403 `scope.tenant_mismatch`** (W and C), foreign `departmentId` **403 `scope.department_mismatch`** (E), missing `itemId` **400**.
- **P3 `GET /client-review`**: W/C served (`count=3`, `tenantId` = own server-derived tenant); anon 401; P/E **403 `workspace.mode_mismatch`**; supplied foreign `clientId` **403 `scope.tenant_mismatch`** (comparison only, never a selector).
- **P4 `GET /reviews/ge-check`**: W `scope=tenant` (`total=4`) and `scope=disclosure` (`total=2`) both work; supplied **own** `clientId` accepted as comparison; anon 401; P/C/E 403; foreign `clientId` **403 `scope.tenant_mismatch`**; bogus scope **400**; malformed `scopeRef` **400 `scope.id_invalid`**.
- **P5 `GET /reviews/snapshots`**: 3 own-tenant rows only; **full payload only for the entirely-linked snapshot**; mixed and empty/unparseable payloads are **metadata-only (payload key absent)** with **`content_hash` passed through unchanged** (`e1-hash-mixed`, `e1-hash-empty`), `notes_count` safe; anon 401; P/C/E 403; foreign `clientId` 403.
- **P6 `GET /reviews/snapshots/:id`**: full blob (2 items) + 1 append-only note for the fully-linked snapshot; mixed → **403 `scope.not_visible`**; empty → 403; foreign tenant snapshot → **404 `scope.not_found`**; unknown UUID → 404; malformed → **400 `scope.id_invalid`**; anon 401; P/C/E 403. No partial blob, no hash rewrite anywhere.
- **P7 writes**: the nine E-2 write rows (`POST /evaluations`, `submit`, `approve`, `return`, `PUT correct`, `client-approve`, `client-return`, `ge-final`, `snapshots/:id/notes`) × {anon, W, C, E} = **36/36 → 403 `access.unactivated`** (plus domain-proof 34×4 = 136 across the full unactivated set).
- **P8 non-destructive**: before/after census identical across **18 tables**; `assertB17Ready()` green after the run.

## 7. QA-authored probes (independent of the executor's script)

1. **Registry delta probe** (§3 above): exactly 6 rows, 40 → 34, no other row touched.
2. **Readiness drift probe** on a dedicated activated scratch (`b17_u2e_drift_scratch`, activated by a second green e1 run):
   live `STRUCTURE_SQL` checksum = **`75a6da913c507ea0d7e121745ea53da1`** = `B17_CONTENT_SHAPE`; the new `review_snapshots` W-only SELECT policy is present;
   `DROP POLICY b17_scope ON review_snapshots` → `assertB17Ready()` **and** `verifyB17Content()` both refuse with **`b17.schema_drift`**;
   exact policy restore → readiness green and checksum restored to `75a6da91…`. (Domain proof additionally covers rogue-policy/ACL/ledger drift + recovery.)
3. **Queue predicate probe** (exact handler SQL, real RLS modes): W **5** = independent linked oracle **5**; employee-mode E **4** own-dept, E2 **1**, **zero cross-department rows**.
   Control run in consultant mode showed the handler predicate itself is item-level (`EMPLOYEE_ITEM_SQL`): row-level D for E is delivered by FORCE RLS
   (`b17_scope` on `assignments`), i.e. defense-in-depth — end-to-end API and employee-mode results are L+D as §3 requires. Design note, not a defect.
4. **Queue payload / G-SHARED probe**: for the two-department item, E's queue row returns `evaluation_id=null, score=null` and
   `b17_content_fact('evaluation',…)` = **false** under the employee context — the ambiguous evaluation is not readable through `/queue` either.

## 8. Scrutiny of the three new `scope.ts` helpers (authority-widening check)

- **`ownTenant(access, supplied?)`** — always returns `access.tenantId` (server-derived); a supplied value is a **comparison only**
  (mismatch → 403 `scope.tenant_mismatch`; malformed → 400 `scope.id_invalid`; **array/number/object `clientId` → 400 `scope.id_invalid`, never “absent” and never a broader tenant** — matches spec §5 “array/ambiguous → 400, not ignored”).
  No platform/`@T` resolution exists on any of the six reads. The 400 `scope.tenant_required` branch is **defensive and unreachable**
  (`validBinding` forces a UUID tenant for every non-platform context) — recorded as unexercised, not a gap in enforcement.
- **`linkedItemsOnly(client, access, items)`** — pure narrowing filter over server-loaded rows using trusted `access.tenantId` +
  `LINKED_ITEM_SQL` ($1 tenant / $2 NULL service / $3 ids); no request input reaches it; used only by `GET /reviews/ge-check`
  (ge-final keeps its own §8 whole-scope preflight, so nothing is silently dropped from a refusing path).
- **`snapshotPayloadFullyLinked(client, access, payload)`** — returns a boolean only: unparseable / non-object / missing-or-empty `items`
  / any non-UUID `itemId` → **false (fail-closed)**; otherwise every id must be linked to the caller's own tenant. Request payload input can
  only cause denial (metadata-only / 403), never a partial or broader payload; `content_hash` is never recomputed.
- **Conclusion: no request input (array `clientId`, supplied id used as source, payload contents) widens authority in any of the three helpers.**

## 9. Pass/Fail decision

**PASS** — lint/test/build green (176/176 verified), 5/5 PG18 proofs green on fresh QA-owned scratch (78 PASS lines), exactly 6 flips (40→34)
with no other registry row changed, all six reads serve every §3 allowed context and refuse every disallowed one with the §3 status/code through the
real chain, G-SHARED stays fail-closed, snapshots never leak mixed/foreign payloads or rewrite hashes, the nine write rows stay
403 `access.unactivated` × 4 contexts, capabilities truthful, `scoring.ts`/`approvalChain.ts` byte-unchanged, readiness drift refusal + recovery
re-proven (incl. the new policy), helpers do not widen authority, allowlist respected and forbidden files untouched.

## 10. Not verified / out of scope this round (honest limits)

- **Semgrep CLI / Trivy**: not run in this session (not part of this session's instructed verification list) — NOT VERIFIED here.
- **Playwright E2E / axe**: SKIPPED — the repository contains no Playwright config or `tests/` E2E suite (node:test only); no UI change in E-1.
- **BF-01 interleaving proof** (`ge-final` ↔ `POST /gri/commit` shared lock): N/A for E-1 — both rows are still UNACTIVATED; belongs to E-2.
- **E-2 write behaviour** beyond the activation refusal (draft/submit/approve/correct/client-approve/ge-final/notes semantics, E-0 policy substrate, 34→25 flips): not tested — out of E-1 scope.
- `ownTenant` 400 `scope.tenant_required` branch unexercised (defensive, see §8); concurrent Shield report not read; no commit/push/deploy/release acceptance.

## 11. Environment and signatures

Windows PowerShell 5.1 / Node v22.22.2 / npm 12.2.2 / Docker 29.9.2 / PostgreSQL 18 (`postgres:18` image), session date 2026-11-13.
QA container `b17-u2e-qa-20261113` stopped/removed after evidence capture (own container only).
— QA & Acceptance Agent (mُختبر), Execution Mode, independent session NEW.

---

# Independent QA Report — TASK-PROTO-B17-U2-E (phase E-2, nine write flips + E-0 + BF-01 + §9(a)(b)(c))

## 12. Verdict (E-2)

**FAIL.** Executed independently in this session (no executor result adopted). Every E-2 obligation passed EXCEPT the §8/§3.3 whole-scope ge-final preflight: with an unmapped/unlinked assignment present, `POST /reviews/ge-final` does **not** refuse `409 scope.unmapped` — the count-only preflight cannot see unmapped rows under the handler's own RLS context (structurally always 0), and a **subset freeze COMMITTED** (201 + snapshot) in the decisive probe. Spec §8 forbids exactly this ("never a currently visible subset freeze"). That is a §3 contract failure → FAIL per task rule.
Everything else below is green: lint/test/build, 109 PASS lines across 8 harness runs, exactly 9 flips 34→25, the full §3/OD-08 write matrix, E-0 policies, BF-01, §9(a) history, §9(b) 400s, §9(c) predicates, G-SHARED, and the UPDATE-then-INSERT concurrency scrutiny.
Report-only artifact; QA made no application source, `.env`, dependency, schema, cloud, commit, push or agent change. Concurrent Shield file `security-reports/B17-U2E-fix-review.md` observed as disjoint/untracked — not read, QA did not stop.

## 13. Authority, base and independently discovered E-2 delta

- Conduct gate re-read first (`tera-system/TERA_AGENT_CONDUCT.md`); unit contract `prototype/TASK-PROTO-B17-U2-E.md` §§2–4, §9 (all binding); spec §3.3 (15 rows), §4, §8 read before testing.
- Base verified by execution: `HEAD = f5f4cc2882481644c992a0ddabecd658d05bb806`, local only, unchanged after the run.
- QA-discovered tracked delta vs `f5f4cc2`: **13 files modified** (`b17-domain-{c,d,}-proof.ts`, `b17-content.sql`, `b17Readiness.ts`, `b17DomainPolicies.test.ts`, `capabilities.test.ts`, `domainAccess.test.ts`, `routeGates.test.ts`, `accessRegistry.ts`, `routes/evaluations.ts`, `routes/gri.ts`, `scope.ts`) + **4 untracked** (`scripts/b17-domain-e1.ts`, `b17-domain-e2.ts` (408 l), `b17-domain-e2b.ts` (237 l), report files) — all inside task §5 allowlist; every new file <500 lines.
- **`src/lib/scoring.ts` and `src/lib/approvalChain.ts` byte-unchanged: `git diff --exit-code f5f4cc2 -- …` → exit 0.** Forbidden set (`b17.sql`, `schema.sql`, `b17ContentMigration.ts`, `package.json`, `package-lock.json`, `server.ts`, `auth.ts`, `routes.ts`, `workspace.ts`) → **exit 0**.
- `gri.ts` delta is exactly ONE lock line (`pg_advisory_xact_lock(hashtextextended($1,1717005))`, key `b17.freeze:${effectiveClientId}`) — nothing else touched (§4.2 allowlist honoured).
- Retirement row (`prototype/U2_LEGACY_HELPER_RETIREMENT.md` line 111) verified against source: `contextFromUser` 0, `evalClientScope`/`evalDepartmentScope` 0, `b11bAssert*` 0, `withTenantContext(readContext(req))` **14** sites, **15/15** declarations carry `requireDomainAccess` (pinned by `routeGates.test`), 1 advisory-lock line. Claims match the code.

## 14. Static checks (executed, not adopted)

| Check | Result |
|---|---|
| `npm run lint` (`tsc --noEmit`) | **PASS, exit 0** |
| `npm test` (node:test) | **PASS, exit 0 — 178 tests / 178 pass / 0 fail / 5 suites / 0 skipped** (claimed 178 verified) |
| `npm run build` (no-env: `.env` absent, `DATABASE_URL`/`JWT_SECRET`/`PG*` cleared) | **PASS, exit 0** — built in 642 ms, pre-existing chunk warnings only |

## 15. Own guarded non-destructive PG18 harness (QA-run, nothing adopted)

QA-created only: Docker `postgres:18` container `b17-u2e-qa-e2-20261114` (`f8e5d69c…`), loopback `127.0.0.1:11148`; roles `b17domainowner`/`b17domainoutsider` (`NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`); 8 fresh named `b17_u2e_*_scratch` DBs (owner `b17domainowner`); every run: explicit `--allow-disposable-b17` (or QA's own equivalent URL guard), one explicit URL, no ambient `.env`/`DATABASE_URL`/`JWT_SECRET`/`PG*`, empty start, seed-only fixtures, FORCE RLS asserted. Pre-existing containers were neither used nor altered. QA wrote no business-row DELETE/UPDATE; only DDL was drop/recreate of QA's own scratch DBs and rolled-back drift probes.

| Run (fresh scratch each) | Result | PASS lines |
|---|---|---:|
| `scripts/b17-domain-e2.ts` (`…_e2_scratch`) — QA-run | **exit 0** | 12 |
| `scripts/b17-domain-e2b.ts` (`…_e2b_scratch`) — QA-run | **exit 0** | 8 |
| `scripts/b17-domain-e1.ts` (`…_e1_scratch`) — QA-run | **exit 0** | 11 |
| `scripts/b17-domain-c-proof.ts` (`…_c_scratch`) | **exit 0** | 11 |
| `scripts/b17-domain-d-proof.ts` (`…_d_scratch`, own `--oracle-url`) | **exit 0** — D0–D7 green | 10 |
| `scripts/b17-workspace-proof.ts` (`…_ws_scratch`) | **exit 0** — dynamic “all **25** unactivated denied” | 15 |
| `scripts/b17-domain-proof.ts` (`…_domain_scratch`) | **exit 0** — **62 flips (87→25)**, 25×4 denials | 31 |
| **QA-authored probe** `b17-u2e-qa-probe.cjs` (temp, outside repo; `…_qa_probe6_scratch` + postgres oracle URL) | **phases A–J green, phase K FAIL** | 11 |
| **Total** | **7/7 executor scripts green; QA probe 11 green + 1 FAIL** | **109 PASS** |

## 16. E-2 contract results

1. **Registry (QA deep-compare, base file imported from `git show f5f4cc2`, both sides programmatically diffed):** base **40** UNACTIVATED → E-1 **34** (6 reads) → E-2 **25**; **exactly the nine write rows** flipped `UNACTIVATED→U1`; for all 95 rows method/path/capability/**matrix deepEqual**, row order identical; U1 = 70; **remaining 25 are all `capability='admin'`**; `activeBusinessCapabilities()` = `['taxonomy','gri','evaluations','actions','initiatives','reports','storage','audit','notifications']` (9), `admin` absent. No matrix/capability rewording.
2. **Write matrix through real dispatcher→requireDomainAccess→readContext('work')→scope→handler (QA probe + e2):** every §3 allowed context served — E save/resave/submit/**dept-return**/approve (self-preliminary labelled), E author correct, **W reasoned correct (200, correction_history 1, previous_score stamped)**, C client-approve/client-return, W ge-check/ge-final/notes(201). Every disallowed refused `403 workspace.mode_mismatch`: submit/approve/dept-return × {W,C,P} (QA-filled gap in e2), correct × {C,P}, client-approve/return × {W,P,E}, ge-final × {C,E,P}, notes × {P,C,E} (QA-filled gap), fresh evaluation × {C,W,P}. §9(b) malformed deptId/itemId/:id/scopeRef → **400 `scope.id_invalid` before SQL**; mixed snapshot → **403 `scope.not_visible`**; notes **2000-cap** (400) + append-only 201; missing/stale tab 409; foreign tenant ge-final → 403 `scope.tenant_mismatch`.
3. **Lifecycle E2E (e2, QA-run):** versions **1→2→3…→10 lockstep** across save/resave/submit/approve/correct/C-confirm/C-return/re-submit/re-approve/C-confirm; 400 `version.required` + 409 `version.conflict` payloads; ge-check → ge-final 201 (snapshot + `content_hash`, FinalApproval=1); frozen writes → **409 API** (`frozen by GE final approval`) and **FROZEN_SCOPE** at direct SQL. QA probe re-proved the department-RETURN leg: v1→v7 with actual numbers in §15.
4. **G-SHARED (e2 + QA probe):** second department → **409 `scope.shared_ambiguous` before any upsert**; E and E2 read `evaluation: null` + no history; W reads it; original 2-answer+1-evaluation pair **byte-identical** (deepEqual) — no rekey/overwrite.
5. **§9(a) history (QA probe):** W=**7**, C=**7**, E=**7** entity-scoped rows, every row `entity_type='evaluations'` **and** `entity_id = this evaluation`; shared item history **0**; `/audit-log` still **403** for C and E; foreign tenant (B) sees **0** audit rows of A; CB foreign item → 404.
6. **BF-01 (e2b, QA-run):** identical lock seed **1717005** and exactly **one** lock line per side (source-asserted); ge-final blocked behind the held key then froze after release (201 + hash); `POST /gri/commit` provisioning blocked behind the SAME key then completed (departmentsUpserted≥1, assignmentsCreated≥1); exactly **one** snapshot after the interleaving (whole-scope intact, no double freeze). Coverage note: e2b proves each side against a held key rather than a direct ge-final↔commit race — combined with identical byte-key + `pg_advisory_xact_lock` (xact-scoped, and the freeze runs inside the single `withTenantContext` BEGIN/COMMIT) this is adequate serialization evidence.
7. **E-0 (QA probe, live `pg_policies`):** exactly the **7** write policies (`b17_answers_draft_insert`, `b17_answers_workflow_update`, `b17_evaluations_draft_insert`, `b17_evaluations_workflow_update`, `b17_approvals_insert`, `b17_review_snapshots_insert`, `b17_snapshot_notes_insert`), scoped own-dept/own-company/scoped-W+GE; **0 DELETE policies** on answers/evaluations/approvals/review_snapshots/snapshot_notes; no UPDATE on approvals/snapshots/notes; `SECURITY DEFINER` count in `b17-content.sql` = **2** (unchanged, no new definer); live `STRUCTURE_SQL` checksum = **`e8c0fa07dc95e90f85df962576d94563`** = `B17_CONTENT_SHAPE`; `B17_CONTENT_VERSION` still `B17_U2D` (E1-04 accepted state, U2-G mandate). Readiness: dropping the NEW policy `b17_answers_draft_insert` → `verifyB17Content` refuses **`b17.schema_drift`**, rollback recovers; `GRANT EXECUTE … b17_content_fact … TO PUBLIC` → **`content_authority_drift`**, rollback recovers; fingerprint restored; `assertB17Ready()` green after every cycle.
8. **Proofs re-run on fresh scratch (scope script with `DELETE FROM assignments` never run):** domain 31 + c 11 + d 10 + workspace 15 + e1 11 = **78 PASS lines**, all exit 0.

## 17. THE FAILURE — §8 whole-scope preflight unreachable; subset freeze commits

**Requirement (task §2 E-2 row + spec §8):** ge-final must run a count-only whole-tenant preflight inside ONE transaction and refuse **409 `scope.unmapped`** when any tenant assignment is unmapped/unlinked, before freezing.

**Evidence (QA probe, real chain, FORCE RLS):**
- Tenant A: ground truth (postgres oracle, read-only) unmapped assignments = **1** (`D-FOREIGN-STD` unlinked); the SAME preflight query under the handler's own work/consultant context returns **0** — `b17_scope` on `assignments`/`items` hides unlinked rows (`b17_item_visible` = `b17_content_fact('linked',…)`), so `NOT LINKED_ITEM_SQL` can never be true for a visible row. ge-final on A therefore skipped the preflight and answered the completeness gate instead (409, no `scope.unmapped`).
- **Decisive probe (tenant Q, seeded INSERT-only):** 2 assignments — `QA-QMAP-ITEM` (linked, `client_approved`, complete) + `QA-QUNMAP-ITEM` (standard never linked; oracle unmapped count = **1**). `POST /reviews/ge-final {scope:'tenant', confirm:true}` as W → **HTTP 201**, snapshot `31bc5153-…`, `content_hash a64aca09…`, **payload contains ONLY `QA-QMAP-ITEM` (1 of 2 items)** — a committed subset freeze, `snapshots=1`, no `409 scope.unmapped`.
**Root cause (code):** `evaluations.ts:1693-1698` runs `SELECT count(*) … WHERE a.client_id=$1 AND NOT ${LINKED_ITEM_SQL}` inside `withTenantContext(readContext(req))` (work/consultant); FORCE RLS filters unmapped assignments/items out before the WHERE, so `n` is structurally always 0 and `throw scopeError(409,'scope.unmapped')` is dead code. The subsequent completeness gate only sees the visible (mapped) subset, so it also passes.
**Reachability:** production can hold such rows (e.g. `DELETE /services/:id/standards` or service unlink — task/spec require preserving business rows), which is precisely the case §8's "require platform mapping repair" exists for.
**Why executor evidence missed it:** `b17-domain-e2.ts:75` and `e2b.ts:56` explicitly link `D-FOREIGN-STD` "so the preflight sees ZERO unmapped assignments" — the negative path (`409 scope.unmapped`) is never exercised anywhere in the delivered suite.
**Impact:** whole-tenant GE freeze silently degrades to a visible-subset freeze; unmapped assignments stay editable after a "frozen" scope claims completeness. Security/contract HIGH for B17 acceptance.

## 18. Scrutiny of the reported root fix (UPDATE-then-INSERT, no RETURNING)

Static: the pair write runs inside the single `withTenantContext` transaction; `assertEmployeeEvaluationWritable` takes `pg_advisory_xact_lock(hashtextextended('tenant:item',1717002))` **before** `existingEval` is read and holds it to COMMIT, so UPDATE-then-INSERT cannot race; `evaluations UNIQUE(client_id,item_id)` + `answers UNIQUE(client_id,item_id,department_id)` back-stop any residual duplicate; `existingEval`-exists-but-rowCount-0 → fail-closed **409 `scope.shared_ambiguous`** (never a rekey); INSERT is employee+own-dept+actor pinned by the WITH CHECK policy; the read-back `SELECT` happens only after the answer row exists (so SELECT policy admits it).
Dynamic (QA probe): fresh-pair parallel saves → **[201, 400 `version.required`]**, exactly **1 evaluation + 1 answer**; same-version parallel resaves → **[201, 409 `version.conflict` {expectedVersion:2}]**, lockstep **v2/v2**, score = one committed value, no duplicate, no lost update, no 500. Conflict payloads correct. **No defect found in this fix.**

## 19. Not verified / out of scope this round (honest limits)

- **Semgrep CLI / Trivy**: not run in this session — NOT VERIFIED here (not on this session's instructed list).
- **Playwright E2E / axe**: SKIPPED — no Playwright config/`tests/` suite in the repo (node:test only); no UI change in E-2.
- Direct ge-final↔`gri/commit` head-to-head race not fired (e2b uses held-key interleaving on both sides — see §16.6); QA did not perform business-row DELETE/UPDATE (contract), so the "unlink-after-link" variant of §8 was proven via the never-linked fixture + oracle ground truth instead.
- Executor's own claims adopted nowhere: every number above is from this session's runs.

## 20. Environment and signatures

Windows PowerShell 5.1 / Node v22.22.2 / npm 12.2.2 / Docker 29.9.2 / PostgreSQL 18 (`postgres:18`), session date 2026-11-14.
QA container `b17-u2e-qa-e2-20261114` (port 11148) left running with 8 scratch DBs for Tera/re-run disposition; no pre-existing container touched.
— QA & Acceptance Agent (مُختبر), Execution Mode, independent session NEW. **E-2 verdict: FAIL (§8 preflight), all other obligations PASS.**
---

# Independent QA Report — TASK-PROTO-B17-U2-E (phase E-3 / round 3: §10 mandate rulings 1–6)

## 21. FINAL Verdict (E-3)

**PASS.** Executed independently in this session (disk-is-truth; no executor result adopted). The E-2 FAIL root cause is **closed**: the exact Q-probe (tenant Q = 1 linked+complete + 1 never-linked assignment) now answers **`409 scope.unmapped` with `snapshots(Q)=0`**, the preflight definer count equals an independent superuser oracle on every probed tenant, a complete tenant freezes with the **FULL 2-of-2 payload (not a subset)**, and the BF-01 reverse window is bracketed on both sides. No new functional failure was found across 120 PASS lines (106 executor + 14 QA-authored), 180/180 unit tests, lint/build green, and every §3/OD-08/preservation check re-run.
E-1 PASS (§1–§11) and E-2 FAIL (§12–§20) history above is preserved unchanged.
Report-only artifact; QA made no application source, `.env`, dependency, schema, cloud, commit, push or agent change. Concurrent Shield file `security-reports/B17-U2E-fix-review.md` observed as disjoint/untracked — not read, QA did not stop. QA container `b17-u2e-qa-e3-20261114` created and **disposed** after evidence capture (pre-existing containers untouched).

## 22. Independently discovered E-3 delta vs QA's E-2 manifest

Same base `HEAD = f5f4cc2882481644c992a0ddabecd658d05bb806`; tracked set unchanged (**13 modified**) plus one NEW untracked `scripts/b17-domain-e2c.ts` (335 lines, <500); `b17-domain-e2.ts` grew 408→**448** lines. E-3-specific content found by QA:
- `b17-content.sql`: count-only definer `b17_catalog_child_count` gains the closed kind **`tenant.unmapped_assignments`** (guard: purpose `work` + actor + `ge_admin` + consultant mode + `ref` == caller's OWN tenant; internal `scope.counts` purpose + `b17_count_read` row policies; REVOKE-PUBLIC/`GRANT … TO CURRENT_USER` unchanged); `b17_approvals_insert` gains the **own-dept/item-visible pin** (`b17_item_visible` + `assigned`/`department` provenance branches).
- `b17Readiness.ts`: `B17_CONTENT_SHAPE = '8c8f60bf7af9cbc5bd6f483b5b0dc715'`; `B17_CONTENT_VERSION` still `B17_U2D` (E1-04/U2-G mandate); sanctioned definer set unchanged (**2** `SECURITY DEFINER` functions, no new definer).
- `evaluations.ts`: `readFailure()` helper on the **six read catches** (no `code: err.code` anywhere); explicit **`user.role !== 'client_admin'`** handler guards on client-approve AND client-return (2 sites); notes applies the **identical `snapshotPayloadFullyLinked` gate** as `GET /:id` (2 call sites); ge-final preflight now calls the definer kind **inside the BF-01 lock** (`evaluations.ts:1726-1728`).
- `gri.ts`: **freeze recheck AFTER the lock seed** (`lock @306` → `is_scope_frozen @313` → `deptToItemIds.clear()` @314); still exactly ONE lock line, seed `1717005`.
- Tests: `routeGates.test.ts` +25 lines (source-shape pins for rulings 1b/2/4/5), `b17DomainPolicies.test.ts` +30 (kind/pin/definer pins).
- **No new flips:** `accessRegistry.ts` diff identical to the E-2 manifest (27+/3−); `scope.ts` unchanged (96+/0−).
- **`scoring.ts` / `approvalChain.ts` byte-unchanged: `git diff --exit-code f5f4cc2 -- …` → exit 0**; forbidden set (`b17.sql`, `schema.sql`, `b17ContentMigration.ts`, `package.json`, `package-lock.json`, `server.ts`, `auth.ts`) → **exit 0**; `.env` absent; HEAD unchanged.

## 23. Static checks (executed, not adopted)

| Check | Result |
|---|---|
| `npm run lint` (`tsc --noEmit`) | **PASS, exit 0** |
| `npm test` (node:test) | **PASS, exit 0 — 180 tests / 180 pass / 0 fail / 5 suites / 0 skipped** (claimed 180 verified) |
| `npm run build` (no-env: `.env` absent, `DATABASE_URL`/`JWT_SECRET`/`PG*` cleared) | **PASS, exit 0** — built in 648 ms, pre-existing chunk warnings only |

## 24. Own guarded non-destructive PG18 harness (QA-run, disposed)

QA-created only: Docker `postgres:18` container `b17-u2e-qa-e3-20261114` (`404482c6…`), loopback `127.0.0.1:11149`; roles `b17domainowner`/`b17domainoutsider` (`NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`); **10 fresh named `b17_u2e_e3_*_scratch` DBs**; every run: explicit `--allow-disposable-b17` (or QA's own equivalent URL guard) + explicit `--oracle-url` where required, no ambient `.env`/`DATABASE_URL`/`JWT_SECRET`/`PG*`, empty start, seed-only fixtures, FORCE RLS asserted. QA wrote no business-row DELETE/UPDATE; drift probes rolled back; **container removed after evidence capture**.

| Run (fresh scratch each) | Result | PASS lines |
|---|---|---:|
| `scripts/b17-domain-e2c.ts` (new, with superuser oracle) — QA-run | **exit 0** | 7 |
| `scripts/b17-domain-e2.ts` (extended) — QA-run | **exit 0** | 13 |
| `scripts/b17-domain-e2b.ts` — QA-run | **exit 0** | 8 |
| `scripts/b17-domain-e1.ts` — QA-run | **exit 0** | 11 |
| `scripts/b17-domain-c-proof.ts` | **exit 0** | 11 |
| `scripts/b17-domain-d-proof.ts` (own `--oracle-url`) | **exit 0** | 10 |
| `scripts/b17-workspace-proof.ts` | **exit 0** (dynamic “all 25 unactivated denied”) | 15 |
| `scripts/b17-domain-proof.ts` (exit captured on a clean scratch) | **exit 0** — 62 flips, 25×4 denials | 31 |
| **QA-authored probe** `b17-u2e-qa-probe-e3.cjs` (temp, outside repo; `…_qa6_scratch` + postgres oracle) | **exit 0 — all phases green** | 14 |
| **Total** | **8/8 executor scripts + QA probe green** | **120 PASS** |

The scope script (`b17-scope-proof.ts`, contains `DELETE FROM assignments`) was **never run**, per contract.

## 25. Headline reproduction of the E-2 FAIL probe + oracle truthfulness

- **HEADLINE (QA, real dispatcher→requireDomainAccess→domainTransaction→handler):** tenant Q seeded with **1 linked+complete item (`QA3-QMAP-ITEM`) + 1 never-linked assignment (`QA3-QUNMAP-ITEM`, oracle unmapped=1)** → `POST /reviews/ge-final {scope:'tenant', confirm:true}` as W → **`409 scope.unmapped`, `snapshots(Q)=0`**. (E-2 recorded `201` + subset snapshot here — now closed.)
- **Oracle matrix (definer == independent superuser oracle):** Q `1==1`, A (`D-FOREIGN` unlinked) `1==1`, B `0==0`; after mapping repair Q `0==0` and A `0==0`. Tenant A ge-final now refuses `409 scope.unmapped` (snapshots(A)=0) and, after repair, refuses on **completeness** (409, never `scope.unmapped`).
- **Complete tenant → full freeze:** after mapping Q's second standard, ge-final → **201**, snapshot `…`, payload **`items = 2` = `QA3-QMAP-ITEM, QA3-QUNMAP-ITEM`**, `content_hash eb8a0ab27751…` — the FULL authorized scope, no subset filtering.
- Definer scope check: the kind raises `b17.count_context` outside the exact W-GE-consultant-own-tenant context (fail-closed), `SECURITY DEFINER` count still 2, REVOKE-PUBLIC/owner-ACL untouched; live fingerprint **`8c8f60bf7af9cbc5bd6f483b5b0dc715`** == `B17_CONTENT_SHAPE` == live `STRUCTURE_SQL` checksum.

## 26. BF-01 reverse window (ruling 1b) — QA reproduction

Orchestrated: holder acquires `b17.freeze:<Q>` → **ge-final queued first** → gri-commit passed its **PRE-lock** freeze read (false — freeze not yet committed) then blocked on the SAME key → oracle-polled `pg_stat_activity` until **≥2 lock waiters** → release. Result: **ge-final 201 first (full 2-item payload + hash)**, then gri-commit **200 with `departmentsUpserted=0` and `assignmentsCreated=0`** (in-lock recheck `is_scope_frozen` → `deptToItemIds.clear()`), tenant Q counts **departments 1 / assignments 2 unchanged**, exactly **1** snapshot. Source pins: one lock line per side, seed `1717005`, recheck strictly after the lock (`routeGates.test` + QA static assert).

## 27. §10 rulings 2–6 and the remaining contract surface (re-run)

- **Ruling 2 (client-* handler guards):** static — exactly **2** `user.role !== 'client_admin'` sites (client-approve + client-return); HTTP — ge_admin reaches neither (dispatcher `403 workspace.mode_mismatch` re-proven for W and P on both routes). Fail-closed either way.
- **Ruling 3 (approvals pin):** live `pg_policies` shows `b17_approvals_insert WITH CHECK` containing `b17_item_visible`; **QA negative:** employee E(dept1) INSERT of an approval onto dept2's answer → **RLS `42501`, row count unchanged**.
- **Ruling 4 (six read catches):** static — **6** `readFailure(res, err, …)` sites, **zero** `code: err.code`; QA dynamic — all six read routes with malformed input → **400 + `code=scope.id_invalid` + NO raw PG text/SQLSTATE** (`invalid input syntax|SQLSTATE|22P02|42501|…` absent from every body).
- **Ruling 5 (notes full-visibility):** static — 2 identical `snapshotPayloadFullyLinked(client, access, snapshot.payload)` call sites; QA dynamic — note on the mixed snapshot → **403 `scope.not_visible` with ZERO `snapshot_notes` row**; the 2,000-char cap and append-only 201 path unchanged (e2 D3).
- **Ruling 6 (Shield-02):** dead-branch class addressed by the same count path — the preflight is no longer dead (§25), no separate defect remains.
- **§3/OD-08 matrix (full):** submit/approve/**dept-return** × {W,C,P}; correct × {P} (C in e2); client-approve/client-return × {W,P,E}; ge-final × {C,E,P}; notes × {P,C,E}; fresh evaluation × {C,W,P} → all **403 `workspace.mode_mismatch`**; malformed `:id`/`itemId`/`departmentId`/`scopeRef`/`clientId` → **400 `scope.id_invalid` before SQL**.
- **Lifecycle:** versions **1→12 lockstep** across save/resave/submit/**dept-return**/re-submit/approve/**W correct**/C confirm/C return/re-submit/re-approve/C confirm; self-preliminary label present; 400/409 version payloads correct.
- **G-SHARED:** second-department write **409 `scope.shared_ambiguous`** before any upsert; E/E2 `evaluation:null` + empty history; W reads it; original 2-answer+1-evaluation pair **byte-identical**.
- **§9(a) history:** W/C/E **12/12/12** rows, all `entity_type='evaluations'` **and** `entity_id` bound; shared item 0; `/audit-log` still **403** for C+E; foreign tenant 0 rows; CB foreign item 404.
- **Concurrency (UPDATE-then-INSERT):** fresh race `[201,400]`, same-version race `[201,409 version.conflict{expectedVersion:2}]`, lockstep v2/v2, 1 eval + 1 answer, no lost update/duplicate/500.
- **Readiness:** dropping the E-3-touched `b17_approvals_insert` → `b17.schema_drift`; `GRANT EXECUTE … b17_content_fact … TO PUBLIC` → `content_authority_drift`; both rolled back → fingerprint + `assertB17Ready()` green.
- **Registry:** base 40 → the same **15** evaluations flips → **25 UNACTIVATED (no NEW flips this round)**, all 95 rows method/path/capability/**matrix deepEqual**, order identical, remaining 25 admin-only, capabilities truthful (9).

## 28. Not verified / out of scope (honest limits)

- **Semgrep CLI / Trivy**: not run this session — NOT VERIFIED here.
- **Playwright E2E / axe**: SKIPPED — no Playwright config/`tests/` suite in the repo; no UI change.
- `b17-scope-proof.ts` deliberately not run (contains `DELETE FROM assignments`); executor's e2c/e2/e2b claims were re-run by QA rather than adopted, but their internal oracle helper was cross-checked only through QA's own independent oracle (same definition, separate connection).
- BF-01 reverse window proven for ONE deterministic ordering (freeze lands first, provisioning skipped); the symmetric provisioning-first ordering is covered by e2b's held-key test (QA-run).
- No commit/push/deploy/release acceptance; round 3 of 3 consumed per unit §10.

## 29. Environment and signatures

Windows PowerShell 5.1 / Node v22.22.2 / npm 12.2.2 / Docker 29.9.2 / PostgreSQL 18 (`postgres:18`), session date 2026-11-14.
QA container `b17-u2e-qa-e3-20261114` created, used for 10 fresh scratches, **disposed** (`docker rm -f`) after evidence capture; only pre-existing `b17-e1-1794615832579` remains (not QA's, untouched).
— QA & Acceptance Agent (مُختبر), Execution Mode, independent session RESUME. **E-3 / FINAL verdict: PASS** (E-2 FAIL root cause closed; no new functional failure).