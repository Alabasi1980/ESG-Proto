# QA Report — TASK-PROTO-U4-1c (Execution Mode, independent)

| Item | Value |
|---|---|
| Task | TASK-PROTO-U4-1c — documents, department initiatives, general bucket, indicator & tags (model + APIs), OD-12 §3–§8 |
| Agent | QA Agent — Execution Mode, session NEW |
| Date | 2026-11-16 |
| Base | `5efb0c8` → reviewed `1b25cb7` (`0d45445` feat + `1b25cb7` contract), working tree clean |
| Scratch DB | **own** container `u41c-qa-pg` (postgres:18, `127.0.0.1:55999`), own role `u41cqaapp` (NOSUPERUSER / NOBYPASSRLS), DBs `u41c_base` / `u41c_qa` / `u41c_c1` / `u41c_probe` |
| Live DB | **never touched**. The running `b17-showcase` container on `127.0.0.1:55432` was not used; `.env` was refused (`B17_SCRATCH_OPT_IN=YES`); no live ledger/DDL claim of this report depends on Tera's statement except where marked NOT VERIFIED |
| Verdict | **FAIL** — 2 acceptance criteria not met (delete dependency guard; declared `P@T` reads), 1 sub-criterion not met (one general bucket per service). 74 executed API checks pass; 0 unclassified scope drift |

---

## 1. Independent scope discovery (before any expected-result assumption)

`git status --porcelain` at start: **empty** (no executor leftovers). `git diff --stat 5efb0c8 HEAD` = **20 files, +2140 / −35**.
Deleted lines (complete, verified by diff read): the 6 guard-list/`allowed.size`/pins/`total`+`work` assertion lines,
the 4 `duplicate` link-copy parameter lines, the 3 `POST /items` insert column lines, the old `SELECT … document_requirements`
line, and two `B17_*` constant lines. **No assertion deleted, no matcher widened, no pin relaxed, no test skipped.**

Changed paths (20, all inside the task §3 targets or the Tera-owned contract):

```text
project-control/tasks/TASK-PROTO-U4-1c/TASK-PROTO-U4-1c.md  scripts/u41c-scratch.ts
src/db/schema.sql  src/db/b17-content.sql  src/db/b17Readiness.ts
src/lib/{generalBucket,documents,departmentInitiatives}.{ts,test.ts}
src/lib/{b17TransactionInventory,capabilities,domainAccess}.test.ts
src/server/{accessRegistry,routes,scope,taxonomy}.ts
src/server/routes/{documents,departmentInitiatives}.ts
```

Forbidden paths untouched: `src/db/b17.sql`, `src/db/b17ContentMigration.ts`, `package.json`, `package-lock.json`, `.env`,
`src/components/**`, and no `.css`/view/style file in the diff (executed check).

**Two deltas beyond the task's enumerated §1 list** (reported, not assumed acceptable):
`b17-content.sql` also adds `CREATE POLICY b17_version_update ON app_schema_versions` (an UPDATE gate on the readiness
ledger, purpose `migration` only) and the three `DOCUMENT_REQUIREMENT_*` actions in `b17_audit_insert`. I verified
statically that no request handler ever sets purpose `migration`/`migration.inventory` (grep: only
`b17Readiness.ts` and the offline `scripts/*` proof files), so this adds **no request-reachable write path**; it is
nevertheless a new UPDATE surface on the ledger and is called out for Tera/Shield disposition (F-07 INFO).

**Deviation from §2's literal path** (INFO, F-08): the contract names the proof routes as `/requirements/:id/files`
(+ initiative proof), the implementation declares one unified surface `/evidence/:entityType/:entityId/files`
(`document_submission` | `initiative_status`). Semantically this is §1.6's "unified evidence files" and it is
enumerated as 11 exact matrix rows; it is a path-shape deviation only, not a missing capability.

## 2. Commands and results (all executed; exit codes captured)

| # | Command | Result |
|---|---|---|
| 1 | `npm run lint` (`tsc --noEmit`) | **exit 0**, no diagnostics |
| 2 | `npm test` (`tsx --test src/**/*.test.ts`) | `tests 366 / pass 366 / fail 0` — **366/366** (expected) |
| 3 | `npm run build` (vite) | **exit 0**, `✓ built in 735ms` (chunk-size advisory only) |
| 4 | Own DB proof, `%TEMP%\opencode\u41c-qa\db-proof.ts` (55 checks) | **55 PASS / 0 FAIL** → `DBPROOF_OK` |
| 5 | Own static verifier, `…\static-check.ts` (45 checks) | **45 PASS / 0 FAIL** → `STATIC_OK` |
| 6 | Own HTTP E2E over the shipped router, `…\e2e.ts` (78 checks) | **74 PASS / 4 FAIL** → `E2E_FAILED:…` |
| 7 | Own mechanism probe, `…\probe-guard.ts` (5 measurements) | see F-01 |

Harness: `schema.sql` (`runMigrations`) → `applyB17Offline` → `b17-content.sql` (purpose `migration.inventory` + ledger row),
then `assertB17Ready()` passed; the app was started as `tsx server.ts` in scratch mode (`B17_SCRATCH_OPT_IN=YES`,
`NODE_ENV=production`, loopback, ephemeral port) against the own DB, so **FORCE RLS was live for every HTTP assertion**.
Fixtures were seeded as `postgres` (data only; no structural object). No Playwright suite exists in this project and
§3 forbids UI work, so E2E is API-level over the real Express router.

## 3. Criterion-by-criterion

### 3.1 §1 model — DDL exactly as declared (executed on the own scratch) — **PASS**

* Exactly the 4 tables exist (`document_requirements`, `document_submissions`, `initiative_department_status`,
  `evidence_files`); each has `relrowsecurity = true` **and** `relforcerowsecurity = true`.
* `items.indicator_code` = `text` NULL; `items.tags` = `text[]` NOT NULL DEFAULT `'{}'`.
* Columns match §1 with the declared defaults (`required true`, `provided false`, `performed false`, `sort_order 0`,
  `tags '{}'`, `created_at now()`); nullable `department_id` on requirements/evidence; `entity_id` is a bare UUID.
* Indexes present: `ix_document_requirements_service`, `ix_document_submissions_client_dept`,
  `ix_initiative_department_client_dept`, `ix_evidence_files_parent`.
* Uniqueness: `UNIQUE(client_id, department_id, requirement_id)` and `UNIQUE(client_initiative_id, department_id)`.
* FKs: requirements→services CASCADE (+departments CASCADE), submissions→clients/departments/requirements CASCADE,
  `submitted_by` SET NULL, initiative status→client_initiatives/departments CASCADE, evidence→clients/departments/uploader.
* **No business CHECK constraint** on any of the four tables (`pg_constraint … contype='c'` = 0 rows).
* Policy posture: `document_submissions` and `initiative_department_status` have **no DELETE** policy,
  `evidence_files` has **no UPDATE** policy, `document_requirements` UPDATE is P-only, and no policy qual is `true`.

### 3.2 §1.2 general bucket (executed) — **FAIL on one sub-criterion**

| Case | Measured |
|---|---|
| service create mints `GENERAL-<CODE>` standard + `GENERAL` disclosure + `service_standards` mapping | 1/1/1 ✓ |
| re-save (`PATCH /services/:id`) is a no-op | 1/1/1 ✓ (idempotent) |
| duplicate → copy gets **its own** `GENERAL-<NEWCODE>` bucket | 1/1/1 ✓ |
| duplicate **excludes** the source's bucket link | `stale = 0`, source keeps `map = 1` ✓ |
| non-ASCII code (`خدمة`) | `GENERAL-SERVICE-11F4216E` (digest fallback, never empty) ✓ |
| pre-existing service (seeded outside the API) | backfilled by its first P save ✓ |
| **two distinct codes that slug to the same string** (`U41C X` and `U41C/X`) | **one shared `GENERAL-U41C-X` mapped to 2 services** ✗ → **F-02** |

`backfillGeneralBuckets()` exists and is idempotent (unit + executed on 2 services) but has **no production caller**
(F-09 INFO): a service that P never saves again never gets a bucket.

### 3.3 §2 P requirements CRUD + §2 delete dependency guard (executed) — **CRUD PASS / guard FAIL**

CRUD: create (201, tags/sortOrder/department binding), patch (200), empty patch 400 `documents.empty_patch`,
missing title 400 `documents.title_required`, 11 tags 400 `documents.tags_invalid`, negative sortOrder 400 — all
with the audit rows `DOCUMENT_REQUIREMENT_CREATED ×2 / UPDATED ×1` confirmed by count delta. Non-P callers
(E, C, W) get **403** with **zero delta** on every attempt.

Guard: **FAIL** — see **F-01**. `DELETE /services/:id/documents/:reqId` on a requirement that has one department
submission returns **200** (expected 409 `documents.dependency`), deletes the requirement, cascades the submission
away, requires no reference removal, and writes a `DOCUMENT_REQUIREMENT_DELETED` audit row. An unreferenced
requirement deletes correctly (200).

### 3.4 §2 E submission scoping (executed) — **PASS**

`E1` sees 2 requirements (own department + department-agnostic), `E2` sees 1 (department-agnostic only),
cross-tenant `E3` sees 0, and `E1 → ?clientId=<other tenant>` is refused 403 `scope.tenant_mismatch`.
`PATCH /requirements/:id`: own row → 200 with `submittedAt`/`submittedBy` (stamp written once); note/tag stay editable
after submit; `provided:false` after submit → **409 `documents.locked`, zero delta**; other department's requirement →
**404**; cross-tenant → **404**; C and W → **403**; fields outside `provided|note|tag` → 400 `documents.field_refused`.
Audit: `DOCUMENT_SUBMITTED ×1` + `DOCUMENT_UPDATED ×1`. Row count delta per accepted write = exactly +1.

### 3.5 §2 department initiatives (executed) — **PASS**

`GET /initiatives/department` returns the tenant's selected initiative with per-department status + proof metadata
(E1 1 row; C and W read; cross-tenant 0). `PATCH …/:id`: `performed:true` → 200 with stamp, note trimmed;
a second patch keeps the **same** `submittedAt`; C/W → 403 zero delta; cross-tenant → 404 zero delta; illegal
fields → 400 `initiatives.field_refused`; audit `INITIATIVE_STATUS_UPDATED ×2`. Proof upload (201) then delete →
**409 `evidence.locked`**; W upload → 403.
Residual (F-04 LOW): `performed:false` is accepted **after** the stamp (200, `submitted_at` retained) — an asymmetry
with the document `provided` rule; the contract does not state which is intended.

### 3.6 §2 evidence files (executed) — **PASS**

| Case | Measured |
|---|---|
| 17-byte PDF upload | 201, `size_bytes` 17, mime stored |
| 5 MB + 1 byte | **400 `attachments.oversize`**, zero delta |
| `application/x-msdownload` | **400 `attachments.mime`** |
| `entityType=answers` | **400 `evidence.entity_type`** |
| no `file` field | 400 `attachments.missing` |
| upload to another department's submission | 403/404 zero delta |
| W upload | 403 |
| download: own / C / W / P@T | 200 / 200 / 200 / 200 (byte-identical, `content-type` from the row) |
| download: other department / other tenant | refused (403 / 404) — no cross-tenant leak |
| delete after `submitted_at` | **409 `evidence.locked`** zero delta |
| delete before submit, by the uploader | 200 + `EVIDENCE_FILE_DELETED` audit |
| delete by a foreign employee | 403/404 zero delta |
| audit | `EVIDENCE_FILE_UPLOADED ×3`, `EVIDENCE_FILE_DELETED ×1` |

### 3.7 §2 declared matrix + pins (executed statically) — **FAIL on two declared rows**

Counted from the routers themselves, not from the registry: **109** declarations == `LEGACY_ROUTES.length`;
registry set == mounted set; **U1 = 109** with **101 business flips + 8 system/session**; **ACCESS_REGISTRY = 113**;
`domainTransaction` sites **95**, explicit `readContext` sites **39**, `95 + 3` provisioning = **98**;
`allowed.size = 91` is the test's own bookkeeping pin (suite green) and, independently, all **20** changed paths lie
inside the declared targets. The 11 new rows are byte-exact, the 4 write rows are `E`-only, and the capabilities tail
is `documents, departmentInitiatives`. **However** two of those declared rows do not work at all:
`GET /requirements` and `GET /initiatives/department` with `P@T` return **403 `scope.denied`** → **F-03**.

### 3.8 §4 constants measured + falsifiability (executed on the own scratch) — **PASS**

| Constant | Committed | Independently measured |
|---|---|---|
| `PREDECESSOR_SHAPE` | `c320ef6f…` | `c320ef6ff50675206ac4c8edf762db3b` ✓ |
| `B17_SHAPE` | `3adef017…` | `3adef0179b7703b6d8e20750fbe67e8a` ✓ |
| `B17_CONTENT_SHAPE` | `9e06e001…` | `9e06e001dabaa6df41c84b572dfcd494` ✓ |
| content sha256 | `d96d6bc2…` | `d96d6bc243dc5b14beb002cceccbbeade2b8e51dcb09c128411d1f010ac41f93` ✓ |

Falsifiability chain (all executed, both directions): the base commit reproduces the **old** oracles exactly
(`d093f472…` / `99455c0b…` / `6f67b44d…`); dropping the U4-1c columns/tables restores `d093f472…` and then
`99455c0b…` and re-applying the section restores the measured values; the content file's own oracle
(new structure + HEAD policies) is `34a5e9c5…`, and removing this unit's policy block reproduces it while
re-applying the block reproduces `9e06e001…`; `verifyB17()` passes after the round-trip.
Note: the base oracle needs the schema applied with CRLF line endings (the shipped `STRUCTURE_SQL` fingerprints stored
function bodies) — an own-scratch reproduction detail, not a product finding.

### 3.9 §4 lint / full tests / build — **PASS** (see §2 rows 1–3; 366/366 as expected).

## 4. Findings

| # | Severity | Title | State |
|---|---|---|---|
| **F-01** | **HIGH** | `DELETE /services/:id/documents/:reqId` blocker count is RLS-blind → destructive delete of department submissions | **OPEN (executed)** |
| **F-02** | **MEDIUM** | Two services whose codes slug identically share ONE `GENERAL-*` bucket | **OPEN (executed)** |
| **F-03** | **MEDIUM** | Declared `P@T` reads of `/requirements` and `/initiatives/department` are unreachable (403 `scope.denied`) | **OPEN (executed)** |
| F-04 | LOW | Initiative `performed` can be reset after the submission stamp (document `provided` cannot) | OPEN (executed) |
| F-05 | LOW | A requirement may be bound to another tenant's `department_id`; C/W then read a foreign department id | OPEN (executed) |
| F-06 | LOW | `evidence_files` has no FK to its parent: proof rows survive as orphans after a parent delete | OPEN (executed) |
| F-07 | INFO | Un-enumerated delta: new `b17_version_update` UPDATE policy on `app_schema_versions` (no request path sets `migration`) | OPEN (needs Tera/Shield disposition) |
| F-08 | INFO | Unified `/evidence/:entityType/:entityId/files` instead of §2's `/requirements/:id/files` | deviation, functional equivalent |
| F-09 | INFO | `backfillGeneralBuckets()` has no production caller (only P's first save backfills) | accepted by design note |
| F-10 | LOW | `generalBucket.test.ts:77` asserts a tautology (`x === 'SERVICE-' + x.slice(8)`) — the empty-code case is not really tested | OPEN |

### F-01 (HIGH) — executed evidence

Requirement `R` (service linked to tenant A) has one submission by `E1` (department D1) and one proof file.
`DELETE /api/services/<SA>/documents/<R>` as **P (platform tab, no target)**:

```text
HTTP 200                      (expected 409 documents.dependency)
document_requirements  1 → 0  (row destroyed)
document_submissions   1 → 0  (ON DELETE CASCADE removed the department's submitted record)
evidence_files         1 → 1  (proof now orphaned; entity_id dangles, still fetchable by id)
audit_log             +1      (DOCUMENT_REQUIREMENT_DELETED)
```

Mechanism (measured, `probe-guard.ts`, own scratch, app role, FORCE RLS):

```text
truth: document_submissions rows                        = 1
purpose platform.config, target_id NULL (the DELETE ctx) = 0   <-- guard sees nothing
purpose platform.config, target_id = A                   = 1   <-- only if a target were bound
purpose work, mode platform (the GET catalog ctx)        = 0 submissions / 1 requirement
```

`routes/documents.ts:157` counts `document_submissions` in `domainTransaction(req, …)` with **no target**
(`initiativeScope.ts` → `platformConfigContext(req, null)`), while `b17_document_submissions_read` admits rows only
under `b17_work_tenant(client_id)` or the **targeted** platform branch — with `target_id = NULL` the count is always 0.
Referential actions run outside row security, so the cascade removes the tenant's evidence silently. This is exactly
the "truthful, catalog-wide blocker count" the handler's own comment claims; it is neither truthful nor catalog-wide.
A target-scoped count would still miss other tenants' submissions of the same catalog requirement, so the fix needs a
genuinely catalog-wide count. **Zero-write rule violated (a state change occurred where a refusal was required).**

### F-03 (MEDIUM) — executed evidence

```text
GET /api/requirements?clientId=<A>            as P (platform tab) → 403 {"error":"scope.denied"}
GET /api/initiatives/department?clientId=<A>  as P (platform tab) → 403 {"error":"scope.denied"}
GET /api/evidence/document_submission/<id>/files/<fileId>/download?clientId=<A> as P → 200   (P@T context itself is fine)
```

Both handlers call `ownDepartment(req.access!)` before selecting a context; `ownDepartment → assertWorkScope`
refuses `mode === 'platform'` (`scope.ts:20,337`). So the two declared `P@T#read-only-target` rows can never serve a
request even though task §2 requires "P may read (T)". C and W reads of both lists work (200). A declaration that can
never be honoured makes the matrix untruthful; it is also a missing required capability (not merely a fail-closed
inconvenience).

### F-02 (MEDIUM) — executed evidence

`POST /api/services {code:'U41C X'}` and `{code:'U41C/X'}` both succeed; `standards` has **one** `GENERAL-U41C-X`
with `count(DISTINCT service_id) = 2` in `service_standards`. The two services therefore share one general bucket
(one disclosure, one item pool), contradicting "one general bucket per service"; the duplicate path's "exclude the
source bucket" logic also cannot distinguish them. The unit test only covers the Arabic/empty fallback (and that
fallback assertion is a tautology, F-10).

### F-05 / F-06 (LOW) — executed evidence

`POST /services/:id/documents {title:'Foreign dept binding', departmentId:<D3 of tenant B>}` → **201** (the handler
validates only that the department exists), and the C list of tenant A then contains
`["Foreign dept binding","23333333-3333-4333-8333-333333333333"]` — a foreign tenant's department id crosses into
another tenant's read model. After F-01's destructive delete the proof row survived
(`ORPHAN_PROOF_ROWS_AFTER_PARENT_DELETE=1`).

## 5. Pass/Fail decision

**FAIL.** Two acceptance criteria of the task are not met and both are executable, not stylistic:

1. §2 "delete dependency guard" / §4 "requirements CRUD validation … zero-write refusals": the guard is a no-op under
   the platform context the route itself binds, and the delete destroys a department's submitted evidence (F-01 HIGH).
2. §2 "P may read (T)" / §7 "matrix declarations exactly as claimed": both declared `P@T` list reads return 403 (F-03).
3. §1.2 "one general bucket per service": slug collisions merge two services' buckets (F-02 MEDIUM).

Strengths confirmed by execution: the DDL is exactly as declared (additive, idempotent, RLS enabled+forced, no business
CHECKs), the readiness/content constants are independently reproducible **and falsifiable in both directions**, the
E/W/C department and tenant scoping of the whole read surface holds — 0 leaks across the 30 refusal/negative cases, 8 of them zero-delta counted —, the 5 MB/MIME/entity-type
gates and the `submitted_at` proof lock work, and the matrix/pin bookkeeping (109/101/113/95/39/98) is exact.

## 6. NOT VERIFIED

* **Live database state** (Tera's applied DDL/policy/ledger, `GENERAL-GRI` bucket, E list 200): live DB was off-limits
  by instruction. Nothing in this report confirms the live ledger rows, the live `structure_checksum`, or the live
  `GENERAL-GRI` bucket; only the own-scratch reproduction is measured.
* **`scripts/u41c-scratch.ts` itself** was not executed (its own-container naming/gate); its measurement chain was
  reproduced independently instead (row 4 above).
* **Concurrency**: two simultaneous `ensureGeneralBucket` calls, and concurrent submit/delete races, were not exercised;
  the `ON CONFLICT DO NOTHING` + read-back shape was verified statically only.
* **UI/Playwright**: no UI in this unit (§3 forbids it) and the project has no Playwright suite, so no browser-level
  E2E was possible or required.
* **Shield's `L-05`** (pins re-measured but not statically verifiable): I *did* re-measure them on my own scratch, so it
  is verified for this review; it stays environment-specific (PG18 image, app-role owner, CRLF schema).

## 7. Cleanup / footprint

Own container `u41c-qa-pg` and every own database were removed after the run; all own scripts/logs live only under
`%TEMP%\opencode\u41c-qa\` (`db-proof.ts/.log`, `e2e.ts/e2e-final3.log`, `static-check.ts/static.log`, `probe-guard.ts`).
The repository gained **only this report** (`npm run build` refreshed the git-ignored `dist/`). No code was edited,
no dependency installed, no commit made, no live database touched.

## QA Agent signature

QA Agent — Execution Mode (independent), 2026-11-16. Handed back to Tera; acceptance is Tera's decision.



---

# RECHECK — round 2 (six fixes, fail-capable, independent)

| Item | Value |
|---|---|
| Scope | **only** the six round-2 fixes R1–R6 (nothing else re-litigated) |
| Fix commit | `985807a` (fix) on top of `1b25cb7`; reviewed tree = `985807a` + docs `42596a1`; working tree clean |
| Scratch DB | **own** container `u41c-r2-pg` (postgres:18, `127.0.0.1:55998`), own role `u41cr2app` (NOSUPERUSER/NOBYPASSRLS), DBs `u41c_r2` / `u41c_r2_old` |
| Live DB | **off-limits, never touched** (`b17-showcase` unused). Tera's live statements (FK RESTRICT, ledger `f28b8352/79ad1927/07e9c994`, bucket `GENERAL-GRI-FD5E9FA0`, boot, E list 200) are treated as claims, not evidence |
| Verdict | **RECHECK FAIL** — R2 / R5 / R6 fixed; **R1 half-fixed** (data safe, contract 409 missing → 500); **R3 half-fixed** (1 of 3 declared reads serves); **R4 blocked** by a new audit-policy regression that makes every P requirement write return 500 |

## R.1 Commands (all executed, exit codes captured)

| # | Command | Result |
|---|---|---|
| 1 | `npm run lint` (`tsc --noEmit`) | **exit 0** |
| 2 | `npm test` | `tests 369 / pass 369 / fail 0` — **369/369** (expected) |
| 3 | `npm run build` | **exit 0**, `✓ built in 1.42 s` |
| 4 | `r2-db-proof.ts` (23 checks, PG18 own scratch) | **23 PASS / 0 FAIL** → `R2_DBPROOF_OK` |
| 5 | `r2-e2e.ts` (37 checks, real router + FORCE RLS + JWT) | **32 PASS / 5 FAIL** → `R2_E2E_FAILED:…` |
| 6 | `r2-probe.ts` (error-code mechanism, 3 measurements) | root causes of the two 500s, quoted below |

## R.2 Pins enumerated and judged

| Pin | Value | Judgement |
|---|---|---|
| `PREDECESSOR_SHAPE` | `e75eb5f4e4754549849757daec7c478b` | **measured identical**; undo of exactly the round-2 schema delta → `c320ef6f…` (round 1), redo → `e75eb5f4…` both ways (pre-b17 and post-b17). Honest. |
| `B17_SHAPE` | `f28b8352a1b6f68e01b3cc9d5b725546` | **measured identical**; undo → `3adef017…`, redo → `f28b8352…`. Honest. |
| `B17_CONTENT_SHAPE` | `79ad1927e72f861081450df86eb35b7f` | **measured identical**; round-1 files still reproduce their own `9e06e001…`, so the move is this round's seven policy texts only. Honest. |
| content sha256 | `07e9c994acd48323b4f9430bf19fc45de99cc34cd73c601d7cad6089a76b892d` | **measured identical** (= the test pin, = Tera's ledger claim). Honest. |
| `h13ReadinessSha256` | `59322ac3…` | recomputed → matches |
| `h13AccessRegistrySha256` | `10931e42…` | recomputed → matches |
| `h13ContentSha256` | `07e9c994…` | recomputed → matches |
| `h13RoutesSha256` | `a810933d…` | **unchanged this round** (routes.ts untouched) — correct |
| inventory | `total 95`, `work 38`, `[9,0]` for `routes/documents.ts` | **weakening judged**: `39 → 38` and `[9,1] → [9,0]` because the one explicit `readContext` argument became a conditional arrow. The 9 U4-1c boundaries still execute their non-platform branch under `readContext`, but the census no longer counts them (coverage narrowed, documented in-code) → **G-05 LOW**, not a functional weakening. |
| `allowed.size` | `91` | unchanged and consistent (the two reviewer reports were added to `reviewerReports`, not to `allowed`) |
| round-1 oracle | `c320ef6f / 3adef017 / 9e06e001` | reproduced from `1b25cb7` files on the same scratch → the round-2 delta is isolated |

## R.3 Fix-by-fix verdicts

### R1 — delete guard → **HALF-FIXED** (data safe; contract broken)

| Check | Measured |
|---|---|
| FK is `ON DELETE RESTRICT` in the fresh schema (no CASCADE left) | ✓ `FOREIGN KEY (requirement_id) … ON DELETE RESTRICT` |
| RLS-blind `count(*)` pre-check removed | ✓ (grep: no `count(*)` in the file) |
| destructive attempt (P@T delete of a requirement with a submission) | requirements **1**, submissions **1**, evidence **1** — nothing lost; snapshot counts identical |
| cascade paths | `DELETE FROM clients` → **23503**; `DELETE FROM services` → **23001**; both refused, data intact |
| bypass sweep | wrong-client target → 403 `scope.service_unlinked`; W/C/E → 403/403/403; `DELETE /requirements/:id` → refused 3/3; no raw PG text echoed |
| **declared 409 `documents.dependency`** | **NOT produced — the route returns 500** |

Mechanism (measured, `r2-probe.ts`):
`DELETE FROM document_requirements …` raises **`23001` (`restrict_violation`)** under `ON DELETE RESTRICT`;
`routes/documents.ts:184` maps only **`23503`** (`foreign_key_violation`, which is what a *cascading ancestor* delete
raises). So the mapping is dead code on the direct path → `writeFailure` → **500** (G-02). An **unreferenced**
requirement also returns **500** (the audit insert then fails, see R4) and the row stays (`row_left=1`): the whole P
requirement write path is non-functional, not just the guard.

### R2 — collision-proof bucket codes → **FIXED**

| Check | Measured |
|---|---|
| slug-equivalent codes (`R2 X` vs `R2/X`) | `GENERAL-R2-X-1A5A2F90` vs `GENERAL-R2-X-B7E91871` — **distinct**, each with its own service-id suffix |
| one bucket ↔ one service | `count(DISTINCT service_id) = 1` |
| duplicate | `GENERAL-R2-X-COPY-9D649EBB` — derived from the **copy's** id, not the source's |
| pre-suffix legacy bucket (`GENERAL-LEGACY`) | **adopted**, not duplicated (1 mapping, code unchanged) |
| second save | identical mapping set — legacy adoption is idempotent |
| connection to the live bucket | suffix shape matches the live `GENERAL-GRI-FD5E9FA0` claim (prefix `GENERAL-GRI-` + 8 hex) |

### R3 — P@T reads serve → **HALF-FIXED**

| Route | Measured |
|---|---|
| `GET /services/:id/documents?clientId` as P@T | **200** ✓ |
| `GET /requirements?clientId` as P@T | **403 `scope.denied`** ✗ |
| `GET /initiatives/department?clientId` as P@T | **403 `scope.denied`** ✗ |
| P without `clientId` (all three) | **400 `scope.id_required`** ✓ |

Both failing reads still call `ownDepartment(req.access!)` → `assertWorkScope` → refuses `mode === 'platform'`
(`scope.ts:20,337`, untouched this round). The round-2 test named for R3 only asserts that the source contains the
`platformConfigContext` arrow — it stays green while both routes 403 (G-04).

### R4 — client-scoped requirements → **BLOCKED (new regression)**

Schema half is right and measured: `client_id uuid NOT NULL` + FK CASCADE, `UNIQUE(client_id, service_id,
department_id, title)`, partial unique index for the `department_id IS NULL` case, and a **second** NULL-department
requirement with the same title is refused (DB-level). Read/refusal half is right:

| Check | Measured |
|---|---|
| foreign-client department binding | **400 `documents.department_invalid`** (round-1 F-05 closed) |
| service not linked to the target client | **403 `scope.service_unlinked`** |
| with a real row: E1 = C = W list; other client (E2/E3) empty | ✓ `C=W=REQ1`, `E2=∅`, `E3=∅` |
| **P create** | **500** `Failed to create document requirement`; no audit row leaked (transaction rolled back) |

Mechanism (measured, `r2-probe.ts`): the handler now audits with `clientId: tenant`, but `b17_audit_insert` admits
`DOCUMENT_REQUIREMENT_CREATED/UPDATED/DELETED` **only with `client_id IS NULL`** → `audit_log` insert raises
**`42501`** → whole transaction rolls back → **500**. Same for PATCH and DELETE (same action family, same branch).
The NULL-tenant row shape is still accepted, so this is a pure contract mismatch introduced by the client-scoping
change → **G-01 HIGH**.

### R5 — performed lock after the stamp → **FIXED**

| Check | Measured |
|---|---|
| `performed=false` after `submitted_at` | **409 `initiatives.locked`**, zero delta, row still `performed=true` |
| notes after the lock | **200**, edited value persisted |
| idempotent `performed=true` repeat | **200**, original `submittedAt` kept |

### R6 — real invalid-code test → **FIXED**

The tautology is gone: the suite now asserts `/^SERVICE-[0-9A-F]{8}$/` on the empty code, empty ≠ whitespace,
same code under two services ≠ same bucket, and a ≤60-char bound. I re-checked the same properties by importing the
module (4/4 PASS) rather than trusting the test file.

## R.4 New findings (this round)

| # | Severity | Title | State |
|---|---|---|---|
| **G-01** | **HIGH** | Client-scoped requirement audit rows are refused by `b17_audit_insert` → every P requirement create/patch/delete returns 500 and rolls back | **OPEN (executed)** |
| **G-02** | **MEDIUM** | `ON DELETE RESTRICT` raises `23001`, the handler maps only `23503` → the required 409 `documents.dependency` never appears (500 instead) | **OPEN (executed)** |
| **G-03** | **MEDIUM** | R3 unrealised for `GET /requirements` and `GET /initiatives/department` (403 `scope.denied`); the declaration still promises `P@T` | **OPEN (executed)** |
| **G-04** | **MEDIUM** | Round-2 tests are source-text assertions: the "R3" test passes while both routes 403; the FK test asserts the literal `23503` while RESTRICT raises `23001`; nothing exercises an actual P catalog write | **OPEN (executed)** |
| G-05 | LOW | Census narrowed: `work 39 → 38`, `documents.ts [9,1] → [9,0]` (the 9 sites' work branch is no longer counted) | accepted-with-note |
| G-06 | INFO | With the RESTRICT lock no route can remove a submission, so the 409 text "Remove the reference first" is unactionable; tenant/service deletion is now FK-blocked while a submitted requirement exists (data-retention trade-off, Tera's call) | design |
| G-07 | INFO | The FK change lives inside `CREATE TABLE IF NOT EXISTS`; an already-installed database only gets it via the operator delta (the live one did). Fresh-install and upgraded-install parity is therefore operator-dependent | NOT VERIFIED live |

## R.5 Bypass attempt for R1 (reported honestly)

I tried to reach the destructive outcome by other paths: (i) same delete with the **other client** as target → 403
`scope.service_unlinked`; (ii) as **W, C, E** → 403 each; (iii) `DELETE /requirements/:id` as E/C/P → refused 3/3;
(iv) **cascade ancestors** at SQL level as superuser: `DELETE FROM clients` → 23503, `DELETE FROM services` → 23001.
**No path removed the submission** (re-measured afterwards: still present). The data-level guarantee holds; only the
API's 409 contract is missing (G-02). I did **not** attempt to disable RLS/triggers or to run as the table owner with
`row_security=off` — that is outside a request path and outside QA's remit.

## R.6 NOT VERIFIED (round 2)

* **Live database** after Tera's delta: FK RESTRICT, ledger `f28b8352/79ad1927/07e9c994`, `GENERAL-GRI-FD5E9FA0`,
  boot, E list 200 — all taken as claims; my evidence is the own-scratch reproduction (which does match the constants).
* `scripts/u41c-scratch.ts` (rewritten this round) was **not executed**; its measurement/falsifiability chain was
  reproduced independently.
* Concurrency (parallel saves, parallel submit) — still not exercised.

## R.7 Cleanup

Own container `u41c-r2-pg` and every own database removed after the run; scripts/logs under
`%TEMP%\opencode\u41c-qa\` (`r2-db-proof.ts/.log`, `r2-e2e.ts/.log`, `r2-probe.ts`). The repository gained **only
this appended section** (`dist/` refreshed, git-ignored). No code edited, no install, no commit, no live DB access.

## QA signature (round 2)

QA Agent — Execution Mode (independent recheck), 2026-11-16. Verdict **FAIL**: G-01 blocks the fixed capability;
R1/R3 are half-done; R2/R5/R6 verified fixed.

---

# RECHECK — round 3 (independent, 2026-11-16)

**Verdict: FAIL** — the three round-2 blockers were exercised and corrected, but the required one-general-bucket-per-service invariant still fails for distinct valid service UUIDs with identical first eight hex digits. This is a fail-capable counterexample, not an executor statement.

## Scope and evidence
- Conduct, task, B17 spec §7.1, OD-07/11/12 and improvement policy read. `git status --short`: prior uncommitted QA report and Shield report; preserved. HEAD `4eb36e9`, fix diff from `42596a1`: audit policy, two route handlers, readiness/test pins, own executor proof scripts and task note. Shield file not modified by QA.
- Own isolated PostgreSQL 18 container `u41c-qa-r3-independent`, loopback `55997`, NOSUPERUSER/NOBYPASSRLS app role, generated disposable passwords and random JWT secret; scratch-mode server, not ambient `.env`. Container removed. Live DB never accessed.
- `npm run lint` exit 0; `npm test` exit 0, **369 passed, 0 failed**; `npm run build — --outDir %TEMP%/opencode/u41c-r3-build` exit 0, warnings: Vite native config and bundle size. Build output only in TEMP.
- Independent HTTP/DB scratch harness: **19 PASS / 1 FAIL**, exit 1. This count includes a fail-capable distinct-bucket counterexample. Scratch bootstrap applied schema, B17 U1 and content using isolated test database; readiness verified.

## Executed checks
1. P@T requirement create 201, PATCH 200, target-bound CREATED/UPDATED audit rows present; unreferenced DELETE 200 and target-bound DELETED audit present.
2. P@T GET requirements / department initiatives / service documents 200; absent clientId on each 400.
3. E sees own tenant requirement; other tenant E cannot see it; foreign-department binding 400; C write 403. Same-client other-department file download refused 404.
4. E submission 200 and evidence upload 201; referenced requirement delete 409 `documents.dependency`; requirement/submission/file counts before and after **1/1/1**; evidence DELETE after submission 409.
5. Common slug collision example `A/B` versus `A B` with UUID prefixes `11111111` and `22222222`: codes distinct. Adversarial check below fails.
6. Measured scratch readiness pins: predecessor `e75eb5f4e4754549849757daec7c478b`, U1 `f28b8352a1b6f68e01b3cc9d5b725546`, content `c927183564e59ce9777b92e854dfc40a`, content SHA-256 `4ff0f31c455c37ca8d60b9cd8f4b1d67b8a05d3810ffa2ac03c300540d8ea055`. `verifyB17` passed. This is a fresh-install measurement, not a live-ledger verification or round-3 falsifiability proof.

## Finding R3-F01 — MEDIUM: bucket suffix is not collision-proof
`src/lib/generalBucket.ts` derives the suffix from **only the first eight hexadecimal digits** of a service UUID. Independently executed:
- `generalStandardCode('A/B','11111111-1111-4111-8111-111111111111')`
- `generalStandardCode('A B','11111111-2222-4222-8222-222222222222')`

These are distinct syntactically valid UUIDs and distinct service codes, but both normalize to the identical `GENERAL-A-B-11111111`. The independent assertion that codes differ **FAILED**. Static code inspection shows `ensureGeneralBucket` selects an existing standard by that code, so this admits shared standards/disclosures across services; actual handler-level DB creation with these explicitly chosen IDs was **not** executed. The code comment's claim of global uniqueness by construction is false. Existing unit tests choose UUIDs with different prefixes and do not catch this case. Recommend using a stable collision-resistant key that distinguishes the entire service ID, and add an independent same-prefix regression test.

## Pins / weakening
Round-3 diff changes content SHA pin `07e9c994… → 4ff0f31c…`, content structure `79ad1927… → c9271835…`, readiness file hash pin `480ff0a6…`; U1/predecessor structural constants unchanged. `allowed.size` 91→92 adds the exact executor E2E script path. The previous literal 23503 assertion is strengthened to cover both 23001 and 23503; platform-branch shape checks were added. No removed assertion or generalized allowlist was identified in the round-3 diff; the 39→38 work-context census reduction is historical from round 2 and remains a coverage limitation. The full suite passes despite R3-F01.

## NOT VERIFIED / limitations
- Live DDL, audit policy, ledger, GRI bucket, live boot and manual delete-call shape: off-limits; Tera statements are context only.
- Full bucket create/duplicate/backfill/legacy rename with same-prefix IDs on a database, simultaneous writes/races, full W isolation, evidence MIME/5MB/download positive/append and initiative status regression: not executed in this round. Prior-round results do not replace current direct evidence.
- The destructive scope-proof and cascade-ancestor delete bypass were not run, per instruction. Existing dependency delete itself was attempted only on own fixture and remained intact.
- No UI/Playwright run; task is API/data scoped.

## Continuous improvement / handback
Report to Tera: the green suite and the prior round-2 QA accepted different-prefix examples as collision-proof; UUID-prefix adversarial fixtures are needed before closing a uniqueness claim. `AGENT_GAPS_LOG.md` was not edited because this delegation permits appending only the QA report; request Tera route the process gap through the approved gap-log owner. No app, contract, Shield report, live DB, dependencies, commit or push changed by QA.---
# PROTECT QA01 — independent execution (2026-11-16/17)
| Item | Value |
|---|---|
| Task | TASK-PROTO-U4-1c-PROTECT (QA01 independent verification) |
| Mode | QA Execution, session NEW |
| Base/HEAD | HEAD 4eb36e9; implementer diff (schema/version+RESTRICT, anchor, routes, readiness/tests, u41c-protect-scratch, u41c-e2e) re-derived, not trusted |
| Scratch | OWN container u41c-qa-protect-01 (postgres:18, server_version_num 180006), 127.0.0.1:55961 loopback-only; role u41cprotectqa NOSUPERUSER/NOBYPASSRLS; DB u41c_protect_01 OWNER app-role; row_security=on, empty=0 at start; FORCE RLS via schema; throwaway creds; NO live/shared DB contact (b17-showcase:55432 and u41c-protect-pg:55433 untouched) |
| Live | NEVER touched. No .env/JWT/PG* ambient (harness refuses); no secrets in report |
| Verdict | **PASS** — all 7 criteria independently reproduced on own scratch. Parent U4-1c remains ESCALATED/NOT ACCEPTED; service-bucket collision NOT waived. |

## Commands (all executed, exit codes captured)
| # | Command | Result |
|---|---|---|
| 1 | `npm run lint` | exit 0, no diagnostics |
| 2 | `npm test` | 371 pass / 0 fail (371/371) |
| 3 | `npm run build — --outDir TEMP/u41c-protect-qa/build` | exit 0, built in ~811ms (chunk-size advisory only) |
| 4 | Own harness `qa-harness.mts` (fresh scratch, schema+B17+content, FK check, seed, real server over HTTP, barrier-free serial + parallel PATCH races) | ALL_HARNESS_PASS |
| 5 | Own supplement `qa-harness2.mts` (invalid-version matrix for initiative route, C/W/P denials, non-owner delete, audit presence) | SUPPLEMENTAL_PASS |
| 6 | `scripts/u41c-protect-scratch.ts` NOT executed (independent harnesses instead); `scripts/b17-scope-proof.ts` NEVER run | — |
Cleanup: own DB/container removed (`stop/rm u41c-qa-protect-01`), throwaway pw file deleted; repo gained only this appended section.

## Per-criterion (each with observed output)
1. Protected unselection — **PASS**. Draft status (E D1 performed:false+note v1) then `DELETE /initiatives/select/LIB` as W → 409 `{"error":"...[Arabic exact]...","code":"initiatives.dependency"}`; selection 1/1 + status 1/1 unchanged. After submit (v2) → same 409, zero loss. Evidence on submitted doc unaffected. Empty LIB2 selection → 200 + INITIATIVE_UNSELECTED, stale selection ID PATCH → 404. Raw `DELETE FROM client_initiatives` on scratch → refused (23001/23503), nothing touched. CODE-NOTE: delegation text says `409 documents.dependency`; observed (and design §5-approved) code is `initiatives.dependency` with the exact owner Arabic from task §13. Treated as PASS per governing design; literal mismatch flagged for Tera (F-P1 INFO).
2. Concurrent same-version — **PASS**. Doc: PATCH ev=0 after v1 → 409 version.conflict + exact Arabic `...` + conflict{expected:1,provided:0}; parallel ev=2 → one 200 v3 + one 409, DB version=3; loser adds no audit. Initiative: same shape (stale ev=1 after v2 → 409; parallel ev=2 → 200+409). Rollback: refused writes leave rows+evidence+audit byte-identical (audit count delta 0 on 403/409 paths).
3. Evidence lock — **PASS**. Upload pre-submit 201; submit v4 200; delete after submit → 409 evidence.locked zero-loss; append after submit 201; non-owner (E2) delete → 403/404; W/P-context upload → 403.
4. Isolation — **PASS**. Foreign-tenant E list excludes REQ; PATCH → 403/404; initiative PATCH foreign → 404. C→status PATCH 403; W/P evidence write 403. Doc route invalid set (-1/1.5/2147483648/x/NaN/missing) → 400 version.required; initiative route (-1/1.5/2147483648/x/empty/missing) → 400 version.required with baseline message. Cross-department: E2 owns separate D2 row (v1), D1 row untouched.
5. Positive workflows — **PASS**. Doc draft v1 → submit v4 → notes editable; initiative draft v1 → submit v2 → note race v3; GET lists expose ownVersion+row revisions; audits present: DOCUMENT_SUBMITTED×1, DOCUMENT_UPDATED×3, INITIATIVE_STATUS_UPDATED×4, INITIATIVE_SELECTED×3, EVIDENCE_FILE_UPLOADED×2, INITIATIVE_UNSELECTED×1.
6. Regression — **PASS**. lint/test/build green above; new tests are behavioural (validateExpectedVersionInput 0/3/2 vs bad→version.required; submission/initiative patch shape checks; inventory pins anchor+version helper + harness path). No tautology found in PROTECT additions.
7. Scratch-only — **PASS**. All DB evidence from OWN fresh named PG18 container/role/DB above; explicit loopback + generated creds; `b17-showcase` + `u41c-protect-pg` never contacted; no live migration/inventory/cleanup.

## Findings
| # | Sev | Title |
|---|---|---|
| F-P1 | INFO | Delegation says `409 documents.dependency` for unselect; implementation+design return `409 initiatives.dependency` with exact Arabic. No data impact; needs Tera text reconciliation, not a code fix. |
No HIGH/MEDIUM/LOW functional failures observed in this bounded unit.

## NOT VERIFIED (explicit)
Deployed-role/ACL equivalence; live/shared DB state, ledger, orphans, migration/cutover parity; full concurrent race matrix under sustained load (only one parallel pair per entity + serial orderings proven); ancestor deletes beyond selection link; hash-collision cross-tenant behaviour (theoretical); UI InitiativesView Arabic display (no browser run, API-scope unit); performance/deadlock with pool max 5 under load.

## Residual risks
Surrogate-role proof only; installed-data orphans unknown; upgrade/ledger parity not exercised here; later migration/activation needs separately authorised plan + QA/Shield/Auditor review. No parent acceptance claimed.

## QA signature
QA Agent Execution (independent), 2026-11-17. Handed to Tera; STOP/ASK: none blocking — code-note F-P1 left for Tera disposition.
