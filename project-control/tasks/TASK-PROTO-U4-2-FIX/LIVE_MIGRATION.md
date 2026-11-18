# TASK-PROTO-U4-2-FIX — live migration runbook (shared demo substrate)

Companion SQL: `LIVE_MIGRATION.sql` (one transaction apply + guarded rollback).
Target: the shared demo database `b17_showcase` (PostgreSQL 18). Owner approved
applying it. Execution is Tera's. This document contains no credentials.

---

## 1. What this changes (nothing else)

Upgrades a DB at the **pre-FIX (PROTECT-shape) state** to the current FIX
repository state:

| Item | Change |
|---|---|
| `items.version/status/archived_at/archive_reason` | added (`INT NOT NULL DEFAULT 1` / `TEXT NOT NULL DEFAULT 'active'` / `TIMESTAMPTZ NULL` / `TEXT NULL`) + `items_status_valid` CHECK |
| `item_versions` | new table, `item_id → items ON DELETE RESTRICT`, `UNIQUE(item_id, version)`, append-only (no UPDATE/DELETE policy) |
| `approved_service_copies` | new table, tenant FK `client_id CASCADE` only, `service_id UUID NULL` (**no FK into the catalog** — copies survive full source-service removal), `status CHECK (status IN ('sealed'))` |
| `approved_copy_files` | new table, `copy_id → approved_service_copies ON DELETE CASCADE`, 5 MB CHECK mirrored from `evidence_attachments` |
| indexes | `ix_item_versions_item`, `ix_approved_service_copies_client`, `ix_approved_copy_files_copy` |
| RLS | `ENABLE + FORCE` on the three new tables (policies live in §2 deltas) |
| RLS policies | P1 six (`b17_item_versions_read/insert`, `b17_approved_copies_read/insert`, `b17_approved_copy_files_read/insert`) incl. SHIELD-P1-01/02/03; P4 two (`b17_answers_reopen_update`, `b17_attachments_seal_read`); audit whitelist P1/SHIELD-P1-04 (`b17_audit_insert` DROP+CREATE with `CREATE_STANDARD/CREATE_DISCLOSURE/ARCHIVE_ITEM/REOPEN_ITEM_SCOPE/SERVICE_DELETED/IMPORT_CATALOG_COMMITTED` NULL-tenant + `APPROVED_COPY_SEALED` target-bound only) |
| ledger | `app_schema_versions` re-pinned (2 rows only, see §3) |

Not touched: business rows, `b17.sql` functions/grants/roles, other policies,
UI, GROUP-bucket backfill (handler-owned, stays lazy), no table/column drop, no
content replay beyond the enumerated hunks.

---

## 2. Preconditions (the SQL aborts closed on any deviation)

- Repository at the FIX HEAD whose pins are §3; `src/db/{schema.sql,b17-content.sql,b17Readiness.ts}` must match — the constants below are what the script pins.
- Run as the **substrate owner**: the NOSUPERUSER / NOBYPASSRLS principal that owns `public` tables — the same user the server connects with (`B17_DEMO_DATABASE_URL` in `.env`). The script refuses `SET ROLE`, superuser, BYPASSRLS, non-owner, and `row_security<>on`.
- Live catalog fingerprint must be the pre-FIX value `c1f87f04…`; ledger must be exactly:
  - `B17_U1` = `ace11265…d8d6` / `c9d5a9e2…ed1a`
  - `B17_U2D` = `8c165c40…ab5a80` / `c1f87f04…2ab2e`
- No `item_versions` / `approved_service_copies` / `approved_copy_files` tables, none of the four new `items` columns, none of the eight FIX policies.
- The app is **stopped** (old code expects the old substrate; new code expects the new one). `ALTER TABLE` takes ACCESS EXCLUSIVE; `lock_timeout=15s` aborts if a stray session holds the tables.

> Note: today (HEAD = FIX pins) the un-migrated DB is refused by the app with `b17.version_drift`. That is the expected pre-state, not an incident.

---

## 3. Authoritative constants (re-measured from disk 2026-11-18, rehearsal §9)

| Constant | Value |
|---|---|
| `B17_VERSION` | `B17_U1` |
| `B17_SHAPE` (new) | `e1bb70b605f9a59be49cf1c25a396c0a` |
| `B17_CONTENT_VERSION` | `B17_U2D` |
| `B17_CONTENT_SHAPE` (new, = live fingerprint after apply) | `90967166a353283de10488a43c393ac8` |
| sha256(`src/db/b17.sql`) | `ace11265d876b6f18229dd62efa1db693cd8df00ecd0ea6012b448694406d8d6` (unchanged since PROTECT) |
| sha256(`src/db/b17-content.sql`, LF) — new `B17_U2D.checksum` | `9d08ad5636a99fd7c86d45e6a2ae0239e91df7e428c460c58124c4b2b5261188` |
| pre-FIX `B17_U2D.checksum` (PROTECT-doc pin; re-verify live in §4 step 1) | `8c165c40f8dd5d17bc7d2a42908a51ee7e1664ee3db3480e147884db24ab5a80` |
| pre-FIX `B17_U1` / `B17_CONTENT_SHAPE` (= live pins) | `c9d5a9e24ec9bf9128d17822d9f1ed1a` / `c1f87f043bffa8ad3c939c7993f2ab2e` |
| `PREDECESSOR_SHAPE` | `61462b72e42c5b27911eb7087c756abd` (schema-only shape; unused by this migration, recorded for the chain) |

Delta inventory (byte-traceable to disk; every hunk verified verbatim in rehearsal):

| Hunk | Disk source | Lines |
|---|---|---|
| schema batch (tables, columns, constraints, indexes, RLS enable/force) | `src/db/schema.sql` | 1552–1662 |
| `b17_audit_insert` DROP+CREATE (P1/SHIELD-P1-04 whitelist) | `src/db/b17-content.sql` | 495–568 |
| `b17_attachments_seal_read` (P4 ruling B) | `src/db/b17-content.sql` | 424–439 |
| `b17_answers_reopen_update` (P4 ruling C) | `src/db/b17-content.sql` | 1050–1069 |
| P1 RLS block incl. SHIELD-P1-01/02/03 (six policies) | `src/db/b17-content.sql` | 1360–1436 |

---

## 4. Runbook

### Step 0 — maintenance window
Stop the app (and any script/worker using the DB). Confirm no sessions:
`SELECT count(*) FROM pg_stat_activity WHERE datname='b17_showcase' AND pid<>pg_backend_pid();`
(Only the operator's own session should remain. `pg_advisory_xact_lock(1717001)` serialises against the sanctioned offline appliers only, not against live app sessions.)

### Step 1 — backup (as PostgreSQL **superuser**)
The table owner cannot fully dump FORCE-RLS tables, so use the `postgres` role.
Custom format (`-Fc`) is binary-safe: bytea evidence bytes are preserved exactly, no encoding conversion:
```powershell
& "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" -h 127.0.0.1 -p 55432 -U postgres -d b17_showcase `
  -Fc -f "D:\backups\b17_showcase_pre_fix_$(Get-Date -Format yyyyMMdd_HHmmss).dump"
```
Record the pre-state (also as superuser) — business counts first, then the ledger pin check that gates the apply:
```sql
SELECT 'standards' k, count(*)::int n FROM standards
UNION ALL SELECT 'disclosures', count(*)::int FROM disclosures
UNION ALL SELECT 'items', count(*)::int FROM items
UNION ALL SELECT 'client_initiatives', count(*)::int FROM client_initiatives
UNION ALL SELECT 'initiative_department_status', count(*)::int FROM initiative_department_status
UNION ALL SELECT 'document_submissions', count(*)::int FROM document_submissions
UNION ALL SELECT 'evidence_files', count(*)::int FROM evidence_files
UNION ALL SELECT 'audit_log', count(*)::int FROM audit_log
UNION ALL SELECT 'app_schema_versions', count(*)::int FROM app_schema_versions;
SELECT version, checksum, structure_checksum FROM app_schema_versions ORDER BY version;
```
Known live values (Tera-provided 2026-11-18): catalog triple **541/34/118** and ledger **B17_U1 `ace11265…/c9d5a9e2…`, B17_U2D `8c165c40…/c1f87f04…`**.
**STOP** on any deviation: the per-table counts above must each match the known values, and the ledger rows must equal §2 exactly (including `B17_U2D.checksum = 8c165c40…` — if the checksum differs while the structure matches, do NOT edit the script; escalate for a re-measure).
Restore drill (optional but recommended, never over the live DB):
```powershell
& "C:\Program Files\PostgreSQL\18\bin\createdb.exe" -h 127.0.0.1 -p 55432 -U postgres b17_showcase_restorecheck
& "C:\Program Files\PostgreSQL\18\bin\pg_restore.exe" -h 127.0.0.1 -p 55432 -U postgres -d b17_showcase_restorecheck "D:\backups\<file>.dump"
& "C:\Program Files\PostgreSQL\18\bin\dropdb.exe" -h 127.0.0.1 -p 55432 -U postgres b17_showcase_restorecheck
```

### Step 2 — apply (as the substrate owner)
Password: take it from the existing environment/`.env` — do not paste it into logs.
```powershell
$env:PGPASSWORD = '<substrate-owner password>'
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -X -v ON_ERROR_STOP=1 `
  -h 127.0.0.1 -p 55432 -U b17showcaseowner -d b17_showcase `
  -f "D:\Teranoo Work\Client01\prototype-app\project-control\tasks\TASK-PROTO-U4-2-FIX\LIVE_MIGRATION.sql"
Remove-Item Env:\PGPASSWORD
```
Expected on success (exit code 0):
```
*** MODE: APPLY (upgrade to FIX) ***
NOTICE:  u42fix.migrate: mode=predecessor shape=c1f87f043bffa8ad3c939c7993f2ab2e — upgrading
NOTICE:  u42fix.migrate: OK mode=predecessor shape=90967166a353283de10488a43c393ac8 ledger=B17_U1/B17_U2D re-pinned
COMMIT
```
Always run the **whole file** (`-f`). Never paste statements one by one: a GUI session commits each statement and a mid-file error would leave a partial schema.

### Step 3 — verify after apply
1. Ledger (superuser or owner):
   ```sql
   SELECT version, checksum, structure_checksum FROM app_schema_versions ORDER BY version;
   ```
   Must be exactly two rows: `B17_U1` = `ace11265…` / `e1bb70b6…`, `B17_U2D` = `9d08ad56…` / `90967166…`.
2. Application readiness (this is `verifyB17`, exactly what the server enforces at boot), from the repo root:
   ```powershell
   npx tsx -e "import('dotenv').then(d=>{d.config();return import('./src/db/b17Readiness.ts')}).then(m=>m.assertB17Ready()).then(()=>console.log('B17 READY')).catch(e=>{console.error(e.message);process.exit(1)})"
   ```
   Must print `B17 READY` (it refuses `b17.schema_drift` / `b17.version_drift` / `b17.content_authority_drift` otherwise). Alternative: start the server (`npm start`) and observe it listens — the server aborts before listening on any drift.
3. Counts unchanged vs Step 1: every business table identical (including the 541/34/118 triple); `app_schema_versions` still 2.
4. Sanity on the new columns (superuser):
   ```sql
   SELECT min(version), max(version) FROM items;              -- 1, 1
   SELECT count(*) FROM items WHERE status <> 'active';       -- 0
   SELECT count(*) FROM items WHERE archived_at IS NOT NULL OR archive_reason IS NOT NULL;  -- 0
   SELECT count(*) FROM item_versions;                        -- 0
   SELECT count(*) FROM approved_service_copies;              -- 0
   SELECT count(*) FROM approved_copy_files;                  -- 0
   ```
5. Restart the app on HEAD code (the pre-FIX code must not serve against the new substrate).

### Step 4 — rollback (only if needed, only before FIX-era traffic)
Mandatory superuser pre-checks — all must return `0` (any non-zero means FIX-era state exists: restore from the Step-1 backup instead, this rollback is then state loss, not a rollback):
```sql
SELECT count(*) FROM item_versions
UNION ALL SELECT count(*) FROM approved_service_copies
UNION ALL SELECT count(*) FROM approved_copy_files
UNION ALL SELECT count(*) FROM items WHERE version <> 1 OR status <> 'active'
  OR archived_at IS NOT NULL OR archive_reason IS NOT NULL;
```
Then:
```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -X -v ON_ERROR_STOP=1 -v run_rollback=1 -v confirm_no_fix_state=YES `
  -h 127.0.0.1 -p 55432 -U b17showcaseowner -d b17_showcase `
  -f "…\LIVE_MIGRATION.sql"
```
Expected: `u42fix.rollback: OK — pre-FIX fingerprint restored, ledger restored, 2 rows` and fingerprint back to `c1f87f04…`. The rollback refuses (a) if the live shape is not the FIX target, (b) if the ledger is not the FIX pin, (c) without the explicit `confirm_no_fix_state` flag. After rollback the app must be run at the pre-FIX code revision.

---

## 5. Detecting a partial / no-op application

| Symptom | Meaning |
|---|---|
| non-zero exit, `u42fix.stop: shape drift — live catalog fingerprint <md5> is neither…` | Nothing was applied (single transaction, rolled back). The measured md5 identifies the state; do **not** hand-patch — restore backup or escalate. |
| non-zero exit, `u42fix.stop: principal is superuser/bypassrls` / `not owner` / `ledger row count` / `B17_U1 ledger checksum` | Refused before any DDL. |
| `u42fix.stop: pre-FIX shape but … is not the pre-FIX pin` | Shape matches but ledger drifted (e.g. a hand edit). Restore backup; do not re-pin by hand. |
| `u42fix.stop: FIX shape but … is not the FIX pin` | Shape reached by a foreign path (hand DDL + hand ledger edit). Restore backup. |
| Re-run prints `mode=target … converging and re-verifying (no data touched)` | The DB was already upgraded; the re-run re-converges the same DDL/policy and re-pins the same ledger values, touching no rows. |
| App refuses `b17.schema_drift` after apply | The DDL did not all land or a foreign object exists — compare the fingerprint md5 with `90967166…` and stop. |
| App refuses `b17.version_drift` after apply | Ledger rows are not the §3 pins — check the two rows before anything else. |

No-op proof: a successful run always prints either `mode=predecessor` (real upgrade) or `mode=target` (idempotent re-run), and always ends inside the same transaction with the postcondition block (fingerprint, columns, FK, policies, RLS, ledger) before `COMMIT`.

---

## 6. Row-count expectations (zero data loss)

The migration performs **no** INSERT/UPDATE/DELETE on business tables. Expected deltas:

| Table | Before → after |
|---|---|
| `standards`, `disclosures`, `items` (541/34/118 triple) | identical counts |
| every other business table | identical count; new `items` columns carry defaults (`version` 1, `status` active, archive NULLs) |
| `item_versions`, `approved_service_copies`, `approved_copy_files` | absent → present, 0 rows |
| `app_schema_versions` | 2 → 2 rows, only `checksum`/`structure_checksum` re-pinned; `applied_at` untouched |

Upgrade preserves every row and converges to the same fingerprint as a fresh install of the current files.

---

## 7. STOP conditions (do not proceed / restore backup)

- Any ledger value different from §2 (pre-state) or §3 (post-state).
- Any shape value different from `c1f87f04…` (pre) or `90967166…` (post).
- Any business-table count different from the Step-1 snapshot (541/34/118 or otherwise).
- Non-owner principal, superuser principal, `row_security<>on`, `current_user<>session_user`.
- App not stopped, or `lock_timeout` fired.
- Fingerprint after apply ≠ `90967166a353283de10488a43c393ac8`.
- Any temptation to "fix forward" by editing policies/constraints/ledger by hand.
- Rollback pre-checks non-zero (FIX-era state exists) — restore from backup instead.

## 8. Not covered by this migration (still open)

Deployed-role/ACL equivalence beyond ownership+non-super checks, pool-5 deadlock behaviour under live traffic, visual AR/EN screen render + E-1…E-9 in-browser flows (NOT VERIFIED-live — visual pass happens on the shared app after this migration, before program closure), and the separate review findings already tracked. No cleanup, no push, no deployment.

---

## 9. Rehearsal evidence (isolated scratch, not the demo DB)

Own throwaway PG18.3 cluster on 127.0.0.1:55435 (initdb, NOSUPERUSER owner role), stopped + deleted afterwards. Two databases: FRESH (HEAD `schema.sql` raw + `b17.sql` + HEAD `b17-content.sql` + ledger) and PRE (reconstructed pre-FIX bytes: `schema.sql:1–1551` + `b17.sql` + `b17-content.sql` minus the §3 hunks + ledger with the §2 OLD pins):

- calibration: FRESH `PRE=61462b72… U1=e1bb70b6… CNT=90967166…`, `content_sha=9d08ad56…` — HEAD bytes reproduce all three committed pins exactly on this PG18;
- pre-reconstruction: PRE-DB `U1=c9d5a9e2… CNT=c1f87f04…` — reconstructed bytes reproduce **both live pins exactly** (structural exactness proved; the OLD content sha `8c165c40…` could not be byte-reproduced — the §4-step-1 live re-check covers it, and the shape gate is the strong gate);
- apply (`psql -f` as the NOSUPERUSER owner, exact live invocation): `mode=predecessor`, result `shape=90967166…`, ledger re-pinned to the §3 NEW pins, exit 0;
- zero loss: all 33 table counts identical before/after (new tables absent→0 rows; seeded tenant rows byte-identical);
- `MIGRATED_EQUALS_FRESH`: migrated shape == fresh shape;
- rerun: `mode=target`, exit 0, zero row change, shape stable;
- rollback guard: single `-v run_rollback=1` without the confirm flag prints NOT RUN and changes nothing;
- rollback (both flags, clean FIX state): `u42fix.rollback: OK`, fingerprint back to `c1f87f04…`, ledger back to the OLD pins, 3 tables + 4 columns + 8 FIX policies gone;
- re-apply after rollback: `mode=predecessor` again, back to `90967166…`, zero loss;
- foreign drift (pre-FIX base + junk table, OLD ledger pins): refused with `u42fix.stop: shape drift …` before any DDL; drift DB untouched (single txn rolled back).
- harness self-check worth recording: the first rehearsal caught a real idempotency bug (ledger pre-checks ordered before the shape branch refused a legitimate re-run); the script now checks the b17.sql-sha invariant first and the mode-dependent pins inside the shape branch. The fixed script is what was rehearsed above.
