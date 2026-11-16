-- B17_U2D. Offline caller owns lock, inventory revalidation, transaction and ledger-last.
-- No subscriptions, assessments, initiative associations or action backfills are created.
DO $$ BEGIN
  IF coalesce(current_setting('app.current_purpose',true),'') <> 'migration.inventory'
    OR NOT EXISTS(SELECT 1 FROM app_schema_versions WHERE version='B17_U1')
    OR EXISTS(SELECT 1 FROM app_schema_versions WHERE version='B17_U2D')
  THEN RAISE EXCEPTION 'b17.content_offline_only'; END IF;
END $$;

CREATE TABLE service_initiatives (
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  initiative_id uuid NOT NULL REFERENCES initiatives_library(id) ON DELETE CASCADE,
  PRIMARY KEY(service_id,initiative_id)
);
ALTER TABLE service_initiatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_initiatives FORCE ROW LEVEL SECURITY;
ALTER TABLE esg_profile ADD COLUMN service_id uuid REFERENCES services(id);
ALTER TABLE actions ADD COLUMN service_id uuid REFERENCES services(id);
-- Legacy unidentified standalone actions remain stored/unavailable; new writes
-- must supply an entitlement. NOT VALID avoids rewriting/deleting old rows.
ALTER TABLE actions ADD CONSTRAINT b17_standalone_service_required
  CHECK(item_id IS NOT NULL OR service_id IS NOT NULL) NOT VALID;

-- Internal boolean facts do not bypass FORCE RLS. Their fixed, non-user-selectable
-- purpose admits necessary rows only within this tenant; no raw foreign values escape.
CREATE FUNCTION b17_bound_tenant(t uuid) RETURNS boolean LANGUAGE sql STABLE
  SET search_path=pg_catalog,public,pg_temp AS $$ SELECT
  t::text=b17_setting('current_tenant_id') AND b17_setting('current_actor_id') IS NOT NULL AND (
    (b17_setting('current_mode')='consultant' AND b17_setting('current_user_role')='ge_admin') OR
    (b17_setting('current_mode')='client' AND b17_setting('current_user_role')='client_admin') OR
    (b17_setting('current_mode')='employee' AND b17_setting('current_user_role')='employee'
      AND b17_setting('current_user_department_id') IS NOT NULL) OR
    -- U2-C1 (task §23 D2): the ONE platform-configuration branch. Server-set only:
    -- purpose 'platform.config' with target_id = tenant = T, or the same call
    -- re-entered from inside a sanctioned fact under 'scope.internal' (the fact
    -- swaps purpose after the guard, so both names are admitted HERE only).
    -- Tenant-data scope still requires current_tenant_id = target_id = t, so a
    -- tenant-NULL summary context and any foreign T stay denied here.
    -- W/C/E mode branches above are untouched.
    (b17_setting('current_purpose') IN ('platform.config','scope.internal')
      AND b17_setting('current_user_role')='ge_admin'
      AND t::text=b17_setting('target_id'))) $$;

CREATE FUNCTION b17_content_fact(kind text,t uuid,r uuid,x uuid DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE old_purpose text; allowed boolean;
BEGIN
  IF NOT coalesce(b17_bound_tenant(t),false) THEN RETURN false; END IF;
  old_purpose:=current_setting('app.current_purpose',true);
  PERFORM set_config('app.current_purpose','scope.internal',true);
  CASE kind
  WHEN 'service' THEN allowed:=EXISTS(SELECT 1 FROM client_services c WHERE c.client_id=t AND c.service_id=r);
  WHEN 'department' THEN allowed:=EXISTS(SELECT 1 FROM departments d WHERE d.client_id=t AND d.id=r);
  WHEN 'linked' THEN allowed:=EXISTS(
    SELECT 1 FROM items i JOIN disclosures d ON d.id=i.disclosure_id
    JOIN service_standards s ON s.standard_id=d.standard_id
    JOIN client_services c ON c.service_id=s.service_id AND c.client_id=t
    WHERE i.id=r AND (x IS NULL OR c.service_id=x));
  WHEN 'assigned' THEN allowed:=EXISTS(SELECT 1 FROM assignments a JOIN departments d ON d.id=a.department_id
    WHERE a.client_id=t AND d.client_id=t AND a.item_id=r
      AND a.department_id::text=b17_setting('current_user_department_id'));
  -- r is the evaluation ID, NOT the evaluator. Department ownership is proved
  -- ONLY from the retained pair: exactly one answer for this item in the
  -- reader's own department, authored by this evaluation's evaluator, plus a
  -- retained assignment for that same department. A parallel/legacy second
  -- department answer, a missing answer row or a foreign signature denies.
  -- Version, timestamp and correction-history state record ordinary edits, not
  -- department ambiguity; the evaluator's current staff placement is not
  -- provenance for retained historical rows.
  WHEN 'evaluation' THEN allowed:=EXISTS(
    SELECT 1 FROM evaluations e JOIN answers a ON a.client_id=e.client_id AND a.item_id=e.item_id
    WHERE e.client_id=t AND e.id=r AND a.department_id::text=b17_setting('current_user_department_id')
      AND a.submitted_by=e.evaluator_id
      AND (SELECT count(*) FROM answers other WHERE other.client_id=t AND other.item_id=e.item_id)=1
      AND EXISTS(SELECT 1 FROM assignments s WHERE s.client_id=t AND s.item_id=e.item_id
        AND s.department_id=a.department_id));
  -- linked + assigned gates, foreign-answer denial, and provenance/signature
  -- denial via the evaluation fact. A second department's assignment alone,
  -- with no answer from it, does not deny the answering department's work.
  WHEN 'writable' THEN allowed:=
    b17_content_fact('linked',t,r) AND b17_content_fact('assigned',t,r)
    AND NOT EXISTS(SELECT 1 FROM answers a WHERE a.client_id=t AND a.item_id=r
      AND a.department_id::text<>b17_setting('current_user_department_id'))
    AND NOT EXISTS(SELECT 1 FROM evaluations e WHERE e.client_id=t AND e.item_id=r
      AND NOT b17_content_fact('evaluation',t,e.id));
  WHEN 'initiative' THEN allowed:=EXISTS(SELECT 1 FROM service_initiatives s
    JOIN client_services c ON c.service_id=s.service_id WHERE c.client_id=t AND s.initiative_id=r
    AND (x IS NULL OR c.service_id=x));
  WHEN 'selected' THEN allowed:=EXISTS(SELECT 1 FROM client_initiatives c WHERE c.client_id=t AND c.initiative_id=r);
  WHEN 'frozen' THEN allowed:=EXISTS(SELECT 1 FROM review_snapshots s WHERE s.client_id=t
    AND (s.scope_type='tenant' OR (s.scope_type='disclosure'
      AND EXISTS(SELECT 1 FROM items i WHERE i.id=r AND i.disclosure_id::text=s.scope_ref))));
  WHEN 'gap' THEN allowed:=EXISTS(SELECT 1 FROM client_services c JOIN service_standards s ON s.service_id=c.service_id
    JOIN disclosures d ON d.standard_id=s.standard_id JOIN items i ON i.disclosure_id=d.id
    WHERE c.client_id=t AND i.id=r AND c.show_gap AND (x IS NULL OR c.service_id=x));
  WHEN 'corrective' THEN allowed:=EXISTS(SELECT 1 FROM client_services c WHERE c.client_id=t AND c.show_corrective
    AND (x IS NULL OR c.service_id=x) AND (r IS NULL OR b17_content_fact('linked',t,r,c.service_id)));
  WHEN 'parent.standard','parent.disclosure','parent.service' THEN allowed:=EXISTS(
    SELECT 1 FROM items i JOIN disclosures d ON d.id=i.disclosure_id
    WHERE (CASE kind WHEN 'parent.standard' THEN d.standard_id=r
      WHEN 'parent.disclosure' THEN d.id=r ELSE true END)
      AND b17_content_fact('linked',t,i.id,CASE WHEN kind='parent.service' THEN r ELSE NULL END)
      AND (b17_setting('current_mode')<>'employee' OR b17_content_fact('assigned',t,i.id)));
  ELSE allowed:=false;
  END CASE;
  PERFORM set_config('app.current_purpose',coalesce(old_purpose,''),true);
  RETURN allowed;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('app.current_purpose',coalesce(old_purpose,''),true);
  RAISE;
END $$;
-- Same transaction as creation: no PUBLIC oracle window. The existing app/table
-- owner is the sole trusted SQL caller; no new runtime/business role is created.
REVOKE ALL ON FUNCTION b17_content_fact(text,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION b17_content_fact(text,uuid,uuid,uuid) TO CURRENT_USER;

-- Separate fixed internal policies prevent catalog/assignment policy recursion.
-- They expose no API: only the boolean function above selects this purpose.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['services','standards','disclosures','items','service_standards','service_initiatives'] LOOP
    EXECUTE format('CREATE POLICY b17_internal_read ON public.%I FOR SELECT USING
      (b17_setting(''current_purpose'')=''scope.internal'' AND
       b17_bound_tenant(nullif(b17_setting(''current_tenant_id''),'''')::uuid))',t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['client_services','departments','assignments','answers','evaluations','users','client_initiatives','review_snapshots'] LOOP
    EXECUTE format('CREATE POLICY b17_internal_read ON public.%I FOR SELECT USING
      (b17_setting(''current_purpose'')=''scope.internal'' AND b17_bound_tenant(client_id))',t);
  END LOOP;
END $$;

-- Freeze triggers retain their original boolean semantics without granting raw
-- snapshot blobs. Offline inventory retains the original exact-target query path.
CREATE OR REPLACE FUNCTION is_scope_frozen(p_client_id uuid,p_item_id uuid DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE v_disclosure_id uuid;
BEGIN
  IF b17_setting('current_purpose') IN ('work','scope.internal','platform.config') THEN
    RETURN b17_content_fact('frozen',p_client_id,p_item_id);
  END IF;
  IF EXISTS(SELECT 1 FROM review_snapshots WHERE client_id=p_client_id AND scope_type='tenant') THEN RETURN true; END IF;
  IF p_item_id IS NOT NULL THEN
    SELECT disclosure_id INTO v_disclosure_id FROM items WHERE id=p_item_id;
    IF v_disclosure_id IS NOT NULL AND EXISTS(SELECT 1 FROM review_snapshots
      WHERE client_id=p_client_id AND scope_type='disclosure' AND scope_ref=v_disclosure_id::text) THEN RETURN true; END IF;
  END IF;
  RETURN false;
END $$;

CREATE FUNCTION b17_item_visible(t uuid,i uuid,s uuid DEFAULT NULL) RETURNS boolean LANGUAGE sql STABLE
  SET search_path=pg_catalog,public,pg_temp AS $$ SELECT CASE WHEN b17_work_tenant(t) THEN
    b17_content_fact('linked',t,i,s) AND (b17_setting('current_mode')<>'employee'
      OR b17_content_fact('assigned',t,i)) ELSE false END $$;
CREATE FUNCTION b17_parent_visible(kind text,r uuid) RETURNS boolean LANGUAGE sql STABLE
  SET search_path=pg_catalog,public,pg_temp AS $$ SELECT CASE
    WHEN b17_work_tenant(nullif(b17_setting('current_tenant_id'),'')::uuid)
    THEN b17_content_fact('parent.'||kind,nullif(b17_setting('current_tenant_id'),'')::uuid,r)
    ELSE false END $$;

-- U2-C1: the six global-catalog SELECT policies that used to sit here moved to
-- the end of this file so they can admit the two P contexts defined above
-- (b17_platform_scope / b17_platform_config) — a CREATE POLICY expression may
-- only reference functions that already exist.

DROP POLICY b17_scope ON client_services;
CREATE POLICY b17_scope ON client_services FOR SELECT USING(CASE WHEN b17_work_tenant(client_id) THEN
  b17_setting('current_mode')<>'employee' OR b17_content_fact('parent.service',client_id,service_id) ELSE false END);
DROP POLICY b17_scope ON assignments;
CREATE POLICY b17_scope ON assignments FOR SELECT USING(CASE WHEN b17_work_tenant(client_id) THEN
  b17_item_visible(client_id,item_id) AND b17_content_fact('department',client_id,department_id)
  AND (b17_setting('current_mode')<>'employee' OR department_id::text=b17_setting('current_user_department_id')) ELSE false END);
DROP POLICY b17_scope ON answers;
CREATE POLICY b17_scope ON answers FOR SELECT USING(CASE WHEN b17_work_tenant(client_id) THEN
  b17_item_visible(client_id,item_id) AND b17_content_fact('department',client_id,department_id)
  AND (b17_setting('current_mode')<>'employee' OR department_id::text=b17_setting('current_user_department_id')) ELSE false END);
DROP POLICY b17_evaluations ON evaluations;
-- CASE is the recursion barrier: internal evaluation/answer ownership queries
-- must not re-enter this fact via a reordered SQL AND/OR policy expression.
CREATE POLICY b17_evaluations ON evaluations FOR SELECT USING(CASE WHEN b17_work_tenant(client_id) THEN
  b17_item_visible(client_id,item_id)
  AND (b17_setting('current_mode')<>'employee' OR b17_content_fact('evaluation',client_id,id))
  AND (b17_setting('current_mode')<>'client' OR b17_content_fact('gap',client_id,item_id)) ELSE false END);
-- Existing approval/attachment policies inherit the now-scoped answer parent.

DROP POLICY b17_scope ON client_initiatives;
CREATE POLICY b17_scope ON client_initiatives FOR SELECT USING(b17_work_tenant(client_id)
  AND b17_setting('current_mode')<>'employee' AND b17_content_fact('initiative',client_id,initiative_id));
CREATE POLICY b17_library ON initiatives_library FOR SELECT USING(CASE
  WHEN b17_work_tenant(nullif(b17_setting('current_tenant_id'),'')::uuid)
    AND b17_setting('current_mode')<>'employee' THEN
    b17_content_fact('initiative',nullif(b17_setting('current_tenant_id'),'')::uuid,id)
    AND (b17_setting('current_mode')='consultant'
      OR b17_content_fact('selected',nullif(b17_setting('current_tenant_id'),'')::uuid,id)) ELSE false END);
CREATE POLICY b17_mappings ON service_initiatives FOR SELECT USING(CASE
  WHEN b17_work_tenant(nullif(b17_setting('current_tenant_id'),'')::uuid)
    AND b17_setting('current_mode')<>'employee' THEN
    b17_content_fact('service',nullif(b17_setting('current_tenant_id'),'')::uuid,service_id)
    AND (b17_setting('current_mode')='consultant'
      OR b17_content_fact('selected',nullif(b17_setting('current_tenant_id'),'')::uuid,initiative_id)) ELSE false END);

DROP POLICY b17_scope ON esg_profile;
CREATE POLICY b17_scope ON esg_profile FOR SELECT USING(b17_work_tenant(client_id)
  AND b17_setting('current_mode')<>'employee' AND service_id IS NOT NULL
  AND b17_content_fact('service',client_id,service_id));
DROP POLICY b17_scope ON report_settings;
CREATE POLICY b17_scope ON report_settings FOR SELECT USING(b17_work_tenant(client_id)
  AND b17_setting('current_mode')<>'employee' AND service_id IS NOT NULL
  AND b17_content_fact('service',client_id,service_id));
DROP POLICY b17_actions ON actions;
CREATE POLICY b17_actions ON actions FOR SELECT USING(b17_work_tenant(client_id)
  AND b17_setting('current_mode')<>'employee' AND b17_content_fact('department',client_id,owner_department_id)
  AND (CASE WHEN item_id IS NULL THEN service_id IS NOT NULL AND b17_content_fact('service',client_id,service_id)
    ELSE b17_item_visible(client_id,item_id,service_id) END)
  AND (b17_setting('current_mode')<>'client' OR b17_content_fact('corrective',client_id,item_id,service_id)));

-- No safe service ownership/full-snapshot preflight exists for these legacy blobs yet.
-- Keep them unavailable, rather than retain U1 tenant-wide blob access during U2D.
DROP POLICY b17_scope ON profile_assessments;
DROP POLICY b17_scope ON review_snapshots;
DROP POLICY b17_scope ON snapshot_notes;

-- ===========================================================================
-- B17 U2-E E-1 — review-snapshot READ substrate (task §4.1 pre-authorized;
-- delta name for Shield: SHIELD-U2E-E1 snapshot SELECT policies).
--
-- The two DROPs above left review_snapshots/snapshot_notes with NO SELECT
-- policy, so no §3.3 snapshot read could ever return a row. This restores ONLY
-- the W (consultant + ge_admin, own tenant) SELECT side the two read
-- declarations need: GET /reviews/snapshots and GET /reviews/snapshots/:id.
-- C/E/P are refused (they have no §3 row), the 'scope.internal' branch above
-- keeps serving the is_scope_frozen/b17_content_fact('frozen') checks, and the
-- handler-side ENTIRE-payload-linked gate still withholds a mixed/inaccessible
-- blob (403 scope.not_visible) or drops it from the list (metadata only).
-- NO write policy: the notes INSERT and the ge-final snapshot INSERT stay
-- E-2 substrate. profile_assessments stays unavailable on purpose.
-- ===========================================================================
CREATE POLICY b17_scope ON review_snapshots FOR SELECT USING
  (b17_work_tenant(client_id) AND b17_setting('current_mode')='consultant');
CREATE POLICY b17_scope ON snapshot_notes FOR SELECT USING
  (b17_work_tenant(client_id) AND b17_setting('current_mode')='consultant');

-- ---------------------------------------------------------------------------
-- B17 U2-B0 — four-domain §3 policy substrate: notifications, evidence
-- attachments, actions, audit_log. ROW SCOPE ONLY. WF-04 transition/reason
-- rules, the 50-row notification inbox cap, the 5 MB/mime upload checks and
-- the append-only/freeze triggers stay in the handler/trigger layer and are
-- neither duplicated nor weakened here. No handler, registry activation or
-- capability change: every business route stays UNACTIVATED.
-- ---------------------------------------------------------------------------

-- A GE tab bound to platform mode with NO tenant. Accepts both the request
-- level workspace bind (purpose 'workspace') and the scoped work bind
-- (purpose 'work'); no W/C/E context can satisfy it, because mode and tenant
-- must both agree. Invoker-only: it reads session GUCs and no table.
CREATE FUNCTION b17_platform_scope() RETURNS boolean LANGUAGE sql STABLE
  SET search_path=pg_catalog,public,pg_temp AS $$ SELECT
    b17_setting('current_purpose') IN ('workspace','work')
    AND b17_setting('current_mode')='platform'
    AND b17_setting('current_user_role')='ge_admin'
    AND b17_setting('current_actor_id') IS NOT NULL
    AND b17_setting('current_tenant_id') IS NULL $$;

-- U2-C1 (task §23 D2): the platform CONFIGURATION identity, deliberately kept
-- SEPARATE from b17_platform_scope above: this one requires purpose
-- 'platform.config' (server-selected only) plus a GE actor, while
-- b17_platform_scope keeps requiring purpose work + tenant-NULL. The two never
-- merge; policies that must admit configuration traffic list this predicate
-- alongside their own scoping (target match / catalog global). Invoker-only,
-- no table access, no privileged helper: it reads session GUCs only.
CREATE FUNCTION b17_platform_config() RETURNS boolean LANGUAGE sql STABLE
  SET search_path=pg_catalog,public,pg_temp AS $$ SELECT
  b17_setting('current_purpose')='platform.config'
  AND b17_setting('current_actor_id') IS NOT NULL
  AND b17_setting('current_user_role')='ge_admin' $$;

-- notifications: own inbox rows only, chosen by the caller's mode (§3.6).
-- P sees its own platform rows (client_id IS NULL); W/C see only their own
-- tenant's rows; E sees nothing. U2D dropped the U1 policy without ever
-- recreating it, so this restores it complete rather than narrow.
-- Round-3 trim clause (§19(1)): a DELETE that carries a WHERE clause also has
-- the SELECT policy enforced on it (observed on PG18), so the cap-trim — which
-- targets the RECIPIENT's rows while the actor is the notifying user — would
-- otherwise match nothing. The insert trigger below marks the inbox currently
-- being notified in this transaction (app.notify_trim_target, transaction-local,
-- server-set only); that single branch makes exactly those rows trimmable. The
-- inbox reads keep their own-row identity check, and the scope half is unchanged.
DROP POLICY b17_notifications ON notifications;
-- SHIELD-U2F-01 (task §3(1)): the P@T fan-out/trim branches. A platform
-- configuration transaction (server-set purpose 'platform.config' + explicit
-- target T) may mark/trim exactly the inbox rows the notify INSERT trigger
-- flagged inside that same transaction, and only inside T; the actor-identity
-- row filter and every other scope branch above are unchanged, and no read
-- endpoint ever runs under this purpose (only admin config handlers do).
CREATE POLICY b17_notifications ON notifications FOR SELECT USING
  ((user_id::text=b17_setting('current_actor_id')
    OR (b17_setting('current_purpose') IN ('work','platform.config')
      AND user_id::text=b17_setting('notify_trim_target')))
   AND (
    (b17_platform_scope() AND client_id IS NULL)
    OR (b17_work_tenant(client_id) AND b17_setting('current_mode')<>'employee')
    OR (b17_platform_config() AND b17_setting('target_id') IS NOT NULL
      AND client_id::text=b17_setting('target_id'))));
-- read / read-all may mark ONLY the rows the same scope already admits, and
-- may not move a row out of that scope (user_id / client_id are immutable here).
CREATE POLICY b17_notifications_update ON notifications FOR UPDATE USING
  (user_id::text=b17_setting('current_actor_id') AND (
    (b17_platform_scope() AND client_id IS NULL)
    OR (b17_work_tenant(client_id) AND b17_setting('current_mode')<>'employee')))
  WITH CHECK
  (user_id::text=b17_setting('current_actor_id') AND (
    (b17_platform_scope() AND client_id IS NULL)
    OR (b17_work_tenant(client_id) AND b17_setting('current_mode')<>'employee')));
-- U2-B round 3 / SHIELD-B17B0-01 (task §19(1), §20 D1): server-side notify
-- context ONLY. notifyUsers fans out inside a bound work transaction, so a row
-- is admitted only when its tenant is the caller's own work tenant AND the
-- recipient is a member of that very tenant: cross-tenant and cross-user
-- recipients are refused. Platform fan-out has no caller until U2-F and is
-- deliberately not admitted here. The 50-row cap TRIM deletes only rows of
-- recipients inside that same tenant scope — own inbox rows only, never
-- platform rows, never another tenant's rows. WF-04, the cap limit itself and
-- recipient resolution stay handler-owned (neither duplicated nor weakened).
-- SHIELD-U2F-01 (task §3(1)): the U2-B0 "platform fan-out has no caller until
-- U2-F" branch — a P@T configuration transaction (assignment create, staff
-- reject) fans out to recipients of EXPLICIT TARGET T only. Same membership
-- check as the work branch; the trim DELETE/SELECT above carry the twin.
CREATE POLICY b17_notifications_insert ON notifications FOR INSERT WITH CHECK (
  (b17_work_tenant(client_id)
    AND EXISTS(SELECT 1 FROM users u WHERE u.id=user_id AND u.client_id=client_id))
  OR (b17_platform_config() AND b17_setting('target_id') IS NOT NULL
    AND client_id::text=b17_setting('target_id')
    AND EXISTS(SELECT 1 FROM users u WHERE u.id=user_id AND u.client_id=client_id)));
-- Cap-trim DELETE (SHIELD-U2B3-01, task §23 item 5): the policy now carries
-- the recipient-row identity itself — the actor's own rows, or the exact inbox
-- this transaction's INSERT trigger marked (notify_trim_target) — instead of
-- relying only on the sibling SELECT policy being re-evaluated for a
-- WHERE-qualified DELETE. Whole-table and qualified DELETEs are therefore both
-- identity-bound; membership and own-tenant scope are unchanged.
CREATE POLICY b17_notifications_delete ON notifications FOR DELETE USING (
  (user_id::text=b17_setting('current_actor_id')
    OR (b17_setting('current_purpose') IN ('work','platform.config')
      AND user_id::text=b17_setting('notify_trim_target')))
  AND (b17_work_tenant(client_id)
    OR (b17_platform_config() AND b17_setting('target_id') IS NOT NULL
      AND client_id::text=b17_setting('target_id')))
  AND EXISTS(SELECT 1 FROM users u WHERE u.id=user_id AND u.client_id=client_id));

-- Cap-trim signal (§19(1)): every notifications INSERT marks its recipient in
-- app.notify_trim_target for the rest of the transaction, which is exactly the
-- order notifyUsers uses (insert one recipient, then trim that inbox). Invoker-
-- only, not a definer (the authority fingerprint still admits exactly one
-- b17_* SECURITY DEFINER); trigger functions cannot be invoked directly. The
-- signal is transaction-local and never set outside this trigger.
CREATE FUNCTION b17_notify_target() RETURNS trigger LANGUAGE plpgsql
  SET search_path=pg_catalog,public,pg_temp AS $$
BEGIN
  PERFORM set_config('app.notify_trim_target', NEW.user_id::text, true);
  RETURN NEW;
END $$;
CREATE TRIGGER b17_notify_target BEFORE INSERT ON notifications
  FOR EACH ROW EXECUTE FUNCTION b17_notify_target();

-- D1 (task §20 Option A, sanctioned by §19(2) "narrowly-scoped users SELECT"):
-- branch 1, purpose 'work' (server-selected by readContext after the retrofit) —
-- P resolves platform-event actors (client_id IS NULL rows only); W/C/E resolve
-- own-tenant actor rows. This repairs the audit user_name/email JOIN and the
-- attachment uploader name, lets notifyUsers' recipient resolvers and the
-- membership check above see their own tenant, and keeps a foreign tenant
-- invisible. It is NOT the §3.4 /users administration capability: handlers
-- still project only what §3 allows.
-- branch 2, purpose AND session both NULL with a bound actor — the F-03 fresh
-- gate (requireFreshPassword -> contextFromUser) reads ONLY its own row;
-- without it every activated mutating route 401s on an invisible users row
-- (diagnosed by scripts/b17-freshgate-proof.ts before this delta).
CREATE POLICY b17_domain_users_read ON users FOR SELECT USING (
  (b17_setting('current_purpose')='work' AND (
    (b17_platform_scope() AND client_id IS NULL)
    OR b17_work_tenant(client_id)))
  -- SHIELD-U2F-01 (task §3(1)): the §3.4 P@T tenant-user reads (GET /users?clientId,
  -- GET /departments head join, GET /clients/:id roster, GET /staff-lists name join).
  -- Server-set explicit target only; a GE platform account (client_id IS NULL) is
  -- never admitted here, and the work branch above is untouched.
  OR (b17_platform_config() AND b17_setting('target_id') IS NOT NULL
      AND client_id::text=b17_setting('target_id'))
  OR (b17_setting('current_purpose') IS NULL
    AND b17_setting('current_session_id') IS NULL
    AND b17_setting('current_actor_id') IS NOT NULL
    AND id::text=b17_setting('current_actor_id')));

-- evidence_attachments: visibility is exactly the parent answer's scope —
-- linked item + owning department, plus E's own department and retained
-- assignment — never a guessed answer id. U1's tenant-only predicate is
-- replaced, not OR-combined with it.
DROP POLICY b17_attachments ON evidence_attachments;
CREATE POLICY b17_attachments ON evidence_attachments FOR SELECT USING
  (EXISTS(SELECT 1 FROM answers a WHERE a.id=answer_id
    AND b17_work_tenant(a.client_id) AND b17_item_visible(a.client_id,a.item_id)
    AND b17_content_fact('department',a.client_id,a.department_id)
    AND (b17_setting('current_mode')<>'employee'
      OR (a.department_id::text=b17_setting('current_user_department_id')
        AND b17_content_fact('assigned',a.client_id,a.item_id)))));
-- Upload is an E-only own-assigned-parent filing; the uploader is the actor
-- (§3.6 POST: no C answer/evidence editing, no W/P answer filing).
CREATE POLICY b17_attachments_insert ON evidence_attachments FOR INSERT WITH CHECK
  (b17_setting('current_mode')='employee'
    AND uploaded_by::text=b17_setting('current_actor_id')
    AND EXISTS(SELECT 1 FROM answers a WHERE a.id=answer_id
      AND b17_work_tenant(a.client_id) AND b17_item_visible(a.client_id,a.item_id)
      AND b17_content_fact('department',a.client_id,a.department_id)
      AND a.department_id::text=b17_setting('current_user_department_id')
      AND b17_content_fact('assigned',a.client_id,a.item_id)));
-- Delete: E only on its own uploads of an own-assigned parent, W as the
-- scoped GE administrator of A; C and P are denied (§3.6 DELETE).
CREATE POLICY b17_attachments_delete ON evidence_attachments FOR DELETE USING
  (EXISTS(SELECT 1 FROM answers a WHERE a.id=answer_id
    AND b17_work_tenant(a.client_id) AND b17_item_visible(a.client_id,a.item_id)
    AND b17_content_fact('department',a.client_id,a.department_id)
    AND (b17_setting('current_mode')<>'employee'
      OR (a.department_id::text=b17_setting('current_user_department_id')
        AND b17_content_fact('assigned',a.client_id,a.item_id))))
  AND ((b17_setting('current_mode')='employee'
      AND uploaded_by::text=b17_setting('current_actor_id'))
    OR b17_setting('current_mode')='consultant'));

-- actions: W may create inside A only (owner department belongs to A, plus a
-- linked item or an explicit linked service for a standalone action). W/C may
-- update only rows the read scope already admits. WF-04 transition legality
-- and the required-reason rule are handler rules and stay out of SQL.
CREATE POLICY b17_actions_insert ON actions FOR INSERT WITH CHECK
  (b17_setting('current_mode')='consultant' AND b17_work_tenant(client_id)
    AND b17_content_fact('department',client_id,owner_department_id)
    AND (CASE WHEN item_id IS NULL
      THEN service_id IS NOT NULL AND b17_content_fact('service',client_id,service_id)
      ELSE b17_item_visible(client_id,item_id,service_id) END));
CREATE POLICY b17_actions_update ON actions FOR UPDATE USING
  (b17_work_tenant(client_id) AND b17_setting('current_mode')<>'employee'
    AND b17_content_fact('department',client_id,owner_department_id)
    AND (CASE WHEN item_id IS NULL
      THEN service_id IS NOT NULL AND b17_content_fact('service',client_id,service_id)
      ELSE b17_item_visible(client_id,item_id,service_id) END)
    AND (b17_setting('current_mode')<>'client'
      OR b17_content_fact('corrective',client_id,item_id,service_id)))
  WITH CHECK
  (b17_work_tenant(client_id) AND b17_setting('current_mode')<>'employee'
    AND b17_content_fact('department',client_id,owner_department_id)
    AND (CASE WHEN item_id IS NULL
      THEN service_id IS NOT NULL AND b17_content_fact('service',client_id,service_id)
      ELSE b17_item_visible(client_id,item_id,service_id) END)
    AND (b17_setting('current_mode')<>'client'
      OR b17_content_fact('corrective',client_id,item_id,service_id)));

-- audit_log: P reads platform events only (client_id IS NULL), W reads its own
-- tenant's A log. C/E read NO general log — the ONLY extra branch below is the
-- §9(a) item-local history grant (SHIELD-U2E-E2-HISTORY), and it is:
--   (1) purpose-bound  : exactly the server-selected 'work' purpose;
--   (2) entity-whitelisted: exactly entity_type='evaluations' — never the feed;
--   (3) ownership-resolved BEFORE output: own tenant, the referenced evaluation
--       must exist for THAT tenant with a LINKED item, and for E it must also
--       pass the own-department provenance fact (G-SHARED fail-closed, so a
--       shared/foreign-department item yields no history rows at all);
--   (4) /audit-log unchanged: its §3.6 P/W-only matrix rows still refuse C/E
--       before any handler runs, so this branch creates NO general-log access.
-- Append-only stays in trg_block_audit_log_mod.
DROP POLICY b17_audit_read ON audit_log;
CREATE POLICY b17_audit_read ON audit_log FOR SELECT USING (
  (b17_platform_scope() AND client_id IS NULL)
  OR (b17_work_tenant(client_id) AND b17_setting('current_mode')='consultant')
  OR (b17_setting('current_purpose')='work'
      AND entity_type='evaluations'
      AND b17_work_tenant(client_id)
      AND EXISTS(SELECT 1 FROM evaluations e
        WHERE e.id=entity_id AND e.client_id=audit_log.client_id
          AND b17_item_visible(e.client_id,e.item_id)
          AND (b17_setting('current_mode')<>'employee'
               OR b17_content_fact('evaluation',e.client_id,e.id)))));
-- Business audit is appended with the work that produced it (§5 atomicity:
-- write and audit commit or roll back together). The U1 auth/session and
-- workspace branches are retained unchanged.
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
        'INITIATIVE_UPSERTED','INITIATIVE_UPDATED'))
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
          'USER_REACTIVATED','STAFF_LIST_APPROVED'))))
    OR b17_work_tenant(client_id)));
-- U2-B0 adds row scope only. Handlers remain UNACTIVATED.
-- U2-B round 3 adds only the server-side notify fan-out/trim policies and the
-- narrowly-scoped users SELECT above (task §20 D1/D2); the 13 route flips live
-- in src/server/accessRegistry.ts, never here.


-- ===========================================================================
-- B17 U2-C1 — taxonomy/GRI policy substrate (task §22 conditional target,
-- authorised by §23 D1–D4). ZERO handler or registry change: the 23
-- declarations stay UNACTIVATED in accessRegistry.ts. Delta name for Shield
-- re-review: catalog P read/write policies, P platform.config tenant-config
-- policies, P audit config branches, D1 count-only definer, D2 bound_tenant
-- platform branch + is_scope_frozen purpose, SHIELD-U2B3-01 notifications
-- DELETE identity, b17Readiness sanctioned-definer set + shape recompute.
-- ===========================================================================

-- Global catalog SELECT: W/C/E keep their linked/assigned fact predicates
-- (unchanged, still tenant-scoped); the two P contexts additionally see the
-- global catalog — b17_platform_scope (platform summary/work context) and
-- b17_platform_config (platform configuration context). No tenant row of any
-- other table is admitted by these policies.
CREATE POLICY b17_items ON items FOR SELECT USING
  (b17_item_visible(nullif(b17_setting('current_tenant_id'),'')::uuid,id)
   OR b17_platform_scope() OR b17_platform_config());
CREATE POLICY b17_standards ON standards FOR SELECT USING
  (b17_parent_visible('standard',id) OR b17_platform_scope() OR b17_platform_config());
CREATE POLICY b17_disclosures ON disclosures FOR SELECT USING
  (b17_parent_visible('disclosure',id) OR b17_platform_scope() OR b17_platform_config());
CREATE POLICY b17_services ON services FOR SELECT USING
  (b17_parent_visible('service',id) OR b17_platform_scope() OR b17_platform_config());
CREATE POLICY b17_service_standards ON service_standards FOR SELECT USING
  ((b17_parent_visible('service',service_id) AND b17_parent_visible('standard',standard_id))
   OR b17_platform_scope() OR b17_platform_config());
CREATE POLICY b17_item_links ON item_links FOR SELECT USING
  ((b17_item_visible(nullif(b17_setting('current_tenant_id'),'')::uuid,item_a)
    AND b17_item_visible(nullif(b17_setting('current_tenant_id'),'')::uuid,item_b))
   OR b17_platform_scope() OR b17_platform_config());

-- Catalog mutation: ONLY from the two server-selected P contexts, ONLY on the
-- six global catalog tables (the 12 taxonomy write declarations + the GRI
-- commit's standards/disclosures/items upsert under either context).
-- Deliberately absent everywhere else: no tenant table (clients, departments
-- outside the target policies below, client_services, assignments, answers,
-- evaluations, ...) gains a write policy from this section.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['services','standards','disclosures','items','service_standards','item_links'] LOOP
    EXECUTE format('CREATE POLICY b17_catalog_config_insert ON public.%I FOR INSERT
      WITH CHECK (b17_platform_scope() OR b17_platform_config())', t);
    EXECUTE format('CREATE POLICY b17_catalog_config_update ON public.%I FOR UPDATE
      USING (b17_platform_scope() OR b17_platform_config())
      WITH CHECK (b17_platform_scope() OR b17_platform_config())', t);
    EXECUTE format('CREATE POLICY b17_catalog_config_delete ON public.%I FOR DELETE
      USING (b17_platform_scope() OR b17_platform_config())', t);
  END LOOP;
END $$;

-- Target-bound configuration reads/writes (task §23 goals 2 and 4): only under
-- platform.config with an EXPLICIT server-set target. clients: the commit's
-- tenantCheck. departments: target-bound INSERT/UPDATE (commit's auto-department
-- upsert + RETURNING); a targetless configuration context may READ department
-- metadata only (taxonomy POST /items department validation) — never write it.
-- assignments: target-bound SELECT (RETURNING) + INSERT provisioning only.
CREATE POLICY b17_config_clients_read ON clients FOR SELECT USING
  (b17_platform_config() AND b17_setting('target_id') IS NOT NULL
   AND id::text=b17_setting('target_id'));
CREATE POLICY b17_config_departments_read ON departments FOR SELECT USING
  (b17_platform_config() AND (b17_setting('target_id') IS NULL
    OR client_id::text=b17_setting('target_id')));
CREATE POLICY b17_config_departments_insert ON departments FOR INSERT WITH CHECK
  (b17_platform_config() AND b17_setting('target_id') IS NOT NULL
   AND client_id::text=b17_setting('target_id'));
CREATE POLICY b17_config_departments_update ON departments FOR UPDATE
  USING (b17_platform_config() AND b17_setting('target_id') IS NOT NULL
   AND client_id::text=b17_setting('target_id'))
  WITH CHECK (b17_platform_config() AND b17_setting('target_id') IS NOT NULL
   AND client_id::text=b17_setting('target_id'));
CREATE POLICY b17_config_assignments_read ON assignments FOR SELECT USING
  (b17_platform_config() AND b17_setting('target_id') IS NOT NULL
   AND client_id::text=b17_setting('target_id'));
CREATE POLICY b17_config_assignments_insert ON assignments FOR INSERT WITH CHECK
  (b17_platform_config() AND b17_setting('target_id') IS NOT NULL
   AND client_id::text=b17_setting('target_id'));
-- client_services receives NO policy here on purpose: platform configuration
-- can never INSERT/UPDATE/DELETE a subscription (no implicit service grant,
-- task §22). Linked-service membership checks stay row-free via
-- b17_content_fact('service', ...) under the D2 bound branch.

-- D1: count-only SECURITY DEFINER helper for the taxonomy delete-refusal
-- pre-checks (standards -> disclosures, disclosures -> items, items ->
-- answers/evaluations/assignments/evidence). Returns one integer; never rows,
-- ids, values or blobs, so spec §5's "no P SELECT answer/evaluation blobs"
-- holds by construction. Fail-closed: a caller outside the server-selected
-- platform configuration context gets an EXCEPTION, never 0 — a missing
-- context can never read as "no blockers" (the ON DELETE CASCADE hazard,
-- task §23 D1). Counts are catalog-WIDE integers because a global catalog
-- child and its CASCADE may belong to any tenant; scoping counts to one
-- target would re-open exactly the fail-open defect. Tenant rows are read only
-- under the internal 'scope.counts' purpose, which is set and restored inside
-- this function and appears nowhere else in application code.
CREATE FUNCTION b17_catalog_child_count(kind text, ref uuid) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE n integer; old_purpose text;
BEGIN
  IF ref IS NULL OR kind IS NULL OR kind NOT IN ('standard.disclosures','disclosure.items',
    'item.answers','item.evaluations','item.assignments','item.evidence','item.actions',
    'tenant.unmapped_assignments','tenant.item.answers','tenant.item.evaluations')
  THEN RAISE EXCEPTION 'b17.count_args'; END IF;
  IF kind = 'tenant.unmapped_assignments' THEN
    -- SHIELD-U2E-E3 (task §10 ruling 1): the §8 whole-tenant freeze preflight.
    -- Admitted for EXACTLY this context — purpose 'work' + GE + consultant mode
    -- + ref IS the caller's OWN bound tenant. Not a general work-context row
    -- read (the kind list is closed and this returns one integer), and not a P
    -- bypass (platform.config never satisfies this branch). The count itself
    -- uses b17_content_fact('linked') below, whose scope.internal branch sees
    -- the mapping chain that b17_scope/b17_item_visible hide from the handler's
    -- own W context — the exact defect this kind exists to close.
    IF NOT coalesce((b17_setting('current_purpose')='work'
        AND b17_setting('current_actor_id') IS NOT NULL
        AND b17_setting('current_user_role')='ge_admin'
        AND b17_setting('current_mode')='consultant'
        AND ref::text = b17_setting('current_tenant_id')),false)
    THEN RAISE EXCEPTION 'b17.count_context'; END IF;
  ELSIF kind IN ('tenant.item.answers','tenant.item.evaluations') THEN
    -- SHIELD-U2F-01 (task §3(1)): the §3.4 DELETE /assignments blocker counts.
    -- Ref is the ITEM; the tenant is the server-set explicit target T of the
    -- P@T configuration context, never a request value. Admitted ONLY there —
    -- so a platform configuration row can never read another tenant's blockers,
    -- and the work/W context can never reach this branch (it keeps the plain
    -- catalog kinds and the tenant preflight kind unchanged). One integer back,
    -- so spec §5's "no P SELECT answer/evaluation blobs" holds by construction.
    IF NOT coalesce((b17_setting('current_purpose')='platform.config'
        AND b17_setting('current_actor_id') IS NOT NULL
        AND b17_setting('current_user_role')='ge_admin'
        AND b17_setting('target_id') IS NOT NULL),false)
    THEN RAISE EXCEPTION 'b17.count_context'; END IF;
  ELSIF NOT coalesce((b17_setting('current_purpose')='platform.config'
      AND b17_setting('current_actor_id') IS NOT NULL
      AND b17_setting('current_user_role')='ge_admin'),false)
  THEN RAISE EXCEPTION 'b17.count_context'; END IF;
  old_purpose := current_setting('app.current_purpose', true);
  BEGIN
    PERFORM set_config('app.current_purpose','scope.counts',true);
    SELECT CASE kind
      WHEN 'standard.disclosures' THEN (SELECT count(*)::int FROM disclosures d WHERE d.standard_id=ref)
      WHEN 'disclosure.items' THEN (SELECT count(*)::int FROM items i WHERE i.disclosure_id=ref)
      WHEN 'item.answers' THEN (SELECT count(*)::int FROM answers a WHERE a.item_id=ref)
      WHEN 'item.evaluations' THEN (SELECT count(*)::int FROM evaluations e WHERE e.item_id=ref)
      WHEN 'item.assignments' THEN (SELECT count(*)::int FROM assignments g WHERE g.item_id=ref)
      WHEN 'item.actions' THEN (SELECT count(*)::int FROM actions a WHERE a.item_id=ref)
      WHEN 'item.evidence' THEN (SELECT count(*)::int FROM evidence_attachments f
        JOIN answers a ON a.id=f.answer_id WHERE a.item_id=ref)
      WHEN 'tenant.unmapped_assignments' THEN (
        SELECT count(*)::int FROM assignments a
        WHERE a.client_id=ref AND NOT b17_content_fact('linked',ref,a.item_id))
      -- SHIELD-U2F-01: tenant-scoped blockers for DELETE /assignments — the same
      -- item counted ONLY inside the explicit target T of the configuration context.
      WHEN 'tenant.item.answers' THEN (SELECT count(*)::int FROM answers a
        WHERE a.item_id=ref AND a.client_id::text=b17_setting('target_id'))
      WHEN 'tenant.item.evaluations' THEN (SELECT count(*)::int FROM evaluations e
        WHERE e.item_id=ref AND e.client_id::text=b17_setting('target_id'))
    END INTO n;
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('app.current_purpose',coalesce(old_purpose,''),true);
    RAISE;
  END;
  PERFORM set_config('app.current_purpose',coalesce(old_purpose,''),true);
  RETURN n;
END $$;
-- Same privilege discipline as b17_content_fact (task §23 goal 1): no PUBLIC
-- oracle; the owning app principal only; readiness fingerprints both.
REVOKE ALL ON FUNCTION b17_catalog_child_count(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION b17_catalog_child_count(text,uuid) TO CURRENT_USER;
-- Row visibility for the count function's internal reads: ONLY while the
-- purpose is exactly 'scope.counts' (set only inside the function above) AND a
-- GE actor context is present. Direct requests never carry this purpose.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['disclosures','items','answers','evaluations','assignments','evidence_attachments','actions'] LOOP
    EXECUTE format('CREATE POLICY b17_count_read ON public.%I FOR SELECT USING
      (b17_setting(''current_purpose'')=''scope.counts''
       AND b17_setting(''current_actor_id'') IS NOT NULL
       AND b17_setting(''current_user_role'')=''ge_admin'')', t);
  END LOOP;
END $$;

-- U2-D: eleven positive paths only. No new definer; the existing row-free
-- service/initiative facts remain the authority for eligibility. No policies
-- here permit client_services or service_standards mutation or P assessments.
CREATE FUNCTION b17_domain_config(t uuid,s uuid) RETURNS boolean LANGUAGE sql STABLE
  SET search_path=pg_catalog,public,pg_temp AS $$ SELECT
  b17_platform_config() AND b17_setting('current_mode')='platform'
  AND t::text=b17_setting('target_id') AND t::text=b17_setting('current_tenant_id')
  AND s IS NOT NULL AND b17_content_fact('service',t,s) $$;

CREATE POLICY b17_config_links_read ON client_services FOR SELECT USING
  (b17_platform_config() AND b17_setting('current_mode')='platform'
   AND client_id::text=b17_setting('target_id') AND client_id::text=b17_setting('current_tenant_id'));

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['initiatives_library','service_initiatives'] LOOP
    EXECUTE format('CREATE POLICY b17_library_config_read ON public.%I FOR SELECT USING
      (b17_platform_config() AND b17_setting(''current_mode'')=''platform'' AND b17_setting(''target_id'') IS NULL)',t);
    EXECUTE format('CREATE POLICY b17_library_config_insert ON public.%I FOR INSERT WITH CHECK
      (b17_platform_config() AND b17_setting(''current_mode'')=''platform'' AND b17_setting(''target_id'') IS NULL)',t);
  END LOOP;
END $$;
CREATE POLICY b17_library_config_update ON initiatives_library FOR UPDATE
  USING (b17_platform_config() AND b17_setting('current_mode')='platform' AND b17_setting('target_id') IS NULL)
  WITH CHECK (b17_platform_config() AND b17_setting('current_mode')='platform' AND b17_setting('target_id') IS NULL);
CREATE POLICY b17_library_config_delete ON service_initiatives FOR DELETE
  USING (b17_platform_config() AND b17_setting('current_mode')='platform' AND b17_setting('target_id') IS NULL);

CREATE POLICY b17_selection_insert ON client_initiatives FOR INSERT WITH CHECK
  (b17_work_tenant(client_id) AND b17_setting('current_mode')='consultant'
   AND selected_by::text=b17_setting('current_actor_id') AND b17_content_fact('initiative',client_id,initiative_id));
CREATE POLICY b17_selection_delete ON client_initiatives FOR DELETE USING
  (b17_work_tenant(client_id) AND b17_setting('current_mode')='consultant'
   AND b17_content_fact('initiative',client_id,initiative_id));

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['esg_profile','report_settings'] LOOP
    EXECUTE format('CREATE POLICY b17_domain_config_read ON public.%I FOR SELECT USING
      (b17_domain_config(client_id,service_id))',t);
    EXECUTE format('CREATE POLICY b17_domain_config_insert ON public.%I FOR INSERT WITH CHECK
      (b17_domain_config(client_id,service_id))',t);
    EXECUTE format('CREATE POLICY b17_domain_config_update ON public.%I FOR UPDATE
      USING (b17_domain_config(client_id,service_id)) WITH CHECK (b17_domain_config(client_id,service_id))',t);
  END LOOP;
END $$;

-- ===========================================================================
-- B17 U2-E E-2 — E-0 WRITE substrate (task §4.1 pre-authorized; delta name
-- for Shield: SHIELD-U2E-E2 write policies).
--
-- ROW SCOPE ONLY, exactly the B0/C1/C2 discipline: no new SECURITY DEFINER,
-- no PUBLIC grant, REVOKE-PUBLIC/owner-only/sanctioned-set untouched, no
-- schema replay. Each policy admits ONLY the §3.3 context that row of the
-- matrix names. Everything that is NOT row scope stays in the handler /
-- trigger layer and is neither duplicated nor weakened here: WF-05 freeze
-- (is_scope_frozen triggers), version lockstep + 400/409 conflict payloads,
-- the answers correction-history trigger, the append-only audit trigger, the
-- 2,000-character note cap and the OD-08 actor gates.
-- ===========================================================================

-- answers INSERT = the E draft save ONLY (POST /evaluations is E L+D).
-- Status is pinned to 'draft' so no other workflow state can be minted by an
-- INSERT, and the row must be the caller's OWN department with the caller's
-- OWN signature on a linked + retained-assignment item.
-- G-SHARED NOTE: b17_content_fact('writable', ...) is deliberately NOT used
-- here. answers/evaluations use ON CONFLICT ... DO UPDATE, and PostgreSQL
-- evaluates WITH CHECK for that path AFTER the row is written, so a fact that
-- re-reads the very table being written sees the new row and denies its own
-- insert. The ambiguity guard therefore lives where it can be evaluated
-- correctly: the handler refuses FIRST with 409 scope.shared_ambiguous
-- (assertEmployeeEvaluationWritable), the UPDATE policies below carry the
-- own-department/provenance facts, and answers is UNIQUE(client,item,department)
-- so a foreign-department answer can never be overwritten by this upsert.
CREATE POLICY b17_answers_draft_insert ON answers FOR INSERT WITH CHECK (
  b17_work_tenant(client_id)
  AND b17_setting('current_mode')='employee'
  AND b17_item_visible(client_id,item_id)
  AND department_id::text=b17_setting('current_user_department_id')
  AND b17_content_fact('assigned',client_id,item_id)
  AND submitted_by::text=b17_setting('current_actor_id')
  AND status='draft');

-- answers UPDATE = the four matrix-authorised transitions: E on its OWN
-- department (submit / dept approve / return / reasoned correction), C across
-- OWN COMPANY (client-approve / client-return), W as the scoped consultant
-- (reasoned correction). WITH CHECK repeats USING so an update can never move
-- a row out of the caller's own scope.
CREATE POLICY b17_answers_workflow_update ON answers FOR UPDATE
  USING (
    b17_work_tenant(client_id)
    AND b17_item_visible(client_id,item_id)
    AND ((b17_setting('current_mode')='employee'
          AND department_id::text=b17_setting('current_user_department_id')
          AND b17_content_fact('assigned',client_id,item_id))
      OR (b17_setting('current_mode')='client'
          AND b17_content_fact('department',client_id,department_id))
      OR (b17_setting('current_mode')='consultant'
          AND b17_setting('current_user_role')='ge_admin')))
  WITH CHECK (
    b17_work_tenant(client_id)
    AND b17_item_visible(client_id,item_id)
    AND ((b17_setting('current_mode')='employee'
          AND department_id::text=b17_setting('current_user_department_id')
          AND b17_content_fact('assigned',client_id,item_id))
      OR (b17_setting('current_mode')='client'
          AND b17_content_fact('department',client_id,department_id))
      OR (b17_setting('current_mode')='consultant'
          AND b17_setting('current_user_role')='ge_admin')));

-- evaluations INSERT = the E draft save ONLY. Same ON CONFLICT/WITH CHECK
-- reasoning as answers: on the INSERT path there is BY DEFINITION no existing
-- (client,item) row — if one existed the unique index would have taken the
-- DO UPDATE path instead — so the pair is unambiguous here; a conflicting
-- (possibly foreign-department) row reaches the UPDATE policy below, whose
-- b17_content_fact('evaluation', ...) refuses it unless the caller can prove
-- it as its own department. No rekey, G-SHARED fail-closed.
CREATE POLICY b17_evaluations_draft_insert ON evaluations FOR INSERT WITH CHECK (
  b17_work_tenant(client_id)
  AND b17_setting('current_mode')='employee'
  AND b17_item_visible(client_id,item_id)
  AND b17_content_fact('assigned',client_id,item_id)
  AND evaluator_id::text=b17_setting('current_actor_id'));

-- evaluations UPDATE = the lockstep version bumps and the reasoned correction
-- only: E on an evaluation it can prove as its own department, C on own
-- company, W as the scoped consultant. Nothing here creates or re-keys a pair.
CREATE POLICY b17_evaluations_workflow_update ON evaluations FOR UPDATE
  USING (
    b17_work_tenant(client_id)
    AND b17_item_visible(client_id,item_id)
    AND ((b17_setting('current_mode')='employee'
          AND b17_content_fact('evaluation',client_id,id))
      OR b17_setting('current_mode')='client'
      OR (b17_setting('current_mode')='consultant'
          AND b17_setting('current_user_role')='ge_admin')))
  WITH CHECK (
    b17_work_tenant(client_id)
    AND b17_item_visible(client_id,item_id)
    AND ((b17_setting('current_mode')='employee'
          AND b17_content_fact('evaluation',client_id,id))
      OR b17_setting('current_mode')='client'
      OR (b17_setting('current_mode')='consultant'
          AND b17_setting('current_user_role')='ge_admin')));

-- approvals INSERT = append-only stamps at the three OD-08 levels, each by the
-- caller's own actor and only on an answer of the caller's own tenant that the
-- caller can actually SEE (§10 ruling 3 / SHIELD-U2E-E2-01): item-visible for
-- every mode, plus the own-department provenance pin for E — the same fact
-- family the answers/evaluations UPDATE policies use. No UPDATE/DELETE policy
-- exists: approvals are append-only by construction.
CREATE POLICY b17_approvals_insert ON approvals FOR INSERT WITH CHECK (
  b17_work_tenant(client_id)
  AND approver_id::text=b17_setting('current_actor_id')
  AND EXISTS(SELECT 1 FROM answers a
    WHERE a.id=answer_id AND a.client_id=approvals.client_id
      AND b17_item_visible(a.client_id,a.item_id)
      AND ((b17_setting('current_mode')='employee'
            AND a.department_id::text=b17_setting('current_user_department_id')
            AND b17_content_fact('assigned',a.client_id,a.item_id))
        OR (b17_setting('current_mode')='client'
            AND b17_content_fact('department',a.client_id,a.department_id))
        OR (b17_setting('current_mode')='consultant'
            AND b17_setting('current_user_role')='ge_admin')))
  AND ((b17_setting('current_mode')='employee' AND level='department')
    OR (b17_setting('current_mode')='client' AND level='client')
    OR (b17_setting('current_mode')='consultant'
        AND b17_setting('current_user_role')='ge_admin' AND level='ge')));

-- review_snapshots INSERT = the W GE-final freeze only. No UPDATE/DELETE
-- policy: the snapshot is immutable and its content_hash is never rewritten.
CREATE POLICY b17_review_snapshots_insert ON review_snapshots FOR INSERT WITH CHECK (
  b17_work_tenant(client_id)
  AND b17_setting('current_mode')='consultant'
  AND b17_setting('current_user_role')='ge_admin'
  AND created_by::text=b17_setting('current_actor_id'));

-- snapshot_notes INSERT = the W append-only post-freeze note only (the route
-- owns the 2,000-character cap). No UPDATE/DELETE policy: notes are append-only.
CREATE POLICY b17_snapshot_notes_insert ON snapshot_notes FOR INSERT WITH CHECK (
  b17_work_tenant(client_id)
  AND b17_setting('current_mode')='consultant'
  AND b17_setting('current_user_role')='ge_admin'
  AND created_by::text=b17_setting('current_actor_id')
  AND EXISTS(SELECT 1 FROM review_snapshots s
    WHERE s.id=snapshot_id AND s.client_id=snapshot_notes.client_id));

-- ===========================================================================
-- B17 U2-F round 1 — SHIELD-U2F-01: admin §3.4 substrate for exactly the 22
-- NON-provisioning rows (task §3(1) pre-authorised; b17Readiness refingerprint).
-- Provisioning (POST /users, PATCH /users/:id, POST /staff-lists/:id/approve)
-- is ROUND 2 and gains no policy here beyond the shared staff_lists UPDATE row
-- scope its reject sibling already needs.
--
-- Three SERVER-SELECTED contexts, never a request-selected purpose:
--   (A) purpose 'work'          = readContext(req): W/C/E own tenant only
--       (b17_work_tenant). P never runs here after this unit: its targetless
--       reads use (C), which keeps c-proof's "answers unreachable under the
--       platform summary/work context" invariant literally true.
--   (B) purpose 'platform.config' + explicit target T = platformConfigContext(req, T):
--       the enumerated P@T configuration exception (§5 "configuration exceptions
--       are enumerated").
--   (C) purpose 'platform.config' + NULL target = platformConfigContext(req, null):
--       global tenant creation, the EXPLICIT bulk link (§3.4 row 15: never
--       automatic/startup/backfill — the route is the only caller) and the §6
--       fixed-aggregate reads of GET /clients progress + GET /ge/overview.
-- ROW SCOPE ONLY, exactly the B0/C1/E-2 discipline: no new SECURITY DEFINER
-- (sanctioned set stays b17_catalog_child_count + b17_content_fact), no PUBLIC
-- grant, no schema replay, no DELETE on answers/evaluations/approvals/clients/
-- departments/users, no UPDATE on answers/evaluations/snapshots beyond the E-2
-- policies. Freeze (is_scope_frozen triggers), version/OD-08/actor gates, the
-- OTP-once rule, the 50-row inbox cap, append-only audit and every §3 handler
-- guard stay in the handler/trigger layer and are neither duplicated nor
-- weakened here.
-- ===========================================================================

-- Fixed-aggregate summary reads (§5: "summary read over assignments/answers/
-- snapshot coverage for fixed aggregates"): ONLY the NULL-target platform
-- configuration context (C) reaches these — never a work-purpose context, never
-- a target-bound one. Handlers project count/pair columns only: GET /clients
-- progress never selects answers.value/correction_history (f1 proves the JSON
-- carries no score/gap/value field) and /ge/overview only counts. W/C/E keep
-- their unchanged b17_scope policies; no P context anywhere is admitted to
-- evaluations at all (scores stay out of every §3.4 projection).
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['assignments','answers','review_snapshots','client_services'] LOOP
    EXECUTE format('CREATE POLICY b17_admin_summary_read ON public.%I FOR SELECT USING
      (b17_platform_config() AND b17_setting(''target_id'') IS NULL
       AND b17_setting(''current_mode'')=''platform'')', t);
  END LOOP;
END $$;

-- clients: the P list/overview read (C), the RETURNING of POST /clients and the
-- INSERT..SELECT source of the explicit bulk link (C); target-bound read is
-- already b17_config_clients_read (C1) and target-bound write is this UPDATE.
CREATE POLICY b17_admin_clients_read ON clients FOR SELECT USING
  (b17_platform_config() AND b17_setting('target_id') IS NULL);
CREATE POLICY b17_admin_clients_insert ON clients FOR INSERT WITH CHECK (
  b17_platform_config() AND b17_setting('target_id') IS NULL
  AND b17_setting('current_mode')='platform');
CREATE POLICY b17_admin_clients_update ON clients FOR UPDATE
  USING (b17_platform_config() AND b17_setting('target_id') IS NOT NULL
    AND id::text=b17_setting('target_id'))
  WITH CHECK (b17_platform_config() AND b17_setting('target_id') IS NOT NULL
    AND id::text=b17_setting('target_id'));

-- client_services: §3.4 rows 12/13/14/15. The C1 comment ("platform
-- configuration can never INSERT/UPDATE/DELETE a subscription") is superseded
-- by this unit's explicit pre-authorisation: a LINK is the enumerated §3.4
-- configuration exception, still target-bound for P@T, still the explicit
-- bulk route only for a NULL target, still never automatic. business rows
-- (assignments/answers/evaluations) are untouched by an unlink — visibility is
-- revoked by the mapping predicate alone (b17_item_visible / linked fact).
CREATE POLICY b17_admin_links_insert ON client_services FOR INSERT WITH CHECK (
  b17_platform_config() AND b17_setting('current_mode')='platform'
  AND (b17_setting('target_id') IS NULL
    OR (b17_setting('target_id') IS NOT NULL AND client_id::text=b17_setting('target_id'))));
-- (The row-15 idempotency pre-filter reads the current links through
-- b17_admin_summary_read's NULL-target branch above — same context, one row
-- scope. A work context and a target-bound context both stay denied for the
-- contexts c-proof pins.)
CREATE POLICY b17_admin_links_update ON client_services FOR UPDATE
  USING (b17_platform_config() AND b17_setting('current_mode')='platform'
    AND b17_setting('target_id') IS NOT NULL AND client_id::text=b17_setting('target_id'))
  WITH CHECK (b17_platform_config() AND b17_setting('current_mode')='platform'
    AND b17_setting('target_id') IS NOT NULL AND client_id::text=b17_setting('target_id'));
CREATE POLICY b17_admin_links_delete ON client_services FOR DELETE USING
  (b17_platform_config() AND b17_setting('current_mode')='platform'
    AND b17_setting('target_id') IS NOT NULL AND client_id::text=b17_setting('target_id'));

-- assignments: INSERT is the C1 target-bound policy; DELETE (§3.4 row 18) is
-- target-bound only, and the answer/evaluation blockers are read through the
-- count-only definer (tenant.item.* kinds), never as rows.
CREATE POLICY b17_admin_assignments_delete ON assignments FOR DELETE USING
  (b17_platform_config() AND b17_setting('current_mode')='platform'
    AND b17_setting('target_id') IS NOT NULL AND client_id::text=b17_setting('target_id'));

-- staff_lists + rows (§3.4 rows 20/21/22/24): C/W draft+submit+reject under
-- their own work tenant, P reject under explicit T (round-2 approve reuses the
-- SAME target-bound branch), and the NULL-target read for /ge/overview's
-- pending-staff total. WITH CHECK pins W/C to submitted/rejected, so a
-- work context can never mint 'approved' (provisioning) directly.
CREATE POLICY b17_admin_staff_read ON staff_lists FOR SELECT USING
  (b17_platform_config() AND (b17_setting('target_id') IS NULL
    OR client_id::text=b17_setting('target_id')));
CREATE POLICY b17_admin_staff_insert ON staff_lists FOR INSERT WITH CHECK (
  b17_work_tenant(client_id)
  AND b17_setting('current_mode') IN ('consultant','client')
  AND submitted_by::text=b17_setting('current_actor_id')
  AND status='draft');
CREATE POLICY b17_admin_staff_update ON staff_lists FOR UPDATE
  USING (
    (b17_work_tenant(client_id) AND b17_setting('current_mode') IN ('consultant','client'))
    OR (b17_platform_config() AND b17_setting('current_mode')='platform'
      AND b17_setting('target_id') IS NOT NULL AND client_id::text=b17_setting('target_id')))
  WITH CHECK (
    (b17_work_tenant(client_id) AND b17_setting('current_mode') IN ('consultant','client')
      AND status IN ('submitted','rejected'))
    OR (b17_platform_config() AND b17_setting('current_mode')='platform'
      AND b17_setting('target_id') IS NOT NULL AND client_id::text=b17_setting('target_id')));
CREATE POLICY b17_admin_staff_rows_read ON staff_list_rows FOR SELECT USING
  (EXISTS(SELECT 1 FROM staff_lists s WHERE s.id=list_id
    AND b17_platform_config() AND b17_setting('target_id') IS NOT NULL
    AND s.client_id::text=b17_setting('target_id')));
CREATE POLICY b17_admin_staff_rows_insert ON staff_list_rows FOR INSERT WITH CHECK (
  b17_setting('current_purpose')='work'
  AND b17_setting('current_mode') IN ('consultant','client')
  AND EXISTS(SELECT 1 FROM staff_lists s WHERE s.id=list_id
    AND b17_work_tenant(s.client_id) AND s.status='draft'
    AND s.submitted_by::text=b17_setting('current_actor_id'))
  AND EXISTS(SELECT 1 FROM departments d WHERE d.id=staff_list_rows.department_id));

-- N/A shortcut (§3.4 row 19): W R+L ONLY. The E draft INSERTs above stay
-- employee-only; this is the disjoint consultant+GE branch, pinned to an N/A
-- row (never a fresh score), the actor's own signature, a linked item and a
-- RETAINED assignment of that department (the handler refuses first with its
-- existing 403/409 guards). P/C/E have no row on this declaration, and no
-- work context can insert a scored evaluation through it.
CREATE POLICY b17_answers_na_insert ON answers FOR INSERT WITH CHECK (
  b17_work_tenant(client_id)
  AND b17_setting('current_mode')='consultant'
  AND b17_setting('current_user_role')='ge_admin'
  AND b17_item_visible(client_id,item_id)
  AND submitted_by::text=b17_setting('current_actor_id')
  AND status='submitted'
  AND EXISTS(SELECT 1 FROM assignments a WHERE a.client_id=answers.client_id
    AND a.item_id=answers.item_id AND a.department_id=answers.department_id));
CREATE POLICY b17_evaluations_na_insert ON evaluations FOR INSERT WITH CHECK (
  b17_work_tenant(client_id)
  AND b17_setting('current_mode')='consultant'
  AND b17_setting('current_user_role')='ge_admin'
  AND b17_item_visible(client_id,item_id)
  AND evaluator_id::text=b17_setting('current_actor_id')
  AND not_applicable AND score IS NULL AND na_reason IS NOT NULL
  AND EXISTS(SELECT 1 FROM assignments a WHERE a.client_id=evaluations.client_id
    AND a.item_id=evaluations.item_id));

-- ===========================================================================
-- B17 U2-F ROUND 2 — SHIELD-U2F-01 extension: §3.4 PROVISIONING rows
-- 6 (POST /users), 7 (PATCH /users/:id) and 23 (approve). Row scope only, same
-- discipline: no new SECURITY DEFINER (sanctioned set unchanged), no PUBLIC
-- grant, b17.sql untouched. This is what R2-B of the Shield review required —
-- under the legacy purpose-NULL context users INSERT was denied outright
-- (b17_bootstrap is auth.bootstrap-only and forbids a department), users UPDATE
-- was denied (b17_users_lock is auth.*-only) and the dupe pre-check read only
-- the actor's own row; all three rows now run platformConfigContext(req, T)
-- (T = the required explicit clientId; never a targetless provisioning context)
-- so the pre-check sees the
-- target tenant's users and the 23505 unique-email backstop stays global.
-- The b17_revoke_inactive trigger keeps its own auth.revoke GUCs (b17.sql
-- unchanged); its FOR UPDATE re-enters the row lock the handler took BEFORE the
-- users UPDATE (parent §15 lock order, proven in scripts/b17-domain-f3.ts).
-- ===========================================================================
CREATE POLICY b17_admin_users_insert ON users FOR INSERT WITH CHECK (
  b17_platform_config() AND b17_setting('current_mode')='platform'
  AND b17_setting('target_id') IS NOT NULL AND client_id::text=b17_setting('target_id'));
CREATE POLICY b17_admin_users_update ON users FOR UPDATE
  USING (b17_platform_config() AND b17_setting('current_mode')='platform'
    AND b17_setting('target_id') IS NOT NULL AND client_id::text=b17_setting('target_id'))
  WITH CHECK (b17_platform_config() AND b17_setting('current_mode')='platform'
    AND b17_setting('target_id') IS NOT NULL AND client_id::text=b17_setting('target_id'));

-- ===========================================================================
-- TASK-PROTO-H13 — app_settings (platform-wide app theme) row scope.
-- b17.sql's activation block replaces EVERY predecessor policy, so the three
-- policies schema.sql defines for app_settings are gone by the time this
-- substrate runs. They are re-asserted here verbatim, otherwise a fresh install
-- would end policy-less (deny-all writes, silently empty reads) while the live
-- database keeps them — and STRUCTURE_SQL fingerprints policies, so the two
-- states could not share one constant. No other table or policy is touched;
-- RLS stays enabled AND forced; SELECT stays open only because this table is
-- display-only and the session resolver reads it before any tenant context
-- exists.
-- ===========================================================================
DROP POLICY IF EXISTS app_settings_read ON app_settings;
CREATE POLICY app_settings_read ON app_settings
  FOR SELECT
  USING (true);
DROP POLICY IF EXISTS app_settings_insert ON app_settings;
CREATE POLICY app_settings_insert ON app_settings
  FOR INSERT
  WITH CHECK (nullif(current_setting('app.current_purpose', true), '') = 'platform.config');
DROP POLICY IF EXISTS app_settings_update ON app_settings;
CREATE POLICY app_settings_update ON app_settings
  FOR UPDATE
  USING (nullif(current_setting('app.current_purpose', true), '') = 'platform.config')
  WITH CHECK (nullif(current_setting('app.current_purpose', true), '') = 'platform.config');
