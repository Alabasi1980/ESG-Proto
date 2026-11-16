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


