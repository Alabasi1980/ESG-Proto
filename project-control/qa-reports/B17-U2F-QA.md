# Independent QA Report — TASK-PROTO-B17-U2-F (round 1: 22 non-provisioning admin rows)

## 1. Verdict

**PARTIAL** — executed independently in this session (no executor result adopted as evidence; every number below is
my own measurement or a run I performed). All access/security gates PASS: 25 -> 3 UNACTIVATED is exact, every §3.4
allowed context is served and every disallowed context refused with the §3 code, the 3 provisioning rows stay denied
in all four contexts, no over-grant, no credential/OTP leak, protected set byte-unchanged.

**One contract item needs a Tera ruling (see §7):** the `unmapped` flag on the P `/clients` per-service progress
projection is implemented as a **client-level boolean repeated on every service entry**, not as a per-service flag.
I judge this to be **not** the §6 `services[{...unmapped}]` per-service flag (UI binding B17_UI_BINDINGS.md line 76:
`unmapped=true` -> "Service standards not mapped; distinguish mapped-but-unassigned"; §6 also requires a truthful
GRI "unmapped/setup notice"). Evidence in §7. No security impact; fixable inside the round-3 scope if Tera reads the
UI binding as governing.

Scope: round 1 only — the 3 provisioning rows (POST /users, PATCH /users/:id, POST /staff-lists/:id/approve) remain
UNACTIVATED until the round-2 lock-order proof. Report-only artifact: no application source, `.env`, dependency,
schema, cloud, commit, push or agent change was made by QA.

## 2. Authority, base and independently discovered delta

- Conduct gate re-read first (`tera-system/TERA_AGENT_CONDUCT.md`); unit contract `prototype/TASK-PROTO-B17-U2-F.md`
  (§2 five lines / 22+3 split, §3 pre-authorisations, §4 allowlist, §5 evidence) and spec
  `prototype/B17_TECHNICAL_SPEC.md` §3.4 (25 rows), §4, §5, §6, §8 read before testing.
- Base verified by execution: `git rev-parse HEAD = c95ff661da5294ef9b6650acf22beefe30ad4dac` (worktree clean at base,
  local only, no fetch/push).
- QA-discovered tracked delta vs base: **15 files, 606 insertions, 1 384 deletions**, plus 9 untracked files:
  - `src/db/b17-content.sql` (+221/-?, SHIELD-U2F-01: platform.config summary reads, P@T link/flag/unlink, assignments
    DELETE, staff draft/submit/reject rows, W-only N/A inserts, P@T notify/audit branches, `tenant.item.*` count kinds —
    no new SECURITY DEFINER, no PUBLIC grant, no DELETE on answers/evaluations/approvals)
  - `src/db/b17Readiness.ts`: `B17_CONTENT_SHAPE = 1c2e0291e8db67dec7a79efc17df0a3f` (matches the task's expected shape)
  - `src/server/accessRegistry.ts` (+15/-0): additive 22-key activation block only; **99/99 matrix strings byte-identical
    to base** (QA diffed both versions programmatically: no reword, no add/remove)
  - `src/server/routes/admin.ts` 315 lines (base ~1 650): only the 25 declarations + middleware + the 3 round-2 legacy bodies
  - new splits (all <500 lines): `adminCommon` 77, `adminDirectory` 128, `adminPlatformOps` 83, `adminAssignments` 257,
    `adminStaff` 359, `adminClients` 443
  - `src/server/routes/_shared.ts` (+writeFailure E3-02; **deleted** `b11bOwnTenantScope`, `b11bAssertTenantActive` —
    no remaining call sites, lint exit 0)
  - `src/server/routes/evaluations.ts`: **comment-only** (QA filtered the diff: every +/- line is a `//` comment,
    the E-2c/E3-02 comment correction folded in per §3(3))
  - `src/lib/*` tests (routeGates/domainAccess/capabilities/b17DomainPolicies) — allowlisted
  - proof scripts: `b17-domain-c-proof`, `-d-proof`, `-proof`, `-e1`, `-e2` (flip-expectation updates 25->3 and
    capabilities 9->10 only — I diffed them line by line; no assertion was removed or loosened)
  - untracked: `scripts/b17-domain-f1.ts` (348 L), `b17-domain-f2.ts` (380 L), `b17-domain-f-run.ts` (77 L)
  - `prototype/U2_LEGACY_HELPER_RETIREMENT.md` carries the U2-F row (admin.ts retirements + `_shared.ts` delta); QA
    verified its claims against source.
- Protected set byte-unchanged: `git diff --quiet c95ff66 -- src/db/b17.sql src/db/schema.sql src/db/b17ContentMigration.ts
  src/lib/scoring.ts src/lib/approvalChain.ts package.json package-lock.json` -> **exit 0**; `git status` shows no
  auth/workspace/session/system handler, no UI/view/i18n file, no lockfile, no `.env`. **scoring.ts/approvalChain.ts
  byte-unchanged confirmed.**
- Concurrent `security-reports/B17-U2F-fix-review.md` (Shield, untracked, appeared mid-session) observed as a disjoint
  owned file; **not read, not used**; QA did not stop on it.

## 3. Static checks (executed, not adopted)

| Check | Result |
|---|---|
| `npm run lint` (`tsc --noEmit`) | **PASS, exit 0** (no diagnostics) |
| `npm test` | **PASS, exit 0 — 182/182 tests, 0 fail, 0 skipped, 5 suites, 4 930 ms** (claim of 182 verified exactly) |
| `npm run build` (no-env; no `.env` present) | **PASS, exit 0** — vite 8.3.7, 1 690 modules, dist emitted (2 size warnings only) |
| E3-02 static rule | `routeGates.test.ts` asserts every write catch in the 5 split files routes through `writeFailure` (>=20 catches, matched exactly) + unit cases: raw PG -> static fallback, own status/message/code pass, suspend flag preserved |

## 4. Executor harness — re-run by QA on fresh named scratch DBs (result NOT adopted a priori)

Command: `node --import tsx scripts/b17-domain-f-run.ts --allow-disposable-b17 --all` (guards read first: explicit
`--allow`, refuses ambient `.env`/`DATABASE_URL`/`PG*`, per-proof loopback `b17_*scratch*` URL + postgres superuser
same-DB count-oracle, NOSUPERUSER/NOBYPASSRLS owner, FORCE, seed-only; `scripts/b17-scope-proof.ts` — the script with
`DELETE FROM assignments` — is **not** in any f-run list).

| Result | Value |
|---|---|
| Exit code | **0** — `ALL GREEN: 10 proof(s)`, 123 `PASS` lines, 10 fresh DBs `b17_u2f_scratch_0..9_<ts>` |
| Run | f1, f2, domain, c, d, e1, e2, e2b, e2c, workspace — each on its own disposable PG18 container |
| f1 headline | **88 matrix probes = 40 allowed served + 48 refused 403 `workspace.mode_mismatch`; 25 -> 3 exact; 95 routes / 92 U1 / 3 UNACTIVATED; capabilities truthful (10)** |
| f1 census | `clients +1, evaluations +1, answers +1, staff_lists +2, staff_list_rows +2, client_services +6 (explicit link-all), assignments 0, users 0, review_snapshots 0`, all others 0 |
| f1 masking | duplicate code -> 500 `{error:'Failed to create client tenant'}` (no message/SQLSTATE); own 404/403 pass |
| f2 headline | 6 service entries equal its superuser oracle, frozen pairs = 1, no score/gap field; dashboard `show_gap` nulls for C **and** W; unlink -> business rows preserved + visibility revoked + **next ge-final 409 `scope.unmapped`, snapshots 0**; N/A W-only creates 1 evaluation + 1 answer, P/C/E 403, repeat 409; staff C draft->submit, **approve 403 `access.unactivated`, users +0, no credential field**; suspend wall 200 `{suspended:true}` + no data + restore, W/C/E cannot suspend |

## 5. My own independent probe (harness written outside the repo; not the executor's scripts)

Driver: fresh disposable `postgres:18` container, loopback, role `qau2fowner` NOSUPERUSER/NOBYPASSRLS, database
`b17_u2f_qa_scratch_*`, no ambient `.env`/`DATABASE_URL`/`JWT_SECRET`/`PG*`, seed-only fixtures inserted before
activation, every drift probe rolled back, real HTTP through `accessDispatcher -> requireDomainAccess -> server-
selected context -> handler`. Exit **0**, 19 `PASS` blocks + judgment line.

| # | Independent check | Result |
|---|---|---|
| 1 | Registry re-derived | 95 routes, **UNACTIVATED == exactly {POST /users, PATCH /users/:id, POST /staff-lists/:id/approve}**, 92 U1, capabilities 10 incl. `admin` |
| 2 | Provisioning triple x4 contexts (12 probes) | all **403 `access.unactivated`**, `users` count unchanged |
| 3 | GET /clients | P: every row has `services[]`, no score/gap/value/answer/credential field; **C: exactly 1 row = own tenant, no progress block (not enumeration), cross-T 403 `scope.*`**; W 403 `workspace.mode_mismatch`; `?search=` narrows to 1; duplicate `search=` params -> 400 `scope.search_invalid` |
| 4 | GET /ge/overview | `{totals}` only, keys exactly `{clients,active,suspended,services,pendingStaffLists}`, deepEqual oracle `{clients:7,active:7,suspended:0,services:4,pendingStaffLists:0}`; no forbidden field; W 403 |
| 5 | GET /departments | P@T pinned, **400 `scope.id_required` without T**; W/C own; **E exactly 1 row = own department, exactly the 7 metadata keys (no roster/users)**; E cross-T 403 |
| 6 | PATCH /departments/:id/head | positive 200; **foreign-T dept 404, cross-T head 400, other-department 400, malformed UUID 400 (no raw 22P02), inactive user 400, clear 200, W 403** |
| 7 | GET /users | `?clientId` pinned to T with **no cross-tenant bleed**; platform scope returns **exactly the oracle count of `client_id IS NULL` accounts** (non-vacuous: QA inserted one GE platform fixture; the seed's `ge` deliberately has a client_id); no password field; W 403 |
| 8 | GET /clients/:id | exactly `{client,services,departments,users,staffLists}` — **no assessments/credentials/score/value**; W own 200, W cross-T 403, E 403 |
| 9 | POST/DELETE /assignments guards | unlinked item **403 `scope.item_unlinked`**, cross-T department 400, frozen tenant 409, own create 201 -> delete 200 -> second delete 404, **existing answers/evaluations blocker 409** |
| 10 | GET /assignments scoping | **P@T = 6 (all rows incl. the orphan), W = C = 5 (L: orphan hidden), E = 4 (L+D: own department + linked only, never the unmapped item)**; E other-department filter 403. All four numbers equal independent superuser SQL |
| 11 | GET /staff-lists | C own-company, W bound-A, P@T pinned, P without T 400, E 403, no credential field |
| 12 | E3-02 (extra cases) | `serviceId: 'not-a-uuid'` -> **500 `{error:'Failed to link service'}` exactly (no `code`, no 22P02/SQLSTATE/PG text)**; own `scope.id_invalid` -> 400 with its own code |
| 13 | Progress vs my own superuser oracle | **9 service entries**: mapped/assigned/submitted/pending/frozen all equal; `pending = assigned - submitted`; `frozen <= assigned`; **`unmapped` == (E-3 count > 0) for every entry** (see §7) |
| 14 | link-all never automatic | `client_services` for the never-linked service = **0** after activation + all probes (only the explicit route exists — one mount, one handler, no other caller) |
| 15 | Readiness refusal + recovery | **drop a NEW SHIELD-U2F-01 policy (`b17_admin_links_delete`) -> `verifyB17Content` rejects `schema_drift`**; **`GRANT EXECUTE ... b17_catalog_child_count TO PUBLIC` -> `content_authority_drift`**; both recover on rollback; `STRUCTURE_SQL` checksum == `1c2e0291e8db67dec7a79efc17df0a3f` before/after |
| 16 | Non-destructive census | every business table delta **0**; `audit_log +12` (append-only, audited writes), `notifications +0`; readiness green at the end |

## 6. Contract items covered by the executor proofs + re-verified by my reading of the code

- NA shortcut (row 19): matrix `W` only -> P/C/E 403 `workspace.mode_mismatch` (f1/f2, 6 probes); row scope in
  `b17-content.sql` pins `mode='consultant' AND role='ge_admin' AND not_applicable AND score IS NULL AND na_reason IS
  NOT NULL AND retained assignment` — no scored evaluation can be minted; handler guards (retained assignment 403,
  freeze 409, existing evaluation 409) intact.
- Staff flow (rows 20/21/22/24): draft INSERT policy `status='draft'` + actor-bound; work-context UPDATE `WITH CHECK`
  only allows `('submitted','rejected')` — **a work context cannot mint `approved`**; approve stays behind the
  dispatcher. Reject keeps the reason (f2) and notifies only an in-tenant submitter.
- Suspend (row 10): P-only at the matrix ring; the wall itself lives in `/auth/login` (200 `{suspended:true}`, no
  token) and `tenant.suspended` 403 on existing sessions — both re-run green in f2.
- Dashboard (row 25): body is byte-equivalent to the base U2-C implementation (QA diffed base `admin.ts` L1396-1508 vs
  the new `adminStaff.clientDashboard`: only context wiring `b11bOwnTenantScope/contextFromUser` -> `ownTenant/readContext`
  and the catch -> `writeFailure` differ; the scoring math and `gapVisible` nulling are unchanged).
- Unlink (row 14): deletes only the `client_services` row; `b17_admin_links_delete` is target-bound P@T; visibility
  revokes through the mapping predicate (proved end-to-end in f2) and the §8 preflight then refuses 409 `scope.unmapped`.
- `/clients` progress and `/ge/overview` run under the one NULL-target `platform.config` context (§5 enumerated
  exception); the handler projects count/pair columns only — no `answers.value`, no evaluations read for P anywhere
  (`b17_admin_summary_read` exists on answers for the fixed-aggregate read; c-proof R5 still asserts answers rows are
  unreachable under target-bound config and under the work context).

## 7. Judged item — the `unmapped` flag is client-level, not per-service

Executor's reading (declared in `adminClients.ts` header): *"the client-level §8 flag (>=1 assignment outside every
linked service's mapped item set) repeated on each service entry"*; its f2 oracle asserts the same client-level
population, so its own proof cannot detect the divergence.

My independent construction (fresh scratch, two probe tenants):

| Fixture | Observed | Per-service reading |
|---|---|---|
| **T1** — one linked service (`D-EMPTY`) with **0 mapped items**, no assignments | `mappedItemCount=0`, **`unmapped=false`** (E-3 count 0) | should be `true` ("Service standards not mapped") |
| **T2** — two **fully mapped** services + 1 assignment outside every linked set | both entries `mappedItemCount>0`, **`unmapped=true`/`true`** (E-3 count 1) | should be `false` (standards ARE mapped) |
| all 9 service entries in the run | `unmapped` **never varies within a client**; equals `E-3 count > 0` exactly | — |

**Judgment:** the value is truthful for the only unmapped population §6/§8 define operationally (the §8/E-3 tenant
count), and the ge-final preflight is correctly tied to it — but it is **not** a per-service flag: it is a tenant
boolean carried inside the per-service object. Consequences: (a) a genuinely unmapped linked service never gets the
"Service standards not mapped" badge unless the tenant also has an orphan assignment; (b) every service of a tenant
with an orphan shows that badge even when its standards are mapped; (c) the §6 GRI "truthful unmapped/setup notice"
would not surface in case (a). `B17_UI_BINDINGS.md` line 76 defines the flag's meaning as per-service.

This is a §6/UI-binding projection semantics defect, **not** a §3 access failure: every §3.4 row-1 access promise
(searchable P list, per-service counts truthful, no scores/gaps, C own row, W/E denied) holds, there is no over-grant
and no leak. Hence **PARTIAL** with a MUST-DECIDE: if Tera confirms the per-service reading, derive the flag from the
service's own mapping chain (e.g. `mappedItemCount === 0`) in round 3 — no access rework required.

## 8. Notes for Tera (disclosed, not failures)

1. `scripts/b17-domain-e1.ts` / `b17-domain-e2.ts` do **not** literally match the §4 glob `scripts/*proof*.ts`, yet
   were edited. I diffed both: only flip-expectation constants/capabilities (25->3, 9->10) and pass-message text — no
   assertion was dropped or loosened (e1 still asserts `denied === 3*4` across four contexts; e2 still asserts the
   remaining set is the admin capability). Substantively legitimate (the round plan requires these proofs re-run
   green); flagged only as an allowlist-glob naming question.
2. c-proof R3's client_services assertion was necessarily rewritten ("impossible in every context" -> "impossible from
   work/foreign-target/NULL-target contexts") because §3(1) pre-authorises the P@T link/flag/unlink writes; the
   negative ring is preserved and the sanctioned positives are proved end-to-end in f1. Accepted.
3. The three round-2 provisioning handlers still carry their legacy bodies (`contextFromUser`, `b11bRequireGeAdmin`,
   un-masked `catch` echoing `err.message`) — unreachable this round because the dispatcher refuses first (proved x4
   contexts) and §3(2) permits the deferral. They must be retrofitted with `writeFailure` + the lock-order fix in R2.
4. `b17_admin_summary_read` gives the NULL-target platform configuration context a SELECT row on `answers` (§5's
   enumerated fixed-aggregate exception). The only handler in that context projects counts/status; no value/blob is
   ever selected or returned (proved: no forbidden field in `/clients` or `/ge/overview`).

## 9. Not verified by QA (explicit)

- Runtime OTP-once behaviour of `POST /staff-lists/:id/approve` — the row is UNACTIVATED, so only the 403 refusal,
  `users` unchanged and absence of credential fields could be verified; the provisioning semantics are R2 scope.
- Lock-order/deadlock proof for provisioning (parent §15) — R2 scope, not exercised.
- `npm run lint/test/build` only; **Semgrep local rules + Trivy unchanged-deps** (task §5 line 41) were **not** run by
  QA in this round (not part of this round's QA instruction) — unverified.
- No Playwright/UI E2E: no UI file changed this round and the P Clients view does not exist yet (spec §9 future work);
  nothing UI-testable in scope.
- Concurrent Shield review outcome (file not read).
- Deployed/cloud behaviour: out of scope and untouched.

## 10. Evidence locations

- Executor harness full log (my run): `%TEMP%\opencode\u2f-all.log` (787 lines, 123 PASS, exit 0)
- Independent probe + driver (QA-owned, outside the repo): `%TEMP%\opencode\qa-u2f-probe.ts` (487 lines),
  `%TEMP%\opencode\qa-u2f-run.ps1`, last run log `%TEMP%\opencode\qa-u2f-probe.log` (container `qa-u2f-1794651818518`,
  db `b17_u2f_qa_scratch_1794651818518`, `PROBE_EXIT=0`)
- Registry/matrix comparison: QA-authored base-vs-worktree extraction of all 99 matrix strings (identical), plus
  `git diff --stat` / `git diff --quiet <protected set>` outputs quoted in §2.

## 11. QA signature

Independent QA Agent (session NEW, neutral, contract-only) — 2026-11-14. Verdict: **PARTIAL** (all security/access
gates PASS; one §6 `unmapped` per-service semantics decision required before acceptance).

---

# Independent QA Report — TASK-PROTO-B17-U2-F — ROUND 2 (FINAL, continuation of the usage-limit-interrupted round)

## R2.1. Verdict

**PASS** — every one of the eight §8 rulings verified with MY OWN probes (no executor
result adopted), the exact final flip state **0 UNACTIVATED / 95 U1** independently
re-derived from the registry for all 95 keys, full 25-row §3 matrix green through the
real dispatcher→wrapper→context→handler chain, and **no new functional failure**
(static + harness + independent probe all exit 0). Round 1 stays **PARTIAL** on its own
record below; its one MUST-DECIDE (§7 `unmapped` semantics) is **RESOLVED per §8(2)**
and re-verified as per-service in this round (§R2.5). Report-only artifact: no app
source, `.env`, dependency, schema, cloud, commit, push or agent change was made by QA.

## R2.2. Authority, base and independently discovered delta

- Conduct gate re-read first (`tera-system/TERA_AGENT_CONDUCT.md`); unit contract §2/§3/
  §4/§5/**§8 (eight rulings)**/**§9 (interruption + disk-truth continuation rule)** and
  spec §3.4/§5/§6/§8 read before testing.
- Base by execution: `git rev-parse HEAD = c95ff661da5294ef9b6650acf22beefe30ad4dac`
  (local only, no fetch/push); worktree still uncommitted — this is the SAME round-2
  contract as the interrupted session, no round charge.
- QA-discovered full U2-F delta (round 1 + round 2 persisted work): **15 tracked files
  modified (795+/1680−)** + **14 untracked** — `adminProvisioning.ts` (343 L, R2-A
  lock-order + R2-B `platformConfigContext` markers), `adminClients` (476) /
  `adminStaff` (361) / `adminAssignments` (257) / `adminDirectory` (135) /
  `adminPlatformOps` (94) / `adminCommon` (91) / `admin.ts` (77, declaration shell);
  `accessRegistry.ts` +15 (explicit exact-key 25-key flip list inside the admin group);
  `b17-content.sql` +242/−7 (SHIELD-U2F-01 incl. round-2 `b17_admin_users_insert` /
  `b17_admin_users_update` + USER_*/STAFF_LIST_APPROVED audit rows, **no new SECURITY
  DEFINER, no PUBLIC grant, no DELETE on answers/evaluations/approvals**);
  `b17Readiness.ts` `B17_CONTENT_SHAPE = 5d5ddb9344225a53059da3f7d92bdd94` (fingerprint
  recomputed; verified by execution, §R2.5); `_shared.ts` (+`writeFailure`, retired
  `b11bRequireGeAdmin`/`b11bAssertPasswordFresh` with zero call sites left);
  `evaluations.ts` **comment-only** (every ± line is a `//` — QA diffed both directions);
  tests + proof-script flip-expectation updates; untracked f1/f2/f3/f-lock-proof/f-run.
- Protected set **empty-diff vs base**: `git diff --quiet c95ff66 -- src/db/b17.sql
  src/db/schema.sql src/db/b17ContentMigration.ts src/server/auth.ts
  src/server/workspace.ts src/server/routes/session.ts src/server/routes/system.ts
  src/lib/scoring.ts src/lib/approvalChain.ts package.json package-lock.json` →
  **exit 0** (`scoring.ts`/`approvalChain.ts` byte-unchanged confirmed); `git status`
  shows **no UI/view/i18n/context/component file, no `.env`, no lockfile** (29 status
  entries, all allowlisted U2-F files + the two reviewer-owned reports).
- **Matrix strings byte-identical**: my source-level extraction of all transcribed
  `'METHOD path|matrix'` strings vs `git show c95ff66:...accessRegistry.ts` →
  **99/99 exact**; plus per-key `formatMatrix()` deep-equal for all 95 declarations —
  **only the explicit flip list differs**.
- The concurrent `security-reports/B17-U2F-fix-review.md` (Shield, disjoint owner file)
  was observed in `git status`, **not read, not used**; QA did not stop on it.

## R2.3. Static checks (executed, not adopted)

| Check | Result |
|---|---|
| `npm run lint` (`tsc --noEmit`) | **PASS, exit 0** |
| `npm test` | **PASS, exit 0 — 186/186 tests, 0 fail, 0 skipped, 5 suites, 10 786 ms** (Tera's 186 claim verified exactly) |
| `npm run build` (no-env; `.env` absent) | **PASS, exit 0** — dist emitted (2 size warnings only) |
| E3-02 static (my own scan) | **25/25 outer catches** across the 7 admin files route through `writeFailure`; no `err.message`/`err.code` echo pattern anywhere |
| SELECT* pin (my own scan) | P-summary files projection-only: `adminClients` = **1 explicit `answers` + 1 explicit `review_snapshots`** read, `adminPlatformOps` = **0**, no `SELECT *`, no `FROM evaluations`; `routeGates.test.ts` pin test green in `npm test` |

## R2.4. Executor harness re-run by QA (result NOT adopted a priori)

`node --import tsx scripts/b17-domain-f-run.ts --allow-disposable-b17 --all` (guards read
first: explicit `--allow`, refuses ambient `.env`/`DATABASE_URL`/`JWT_SECRET`/`PG*`, own
disposable PG18 container, loopback, NOSUPERUSER/NOBYPASSRLS owner + `b17domainoutsider`,
per-proof fresh `b17_u2f_scratch_*` DB, seed-only; `b17-scope-proof.ts` — the script with
`DELETE FROM assignments` — is in **no** run list and was never executed):

- **Exit 0 — `ALL GREEN: 11 proof(s)`, 132 PASS lines, 11 fresh scratch DBs**: f1, f2, f3,
  domain, c, d, e1, e2, e2b, e2c, workspace (the eight regression proofs re-run green on
  fresh scratch after the final flips).
- f3 headline (re-verified by my own probes below): exact 3→0 flip truth; lock order with
  the CONCURRENT deactivate probe; OTP-once; all-or-nothing; readiness drop of the NEW
  policies → `schema_drift` → recovery; census exact.
- f1: 88 executor matrix probes (40 served/48 refused) — subsumed by my independent
  173-probe matrix below; f2: per-service `T1=true/T2=false` + unlink→ge-final chain.

## R2.5. My independent probe (QA-owned, outside the repo — executor scripts not used as evidence)

Driver: fresh disposable `postgres:18` container, loopback, role `qau2fowner`
NOSUPERUSER/NOBYPASSRLS, database `b17_u2f_qa_scratch_*`, no ambient env, seed-only
fixtures before the census baseline, every drift probe rolled back, real HTTP through
`accessDispatcher → requireDomainAccess → server-selected context → handler`.
**Exit 0 — 28 PASS blocks** (log 58 lines).

### R2.5.1 The eight §8 rulings — each with my own probes

| # | Ruling | My verification |
|---|---|---|
| 1 | W/C `client-detail users[]` stripped | W **and** C own-detail `users[]` entries are **exactly** `{id,name,role,department_id,created_at}` (6+6 entries) — zero `is_active`/`must_change_password`/`email`; P keeps `is_active`+`email`; no credential field in any projection |
| 2 | `unmapped` per-service | 9 service entries vs my own superuser oracle: `unmapped === (own mapped items == 0)` for **every** entry; **T1 (EMPTY, 0 mapped) → true**, **T2 both fully-mapped entries → false despite 1 client-level orphan**; client-level orphan **still** gates ge-final (T2 → 409 `scope.unmapped`, snapshots 0) |
| 3 | SELECT* pin | Own source scan (comments stripped): P-summary paths projection-only as tabled above; **executor's disclosure confirmed**: `evaluations.ts:142` sits in `loadEvaluationWithAnswer`, `:472` in `router.post('/evaluations')` = the E L+D draft/save route — file imports **no** platform context (`platformConfigContext|platformGlobalContext|contextFromUser`: 0 matches) → **work-context E-draft paths, outside ruling-3's P-summary scope. Classification accepted** |
| 4 | link-all confirm | Before any explicit call UNLINKED service = **0 links** (never automatic); without `confirm:true` → **400 exact body, links still 0**; with `confirm:true` → 200, `linked ==` unlinked-clients count, audit `LINK_SERVICE_ALL_TENANTS` count matches; full restore via the unlink route → net 0; W/C/E → 403 |
| 5 | Provisioning substrate | `POST /users` P@T → 201 + `USER_CREATED` audit (payload shape exactly `actor,actorRole,createdRole,email,targetTenant`, no credential); dupe → 409 (no PG text), cross-T dept → 403 `scope.tenant_mismatch`, no-dept → 400 own message, ghost-dept → 404; both `b17_admin_users_insert`/`_update` policies exist under the matching fingerprint; drop of the NEW policy → `schema_drift` → rollback recovers |
| 6 | E3-02 masking | 25/25 catches static; runtime: raw `22P02` → **500 exactly `{error:'Failed to link service'}`** (no code/SQLSTATE/PG text); own `scope.id_invalid` → 400 with its own code; fault-injected provisioning failure → 500 static fallback with no leak |
| 7 | Staff approve OTP-once + provisioning semantics | approve P@T issues OTPs **in that response only**: bcrypt `comparePassword(otp, hash)` true, stored ≠ plaintext, `must_change_password=true`; 2nd approve → 409 **without OTP**; no `/users`, `/clients/:id`, `/staff-lists` projection and no audit payload ever echoes an OTP (value scan); all-or-nothing: same-tenant dup → 409 (0 users) **and** in-batch cross-tenant dup → 409 with the already-inserted row rolled back (0 users, list still `submitted`); cross-T approve → 403 `scope.tenant_mismatch` (0 users), ghost → 404, P@T reject keeps reason without provisioning; deactivate revokes sessions (old bearer **401**, `revoked_at` set), reactivate+login retry green; **self-deactivation 400** with sessions untouched; wrong-T → 404; malformed → 400 `scope.id_invalid` |
| 8 | adminCommon comment | Corrected text present (`Shield Low-3, comment corrected per round-2 ruling 8`) **and** its claim verified against source: `listUsers` without `?clientId` uses `readContext` (platform-scope branch), and that file never touches tenant/answer/evaluation rows |
| + | **Lock order (parent §15)** — own CONCURRENT probe | With a live request of the target holding `users FOR SHARE`, the deactivation **queued at `auth_sessions … FOR UPDATE`** (sessions-before-users, discriminated: users-first could never show that blocked statement); release → **reader 200 + writer 200, no deadlock**; sessions revoked (401); reactivate + login retry green. **Rollback safety** (own in-process fault injection failing the audit insert after the users UPDATE + session locks): 500 static fallback, user **still active**, sessions **not** revoked, no audit row; clean retry succeeds then restores |

### R2.5.2 Exact final flip state (independent re-derivation)

- Importing BOTH registries (worktree + `git show c95ff66:`): 95 declarations each;
  **UNACTIVATED == [] → 0**, **U1 == 95**, activation values are exactly `{U1}` (a typo
  key would fail closed as `access.activation_unknown` at build);
- Per-key diff vs base: **EXACTLY the 25 admin keys changed** (base UNACTIVATED → U1);
  **all 70 non-admin rows untouched** (activation + capability identical);
- `activeBusinessCapabilities()` deepEqual **exactly 10**: taxonomy, gri, evaluations,
  **admin**, actions, initiatives, reports, storage, audit, notifications;
- **Capabilities truthful (10)**, matrix strings 99/99 identical (source + parse level).
  → **0 UNACTIVATED of 95 (95 U1) proven; other groups' rows untouched.**

### R2.5.3 The 25 rows' full §3 matrix (my own probes, round-1 method reused)

- **MATRIX-FINAL: 173 probes = 68 allowed served (2xx) + 70 disallowed refused 403
  (`workspace.mode_mismatch` or explicit `scope.*`) + 10 input gates 400
  (`scope.id_required`/`scope.id_invalid`/`scope.search_invalid`/confirm) + 25 anonymous
  401 — every one of the 25 rows exercised.**
- **Provisioning triple serves** for correct P@T (row 6 → 201; row 7 → 200 deactivate +
  reactivate; row 23 → 200 with OTP) and still refuses **W/C/E (403), anonymous (401),
  wrong-T** (cross-T dept 403 / cross-T user 404 / cross-T list 403) and malformed (400).
- Assignment scoping equals my superuser oracle: P@T=6 (incl. orphan), W=C=5 (linked),
  E=4 (own-dept linked); item-unlinked 403 `scope.item_unlinked`, cross-T dept 400,
  frozen 409, answer/eval blocker 409, create→delete→404; NA **W-only** (creates 1
  evaluation + 1 answer; P/C/E 403; repeat 409; NA pair undeletable).

### R2.5.4 Progress / unlink / suspend / drift / census

- **Progress vs my independent oracle**: 9 service entries — mapped/assigned/submitted/
  pending/frozen all equal, `pending = assigned − submitted`, `frozen ≤ assigned`;
  per-service `unmapped` as in ruling 2 (`2` flagged entries = the zero-mapped ones).
- **Unlink chain (mine)**: pre-unlink ge-final refuses only for **incompleteness** (§8
  preflight passes — T3 has no orphan); P unlink preserves **every** business row
  (assignments/evaluations/answers unchanged), revokes W visibility immediately
  (W count 0, P config count 1), then **next ge-final = 409 `scope.unmapped`**,
  snapshots stay 0.
- **Suspend wall**: W/C/E-can't-suspend refused **first** at the pure matrix ring (403
  `workspace.mode_mismatch`), then P suspend → login **200 `{suspended:true}` no token**,
  existing session 403 `tenant.suspended`, unsuspend restores fully.
- **Readiness drift (the NEW round-2 policy)**: drop `b17_admin_users_insert` →
  `verifyB17Content` rejects **`schema_drift`** → rollback → green; extra PUBLIC grant →
  `content_authority_drift` → rollback → green; fingerprint `5d5ddb9344225a53059da3f7d92bdd94`
  stable before/after; `FORCE RLS` on every RLS table; runtime role NOSUPERUSER/NOBYPASSRLS.
- **Non-destructive census** (baseline after fixtures): clients +1 (row-2 tenant), users
  +3 (row-6 + approve×2), client_services **−1** (only the chain unlink of a pre-baseline
  fixture link; link-all net 0), assignments +1, answers +1, evaluations +1,
  staff_lists +5, rows +7, review_snapshots **0**, 11 tables exactly 0, audit_log +65,
  notifications +6; readiness green at the end.

## R2.6. Round-1 reconciliation (its two judgment items)

1. **`unmapped` semantics — RESOLVED by §8(2)**: round-1's client-level reading is
   replaced by the per-service flag; I re-verified both directions myself (ruling-2
   probes) **and** that the client-level orphan still drives the §8 ge-final preflight.
   Round-1's PARTIAL verdict stands on its own record; the MUST-DECIDE is closed.
2. **e1/e2 script-naming note — RATIFIED (§8(8))**: `scripts/b17-domain-e1.ts`/`-e2.ts`
   carry only flip-expectation/capability constants + pass-message text (I diffed them
   again this round); both re-run green in the harness. Carried as disclosed, not failure.
3. Round-1 note 3 (legacy provisioning bodies) is **obsolete**: the three handlers now
   run `platformConfigContext` + lock order + `writeFailure` (rulings 5–7).

## R2.7. Notes for Tera (disclosed, not failures)

1. **Observation (pre-existing, base-unchanged, not a U2-F delta):** W/C
   `GET /clients/:id/services` returns the **parent-visible** subset of the bound
   tenant's links — the seed's content-empty `D-EMPTY` link is visible to P@T
   configuration (and flagged `unmapped=true` in the P progress block per ruling 2) but
   hidden from W/C by the U2-C1-era `b17_services` policy
   (`b17_parent_visible('service',id)`), whose text is byte-identical to base. Row 11's
   §3 promise (bound tenant, no cross-T) holds; no access failure — recorded as a
   product-semantics observation only.
2. Probe-design note: my first fault-injection attempt (ACCESS EXCLUSIVE `LOCK TABLE
   audit_log`) also blocked every request's dispatcher-time readiness fingerprint, so I
   switched to deterministic in-process injection of the single audit INSERT. No product
   defect asserted from that observation; it is documented for transparency.
3. `GET /users` platform-scope branch intentionally runs `readContext` (ruling-8
   exception) — reaches only `client_id IS NULL` accounts; non-vacuously verified
   against the superuser count.

## R2.8. Not verified by QA (explicit)

- **Semgrep local rules + Trivy unchanged-deps** (task §5 line 41) — not part of this
  round's QA instruction; still unverified (carried from round 1).
- **Playwright/UI E2E + axe**: no UI file changed this round (no view/i18n/context/
  component in `git status`); nothing UI-testable in scope.
- Deployed/cloud/DSN behaviour: out of scope, untouched. Shield's round-2 review outcome
  not read (disjoint owned file).
- Local integration ≠ parent acceptance; no acceptance/commit/push implied.

## R2.9. Evidence locations

- Executor harness log (my run): `%TEMP%\opencode\u2f-r2-all.log` (11 proofs, 132 PASS,
  exit 0, 11 fresh `b17_u2f_scratch_0..10_*` DBs)
- Independent probe (QA-owned): `%TEMP%\opencode\qa-u2f-r2-probe.ts` (≈990 lines),
  runner `qa-u2f-r2-run.ps1`, log `qa-u2f-r2-probe.log` (28 PASS, `MATRIX-FINAL
  served=68 refused403=70 gates400=10 anon401=25`, `PROBE_EXIT=0`, container
  `qa-u2fr2-*`, db `b17_u2f_qa_scratch_*`)
- Base extraction for registry/matrix comparison:
  `%TEMP%\opencode\qa-r2-base-accessRegistry.ts` (from `git show c95ff66:...`)
- Static/protected-set commands quoted in R2.2/R2.3 of this section.

## R2.10. QA signature (round 2)

Independent QA Agent (session NEW, neutral, contract-only; continuation of the SAME
round-2 contract per §9) — 2026-11-14. **Round-2 verdict: PASS** — all eight §8 rulings
verified by own probes, 0 UNACTIVATED of 95 proven, no new functional failure.

---

# Independent QA Report — TASK-PROTO-B17-U2-F — ROUND 3 (§10(1) buffer, session RESUME, disk-is-truth)

## R3.1. Verdict (UNIT)

**PASS** — round 3 is verified (both §10(1) fixes present, correct and covered by my own
probes) **AND my round-2 PASS still holds on the current source** (the unchanged R2 probe
re-run exits 0 with identical tallies). No new functional failure. Rounds 1–2 sections
above remain untouched; round 1 keeps its PARTIAL record and round 2 its PASS record.

## R3.2. Independently discovered round-3 delta vs my R2 manifest

- `git status --porcelain`: **same 29 entries** as my R2 manifest (15 tracked modified +
  14 untracked); HEAD still `c95ff661da5294ef9b6650acf22beefe30ad4dac`, no commit.
- Per-file `git diff --stat` vs base compared entry-by-entry with my R2 manifest: **13 of
  15 tracked files byte-identical stats to R2** (c-proof 47, d 4, e1 20, e2 14, proof 91,
  b17-content 249, b17Readiness 12, b17DomainPolicies 141, capabilities 17, domainAccess
  77, accessRegistry 15, admin.ts 1580, evaluations 11) — **ONLY the two expected files
  moved**:
  1. `src/lib/routeGates.test.ts` **121 → 209** changed lines (11 tests total, +2 new:
     `U2-F R3 Low-1` discovery non-vacuity, `U2-F R3 Low-2` fresh-gate writeFailure pin);
     the Shield-2 pin's file list is now **derived** via `selectNullTargetFiles` over
     `stripComments(code)` matching `platformConfigContext(req, null)` |
     `platformGlobalContext(` (comments stripped — prose never matches), with
     `discoverNullTargetFiles(SERVER_ROOT)` walking `src/server`.
  2. `src/server/routes/_shared.ts` **76 → 81** changed lines: `requireFreshPassword`'s
     catch now keeps only the own `PASSWORD_CHANGE_REQUIRED_CODE` branch (403 + message +
     code) and routes everything else through `writeFailure(res, err,
     'Password-freshness check failed')` — the raw `err.message` echo line is gone.
- Obs-5 = contract wording only (no code delta seen anywhere); Shield Low-3 remains out
  of scope (U2-G G1) — both confirmed by the same whole-tree comparison.
- Protected set re-checked this round: `git diff --quiet c95ff66 -- b17.sql, schema.sql,
  b17ContentMigration.ts, auth.ts, workspace.ts, session.ts, system.ts, scoring.ts,
  approvalChain.ts, package.json, package-lock.json` → **exit 0**; no UI/env/lockfile in
  status; Shield report file untouched and not read (disjoint).

## R3.3. Static checks (executed)

| Check | Result |
|---|---|
| `npm run lint` | **PASS, exit 0** |
| `npm test` | **PASS, exit 0 — 188/188, 0 fail, 0 skipped, 5 suites** (186 claim + the 2 new R3 tests = 188 verified exactly; the new Low-1/Low-2 tests are among them) |
| `npm run build` (no `.env`) | **PASS, exit 0** |

## R3.4. My own round-3 probes (fresh guarded PG18 scratch, exit 0 — 9 PASS blocks)

Driver: `qa-u2f-r3-probe.ts` (QA-owned, outside the repo) + `qa-u2f-r3-run.ps1`: fresh
disposable `postgres:18` container, loopback, `qau2fowner` NOSUPERUSER/NOBYPASSRLS,
empty scratch `b17_u2f_qa_scratch_*`, no ambient env, seed-only, real HTTP through the
dispatcher chain. Log: `%TEMP%\opencode\qa-u2f-r3-probe.log`.

| # | Round-3 check | Result |
|---|---|---|
| 1 | **Pin discovery (mine, not the test's list)** — I walked `src/server` and re-derived the caller set from call sites myself | **exactly 4 files**: `adminClients`, `adminCommon`, `adminPlatformOps`, **`adminProvisioning`** (its **2** real `platformConfigContext(req, null)` distinction probes present); `adminStaff` and `adminDirectory` **out** (readContext-only) |
| 2 | **Own pin scan over the derived surface** | no `SELECT *` anywhere; only `adminClients` reads answers/snapshots (1+1, explicit columns, no value/history/payload); no `FROM evaluations` |
| 3 | **Synthetic-file non-vacuity (my own — beyond the repo test)** | a synthetic **future NULL-target caller carrying `SELECT * FROM answers` is auto-discovered AND flagged** by the same predicate+ring (would fail with no list to edit); a clean synthetic caller passes; **prose-only, comment-only and readContext-only synthetic files stay out** |
| 4 | Fresh gate **OWN** branch | forced-change fixture (no tab) mutating POST → **403 `auth.password_change_required` with its own message**; nothing written |
| 5 | Fresh gate **NON-OWN** branch (in-process injected raw PG `42P01`, same technique as my R2 fault injection) | → **500 exactly `{error:'Password-freshness check failed'}`** — no `code` key, no `42P01`/`relation`/PG text anywhere in the body; faulted write rolled back; **control request after disarm = 200 and commits**; cleared fixture then falls through the gate and is refused by the **matrix** (`workspace.mode_mismatch` — distinct code, proving the gate is no longer the refuser) |
| 6 | Registry spot | **95 keys → 0 UNACTIVATED / 95 U1**, `activeBusinessCapabilities()` = **10** exact; **matrix strings 99/99 byte-identical** vs base (source extraction) |
| 7 | Provisioning spot (no behaviour change) | rows 6/7 **P@T serve 201/200/200**; **W, C, E all 403 `workspace.mode_mismatch`** on rows 6/7/23; **anonymous all 401**; users unchanged by every refusal |
| 8 | End state | fingerprint `5d5ddb9344225a53059da3f7d92bdd94` stable, readiness green, still 0 UNACTIVATED |

## R3.5. "R2 PASS still holds on current source" — full re-run

The **unchanged** round-2 probe (`qa-u2f-r2-probe.ts`, byte-identical to my R2 evidence)
re-run end-to-end on a fresh scratch against the current source: **PROBE_EXIT=0, 28 PASS
blocks**, `MATRIX-FINAL served=68 refused403=70 gates400=10 anon401=25` — identical
tallies to round 2 (registry truth, full 173-probe matrix incl. all 8 rulings, lock-order/
rollback/OTP/unlink/progress/suspend/drift, non-destructive census all green again).

## R3.6. Notes / not verified

- Round-3 changed nothing observable in the 25-row matrix (spot + full re-run agree);
  no behaviour change, no new capability, no flip-state change.
- Semgrep + Trivy still not run (not in this round's QA instruction; carried since
  round 1). No Playwright/axe (no UI file changed — status shows none). Cloud/deploy
  untouched. Shield round-3 outcome not read (disjoint owned file).
- Report-only artifact: no app source, `.env`, dependency, schema, cloud, commit, push
  or agent change was made by QA; Shield file disjoint.

## R3.7. QA signature (round 3)

Independent QA Agent (session RESUME, disk-is-truth, neutral, contract-only) — 2026-11-14.
**Unit verdict: PASS** — round-3 both fixes verified by own probes, round-2 PASS re-confirmed
on current source, 0 UNACTIVATED of 95 intact, no new functional failure.
