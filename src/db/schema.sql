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
