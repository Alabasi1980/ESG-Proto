# TASK-PROTO-U4-1c — Shield review (file access + department scoping)

- **Task:** TASK-PROTO-U4-1c (documents, department initiatives, general bucket, indicator & tags)
- **Agent:** security-agent — الدرع (defensive)
- **Mode:** Fix Review (static, first pass)
- **Base → reviewed:** `5efb0c8` → `1b25cb7` (`0d45445` feat + `1b25cb7` contract)
- **Inputs read:** U4-1c contract, OD-12 (`prototype/OWNER_DECISIONS.md:57-70`), diff of all 20 touched files, `b17.sql`, `b17-content.sql` (full policy set), `initiativeScope.ts`, `_shared.ts`, `scope.ts`, `accessRegistry.ts`
- **Static bounds:** no execution, no DB, no installs, no subagents; the only write is this file. Every statement below is a text citation (`file:line`). Runtime/one-transaction live proof is Tera's.

## Verdict (no gate decision — Tera owns Security Disposition)

| # | Severity | Title | State |
|---|---|---|---|
| H-01 | **High** | Requirement DELETE's blocker count is RLS-blind → cascade deletes tenant submissions | OPEN |
| M-01 | **Medium** | General-bucket code collision lets two services share one GENERAL container | OPEN |
| L-01 | Low | Declared `P@T` reads on `/requirements` and `/initiatives/department` are unreachable (fail-closed) | OPEN (QA) |
| L-02 | Low | Initiative lock is one-way on the stamp only: `performed` can be reset after submission | OPEN |
| L-03 | Low | Requirement `department_id` is catalog-scoped: foreign-tenant department UUID shown to C/W | OPEN (design) |
| L-04 | Low | `evidence_files` has no FK to its parent → cascade/orphan files stay downloadable by id | OPEN |
| L-05 | Low | Readiness/hash pins re-measured but not statically verifiable | UNVERIFIED |

The **read** surface is sound: I found no static path by which any role enumerates or fetches another tenant's or another department's file. The single High is a **destructive catalog delete** whose guard is silently non-functional.

---

## H-01 — `DELETE /services/:id/documents/:reqId`: blocker count reads 0 under the targetless platform context (OPEN, High)

**Evidence chain (all static):**

1. The delete route runs in a **targetless** platform configuration context: `routes/documents.ts:149` calls `domainTransaction(req, async (client) => …)` with no target; `initiativeScope.ts:60-62` therefore selects `platformConfigContext(req, null)`; `_shared.ts:78-83` sets `{ purpose:'platform.config', tenantId: null, targetId: null }`.
2. The guard is a plain, RLS-scoped count — `routes/documents.ts:157-158`:
   `SELECT count(*)::int AS n FROM document_submissions WHERE requirement_id = $1`
   and its own comment at `:155-156` claims a "**Truthful, catalog-wide** blocker count".
3. `document_submissions` SELECT is `b17-content.sql:839-844`. Under `platform.config` only the **targeted** branch is admitted:
   `OR (b17_platform_config() AND b17_setting('target_id') IS NOT NULL AND client_id::text=b17_setting('target_id'))`.
   With `target_id = NULL` **no submission row is visible**, for any tenant → `n = 0` always.
   (`b17_work_tenant(client_id)` cannot help: `current_tenant_id` is empty in this context.)
4. The count therefore never refuses; `routes/documents.ts:165` executes `DELETE FROM document_requirements WHERE id = $1`, admitted by `b17-content.sql:833-834` (`USING (b17_platform_scope() OR b17_platform_config())`).
5. `schema.sql:1418` declares `requirement_id UUID NOT NULL REFERENCES document_requirements(id) ON DELETE **CASCADE**`. Referential actions run outside row security, so the tenant `document_submissions` rows (and through them the department's submitted record) are removed without any handler refusal, without audit rows per removed record, and without the zero-write rule the contract §2 requires.
6. `evidence_files` has **no FK** to the submission (`schema.sql:1448-1460`, `entity_id` is a bare UUID) → the department's proof files survive as orphans, still downloadable by `client_id` through `b17-content.sql:899-904` while their list rows are gone.

**Why this is not a hypothetical:** the codebase already solved exactly this class and named it — `b17-content.sql:617-628` ("a missing context can never read as 'no blockers' (the **ON DELETE CASCADE hazard**)"). U4-1c reused the hazard instead of the precedent.

**Residual TOCTOU (same finding):** even with a correct count, the count does not lock `document_submissions`; a concurrent employee INSERT (admitted by `b17-content.sql:845-851`, which takes no conflicting lock) can land between count and delete. A `FOR UPDATE` on the requirement does not exclude it.

**Fix direction (Tera decides — both are code/DDL change, outside my authority):**
- close-set count-only SECURITY DEFINER kind (e.g. `requirement.submissions`) failing closed with `b17.count_context`, mirroring `b17_catalog_child_count`; and/or
- `ON DELETE RESTRICT` on `document_submissions.requirement_id` so the database refuses instead of cascading; plus an explicit "requirement has submissions" refusal in the handler.

**Not in scope of this finding:** whether the cascade currently removes rows or trips the FK — needs live proof (see Unverified).

---

## M-01 — General-bucket code collisions merge two services' containers (OPEN, Medium)

- `src/lib/generalBucket.ts:30-40`: the code is `GENERAL-` + `toUpperCase().replace(/[^A-Z0-9]+/g,'-')…slice(0,48)`.
  `ESG-1`, `ESG 1`, `ESG_1`, `esg/1` **all** yield `GENERAL-ESG-1`; two codes differing only beyond char 48 also collide. `POST /services` (`server/taxonomy.ts:273-278`) imposes no charset rule, so both codes are creatable and distinct under `services.code UNIQUE` (`schema.sql:64`).
- `generalBucket.ts:64-69`: the second service's `INSERT INTO standards … ON CONFLICT (code) DO NOTHING` returns nothing and the helper **adopts service A's standard**; `:72-79` adopts A's `GENERAL` disclosure; `:81-84` inserts `service_standards(B, A's standard)` and reports success.
- Consequence: two services share one general container — general items written for A appear under B for every tenant subscribed to B (`b17_item_visible`/`b17_content_fact('linked')` resolve through that mapping), P editing B's "general bucket" edits A's, and the "one bucket per service" invariant is broken **silently** (no error, `created.mapping` reports `true`).
- `server/taxonomy.ts:409` (`WHERE ss.service_id = $2 AND st.code <> $3`) uses the same derived code, so a duplicate created from A drops a standard that is *also* B's live bucket.
- Test naming overshoots the guarantee: `generalBucket.test.ts:69` is titled "collision-safe" but asserts only determinism and the Arabic digest fallback; the punctuation/truncation collision is untested. `:77` (`sanitizeServiceCode('')`) relies on a constant digest — harmless only because `services.code` is UNIQUE.
- **Direction:** derive the discriminator from an immutable per-service value (e.g. append a short digest of `service.id`), or refuse when the adopted standard's code does not map 1:1 to this service; add the collision case to the test that claims it.

---

## L-01 — Declared `P@T` reads are unreachable (OPEN, Low — fail-closed)

`accessRegistry.ts:266-269` and `documents.test.ts:102-108` declare `P@T` on `GET /requirements` and `GET /initiatives/department`, but both handlers call `ownDepartment(req.access!)` (`routes/documents.ts:185`, `routes/departmentInitiatives.ts:27`), and `scope.ts ownDepartment → assertWorkScope` throws `scope.denied` for `mode === 'platform'`. A P caller therefore gets 403 before any query. Contract §2 ("P may read (T)") is not met. No leak (refusal precedes SQL); report to QA for the functional call — the matrix and the handler disagree.

## L-02 — One-way lock on initiative status (OPEN, Low)

`lib/departmentInitiatives.ts:56-58` stamps `submitted_at` only on the first `performed=true`, and `routes/departmentInitiatives.ts:75-89` never refuses `performed=false` afterwards. Documents refuse the equivalent reset (`routes/documents.ts:237-242`). Proof files stay locked (the stamp is never cleared), so this is a record-semantics inconsistency, not a lock bypass.

## L-03 — Requirement department binding crosses tenants by design (OPEN, Low — design)

`document_requirements` is service-scoped, not client-scoped (`schema.sql:1399-1409`), while `department_id` points into one tenant's `departments`. A P-bound requirement tied to tenant A's department is still visible to W/C of tenant B through `b17-content.sql:819-824` (`department` filter is only applied for E) and is echoed back as `r.department_id` (`routes/documents.ts:187`), i.e. an opaque foreign department UUID with no name resolution. OD-12 §3 reads as "applies to all departments of **the client**", which this model cannot express. Tera architectural call, not a defect I should decide.

## L-04 — Orphaned proof files after any parent removal (OPEN, Low)

`evidence_files.entity_id` has no FK (`schema.sql:1448-1460`). Any parent deletion (H-01's cascade, or a future submissions cleanup) leaves content rows that remain downloadable by direct id (`b17-content.sql:899-904` + `routes/documents.ts:357-367`). No sweep, no audit.

## L-05 — Re-measured pins (UNVERIFIED, Low)

`b17Readiness.ts:26-27,53` and the census pins (`b17TransactionInventory.test.ts:44-46,59`) moved after U4-1c. Static consistency holds (the `d96d6bc2…` content hash appears in both the readiness comment and the test pin), but recomputation needs a PG18 run (`scripts/u41c-scratch.ts`) — outside my static bounds. Final values are Tera's to confirm. Operational note: `b17-content.sql` refuses to re-run once `B17_U2D` exists (`b17-content.sql:3-8`), so an already-migrated DB gets these policies **only** from Tera's live delta, and readiness is fail-closed (`b17Readiness.ts:204-212`) until the ledger is re-pinned.

---

## Closures verified (file:line)

1. **Entity-type confusion — CLOSED.** Domain checked before SQL (`routes/documents.ts:300-305`, `:347-352`, `:380-385`; `lib/documents.ts:21-25`), and the parent is resolved per type with the parent row required to exist (`:279-286,320-322`), so `document_submission`/`initiative_status` cannot be swapped (ids are unique across the two tables).
2. **Path-parameter tampering — CLOSED.** Every param is UUID-normalised (`scopeId`) and the download requires the full `(fileId, entityType, entityId)` triple (`:357-359`); a guessed id or a re-pointed `entityId` matches no row. RLS then re-scopes.
3. **Cross-tenant / cross-department download — CLOSED.** `b17_evidence_files_read` (`b17-content.sql:899-904`) pins `client_id` to the work tenant and, for E, `department_id` to the caller's own department; the handler repeats both (`:364-367`). W/C are tenant-wide only (contract §2), P only via explicit `target_id`.
4. **Cross-tenant write — CLOSED.** `b17_evidence_files_insert` (`:905-908`) requires own tenant + own department + `uploaded_by = current_actor_id`; the handler additionally proves the parent (`:320-322`).
5. **Delete-lock bypass — CLOSED (no bypass found).** The lock reads the parent resolved from the *same* `(entityType, entityId)` the file must carry (`:392-406`), and `submitted_at` is stamped once and never cleared; the owner check is a third gate (`:407`).
6. **MIME/size server-side — CLOSED.** multer `fileSize: 5 MiB`, `files: 1` (`:38-41`), explicit `LIMIT_FILE_SIZE` refusal (`:291-299`), then an independent allowlist re-check `validateAttachment` (`:310-316` → `approvalChain.ts:241-254`); `text/csv|plain` are served with `Content-Disposition: attachment` (`:368-370`), same as the pre-existing `storage.ts:202` pattern.
7. **Submission writes E-own-department only — CLOSED.** Handler gate `ownEmployeeDepartment` (`:224`), RLS INSERT/UPDATE `WITH CHECK` repeat tenant + own department + linked-service requirement (`b17-content.sql:845-861`), and there is **no** DELETE policy on `document_submissions`.
8. **Requirement CRUD is P-only + service-bound — CLOSED.** Matrix `P` only (`accessRegistry.ts:255-258`), `requireFreshPassword` on all three writes, `service_id` bound in the SQL predicate (`routes/documents.ts:111,131`), and audit attribution is the actor (`:89-91,133-135,166-168`).
9. **E initiative read widening is narrow — CLOSED.** `client_initiatives` E branch requires `b17_work_tenant` + `b17_content_fact('initiative')` (`b17-content.sql:787-794`) = selected **and** linked; `initiatives_library` E branch requires linked **and** `selected` (`:805-808`); no library row outside that set is admitted, and no E write policy was added to either table. No enumeration path (RLS-filtered aggregations only).
10. **Initiative status write scoping — CLOSED.** Insert/Update require own department + a `client_initiatives` row of the same tenant (`:874-893`), the `departments` join keeps tenant resolution mandatory, and the handler re-binds the selection to `access.tenantId` (`routes/departmentInitiatives.ts:67-70`).
11. **Audit additions are a closed set — CLOSED.** Exactly three actions appended to the explicit IN-list (`b17-content.sql:499-502`); no wildcard, actor-bound above (`:480`). The E-side actions ride the pre-existing `OR b17_work_tenant(client_id)` catch-all (`:529`) with `user_id = current_actor_id`, so they introduce no new admission rule.
12. **`b17_version_update` — JUSTIFIED, no request-reachable path.** `b17-content.sql:922-924` trusts only `current_purpose='migration'`; grepping `src/` and `scripts/`, that purpose is set only by offline callers (`b17ContentMigration.ts:241`, `b17Readiness.ts:245`, scratch scripts) — never by a handler. It mirrors the existing INSERT gate `b17_version_write` (`b17.sql:63`), adds no definer or grant, and the GUC-trust premise is the pre-existing accepted model (B17-U2C2 residual), not a U4-1c delta. Its only effect is re-pinning a checksum on a table that is already world-readable (`b17.sql:62`) and whose shape is re-verified on every readiness run.
13. **Targetless `platform_config` read branch — leak REFUTED for the read, not for the count.** `b17-content.sql:827` (`OR b17_platform_config() OR b17_platform_scope()`) admits all `document_requirements` rows only inside server-set P contexts; the rows are catalog metadata (title/description/tags/service/department ids) with no tenant payload, and it is required for P's own pre-reads (`routes/documents.ts:110-112,151-153`). It does **not** extend to `document_submissions` — which is precisely H-01.
14. **No deps / secrets / style drift.** `package.json`, lockfiles, `.env*`, `b17.sql`, `b17ContentMigration.ts` and every `views/` path are untouched by `5efb0c8..HEAD`; no secret material in the new files; new files ≤500 lines per the census guard.

---

## Unverified / risks

- **Hash + shape pins** (`b17Readiness.ts:26-27,53`; `b17TransactionInventory.test.ts:44-46,59`) — require PG18 execution. Static text consistency only.
- **Cascade effect of H-01** — referential actions run outside row security, so I expect the tenant submission rows to be removed; the FK-violation alternative is also unacceptable. Either outcome must be proven once, live, by Tera.
- **RLS-in-subquery reliance** — findings assume policies on `departments`/`client_initiatives`/`document_requirements` apply to subqueries inside policy expressions (PostgreSQL semantics). I verified the text of every referenced policy but not run-time behaviour.
- **`b17_platform_scope()` admission in write policies** (`b17-content.sql:828-834`) is the pre-existing catalog-write pattern; U4-1c did not widen it beyond catalog tables.

## Decisions needed from Tera

1. H-01: choose the fix (fail-closed count kind vs `ON DELETE RESTRICT` vs both) — it is a schema+handler change and re-runs the readiness measurement.
2. M-01: accept the collision as a known limitation or require an immutable discriminator (changes the standard-code shape for already-created buckets).
3. L-01: confirm whether P is actually intended to read both lists; if yes, the handler gate must change, if no, the matrix note should say so.
4. L-03: confirm the intended scope of a department-bound requirement (client-scoped vs catalog-scoped) before any live data is written.

## Static bounds of this review

Read-only. No test, build, script or database was run; no source, test or control file was written. `security-reports/TASK-PROTO-U4-1c-fix-review.md` is the only file created. Live execution, the one-transaction migration and the E-flow verification remain Tera's.
---

# RECHECK — round 2 (static), reviewed `1b25cb7` → `42596a1`

Mode: Fix Review / recheck. Same static bounds (no execution, no DB, no installs, no subagents; only this file written). The round-1 text above is preserved as the round-1 record; the table below is the current status.

| # | Round-1 finding | Status after round 2 | Evidence |
|---|---|---|---|
| H-01 | RLS-blind blocker count → cascade delete | **CLOSED (static)** | `schema.sql:122` RESTRICT · `routes/documents.ts:183-191` 23503→409 · count removed · only delete path is `documents.ts:182` |
| M-01 | Bucket code collision merges two services | **CLOSED (static)** | `generalBucket.ts:45-55` id suffix · `:78-102` own-first lookup · `taxonomy.ts:411` · `generalBucket.test.ts:86-91` |
| M-02 | **(new)** P@T list reads still 403 and the new test pins a proxy | **OPEN** | `routes/documents.ts:211` + `departmentInitiatives.ts:27` vs `scope.ts:16-21`; false pin `documents.test.ts:87-92` |
| L-01 | declared P@T reads unreachable | **OPEN (partially fixed)** — 4 CRUD rows are now genuinely P@T; **both list reads still 403** | see M-02 |
| L-02 | initiative `performed` resettable after the stamp | **CLOSED** | `departmentInitiatives.ts:78-83` refusal before the upsert; test `departmentInitiatives.test.ts:18-30` |
| L-03 / F-05 | requirement bindable to a foreign tenant's department | **CLOSED** | `schema.sql:1415-1433` client_id + uniqueness · `b17-content.sql:819-831` · `routes/documents.ts:68-71,98-100,136-143,173,181` |
| F-06 | `evidence_files` has no FK to its parent | **OPEN (exposure reduced)** | `schema.sql:1448-1460` unchanged; the app-level cascade trigger is gone, so orphans now require an operator client delete |
| F-10 | tautological empty-code test | **CLOSED (real test)** | `generalBucket.test.ts:95-99` asserts `''` vs `'   '` and two distinct suffixed codes |

## H-01 — closed, and the guarantee is now the right one

- `schema.sql:122`: `requirement_id … REFERENCES document_requirements(id) ON DELETE RESTRICT`; the round-1 `ON DELETE CASCADE` is gone (asserted by `documents.test.ts:72-73`).
- `routes/documents.ts:178-191`: no pre-check; the DELETE is wrapped and `23503` maps to the unit's own `409 documents.dependency`. No raw PG text is echoed (`writeFailure` would also collapse it), and the refusal path performs no write.
- **Only path to a requirement row:** `documents.ts:182`. `services`/`clients` cascade FKs exist but no route deletes a service or a client (`taxonomy.ts` has no `DELETE /services/:id`; grep: client deletes appear only in `scripts/*`). `DELETE /standards/:id` and `DELETE /disclosures/:id` reach disclosures/items, not requirements (`schema.sql:1399-1409` references `services` only).
- **TOCTOU closed structurally:** `RESTRICT` takes the parent-row lock, so a concurrent employee INSERT (`b17-content.sql:855-862`) either commits first (delete refuses) or blocks. No handler logic is load-bearing any more — the RLS-blindness that caused round 1 is now irrelevant by construction.
- Round 2 also narrowed the blast radius: the requirement is client-scoped, so even a hypothetical bypass cannot reach another client's submissions (`b17-content.sql:819-831`).

## M-01 — closed; residual noted

`GENERAL-<slug(40)>-<first8(serviceId)>` (`generalBucket.ts:45-55`) makes `standards.code` unique per service; the read-back prefers the service's own bucket (`:78-82`), and the only fallback is a general-category standard **already mapped to this service** (`:79-82`) — so no cross-service adoption is possible. Residuals: (a) a pre-suffix collided pair that was never renamed still resolves both services to the shared legacy row (adoption is by `ORDER BY st.code LIMIT 1` over general-category standards mapped to the service); (b) `taxonomy.ts:409` still excludes the source bucket by derived code, so a *legacy*-coded source bucket is not excluded from a duplicate's link copy. Both are limited to a database that ran round 1 and need a P action or a rename; no tenant data crosses. Low.

## M-02 — the two P@T list reads are still dead, and a new pin now asserts the wrong thing

- `routes/documents.ts:211` and `routes/departmentInitiatives.ts:27` both call `ownDepartment(req.access!)`, and `scope.ts:16-21` (`assertWorkScope`) throws `scope.denied` when `mode === 'platform'`. Both calls happen **before** `domainTransaction`, so the `platformConfigContext(live, tenant)` selector that round 2 added (`documents.ts:235`, `departmentInitiatives.ts:48`) is never reached for P. A `P@T` caller still gets 403 — F-03/L-01 are **not** closed for the reads (the four requirement CRUD rows are, correctly: they call `requirementTenant` + `assertLinkedService`, no `ownDepartment`).
- `documents.test.ts:87-92` "R3: both P@T lists really run the platform configuration context for P" asserts only that the selector *string* exists in the two files. That string existed in round 1 as well; the test therefore passes while the behaviour is absent — a false pin, and the reason this regression survived the round-2 pass.
- **Direction:** either return `null` for platform mode in a dedicated list-scope helper (leaving `ownDepartment` untouched, since other callers rely on its refusal), or restrict the two rows to `W:L;C:L;E:L+D` and drop the `P@T` claim. Then replace the proxy pin with an assertion on the guard order (e.g. that `ownDepartment` is not called on the platform path) or, better, an executed proof. Tera's call — the matrix and the handler must agree either way.

## New bypasses hunted (round 2 deltas) — none found

1. **`client_id` semantics.** Every requirement predicate now carries `client_id` (read `b17-content.sql:821,826`; insert/update/delete `:828-845`), the handler repeats it in SQL (`documents.ts:79,99,136,173,181`), `GET /requirements` filters `r.client_id = $1` (`:231`), and the submission policies require `r.client_id = document_submissions.client_id` (`b17-content.sql:858,869`). Cross-client read/write/delete/bind all fail; the department existence check is also client-bound (`documents.ts:98,141`). No new path.
2. **Unique constraints.** `UNIQUE(client_id, service_id, department_id, title)` (`schema.sql:1425-1429`) + the NULL-department partial index (`:1431-1432`) are additive; a conflict surfaces as a generic 500 through `writeFailure` (SQLSTATE is collapsed), so no existence oracle is created and nothing is reachable by a non-P role.
3. **Bucket rename.** `ensureGeneralBucket` re-resolves after a rename and reports `adopted` (`generalBucket.ts:100-102`) — converges, no duplicate is minted (`generalBucket.test.ts:110-118`). `generalStandardCode` now needs the id and every call site passes it (provenance grep; two-arg arity is compiler-enforced), so no `undefined`-suffix bucket can be minted.
4. **P@T branch.** The RLS P branches require `target_id IS NOT NULL` + `client_id = target_id` + the linked-service fact (`b17-content.sql:826-831,833-845`); the targetless platform branch is gone. A P cannot reach a requirement, department or submission outside the named client.
5. **New observation (Low, defense-in-depth).** `b17_document_requirements_insert` (`:828-830`) does not repeat the linked-service fact that the handler enforces (`documents.ts:95`). A row bound to an unlinked service would be invisible to every reader (all branches require `content_fact('service',…)`), so it is a dead row, not a leak — recorded only so a future handler change does not inherit the gap.
6. **New observation (Low, operational).** `document_requirements.client_id ON DELETE CASCADE` composed with the new `RESTRICT` means an operator client delete can now fail with 23503; cleanup scripts that swallow errors (`scripts/b16-proof.ts:346`, `scripts/ge-provision-proof.ts:204`) would silently leave a client behind. Not an app path; flag for Tera's live/cleanup SQL.

## Pins judged (static)

Internally coherent: `routes.ts` is untouched this round → its pin is unchanged (`b17TransactionInventory.test.ts:92`); `accessRegistry.ts`, `b17-content.sql` and `b17Readiness.ts` all moved → their four pins moved (`:95-96,107`); the readiness content hash quoted in `b17Readiness.ts:42` equals the test pin (`07e9c994…`); `allowed.size` stays 91 because round 2 added no file; `documents.ts` is 448 lines (under the 500-line new-file bound); `scripts/b17-showcase.ts` was already allow-listed (`:263`). Values themselves remain **UNVERIFIED** — recomputation needs PG18; Tera's live run is the proof.

## Round-2 verdict

| Severity | Open after recheck |
|---|---|
| High | 0 |
| Medium | 1 — M-02 (P@T list reads still 403 + false pin) |
| Low | 3 — F-06 (reduced), plus the two round-2 observations above |
| Unverified | pins/shapes (static) |

No gate decision is issued here. H-01 and M-01 are defensibly closed on static evidence; the destructive-delete class has no remaining app-reachable path.
---
# Round 3 — independent defensive recheck (static)

RISK_SIGNAL raised to Tera. Reviewed HEAD 4eb36e9 against 42596a1 and base 5efb0c8; preserved pre-existing modified Shield and QA reports. Read task, B17 spec 7.1, OD-11/12, reviews, policies, handlers and dependencies. No live DB, tests, application, exploit or other session used. Runtime outcomes unverified by Shield. No final gate decision.

## HIGH R3-01 — Initiative unselection can cascade submitted department status (OPEN)
src/server/routes/initiatives.ts:166-179 permits W to unselect and delete client_initiatives; src/db/schema.sql:1456-1465 defines initiative_department_status.client_initiative_id ON DELETE CASCADE. No status dependency refusal occurs on that path. Referential deletion can remove submitted department statuses; evidence_files.entity_id is a bare UUID (:1474-1485), leaving proof orphaned and absent from lists. Audit records unselection, not individual status removals. Effective deployed FK/trigger behavior NOT VERIFIED. Tera should decide retention semantics and implement an atomic race-safe dependency restriction or preservation model. Corrects round-2 F-06 claim that orphaning requires an operator client deletion.

## HIGH R3-02 — Evidence and submitted-state locks have concurrency gaps (OPEN)
src/server/routes/documents.ts:263-284 reads an existing submission without a row lock, computes provided and submitted_at from the snapshot, then writes both; departmentInitiatives.ts:74-95 follows the same pattern for performed/submitted_at. documents.ts:310-317 and :421-440 check an unlocked parent then delete the file in a later statement. auth.ts:125-134 acquires compatible SHARE session/user locks, so concurrent employee requests can overlap. A stale note/status update can overwrite a concurrently set stamp or provided/performed value; a delete that read NULL can execute after a concurrent submit. Runtime interleaving and effective DB policies NOT VERIFIED. Recommended: serialize submit/update/delete on the same parent or use guarded atomic predicates, and verify both parent types under concurrency including audit and rollback. Corrects prior unconditional lock-closure claim.

## MEDIUM R3-03 — General-bucket collision remains possible (REOPEN M-01)
src/lib/generalBucket.ts:36-53 truncates the slug and uses only the first eight UUID hex digits. Distinct UUIDs sharing those digits and slug-equivalent service codes yield the same expected code; :84 selects it without ownership proof, :94-98 adopts an ON CONFLICT row, and :114-117 links it to the second service. Also :85-88 adopts any mapped general-category standard; taxonomy.ts:404-411 excludes only the expected code during duplication, so a renamed or shared legacy bucket can propagate. services.id is UUID-unique (schema.sql:62-65), not prefix-unique. Impact: cross-service catalog/question contamination, not demonstrated cross-tenant evidence access. Recommend full stable service identity plus fail-closed ownership validation, explicit legacy handling, and tests for identical UUID prefixes and shared/renamed mappings. Earlier claim that first-eight ensures uniqueness was incorrect.

## MEDIUM R3-04 — Requirement rebinding can invalidate submissions (OPEN)
src/server/routes/documents.ts:117-152 permits updating departmentId after checking target-client department, without an existing-submissions guard. GET /requirements filters the requirement department for E (:231-237), while b17-content.sql:876-882 requires the current requirement department to match on submission update. Rebinding a general or department-A requirement to department B can hide it from A and prevent A updating its existing record; W/C/P may see a B-labelled requirement containing A historical submissions. RESTRICT at schema.sql:1444 prevents DELETE, not UPDATE. Recommend immutable/versioned binding after submissions exist, with race-safe dependency protection. Runtime NOT VERIFIED.

## Prior findings and controls — current status
- G-01 audit: b17-content.sql:480,516-539 admits the three named requirement actions for actor-bound platform.config with explicit matching target; documents.ts:98-109,148-157,183-198 writes the audit in the transaction. The 42501 root is addressed statically; live actor/rollback unverified. The older NULL-client action branch :494-502 remains broader than the target-only comment; current handlers write tenant-bound rows.
- G-02/H-01: schema.sql:1444 RESTRICT; documents.ts:183-190 maps 23001 and 23503 to 409; no RLS-blind count. This protects requirement deletion, not initiative unselection (R3-01) or rebinding (R3-04). Earlier citation schema.sql:122 was incorrect; current line is 1444.
- G-03/L-01: documents.ts:210-240 and departmentInitiatives.ts:24-51 branch platform before ownDepartment inside the transaction; P@T uses explicit domainTenant and platformConfigContext. Static root addressed; HTTP not independently run.
- G-04: scripts/u41c-e2e.ts:118-179 contains behavioral HTTP CRUD, target-bound audit, FK refusal, P lists and negative-role assertions. The task reports earlier execution/live observations; Shield did not verify results. Script does not establish concurrency or prefix-collision safety.
- L-02 sequential refusal exists at departmentInitiatives.ts:78-85; concurrent closure not established (R3-02). L-03/F-05 client predicates and department checks exist at b17-content.sql:832-852 and documents.ts:91-95,125-134; cross-client runtime proof unverified.
- Download: documents.ts:377-403 binds file/type/parent triple and checks tenant/employee department; b17-content.sql:920-925 independently bounds tenant/department or P target. Upload checks own parent/department and MIME/size (:320-362). These are static observations, not exhaustive proof against enumeration; lifecycle risks remain open.
- Migration: B17 spec 7.1 requires operator-controlled atomic versioned activation and read-only readiness; b17-content.sql:940-945 gates ledger UPDATE to migration purpose and b17Readiness.ts:200-212 checks source/ledger/shape. Round 3 changes audit policy and content-shape pin; task claims live apply, not independently verified. CREATE TABLE IF NOT EXISTS cannot itself repair an existing FK, and adding NOT NULL client_id to populated rows needs a safe migration plan (schema.sql:1415-1418,1440-1444). Pins/effective live policy unverified.

## Continuous improvement — Tera handoff
Prior Shield rounds asserted unconditional collision-proof IDs, lock closure and no application orphaning despite source counterexamples; some file:line references were wrong. Quality-risk gap: require fresh dependency-graph review and explicit concurrent/negative cases before declaring a security property closed; verify citations against current HEAD. Please route this evidence-based GAP/AIS suggestion to the authorized Tera/project-control owner. This task permits no AGENT_GAPS_LOG or governance writes. Tera decides remediation and live/concurrency proof; no feature-disable or final gate decision made.
---
# Round PROTECT-1 � independent defensive review of bounded safety diff (static only)

- Task: TASK-PROTO-U4-1c-PROTECT (Task ID TASK-PROTO-U4-1c-PROTECT-SEC01)
- Agent: security-agent � ����� (defensive)
- Mode: Preventive Review of PROTECT diff (static only, no execution)
- Base reviewed: uncommitted PROTECT work over HEAD 4eb36e9 (git status + git diff --stat verified first)
- Inputs read: task file sections 7-15, B17_U41C_PROTECT_TECHNICAL_DELTA.md, TECHNOLOGY_PROFILE_DRAFT.md, full diff of src/server/routes/initiatives.ts + initiativeScope.ts + documents.ts + departmentInitiatives.ts + src/lib/documents.ts + src/lib/departmentInitiatives.ts + src/db/schema.sql + src/db/b17Readiness.ts, plus test and e2e diffs as corroboration only
- Bounds honored: source only, no DB execution, no live or shared DB contact, no secrets access, no network, no installs, no script execution, no source edits. Only this file appended.

## Verdict (no gate decision � Tera owns acceptance and Security Disposition)

| # | Severity | Title | State |
|---|---|---|---|
| P-01 | Low | Version shape check precedes authorization on both PATCH routes | OPEN (non-blocking note) |
| P-02 | Low | Unselect proof check is healthy-model scoped; orphan inventory stays outside the request path | OPEN (pre-existing class, not introduced) |
| Auth widening | � | None found | PASS (static) |
| Destructive path | � | No new destructive path; unselect guarded plus RESTRICT backstop | PASS (static) |
| Error neutrality | � | Owner Arabic exact; no stack or SQL or identifier leak | PASS (static) |
| FK and trigger | � | RESTRICT narrow; no new cascade; no new trigger | PASS (static) |
| Secrets and config | � | No hard-coded secrets; connection handling unchanged; b17-content and accessRegistry untouched | PASS (static) |
| Audit integrity | � | State changes audit with version; refusal paths write no audit | PASS (static) |

Parent TASK-PROTO-U4-1c stays ESCALATED and NOT ACCEPTED. Service-bucket collision finding R3-03 and requirement rebinding finding R3-04 are explicitly NOT waived and NOT closed by this review.

## Evidence (file:line, static citations)

1. Auth no widening. initiatives.ts POST select and DELETE unselect keep domainTenant plus eligible plus freeze checks and revalidate after the lock. documents.ts requirement PATCH now binds tenant in both pre-lock and post-lock reads, where the old code read by id alone. departmentInitiatives.ts status PATCH keeps ownEmployeeDepartment so W/C/P get zero writes. documents.ts loadEvidenceParent for initiative_status is now tenant-bound through selection plus department join, where the old code read status by id with no tenant. b17-content.sql and accessRegistry.ts have zero diff, so no policy or matrix widening.
2. Destructive bounded. initiatives.ts DELETE refuses with 409 initiatives.dependency when ANY status row or associated proof row exists, drafts included, and maps FK codes 23001 plus 23503 to the same approved Arabic refusal. schema.sql adds named initiative_department_status_selection_restrict ON DELETE RESTRICT and drops only the historical auto-named CASCADE in the same guarded DO block. POST select preserves ON CONFLICT DO NOTHING plus alreadySelected response and audit.
3. Concurrency design matches delta. initiativeScope.ts u41cProtectKey builds domain-separated canonical key with fixed prefix plus kind plus lowercased tenant plus resource UUIDs, validated by scopeId and fail-closed on bad kind. u41cProtectLock uses pg_advisory_xact_lock transaction-scoped only. Both PATCH routes reread scoped parent after the lock and use conditional version update with zero-row means stale conflict and no retry. Evidence upload and delete share the parent anchor and reread the same scoped parent plus selection linkage before acting.
4. Errors neutral. Stale conflict uses exact owner Arabic for concurrent edits; unselect refusal uses exact owner Arabic for dependency. Missing-version uses existing evaluations baseline wording with 400 version.required and null conflict fields. domainFailure in initiativeScope.ts collapses 500 to fallback and strips SQLSTATE-shaped codes, so the FK mapping path leaks no diagnostics. Conflict payloads carry only numeric current and provided revisions after full resource authorization.
5. Audit sound. Successful submission and status writes call recordAuditLog inside the same transaction with expectedVersion and new version in payload. Every refusal path throws before any audit call, so refusals fabricate no audit.

## P-01 � Low � version shape checked before authorization (non-blocking)

- Where: documents.ts PATCH pre-transaction parseExpectedVersion and departmentInitiatives.ts PATCH pre-transaction parseExpectedVersion, versus ownEmployeeDepartment and tenant checks inside domainTransaction.
- Effect: a denied role with a malformed version gets 400 version.required instead of 403 or 404. Fail-closed, conflict fields are null, no data disclosed. The e2e fixture sends expectedVersion 0 for the C denial so the 403 path is still exercised.
- Direction, if Tera wants strict ordering: move shape parsing inside the transaction after role plus tenant plus department gates. Not required for safety.

## P-02 � Low � orphan and ancestor scope stays outside the request-path guarantee (pre-existing, not introduced)

- schema.sql still cascades client and department ancestors and evidence_files still has no parent FK, same as before this diff. The new unselect proof check covers healthy-model proof linked through a live status for the same selection and tenant. A mismatched-tenant or status-less orphan row is not counted, but unselect deletes only the selection row and cannot delete such rows either.
- Distinct from introduced risk: this diff adds no orphan vector and removes the silent cascade vector for the selection link. Installed-data inventory plus ancestor-delete coverage plus upgrade parity remain separate authorization work.

## Explicitly UNVERIFIED (no execution per task bounds)

- Advisory-lock privilege and hashtextextended availability on the deployed role; RLS plus FORCE RLS plus FOR UPDATE interactions on deployed ACLs.
- Full race matrix and both commit and rollback orders through real routes; ABA reselect behavior; submit versus delete ordering on both parent types.
- Installed orphan and wrong-tenant inventory; fresh versus upgraded schema and ledger parity; client and library and department ancestor-delete coverage.
- Recomputed readiness pins and falsifiability run claims in comments; UTF-8 rendering of approved Arabic in real responses.
- Deployed-role equivalence of the surrogate-probe evidence cited in task sections 10 and 12; existing live orphans; any live migration or deployment.

## Residual risks

- R3-03 service-bucket collision: untouched by this diff, remains open for its separate unit.
- R3-04 requirement rebinding after submissions exist: the rebinding path is outside this diff, remains open and is not closed here.
- Advisory locks are not row security: the design rechecks after waiting, but any future writer that bypasses the anchor plus RESTRICT backstop reopens the race. No such writer is added here.
- Hash collision only adds serialization per design; distinct tenants cannot cross-read or cross-write through the key, but key parity under traffic is unverified.

## Decisions needed from Tera

1. Confirm P-01 ordering is acceptable as fail-closed, or direct the inside-transaction move.
2. Confirm orphan plus ancestor scope stays with the separate migration and inventory plan, not this safety diff.
3. No STOP raised by Shield on this diff alone. Future acceptance is still blocked pending independent QA plus auditor review, deployed-role evidence, migration parity, and the separate collision unit. Parent remains escalated.

## Static bounds of this round

Static source review only. No test, build, script, or database was run. No source, test, schema, control, or QA file was written. This section is the only write.

