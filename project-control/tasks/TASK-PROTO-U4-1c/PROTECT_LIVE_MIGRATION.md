# TASK-PROTO-U4-1c-PROTECT — live migration runbook (demo substrate)

Companion SQL: `PROTECT_LIVE_MIGRATION.sql` (one transaction, apply + guarded rollback).
Target: the shared demo database `b17_showcase` (PostgreSQL 18). Owner approved applying it.
Execution is Tera's. This document contains no credentials.

---

## 1. What this changes (nothing else)

Upgrades a DB at the **pre-PROTECT committed schema** to the current repository state:

| Item | Change |
|---|---|
| `client_initiatives.archived_at` | added `timestamp with time zone NULL` (NULL = active) |
| `initiative_department_status.version` | added `integer NOT NULL DEFAULT 1` |
| `document_submissions.version` | added `integer NOT NULL DEFAULT 1` |
| selection FK | legacy FK (auto-named `…_client_initiative_id_fkey` ON DELETE **CASCADE**, or the withdrawn `…_selection_setnull`) dropped; link re-enforced `NOT NULL`; the single named FK `initiative_department_status_selection_restrict` (`ON DELETE RESTRICT`) installed |
| RLS policy | the one owner-approved §21 policy `b17_selection_update` on `client_initiatives` (identical scope to `b17_selection_delete`) |
| ledger | `app_schema_versions` re-pinned (2 rows only, see §3) |

Not touched: business rows, `b17.sql`/`b17-content.sql` functions, grants/roles, other policies, UI, `evidence_attachments`, no table/column drop, no content replay.

---

## 2. Preconditions (the SQL aborts closed on any deviation)

- Repository at `f58fd98` (implementation) / `020f6ea` (evidence); `src/db/{schema.sql,b17-content.sql,b17Readiness.ts}` must match — the constants below are what the script pins.
- Run as the **substrate owner**: the NOSUPERUSER / NOBYPASSRLS principal that owns `public` tables — the same user the server connects with (`B17_DEMO_DATABASE_URL` in `.env`). The script refuses `SET ROLE`, superuser, BYPASSRLS, non-owner, and `row_security<>on`.
- Live catalog fingerprint must be the pre-PROTECT value `c9271835…dfc40a`; ledger must be exactly:
  - `B17_U1` = `ace11265…d8d6` / `f28b8352…5546`
  - `B17_U2D` = `4ff0f31c…ea055` / `c9271835…dfc40a`
- Selection FK present as the auto-named CASCADE. No `archived_at`, no version columns, no `b17_selection_update`.
- The app is **stopped** (old code expects the old schema; new code expects the new one). `ALTER TABLE` takes ACCESS EXCLUSIVE; `lock_timeout=15s` aborts if a stray session holds the tables.

> Note: today (HEAD = PROTECT constants) the un-migrated DB is already refused by the app with `b17.version_drift`. That is the expected pre-state, not an incident.

---

## 3. Authoritative constants (read from `src/db/b17Readiness.ts`, not invented)

| Constant | Value |
|---|---|
| `B17_VERSION` | `B17_U1` |
| `B17_SHAPE` | `c9d5a9e24ec9bf9128d17822d9f1ed1a` |
| `B17_CONTENT_VERSION` | `B17_U2D` |
| `B17_CONTENT_SHAPE` (= live fingerprint after apply) | `c1f87f043bffa8ad3c939c7993f2ab2e` |
| sha256(`src/db/b17.sql`) | `ace11265d876b6f18229dd62efa1db693cd8df00ecd0ea6012b448694406d8d6` |
| sha256(`src/db/b17-content.sql`, CRLF-normalised) | `8c165c40f8dd5d17bc7d2a42908a51ee7e1664ee3db3480e147884db24ab5a80` |
| pre-PROTECT content sha256 | `4ff0f31c455c37ca8d60b9cd8f4b1d67b8a05d3810ffa2ac03c300540d8ea055` |
| pre-PROTECT `B17_SHAPE` / `B17_CONTENT_SHAPE` | `f28b8352a1b6f68e01b3cc9d5b725546` / `c927183564e59ce9777b92e854dfc40a` |

`PREDECESSOR_SHAPE` (`5120cf74…`) is not used here: activation already exists.

---

## 4. Runbook

### Step 0 — maintenance window
Stop the app (and any script/worker using the DB). Confirm no sessions:
`SELECT count(*) FROM pg_stat_activity WHERE datname='b17_showcase' AND pid<>pg_backend_pid();`
(Only the operator's own session should remain. `pg_advisory_xact_lock(1717001)` serialises against the sanctioned offline appliers only, not against live app sessions.)

### Step 1 — backup (as PostgreSQL **superuser**)
The table owner cannot fully dump FORCE-RLS tables, so use the `postgres` role:
```powershell
& "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" -h 127.0.0.1 -p 55432 -U postgres -d b17_showcase `
  -Fc -f "D:\backups\b17_showcase_pre_protect_$(Get-Date -Format yyyyMMdd_HHmmss).dump"
```
Record the pre-state (also as superuser):
```sql
SELECT 'client_initiatives' k, count(*)::int n FROM client_initiatives
UNION ALL SELECT 'initiative_department_status', count(*)::int FROM initiative_department_status
UNION ALL SELECT 'document_submissions', count(*)::int FROM document_submissions
UNION ALL SELECT 'evidence_files', count(*)::int FROM evidence_files
UNION ALL SELECT 'audit_log', count(*)::int FROM audit_log
UNION ALL SELECT 'app_schema_versions', count(*)::int FROM app_schema_versions;
SELECT version, checksum, structure_checksum FROM app_schema_versions ORDER BY version;
```
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
  -f "D:\Teranoo Work\Client01\prototype-app\project-control\tasks\TASK-PROTO-U4-1c\PROTECT_LIVE_MIGRATION.sql"
Remove-Item Env:\PGPASSWORD
```
Expected on success (exit code 0):
```
*** MODE: APPLY (upgrade to PROTECT) ***
NOTICE:  u41c.protect: mode=predecessor shape=c9271835… — upgrading
NOTICE:  u41c.protect: OK mode=predecessor shape=c1f87f04…
COMMIT
```
Always run the **whole file** (`-f`). Never paste statements one by one: a GUI session commits each statement and a mid-file error would leave a partial schema.

### Step 3 — verify after apply
1. Ledger (superuser or owner):
   ```sql
   SELECT version, checksum, structure_checksum FROM app_schema_versions ORDER BY version;
   ```
   Must be exactly two rows: `B17_U1` = `ace11265…` / `c9d5a9e2…`, `B17_U2D` = `8c165c40…` / `c1f87f04…`.
2. Application readiness (this is `verifyB17`, exactly what the server enforces at boot), from the repo root:
   ```powershell
   npx tsx -e "import('dotenv').then(d=>{d.config();return import('./src/db/b17Readiness.ts')}).then(m=>m.assertB17Ready()).then(()=>console.log('B17 READY')).catch(e=>{console.error(e.message);process.exit(1)})"
   ```
   Must print `B17 READY` (it refuses `b17.schema_drift` / `b17.version_drift` / `b17.content_authority_drift` otherwise). Alternative: start the server (`npm start`) and observe it listens — the server aborts before listening on any drift.
3. Counts unchanged vs Step 1: `client_initiatives`, `initiative_department_status`, `document_submissions`, `evidence_files`, `audit_log` identical; `app_schema_versions` still 2.
4. Sanity on the new columns (superuser):
   ```sql
   SELECT count(*) FROM client_initiatives WHERE archived_at IS NOT NULL;     -- 0
   SELECT min(version), max(version) FROM initiative_department_status;        -- 1, 1
   SELECT min(version), max(version) FROM document_submissions;                -- 1, 1
   ```
5. Restart the app on HEAD code (the old code must not serve against the new schema: its unselect path deletes, which RESTRICT now refuses).

### Step 4 — rollback (only if needed, only before PROTECT-era traffic)
Mandatory superuser pre-checks — all must return `0`:
```sql
SELECT 'archived' k, count(*) FROM client_initiatives WHERE archived_at IS NOT NULL
UNION ALL SELECT 'status_version<>1', count(*) FROM initiative_department_status WHERE version <> 1
UNION ALL SELECT 'submission_version<>1', count(*) FROM document_submissions WHERE version <> 1;
```
Then:
```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -X -v ON_ERROR_STOP=1 -v run_rollback=1 -v confirm_no_protect_state=YES `
  -h 127.0.0.1 -p 55432 -U b17showcaseowner -d b17_showcase `
  -f "…\PROTECT_LIVE_MIGRATION.sql"
```
Expected: `u41c.rollback: OK — pre-PROTECT fingerprint restored, ledger restored, 2 rows` and fingerprint back to `c9271835…`. The rollback refuses (a) if the live shape is not the PROTECT target, (b) if the ledger is not the PROTECT pin, (c) without the explicit `confirm_no_protect_state` flag. After rollback the app must be run at the pre-PROTECT code revision. Restore-from-backup instead if any pre-check is non-zero (that is state loss, not a rollback).

---

## 5. Detecting a partial / no-op application

| Symptom | Meaning |
|---|---|
| non-zero exit, `u41c.stop: shape drift — live catalog fingerprint <md5> is neither…` | Nothing was applied (single transaction, rolled back). The measured md5 identifies the state; do **not** hand-patch — restore backup or escalate. |
| non-zero exit, `u41c.stop: principal is superuser/bypassrls` / `not owner` / `ledger row count` / `B17_U1 ledger checksum` | Refused before any DDL. |
| `ERROR: null value in column "client_initiative_id" … violates not-null constraint` | A pre-existing nulled link (round-2 SET NULL residue). Fail-closed; full rollback; escalate with the aggregate count only. |
| Re-run prints `mode=target … converging and re-verifying (no data touched)` | The DB was already upgraded; the re-run re-converges the same DDL/policy and re-pins the same ledger values, touching no rows. |
| App refuses `b17.schema_drift` after apply | The DDL did not all land or a foreign object exists — compare the fingerprint md5 with `c1f87f04…` and stop. |
| App refuses `b17.version_drift` after apply | Ledger rows are not the §3 pins — check the two rows before anything else. |

No-op proof: a successful run always prints either `mode=predecessor` (real upgrade) or `mode=target` (idempotent re-run), and always ends inside the same transaction with the postcondition block (fingerprint, FK, policy, ledger) before `COMMIT`.

---

## 6. Row-count expectations (zero data loss)

The migration performs **no** INSERT/UPDATE/DELETE on business tables. Expected deltas:

| Table | Before → after |
|---|---|
| `client_initiatives` | identical count; all `archived_at` NULL |
| `initiative_department_status` | identical count; `version` = 1 on every existing row; `client_initiative_id` unchanged and NOT NULL |
| `document_submissions` | identical count; `version` = 1 on every existing row |
| `evidence_files` | identical count; bytes untouched |
| `audit_log` | identical count (no trigger fires on these tables; DDL writes no audit) |
| `app_schema_versions` | 2 → 2 rows, only `checksum`/`structure_checksum` re-pinned; `applied_at` untouched |

Upgrade preserves every status/evidence byte and converges to the same fingerprint as a fresh install of the current schema.

---

## 7. STOP conditions (do not proceed / restore backup)

- Any preferred shape or ledger value different from §3.
- `SET NOT NULL` violation, or any FK/policy name other than the three handled ones.
- Non-owner principal, superuser principal, `row_security<>on`, `current_user<>session_user`.
- App not stopped, or `lock_timeout` fired.
- Fingerprint after apply ≠ `c1f87f043bffa8ad3c939c7993f2ab2e`.
- Any temptation to "fix forward" by editing policies/constraints by hand.

## 8. Not covered by this migration (still open from task §24)

Deployed-role/ACL equivalence beyond ownership+non-super checks, installed orphan inventory (this script only aborts on nulled links), pool-5 deadlock behaviour under live traffic, UI display of archived state, and the separate R3-03/R3-04 findings. No cleanup, no push, no deployment.

---

## 9. Rehearsal evidence (isolated scratch, not the demo DB)

Run on a throwaway Docker `postgres:18.6` created from the pre-PROTECT bytes (`4eb36e9` schema + `b17.sql` + the current content file minus the PROTECT hunk, which reproduces the pre-PROTECT fingerprints exactly), as a NOSUPERUSER/BYPASSRLS=FALSE owner with FORCE RLS:

- apply: predecessor detected, result fingerprint `c1f87f04…`, single validated RESTRICT FK, policy present once, ledger re-pinned, statuses/evidence/submissions byte-identical (md5), counts identical, versions all 1;
- re-run: `mode=target`, exit 0, no row change;
- rollback block: exact pre-PROTECT fingerprint and ledger restored, CASCADE FK restored, columns/policy removed, counts and bytes unchanged; re-apply returns to target;
- partial DDL (one column only) and a foreign third shape: refused with `u41c.stop: shape drift …`, ledger/FK/columns untouched;
- the app's own `assertB17Ready()`: REFUSED `b17.version_drift` before the migration, `READINESS OK` after it.
