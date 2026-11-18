# TASK-PROTO-U4-3 c1 — live migration runbook (shared demo substrate)

Companion SQL: `c1-LIVE_MIGRATION.sql` (one transaction apply + guarded rollback).
Target: the shared demo database `b17_showcase` (PostgreSQL 18) at its FIX shape.
Owner DDL design APPROVED 2026-11-18; live apply needs separate explicit
execution approval + backup. Execution is Tera's. This document contains no credentials.

---

## 1. What this changes (nothing else)

Upgrades a DB at the **FIX shape** to the current c1 repository state:

| Item | Change |
|---|---|
| `dept_match_overrides` | new table, per-(client,service,code) override (G4 auto-match + manual override), `client_department_id → departments ON DELETE RESTRICT`, `UNIQUE(client_id, service_id, service_dept_code)` |
| `participating_departments` | new table, membership allowlist for PUT participating-departments, `department_id → departments ON DELETE RESTRICT`, `PK(client_id, department_id)` |
| `staff_lists` delivery columns | added (`delivery_channel TEXT NULL` / `delivery_status TEXT NULL` / `revealed_by UUID NULL` / `revealed_at TIMESTAMPTZ NULL` / `reveal_acked_at TIMESTAMPTZ NULL`, all NULL-defaulted, NULL = undelivered) + 2 CHECKs (`staff_lists_delivery_valid`, `staff_lists_delivery_status_valid`) |
| RLS | `ENABLE + FORCE` on the two new tables (policies live in §2 deltas) |
| RLS policies | 17 additive branches: RLS-a ×2 (W link/unlink), RLS-b ×4 (W/C reads, W rows read, W approve submitted→approved, W provision INSERT), F1 ×1 (delivery UPDATE on approved rows), RLS-c ×1 (W-assisted completion), RLS-d ×1 (N/A lift to unevaluated), STORE-e ×4, STORE-g ×4 |
| audit | `b17_audit_insert` UNTOUCHED — no new branch needed (existing `OR b17_work_tenant(client_id)` work branch already admits the 7 new in-txn action names: `SERVICE_LINKED/UNLINKED`, `STAFF_LIST_APPROVED_BY_W`, `STAFF_PASSWORD_COMPLETED`, `NA_SCOPE_LIFTED`, `DEPT_MATCH_OVERRIDDEN`, `PARTICIPATING_DEPTS_SET`, `CREDENTIAL_DELIVERED` metadata-only) |
| ledger | `app_schema_versions` re-pinned (2 rows only, see §3) |

Not touched: business rows, `b17.sql` functions/grants/roles, other policies,
FIX tables/columns, email table (G1 reveal-only now — per-recipient table DEFERRED),
no table/column drop, no content replay beyond the enumerated hunks.

---

## 2. Preconditions (the SQL aborts closed on any deviation)

- Repository at the c1 HEAD whose pins are §3; `src/db/{schema.sql,b17-content.sql,b17Readiness.ts}` must match — the constants below are what the script pins.
- Run as the **substrate owner**: the NOSUPERUSER / NOBYPASSRLS principal that owns `public` tables — the same user the server connects with. The script refuses `SET ROLE`, superuser, BYPASSRLS, non-owner, and `row_security<>on`.
- Live catalog fingerprint must be the FIX value `90967166…`; ledger must be exactly:
  - `B17_U1` = `ace11265…d8d6` / `e1bb70b6…0a`
  - `B17_U2D` = `9d08ad56…8818` / `90967166…c8`
- No `dept_match_overrides` / `participating_departments` tables, none of the five `staff_lists` delivery columns, neither delivery CHECK, none of the 17 c1 policies. (`B17_U1` pins are invariant across this migration.)
- The app is **stopped** (old code expects the old substrate; new code expects the new one). `ALTER TABLE` takes ACCESS EXCLUSIVE; `lock_timeout=15s` aborts if a stray session holds the tables.

> Note: today (HEAD = c1 pins) the un-migrated DB is refused by the app with `b17.version_drift`. That is the expected pre-state, not an incident.

---

## 3. Authoritative constants (re-measured from disk 2026-11-18, rehearsal §9)

| Constant | Value |
|---|---|
| `B17_VERSION` | `B17_U1` |
| `B17_SHAPE` (invariant across this migration) | `e1bb70b605f9a59be49cf1c25a396c0a` |
| `B17_CONTENT_VERSION` | `B17_U2D` |
| `B17_CONTENT_SHAPE` (new, = live fingerprint after apply) | `76a272de85164db95670b1d43365c6e0` |
| sha256(`src/db/b17.sql`) | `ace11265d876b6f18229dd62efa1db693cd8df00ecd0ea6012b448694406d8d6` (unchanged since PROTECT) |
| sha256(`src/db/b17-content.sql`, LF) — new `B17_U2D.checksum` | `ff0ec3c3b20315607ba634b0bfb5cbf5b282738426f2114fbab36b55bfe4373e` |
| pre-c1 `B17_U2D.checksum` (FIX pin; re-verify live in §4 step 1) | `9d08ad5636a99fd7c86d45e6a2ae0239e91df7e428c460c58124c4b2b5261188` |
| pre-c1 `B17_U2D.structure_checksum` (= live pin) | `90967166a353283de10488a43c393ac8` |
| `PREDECESSOR_SHAPE` | `61462b72e42c5b27911eb7087c756abd` (schema-only shape; unused by this migration, recorded for the chain) |

Delta inventory (byte-traceable to disk; every hunk verified verbatim in rehearsal):

| Hunk | Disk source | Lines |
|---|---|---|
| schema batch (2 tables + ENABLE/FORCE, 5 delivery columns + 2 CHECKs) | `src/db/schema.sql` | 1664–1724 (banner 1664–1676 · STORE-e 1678–1696 · STORE-f 1700–1706 · STORE-g 1708–1724) |
| RLS-a W link/unlink ×2 | `src/db/b17-content.sql` | 1453–1475 |
| RLS-b W approve/provision b1–b4 | `src/db/b17-content.sql` | 1477–1532 |
| F1 delivery-UPDATE branch + comment | `src/db/b17-content.sql` | 1534–1561 |
| RLS-c W-assisted completion ×1 | `src/db/b17-content.sql` | 1563–1587 |
| RLS-d N/A-lift ×1 + F2 pin comment | `src/db/b17-content.sql` | 1589–1618 |
| STORE-e policies ×4 | `src/db/b17-content.sql` | 1620–1664 |
| STORE-g policies ×4 | `src/db/b17-content.sql` | 1666–1711 |

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
  -Fc -f "D:\backups\b17_showcase_pre_c1_$(Get-Date -Format yyyyMMdd_HHmmss).dump"
```
Record the pre-state (also as superuser) — business counts first, then the ledger pin check that gates the apply:
```sql
SELECT 'clients' k, count(*)::int n FROM clients
UNION ALL SELECT 'departments', count(*)::int FROM departments
UNION ALL SELECT 'users', count(*)::int FROM users
UNION ALL SELECT 'services', count(*)::int FROM services
UNION ALL SELECT 'client_services', count(*)::int FROM client_services
UNION ALL SELECT 'assignments', count(*)::int FROM assignments
UNION ALL SELECT 'staff_lists', count(*)::int FROM staff_lists
UNION ALL SELECT 'staff_list_rows', count(*)::int FROM staff_list_rows
UNION ALL SELECT 'audit_log', count(*)::int FROM audit_log
UNION ALL SELECT 'app_schema_versions', count(*)::int FROM app_schema_versions;
SELECT version, checksum, structure_checksum FROM app_schema_versions ORDER BY version;
```
Ledger must equal §2 exactly (including `B17_U2D.checksum = 9d08ad56…` — if the checksum differs while the structure matches, do NOT edit the script; escalate for a re-measure).
**STOP** on any deviation: the per-table counts must each match the snapshot taken now (record them), and the ledger rows must equal §2.
Restore drill (optional but recommended, never over the live DB):
```powershell
& "C:\Program Files\PostgreSQL\18\bin\createdb.exe" -h 127.0.0.1 -p 55432 -U postgres b17_showcase_restorecheck
& "C:\Program Files\PostgreSQL\18\bin\pg_restore.exe" -h 127.0.0.1 -p 55432 -U postgres -d b17_showcase_restorecheck "D:\backups\<file>.dump"
& "C:\Program Files\PostgreSQL\18\bin\dropdb.exe" -h 127.0.0.1 -p 55432 -U postgres b17_showcase_restorecheck
```

### Step 2 — apply (as the substrate owner)

Password: take it from the existing environment — do not paste it into logs.
```powershell
$env:PGPASSWORD = '<substrate-owner password>'
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -X -v ON_ERROR_STOP=1 `
  -h 127.0.0.1 -p 55432 -U b17showcaseowner -d b17_showcase `
  -f "D:\Teranoo Work\Client01\prototype-app\project-control\tasks\TASK-PROTO-U4-3\c1-LIVE_MIGRATION.sql"
Remove-Item Env:\PGPASSWORD
```
(`b17showcaseowner` = the NOSUPERUSER substrate owner from the FIX runbook; substitute the actual owner role if the deployment names it differently — the script itself enforces owner/non-superuser regardless of name.)
Expected on success (exit code 0):
```
*** MODE: APPLY (upgrade FIX-shape to c1) ***
NOTICE:  u43c1.migrate: mode=predecessor shape=90967166a353283de10488a43c393ac8 — upgrading
NOTICE:  u43c1.migrate: OK mode=predecessor shape=76a272de85164db95670b1d43365c6e0 ledger=B17_U1/B17_U2D re-pinned
COMMIT
```
Always run the **whole file** (`-f`). Never paste statements one by one: a GUI session commits each statement and a mid-file error would leave a partial schema.

### Step 3 — verify after apply

1. Ledger (superuser or owner):
   ```sql
   SELECT version, checksum, structure_checksum FROM app_schema_versions ORDER BY version;
   ```
   Must be exactly two rows: `B17_U1` = `ace11265…` / `e1bb70b6…`, `B17_U2D` = `ff0ec3c3…` / `76a272de…`.
2. Application readiness (this is `verifyB17`, exactly what the server enforces at boot), from the repo root:
   ```powershell
   npx tsx -e "import('dotenv').then(d=>{d.config();return import('./src/db/b17Readiness.ts')}).then(m=>m.assertB17Ready()).then(()=>console.log('B17 READY')).catch(e=>{console.error(e.message);process.exit(1)})"
   ```
   Must print `B17 READY` (it refuses `b17.schema_drift` / `b17.version_drift` / `b17.content_authority_drift` otherwise). Alternative: start the server (`npm start`) and observe it listens — the server aborts before listening on any drift.
3. Counts unchanged vs Step 1: every business table identical; `app_schema_versions` still 2.
4. Sanity on the new substrate (superuser):
   ```sql
   SELECT count(*) FROM dept_match_overrides;                 -- 0
   SELECT count(*) FROM participating_departments;            -- 0
   SELECT count(*) FROM staff_lists WHERE delivery_channel IS NOT NULL
     OR delivery_status IS NOT NULL OR revealed_by IS NOT NULL
     OR revealed_at IS NOT NULL OR reveal_acked_at IS NOT NULL;  -- 0
   SELECT count(*) FROM staff_lists WHERE status NOT IN ('draft','submitted','approved','rejected');  -- 0 (untouched domain)
   ```
5. Restart the app on HEAD code (the pre-c1 code must not serve against the new substrate).

### Step 4 — rollback (only if needed, only before c1-era traffic)

c1-era state = rows in the two new tables OR any non-NULL delivery column. Provisioned accounts, approvals, answers and evaluations are deliberately NOT gated here: rollback never drops them (source of truth preserved); only ephemeral membership/override/delivery metadata is removed.
Mandatory superuser pre-checks — all must return `0` (any non-zero means c1-era state exists: restore from the Step-1 backup instead, this rollback is then state loss, not a rollback):
```sql
SELECT count(*) FROM dept_match_overrides
UNION ALL SELECT count(*) FROM participating_departments
UNION ALL SELECT count(*) FROM staff_lists WHERE delivery_channel IS NOT NULL
  OR delivery_status IS NOT NULL OR revealed_by IS NOT NULL
  OR revealed_at IS NOT NULL OR reveal_acked_at IS NOT NULL;
```
Then:
```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -X -v ON_ERROR_STOP=1 -v run_rollback=1 -v confirm_no_c1_state=YES `
  -h 127.0.0.1 -p 55432 -U b17showcaseowner -d b17_showcase `
  -f "…\c1-LIVE_MIGRATION.sql"
```
Expected: `u43c1.rollback: OK — FIX fingerprint restored, ledger restored, 2 rows` and fingerprint back to `90967166…`. The rollback refuses (a) if the live shape is not the c1 target, (b) if the ledger is not the c1 pin, (c) without the explicit `confirm_no_c1_state` flag, (d) with a single flag only. After rollback the app must run at the pre-c1 code revision.

---

## 5. Detecting a partial / no-op application

| Symptom | Meaning |
|---|---|
| non-zero exit, `u43c1.stop: shape drift — live catalog fingerprint <md5> is neither…` | Nothing was applied (single transaction, rolled back). The measured md5 identifies the state; do **not** hand-patch — restore backup or escalate. |
| non-zero exit, `u43c1.stop: principal is superuser/bypassrls` / `not owner` / `ledger row count` / `B17_U1 ledger checksum` | Refused before any DDL. |
| `u43c1.stop: FIX shape but … is not the FIX pin` | Shape matches but ledger drifted (e.g. a hand edit). Restore backup; do not re-pin by hand. |
| `u43c1.stop: c1 shape but … is not the c1 pin` | Shape reached by a foreign path (hand DDL + hand ledger edit). Restore backup. |
| Re-run prints `mode=target … converging and re-verifying (no data touched)` | The DB was already upgraded; the re-run re-converges the same DDL/policy and re-pins the same ledger values, touching no rows. |
| App refuses `b17.schema_drift` after apply | The DDL did not all land or a foreign object exists — compare the fingerprint md5 with `76a272de…` and stop. |
| App refuses `b17.version_drift` after apply | Ledger rows are not the §3 pins — check the two rows before anything else. |

No-op proof: a successful run always prints either `mode=predecessor` (real upgrade) or `mode=target` (idempotent re-run), and always ends inside the same transaction with the postcondition block (fingerprint, tables, columns, CHECKs, FKs, policies, RLS, no-secret-columns, ledger) before `COMMIT`.

---

## 6. Row-count expectations (zero data loss)

The migration performs **no** INSERT/UPDATE/DELETE on business tables. Expected deltas:

| Table | Before → after |
|---|---|
| every business table (`clients`, `departments`, `users`, `services`, `client_services`, `assignments`, `answers`, `evaluations`, `staff_lists`, `staff_list_rows`, …) | identical counts; new `staff_lists` columns carry NULL (undelivered) by construction |
| `dept_match_overrides`, `participating_departments` | absent → present, 0 rows |
| `app_schema_versions` | 2 → 2 rows, only `checksum`/`structure_checksum` re-pinned; `applied_at` untouched |

Upgrade preserves every row and converges to the same fingerprint as a fresh install of the current files.

---

## 7. STOP conditions (do not proceed / restore backup)

- Any ledger value different from §2 (pre-state) or §3 (post-state).
- Any shape value different from `90967166…` (pre) or `76a272de…` (post).
- Any business-table count different from the Step-1 snapshot.
- Non-owner principal, superuser principal, `row_security<>on`, `current_user<>session_user`.
- App not stopped, or `lock_timeout` fired.
- Fingerprint after apply ≠ `76a272de85164db95670b1d43365c6e0`.
- Any temptation to "fix forward" by editing policies/constraints/ledger by hand.
- Rollback pre-checks non-zero (c1-era state exists) — restore from backup instead.
- Any connection attempt to the live DB from an agent session: agents rehearse on disposable scratch only; only Tera executes this runbook against the shared DB.

## 8. Not covered by this migration (still open)

Deployed-role/ACL equivalence beyond ownership+non-super checks, pool-5 deadlock behaviour under live traffic, visual AR/EN screen render + c2 console in-browser flows (NOT VERIFIED-live — visual pass happens on the shared app after this migration, before program closure), and the separate review findings already tracked. No cleanup, no push, no deployment.

---

## 9. Rehearsal evidence (isolated scratch, never the shared DB)

### 9a. Delta proof — `scripts/u43c1-rehearse.ts` (own throwaway PG18 cluster 127.0.0.1:55433, stopped + deleted)

Fresh CURRENT install (shape NEW) → pre-shape install (delta tails cut at the U4-3C banner) → forward → rerun idempotent → handler-path mirrors → rollback → zero-loss ledger:

- `PRE_SHAPE=90967166a353283de10488a43c393ac8`, `NEW_SHAPE=76a272de85164db95670b1d43365c6e0`, `NEW_CONTENT_SHA256=ff0ec3c3b20315607ba634b0bfb5cbf5b282738426f2114fbab36b55bfe4373e` — HEAD bytes reproduce the committed readiness pins exactly;
- forward carries exactly the 17 delta branches; rerun converges (idempotent);
- W link/unlink in bound-A (duplicate + cross-tenant refused; live-work unlink guarded 409); participation + override upsert (C reads allowlist; double-book refused); W approve provisions hash-only + `must_change` (C approve refused); deliver revealed→acked metadata-only (no secret column exists); N/A lift lands unevaluated (second lift refused);
- rollback restores the pre-shape exactly; zero-row-loss ledger holds (only ephemeral membership/override/delivery metadata dropped; provisioned accounts + N/A pair survive as business truth).

### 9b. Artifact proof — `c1-LIVE_MIGRATION.sql` run verbatim via `psql -f` (own throwaway PG18 cluster, stopped + deleted afterwards)

FIX-era pre-state installed from the exact FIX bytes (`git show HEAD~3:src/db/{schema.sql,b17-content.sql}` — both c1 deltas are pure tail-appends, verified: FIX file is a strict prefix; content-pre sha = FIX pin `9d08ad56…`) + OLD ledger pins, seeded tenant rows:

- apply (substrate owner, exact live invocation): `mode=predecessor`, result `shape=76a272de…`, ledger re-pinned to the §3 NEW pins, exit 0;
- zero loss: all business table counts identical before/after (new tables 0 rows; delivery columns all NULL);
- `MIGRATED_EQUALS_FRESH`: migrated shape == fresh HEAD pin `76a272de…` (§9a NEW_SHAPE);
- rerun: `mode=target`, exit 0, zero row change, shape stable;
- rollback guard: single `-v run_rollback=1` without the confirm flag prints NOT RUN and changes nothing;
- rollback (both flags, clean c1 state per superuser pre-checks): `u43c1.rollback: OK`, fingerprint back to `90967166…`, ledger back to the OLD pins, 2 tables + 5 columns + 2 CHECKs + 17 policies gone;
- re-apply after rollback: `mode=predecessor` again, back to `76a272de…`, zero loss.
