-- OFFLINE EMPTY-INSTALL ONLY. This guard precedes all DDL/policy/data changes.
-- The transaction lock also protects direct whole-file execution, not just the TS initializer.
SELECT pg_advisory_xact_lock(1717001);
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY(ARRAY[
      'clients','departments','users','services','standards','disclosures','items',
      'client_services','assignments','answers','approvals','evaluations','actions',
      'profile_assessments','report_settings','audit_log','initiatives_library',
      'client_initiatives','esg_profile','review_snapshots','snapshot_notes',
      'evidence_attachments','service_standards','item_links','staff_lists',
      'staff_list_rows','notifications','app_schema_versions','auth_sessions','workspace_tabs',
      'document_requirements','document_submissions','initiative_department_status','evidence_files'
    ])
  ) THEN RAISE EXCEPTION 'schema.empty_install_only'; END IF;
END $$;

-- GreenEdge ESG & GRI Platform Database Schema & RLS Policies
-- Compatible with PostgreSQL 13+

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Clients (Tenants)
CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  contact_email TEXT,
  industry TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Departments
CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(client_id, code)
);

-- 3. Users
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ge_admin', 'client_admin', 'employee')),
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Services
CREATE TABLE IF NOT EXISTS services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. Standards (e.g. GRI 2, GRI 305)
CREATE TABLE IF NOT EXISTS standards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  version TEXT DEFAULT '2021',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. Disclosures (e.g. GRI 2-1, GRI 305-1)
CREATE TABLE IF NOT EXISTS disclosures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  standard_id UUID NOT NULL REFERENCES standards(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(standard_id, code)
);

-- 7. Items (Requirements under a disclosure)
CREATE TABLE IF NOT EXISTS items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  disclosure_id UUID NOT NULL REFERENCES disclosures(id) ON DELETE CASCADE,
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  code TEXT NOT NULL,
  requirement TEXT NOT NULL,
  answer_type TEXT NOT NULL DEFAULT 'text',
  hint TEXT,
  priority TEXT NOT NULL CHECK (priority IN ('high', 'mid', 'low')),
  esg_class TEXT NOT NULL CHECK (esg_class IN ('environmental', 'social', 'governance', 'general')),
  weight NUMERIC NOT NULL DEFAULT 1.0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- NOTE (fix batch 1): new item columns, the (disclosure_id, code) natural-key
-- unique index, and the weight<->priority tie are applied idempotently in the
-- "FIX BATCH 1" section at the end of this file. New code must not add plain
-- ALTER TABLE ... ADD COLUMN here because this file is re-applied wholesale.

-- 8. Client Services
CREATE TABLE IF NOT EXISTS client_services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  show_gap BOOLEAN NOT NULL DEFAULT true,
  show_corrective BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(client_id, service_id)
);

-- 9. Assignments
CREATE TABLE IF NOT EXISTS assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  assigned_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(client_id, item_id, department_id)
);

-- 10. Answers
CREATE TABLE IF NOT EXISTS answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  submitted_by UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('draft', 'submitted', 'reopened')),
  value TEXT NOT NULL,
  correction_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(client_id, item_id, department_id)
);

-- 11. Approvals
CREATE TABLE IF NOT EXISTS approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  answer_id UUID NOT NULL REFERENCES answers(id) ON DELETE CASCADE,
  approver_id UUID NOT NULL REFERENCES users(id),
  level TEXT NOT NULL CHECK (level IN ('department', 'client', 'ge')),
  status TEXT NOT NULL CHECK (status IN ('approved', 'rejected')),
  comments TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 12. Evaluations
CREATE TABLE IF NOT EXISTS evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  evaluator_id UUID NOT NULL REFERENCES users(id),
  score SMALLINT CHECK (score IN (0, 50, 100)),
  not_evaluated BOOLEAN NOT NULL DEFAULT false,
  not_applicable BOOLEAN NOT NULL DEFAULT false,
  note TEXT,
  justification TEXT,
  previous_score SMALLINT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(client_id, item_id)
);

-- 13. Actions (Corrective Actions)
-- NOTE (fix batch 8): status set is ('open','in_progress','awaiting_verification',
-- 'closed','reopened') and evidence_note exists — see the FIX BATCH 8 section
-- below, which migrates pre-B8 databases idempotently. Fresh installs go through
-- the same section right after this CREATE.
CREATE TABLE IF NOT EXISTS actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  item_id UUID REFERENCES items(id) ON DELETE SET NULL,
  owner_department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  due_date DATE,
  status TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'awaiting_verification', 'closed', 'reopened')),
  evidence_note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 14. Profile Assessments
CREATE TABLE IF NOT EXISTS profile_assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  assessment_name TEXT NOT NULL,
  target_year INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 15. Report Settings
CREATE TABLE IF NOT EXISTS report_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  level TEXT NOT NULL CHECK (level IN ('in_accordance', 'with_reference')),
  notification_recorded BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(client_id)
);

-- 16. Audit Log (Append-only)
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID,
  user_id UUID,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  payload JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

--------------------------------------------------------------------------------
-- Database Triggers & Integrity Rules
--------------------------------------------------------------------------------

-- Rule: audit_log is append-only; block UPDATE and DELETE on it at database level
CREATE OR REPLACE FUNCTION block_audit_log_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only; UPDATE and DELETE operations are forbidden.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_block_audit_log_mod ON audit_log;
CREATE TRIGGER trg_block_audit_log_mod
BEFORE UPDATE OR DELETE ON audit_log
FOR EACH ROW EXECUTE FUNCTION block_audit_log_modification();

-- Rule: No overwrite of submitted or approved answers without appending correction history
CREATE OR REPLACE FUNCTION enforce_answer_correction_history()
RETURNS TRIGGER AS $$
BEGIN
  IF (OLD.status IN ('submitted', 'approved')) AND (NEW.value IS DISTINCT FROM OLD.value) THEN
    IF jsonb_array_length(NEW.correction_history) <= jsonb_array_length(OLD.correction_history) THEN
      RAISE EXCEPTION 'Submitted answers cannot be overwritten without appending correction history (previous value, new value, actor, and reason).';
    END IF;
  END IF;
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_answer_correction ON answers;
CREATE TRIGGER trg_enforce_answer_correction
BEFORE UPDATE ON answers
FOR EACH ROW EXECUTE FUNCTION enforce_answer_correction_history();

--------------------------------------------------------------------------------
-- Row-Level Security (RLS) Configuration
--------------------------------------------------------------------------------

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE items ENABLE ROW LEVEL SECURITY;

-- Helper predicates:
-- current_setting('app.current_user_role', true)
-- current_setting('app.current_tenant_id', true)
-- current_setting('app.current_user_department_id', true)

-- 1. clients RLS
DROP POLICY IF EXISTS clients_isolation_policy ON clients;
CREATE POLICY clients_isolation_policy ON clients
  FOR ALL
  USING (
    current_setting('app.current_user_role', true) = 'ge_admin'
    OR id::text = current_setting('app.current_tenant_id', true)
  );

-- 2. departments RLS
DROP POLICY IF EXISTS departments_isolation_policy ON departments;
CREATE POLICY departments_isolation_policy ON departments
  FOR ALL
  USING (
    current_setting('app.current_user_role', true) = 'ge_admin'
    OR client_id::text = current_setting('app.current_tenant_id', true)
  );

-- 3. users RLS
DROP POLICY IF EXISTS users_isolation_policy ON users;
CREATE POLICY users_isolation_policy ON users
  FOR ALL
  USING (
    current_setting('app.current_user_role', true) = 'ge_admin'
    OR client_id::text = current_setting('app.current_tenant_id', true)
  );

-- 4. client_services RLS
DROP POLICY IF EXISTS client_services_isolation_policy ON client_services;
CREATE POLICY client_services_isolation_policy ON client_services
  FOR ALL
  USING (
    current_setting('app.current_user_role', true) = 'ge_admin'
    OR client_id::text = current_setting('app.current_tenant_id', true)
  );

-- 5. assignments RLS
DROP POLICY IF EXISTS assignments_isolation_policy ON assignments;
CREATE POLICY assignments_isolation_policy ON assignments
  FOR ALL
  USING (
    current_setting('app.current_user_role', true) = 'ge_admin'
    OR (
      client_id::text = current_setting('app.current_tenant_id', true)
      AND (
        current_setting('app.current_user_role', true) = 'client_admin'
        OR department_id::text = current_setting('app.current_user_department_id', true)
      )
    )
  );

-- 6. answers RLS
-- Constraint: An employee must never read items or answers belonging to another department.
DROP POLICY IF EXISTS answers_isolation_policy ON answers;
CREATE POLICY answers_isolation_policy ON answers
  FOR ALL
  USING (
    current_setting('app.current_user_role', true) = 'ge_admin'
    OR (
      client_id::text = current_setting('app.current_tenant_id', true)
      AND (
        current_setting('app.current_user_role', true) = 'client_admin'
        OR department_id::text = current_setting('app.current_user_department_id', true)
      )
    )
  );

-- 7. items RLS
-- Department-specific items: If item has department_id, an employee can only see their department's items.
-- NOTE (fix batch 1): the unauthenticated escape hatch
-- (OR current_setting('app.current_user_role', true) IS NULL) was removed.
-- Anonymous/empty-role sessions now only see global items (department_id IS NULL).
DROP POLICY IF EXISTS items_isolation_policy ON items;
CREATE POLICY items_isolation_policy ON items
  FOR ALL
  USING (
    current_setting('app.current_user_role', true) IN ('ge_admin', 'client_admin')
    OR (
      department_id IS NULL
      OR department_id::text = current_setting('app.current_user_department_id', true)
    )
  );

-- 8. approvals RLS
DROP POLICY IF EXISTS approvals_isolation_policy ON approvals;
CREATE POLICY approvals_isolation_policy ON approvals
  FOR ALL
  USING (
    current_setting('app.current_user_role', true) = 'ge_admin'
    OR client_id::text = current_setting('app.current_tenant_id', true)
  );

-- 9. evaluations RLS
DROP POLICY IF EXISTS evaluations_isolation_policy ON evaluations;
CREATE POLICY evaluations_isolation_policy ON evaluations
  FOR ALL
  USING (
    current_setting('app.current_user_role', true) = 'ge_admin'
    OR client_id::text = current_setting('app.current_tenant_id', true)
  );

-- 10. actions RLS
DROP POLICY IF EXISTS actions_isolation_policy ON actions;
CREATE POLICY actions_isolation_policy ON actions
  FOR ALL
  USING (
    current_setting('app.current_user_role', true) = 'ge_admin'
    OR (
      client_id::text = current_setting('app.current_tenant_id', true)
      AND (
        current_setting('app.current_user_role', true) = 'client_admin'
        OR owner_department_id::text = current_setting('app.current_user_department_id', true)
      )
    )
  );

-- 11. profile_assessments RLS
DROP POLICY IF EXISTS profile_assessments_isolation_policy ON profile_assessments;
CREATE POLICY profile_assessments_isolation_policy ON profile_assessments
  FOR ALL
  USING (
    current_setting('app.current_user_role', true) = 'ge_admin'
    OR client_id::text = current_setting('app.current_tenant_id', true)
  );

-- 12. report_settings RLS
DROP POLICY IF EXISTS report_settings_isolation_policy ON report_settings;
CREATE POLICY report_settings_isolation_policy ON report_settings
  FOR ALL
  USING (
    current_setting('app.current_user_role', true) = 'ge_admin'
    OR client_id::text = current_setting('app.current_tenant_id', true)
  );

-- 13. audit_log RLS
DROP POLICY IF EXISTS audit_log_isolation_policy ON audit_log;
CREATE POLICY audit_log_isolation_policy ON audit_log
  FOR ALL
  USING (
    current_setting('app.current_user_role', true) = 'ge_admin'
    OR client_id::text = current_setting('app.current_tenant_id', true)
  );

--------------------------------------------------------------------------------
-- FIX BATCH 1 (demo) — idempotent additions.
-- This file is re-applied wholesale by runMigrations(), so every statement
-- below must be safe to re-run: DO-blocks guarded by catalogue checks,
-- CREATE ... IF NOT EXISTS, DROP ... IF EXISTS, or data repairs that are
-- no-ops once applied. Do NOT add bare ALTER TABLE ... ADD COLUMN here.
--------------------------------------------------------------------------------

-- A1. items: new descriptive columns ---------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'items' AND column_name = 'objective') THEN
    ALTER TABLE items ADD COLUMN objective TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'items' AND column_name = 'topic') THEN
    ALTER TABLE items ADD COLUMN topic TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'items' AND column_name = 'reference') THEN
    ALTER TABLE items ADD COLUMN reference TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'items' AND column_name = 'baseline_gap_percent') THEN
    ALTER TABLE items ADD COLUMN baseline_gap_percent NUMERIC(5,2);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'items' AND column_name = 'baseline_note') THEN
    ALTER TABLE items ADD COLUMN baseline_note TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'items' AND column_name = 'sort_order') THEN
    ALTER TABLE items ADD COLUMN sort_order INTEGER;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'items' AND column_name = 'import_batch_id') THEN
    ALTER TABLE items ADD COLUMN import_batch_id TEXT;
  END IF;
END $$;

-- A1. items.baseline_gap_percent range check (NULL allowed; workbook col J is reference-only) --
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_baseline_gap_valid') THEN
    ALTER TABLE items ADD CONSTRAINT items_baseline_gap_valid
      CHECK (baseline_gap_percent IS NULL OR (baseline_gap_percent >= 0 AND baseline_gap_percent <= 100));
  END IF;
END $$;

-- A1. One-time dedupe of legacy duplicate items (pre-upsert plain INSERTs).
-- Preserves tenant data: children (answers/assignments/evaluations/actions) are
-- repointed to the earliest-created keeper row; conflicting child duplicates
-- keep the earliest row. No-op when no duplicates exist. Must run BEFORE the
-- unique index below is created.
DO $$ DECLARE
  grp RECORD;
  keeper_id UUID;
  loser_id UUID;
BEGIN
  FOR grp IN SELECT disclosure_id AS d_id, code AS c_code FROM items GROUP BY disclosure_id, code HAVING COUNT(*) > 1 LOOP
    SELECT id INTO keeper_id FROM items WHERE disclosure_id = grp.d_id AND code = grp.c_code ORDER BY created_at ASC, id ASC LIMIT 1;
    FOR loser_id IN SELECT id FROM items WHERE disclosure_id = grp.d_id AND code = grp.c_code AND id <> keeper_id ORDER BY created_at ASC LOOP
      -- assignments (UNIQUE client,item,dept): repoint non-conflicting, drop conflicting dupes
      UPDATE assignments SET item_id = keeper_id WHERE item_id = loser_id
        AND NOT EXISTS (SELECT 1 FROM assignments a2 WHERE a2.client_id = assignments.client_id AND a2.item_id = keeper_id AND a2.department_id = assignments.department_id);
      DELETE FROM assignments WHERE item_id = loser_id;
      -- answers (UNIQUE client,item,dept): same treatment
      UPDATE answers SET item_id = keeper_id WHERE item_id = loser_id
        AND NOT EXISTS (SELECT 1 FROM answers a2 WHERE a2.client_id = answers.client_id AND a2.item_id = keeper_id AND a2.department_id = answers.department_id);
      DELETE FROM answers WHERE item_id = loser_id;
      -- evaluations (UNIQUE client,item): same treatment
      UPDATE evaluations SET item_id = keeper_id WHERE item_id = loser_id
        AND NOT EXISTS (SELECT 1 FROM evaluations e2 WHERE e2.client_id = evaluations.client_id AND e2.item_id = keeper_id);
      DELETE FROM evaluations WHERE item_id = loser_id;
      -- actions: no uniqueness on item_id, repoint all
      UPDATE actions SET item_id = keeper_id WHERE item_id = loser_id;
      DELETE FROM items WHERE id = loser_id;
    END LOOP;
  END LOOP;
END $$;

-- A1. Natural key for import idempotency: one row per (disclosure, code) --
CREATE UNIQUE INDEX IF NOT EXISTS ux_items_disclosure_code ON items(disclosure_id, code);

-- A1. Weight tied to priority: normalise legacy weights first, then enforce.
-- Legacy imports stored weights like 1.0/1.5/2.0 which violate the new domain;
-- map them to the priority-derived value so the CHECK below can be added.
UPDATE items SET weight = CASE priority WHEN 'high' THEN 3 WHEN 'low' THEN 1 ELSE 2 END
  WHERE weight IS NULL OR weight NOT IN (1, 2, 3);

ALTER TABLE items ALTER COLUMN weight SET DEFAULT 2;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_weight_valid') THEN
    ALTER TABLE items ADD CONSTRAINT items_weight_valid CHECK (weight IN (1, 2, 3));
  END IF;
END $$;

-- DB-level rule so even direct SQL complies: weight is always derived from priority.
CREATE OR REPLACE FUNCTION enforce_item_weight_priority()
RETURNS TRIGGER AS $$
BEGIN
  NEW.weight := CASE NEW.priority WHEN 'high' THEN 3 WHEN 'low' THEN 1 ELSE 2 END;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_item_weight_priority ON items;
CREATE TRIGGER trg_enforce_item_weight_priority
BEFORE INSERT OR UPDATE OF priority, weight ON items
FOR EACH ROW EXECUTE FUNCTION enforce_item_weight_priority();

-- A2. disclosures.sort_order ------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'disclosures' AND column_name = 'sort_order') THEN
    ALTER TABLE disclosures ADD COLUMN sort_order INTEGER;
  END IF;
END $$;

-- A3. answers.status: extend to ('draft','submitted','approved','reopened','returned').
-- The enforce_answer_correction_history trigger already references 'approved';
-- extending the CHECK makes that previously-dead branch real.
ALTER TABLE answers DROP CONSTRAINT IF EXISTS answers_status_check;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'answers_status_valid') THEN
    ALTER TABLE answers ADD CONSTRAINT answers_status_valid
      CHECK (status IN ('draft', 'submitted', 'approved', 'reopened', 'returned'));
  END IF;
END $$;

-- A4. evaluations.na_reason + coherence ------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'evaluations' AND column_name = 'na_reason') THEN
    ALTER TABLE evaluations ADD COLUMN na_reason TEXT;
  END IF;
END $$;

-- One-time coherence repair so the CHECKs below can be added on legacy data:
-- flagged-but-scored rows keep the flag and drop the score; free-text
-- not_applicable rows without a reason get the neutral 'information-unavailable-incomplete'.
UPDATE evaluations SET score = NULL WHERE (not_applicable OR not_evaluated) AND score IS NOT NULL;
UPDATE evaluations SET na_reason = 'information-unavailable-incomplete' WHERE not_applicable AND na_reason IS NULL;
UPDATE evaluations SET not_evaluated = true WHERE score IS NULL AND NOT not_evaluated AND NOT not_applicable;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'evaluations_na_reason_valid') THEN
    ALTER TABLE evaluations ADD CONSTRAINT evaluations_na_reason_valid
      CHECK (na_reason IS NULL OR na_reason IN ('not-applicable', 'legal-prohibitions', 'confidentiality-constraints', 'information-unavailable-incomplete'));
  END IF;
END $$;

-- Exactly one of: scored XOR not_evaluated XOR not_applicable.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'evaluations_coherence_valid') THEN
    ALTER TABLE evaluations ADD CONSTRAINT evaluations_coherence_valid
      CHECK (((score IS NOT NULL)::int + (not_evaluated)::int + (not_applicable)::int) = 1);
  END IF;
END $$;

-- not_applicable requires a reason; a flagged row must not carry a score.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'evaluations_na_reason_required') THEN
    ALTER TABLE evaluations ADD CONSTRAINT evaluations_na_reason_required
      CHECK (NOT not_applicable OR na_reason IS NOT NULL);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'evaluations_score_null_when_flagged') THEN
    ALTER TABLE evaluations ADD CONSTRAINT evaluations_score_null_when_flagged
      CHECK ((NOT not_applicable AND NOT not_evaluated) OR score IS NULL);
  END IF;
END $$;

-- C. FORCE ROW LEVEL SECURITY so the table-owner connection cannot bypass RLS.
-- (Policies above define ge_admin + tenant scoping; bootstrap/service reads run
-- under an explicit ge_admin transaction context — see routes.ts.)
ALTER TABLE clients FORCE ROW LEVEL SECURITY;
ALTER TABLE departments FORCE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE client_services FORCE ROW LEVEL SECURITY;
ALTER TABLE assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE answers FORCE ROW LEVEL SECURITY;
ALTER TABLE approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE evaluations FORCE ROW LEVEL SECURITY;
ALTER TABLE actions FORCE ROW LEVEL SECURITY;
ALTER TABLE profile_assessments FORCE ROW LEVEL SECURITY;
ALTER TABLE report_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
ALTER TABLE items FORCE ROW LEVEL SECURITY;

--------------------------------------------------------------------------------
-- FIX BATCH 8 (demo) — Actions WF-04, Initiatives library, ESG Profile.
-- Same idempotency contract as FIX BATCH 1: safe to re-apply wholesale.
--------------------------------------------------------------------------------

-- B8-A. actions.evidence_note (text reference only — DV-01 forbids binary upload).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'actions' AND column_name = 'evidence_note') THEN
    ALTER TABLE actions ADD COLUMN evidence_note TEXT;
  END IF;
END $$;

-- B8-A. actions.status gains 'reopened' (WF-04: awaiting_verification→reopened,
-- closed→reopened, both with a reason recorded in audit_log).
ALTER TABLE actions DROP CONSTRAINT IF EXISTS actions_status_check;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'actions_status_check') THEN
    ALTER TABLE actions ADD CONSTRAINT actions_status_check
      CHECK (status IN ('open', 'in_progress', 'awaiting_verification', 'closed', 'reopened'));
  END IF;
END $$;

-- B8-B. initiatives_library: tenant-neutral GLOBAL library (like standards —
-- deliberately NO RLS, readable by every authenticated role).
CREATE TABLE IF NOT EXISTS initiatives_library (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  sector TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  esg_class TEXT NOT NULL DEFAULT '',
  standards_ref TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  sort_order INTEGER,
  import_batch_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(title, sector)
);

-- B8-B. client_initiatives: per-tenant selection links into the global library.
CREATE TABLE IF NOT EXISTS client_initiatives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  initiative_id UUID NOT NULL REFERENCES initiatives_library(id) ON DELETE CASCADE,
  selected_by UUID REFERENCES users(id) ON DELETE SET NULL,
  selected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(client_id, initiative_id)
);

-- B8-C. esg_profile: per-tenant ESG profile rows (one per pillar/department/
-- topic/parameter); profile text preserved, profile_rating 1..3 enforced.
CREATE TABLE IF NOT EXISTS esg_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  pillar TEXT NOT NULL,
  department TEXT NOT NULL,
  topic TEXT NOT NULL,
  parameter TEXT NOT NULL,
  observations TEXT,
  market_scenario TEXT,
  profile TEXT,
  profile_rating SMALLINT CHECK (profile_rating IN (1, 2, 3)),
  timeline TEXT,
  eco_impact TEXT,
  rating INTEGER,
  max_rating INTEGER,
  sort_order INTEGER,
  import_batch_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(client_id, pillar, department, topic, parameter)
);

-- B8 RLS: tenant tables follow the evaluations pattern (ge_admin sees all;
-- any same-tenant role reads; write scoping is enforced in routes).
ALTER TABLE client_initiatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE esg_profile ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_initiatives_isolation_policy ON client_initiatives;
CREATE POLICY client_initiatives_isolation_policy ON client_initiatives
  FOR ALL
  USING (
    current_setting('app.current_user_role', true) = 'ge_admin'
    OR client_id::text = current_setting('app.current_tenant_id', true)
  );

DROP POLICY IF EXISTS esg_profile_isolation_policy ON esg_profile;
CREATE POLICY esg_profile_isolation_policy ON esg_profile
  FOR ALL
  USING (
    current_setting('app.current_user_role', true) = 'ge_admin'
    OR client_id::text = current_setting('app.current_tenant_id', true)
  );

ALTER TABLE client_initiatives FORCE ROW LEVEL SECURITY;
ALTER TABLE esg_profile FORCE ROW LEVEL SECURITY;

--------------------------------------------------------------------------------
-- FIX BATCH 9 (demo) — approval chain, freeze snapshots, optimistic locking,
-- evidence attachments. Same idempotency contract as FIX BATCH 1/8: safe to
-- re-apply wholesale (DO-blocks, CREATE ... IF NOT EXISTS, DROP ... IF EXISTS).
--------------------------------------------------------------------------------

-- B9-A. answers.status gains 'client_approved' (WF-02: draft → submitted →
-- dept-approved → client-approved → ready-for-review; returned loops back).
ALTER TABLE answers DROP CONSTRAINT IF EXISTS answers_status_valid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'answers_status_valid') THEN
    ALTER TABLE answers ADD CONSTRAINT answers_status_valid
      CHECK (status IN ('draft', 'submitted', 'approved', 'client_approved', 'reopened', 'returned'));
  END IF;
END $$;

-- B9-C. Optimistic locking (A-15): version counters on both rows of the pair.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'answers' AND column_name = 'version') THEN
    ALTER TABLE answers ADD COLUMN version INT NOT NULL DEFAULT 1;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'evaluations' AND column_name = 'version') THEN
    ALTER TABLE evaluations ADD COLUMN version INT NOT NULL DEFAULT 1;
  END IF;
END $$;

-- B9-B. review_snapshots: immutable GE-final snapshots (WF-03/WF-05). NO
-- UPDATE/DELETE — enforced by trigger, exactly like audit_log. Tenant freeze
-- is derived from these rows (no separate flag to drift out of sync).
CREATE TABLE IF NOT EXISTS review_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('disclosure', 'tenant')),
  scope_ref TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_hash TEXT NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE OR REPLACE FUNCTION block_review_snapshot_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'review_snapshots are immutable; UPDATE and DELETE operations are forbidden. Post-freeze notes must use snapshot_notes.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_block_snapshot_mod ON review_snapshots;
CREATE TRIGGER trg_block_snapshot_mod
BEFORE UPDATE OR DELETE ON review_snapshots
FOR EACH ROW EXECUTE FUNCTION block_review_snapshot_modification();

-- B9-B. snapshot_notes: the ONLY post-freeze write path (append-only log
-- linked to a snapshot). Snapshot rows themselves stay immutable.
CREATE TABLE IF NOT EXISTS snapshot_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES review_snapshots(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE OR REPLACE FUNCTION block_snapshot_note_modification()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'snapshot_notes are append-only; UPDATE and DELETE operations are forbidden.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_block_snapshot_note_mod ON snapshot_notes;
CREATE TRIGGER trg_block_snapshot_note_mod
BEFORE UPDATE OR DELETE ON snapshot_notes
FOR EACH ROW EXECUTE FUNCTION block_snapshot_note_modification();

-- B9-D. evidence_attachments (OD-06, demo-scale): files stay in DB bytea with
-- a 5 MB cap (CHECK). Production object-storage migration is explicitly out
-- of scope — see the comment on the API upload path in routes.ts.
CREATE TABLE IF NOT EXISTS evidence_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  answer_id UUID NOT NULL REFERENCES answers(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INT NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  data BYTEA NOT NULL,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- B9 freeze helper: true when a GE-final snapshot covers (client, item).
-- Tenant scope freezes the whole tenant (evaluations, answers, corrections,
-- profile). Disclosure scope freezes only items under that disclosure.
CREATE OR REPLACE FUNCTION is_scope_frozen(p_client_id UUID, p_item_id UUID DEFAULT NULL)
RETURNS BOOLEAN AS $$
DECLARE
  v_disclosure_id UUID;
BEGIN
  IF EXISTS (
    SELECT 1 FROM review_snapshots
    WHERE client_id = p_client_id AND scope_type = 'tenant'
  ) THEN
    RETURN TRUE;
  END IF;
  IF p_item_id IS NOT NULL THEN
    SELECT disclosure_id INTO v_disclosure_id FROM items WHERE id = p_item_id;
    IF v_disclosure_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM review_snapshots
      WHERE client_id = p_client_id
        AND scope_type = 'disclosure'
        AND scope_ref = v_disclosure_id::text
    ) THEN
      RETURN TRUE;
    END IF;
  END IF;
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE;

-- B9 freeze backstop (WF-05): no evaluation/answer write may touch frozen
-- scope; the API pre-checks and returns a human 409, this trigger is the
-- second line of defence for direct SQL.
CREATE OR REPLACE FUNCTION block_frozen_scope_write()
RETURNS TRIGGER AS $$
DECLARE
  v_client_id UUID;
  v_item_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_client_id := OLD.client_id;
    v_item_id := OLD.item_id;
  ELSE
    v_client_id := NEW.client_id;
    v_item_id := NEW.item_id;
  END IF;
  IF is_scope_frozen(v_client_id, v_item_id) THEN
    RAISE EXCEPTION 'FROZEN_SCOPE: this scope is GE-final frozen; only append-only snapshot notes are allowed.';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_block_frozen_answers ON answers;
CREATE TRIGGER trg_block_frozen_answers
BEFORE INSERT OR UPDATE OR DELETE ON answers
FOR EACH ROW EXECUTE FUNCTION block_frozen_scope_write();

DROP TRIGGER IF EXISTS trg_block_frozen_evaluations ON evaluations;
CREATE TRIGGER trg_block_frozen_evaluations
BEFORE INSERT OR UPDATE OR DELETE ON evaluations
FOR EACH ROW EXECUTE FUNCTION block_frozen_scope_write();

-- B9-B. esg_profile freeze backstop: tenant-level snapshots freeze profile writes.
CREATE OR REPLACE FUNCTION block_frozen_profile_write()
RETURNS TRIGGER AS $$
DECLARE
  v_client_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_client_id := OLD.client_id;
  ELSE
    v_client_id := NEW.client_id;
  END IF;
  IF is_scope_frozen(v_client_id, NULL) THEN
    RAISE EXCEPTION 'FROZEN_SCOPE: this tenant is GE-final frozen; profile imports must skip frozen rows.';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_block_frozen_esg_profile ON esg_profile;
CREATE TRIGGER trg_block_frozen_esg_profile
BEFORE INSERT OR UPDATE OR DELETE ON esg_profile
FOR EACH ROW EXECUTE FUNCTION block_frozen_profile_write();

-- B9-D: attachments inherit the freeze of their parent answer's scope
-- (defence in depth; the API pre-checks and returns the human 409 first).
CREATE OR REPLACE FUNCTION block_frozen_attachment_write()
RETURNS TRIGGER AS $$
DECLARE
  v_answer RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT client_id, item_id INTO v_answer FROM answers WHERE id = OLD.answer_id;
  ELSE
    SELECT client_id, item_id INTO v_answer FROM answers WHERE id = NEW.answer_id;
  END IF;
  IF FOUND AND is_scope_frozen(v_answer.client_id, v_answer.item_id) THEN
    RAISE EXCEPTION 'FROZEN_SCOPE: this scope is GE-final frozen; evidence attachments are refused.';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_block_frozen_attachments ON evidence_attachments;
CREATE TRIGGER trg_block_frozen_attachments
BEFORE INSERT OR UPDATE OR DELETE ON evidence_attachments
FOR EACH ROW EXECUTE FUNCTION block_frozen_attachment_write();

-- B9 RLS: snapshots/notes/attachments follow the tenant pattern (ge_admin sees
-- all; same-tenant roles read; write scoping is enforced in routes). The
-- attachments policy resolves the tenant through the parent answer.
ALTER TABLE review_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE snapshot_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS review_snapshots_isolation_policy ON review_snapshots;
CREATE POLICY review_snapshots_isolation_policy ON review_snapshots
  FOR ALL
  USING (
    current_setting('app.current_user_role', true) = 'ge_admin'
    OR client_id::text = current_setting('app.current_tenant_id', true)
  );

DROP POLICY IF EXISTS snapshot_notes_isolation_policy ON snapshot_notes;
CREATE POLICY snapshot_notes_isolation_policy ON snapshot_notes
  FOR ALL
  USING (
    current_setting('app.current_user_role', true) = 'ge_admin'
    OR client_id::text = current_setting('app.current_tenant_id', true)
  );

DROP POLICY IF EXISTS evidence_attachments_isolation_policy ON evidence_attachments;
CREATE POLICY evidence_attachments_isolation_policy ON evidence_attachments
  FOR ALL
  USING (
    current_setting('app.current_user_role', true) = 'ge_admin'
    OR EXISTS (
      SELECT 1 FROM answers a
      WHERE a.id = evidence_attachments.answer_id
        AND a.client_id::text = current_setting('app.current_tenant_id', true)
    )
  );

ALTER TABLE review_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE snapshot_notes FORCE ROW LEVEL SECURITY;
ALTER TABLE evidence_attachments FORCE ROW LEVEL SECURITY;

--------------------------------------------------------------------------------
-- FIX BATCH 10 (demo) — D-038 report settings per (client × service), disclosure
-- index support. Same idempotency contract as FIX BATCH 1/8/9: safe to
-- re-apply wholesale (DO-blocks, CREATE ... IF NOT EXISTS, DROP ... IF EXISTS).
--
-- A-09: report level is stored per (client × service) with NO default — an
-- unset level blocks export (the API gate refuses with the unified message).
-- Existing rows are preserved: the legacy UNIQUE(client_id) becomes two
-- partial unique indexes so NULL-service rows and per-service rows coexist.
--------------------------------------------------------------------------------

-- B10-A1. report_settings.service_id (nullable: legacy rows stay valid) -----
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'report_settings' AND column_name = 'service_id') THEN
    ALTER TABLE report_settings ADD COLUMN service_id UUID REFERENCES services(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'report_settings' AND column_name = 'disclosure_level') THEN
    ALTER TABLE report_settings ADD COLUMN disclosure_level TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'report_settings' AND column_name = 'report_level') THEN
    ALTER TABLE report_settings ADD COLUMN report_level TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'report_settings' AND column_name = 'statement_name') THEN
    ALTER TABLE report_settings ADD COLUMN statement_name TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'report_settings' AND column_name = 'statement_period') THEN
    ALTER TABLE report_settings ADD COLUMN statement_period TEXT;
  END IF;
END $$;

-- A-11: notification is a RECORD (done/not-done + date + reference — the API
-- stores it; nothing ever sends it, no mailer dependency exists).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'report_settings' AND column_name = 'notified') THEN
    ALTER TABLE report_settings ADD COLUMN notified TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'report_settings' AND column_name = 'notified_date') THEN
    ALTER TABLE report_settings ADD COLUMN notified_date DATE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'report_settings' AND column_name = 'notify_ref') THEN
    ALTER TABLE report_settings ADD COLUMN notify_ref TEXT;
  END IF;
END $$;

-- D-038 value domains (NULL allowed = unset = export blocked, never a default).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'report_settings_disclosure_level_valid') THEN
    ALTER TABLE report_settings ADD CONSTRAINT report_settings_disclosure_level_valid
      CHECK (disclosure_level IS NULL OR disclosure_level IN ('in-accordance', 'with-reference'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'report_settings_report_level_valid') THEN
    ALTER TABLE report_settings ADD CONSTRAINT report_settings_report_level_valid
      CHECK (report_level IS NULL OR report_level IN ('L1', 'L2', 'L3'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'report_settings_notified_valid') THEN
    ALTER TABLE report_settings ADD CONSTRAINT report_settings_notified_valid
      CHECK (notified IS NULL OR notified IN ('done', 'not-done'));
  END IF;
END $$;

-- Per-(client × service) uniqueness that preserves legacy rows: the original
-- UNIQUE(client_id) constraint is replaced by two partial unique indexes
-- (NULL-service rows stay unique per client; service rows unique per pair).
ALTER TABLE report_settings DROP CONSTRAINT IF EXISTS report_settings_client_id_key;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'ux_report_settings_client_noservice') THEN
    CREATE UNIQUE INDEX ux_report_settings_client_noservice ON report_settings(client_id) WHERE service_id IS NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'ux_report_settings_client_service') THEN
    CREATE UNIQUE INDEX ux_report_settings_client_service ON report_settings(client_id, service_id) WHERE service_id IS NOT NULL;
  END IF;
END $$;

--------------------------------------------------------------------------------
-- FIX BATCH 11a (demo) — services/taxonomy/items/equivalent-links (S-04,
-- S-05, S-06, S-08 + WF-05 audit/freeze notes). Same idempotency contract as
-- FIX BATCH 1/8/9/10: safe to re-apply wholesale (CREATE ... IF NOT EXISTS,
-- DO-blocks guarded by catalogue checks, DROP ... IF EXISTS).
--
-- service_standards and item_links are GLOBAL library tables (like standards
-- and initiatives_library): deliberately NO RLS, readable by every
-- authenticated role. Write scoping (GE-only per the 04 matrix) is enforced
-- in routes, and the link reader (GET) only ever exposes the reader's OWN
-- department state (DD-06: never another department's answers).
--------------------------------------------------------------------------------

-- B11a-A. service_standards: which standards belong to a service (S-04).
CREATE TABLE IF NOT EXISTS service_standards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  standard_id UUID NOT NULL REFERENCES standards(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(service_id, standard_id)
);

-- B11a-D. item_links: equivalent-item pairs, GLOBAL library level (S-08).
-- Canonical ordering is enforced by the API (smaller id first) so the
-- UNIQUE(item_a, item_b) pair also collapses the (b,a) reverse duplicate.
-- No live syncing: links carry metadata + evaluation STATE only (snapshot
-- semantics) — never answer text/evidence across departments (DD-06).
CREATE TABLE IF NOT EXISTS item_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_a UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  item_b UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  relation TEXT NOT NULL DEFAULT 'equivalent',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CHECK (item_a <> item_b),
  UNIQUE(item_a, item_b)
);

--------------------------------------------------------------------------------
-- FIX BATCH 11b (demo) — GE ops, client×service completion, manual assign,
-- staff-list flow with OTP + forced change, client dashboard (S-03/S-09/
-- S-10/S-11/S-12/S-13, WF-01). Same idempotency contract as FIX BATCH 1/8/9/
-- 10/11a: safe to re-apply wholesale (DO-blocks, CREATE ... IF NOT EXISTS,
-- DROP ... IF EXISTS, idempotent seed INSERTs).
--------------------------------------------------------------------------------

-- B11b-0. clients.suspended (S-09): suspended tenants fail closed at login
-- with 200 {suspended:true} and no data; GE-only suspend/unsuspend.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'suspended') THEN
    ALTER TABLE clients ADD COLUMN suspended BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

-- B11b-0. users.must_change_password (S-12): provisioned accounts start true;
-- login forces change before any other action (fail-closed 403 gate).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'must_change_password') THEN
    ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

-- B11b-D. staff_lists: CLIENT_MGR (client_admin) submits staff as DRAFTS;
-- GE approves (provisions users, OTP once) or rejects with reason (S-11/S-12).
-- FORBIDDEN: client creates accounts directly — only GE approval provisions.
CREATE TABLE IF NOT EXISTS staff_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  submitted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  note TEXT,
  reject_reason TEXT,
  decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
  decided_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- B11b-D. staff_list_rows: one row per proposed staff member (demo PII is
-- owner-supplied sample addresses only; never log OTPs).
CREATE TABLE IF NOT EXISTS staff_list_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID NOT NULL REFERENCES staff_lists(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  department_name TEXT,
  role TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('employee', 'client_admin')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(list_id, email)
);

-- B11b RLS: tenant pattern (ge_admin sees all; same-tenant roles read;
-- write scoping enforced in routes: client_admin submits own lists only,
-- ge_admin approves/rejects any list).
ALTER TABLE staff_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_list_rows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_lists_isolation_policy ON staff_lists;
CREATE POLICY staff_lists_isolation_policy ON staff_lists
  FOR ALL
  USING (
    current_setting('app.current_user_role', true) = 'ge_admin'
    OR client_id::text = current_setting('app.current_tenant_id', true)
  );

DROP POLICY IF EXISTS staff_list_rows_isolation_policy ON staff_list_rows;
CREATE POLICY staff_list_rows_isolation_policy ON staff_list_rows
  FOR ALL
  USING (
    current_setting('app.current_user_role', true) = 'ge_admin'
    OR EXISTS (
      SELECT 1 FROM staff_lists sl
      WHERE sl.id = staff_list_rows.list_id
        AND sl.client_id::text = current_setting('app.current_tenant_id', true)
    )
  );

ALTER TABLE staff_lists FORCE ROW LEVEL SECURITY;
ALTER TABLE staff_list_rows FORCE ROW LEVEL SECURITY;

-- Catalog definition only. A subscription always requires an explicit later operation.
INSERT INTO services (code, name, description)
VALUES ('GRI', 'GRI Reporting', 'GRI sustainability disclosure service')
ON CONFLICT (code) DO NOTHING;

--------------------------------------------------------------------------------
-- FIX BATCH 12 (demo) — in-app notifications (S-23). S-24 (audit read UI) and
-- S-01 (idle timeout) need no schema change; S-02 needs none either (bcrypt
-- hashes untouched, only self-chosen plaintext validation changes in lib/).
-- Same idempotency contract as FIX BATCH 1/8/9/10/11a/11b: safe to re-apply
-- wholesale (CREATE ... IF NOT EXISTS, DO-blocks, DROP ... IF EXISTS).
--
-- notifications: per-user inbox rows. Generated by the API on: evaluation
-- submitted (→ client_admin of tenant), approved/returned incl. client scope
-- (→ evaluator), item assigned (→ that department's users), action
-- verified/closed/reopened (→ owner dept users + client_admin), staff list
-- approved/rejected (→ submitter). Cap: latest 50 per user (enforced by the
-- API trim after insert); read state via read_at. No e-mail sending.
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  title_ar TEXT,
  body TEXT,
  body_ar TEXT,
  entity_type TEXT,
  entity_id UUID,
  read_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_notifications_user_created
  ON notifications(user_id, created_at DESC);

-- B12 RLS: tenant pattern (ge_admin sees all; same-tenant roles read their
-- own rows — the API always constrains user_id to the caller, so a client
-- role can never list another user's inbox; write scoping (fan-out inserts,
-- read-marking own rows only) is enforced in routes like previous batches).
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_isolation_policy ON notifications;
CREATE POLICY notifications_isolation_policy ON notifications
  FOR ALL
  USING (
    current_setting('app.current_user_role', true) = 'ge_admin'
    OR client_id::text = current_setting('app.current_tenant_id', true)
    OR client_id IS NULL
  );

ALTER TABLE notifications FORCE ROW LEVEL SECURITY;

--------------------------------------------------------------------------------
-- FIX BATCH 16 (demo) — client role realignment, department approval with head
-- (OD-08). Same idempotency contract as FIX BATCH 1/8/9/10/11a/11b/12: safe to
-- re-apply wholesale (DO-blocks guarded by catalogue checks).
--
-- B16-A1. departments.head_user_id: GE designates the department head per
-- department (nullable; SET NULL when the user is removed). When set, ONLY the
-- head may dept-approve/return that department's evaluations; when NULL, any
-- member of the department may. Pre-existing rows are unaffected (NULL head).
--------------------------------------------------------------------------------

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'departments' AND column_name = 'head_user_id') THEN
    ALTER TABLE departments ADD COLUMN head_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

--------------------------------------------------------------------------------
-- TASK-PROTO-H13 — app_settings: the ONE platform-wide app theme row.
-- Resolution order is global -> tenant -> 'ge', so this row is the only place a
-- platform administrator can make one theme rule the whole application. Exactly
-- one row (id pinned to 1); an absent row means 'auto' (follow clients.theme),
-- which is why nothing is seeded here.
-- No CHECK constraint on theme on purpose: the allowed set (ge|lime|dark, NULL =
-- auto) is enforced at the single trusted write boundary (PUT /settings), and any
-- legacy or unknown stored value is read as 'auto' by the session layer instead
-- of failing a row — the same rule clients.theme follows.
-- This table is display-only and carries no tenant data, so SELECT is open: the
-- session resolver reads it while the request identity is still being built
-- (login / auth session), i.e. before any tenant context exists. Every write is
-- restricted to the server-selected platform configuration purpose.
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS app_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  theme TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings FORCE ROW LEVEL SECURITY;

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


--------------------------------------------------------------------------------
-- D-H01-01 (TASK-PROTO-H12) — clients.theme: the tenant's display theme is a
-- server-owned property, broadcast in the session payload and mirrored by the
-- client. Default 'ge' keeps every existing tenant unchanged.
-- No CHECK constraint on purpose: the allowed set (ge|lime|dark) is enforced at
-- the single trusted write boundary (PATCH /clients/:id), and any legacy/unknown
-- stored value is read as 'ge' by the session layer instead of failing a row.
--------------------------------------------------------------------------------

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'clients' AND column_name = 'theme') THEN
    ALTER TABLE clients ADD COLUMN theme TEXT NOT NULL DEFAULT 'ge';
  END IF;
END $$;

--------------------------------------------------------------------------------
-- TASK-PROTO-U4-1a (OD-11 §4) — service-model extension: THREE additive columns.
-- No CHECK constraint on purpose: the allowed value set / size cap is enforced at
-- the single trusted write boundary (PATCH /services/:id, PATCH /clients/:id/
-- services/:serviceId and PATCH /workspace/services/:serviceId/visibility), so a
-- legacy/unknown stored value is read defensively instead of failing a row —
-- the same rule clients.theme follows.
--   1. items.attachment_required — mandatory attachment for non-'file' answers
--      (consumed by the U4-1b rules; model only in this unit).
--   2. services.settings — per-service rules/settings container (handler ≤ 8 KB).
--   3. client_services.client_field_mask — array of item fields hidden from the
--      CLIENT (C) reading that client-service; NULL = nothing hidden.
--------------------------------------------------------------------------------

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'items' AND column_name = 'attachment_required') THEN
    ALTER TABLE items ADD COLUMN attachment_required BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'settings') THEN
    ALTER TABLE services ADD COLUMN settings JSONB NOT NULL DEFAULT '{}'::jsonb;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'client_services' AND column_name = 'client_field_mask') THEN
    ALTER TABLE client_services ADD COLUMN client_field_mask JSONB NULL;
  END IF;
END $$;

--------------------------------------------------------------------------------
-- TASK-PROTO-U4-1c (OD-12 §3–§8) — department documents, department initiative
-- status, and ONE evidence-file surface shared by both.
--
-- Same idempotency contract as every FIX BATCH above: this file is re-applied
-- wholesale by the explicit empty-install initializer, so every statement is a
-- DO-block guarded by a catalogue check, CREATE ... IF NOT EXISTS or DROP ... IF
-- EXISTS. Additive only — no existing column, row, policy or grant is changed.
--
-- NO business CHECK constraints on purpose (task §1 discipline): the 5 MB cap +
-- MIME allowlist (mirrored from the existing attachment path), the tags/
-- indicator lengths, the entity_type domain and the submission lock are all
-- enforced at the ONE trusted handler boundary, so a legacy or unknown stored
-- value is read defensively instead of failing a row — the same rule
-- the tenant theme column follows.
--
-- RLS: enabled AND forced here; the row-scope policies themselves live in
-- b17-content.sql (B17 U2D), because b17.sql's activation block replaces EVERY
-- predecessor policy — a policy defined only here would not survive a fresh
-- install (exactly the H13 app_settings precedent).
--------------------------------------------------------------------------------

-- U4-1c-A. items: workbook indicator code + free tags (OD-12 §5/§6).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'items' AND column_name = 'indicator_code') THEN
    ALTER TABLE items ADD COLUMN indicator_code TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'items' AND column_name = 'tags') THEN
    ALTER TABLE items ADD COLUMN tags TEXT[] NOT NULL DEFAULT '{}';
  END IF;
END $$;

-- U4-1c-B. document_requirements: the department document list (OD-12 §3).
-- department_id NULL = the requirement applies to every department of the
-- client. service_id ties the requirement to the ONE service catalog entry.
-- Round 2 (F-05/L-03): the requirement is CLIENT-scoped — client_id is added by
-- the DO-block below (NOT inside this CREATE) so a fresh install and the
-- one-transaction live delta produce the SAME column ordinal, index and
-- constraint names, i.e. one structural fingerprint for both states.
CREATE TABLE IF NOT EXISTS document_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  department_id UUID REFERENCES departments(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  required BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'document_requirements' AND column_name = 'client_id') THEN
    ALTER TABLE document_requirements ADD COLUMN client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE;
  END IF;
END $$;

-- U4-1c-B2 (round 2): one title per (client, service, department). PostgreSQL
-- treats NULL department_id as distinct, so the department-agnostic case gets
-- its own partial unique index — otherwise the same general title could repeat.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'document_requirements_client_service_department_title_key') THEN
    ALTER TABLE document_requirements ADD CONSTRAINT document_requirements_client_service_department_title_key
      UNIQUE (client_id, service_id, department_id, title);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_document_requirements_general_title
  ON document_requirements(client_id, service_id, title) WHERE department_id IS NULL;

-- U4-1c-C. document_submissions: ONE row per (client, department, requirement).
-- submitted_at is the submission stamp: once set, the proof files are locked
-- (append-only), mirroring the U4-1b evidence lock. Round 2 (H-01): the
-- requirement FK is ON DELETE RESTRICT — a platform delete can never cascade a
-- department's submission away; the delete handler maps the FK refusal to 409
-- documents.dependency.
CREATE TABLE IF NOT EXISTS document_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  requirement_id UUID NOT NULL REFERENCES document_requirements(id) ON DELETE RESTRICT,
  provided BOOLEAN NOT NULL DEFAULT false,
  note TEXT,
  tag TEXT,
  submitted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(client_id, department_id, requirement_id)
);

-- U4-1c-D. initiative_department_status: ONE row per (selected initiative,
-- department) — performed/note + the independent proof files (OD-12 §8).
CREATE TABLE IF NOT EXISTS initiative_department_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_initiative_id UUID NOT NULL REFERENCES client_initiatives(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  performed BOOLEAN NOT NULL DEFAULT false,
  note TEXT,
  submitted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(client_initiative_id, department_id)
);

-- U4-1c-E. evidence_files: the unified proof store for document submissions and
-- department initiative statuses (answer attachments stay in
-- evidence_attachments untouched). entity_type is validated in the handler
-- (document_submission | initiative_status); content stays in DB bytea at
-- demo scale exactly like evidence_attachments (OD-06), with the 5 MB/MIME
-- rules enforced by the upload handler.
CREATE TABLE IF NOT EXISTS evidence_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  department_id UUID REFERENCES departments(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  content BYTEA NOT NULL,
  uploaded_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_document_requirements_service ON document_requirements(service_id);
CREATE INDEX IF NOT EXISTS ix_document_submissions_client_dept ON document_submissions(client_id, department_id);
CREATE INDEX IF NOT EXISTS ix_initiative_department_client_dept ON initiative_department_status(client_initiative_id, department_id);
CREATE INDEX IF NOT EXISTS ix_evidence_files_parent ON evidence_files(client_id, entity_type, entity_id);

-- U4-1c-F. Row security posture. Policies: b17-content.sql (B17 U2D).
ALTER TABLE document_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE initiative_department_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE evidence_files ENABLE ROW LEVEL SECURITY;

ALTER TABLE document_requirements FORCE ROW LEVEL SECURITY;
ALTER TABLE document_submissions FORCE ROW LEVEL SECURITY;
ALTER TABLE initiative_department_status FORCE ROW LEVEL SECURITY;
ALTER TABLE evidence_files FORCE ROW LEVEL SECURITY;