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
CREATE TABLE IF NOT EXISTS actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  item_id UUID REFERENCES items(id) ON DELETE SET NULL,
  owner_department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  due_date DATE,
  status TEXT NOT NULL CHECK (status IN ('open', 'in_progress', 'awaiting_verification', 'closed')),
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
DROP POLICY IF EXISTS items_isolation_policy ON items;
CREATE POLICY items_isolation_policy ON items
  FOR ALL
  USING (
    current_setting('app.current_user_role', true) IN ('ge_admin', 'client_admin')
    OR current_setting('app.current_user_role', true) IS NULL
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
