-- ============================================================================
-- TASK-PROTO-U4-1c-PROTECT — LIVE upgrade to the current repository state
-- Component: demo substrate b17_showcase (PostgreSQL 18)
-- Owner-approved scope: U4-1c-PROTECT only (archive flag + version columns +
-- single named RESTRICT FK + b17_selection_update policy + ledger re-pin).
-- NOTHING else: no data edit, no table/column drop, no policy/grant widening,
-- no content-file replay (b17-content.sql is NOT an upgrade procedure).
--
-- WHAT THIS DOES (exactly one transaction):
--   1. Serializes on the sanctioned B17 migration lock (same key as b17.sql
--      and applyB17Offline: 1717001), then proves preconditions.
--   2. Adds document_submissions.version and
--      initiative_department_status.version (INTEGER NOT NULL DEFAULT 1) and
--      client_initiatives.archived_at (TIMESTAMPTZ NULL, NULL = active).
--   3. Replaces whichever legacy FK guards the selection link with the ONE
--      named RESTRICT FK (initiative_department_status_selection_restrict)
--      and re-enforces NOT NULL on the link (fail-closed).
--   4. Creates the single approved §21 policy b17_selection_update on
--      client_initiatives (identical scope to b17_selection_delete).
--   5. Re-pins app_schema_versions to the constants measured in
--      src/db/b17Readiness.ts (B17_SHAPE / B17_CONTENT_SHAPE and the sha256 of
--      the current b17-content.sql).
--   6. Asserts the postcondition: the live catalog fingerprint equals
--      B17_CONTENT_SHAPE, so verifyB17/assertB17Ready goes green.
--
-- PRE-PROTECT STATE THIS UPGRADES FROM (proved by the precondition below):
--   ledger rows exactly B17_U1 + B17_U2D; content row checksum =
--   4ff0f31c…d8ea055 (pre-PROTECT file) and structure = c9271835…dfc40a;
--   live catalog fingerprint = c9271835…dfc40a (= pre-PROTECT constant);
--   selection FK auto-named "…_client_initiative_id_fkey" ON DELETE CASCADE;
--   no archived_at, no version columns, no b17_selection_update policy.
--
-- IDEMPOTENCY: every step converges. A second run detects the target
-- fingerprint, re-converges the same DDL/policy and re-pins the same ledger
-- values. Re-running is safe and changes nothing. A DB at any THIRD shape is
-- refused with "u41c.stop: shape drift <measured md5>" before any DDL.
--
-- ROLLBACK: the same file carries a guarded reverse block. It runs ONLY with
-- BOTH -v run_rollback=1 AND -v confirm_no_protect_state=YES (after the
-- runbook's superuser pre-checks). See the runbook.
--
-- EXECUTION (psql only — the \set / \if directives are psql meta-commands):
--   apply    : psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p <port> -U <owner> -d b17_showcase -f PROTECT_LIVE_MIGRATION.sql
--   rollback : psql -X -v ON_ERROR_STOP=1 -v run_rollback=1 -v confirm_no_protect_state=YES -h 127.0.0.1 -p <port> -U <owner> -d b17_showcase -f PROTECT_LIVE_MIGRATION.sql
-- Never paste individual statements into a GUI: the whole block is one
-- transaction and only a full -f run guarantees all-or-nothing.
-- Run as the NOSUPERUSER / NOBYPASSRLS principal that OWNS the public tables
-- (the substrate/app role — the same role the server connects with).
-- ============================================================================
\set ON_ERROR_STOP on

-- Session-local helper: the EXACT catalog fingerprint query from
-- src/db/b17Readiness.ts (STRUCTURE_SQL + CONTENT_AUTHORITY_SQL, verbatim).
-- Lives in pg_temp, so it is invisible to the public-schema fingerprint it
-- computes and disappears when this psql session ends.
CREATE FUNCTION pg_temp.u41c_shape() RETURNS text LANGUAGE sql STABLE AS $fn$
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
\if :{?confirm_no_protect_state}
\echo '*** MODE: ROLLBACK (reverse DDL + ledger restore) ***'

-- ============================================================================
-- ROLLBACK BLOCK — guarded, separate transaction.
-- Only runs with BOTH -v run_rollback=1 AND -v confirm_no_protect_state=YES.
-- ============================================================================
BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '300s';
SET LOCAL search_path = public;
SELECT pg_advisory_xact_lock(1717001);

DO $$
DECLARE
  v_shape text := (SELECT pg_temp.u41c_shape());
BEGIN
  IF current_user <> session_user THEN
    RAISE EXCEPTION 'u41c.stop: current_user <> session_user (run as the substrate owner, no SET ROLE)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'u41c.stop: principal is superuser/bypassrls; rollback must run as the substrate owner';
  END IF;
  IF v_shape <> 'c1f87f043bffa8ad3c939c7993f2ab2e' THEN
    RAISE EXCEPTION 'u41c.stop: rollback refused — live shape % is not the PROTECT target', v_shape;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app_schema_versions WHERE version='B17_U2D'
                 AND checksum='8c165c40f8dd5d17bc7d2a42908a51ee7e1664ee3db3480e147884db24ab5a80')
  THEN
    RAISE EXCEPTION 'u41c.stop: rollback refused — B17_U2D ledger row is not the PROTECT pin';
  END IF;
  -- State created under PROTECT cannot be represented in the old schema without
  -- loss. WHY it is not counted here: this transaction runs as the table owner
  -- under FORCE RLS, so a count would silently read 0 and prove nothing (the
  -- exact silent-pass class this project rejects). Instead the guarded
  -- invocation REQUIRES -v confirm_no_protect_state=YES after the operator has
  -- run, from a superuser session, the three mandatory pre-checks in the
  -- runbook (§Rollback), each of which MUST return 0:
  --   SELECT count(*) FROM client_initiatives WHERE archived_at IS NOT NULL;
  --   SELECT count(*) FROM initiative_department_status WHERE version <> 1;
  --   SELECT count(*) FROM document_submissions WHERE version <> 1;
END $$;

DROP POLICY IF EXISTS b17_selection_update ON client_initiatives;
ALTER TABLE initiative_department_status DROP CONSTRAINT initiative_department_status_selection_restrict;
ALTER TABLE initiative_department_status
  ADD CONSTRAINT initiative_department_status_client_initiative_id_fkey
  FOREIGN KEY (client_initiative_id) REFERENCES client_initiatives(id) ON DELETE CASCADE;
ALTER TABLE initiative_department_status DROP COLUMN version;
ALTER TABLE document_submissions DROP COLUMN version;
ALTER TABLE client_initiatives DROP COLUMN archived_at;

SELECT set_config('app.current_purpose', 'migration', true);
DROP POLICY IF EXISTS b17_version_repin ON app_schema_versions;
CREATE POLICY b17_version_repin ON app_schema_versions FOR UPDATE
  USING (b17_setting('current_purpose') = 'migration')
  WITH CHECK (b17_setting('current_purpose') = 'migration');
DO $$
DECLARE n int;
BEGIN
  UPDATE app_schema_versions SET structure_checksum = 'f28b8352a1b6f68e01b3cc9d5b725546'
   WHERE version = 'B17_U1';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'u41c.stop: B17_U1 rollback pin affected % rows (expected 1)', n; END IF;
  UPDATE app_schema_versions
     SET checksum = '4ff0f31c455c37ca8d60b9cd8f4b1d67b8a05d3810ffa2ac03c300540d8ea055',
         structure_checksum = 'c927183564e59ce9777b92e854dfc40a'
   WHERE version = 'B17_U2D';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'u41c.stop: B17_U2D rollback pin affected % rows (expected 1)', n; END IF;
END $$;
DROP POLICY b17_version_repin ON app_schema_versions;
SELECT set_config('app.current_purpose', '', true);

DO $$
DECLARE v_shape text := (SELECT pg_temp.u41c_shape());
BEGIN
  IF v_shape <> 'c927183564e59ce9777b92e854dfc40a' THEN
    RAISE EXCEPTION 'u41c.stop: rollback did not restore the pre-PROTECT fingerprint (%)', v_shape;
  END IF;
  IF (SELECT count(*)::int FROM app_schema_versions) <> 2 THEN
    RAISE EXCEPTION 'u41c.stop: ledger row count changed during rollback';
  END IF;
  RAISE NOTICE 'u41c.rollback: OK — pre-PROTECT fingerprint restored, ledger restored, 2 rows';
END $$;

COMMIT;

\else
\echo '*** ROLLBACK NOT RUN: first run the runbook superuser pre-checks, then pass -v run_rollback=1 -v confirm_no_protect_state=YES ***'
\endif

\else
\echo '*** MODE: APPLY (upgrade to PROTECT) ***'

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
CREATE TEMP TABLE IF NOT EXISTS u41c_protect_ctl (mode text, pre_shape text) ON COMMIT PRESERVE ROWS;

DO $$
DECLARE
  v_live text;
  v_rows int;
  v_bad text;
BEGIN
  -- 1a. principal
  IF current_user <> session_user THEN
    RAISE EXCEPTION 'u41c.stop: current_user <> session_user (run as the substrate owner, no SET ROLE)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'u41c.stop: principal is superuser/bypassrls; run as the NOSUPERUSER NOBYPASSRLS substrate owner';
  END IF;
  IF current_setting('row_security') <> 'on' THEN
    RAISE EXCEPTION 'u41c.stop: row_security must be on';
  END IF;

  -- 1b. activation + ownership (DDL would fail anyway; fail with a clear STOP)
  IF to_regclass('public.app_schema_versions') IS NULL
     OR to_regclass('public.client_initiatives') IS NULL
     OR to_regclass('public.initiative_department_status') IS NULL
     OR to_regclass('public.document_submissions') IS NULL
  THEN
    RAISE EXCEPTION 'u41c.stop: substrate tables missing (B17 activation was never applied here)';
  END IF;
  SELECT string_agg(c.relname, ',' ORDER BY c.relname) INTO v_bad
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND c.relname IN ('client_initiatives','initiative_department_status','document_submissions','app_schema_versions')
     AND pg_get_userbyid(c.relowner) <> current_user;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'u41c.stop: current_user does not own % — run as the substrate owner (another role owning these tables is drift)', v_bad;
  END IF;

  -- 1c. ledger must be exactly the two activation rows
  SELECT count(*)::int INTO v_rows FROM app_schema_versions;
  IF v_rows <> 2 THEN
    RAISE EXCEPTION 'u41c.stop: ledger row count % (expected exactly B17_U1 + B17_U2D)', v_rows;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app_schema_versions WHERE version = 'B17_U1'
                 AND checksum = 'ace11265d876b6f18229dd62efa1db693cd8df00ecd0ea6012b448694406d8d6')
  THEN
    RAISE EXCEPTION 'u41c.stop: B17_U1 ledger checksum is not the current b17.sql sha256 (wrong DB or drifted activation)';
  END IF;

  -- 1d. exact live shape: predecessor (upgrade) or target (idempotent re-run)
  v_live := (SELECT pg_temp.u41c_shape());
  IF v_live = 'c927183564e59ce9777b92e854dfc40a' THEN
    -- pre-PROTECT committed state; its ledger pins must be exactly the old ones
    IF NOT EXISTS (SELECT 1 FROM app_schema_versions WHERE version = 'B17_U1'
                   AND structure_checksum = 'f28b8352a1b6f68e01b3cc9d5b725546')
       OR NOT EXISTS (SELECT 1 FROM app_schema_versions WHERE version = 'B17_U2D'
                   AND checksum = '4ff0f31c455c37ca8d60b9cd8f4b1d67b8a05d3810ffa2ac03c300540d8ea055'
                   AND structure_checksum = 'c927183564e59ce9777b92e854dfc40a')
    THEN
      RAISE EXCEPTION 'u41c.stop: shape is pre-PROTECT but the ledger pins are not the expected pre-PROTECT values (drift — do not repair blindly)';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'initiative_department_status_client_initiative_id_fkey'
                     AND conrelid = 'public.initiative_department_status'::regclass AND confdeltype = 'c')
    THEN
      RAISE EXCEPTION 'u41c.stop: pre-PROTECT shape without the expected CASCADE selection FK';
    END IF;
    INSERT INTO u41c_protect_ctl VALUES ('predecessor', v_live);
    RAISE NOTICE 'u41c.protect: mode=predecessor shape=% — upgrading', v_live;
  ELSIF v_live = 'c1f87f043bffa8ad3c939c7993f2ab2e' THEN
    INSERT INTO u41c_protect_ctl VALUES ('target', v_live);
    RAISE NOTICE 'u41c.protect: mode=target shape=% — already upgraded; converging and re-verifying (no data touched)', v_live;
  ELSE
    RAISE EXCEPTION 'u41c.stop: shape drift — live catalog fingerprint % is neither the pre-PROTECT nor the PROTECT target (partial/manual application or foreign change)', v_live;
  END IF;
END $$;

-- 2. Additive columns (identical to src/db/schema.sql).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'document_submissions' AND column_name = 'version') THEN
    ALTER TABLE document_submissions ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'initiative_department_status' AND column_name = 'version') THEN
    ALTER TABLE initiative_department_status ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'client_initiatives' AND column_name = 'archived_at') THEN
    ALTER TABLE client_initiatives ADD COLUMN archived_at TIMESTAMP WITH TIME ZONE NULL;
  END IF;
END $$;

-- 3. Selection FK: drop whichever legacy guard exists (auto-named CASCADE or
--    the withdrawn round-2 SET NULL), re-enforce NOT NULL, install the single
--    named RESTRICT. SET NOT NULL aborts (23502) on a pre-existing nulled link
--    — fail-closed, never silently orphan a status.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'initiative_department_status_client_initiative_id_fkey'
               AND conrelid = 'public.initiative_department_status'::regclass) THEN
    ALTER TABLE initiative_department_status DROP CONSTRAINT initiative_department_status_client_initiative_id_fkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'initiative_department_status_selection_setnull'
               AND conrelid = 'public.initiative_department_status'::regclass) THEN
    ALTER TABLE initiative_department_status DROP CONSTRAINT initiative_department_status_selection_setnull;
  END IF;
  ALTER TABLE initiative_department_status ALTER COLUMN client_initiative_id SET NOT NULL;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'initiative_department_status_selection_restrict'
                   AND conrelid = 'public.initiative_department_status'::regclass) THEN
    ALTER TABLE initiative_department_status ADD CONSTRAINT initiative_department_status_selection_restrict
      FOREIGN KEY (client_initiative_id) REFERENCES client_initiatives(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- 4. The ONE approved §21 policy (byte-identical to src/db/b17-content.sql's
--    hunk; same scope as b17_selection_delete). Without it the archive UPDATE
--    is a silent 0-row no-op under FORCE RLS.
DROP POLICY IF EXISTS b17_selection_update ON client_initiatives;
CREATE POLICY b17_selection_update ON client_initiatives FOR UPDATE USING
  (b17_work_tenant(client_id) AND b17_setting('current_mode')='consultant'
   AND b17_content_fact('initiative',client_id,initiative_id)) WITH CHECK
  (b17_work_tenant(client_id) AND b17_setting('current_mode')='consultant'
   AND b17_content_fact('initiative',client_id,initiative_id));

-- 5. Ledger re-pin to src/db/b17Readiness.ts constants. app_schema_versions has
--    only an INSERT policy (b17_version_write), so a scoped UPDATE policy is
--    added for this transaction and dropped again before the fingerprint check.
SELECT set_config('app.current_purpose', 'migration', true);
DROP POLICY IF EXISTS b17_version_repin ON app_schema_versions;
CREATE POLICY b17_version_repin ON app_schema_versions FOR UPDATE
  USING (b17_setting('current_purpose') = 'migration')
  WITH CHECK (b17_setting('current_purpose') = 'migration');
DO $$
DECLARE n int;
BEGIN
  UPDATE app_schema_versions SET structure_checksum = 'c9d5a9e24ec9bf9128d17822d9f1ed1a'
   WHERE version = 'B17_U1';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'u41c.stop: B17_U1 re-pin affected % rows (expected exactly 1)', n; END IF;
  UPDATE app_schema_versions
     SET checksum = '8c165c40f8dd5d17bc7d2a42908a51ee7e1664ee3db3480e147884db24ab5a80',
         structure_checksum = 'c1f87f043bffa8ad3c939c7993f2ab2e'
   WHERE version = 'B17_U2D';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'u41c.stop: B17_U2D re-pin affected % rows (expected exactly 1)', n; END IF;
END $$;
DROP POLICY b17_version_repin ON app_schema_versions;
SELECT set_config('app.current_purpose', '', true);

-- 6. Postconditions: exact catalog fingerprint, structural pins, ledger pins.
DO $$
DECLARE
  v_shape text := (SELECT pg_temp.u41c_shape());
  v_bad text;
  v_mode text := (SELECT mode FROM u41c_protect_ctl);
BEGIN
  IF v_shape <> 'c1f87f043bffa8ad3c939c7993f2ab2e' THEN
    RAISE EXCEPTION 'u41c.stop: result fingerprint % does not equal B17_CONTENT_SHAPE', v_shape;
  END IF;

  -- columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='client_initiatives' AND column_name='archived_at'
                   AND data_type='timestamp with time zone' AND is_nullable='YES' AND column_default IS NULL) THEN
    RAISE EXCEPTION 'u41c.stop: client_initiatives.archived_at shape is not TIMESTAMPTZ NULL / no default';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='initiative_department_status' AND column_name='version'
                   AND data_type='integer' AND is_nullable='NO' AND column_default='1') THEN
    RAISE EXCEPTION 'u41c.stop: initiative_department_status.version shape is not INTEGER NOT NULL DEFAULT 1';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='document_submissions' AND column_name='version'
                   AND data_type='integer' AND is_nullable='NO' AND column_default='1') THEN
    RAISE EXCEPTION 'u41c.stop: document_submissions.version shape is not INTEGER NOT NULL DEFAULT 1';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='initiative_department_status' AND column_name='client_initiative_id'
                   AND is_nullable='NO') THEN
    RAISE EXCEPTION 'u41c.stop: the selection link is not NOT NULL';
  END IF;

  -- NOTE ON ROW-LEVEL DATA: this runs as the table owner under FORCE RLS, so
  -- business rows are invisible here (policies admit only a 'work' purpose).
  -- The added columns are INTEGER NOT NULL DEFAULT 1, so every pre-existing row
  -- is 1 by construction; the operator verifies row values/counts from the
  -- superuser session (runbook step 4). Do NOT add RLS-blind "count" checks
  -- here: they would silently read 0 and prove nothing.

  -- FK: exactly one of the three names, RESTRICT, validated
  SELECT string_agg(conname || ':' || confdeltype::text || ':' || convalidated::text, ',') INTO v_bad
    FROM pg_constraint WHERE conrelid = 'public.initiative_department_status'::regclass
     AND conname IN ('initiative_department_status_client_initiative_id_fkey',
                     'initiative_department_status_selection_setnull',
                     'initiative_department_status_selection_restrict');
  IF v_bad IS DISTINCT FROM 'initiative_department_status_selection_restrict:r:true' THEN
    RAISE EXCEPTION 'u41c.stop: selection FK state is [%] (expected only …_selection_restrict:r:true)', coalesce(v_bad, 'none');
  END IF;

  -- policy
  IF (SELECT count(*)::int FROM pg_policies
      WHERE schemaname='public' AND tablename='client_initiatives' AND policyname='b17_selection_update'
        AND cmd='UPDATE' AND permissive='PERMISSIVE') <> 1 THEN
    RAISE EXCEPTION 'u41c.stop: b17_selection_update policy missing or not a single permissive UPDATE policy';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND policyname='b17_version_repin') THEN
    RAISE EXCEPTION 'u41c.stop: temporary repin policy was not removed';
  END IF;

  -- ledger
  IF (SELECT count(*)::int FROM app_schema_versions) <> 2 THEN
    RAISE EXCEPTION 'u41c.stop: ledger row count is not exactly 2 after re-pin';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app_schema_versions WHERE version='B17_U1'
                 AND checksum='ace11265d876b6f18229dd62efa1db693cd8df00ecd0ea6012b448694406d8d6'
                 AND structure_checksum='c9d5a9e24ec9bf9128d17822d9f1ed1a') THEN
    RAISE EXCEPTION 'u41c.stop: B17_U1 ledger row is not re-pinned to B17_SHAPE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app_schema_versions WHERE version='B17_U2D'
                 AND checksum='8c165c40f8dd5d17bc7d2a42908a51ee7e1664ee3db3480e147884db24ab5a80'
                 AND structure_checksum='c1f87f043bffa8ad3c939c7993f2ab2e') THEN
    RAISE EXCEPTION 'u41c.stop: B17_U2D ledger row is not re-pinned to the current content sha256 + B17_CONTENT_SHAPE';
  END IF;

  RAISE NOTICE 'u41c.protect: OK mode=% shape=% ledger=B17_U1/B17_U2D re-pinned', v_mode, v_shape;
END $$;

-- 7. Report the four protected row counts as seen by a role WITHOUT bypassing
--    RLS is impossible here (FORCE RLS default-denies outside a work purpose);
--    the operator verifies counts from the superuser session per the runbook.
DROP TABLE u41c_protect_ctl;

COMMIT;

\endif
