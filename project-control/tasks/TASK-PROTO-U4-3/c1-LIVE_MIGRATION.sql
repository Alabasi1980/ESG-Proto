-- ============================================================================
-- TASK-PROTO-U4-3 c1 — LIVE migration: shared FIX-shape database to the c1 substrate
-- Component: demo substrate b17_showcase (PostgreSQL 18)
-- Owner-approved scope: U4-3c DELTA additive migration ONLY (DDL design APPROVED
-- 2026-11-18; live apply needs separate explicit execution approval + backup) —
--   (a) src/db/schema.sql:1664-1724 verbatim (STORE-e dept_match_overrides +
--       ENABLE/FORCE, STORE-f 5 staff_lists delivery columns + 2 CHECKs, STORE-g
--       participating_departments + ENABLE/FORCE), and
--   (b) src/db/b17-content.sql:1438-1711 verbatim (17 additive RLS branches:
--       RLS-a x2, RLS-b b1-b4, F1 deliver x1, RLS-c x1, RLS-d x1, STORE-e x4,
--       STORE-g x4; existing policies untouched; b17_audit_insert needs NO new
--       branch — the existing OR b17_work_tenant(client_id) work branch already
--       admits the 7 new in-txn action names, DELTA spec API/DB notes + §6.5).
-- NOTHING else: no data edit, no table/column/policy/grant drop or widening,
-- no content replay beyond the hunks above, no email table (G1 reveal-only now,
-- per-recipient email table DEFERRED, never built in this unit).
--
-- WHAT THIS DOES (exactly one transaction):
--   1. Serializes on the sanctioned B17 migration lock (1717001, same as b17.sql
--      and FIX), then proves preconditions (principal, ownership, activation,
--      ledger pins, exact FIX shape, no c1 objects yet).
--   2. Applies the schema batch verbatim (tables first — content policies
--      require them).
--   3. Applies the content deltas verbatim (17 RLS branches, DROP-IF-EXISTS +
--      CREATE so rerun converges).
--   4. Re-pins app_schema_versions through the EXISTING b17_version_update gate
--      (purpose 'migration' GUC — same mechanism in kind as FIX, which needed
--      no temporary policy because the pre-FIX content already shipped the
--      gate; the pre-c1 content likewise ships b17_version_update at
--      b17-content.sql:983-985).
--   5. Asserts the postcondition: live shape == HEAD B17_CONTENT_SHAPE, new
--      objects/policies/RLS/FORCE exact, ledger re-pinned, FK backstops exact.
--      Zero business-row writes (only ADD COLUMN defaults, metadata).
--
-- PRE-STATE THIS UPGRADES FROM (proved by the preconditions below):
--   ledger exactly B17_U1 + B17_U2D with
--     B17_U1  = ace11265d876b6f18229dd62efa1db693cd8df00ecd0ea6012b448694406d8d6 / e1bb70b605f9a59be49cf1c25a396c0a
--     B17_U2D = 9d08ad5636a99fd7c86d45e6a2ae0239e91df7e428c460c58124c4b2b5261188 / 90967166a353283de10488a43c393ac8
--   live catalog fingerprint = 90967166a353283de10488a43c393ac8 (= FIX target);
--   no dept_match_overrides / participating_departments tables, none of the
--   five staff_lists delivery columns, neither delivery CHECK, none of the 17
--   c1 policies. B17_U1 pins are INVARIANT across this migration (b17.sql and
--   the P1 DDL are untouched).
--   Business counts recorded by the operator (runbook §4) before apply.
--
-- NEW (HEAD, re-measured from disk 2026-11-18 — see runbook §3 and rehearsal):
--     B17_U1  = ace11265d876b6f18229dd62efa1db693cd8df00ecd0ea6012b448694406d8d6 / e1bb70b605f9a59be49cf1c25a396c0a
--     B17_U2D = ff0ec3c3b20315607ba634b0bfb5cbf5b282738426f2114fbab36b55bfe4373e / 76a272de85164db95670b1d43365c6e0
--   (b17.sql sha unchanged since PROTECT; content sha is the HEAD file hash.)
--
-- IDEMPOTENCY: every step converges. A second run detects the target
-- fingerprint, re-converges the same DDL/policies and re-pins the same ledger
-- values. Re-running is safe and changes nothing. A DB at any THIRD shape is
-- refused with "u43c1.stop: shape drift <measured md5>" before any DDL.
--
-- ROLLBACK: the same file carries a guarded reverse block. It runs ONLY with
-- BOTH -v run_rollback=1 AND -v confirm_no_c1_state=YES (after the runbook's
-- superuser pre-checks prove zero c1-era state: both new tables empty AND all
-- five delivery columns NULL). Restores the pre-c1 audit posture (untouched —
-- no audit text is changed by this migration), drops the 17 c1 policies, the
-- 2 CHECKs + 5 columns, the 2 tables, and re-pins the ledger to the OLD pins
-- above. Provisioned accounts, answers and evaluations are NEVER dropped by
-- rollback (source of truth preserved); only ephemeral membership/override/
-- delivery metadata is removed.
--
-- EXECUTION (psql only — the \set / \if directives are psql meta-commands):
--   apply    : psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p <port> -U <owner> -d b17_showcase -f c1-LIVE_MIGRATION.sql
--   rollback : psql -X -v ON_ERROR_STOP=1 -v run_rollback=1 -v confirm_no_c1_state=YES -h 127.0.0.1 -p <port> -U <owner> -d b17_showcase -f c1-LIVE_MIGRATION.sql
-- Never paste individual statements into a GUI: the whole block is one
-- transaction and only a full -f run guarantees all-or-nothing.
-- Run as the NOSUPERUSER / NOBYPASSRLS principal that OWNS the public tables
-- (the substrate/app role — the same user the server connects with).
-- ============================================================================
\set ON_ERROR_STOP on

-- Session-local helper: the EXACT catalog fingerprint query from
-- src/db/b17Readiness.ts (STRUCTURE_SQL + CONTENT_AUTHORITY_SQL, verbatim).
-- Lives in pg_temp, so it is invisible to the public-schema fingerprint it
-- computes and disappears when this psql session ends.
CREATE FUNCTION pg_temp.u43c1_shape() RETURNS text LANGUAGE sql STABLE AS $fn$
SELECT md5((jsonb_build_object(
 'tables',(SELECT jsonb_agg(jsonb_build_array(c.relname,c.relrowsecurity,c.relforcerowsecurity) ORDER BY c.relname)
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'),
 'columns',(SELECT jsonb_agg(jsonb_build_array(table_name,column_name,data_type,udt_name,is_nullable,column_default)
   ORDER BY table_name,ordinal_position) FROM information_schema.columns WHERE table_schema='public'),
 'constraints',(SELECT jsonb_agg(jsonb_build_array(c.relname,k.conname,pg_get_constraintdef(k.oid,true),k.convalidated)
   ORDER BY c.relname,k.conname) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
   JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'),
 'indexes',(SELECT jsonb_agg(jsonb_build_array(tablename,indexname,indexdef) ORDER BY tablename,indexname)
   FROM pg_indexes WHERE schemaname='public'),
 'policies',(SELECT jsonb_agg(jsonb_build_array(tablename,policyname,permissive,roles,cmd,qual,with_check)
   ORDER BY tablename,policyname) FROM pg_policies WHERE schemaname='public'),
 'triggers',(SELECT jsonb_agg(jsonb_build_array(c.relname,t.tgname,pg_get_triggerdef(t.oid,true),t.tgenabled)
   ORDER BY c.relname,t.tgname) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
   JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal),
 'functions',(SELECT jsonb_agg(pg_get_functiondef(p.oid) ORDER BY p.proname,pg_get_function_identity_arguments(p.oid))
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
   AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e'))
  ) || coalesce((SELECT jsonb_build_object('content_authority',authority)
    FROM (SELECT jsonb_build_object(
  'definer_functions',(SELECT coalesce(jsonb_agg(q.proname ORDER BY q.proname),'[]'::jsonb)
    FROM pg_proc q JOIN pg_namespace n ON n.oid=q.pronamespace
    WHERE n.nspname='public' AND q.prosecdef AND left(q.proname,4)='b17_'),
  'authority',(SELECT coalesce(jsonb_agg(f ORDER BY f.name),'[]'::jsonb) FROM (
    SELECT p.proname AS name,p.prosecdef AS definer,p.proacl IS NOT NULL AS explicit_acl,
      p.proowner=c.relowner AS owner_is_app,pg_get_userbyid(p.proowner)=current_user AS owner_is_current,
      pg_get_userbyid(p.proowner)=session_user AS owner_is_session,r.rolsuper AS owner_super,
      r.rolbypassrls AS owner_bypass,
      (SELECT jsonb_agg(jsonb_build_object(
        'grantee_is_owner',a.grantee=p.proowner,'grantor_is_owner',a.grantor=p.proowner,
        'privilege',a.privilege_type,'grantable',a.is_grantable)
        ORDER BY a.grantee,a.grantor,a.privilege_type,a.is_grantable)
       FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a) AS execute
    FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner
    JOIN pg_class c ON c.oid=to_regclass('public.app_schema_versions')
    WHERE p.prosecdef AND p.pronamespace='public'::regnamespace
      AND p.proname = ANY(ARRAY['b17_catalog_child_count','b17_content_fact'])
  ) f)) AS authority
  WHERE to_regprocedure('public.b17_content_fact(text,uuid,uuid,uuid)') IS NOT NULL) auth),'{}'::jsonb))::text)
$fn$;

\if :{?run_rollback}
\if :{?confirm_no_c1_state}
\echo '*** MODE: ROLLBACK (reverse DDL + ledger restore) ***'

-- ============================================================================
-- ROLLBACK BLOCK — guarded, separate transaction.
-- Only runs with BOTH -v run_rollback=1 AND -v confirm_no_c1_state=YES.
-- ============================================================================
BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '300s';
SET LOCAL search_path = public;
SELECT pg_advisory_xact_lock(1717001);

DO $$
DECLARE
  v_shape text := (SELECT pg_temp.u43c1_shape());
BEGIN
  IF current_user <> session_user THEN
    RAISE EXCEPTION 'u43c1.stop: current_user <> session_user (run as the substrate owner, no SET ROLE)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'u43c1.stop: principal is superuser/bypassrls; rollback must run as the substrate owner';
  END IF;
  IF v_shape <> '76a272de85164db95670b1d43365c6e0' THEN
    RAISE EXCEPTION 'u43c1.stop: rollback refused — live shape % is not the c1 target', v_shape;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app_schema_versions WHERE version='B17_U2D'
                 AND checksum='ff0ec3c3b20315607ba634b0bfb5cbf5b282738426f2114fbab36b55bfe4373e' AND structure_checksum='76a272de85164db95670b1d43365c6e0') THEN
    RAISE EXCEPTION 'u43c1.stop: rollback refused — B17_U2D ledger row is not the c1 pin';
  END IF;
  -- c1-era ephemeral state cannot be represented in the old substrate.
  -- WHY no counts here: this transaction runs as the table owner under FORCE
  -- RLS, so a count would silently read 0 and prove nothing (the exact
  -- silent-pass class this project rejects). The guarded invocation REQUIRES
  -- -v confirm_no_c1_state=YES after the operator has run, from a superuser
  -- session, the mandatory pre-checks in the runbook (§Rollback), each of
  -- which MUST return 0 / all-NULL:
  --   SELECT count(*) FROM dept_match_overrides;
  --   SELECT count(*) FROM participating_departments;
  --   SELECT count(*) FROM staff_lists WHERE delivery_channel IS NOT NULL
  --     OR delivery_status IS NOT NULL OR revealed_by IS NOT NULL
  --     OR revealed_at IS NOT NULL OR reveal_acked_at IS NOT NULL;
  -- Provisioned accounts (users), approvals (staff_lists.status), answers and
  -- evaluations are deliberately NOT gated here: rollback never drops them.
END $$;

-- 1. Drop the 17 c1 policies (new tables carry theirs away, but explicit first).
DROP POLICY IF EXISTS b17_consultant_links_insert ON client_services;
DROP POLICY IF EXISTS b17_consultant_links_delete ON client_services;
DROP POLICY IF EXISTS b17_work_staff_read ON staff_lists;
DROP POLICY IF EXISTS b17_consultant_staff_rows_read ON staff_list_rows;
DROP POLICY IF EXISTS b17_consultant_staff_approve_update ON staff_lists;
DROP POLICY IF EXISTS b17_consultant_users_provision_insert ON users;
DROP POLICY IF EXISTS b17_consultant_staff_deliver_update ON staff_lists;
DROP POLICY IF EXISTS b17_consultant_staff_complete_password ON users;
DROP POLICY IF EXISTS b17_consultant_evaluations_na_lift_update ON evaluations;
DROP POLICY IF EXISTS b17_match_override_read ON dept_match_overrides;
DROP POLICY IF EXISTS b17_match_override_write ON dept_match_overrides;
DROP POLICY IF EXISTS b17_match_override_update ON dept_match_overrides;
DROP POLICY IF EXISTS b17_match_override_delete ON dept_match_overrides;
DROP POLICY IF EXISTS b17_participating_read ON participating_departments;
DROP POLICY IF EXISTS b17_participating_write ON participating_departments;
DROP POLICY IF EXISTS b17_participating_update ON participating_departments;
DROP POLICY IF EXISTS b17_participating_delete ON participating_departments;

-- 2. Drop the delivery CHECKs + columns (constraints first, dependency order).
ALTER TABLE staff_lists DROP CONSTRAINT IF EXISTS staff_lists_delivery_valid;
ALTER TABLE staff_lists DROP CONSTRAINT IF EXISTS staff_lists_delivery_status_valid;
ALTER TABLE staff_lists DROP COLUMN IF EXISTS delivery_channel;
ALTER TABLE staff_lists DROP COLUMN IF EXISTS delivery_status;
ALTER TABLE staff_lists DROP COLUMN IF EXISTS revealed_by;
ALTER TABLE staff_lists DROP COLUMN IF EXISTS revealed_at;
ALTER TABLE staff_lists DROP COLUMN IF EXISTS reveal_acked_at;

-- 3. Drop the two narrow tables (policies travel with them).
DROP TABLE IF EXISTS dept_match_overrides;
DROP TABLE IF EXISTS participating_departments;

-- 4. Ledger restore to the pre-c1 (FIX) pins through the existing
--    b17_version_update gate (rollback touches no gate). B17_U1 is invariant
--    across this migration; it is still re-pinned to the same value as a
--    closed check that the ledger was not touched by a foreign path.
SELECT set_config('app.current_purpose', 'migration', true);
DO $$
DECLARE n int;
BEGIN
  UPDATE app_schema_versions SET structure_checksum = 'e1bb70b605f9a59be49cf1c25a396c0a'
   WHERE version = 'B17_U1';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'u43c1.stop: B17_U1 rollback pin affected % rows (expected 1)', n; END IF;
  UPDATE app_schema_versions
     SET checksum = '9d08ad5636a99fd7c86d45e6a2ae0239e91df7e428c460c58124c4b2b5261188',
         structure_checksum = '90967166a353283de10488a43c393ac8'
   WHERE version = 'B17_U2D';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'u43c1.stop: B17_U2D rollback pin affected % rows (expected 1)', n; END IF;
END $$;
SELECT set_config('app.current_purpose', '', true);

DO $$
DECLARE v_shape text := (SELECT pg_temp.u43c1_shape());
BEGIN
  IF v_shape <> '90967166a353283de10488a43c393ac8' THEN
    RAISE EXCEPTION 'u43c1.stop: rollback did not restore the FIX fingerprint (%)', v_shape;
  END IF;
  IF (SELECT count(*)::int FROM app_schema_versions) <> 2 THEN
    RAISE EXCEPTION 'u43c1.stop: ledger row count changed during rollback';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='public' AND c.relname IN ('dept_match_overrides','participating_departments')) THEN
    RAISE EXCEPTION 'u43c1.stop: new tables still present after rollback';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
             AND table_name='staff_lists' AND column_name IN ('delivery_channel','delivery_status','revealed_by','revealed_at','reveal_acked_at')) THEN
    RAISE EXCEPTION 'u43c1.stop: delivery columns still present after rollback';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND policyname IN
    ('b17_consultant_links_insert','b17_consultant_links_delete','b17_work_staff_read',
     'b17_consultant_staff_rows_read','b17_consultant_staff_approve_update',
     'b17_consultant_users_provision_insert','b17_consultant_staff_deliver_update',
     'b17_consultant_staff_complete_password','b17_consultant_evaluations_na_lift_update',
     'b17_match_override_read','b17_match_override_write','b17_match_override_update','b17_match_override_delete',
     'b17_participating_read','b17_participating_write','b17_participating_update','b17_participating_delete')) THEN
    RAISE EXCEPTION 'u43c1.stop: c1 policies still present after rollback';
  END IF;
  RAISE NOTICE 'u43c1.rollback: OK — FIX fingerprint restored, ledger restored, 2 rows';
END $$;

COMMIT;

\else
\echo '*** ROLLBACK NOT RUN: first run the runbook superuser pre-checks, then pass -v run_rollback=1 -v confirm_no_c1_state=YES ***'
\endif

\else
\echo '*** MODE: APPLY (upgrade FIX-shape to c1) ***'

-- ============================================================================
-- APPLY BLOCK — the one-transaction upgrade
-- ============================================================================
BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '300s';
SET LOCAL idle_in_transaction_session_timeout = '600s';
SET LOCAL search_path = public;

-- 0. Serialize with every sanctioned offline applier (b17.sql / applyB17Offline).
SELECT pg_advisory_xact_lock(1717001);

-- 1. Preconditions: principal, ownership, activation, ledger pins, exact shape.
CREATE TEMP TABLE IF NOT EXISTS u43c1_ctl (mode text, pre_shape text) ON COMMIT PRESERVE ROWS;

DO $$
DECLARE
  v_live text;
  v_rows int;
  v_bad text;
BEGIN
  -- 1a. principal
  IF current_user <> session_user THEN
    RAISE EXCEPTION 'u43c1.stop: current_user <> session_user (run as the substrate owner, no SET ROLE)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'u43c1.stop: principal is superuser/bypassrls; run as the NOSUPERUSER NOBYPASSRLS substrate owner';
  END IF;
  IF current_setting('row_security') <> 'on' THEN
    RAISE EXCEPTION 'u43c1.stop: row_security must be on';
  END IF;

  -- 1b. activation + ownership (DDL would fail anyway; fail with a clear STOP)
  IF to_regclass('public.app_schema_versions') IS NULL
     OR to_regclass('public.staff_lists') IS NULL
     OR to_regclass('public.client_services') IS NULL
     OR to_regclass('public.audit_log') IS NULL
  THEN
    RAISE EXCEPTION 'u43c1.stop: substrate tables missing (FIX substrate was never applied here)';
  END IF;
  SELECT string_agg(c.relname, ',' ORDER BY c.relname) INTO v_bad
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND c.relname IN ('items','answers','audit_log','app_schema_versions','staff_lists')
     AND pg_get_userbyid(c.relowner) <> current_user;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'u43c1.stop: current_user does not own % — run as the substrate owner (another role owning these tables is drift)', v_bad;
  END IF;

  -- 1c. ledger must be exactly the two activation rows. B17_U1.checksum is the
  -- b17.sql sha256, which this migration does not touch (re-measured from disk)
  -- — so it is INVARIANT in both modes and is checked here. The structure pins
  -- and the whole B17_U2D row are mode-dependent and are checked inside the
  -- shape branch below (predecessor demands the exact FIX pair, target demands
  -- the exact NEW pair) — this ordering is what makes a re-run converge
  -- instead of refusing on its own re-pinned ledger.
  SELECT count(*)::int INTO v_rows FROM app_schema_versions;
  IF v_rows <> 2 THEN
    RAISE EXCEPTION 'u43c1.stop: ledger row count % (expected exactly B17_U1 + B17_U2D)', v_rows;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app_schema_versions WHERE version = 'B17_U1'
                 AND checksum = 'ace11265d876b6f18229dd62efa1db693cd8df00ecd0ea6012b448694406d8d6') THEN
    RAISE EXCEPTION 'u43c1.stop: B17_U1 ledger checksum is not the b17.sql sha256 (wrong DB or drifted activation)';
  END IF;

  -- 1d. the re-pin gate must exist (it ships in the pre-c1 content substrate).
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                 AND tablename='app_schema_versions' AND policyname='b17_version_update') THEN
    RAISE EXCEPTION 'u43c1.stop: b17_version_update gate missing (pre-c1 content substrate incomplete)';
  END IF;

  -- 1e. exact live shape: FIX predecessor (upgrade) or c1 target (idempotent re-run).
  v_live := (SELECT pg_temp.u43c1_shape());
  IF v_live = '90967166a353283de10488a43c393ac8' THEN
    -- predecessor mode: ledger pins must be exactly the FIX pair.
    IF NOT EXISTS (SELECT 1 FROM app_schema_versions WHERE version = 'B17_U1'
                   AND structure_checksum = 'e1bb70b605f9a59be49cf1c25a396c0a') THEN
      RAISE EXCEPTION 'u43c1.stop: FIX shape but B17_U1 is not the FIX pin (drift — do not repair blindly)';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM app_schema_versions WHERE version = 'B17_U2D'
                   AND checksum = '9d08ad5636a99fd7c86d45e6a2ae0239e91df7e428c460c58124c4b2b5261188'
                   AND structure_checksum = '90967166a353283de10488a43c393ac8') THEN
      RAISE EXCEPTION 'u43c1.stop: FIX shape but B17_U2D is not the FIX pin (checksum and structure must both match; do not repair blindly)';
    END IF;
    -- no c1 object may exist yet: a half-applied state always moves the shape.
    IF to_regclass('public.dept_match_overrides') IS NOT NULL
       OR to_regclass('public.participating_departments') IS NOT NULL THEN
      RAISE EXCEPTION 'u43c1.stop: FIX shape but c1 tables already present (partial manual DDL — restore backup, do not patch forward)';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
               AND table_name='staff_lists' AND column_name IN ('delivery_channel','delivery_status','revealed_by','revealed_at','reveal_acked_at')) THEN
      RAISE EXCEPTION 'u43c1.stop: FIX shape but c1 delivery columns already present (partial manual DDL — restore backup)';
    END IF;
    INSERT INTO u43c1_ctl VALUES ('predecessor', v_live);
    RAISE NOTICE 'u43c1.migrate: mode=predecessor shape=% — upgrading', v_live;
  ELSIF v_live = '76a272de85164db95670b1d43365c6e0' THEN
    -- target mode: ledger must already be the NEW pair, else the DB reached
    -- the c1 shape by a foreign path (hand DDL + hand ledger edit).
    IF NOT EXISTS (SELECT 1 FROM app_schema_versions WHERE version = 'B17_U1'
                   AND checksum = 'ace11265d876b6f18229dd62efa1db693cd8df00ecd0ea6012b448694406d8d6'
                   AND structure_checksum = 'e1bb70b605f9a59be49cf1c25a396c0a') THEN
      RAISE EXCEPTION 'u43c1.stop: c1 shape but B17_U1 is not the c1 pin (foreign path — restore backup)';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM app_schema_versions WHERE version = 'B17_U2D'
                   AND checksum = 'ff0ec3c3b20315607ba634b0bfb5cbf5b282738426f2114fbab36b55bfe4373e'
                   AND structure_checksum = '76a272de85164db95670b1d43365c6e0') THEN
      RAISE EXCEPTION 'u43c1.stop: c1 shape but B17_U2D is not the c1 pin (foreign path — restore backup)';
    END IF;
    INSERT INTO u43c1_ctl VALUES ('target', v_live);
    RAISE NOTICE 'u43c1.migrate: mode=target shape=% — already upgraded; converging and re-verifying (no data touched)', v_live;
  ELSE
    RAISE EXCEPTION 'u43c1.stop: shape drift — live catalog fingerprint % is neither the FIX nor the c1 target (partial/manual application or foreign change)', v_live;
  END IF;
END $$;

--------------------------------------------------------------------------------
-- TASK-PROTO-U4-3C-DELTA (unit c substrate, APPROVED_FOR_GATE 2026-11-18) —
-- additive ONLY: 2 narrow tables + 5 staff_lists delivery columns + 2 CHECKs.
-- Verbatim from prototype-app/project-control/task-engineering-reviews/
-- TASK-PROTO-U4-3C-DELTA_TECHNICAL_SPECIFICATION.md §STORE:
--   STORE-e table DO-block: spec ll.400-414 (D-5 derivation superseded, DD-5);
--   RLS ENABLE/FORCE for the new tables: spec ll.415-416 / ll.555-556 (H13
--   precedent — policies themselves live in b17-content.sql, never here);
--   STORE-f columns + CHECKs: spec ll.485-491 (reveal-only now, DG-D3);
--   STORE-g table DO-block: spec ll.544-554 (DD-7, allowlist + assignment gate).
-- No existing column, row, policy or grant is changed; no backfill, no rewrite.
-- Rollback: DROP TABLE IF EXISTS ×2 + DROP COLUMN ×5 + DROP CONSTRAINT ×2.
--------------------------------------------------------------------------------

-- STORE-e. dept_match_overrides: per-mapping override (G4 auto-match + manual
-- override table). FK RESTRICT on client_department_id is the DB backstop for
-- dept-removal-with-override; UNIQUE(client,service,code) blocks double-booking.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='dept_match_overrides') THEN
    CREATE TABLE dept_match_overrides (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      service_dept_code TEXT NOT NULL,
      client_department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
      UNIQUE(client_id, service_id, service_dept_code)
    );
  END IF;
END $$;
ALTER TABLE dept_match_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE dept_match_overrides FORCE ROW LEVEL SECURITY;

-- STORE-f. staff_lists delivery metadata (reveal-only now; per-recipient email
-- table DEFERRED, never built in this unit). NULL = undelivered; no backfill.
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='staff_lists' AND column_name='delivery_channel') THEN ALTER TABLE staff_lists ADD COLUMN delivery_channel TEXT NULL; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='staff_lists' AND column_name='delivery_status') THEN ALTER TABLE staff_lists ADD COLUMN delivery_status TEXT NULL; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='staff_lists' AND column_name='revealed_by') THEN ALTER TABLE staff_lists ADD COLUMN revealed_by UUID REFERENCES users(id) ON DELETE SET NULL; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='staff_lists' AND column_name='revealed_at') THEN ALTER TABLE staff_lists ADD COLUMN revealed_at TIMESTAMP WITH TIME ZONE NULL; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='staff_lists' AND column_name='reveal_acked_at') THEN ALTER TABLE staff_lists ADD COLUMN reveal_acked_at TIMESTAMP WITH TIME ZONE NULL; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='staff_lists_delivery_valid') THEN ALTER TABLE staff_lists ADD CONSTRAINT staff_lists_delivery_valid CHECK (delivery_channel IS NULL OR delivery_channel IN ('reveal','email')) ; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='staff_lists_delivery_status_valid') THEN ALTER TABLE staff_lists ADD CONSTRAINT staff_lists_delivery_status_valid CHECK (delivery_status IS NULL OR delivery_status IN ('undelivered','revealed','acked','emailed','failed')); END IF; END $$;

-- STORE-g. participating_departments: the membership allowlist for
-- PUT /workspace/participating-departments (DD-7). D-5 derivation becomes the
-- EFFECTIVE rule (explicit set ∩ assignment gate), not the storage. FK RESTRICT
-- on department_id is the DB backstop for dept-removal-with-assignments.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='participating_departments') THEN
    CREATE TABLE participating_departments (
      client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
      added_by UUID REFERENCES users(id) ON DELETE SET NULL,
      added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
      PRIMARY KEY (client_id, department_id)
    );
  END IF;
END $$;
ALTER TABLE participating_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE participating_departments FORCE ROW LEVEL SECURITY;

-- ===========================================================================
-- TASK-PROTO-U4-3C-DELTA (unit c substrate, APPROVED_FOR_GATE 2026-11-18) —
-- additive RLS branches ONLY. Verbatim from prototype-app/project-control/
-- task-engineering-reviews/TASK-PROTO-U4-3C-DELTA_TECHNICAL_SPECIFICATION.md
-- §RLS + §STORE. Every branch carries DROP POLICY IF EXISTS (idempotent
-- re-application, same contract as FIX P1/P4). Existing policies untouched;
-- no FOR ALL widening; FORCE RLS retained. Audit: b17_audit_insert needs NO
-- new branch — the existing OR b17_work_tenant(client_id) work branch already
-- admits every W/C work audit row below (spec §API/DB notes + §6.5).
-- Byte trace per hunk: RLS-a spec ll.191-208 · RLS-b spec ll.228-279 ·
-- STORE-f deliver branch + F1 comment spec ll.492-518 · RLS-c spec ll.302-323 ·
-- RLS-d + F2 pin comment spec ll.343-369 · STORE-e policies spec ll.417-459 ·
-- STORE-g policies spec ll.557-599.
-- ===========================================================================

-- RLS-a — W link/unlink client_services (gap a). Mirrors the platform branch
-- shape translated to the work context; strictly narrower than the existing
-- visibility UPDATE (which lacks the role/actor pins — NOT widened here).
-- Flags/mask unwritable via these branches (handler allowlist + visibility
-- route own the mask column).
DROP POLICY IF EXISTS b17_consultant_links_insert ON client_services;
CREATE POLICY b17_consultant_links_insert ON client_services FOR INSERT WITH CHECK (
  b17_setting('current_purpose') = 'work'
  AND b17_setting('current_mode') = 'consultant'
  AND b17_setting('current_user_role') = 'ge_admin'
  AND b17_setting('current_actor_id') IS NOT NULL
  AND client_id::text = b17_setting('current_tenant_id')
  AND service_id IS NOT NULL
);

DROP POLICY IF EXISTS b17_consultant_links_delete ON client_services;
CREATE POLICY b17_consultant_links_delete ON client_services FOR DELETE USING (
  b17_setting('current_purpose') = 'work'
  AND b17_setting('current_mode') = 'consultant'
  AND b17_setting('current_user_role') = 'ge_admin'
  AND b17_setting('current_actor_id') IS NOT NULL
  AND client_id::text = b17_setting('current_tenant_id')
);

-- RLS-b — W approve/provision (gap b). (b3) USING pins the OLD row submitted
-- (no draft→approved skip; WF-01 preserved); WITH CHECK pins NEW approved +
-- decided_by=actor. (b4) pins forced rotation + role domain (never ge_admin,
-- never rotation-free). P keeps its platform branches untouched.
-- (b1) W/C own-tenant list reads (work; P keeps its platform branches untouched)
DROP POLICY IF EXISTS b17_work_staff_read ON staff_lists;
CREATE POLICY b17_work_staff_read ON staff_lists FOR SELECT USING (
  b17_work_tenant(client_id)
  AND b17_setting('current_purpose') = 'work'
  AND b17_setting('current_mode') IN ('consultant', 'client')
  AND b17_setting('current_actor_id') IS NOT NULL
);

-- (b2) W rows read for approve preflight (read-only; no row mutation widened)
DROP POLICY IF EXISTS b17_consultant_staff_rows_read ON staff_list_rows;
CREATE POLICY b17_consultant_staff_rows_read ON staff_list_rows FOR SELECT USING (
  b17_setting('current_purpose') = 'work'
  AND b17_setting('current_mode') = 'consultant'
  AND b17_setting('current_user_role') = 'ge_admin'
  AND b17_setting('current_actor_id') IS NOT NULL
  AND EXISTS (SELECT 1 FROM staff_lists s WHERE s.id = staff_list_rows.list_id
    AND b17_work_tenant(s.client_id))
);

-- (b3) W approve transition ONLY: submitted -> approved, decider = actor
DROP POLICY IF EXISTS b17_consultant_staff_approve_update ON staff_lists;
CREATE POLICY b17_consultant_staff_approve_update ON staff_lists FOR UPDATE
  USING (
    b17_work_tenant(client_id)
    AND b17_setting('current_purpose') = 'work'
    AND b17_setting('current_mode') = 'consultant'
    AND b17_setting('current_user_role') = 'ge_admin'
    AND b17_setting('current_actor_id') IS NOT NULL
    AND status = 'submitted'
  )
  WITH CHECK (
    b17_work_tenant(client_id)
    AND b17_setting('current_purpose') = 'work'
    AND b17_setting('current_mode') = 'consultant'
    AND b17_setting('current_user_role') = 'ge_admin'
    AND decided_by::text = b17_setting('current_actor_id')
    AND status = 'approved'
  );

-- (b4) W provision INSERT (WF-01 pinned in SQL: forced rotation + non-platform roles only)
DROP POLICY IF EXISTS b17_consultant_users_provision_insert ON users;
CREATE POLICY b17_consultant_users_provision_insert ON users FOR INSERT WITH CHECK (
  b17_setting('current_purpose') = 'work'
  AND b17_setting('current_mode') = 'consultant'
  AND b17_setting('current_user_role') = 'ge_admin'
  AND b17_setting('current_actor_id') IS NOT NULL
  AND client_id::text = b17_setting('current_tenant_id')
  AND role IN ('employee', 'client_admin')
  AND must_change_password = true
  AND is_active = true
);

-- Shield F1 [Medium]: NARROW additive delivery-UPDATE branch (new-code path only).
-- b3 (`b17_consultant_staff_approve_update`) is NOT widened — it still admits ONLY
-- submitted -> approved. Delivery runs AFTER approval on an already-approved row, so it
-- needs its own branch: USING approved + W bound-A -> WITH CHECK approved + delivery
-- domain pins. RLS cannot column-scope: the HANDLER is the single-column guard
-- (writes ONLY delivery_channel/delivery_status/revealed_by/revealed_at/reveal_acked_at,
-- never status/client/decided_by — same discipline as serviceVisibility.ts).
DROP POLICY IF EXISTS b17_consultant_staff_deliver_update ON staff_lists;
CREATE POLICY b17_consultant_staff_deliver_update ON staff_lists FOR UPDATE
  USING (
    b17_work_tenant(client_id)
    AND b17_setting('current_purpose') = 'work'
    AND b17_setting('current_mode') = 'consultant'
    AND b17_setting('current_user_role') = 'ge_admin'
    AND b17_setting('current_actor_id') IS NOT NULL
    AND status = 'approved'
  )
  WITH CHECK (
    b17_work_tenant(client_id)
    AND b17_setting('current_purpose') = 'work'
    AND b17_setting('current_mode') = 'consultant'
    AND b17_setting('current_user_role') = 'ge_admin'
    AND b17_setting('current_actor_id') IS NOT NULL
    AND status = 'approved'
    AND (delivery_channel IS NULL OR delivery_channel IN ('reveal', 'email'))
    AND (delivery_status IS NULL OR delivery_status IN ('undelivered', 'revealed', 'acked', 'emailed', 'failed'))
  );
-- W/C reads reuse (b1); W approve reuses b3. This branch is delivery-only.

-- RLS-c — W-assisted password completion (gap c). Row scope admits the hash
-- rotation; the HANDLER is the single-column guard (writes ONLY password_hash +
-- updated_at, never email/role/client/department/is_active/must_change_password).
DROP POLICY IF EXISTS b17_consultant_staff_complete_password ON users;
CREATE POLICY b17_consultant_staff_complete_password ON users FOR UPDATE
  USING (
    b17_setting('current_purpose') = 'work'
    AND b17_setting('current_mode') = 'consultant'
    AND b17_setting('current_user_role') = 'ge_admin'
    AND b17_setting('current_actor_id') IS NOT NULL
    AND client_id::text = b17_setting('current_tenant_id')
    AND id::text <> b17_setting('current_actor_id')
    AND must_change_password = true
    AND is_active = true
    AND role IN ('employee', 'client_admin')
  )
  WITH CHECK (
    b17_setting('current_purpose') = 'work'
    AND b17_setting('current_mode') = 'consultant'
    AND b17_setting('current_user_role') = 'ge_admin'
    AND client_id::text = b17_setting('current_tenant_id')
    AND must_change_password = true
    AND is_active = true
    AND role IN ('employee', 'client_admin')
  );

-- RLS-d — N/A lift (gap d). USING pins an N/A row on a linked item in A;
-- WITH CHECK forces the landing state to UNEVALUATED (never direct-to-scored).
-- Disclosure scope stays derived (no scope column): disclosure-N/A = ALL items
-- under the disclosure N/A'd; lift disclosure = lift each.
DROP POLICY IF EXISTS b17_consultant_evaluations_na_lift_update ON evaluations;
CREATE POLICY b17_consultant_evaluations_na_lift_update ON evaluations FOR UPDATE
  USING (
    b17_work_tenant(client_id)
    AND b17_setting('current_purpose') = 'work'
    AND b17_setting('current_mode') = 'consultant'
    AND b17_setting('current_user_role') = 'ge_admin'
    AND b17_setting('current_actor_id') IS NOT NULL
    AND b17_item_visible(client_id, item_id)
    AND not_applicable = true
  )
  WITH CHECK (
    b17_work_tenant(client_id)
    AND b17_setting('current_purpose') = 'work'
    AND b17_setting('current_mode') = 'consultant'
    AND b17_setting('current_user_role') = 'ge_admin'
    AND b17_setting('current_actor_id') IS NOT NULL
    AND b17_item_visible(client_id, item_id)
    AND not_applicable = false
    AND not_evaluated = true
    AND score IS NULL
    AND na_reason IS NULL
  );
-- Shield F2 [Low]: WITH CHECK re-pins purpose/mode/role/actor/item_visible
-- (defense-in-depth, mirrors b3). No behavior change beyond the pin; handler still
-- owns reason-required (400 `na.reason_required`), freeze 409, and version lockstep.

-- STORE-e policies — dept_match_overrides row scope (DD-5). W writes bound-A
-- with the target dept proven inside A; W/C read own-tenant rows.
DROP POLICY IF EXISTS b17_match_override_read ON dept_match_overrides;
CREATE POLICY b17_match_override_read ON dept_match_overrides FOR SELECT USING (
  b17_work_tenant(client_id)
  AND b17_setting('current_purpose') = 'work'
  AND b17_setting('current_mode') IN ('consultant', 'client')
  AND b17_setting('current_actor_id') IS NOT NULL);
DROP POLICY IF EXISTS b17_match_override_write ON dept_match_overrides;
CREATE POLICY b17_match_override_write ON dept_match_overrides FOR INSERT WITH CHECK (
  b17_setting('current_purpose') = 'work'
  AND b17_setting('current_mode') = 'consultant'
  AND b17_setting('current_user_role') = 'ge_admin'
  AND b17_setting('current_actor_id') IS NOT NULL
  AND client_id::text = b17_setting('current_tenant_id')
  AND EXISTS (SELECT 1 FROM departments d WHERE d.id = client_department_id AND d.client_id::text = b17_setting('current_tenant_id')));
DROP POLICY IF EXISTS b17_match_override_update ON dept_match_overrides;
CREATE POLICY b17_match_override_update ON dept_match_overrides FOR UPDATE
  USING (
    b17_setting('current_purpose') = 'work'
    AND b17_setting('current_mode') = 'consultant'
    AND b17_setting('current_user_role') = 'ge_admin'
    AND b17_setting('current_actor_id') IS NOT NULL
    AND client_id::text = b17_setting('current_tenant_id')
    AND b17_work_tenant(client_id)
  )
  WITH CHECK (
    b17_setting('current_purpose') = 'work'
    AND b17_setting('current_mode') = 'consultant'
    AND b17_setting('current_user_role') = 'ge_admin'
    AND b17_setting('current_actor_id') IS NOT NULL
    AND client_id::text = b17_setting('current_tenant_id')
    AND b17_work_tenant(client_id)
    AND EXISTS (SELECT 1 FROM departments d WHERE d.id = client_department_id AND d.client_id::text = b17_setting('current_tenant_id')));
DROP POLICY IF EXISTS b17_match_override_delete ON dept_match_overrides;
-- Tenant DELETE only when no dependent work: handler refuses 409 when assignments
-- reference the mapped dept; FK RESTRICT on client_department_id is the DB backstop.
CREATE POLICY b17_match_override_delete ON dept_match_overrides FOR DELETE USING (
  b17_setting('current_purpose') = 'work'
  AND b17_setting('current_mode') = 'consultant'
  AND b17_setting('current_user_role') = 'ge_admin'
  AND b17_setting('current_actor_id') IS NOT NULL
  AND client_id::text = b17_setting('current_tenant_id')
  AND b17_work_tenant(client_id)
);

-- STORE-g policies — participating_departments row scope (DD-7). C reads the
-- set; only W writes it. Handler refuses dept-removal-with-assignments 409
-- before DELETE; FK RESTRICT on department_id is the DB backstop.
DROP POLICY IF EXISTS b17_participating_read ON participating_departments;
CREATE POLICY b17_participating_read ON participating_departments FOR SELECT USING (
  b17_work_tenant(client_id)
  AND b17_setting('current_purpose') = 'work'
  AND b17_setting('current_mode') IN ('consultant', 'client')
  AND b17_setting('current_actor_id') IS NOT NULL);
DROP POLICY IF EXISTS b17_participating_write ON participating_departments;
CREATE POLICY b17_participating_write ON participating_departments FOR INSERT WITH CHECK (
  b17_setting('current_purpose') = 'work'
  AND b17_setting('current_mode') = 'consultant'
  AND b17_setting('current_user_role') = 'ge_admin'
  AND b17_setting('current_actor_id') IS NOT NULL
  AND client_id::text = b17_setting('current_tenant_id')
  AND EXISTS (SELECT 1 FROM departments d WHERE d.id = department_id AND d.client_id::text = b17_setting('current_tenant_id')));
DROP POLICY IF EXISTS b17_participating_update ON participating_departments;
CREATE POLICY b17_participating_update ON participating_departments FOR UPDATE
  USING (
    b17_setting('current_purpose') = 'work'
    AND b17_setting('current_mode') = 'consultant'
    AND b17_setting('current_user_role') = 'ge_admin'
    AND b17_setting('current_actor_id') IS NOT NULL
    AND client_id::text = b17_setting('current_tenant_id')
    AND b17_work_tenant(client_id)
  )
  WITH CHECK (
    b17_setting('current_purpose') = 'work'
    AND b17_setting('current_mode') = 'consultant'
    AND b17_setting('current_user_role') = 'ge_admin'
    AND b17_setting('current_actor_id') IS NOT NULL
    AND client_id::text = b17_setting('current_tenant_id')
    AND b17_work_tenant(client_id)
    AND EXISTS (SELECT 1 FROM departments d WHERE d.id = department_id AND d.client_id::text = b17_setting('current_tenant_id')));
DROP POLICY IF EXISTS b17_participating_delete ON participating_departments;
-- Tenant DELETE only when no dependent work: handler refuses 409 when assignments
-- exist for the dept; FK RESTRICT on department_id is the DB backstop.
CREATE POLICY b17_participating_delete ON participating_departments FOR DELETE USING (
  b17_setting('current_purpose') = 'work'
  AND b17_setting('current_mode') = 'consultant'
  AND b17_setting('current_user_role') = 'ge_admin'
  AND b17_setting('current_actor_id') IS NOT NULL
  AND client_id::text = b17_setting('current_tenant_id')
  AND b17_work_tenant(client_id)
);

-- 4. Ledger re-pin to the HEAD constants re-measured in src/db/b17Readiness.ts.
-- app_schema_versions has only INSERT (b17_version_write) plus the UPDATE gate
-- b17_version_update (purpose 'migration'), so no temporary policy is needed —
-- and none is created. The GET DIAGNOSTICS checks prove the gate admitted us;
-- under a wrong purpose RLS would admit 0 rows and abort here, never silently.
SELECT set_config('app.current_purpose', 'migration', true);
DO $$
DECLARE n int;
BEGIN
  UPDATE app_schema_versions SET structure_checksum = 'e1bb70b605f9a59be49cf1c25a396c0a'
   WHERE version = 'B17_U1';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'u43c1.stop: B17_U1 re-pin affected % rows (expected exactly 1)', n; END IF;
  UPDATE app_schema_versions
     SET checksum = 'ff0ec3c3b20315607ba634b0bfb5cbf5b282738426f2114fbab36b55bfe4373e',
         structure_checksum = '76a272de85164db95670b1d43365c6e0'
   WHERE version = 'B17_U2D';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'u43c1.stop: B17_U2D re-pin affected % rows (expected exactly 1)', n; END IF;
END $$;
SELECT set_config('app.current_purpose', '', true);

-- 5. Postconditions: exact catalog fingerprint, structural pins, ledger pins.
DO $$
DECLARE
  v_shape text := (SELECT pg_temp.u43c1_shape());
  v_bad text;
  v_mode text := (SELECT mode FROM u43c1_ctl);
BEGIN
  IF v_shape <> '76a272de85164db95670b1d43365c6e0' THEN
    RAISE EXCEPTION 'u43c1.stop: result fingerprint % does not equal B17_CONTENT_SHAPE', v_shape;
  END IF;

  -- NOTE ON ROW-LEVEL DATA: this runs as the table owner under FORCE RLS, so
  -- business rows are invisible here (policies admit only a 'work' purpose).
  -- The added staff_lists columns are NULL-defaulted, so every pre-existing row
  -- carries NULL by construction; the operator verifies row values/counts from
  -- the superuser session (runbook step 4). Do NOT add RLS-blind "count"
  -- checks here: they would silently read 0 and prove nothing. Zero-loss is
  -- proved by the operator's before/after counts plus the rehearsal evidence
  -- (runbook §9).

  -- new tables: RESTRICT backstops, uniqueness, tenant CASCADE.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='dept_match_overrides_client_department_id_fkey'
                 AND conrelid='public.dept_match_overrides'::regclass
                 AND confdeltype='r' AND convalidated) THEN
    RAISE EXCEPTION 'u43c1.stop: dept_match_overrides RESTRICT FK missing (dept-removal backstop)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.participating_departments'::regclass
                 AND contype='f' AND confdeltype='r' AND convalidated) THEN
    RAISE EXCEPTION 'u43c1.stop: participating_departments RESTRICT FK missing (dept-removal backstop)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.dept_match_overrides'::regclass
                 AND contype='u' AND convalidated) THEN
    RAISE EXCEPTION 'u43c1.stop: dept_match_overrides uniqueness missing (double-booking guard)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.participating_departments'::regclass
                 AND contype='p' AND convalidated) THEN
    RAISE EXCEPTION 'u43c1.stop: participating_departments PK missing';
  END IF;
  -- new tables reference ONLY tenant/domain tables (never the catalog).
  SELECT string_agg(DISTINCT c2.relname, ',' ORDER BY c2.relname) INTO v_bad
    FROM pg_constraint k JOIN pg_class c1 ON c1.oid=k.conrelid
    JOIN pg_class c2 ON c2.oid=k.confrelid
   WHERE k.contype='f' AND c1.relname IN ('dept_match_overrides','participating_departments')
     AND c2.relname NOT IN ('clients','services','departments','users');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'u43c1.stop: new tables reference unexpected tables (%) — narrow substrate violated', v_bad;
  END IF;

  -- delivery columns: types, nullability, no defaults (NULL = undelivered).
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='staff_lists' AND column_name='delivery_channel'
                   AND data_type='text' AND is_nullable='YES' AND column_default IS NULL) THEN
    RAISE EXCEPTION 'u43c1.stop: staff_lists.delivery_channel shape is not TEXT NULL / no default';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='staff_lists' AND column_name='delivery_status'
                   AND data_type='text' AND is_nullable='YES' AND column_default IS NULL) THEN
    RAISE EXCEPTION 'u43c1.stop: staff_lists.delivery_status shape is not TEXT NULL / no default';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='staff_lists' AND column_name='revealed_by'
                   AND udt_name='uuid' AND is_nullable='YES' AND column_default IS NULL) THEN
    RAISE EXCEPTION 'u43c1.stop: staff_lists.revealed_by shape is not UUID NULL / no default';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='staff_lists' AND column_name='revealed_at'
                   AND data_type='timestamp with time zone' AND is_nullable='YES' AND column_default IS NULL) THEN
    RAISE EXCEPTION 'u43c1.stop: staff_lists.revealed_at shape is not TIMESTAMPTZ NULL / no default';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='staff_lists' AND column_name='reveal_acked_at'
                   AND data_type='timestamp with time zone' AND is_nullable='YES' AND column_default IS NULL) THEN
    RAISE EXCEPTION 'u43c1.stop: staff_lists.reveal_acked_at shape is not TIMESTAMPTZ NULL / no default';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='staff_lists_delivery_valid'
                  AND conrelid='public.staff_lists'::regclass AND convalidated) THEN
    RAISE EXCEPTION 'u43c1.stop: staff_lists_delivery_valid CHECK missing or NOT VALID';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='staff_lists_delivery_status_valid'
                  AND conrelid='public.staff_lists'::regclass AND convalidated) THEN
    RAISE EXCEPTION 'u43c1.stop: staff_lists_delivery_status_valid CHECK missing or NOT VALID';
  END IF;
  -- no secret-bearing delivery column may ever exist (OTP/hash leak guard).
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
             AND table_name='staff_lists'
             AND (column_name LIKE '%otp%' OR column_name LIKE '%secret%' OR column_name LIKE '%password%')) THEN
    RAISE EXCEPTION 'u43c1.stop: secret-bearing column on staff_lists (leak guard)';
  END IF;

  -- RLS enabled AND forced on the two new tables.
  SELECT string_agg(relname, ',' ORDER BY relname) INTO v_bad FROM pg_class
   WHERE relname IN ('dept_match_overrides','participating_departments')
     AND NOT (relrowsecurity AND relforcerowsecurity);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'u43c1.stop: RLS not enabled+forced on %', v_bad;
  END IF;

  -- policies: exactly the 17 c1 names (RLS-a x2, RLS-b b1-b4, F1 deliver,
  -- RLS-c, RLS-d, STORE-e x4, STORE-g x4), and the untouched audit/version gates.
  SELECT string_agg(policyname, ',' ORDER BY policyname) INTO v_bad FROM pg_policies
   WHERE schemaname='public' AND tablename IN ('dept_match_overrides','participating_departments');
  IF v_bad IS DISTINCT FROM 'b17_match_override_delete,b17_match_override_read,b17_match_override_update,b17_match_override_write,b17_participating_delete,b17_participating_read,b17_participating_update,b17_participating_write' THEN
    RAISE EXCEPTION 'u43c1.stop: STORE-e/g policy set is [%] (expected the eight narrow names)', coalesce(v_bad, 'none');
  END IF;
  FOR v_bad IN SELECT unnest(ARRAY['b17_consultant_links_insert','b17_consultant_links_delete','b17_work_staff_read',
    'b17_consultant_staff_rows_read','b17_consultant_staff_approve_update',
    'b17_consultant_users_provision_insert','b17_consultant_staff_deliver_update',
    'b17_consultant_staff_complete_password','b17_consultant_evaluations_na_lift_update']) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND policyname=v_bad) THEN
      RAISE EXCEPTION 'u43c1.stop: expected c1 branch % missing', v_bad;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='audit_log'
                 AND policyname='b17_audit_insert') THEN
    RAISE EXCEPTION 'u43c1.stop: b17_audit_insert missing after migration (must stay untouched)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND policyname='b17_version_repin') THEN
    RAISE EXCEPTION 'u43c1.stop: temporary repin policy was left behind (none should ever be created here)';
  END IF;

  -- ledger
  IF (SELECT count(*)::int FROM app_schema_versions) <> 2 THEN
    RAISE EXCEPTION 'u43c1.stop: ledger row count is not exactly 2 after re-pin';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app_schema_versions WHERE version='B17_U1'
                 AND checksum='ace11265d876b6f18229dd62efa1db693cd8df00ecd0ea6012b448694406d8d6'
                 AND structure_checksum='e1bb70b605f9a59be49cf1c25a396c0a') THEN
    RAISE EXCEPTION 'u43c1.stop: B17_U1 ledger row is not the invariant b17.sql pin';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app_schema_versions WHERE version='B17_U2D'
                 AND checksum='ff0ec3c3b20315607ba634b0bfb5cbf5b282738426f2114fbab36b55bfe4373e'
                 AND structure_checksum='76a272de85164db95670b1d43365c6e0') THEN
    RAISE EXCEPTION 'u43c1.stop: B17_U2D ledger row is not re-pinned to the current content sha256 + B17_CONTENT_SHAPE';
  END IF;

  RAISE NOTICE 'u43c1.migrate: OK mode=% shape=% ledger=B17_U1/B17_U2D re-pinned', v_mode, v_shape;
END $$;

DROP TABLE u43c1_ctl;

COMMIT;

\endif
