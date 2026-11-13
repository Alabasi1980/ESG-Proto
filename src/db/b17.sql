-- B17_U1: explicit offline delta; the pg-based offline caller owns BEGIN/COMMIT,
-- catalog predecessor verification, postcondition verification and ledger-last INSERT.
-- No content associations, subscriptions, scores or existing business rows are changed.
SELECT pg_advisory_xact_lock(1717001);
DO $$ BEGIN
  IF coalesce(current_setting('app.b17_checksum',true),'') !~ '^[0-9a-f]{64}$'
    OR to_regclass('public.app_schema_versions') IS NOT NULL
    OR to_regclass('public.auth_sessions') IS NOT NULL
    OR to_regclass('public.workspace_tabs') IS NOT NULL
  THEN RAISE EXCEPTION 'b17.offline_preconditions'; END IF;
END $$;

CREATE TABLE app_schema_versions (
  version text PRIMARY KEY, checksum text NOT NULL CHECK(checksum ~ '^[0-9a-f]{64}$'),
  structure_checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth_sessions (
  sid uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  revoked_at timestamptz, UNIQUE(sid,user_id), CHECK(expires_at>created_at)
);
CREATE INDEX b17_sessions_user_expiry ON auth_sessions(user_id,expires_at);
CREATE TABLE workspace_tabs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), handle_hash text UNIQUE NOT NULL CHECK(handle_hash ~ '^[0-9a-f]{64}$'),
  session_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES users(id),
  FOREIGN KEY(session_id,user_id) REFERENCES auth_sessions(sid,user_id),
  mode text NOT NULL DEFAULT 'platform', client_id uuid REFERENCES clients(id),
  generation integer NOT NULL DEFAULT 1 CHECK(generation>0),
  created_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL, revoked_at timestamptz,
  CHECK((mode='platform' AND client_id IS NULL) OR (mode='consultant' AND client_id IS NOT NULL)),
  CHECK(expires_at>created_at)
);
CREATE INDEX b17_tabs_session_expiry ON workspace_tabs(session_id,expires_at);

CREATE FUNCTION b17_setting(key text) RETURNS text LANGUAGE sql STABLE
  SET search_path=pg_catalog,public AS $$ SELECT nullif(current_setting('app.'||key,true),'') $$;
CREATE FUNCTION b17_work_tenant(tenant uuid) RETURNS boolean LANGUAGE sql STABLE
  SET search_path=pg_catalog,public AS $$ SELECT
    b17_setting('current_actor_id') IS NOT NULL AND b17_setting('current_purpose')='work'
    AND tenant::text=b17_setting('current_tenant_id') AND (
      (b17_setting('current_mode')='consultant' AND b17_setting('current_user_role')='ge_admin') OR
      (b17_setting('current_mode')='client' AND b17_setting('current_user_role')='client_admin') OR
      (b17_setting('current_mode')='employee' AND b17_setting('current_user_role')='employee'
        AND b17_setting('current_user_department_id') IS NOT NULL)) $$;
CREATE FUNCTION b17_auth_scope(tenant uuid) RETURNS boolean LANGUAGE sql STABLE
  SET search_path=pg_catalog,public AS $$ SELECT
    b17_setting('current_actor_id') IS NOT NULL AND tenant::text=b17_setting('current_tenant_id')
    AND b17_setting('current_purpose') IN ('auth.login','auth.session','auth.password','auth.logout') $$;

-- Replace ALL predecessor permissive policies, never OR-combine the new boundary with GE bypasses.
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT tablename,policyname FROM pg_policies WHERE schemaname='public' LOOP
    EXECUTE format('DROP POLICY %I ON public.%I',r.policyname,r.tablename);
  END LOOP;
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',r.tablename);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',r.tablename);
  END LOOP;
END $$;

CREATE POLICY b17_version_read ON app_schema_versions FOR SELECT USING(true);
CREATE POLICY b17_version_write ON app_schema_versions FOR INSERT WITH CHECK(b17_setting('current_purpose')='migration');
CREATE POLICY b17_sessions_read ON auth_sessions FOR SELECT USING (
  user_id::text=b17_setting('current_actor_id') AND (
    (sid::text=b17_setting('current_session_id') AND b17_setting('current_purpose') IN ('auth.session','auth.logout','auth.password','workspace'))
    OR b17_setting('current_purpose')='auth.revoke'));
CREATE POLICY b17_sessions_insert ON auth_sessions FOR INSERT WITH CHECK (
  user_id::text=b17_setting('current_actor_id') AND b17_setting('current_purpose') IN ('auth.login','auth.bootstrap'));
CREATE POLICY b17_sessions_update ON auth_sessions FOR UPDATE USING (
  user_id::text=b17_setting('current_actor_id') AND (b17_setting('current_purpose')='auth.revoke'
    OR (sid::text=b17_setting('current_session_id') AND b17_setting('current_purpose') IN ('auth.logout','auth.password','auth.session'))))
  WITH CHECK(user_id::text=b17_setting('current_actor_id'));
CREATE POLICY b17_tabs ON workspace_tabs FOR ALL USING (
  user_id::text=b17_setting('current_actor_id') AND (
    b17_setting('current_purpose')='auth.revoke' OR
    (session_id::text=b17_setting('current_session_id') AND b17_setting('current_purpose') IN ('workspace','auth.logout'))))
  WITH CHECK(user_id::text=b17_setting('current_actor_id') AND (
    b17_setting('current_purpose')='auth.revoke' OR
    (session_id::text=b17_setting('current_session_id') AND b17_setting('current_purpose') IN ('workspace','auth.logout'))));

CREATE POLICY b17_users_read ON users FOR SELECT USING (
  (b17_setting('current_purpose')='auth.login' AND
    (lower(email)=b17_setting('login_email') OR id::text=b17_setting('current_actor_id')))
  OR (b17_setting('current_purpose') IN ('auth.session','auth.password','auth.logout') AND id::text=b17_setting('current_actor_id'))
  OR b17_setting('current_purpose') IN ('auth.setup','auth.bootstrap'));
-- SELECT ... FOR SHARE also needs an UPDATE policy under FORCE RLS.
CREATE POLICY b17_users_lock ON users FOR UPDATE USING (
  (b17_setting('current_purpose')='auth.login' AND lower(email)=b17_setting('login_email'))
  OR (b17_setting('current_purpose') IN ('auth.session','auth.password') AND id::text=b17_setting('current_actor_id')))
  WITH CHECK(b17_setting('current_purpose')='auth.password' AND id::text=b17_setting('current_actor_id'));
CREATE POLICY b17_bootstrap ON users FOR INSERT WITH CHECK (
  b17_setting('current_purpose')='auth.bootstrap' AND department_id IS NULL AND (
    (role='ge_admin' AND client_id IS NULL) OR (role='client_admin' AND client_id::text=b17_setting('target_id'))));
CREATE POLICY b17_bootstrap_client ON clients FOR INSERT WITH CHECK (
  b17_setting('current_purpose')='auth.bootstrap' AND id::text=b17_setting('target_id'));
CREATE POLICY b17_clients_read ON clients FOR SELECT USING (
  b17_work_tenant(id) OR b17_auth_scope(id) OR (
    b17_setting('current_purpose')='workspace' AND b17_setting('current_user_role')='ge_admin'
    AND b17_setting('current_actor_id') IS NOT NULL
    AND (id::text=b17_setting('target_id') OR id::text=b17_setting('current_tenant_id'))));
CREATE POLICY b17_clients_lock ON clients FOR UPDATE USING (
  b17_auth_scope(id) OR (b17_setting('current_purpose')='workspace' AND
    b17_setting('current_user_role')='ge_admin' AND id::text=b17_setting('target_id')))
  WITH CHECK(false);
CREATE POLICY b17_departments_read ON departments FOR SELECT USING (
  (b17_work_tenant(client_id) AND (b17_setting('current_mode')<>'employee' OR id::text=b17_setting('current_user_department_id')))
  OR (b17_auth_scope(client_id) AND id::text=b17_setting('current_user_department_id')));
CREATE POLICY b17_departments_lock ON departments FOR UPDATE USING (
  b17_auth_scope(client_id) AND id::text=b17_setting('current_user_department_id')) WITH CHECK(false);

-- Only tenant-bounded substrate reads. U2 must refine linked-service/parent predicates
-- and explicitly add write policies before any business operation can be activated.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['client_services','profile_assessments','report_settings','client_initiatives',
    'esg_profile','review_snapshots','snapshot_notes','staff_lists'] LOOP
    EXECUTE format('CREATE POLICY b17_scope ON public.%I FOR SELECT USING
      (b17_work_tenant(client_id) AND b17_setting(''current_mode'')<>''employee'')',t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['assignments','answers'] LOOP
    EXECUTE format('CREATE POLICY b17_scope ON public.%I FOR SELECT USING
      (b17_work_tenant(client_id) AND (b17_setting(''current_mode'')<>''employee''
      OR department_id::text=b17_setting(''current_user_department_id'')))',t);
  END LOOP;
END $$;
CREATE POLICY b17_evaluations ON evaluations FOR SELECT USING (
  b17_work_tenant(client_id) AND b17_setting('current_mode')<>'employee');
CREATE POLICY b17_approvals ON approvals FOR SELECT USING (
  b17_work_tenant(client_id) AND EXISTS(SELECT 1 FROM answers a WHERE a.id=answer_id));
CREATE POLICY b17_attachments ON evidence_attachments FOR SELECT USING (
  EXISTS(SELECT 1 FROM answers a WHERE a.id=answer_id AND b17_work_tenant(a.client_id)));
CREATE POLICY b17_staff_rows ON staff_list_rows FOR SELECT USING (
  EXISTS(SELECT 1 FROM staff_lists s WHERE s.id=list_id AND b17_work_tenant(s.client_id)));
CREATE POLICY b17_actions ON actions FOR SELECT USING (
  b17_work_tenant(client_id) AND b17_setting('current_mode')<>'employee');
CREATE POLICY b17_notifications ON notifications FOR SELECT USING (
  b17_work_tenant(client_id) AND b17_setting('current_mode')<>'employee' AND user_id::text=b17_setting('current_actor_id'));
CREATE POLICY b17_audit_read ON audit_log FOR SELECT USING (
  b17_work_tenant(client_id) AND b17_setting('current_mode')='consultant');
CREATE POLICY b17_audit_insert ON audit_log FOR INSERT WITH CHECK (
  user_id::text=b17_setting('current_actor_id') AND (
    (b17_setting('current_purpose') IN ('auth.login','auth.password','auth.bootstrap')
      AND client_id::text IS NOT DISTINCT FROM b17_setting('current_tenant_id')
      AND action IN ('USER_LOGIN','PASSWORD_CHANGED','BOOTSTRAP_INITIAL_ADMIN') AND entity_type='users' AND entity_id=user_id)
    OR (b17_setting('current_purpose')='workspace' AND b17_setting('current_user_role')='ge_admin'
      AND client_id::text=b17_setting('current_tenant_id') AND entity_type='workspace_tabs'
      AND entity_id::text=b17_setting('current_tab_id') AND action IN ('WORKSPACE_ENTER','WORKSPACE_EXIT'))));

-- Deactivation revokes persisted authority atomically. Concurrent requests either finish
-- before its session locks or fail/retry; a deadlock abort cannot acknowledge deactivation.
CREATE FUNCTION b17_revoke_inactive() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE old_actor text; old_purpose text;
BEGIN
  IF OLD.is_active AND NOT NEW.is_active THEN
    old_actor:=current_setting('app.current_actor_id',true);
    old_purpose:=current_setting('app.current_purpose',true);
    PERFORM set_config('app.current_actor_id',NEW.id::text,true);
    PERFORM set_config('app.current_purpose','auth.revoke',true);
    PERFORM sid FROM auth_sessions WHERE user_id=NEW.id ORDER BY sid FOR UPDATE;
    UPDATE auth_sessions SET revoked_at=clock_timestamp() WHERE user_id=NEW.id AND revoked_at IS NULL;
    UPDATE workspace_tabs SET revoked_at=clock_timestamp() WHERE user_id=NEW.id AND revoked_at IS NULL;
    PERFORM set_config('app.current_actor_id',coalesce(old_actor,''),true);
    PERFORM set_config('app.current_purpose',coalesce(old_purpose,''),true);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER b17_user_deactivation AFTER UPDATE OF is_active ON users FOR EACH ROW EXECUTE FUNCTION b17_revoke_inactive();
