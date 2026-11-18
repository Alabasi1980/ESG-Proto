-- ============================================================================
-- TASK-PROTO-U4-2-FIX — LIVE migration: shared pre-FIX database to the FIX substrate
-- Component: demo substrate b17_showcase (PostgreSQL 18)
-- Owner-approved scope: U4-2-FIX additive migration ONLY —
--   (a) schema.sql P1 batch §DB-1…DB-6 (src/db/schema.sql:1552-1662 verbatim:
--       items.version/status/archived_at/archive_reason + items_status_valid,
--       item_versions (RESTRICT), approved_service_copies + approved_copy_files
--       (tenant-FK only, NO catalog FK) + 3 indexes + RLS enable/force), and
--   (b) b17-content.sql FIX deltas (verbatim):
--       - audit whitelist P1/SHIELD-P1-04 (lines 495-568: DROP+CREATE
--         b17_audit_insert with CREATE_STANDARD/CREATE_DISCLOSURE/ARCHIVE_ITEM/
--         REOPEN_ITEM_SCOPE/SERVICE_DELETED/IMPORT_CATALOG_COMMITTED NULL-tenant
--         + APPROVED_COPY_SEALED target-bound only),
--       - P4 seal-read branch (lines 424-439: b17_attachments_seal_read),
--       - P4 reopen branch (lines 1050-1069: b17_answers_reopen_update),
--       - P1 RLS block incl. SHIELD-P1-01/02/03 (lines 1360-1436: six policies,
--         versions append-only, history API-5 matrix, actor-bound copy inserts).
-- NOTHING else: no data edit, no table/column/policy/grant drop or widening,
-- no content replay beyond the hunks above, no GROUP-bucket backfill.
--
-- WHAT THIS DOES (exactly one transaction):
--   1. Serializes on the sanctioned B17 migration lock (1717001, same as b17.sql
--      and PROTECT), then proves preconditions (principal, ownership,
--      activation, ledger pins, exact pre-FIX shape, no FIX objects yet).
--   2. Applies the schema batch verbatim (dependency order: tables first —
--      content policies require them).
--   3. Applies the content deltas verbatim (audit, seal-read, reopen, P1 RLS).
--   4. Re-pins app_schema_versions through the EXISTING b17_version_update gate
--      (purpose 'migration' GUC — same mechanism in kind as PROTECT, which had
--      to carry a temporary scoped policy because the pre-PROTECT content had
--      no UPDATE gate; the pre-FIX content already ships b17_version_update).
--   5. Asserts the postcondition: live shape == HEAD B17_CONTENT_SHAPE, new
--      objects/policies/RLS/FORCE exact, ledger re-pinned, no catalog FK from
--      copies. Zero business-row writes (only ADD COLUMN defaults, metadata).
--
-- PRE-FIX STATE THIS UPGRADES FROM (proved by the preconditions below):
--   ledger exactly B17_U1 + B17_U2D with
--     B17_U1  = ace11265d876b6f18229dd62efa1db693cd8df00ecd0ea6012b448694406d8d6 / c9d5a9e24ec9bf9128d17822d9f1ed1a
--     B17_U2D = 8c165c40f8dd5d17bc7d2a42908a51ee7e1664ee3db3480e147884db24ab5a80 / c1f87f043bffa8ad3c939c7993f2ab2e
--   live catalog fingerprint = c1f87f043bffa8ad3c939c7993f2ab2e (= PROTECT target, the live pin);
--   no item_versions / approved_service_copies / approved_copy_files tables,
--   no items.version column, none of the eight FIX policies.
--   Business counts recorded by the operator (runbook §4): known live triple
--   541/34/118 (Tera-provided 2026-11-18) re-verified before apply.
--
-- NEW (HEAD, re-measured from disk 2026-11-18 — see runbook §3 and rehearsal):
--     B17_U1  = ace11265d876b6f18229dd62efa1db693cd8df00ecd0ea6012b448694406d8d6 / e1bb70b605f9a59be49cf1c25a396c0a
--     B17_U2D = 9d08ad5636a99fd7c86d45e6a2ae0239e91df7e428c460c58124c4b2b5261188 / 90967166a353283de10488a43c393ac8
--   (b17.sql sha unchanged since PROTECT; content sha is the HEAD file hash.)
--
-- IDEMPOTENCY: every step converges. A second run detects the target
-- fingerprint, re-converges the same DDL/policies and re-pins the same ledger
-- values. Re-running is safe and changes nothing. A DB at any THIRD shape is
-- refused with "u42fix.stop: shape drift <measured md5>" before any DDL.
--
-- ROLLBACK: the same file carries a guarded reverse block. It runs ONLY with
-- BOTH -v run_rollback=1 AND -v confirm_no_fix_state=YES (after the runbook's
-- superuser pre-checks prove zero FIX-era state). Restores the pre-FIX audit
-- policy text verbatim, drops the three new tables + four items columns, and
-- re-pins the ledger to the OLD pins above (structure pins are constants; the
-- old content sha is the constant 8c165c40f8dd5d17bc7d2a42908a51ee7e1664ee3db3480e147884db24ab5a80 recorded at apply time).
--
-- EXECUTION (psql only — the \set / \if directives are psql meta-commands):
--   apply    : psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p <port> -U <owner> -d b17_showcase -f LIVE_MIGRATION.sql
--   rollback : psql -X -v ON_ERROR_STOP=1 -v run_rollback=1 -v confirm_no_fix_state=YES -h 127.0.0.1 -p <port> -U <owner> -d b17_showcase -f LIVE_MIGRATION.sql
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
CREATE FUNCTION pg_temp.u42fix_shape() RETURNS text LANGUAGE sql STABLE AS $fn$
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
\if :{?confirm_no_fix_state}
\echo '*** MODE: ROLLBACK (reverse DDL + ledger restore) ***'

-- ============================================================================
-- ROLLBACK BLOCK — guarded, separate transaction.
-- Only runs with BOTH -v run_rollback=1 AND -v confirm_no_fix_state=YES.
-- ============================================================================
BEGIN;
SET LOCAL lock_timeout = '15s';
SET LOCAL statement_timeout = '300s';
SET LOCAL search_path = public;
SELECT pg_advisory_xact_lock(1717001);

DO $$
DECLARE
  v_shape text := (SELECT pg_temp.u42fix_shape());
BEGIN
  IF current_user <> session_user THEN
    RAISE EXCEPTION 'u42fix.stop: current_user <> session_user (run as the substrate owner, no SET ROLE)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'u42fix.stop: principal is superuser/bypassrls; rollback must run as the substrate owner';
  END IF;
  IF v_shape <> '90967166a353283de10488a43c393ac8' THEN
    RAISE EXCEPTION 'u42fix.stop: rollback refused — live shape % is not the FIX target', v_shape;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app_schema_versions WHERE version='B17_U2D'
                 AND checksum='9d08ad5636a99fd7c86d45e6a2ae0239e91df7e428c460c58124c4b2b5261188' AND structure_checksum='90967166a353283de10488a43c393ac8') THEN
    RAISE EXCEPTION 'u42fix.stop: rollback refused — B17_U2D ledger row is not the FIX pin';
  END IF;
  -- FIX-era state cannot be represented in the old substrate without loss.
  -- WHY no counts here: this transaction runs as the table owner under FORCE
  -- RLS, so a count would silently read 0 and prove nothing (the exact
  -- silent-pass class this project rejects). The guarded invocation REQUIRES
  -- -v confirm_no_fix_state=YES after the operator has run, from a superuser
  -- session, the mandatory pre-checks in the runbook (§Rollback), each of
  -- which MUST return 0:
  --   SELECT count(*) FROM item_versions;
  --   SELECT count(*) FROM approved_service_copies;
  --   SELECT count(*) FROM approved_copy_files;
  --   SELECT count(*) FROM items WHERE version <> 1 OR status <> 'active'
  --     OR archived_at IS NOT NULL OR archive_reason IS NOT NULL;
END $$;

-- 1. Drop the FIX policies (new tables carry theirs away, but explicit first).
DROP POLICY IF EXISTS b17_item_versions_read ON item_versions;
DROP POLICY IF EXISTS b17_item_versions_insert ON item_versions;
DROP POLICY IF EXISTS b17_item_versions_update ON item_versions;
DROP POLICY IF EXISTS b17_item_versions_delete ON item_versions;
DROP POLICY IF EXISTS b17_approved_copies_read ON approved_service_copies;
DROP POLICY IF EXISTS b17_approved_copies_insert ON approved_service_copies;
DROP POLICY IF EXISTS b17_approved_copy_files_read ON approved_copy_files;
DROP POLICY IF EXISTS b17_approved_copy_files_insert ON approved_copy_files;
DROP POLICY IF EXISTS b17_answers_reopen_update ON answers;
DROP POLICY IF EXISTS b17_attachments_seal_read ON evidence_attachments;

-- 2. Restore the pre-FIX audit policy text verbatim (pre-FIX reconstruction
--    from src/db/b17-content.sql minus the P1/P4 hunks; the post-rollback
--    fingerprint check below proves byte-equivalence of effect).
DROP POLICY b17_audit_insert ON audit_log;
CREATE POLICY b17_audit_insert ON audit_log FOR INSERT WITH CHECK (
  user_id::text=b17_setting('current_actor_id') AND (
    (b17_setting('current_purpose') IN ('auth.login','auth.password','auth.bootstrap')
      AND client_id::text IS NOT DISTINCT FROM b17_setting('current_tenant_id')
      AND action IN ('USER_LOGIN','PASSWORD_CHANGED','BOOTSTRAP_INITIAL_ADMIN') AND entity_type='users' AND entity_id=user_id)
    OR (b17_setting('current_purpose')='workspace' AND b17_setting('current_user_role')='ge_admin'
      AND client_id::text=b17_setting('current_tenant_id') AND entity_type='workspace_tabs'
      AND entity_id::text=b17_setting('current_tab_id') AND action IN ('WORKSPACE_ENTER','WORKSPACE_EXIT'))
    -- U2-C1 (task §23 goal 3): P configuration audit rows. Branch 1: global
    -- catalog/config operations recorded with client_id IS NULL, only from a
    -- P context (platform summary work context or platform configuration
    -- context) and only for this closed catalog-config action list. Branch 2:
    -- the GRI commit's target-T row, only when the explicit server-set target
    -- equals the audited tenant and only for the import action/entity. The
    -- actor identity clause above binds both branches.
      OR ((b17_platform_scope() OR b17_platform_config()) AND client_id IS NULL
        AND action IN ('CREATE_SERVICE','UPDATE_SERVICE','DUPLICATE_SERVICE','LINK_SERVICE_STANDARD',
        'UNLINK_SERVICE_STANDARD','UPDATE_STANDARD','DELETE_STANDARD','UPDATE_DISCLOSURE',
        'DELETE_DISCLOSURE','CREATE_ITEM','UPDATE_ITEM','DELETE_ITEM','LINK_ITEMS','UNLINK_ITEMS',
        'INITIATIVE_UPSERTED','INITIATIVE_UPDATED',
        -- TASK-PROTO-U4-1c: the P-managed document requirement CRUD rows (the
        -- requirements are service-catalog objects, so their audit rows are
        -- NULL-tenant platform configuration rows like the catalog writes above).
        'DOCUMENT_REQUIREMENT_CREATED','DOCUMENT_REQUIREMENT_UPDATED','DOCUMENT_REQUIREMENT_DELETED'))
    OR (b17_platform_config() AND b17_setting('target_id') IS NOT NULL
      AND client_id::text=b17_setting('target_id')
      AND ((action='IMPORT_GRI_DISCLOSURES' AND entity_type='standards')
        OR (action='ESG_PROFILE_IMPORTED' AND entity_type='esg_profile')
        OR (action='REPORT_SETTINGS_SAVED' AND entity_type='report_settings')))
    -- SHIELD-U2F-01 (task §3(1)): the §3.4 admin configuration audit rows.
    -- Targetless branch = tenant creation + the explicit bulk link + a
    -- bulk link — both with a NULL target; target-
    -- bound branch = every action a P@T row may take on EXPLICIT TARGET T
    -- (suspend/rename, head designation, link/flag/unlink, assign/unassign,
    -- staff reject, and — round 2 — USER_CREATED/USER_DEACTIVATED/
    -- USER_REACTIVATED/STAFF_LIST_APPROVED provisioning rows). Append-only and
    -- actor-bound above; OTPs/hashes are never in any payload.
    OR (b17_platform_config() AND (
      -- TASK-PROTO-H13: the platform-wide app theme is a NULL-target platform
      -- configuration write; without this action its append-only audit row is
      -- refused by row security, which would roll the theme save back with it.
      (b17_setting('target_id') IS NULL
        AND action IN ('CREATE_CLIENT','LINK_SERVICE_ALL_TENANTS','APP_THEME_UPDATED'))
      OR (b17_setting('target_id') IS NOT NULL
        AND client_id::text=b17_setting('target_id')
        AND action IN ('CLIENT_SUSPENDED','CLIENT_UNSUSPENDED','CLIENT_UPDATED',
          'DEPARTMENT_HEAD_ASSIGNED','DEPARTMENT_HEAD_CLEARED','LINK_CLIENT_SERVICE',
          'UPDATE_CLIENT_SERVICE_FLAGS','UNLINK_CLIENT_SERVICE','ASSIGN_ITEM',
          'UNASSIGN_ITEM','STAFF_LIST_REJECTED','USER_CREATED','USER_DEACTIVATED',
          'USER_REACTIVATED','STAFF_LIST_APPROVED'))
      -- TASK-PROTO-U4-1c round 3 (G-01): the P-managed document-requirement audits
      -- are written with client_id = the EXPLICIT TARGET T (the requirement is
      -- client-scoped since round 2). The NULL-tenant branch above therefore
      -- refused them (42501, rolling the whole requirement write back). This is
      -- the target-bound twin for EXACTLY those three actions: same platform
      -- configuration context, client = T, target not null. No other action,
      -- table or policy is touched.
      OR (b17_setting('target_id') IS NOT NULL
        AND client_id::text=b17_setting('target_id')
        AND action IN ('DOCUMENT_REQUIREMENT_CREATED','DOCUMENT_REQUIREMENT_UPDATED',
          'DOCUMENT_REQUIREMENT_DELETED'))))
    OR b17_work_tenant(client_id)));

-- 3. Drop the new tables (dependency order: files, then copies, then versions).
DROP TABLE IF EXISTS approved_copy_files;
DROP TABLE IF EXISTS approved_service_copies;
DROP TABLE IF EXISTS item_versions;

-- 4. Drop the new items columns + status domain (constraint first).
ALTER TABLE items DROP CONSTRAINT IF EXISTS items_status_valid;
ALTER TABLE items DROP COLUMN IF EXISTS archive_reason;
ALTER TABLE items DROP COLUMN IF EXISTS archived_at;
ALTER TABLE items DROP COLUMN IF EXISTS status;
ALTER TABLE items DROP COLUMN IF EXISTS version;

-- 5. Ledger restore to the pre-FIX pins through the existing
--    b17_version_update gate (still present: rollback touches no gate).
SELECT set_config('app.current_purpose', 'migration', true);
DO $$
DECLARE n int;
BEGIN
  UPDATE app_schema_versions SET structure_checksum = 'c9d5a9e24ec9bf9128d17822d9f1ed1a'
   WHERE version = 'B17_U1';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'u42fix.stop: B17_U1 rollback pin affected % rows (expected 1)', n; END IF;
  UPDATE app_schema_versions
     SET checksum = '8c165c40f8dd5d17bc7d2a42908a51ee7e1664ee3db3480e147884db24ab5a80',
         structure_checksum = 'c1f87f043bffa8ad3c939c7993f2ab2e'
   WHERE version = 'B17_U2D';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'u42fix.stop: B17_U2D rollback pin affected % rows (expected 1)', n; END IF;
END $$;
SELECT set_config('app.current_purpose', '', true);

DO $$
DECLARE v_shape text := (SELECT pg_temp.u42fix_shape());
BEGIN
  IF v_shape <> 'c1f87f043bffa8ad3c939c7993f2ab2e' THEN
    RAISE EXCEPTION 'u42fix.stop: rollback did not restore the pre-FIX fingerprint (%)', v_shape;
  END IF;
  IF (SELECT count(*)::int FROM app_schema_versions) <> 2 THEN
    RAISE EXCEPTION 'u42fix.stop: ledger row count changed during rollback';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='public' AND c.relname IN ('item_versions','approved_service_copies','approved_copy_files')) THEN
    RAISE EXCEPTION 'u42fix.stop: new tables still present after rollback';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND policyname IN
    ('b17_item_versions_read','b17_item_versions_insert','b17_approved_copies_read',
     'b17_approved_copies_insert','b17_approved_copy_files_read','b17_approved_copy_files_insert',
     'b17_answers_reopen_update','b17_attachments_seal_read')) THEN
    RAISE EXCEPTION 'u42fix.stop: FIX policies still present after rollback';
  END IF;
  RAISE NOTICE 'u42fix.rollback: OK — pre-FIX fingerprint restored, ledger restored, 2 rows';
END $$;

COMMIT;

\else
\echo '*** ROLLBACK NOT RUN: first run the runbook superuser pre-checks, then pass -v run_rollback=1 -v confirm_no_fix_state=YES ***'
\endif

\else
\echo '*** MODE: APPLY (upgrade to FIX) ***'

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
CREATE TEMP TABLE IF NOT EXISTS u42fix_ctl (mode text, pre_shape text) ON COMMIT PRESERVE ROWS;

DO $$
DECLARE
  v_live text;
  v_rows int;
  v_bad text;
BEGIN
  -- 1a. principal
  IF current_user <> session_user THEN
    RAISE EXCEPTION 'u42fix.stop: current_user <> session_user (run as the substrate owner, no SET ROLE)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'u42fix.stop: principal is superuser/bypassrls; run as the NOSUPERUSER NOBYPASSRLS substrate owner';
  END IF;
  IF current_setting('row_security') <> 'on' THEN
    RAISE EXCEPTION 'u42fix.stop: row_security must be on';
  END IF;

  -- 1b. activation + ownership (DDL would fail anyway; fail with a clear STOP)
  IF to_regclass('public.app_schema_versions') IS NULL
     OR to_regclass('public.items') IS NULL
     OR to_regclass('public.answers') IS NULL
     OR to_regclass('public.audit_log') IS NULL
     OR to_regclass('public.client_initiatives') IS NULL
  THEN
    RAISE EXCEPTION 'u42fix.stop: substrate tables missing (B17 activation was never applied here)';
  END IF;
  SELECT string_agg(c.relname, ',' ORDER BY c.relname) INTO v_bad
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND c.relname IN ('items','answers','audit_log','client_initiatives','app_schema_versions')
     AND pg_get_userbyid(c.relowner) <> current_user;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'u42fix.stop: current_user does not own % — run as the substrate owner (another role owning these tables is drift)', v_bad;
  END IF;

  -- 1c. ledger must be exactly the two activation rows. B17_U1.checksum is the
  -- b17.sql sha256, which this migration does not touch (re-measured from disk)
  -- — so it is INVARIANT in both modes and is checked here. The structure pins
  -- and the whole B17_U2D row are mode-dependent and are checked inside the
  -- shape branch below (predecessor demands the exact OLD pair, target demands
  -- the exact NEW pair) — this ordering is what makes a re-run converge
  -- instead of refusing on its own re-pinned ledger.
  SELECT count(*)::int INTO v_rows FROM app_schema_versions;
  IF v_rows <> 2 THEN
    RAISE EXCEPTION 'u42fix.stop: ledger row count % (expected exactly B17_U1 + B17_U2D)', v_rows;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app_schema_versions WHERE version = 'B17_U1'
                 AND checksum = 'ace11265d876b6f18229dd62efa1db693cd8df00ecd0ea6012b448694406d8d6') THEN
    RAISE EXCEPTION 'u42fix.stop: B17_U1 ledger checksum is not the b17.sql sha256 (wrong DB or drifted activation)';
  END IF;

  -- 1d. the re-pin gate must exist (it ships in the pre-FIX content substrate).
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
                 AND tablename='app_schema_versions' AND policyname='b17_version_update') THEN
    RAISE EXCEPTION 'u42fix.stop: b17_version_update gate missing (pre-FIX content substrate incomplete)';
  END IF;

  -- 1e. exact live shape: predecessor (upgrade) or target (idempotent re-run).
  v_live := (SELECT pg_temp.u42fix_shape());
  IF v_live = 'c1f87f043bffa8ad3c939c7993f2ab2e' THEN
    -- predecessor mode: ledger pins must be exactly the pre-FIX pair.
    -- B17_U2D structure is the live pin; its checksum is the PROTECT-doc pin
    -- (8c165c40f8dd5d17bc7d2a42908a51ee7e1664ee3db3480e147884db24ab5a80) — the runbook pre-check surfaces the live value first
    -- (§4 step 1); any deviation there is STOP-before-apply, never edited here.
    IF NOT EXISTS (SELECT 1 FROM app_schema_versions WHERE version = 'B17_U1'
                   AND structure_checksum = 'c9d5a9e24ec9bf9128d17822d9f1ed1a') THEN
      RAISE EXCEPTION 'u42fix.stop: pre-FIX shape but B17_U1 is not the pre-FIX pin (drift — do not repair blindly)';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM app_schema_versions WHERE version = 'B17_U2D'
                   AND checksum = '8c165c40f8dd5d17bc7d2a42908a51ee7e1664ee3db3480e147884db24ab5a80'
                   AND structure_checksum = 'c1f87f043bffa8ad3c939c7993f2ab2e') THEN
      RAISE EXCEPTION 'u42fix.stop: pre-FIX shape but B17_U2D is not the pre-FIX pin (checksum and structure must both match; do not repair blindly)';
    END IF;
    -- no FIX object may exist yet: a half-applied state always moves the shape.
    IF to_regclass('public.item_versions') IS NOT NULL
       OR to_regclass('public.approved_service_copies') IS NOT NULL
       OR to_regclass('public.approved_copy_files') IS NOT NULL THEN
      RAISE EXCEPTION 'u42fix.stop: pre-FIX shape but FIX tables already present (partial manual DDL — restore backup, do not patch forward)';
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
               AND table_name='items' AND column_name IN ('version','status','archived_at','archive_reason')) THEN
      RAISE EXCEPTION 'u42fix.stop: pre-FIX shape but FIX items columns already present (partial manual DDL — restore backup)';
    END IF;
    INSERT INTO u42fix_ctl VALUES ('predecessor', v_live);
    RAISE NOTICE 'u42fix.migrate: mode=predecessor shape=% — upgrading', v_live;
  ELSIF v_live = '90967166a353283de10488a43c393ac8' THEN
    -- target mode: ledger must already be the NEW pair, else the DB reached
    -- the FIX shape by a foreign path (hand DDL + hand ledger edit).
    IF NOT EXISTS (SELECT 1 FROM app_schema_versions WHERE version = 'B17_U1'
                   AND checksum = 'ace11265d876b6f18229dd62efa1db693cd8df00ecd0ea6012b448694406d8d6'
                   AND structure_checksum = 'e1bb70b605f9a59be49cf1c25a396c0a') THEN
      RAISE EXCEPTION 'u42fix.stop: FIX shape but B17_U1 is not the FIX pin (foreign path — restore backup)';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM app_schema_versions WHERE version = 'B17_U2D'
                   AND checksum = '9d08ad5636a99fd7c86d45e6a2ae0239e91df7e428c460c58124c4b2b5261188'
                   AND structure_checksum = '90967166a353283de10488a43c393ac8') THEN
      RAISE EXCEPTION 'u42fix.stop: FIX shape but B17_U2D is not the FIX pin (foreign path — restore backup)';
    END IF;
    INSERT INTO u42fix_ctl VALUES ('target', v_live);
    RAISE NOTICE 'u42fix.migrate: mode=target shape=% — already upgraded; converging and re-verifying (no data touched)', v_live;
  ELSE
    RAISE EXCEPTION 'u42fix.stop: shape drift — live catalog fingerprint % is neither the pre-FIX nor the FIX target (partial/manual application or foreign change)', v_live;
  END IF;
END $$;

-- 2. Schema batch, VERBATIM src/db/schema.sql:1552-1662 (tables first: the
--    content policies below require them to exist).
--------------------------------------------------------------------------------
-- TASK-PROTO-U4-2-FIX P1 (DB §§DB-1…DB-6) — additive catalog-history +
-- approved-copy substrate. Same idempotency contract as every FIX BATCH above:
-- this file is re-applied wholesale by the explicit empty-install initializer,
-- so every statement is a DO-block guarded by a catalogue check or
-- CREATE ... IF NOT EXISTS. Additive only — no existing column, row, policy,
-- grant or FK is changed; the four new items columns carry defaults so zero
-- existing rows are rewritten (ADD COLUMN with a constant DEFAULT is
-- metadata-only on PG11+); no NOT VALID is needed because every new rule is
-- satisfied by the defaults it ships with. GROUP-bucket ensure stays lazy
-- (handler-owned, P2/P5) — no backfill writes here.
--
-- RLS row-scope policies for the new tables + the audit whitelist additions
-- live in b17-content.sql (B17 U2D): b17.sql's activation block replaces EVERY
-- predecessor policy, so a policy defined only here would not survive a fresh
-- install (the H13 app_settings precedent).
--------------------------------------------------------------------------------

-- P1-A. items: optimistic-locking version + archive state (OD-13 G-3/G-4).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'items' AND column_name = 'version') THEN
    ALTER TABLE items ADD COLUMN version INT NOT NULL DEFAULT 1;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'items' AND column_name = 'status') THEN
    ALTER TABLE items ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'items' AND column_name = 'archived_at') THEN
    ALTER TABLE items ADD COLUMN archived_at TIMESTAMP WITH TIME ZONE NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'items' AND column_name = 'archive_reason') THEN
    ALTER TABLE items ADD COLUMN archive_reason TEXT NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_status_valid') THEN
    ALTER TABLE items ADD CONSTRAINT items_status_valid CHECK (status IN ('active', 'archived'));
  END IF;
END $$;

-- P1-B. item_versions: edit-history snapshots (OD-13 G-3). Handler-written
-- (actor + reason live in the row, never a trigger). ON DELETE RESTRICT keeps
-- history when a hard delete is attempted — the delete handler archives
-- instead (P2); hard delete stays possible only when zero versions exist.
CREATE TABLE IF NOT EXISTS item_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  version INT NOT NULL CHECK (version > 0),
  snapshot JSONB NOT NULL,
  changed_by UUID,
  changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  reason TEXT,
  UNIQUE(item_id, version)
);

-- P1-C. approved_service_copies + approved_copy_files: GE-final frozen deep
-- copies (OD-13 G-5). Self-contained: the ONLY tenant FK is client_id CASCADE
-- (a copy dies with its tenant, never with its service); service_id carries
-- NO FK into the catalog so the copy survives full source-service removal
-- (INV-APPROVED-IMMUNE). Attachment bytes are duplicated (OD-06 demo-scale,
-- 5 MB cap mirrored from evidence_attachments).
CREATE TABLE IF NOT EXISTS approved_service_copies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  service_id UUID NULL,
  service_code TEXT NOT NULL,
  sealed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  sealed_by UUID,
  content_hash TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'sealed'
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'approved_service_copies_status_valid') THEN
    ALTER TABLE approved_service_copies ADD CONSTRAINT approved_service_copies_status_valid CHECK (status IN ('sealed'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS approved_copy_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  copy_id UUID NOT NULL REFERENCES approved_service_copies(id) ON DELETE CASCADE,
  answer_ref TEXT,
  file_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  data BYTEA NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_item_versions_item ON item_versions(item_id);
CREATE INDEX IF NOT EXISTS ix_approved_service_copies_client ON approved_service_copies(client_id);
CREATE INDEX IF NOT EXISTS ix_approved_copy_files_copy ON approved_copy_files(copy_id);

-- P1-D. RLS posture (policies: b17-content.sql). Enable AND force here so the
-- new tables are never accidentally open before the content substrate lands.
ALTER TABLE item_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE approved_service_copies ENABLE ROW LEVEL SECURITY;
ALTER TABLE approved_copy_files ENABLE ROW LEVEL SECURITY;

ALTER TABLE item_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE approved_service_copies FORCE ROW LEVEL SECURITY;
ALTER TABLE approved_copy_files FORCE ROW LEVEL SECURITY;

-- 3a. Content audit whitelist, VERBATIM src/db/b17-content.sql:495-568
-- (DROP+CREATE converges on rerun; the USING/WITH CHECK text is exactly what a
-- fresh install carries, so migrated==fresh by construction).
DROP POLICY b17_audit_insert ON audit_log;
CREATE POLICY b17_audit_insert ON audit_log FOR INSERT WITH CHECK (
  user_id::text=b17_setting('current_actor_id') AND (
    (b17_setting('current_purpose') IN ('auth.login','auth.password','auth.bootstrap')
      AND client_id::text IS NOT DISTINCT FROM b17_setting('current_tenant_id')
      AND action IN ('USER_LOGIN','PASSWORD_CHANGED','BOOTSTRAP_INITIAL_ADMIN') AND entity_type='users' AND entity_id=user_id)
    OR (b17_setting('current_purpose')='workspace' AND b17_setting('current_user_role')='ge_admin'
      AND client_id::text=b17_setting('current_tenant_id') AND entity_type='workspace_tabs'
      AND entity_id::text=b17_setting('current_tab_id') AND action IN ('WORKSPACE_ENTER','WORKSPACE_EXIT'))
    -- U2-C1 (task §23 goal 3): P configuration audit rows. Branch 1: global
    -- catalog/config operations recorded with client_id IS NULL, only from a
    -- P context (platform summary work context or platform configuration
    -- context) and only for this closed catalog-config action list. Branch 2:
    -- the GRI commit's target-T row, only when the explicit server-set target
    -- equals the audited tenant and only for the import action/entity. The
    -- actor identity clause above binds both branches.
      OR ((b17_platform_scope() OR b17_platform_config()) AND client_id IS NULL
        AND action IN ('CREATE_SERVICE','UPDATE_SERVICE','DUPLICATE_SERVICE','LINK_SERVICE_STANDARD',
        'UNLINK_SERVICE_STANDARD','UPDATE_STANDARD','DELETE_STANDARD','UPDATE_DISCLOSURE',
        'DELETE_DISCLOSURE','CREATE_ITEM','UPDATE_ITEM','DELETE_ITEM','LINK_ITEMS','UNLINK_ITEMS',
        'INITIATIVE_UPSERTED','INITIATIVE_UPDATED',
        -- TASK-PROTO-U4-1c: the P-managed document requirement CRUD rows (the
        -- requirements are service-catalog objects, so their audit rows are
        -- NULL-tenant platform configuration rows like the catalog writes above).
        'DOCUMENT_REQUIREMENT_CREATED','DOCUMENT_REQUIREMENT_UPDATED','DOCUMENT_REQUIREMENT_DELETED',
        -- TASK-PROTO-U4-2-FIX P1 (SHIELD-P1-04): the platform catalog/history
        -- writes below are audited NULL-tenant exactly like CREATE_ITEM/
        -- UPDATE_ITEM above (P2 handlers record them in the same platform
        -- configuration context). APPROVED_COPY_SEALED is deliberately NOT
        -- here: a seal is a per-client write, audited target-bound only.
        'CREATE_STANDARD','CREATE_DISCLOSURE','ARCHIVE_ITEM','REOPEN_ITEM_SCOPE',
        'SERVICE_DELETED','IMPORT_CATALOG_COMMITTED'))
    OR (b17_platform_config() AND b17_setting('target_id') IS NOT NULL
      AND client_id::text=b17_setting('target_id')
      AND ((action='IMPORT_GRI_DISCLOSURES' AND entity_type='standards')
        OR (action='ESG_PROFILE_IMPORTED' AND entity_type='esg_profile')
        OR (action='REPORT_SETTINGS_SAVED' AND entity_type='report_settings')
        -- TASK-PROTO-U4-2-FIX P1 (SHIELD-P1-04): the GE-final seal is a
        -- per-client write — the target-bound branch below is the ONLY
        -- admitted branch for APPROVED_COPY_SEALED seals (entity pinned).
        OR (action='APPROVED_COPY_SEALED' AND entity_type='approved_service_copies')))
    -- SHIELD-U2F-01 (task §3(1)): the §3.4 admin configuration audit rows.
    -- Targetless branch = tenant creation + the explicit bulk link + a
    -- bulk link — both with a NULL target; target-
    -- bound branch = every action a P@T row may take on EXPLICIT TARGET T
    -- (suspend/rename, head designation, link/flag/unlink, assign/unassign,
    -- staff reject, and — round 2 — USER_CREATED/USER_DEACTIVATED/
    -- USER_REACTIVATED/STAFF_LIST_APPROVED provisioning rows). Append-only and
    -- actor-bound above; OTPs/hashes are never in any payload.
    OR (b17_platform_config() AND (
      -- TASK-PROTO-H13: the platform-wide app theme is a NULL-target platform
      -- configuration write; without this action its append-only audit row is
      -- refused by row security, which would roll the theme save back with it.
      (b17_setting('target_id') IS NULL
        AND action IN ('CREATE_CLIENT','LINK_SERVICE_ALL_TENANTS','APP_THEME_UPDATED'))
      OR (b17_setting('target_id') IS NOT NULL
        AND client_id::text=b17_setting('target_id')
        AND action IN ('CLIENT_SUSPENDED','CLIENT_UNSUSPENDED','CLIENT_UPDATED',
          'DEPARTMENT_HEAD_ASSIGNED','DEPARTMENT_HEAD_CLEARED','LINK_CLIENT_SERVICE',
          'UPDATE_CLIENT_SERVICE_FLAGS','UNLINK_CLIENT_SERVICE','ASSIGN_ITEM',
          'UNASSIGN_ITEM','STAFF_LIST_REJECTED','USER_CREATED','USER_DEACTIVATED',
          'USER_REACTIVATED','STAFF_LIST_APPROVED'))
      -- TASK-PROTO-U4-1c round 3 (G-01): the P-managed document-requirement audits
      -- are written with client_id = the EXPLICIT TARGET T (the requirement is
      -- client-scoped since round 2). The NULL-tenant branch above therefore
      -- refused them (42501, rolling the whole requirement write back). This is
      -- the target-bound twin for EXACTLY those three actions: same platform
      -- configuration context, client = T, target not null. No other action,
      -- table or policy is touched.
      OR (b17_setting('target_id') IS NOT NULL
        AND client_id::text=b17_setting('target_id')
        AND action IN ('DOCUMENT_REQUIREMENT_CREATED','DOCUMENT_REQUIREMENT_UPDATED',
          'DOCUMENT_REQUIREMENT_DELETED'))))
    OR b17_work_tenant(client_id)));

-- 3b. P4 seal-read branch, VERBATIM src/db/b17-content.sql:424-439.
-- TASK-PROTO-U4-2-FIX P4 (Tera ruling B, option a): ONE narrow read branch so
-- the P-only standalone seal (`POST /api/approved-copies/seal`) can copy the
-- sealed tenant's attachment bytes with absolute byte immunity (INV-6). The
-- branch is context-gated only (platform.config + explicit target T + platform
-- mode + ge_admin + bound actor): row narrowing to the seal's answer ids is
-- handler-enforced (the handler resolves the answer id list under the
-- targetless summary context first, then switches to the target-bound context
-- for the byte copy — an answers tenant join inside the policy would re-enter
-- RLS that denies P@T and admit nothing). Read-only; no INSERT/UPDATE/DELETE.
-- DROP-IF-EXISTS so whole-file re-application stays idempotent.
DROP POLICY IF EXISTS b17_attachments_seal_read ON evidence_attachments;
CREATE POLICY b17_attachments_seal_read ON evidence_attachments FOR SELECT USING (
  b17_platform_config() AND b17_setting('current_mode')='platform'
  AND b17_setting('current_user_role')='ge_admin'
  AND b17_setting('current_actor_id') IS NOT NULL
  AND b17_setting('target_id') IS NOT NULL);

-- 3c. P4 reopen branch, VERBATIM src/db/b17-content.sql:1050-1069.
-- TASK-PROTO-U4-2-FIX P4 (Tera ruling C): ONE narrow UPDATE branch for the
-- catalog reopen leg (`PATCH /api/items/:id` reopen path, OD-13 G-3). The
-- catalog item write already runs under the targetless platform configuration
-- (b17_catalog_config_update), but the paired answers→`reopened` transition
-- has no platform branch — without this the reopen txn rolls back under RLS.
-- Reopen-only purpose, enforced in SQL: USING admits only the three pre-final
-- states, WITH CHECK admits only `reopened` (no other status can be minted
-- through it); context-gated to platform mode + ge_admin + bound actor.
-- Tenant scoping is handler-enforced (the handler reopens only answers of the
-- item being versioned). No INSERT/DELETE. DROP-IF-EXISTS for idempotent
-- re-application.
DROP POLICY IF EXISTS b17_answers_reopen_update ON answers;
CREATE POLICY b17_answers_reopen_update ON answers FOR UPDATE
  USING (b17_platform_config() AND b17_setting('current_mode')='platform'
    AND b17_setting('current_user_role')='ge_admin'
    AND b17_setting('current_actor_id') IS NOT NULL
    AND status IN ('submitted','approved','client_approved'))
  WITH CHECK (b17_platform_config() AND b17_setting('current_mode')='platform'
    AND b17_setting('current_user_role')='ge_admin'
    AND status='reopened');

-- 3d. P1 RLS block, VERBATIM src/db/b17-content.sql:1360-1436 (DROPs converge
-- on rerun, including the pre-SHIELD eight-policy names).
-- ===========================================================================
-- TASK-PROTO-U4-2-FIX P1 (DB §§DB-4…DB-6) — RLS row scope for the P1 tables.
-- Tables/columns/indexes live in schema.sql; their policies MUST live here
-- because b17.sql's activation block replaces every predecessor policy (the
-- H13 app_settings precedent directly above).
--
-- item_versions: catalog history — P contexts unchanged; work reads follow the
-- API-5 matrix (SHIELD-P1-02, mirrored from b17_evaluations): W keeps the
-- own-tenant linked read, C additionally needs the gap fact on the item, E is
-- limited to rows whose evaluation it proves as its own department (the
-- 'evaluation' fact already encodes exactly-one-answer + retained assignment).
-- Writes are P-catalog INSERT only (SHIELD-P1-01 append-only, INV-HISTORY).
-- approved_service_copies / approved_copy_files: GE-final sealed copies —
-- ge_admin sees all, same-tenant W/C read, E is denied entirely (spec
-- API §API-5); inserts admit the W GE-final freeze context (mirror
-- b17_review_snapshots_insert) and the P@T configuration context; there is
-- NO UPDATE/DELETE policy — sealed copies are immutable (tenant CASCADE is
-- the only removal path). Handler-owned rules stay out of SQL: version
-- lockstep, content_hash computation, 5 MB/mime checks, DG-02 preconditions.
-- ===========================================================================

-- Idempotent re-application (same contract as the schema.sql batch above):
-- the whole content file is re-applied wholesale by the offline initializer,
-- so every policy here is dropped first (a policy dropped with its table on
-- rollback is simply re-created).
DROP POLICY IF EXISTS b17_item_versions_read ON item_versions;
DROP POLICY IF EXISTS b17_item_versions_insert ON item_versions;
DROP POLICY IF EXISTS b17_item_versions_update ON item_versions;
DROP POLICY IF EXISTS b17_item_versions_delete ON item_versions;
DROP POLICY IF EXISTS b17_approved_copies_read ON approved_service_copies;
DROP POLICY IF EXISTS b17_approved_copies_insert ON approved_service_copies;
DROP POLICY IF EXISTS b17_approved_copy_files_read ON approved_copy_files;
DROP POLICY IF EXISTS b17_approved_copy_files_insert ON approved_copy_files;

CREATE POLICY b17_item_versions_read ON item_versions FOR SELECT USING (
  b17_platform_scope() OR b17_platform_config()
  OR (b17_work_tenant(nullif(b17_setting('current_tenant_id'),'')::uuid)
    AND b17_item_visible(nullif(b17_setting('current_tenant_id'),'')::uuid, item_id)
    AND (b17_setting('current_mode')<>'employee'
      OR EXISTS (SELECT 1 FROM evaluations e WHERE e.client_id::text=b17_setting('current_tenant_id')
        AND e.item_id=item_versions.item_id AND b17_content_fact('evaluation', e.client_id, e.id)))
    AND (b17_setting('current_mode')<>'client'
      OR b17_content_fact('gap', nullif(b17_setting('current_tenant_id'),'')::uuid, item_id))));
CREATE POLICY b17_item_versions_insert ON item_versions FOR INSERT
  WITH CHECK (b17_platform_scope() OR b17_platform_config());
-- SHIELD-P1-01: NO UPDATE/DELETE policy — item_versions is append-only
-- (INV-HISTORY), mirroring the review_snapshots/sealed-copy immutability.
-- RLS default-deny makes version rows immutable; ON DELETE RESTRICT on
-- item_id independently blocks hard deletes of referenced items. The two
-- DROP POLICY IF EXISTS lines above are retained so re-application stays
-- idempotent on databases that carry the pre-SHIELD eight-policy set.

CREATE POLICY b17_approved_copies_read ON approved_service_copies FOR SELECT USING (
  b17_platform_scope() OR b17_platform_config()
  OR (b17_work_tenant(client_id) AND b17_setting('current_mode') <> 'employee'));
CREATE POLICY b17_approved_copies_insert ON approved_service_copies FOR INSERT WITH CHECK (
  (b17_work_tenant(client_id) AND b17_setting('current_mode') = 'consultant'
    AND b17_setting('current_user_role') = 'ge_admin'
    AND sealed_by::text = b17_setting('current_actor_id'))
  OR (b17_platform_config() AND b17_setting('target_id') IS NOT NULL
    AND client_id::text = b17_setting('target_id')));

CREATE POLICY b17_approved_copy_files_read ON approved_copy_files FOR SELECT USING (
  EXISTS (SELECT 1 FROM approved_service_copies c WHERE c.id = approved_copy_files.copy_id
    AND (b17_platform_scope() OR b17_platform_config()
      OR (b17_work_tenant(c.client_id) AND b17_setting('current_mode') <> 'employee'))));
-- SHIELD-P1-03: the W-consultant branch is actor-bound through the sealed
-- parent (c.sealed_by = actor), mirroring the sealed_by=actor pin in
-- b17_approved_copies_insert and the uploaded_by=actor pin in
-- b17_attachments_insert: only the sealer extends their own sealed copy.
CREATE POLICY b17_approved_copy_files_insert ON approved_copy_files FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM approved_service_copies c WHERE c.id = approved_copy_files.copy_id
    AND ((b17_work_tenant(c.client_id) AND b17_setting('current_mode') = 'consultant'
      AND b17_setting('current_user_role') = 'ge_admin'
      AND c.sealed_by::text = b17_setting('current_actor_id'))
      OR (b17_platform_config() AND b17_setting('target_id') IS NOT NULL
        AND c.client_id::text = b17_setting('target_id')))));

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
  IF n <> 1 THEN RAISE EXCEPTION 'u42fix.stop: B17_U1 re-pin affected % rows (expected exactly 1)', n; END IF;
  UPDATE app_schema_versions
     SET checksum = '9d08ad5636a99fd7c86d45e6a2ae0239e91df7e428c460c58124c4b2b5261188',
         structure_checksum = '90967166a353283de10488a43c393ac8'
   WHERE version = 'B17_U2D';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'u42fix.stop: B17_U2D re-pin affected % rows (expected exactly 1)', n; END IF;
END $$;
SELECT set_config('app.current_purpose', '', true);

-- 5. Postconditions: exact catalog fingerprint, structural pins, ledger pins.
DO $$
DECLARE
  v_shape text := (SELECT pg_temp.u42fix_shape());
  v_bad text;
  v_mode text := (SELECT mode FROM u42fix_ctl);
BEGIN
  IF v_shape <> '90967166a353283de10488a43c393ac8' THEN
    RAISE EXCEPTION 'u42fix.stop: result fingerprint % does not equal B17_CONTENT_SHAPE', v_shape;
  END IF;

  -- items columns (P1-A): types, nullability, defaults.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='items' AND column_name='version'
                   AND data_type='integer' AND is_nullable='NO' AND column_default='1') THEN
    RAISE EXCEPTION 'u42fix.stop: items.version shape is not INTEGER NOT NULL DEFAULT 1';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='items' AND column_name='status'
                   AND data_type='text' AND is_nullable='NO' AND column_default='''active''::text') THEN
    RAISE EXCEPTION 'u42fix.stop: items.status shape is not TEXT NOT NULL DEFAULT active';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='items' AND column_name='archived_at'
                   AND data_type='timestamp with time zone' AND is_nullable='YES' AND column_default IS NULL) THEN
    RAISE EXCEPTION 'u42fix.stop: items.archived_at shape is not TIMESTAMPTZ NULL / no default';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='items' AND column_name='archive_reason'
                   AND data_type='text' AND is_nullable='YES' AND column_default IS NULL) THEN
    RAISE EXCEPTION 'u42fix.stop: items.archive_reason shape is not TEXT NULL / no default';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='items_status_valid'
                  AND conrelid='public.items'::regclass AND convalidated) THEN
    RAISE EXCEPTION 'u42fix.stop: items_status_valid constraint missing or NOT VALID';
  END IF;

  -- item_versions (P1-B): RESTRICT history, unique pair, append-only (no UW).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='item_versions_item_id_fkey'
                 AND conrelid='public.item_versions'::regclass
                 AND confdeltype='r' AND convalidated) THEN
    RAISE EXCEPTION 'u42fix.stop: item_versions RESTRICT FK missing (hard-delete protection)';
  END IF;

  -- copies (P1-C): NO live FK into the catalog (INV-APPROVED-IMMUNE) — every FK
  -- out of the two copy tables must target only clients or the sealed parent.
  SELECT string_agg(DISTINCT c2.relname, ',' ORDER BY c2.relname) INTO v_bad
    FROM pg_constraint k JOIN pg_class c1 ON c1.oid=k.conrelid
    JOIN pg_class c2 ON c2.oid=k.confrelid
   WHERE k.contype='f' AND c1.relname IN ('approved_service_copies','approved_copy_files')
     AND c2.relname NOT IN ('clients','approved_service_copies');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'u42fix.stop: copy tables reference catalog tables (%) — sealed copies must be self-contained', v_bad;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.approved_service_copies'::regclass
                 AND contype='f' AND confdeltype='c') THEN
    RAISE EXCEPTION 'u42fix.stop: approved_service_copies lost its tenant CASCADE';
  END IF;

  -- indexes (P1 batch).
  FOR v_bad IN SELECT unnest(ARRAY['ix_item_versions_item','ix_approved_service_copies_client','ix_approved_copy_files_copy']) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname=v_bad) THEN
      RAISE EXCEPTION 'u42fix.stop: expected index % missing', v_bad;
    END IF;
  END LOOP;

  -- RLS enabled AND forced on the three new tables.
  SELECT string_agg(relname, ',' ORDER BY relname) INTO v_bad FROM pg_class
   WHERE relname IN ('item_versions','approved_service_copies','approved_copy_files')
     AND NOT (relrowsecurity AND relforcerowsecurity);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'u42fix.stop: RLS not enabled+forced on %', v_bad;
  END IF;

  -- NOTE ON ROW-LEVEL DATA: this runs as the table owner under FORCE RLS, so
  -- business rows are invisible here (policies admit only a 'work' purpose).
  -- The added items columns are NOT NULL DEFAULT, so every pre-existing row
  -- carries the default by construction; the operator verifies row
  -- values/counts from the superuser session (runbook step 4). Do NOT add
  -- RLS-blind "count" checks here: they would silently read 0 and prove
  -- nothing. Zero-loss is proved by the operator's before/after counts plus
  -- the rehearsal evidence (runbook §9).

  -- policies: the six P1 names exactly (no UPDATE/DELETE on versions/copies),
  -- the two P4 branches, the audit policy, and the untouched version gate.
  SELECT string_agg(policyname, ',' ORDER BY policyname) INTO v_bad FROM pg_policies
   WHERE schemaname='public' AND tablename IN ('item_versions','approved_service_copies','approved_copy_files');
  IF v_bad IS DISTINCT FROM 'b17_approved_copies_insert,b17_approved_copies_read,b17_approved_copy_files_insert,b17_approved_copy_files_read,b17_item_versions_insert,b17_item_versions_read' THEN
    RAISE EXCEPTION 'u42fix.stop: P1 policy set is [%] (expected the six SHIELD names, append-only)', coalesce(v_bad, 'none');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='answers'
                 AND policyname='b17_answers_reopen_update' AND cmd='UPDATE') THEN
    RAISE EXCEPTION 'u42fix.stop: b17_answers_reopen_update (P4) missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='evidence_attachments'
                 AND policyname='b17_attachments_seal_read' AND cmd='SELECT') THEN
    RAISE EXCEPTION 'u42fix.stop: b17_attachments_seal_read (P4) missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='audit_log'
                 AND policyname='b17_audit_insert') THEN
    RAISE EXCEPTION 'u42fix.stop: b17_audit_insert missing after whitelist delta';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND policyname='b17_version_repin') THEN
    RAISE EXCEPTION 'u42fix.stop: temporary repin policy was left behind (none should ever be created here)';
  END IF;

  -- ledger
  IF (SELECT count(*)::int FROM app_schema_versions) <> 2 THEN
    RAISE EXCEPTION 'u42fix.stop: ledger row count is not exactly 2 after re-pin';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app_schema_versions WHERE version='B17_U1'
                 AND checksum='ace11265d876b6f18229dd62efa1db693cd8df00ecd0ea6012b448694406d8d6'
                 AND structure_checksum='e1bb70b605f9a59be49cf1c25a396c0a') THEN
    RAISE EXCEPTION 'u42fix.stop: B17_U1 ledger row is not re-pinned to B17_SHAPE';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app_schema_versions WHERE version='B17_U2D'
                 AND checksum='9d08ad5636a99fd7c86d45e6a2ae0239e91df7e428c460c58124c4b2b5261188'
                 AND structure_checksum='90967166a353283de10488a43c393ac8') THEN
    RAISE EXCEPTION 'u42fix.stop: B17_U2D ledger row is not re-pinned to the current content sha256 + B17_CONTENT_SHAPE';
  END IF;

  RAISE NOTICE 'u42fix.migrate: OK mode=% shape=% ledger=B17_U1/B17_U2D re-pinned', v_mode, v_shape;
END $$;

DROP TABLE u42fix_ctl;

COMMIT;

\endif
