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