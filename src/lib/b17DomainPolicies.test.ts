import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  B17_SHAPE, B17_CONTENT_SHAPE, B17_CONTENT_VERSION, STRUCTURE_SQL,
  CONTENT_AUTHORITY_SQL, b17Source, b17ContentSource,
} from '../db/b17Readiness.ts';

const sql = readFileSync(new URL('../db/b17-content.sql', import.meta.url), 'utf8');
const section = (from: string, to: string) => sql.slice(sql.indexOf(from), sql.indexOf(to, sql.indexOf(from) + 1));

test('U2-B0 policy substrate exists for all four domains and stays row-scope only', () => {
  for (const policy of [
    'CREATE POLICY b17_notifications ON notifications FOR SELECT',
    'CREATE POLICY b17_notifications_update ON notifications FOR UPDATE',
    'CREATE POLICY b17_attachments ON evidence_attachments FOR SELECT',
    'CREATE POLICY b17_attachments_insert ON evidence_attachments FOR INSERT',
    'CREATE POLICY b17_attachments_delete ON evidence_attachments FOR DELETE',
    'CREATE POLICY b17_actions_insert ON actions FOR INSERT',
    'CREATE POLICY b17_actions_update ON actions FOR UPDATE',
    'CREATE POLICY b17_audit_read ON audit_log FOR SELECT',
    'CREATE POLICY b17_audit_insert ON audit_log FOR INSERT',
    // U2-B round 3 (task §19(1), §20 D2): the fan-out/trim policies now exist.
    'CREATE POLICY b17_notifications_insert ON notifications FOR INSERT',
    'CREATE POLICY b17_notifications_delete ON notifications FOR DELETE',
    'CREATE POLICY b17_domain_users_read ON users FOR SELECT',
  ]) assert.ok(sql.includes(policy), policy);
  // No DROP of the append-only, freeze or snapshot immutability triggers.
  assert.ok(!/DROP TRIGGER/i.test(sql));
  assert.ok(!sql.includes('block_audit_log_modification() RETURNS'));
  assert.ok(!/5242880|size_bytes\s+INT/i.test(sql));
  // The platform predicate is invoker-only: a definer here would be an oracle.
  const platform = section('CREATE FUNCTION b17_platform_scope', 'DROP POLICY b17_notifications');
  assert.ok(!platform.includes('SECURITY DEFINER'));
  assert.ok(platform.includes("b17_setting('current_mode')='platform'"));
  assert.ok(platform.includes("b17_setting('current_tenant_id') IS NULL"));
});

test('U2-B0 notifications scope is P platform / W own-A / C own-company / E denied', () => {
  const read = section('CREATE POLICY b17_notifications ON notifications', 'CREATE POLICY b17_notifications_update');
  assert.ok(read.includes('user_id::text=b17_setting(\'current_actor_id\')'), 'own rows only');
  assert.ok(read.includes('b17_platform_scope() AND client_id IS NULL'), 'P platform rows');
  assert.ok(read.includes('b17_work_tenant(client_id)'), 'W/C own tenant rows');
  assert.ok(read.includes("b17_setting('current_mode')<>'employee'"), 'E denied');
  const update = section('CREATE POLICY b17_notifications_update', '-- evidence_attachments');
  assert.ok(update.includes('WITH CHECK'), 'read/read-all may not move a row out of scope');
  assert.ok(update.includes('b17_platform_scope()') && update.includes('b17_work_tenant(client_id)'));
});

test('U2-B round 3 + U2-F round 1: notify fan-out/trim is work- OR P@T-context + tenant/recipient bound; users SELECT is narrowly scoped', () => {
  // §19(1) / §20 D1+D2: the server-side notify context and the cap-trim.
  const insert = section('CREATE POLICY b17_notifications_insert', 'CREATE POLICY b17_notifications_delete');
  assert.ok(insert.includes('WITH CHECK'), 'INSERT must carry WITH CHECK');
  assert.ok(insert.includes('b17_work_tenant(client_id)'), 'insert requires the caller own work tenant');
  assert.ok(insert.includes('EXISTS(SELECT 1 FROM users u WHERE u.id=user_id AND u.client_id=client_id)'),
    'recipient must be a member of that tenant: cross-tenant/cross-user recipients refused');
  // U2-F round 1 (SHIELD-U2F-01): the U2-B0 "no caller until U2-F" promise is
  // now kept — a P@T configuration transaction fans out inside EXPLICIT TARGET T
  // only, with the same membership check; no b17_platform_scope branch crept in.
  assert.ok(!insert.includes('b17_platform_scope'), 'the P@T fan-out is target-bound, never the platform summary context');
  assert.ok(insert.includes('b17_platform_config()') && insert.includes('target_id'),
    'P@T fan-out branch exists for assignment-create/staff-reject');
  const del = section('CREATE POLICY b17_notifications_delete', '-- D1 (task');
  assert.ok(del.includes('b17_work_tenant(client_id)'), 'trim is scoped to the caller own work tenant');
  assert.ok(del.includes('u.id=user_id AND u.client_id=client_id'),
    'cap-trim deletes own inbox rows only: never platform rows, never another tenant rows');
  assert.ok(del.includes('b17_platform_config()'), 'U2-F: the P@T cap-trim twin exists');
  // §19(1): the cap-trim needs a recipient-row identity signal, because a
  // DELETE with a WHERE clause also has the SELECT policy enforced (PG18).
  const read = section('CREATE POLICY b17_notifications ON notifications', 'CREATE POLICY b17_notifications_update');
  assert.ok(read.includes("user_id::text=b17_setting('notify_trim_target')"),
    'trim-target branch lets the notify insert mark exactly the inbox being trimmed');
  assert.ok(read.includes("b17_setting('current_purpose') IN ('work','platform.config')"),
    'trim-target branch is purpose-bound (work + the U2-F P@T configuration twin)');
  assert.ok(read.includes("user_id::text=b17_setting('current_actor_id')"), 'own-row identity retained for inbox reads');
  assert.ok(sql.includes('CREATE TRIGGER b17_notify_target BEFORE INSERT ON notifications'),
    'every notifications insert marks its recipient for the same-transaction trim');
  assert.ok(sql.includes('CREATE FUNCTION b17_notify_target() RETURNS trigger'),
    'the signal is an invoker-only trigger function, never a definer');
  const notifyFn = section('CREATE FUNCTION b17_notify_target', 'CREATE TRIGGER b17_notify_target');
  assert.ok(!notifyFn.includes('SECURITY DEFINER'), 'b17_notify_target must not be a SECURITY DEFINER');
  // §20 D1: the narrowly-scoped users SELECT (two server-selected branches).
  const users = section('CREATE POLICY b17_domain_users_read', '-- evidence_attachments');
  assert.ok(!users.includes('SECURITY DEFINER'), 'invoker-only policy, no new definer');
  assert.ok(users.includes("b17_setting('current_purpose')='work'"), 'work branch is purpose-bound');
  assert.ok(users.includes('b17_platform_scope() AND client_id IS NULL'), 'P resolves platform-event actors only');
  assert.ok(users.includes('b17_work_tenant(client_id)'), 'W/C/E resolve own-tenant actor rows');
  assert.ok(users.includes("b17_setting('current_purpose') IS NULL")
    && users.includes("b17_setting('current_session_id') IS NULL")
    && users.includes("id::text=b17_setting('current_actor_id')"),
    'F-03 fresh-gate branch: own row only, no purpose and no session');
});

test('U2-B0 attachment scope is parent-answer bound: E insert, E-uploader/W delete, C/P denied', () => {
  const read = section('CREATE POLICY b17_attachments ON evidence_attachments', 'CREATE POLICY b17_attachments_insert');
  assert.ok(read.includes('EXISTS(SELECT 1 FROM answers a WHERE a.id=answer_id'));
  assert.ok(read.includes('b17_item_visible(a.client_id,a.item_id)'));
  assert.ok(read.includes("b17_content_fact('assigned',a.client_id,a.item_id)"));
  const insert = section('CREATE POLICY b17_attachments_insert', 'CREATE POLICY b17_attachments_delete');
  assert.ok(insert.includes("b17_setting('current_mode')='employee'"), 'upload is E-only');
  assert.ok(insert.includes("uploaded_by::text=b17_setting('current_actor_id')"), 'uploader is the actor');
  const del = section('CREATE POLICY b17_attachments_delete', '-- actions:');
  assert.ok(del.includes("b17_setting('current_mode')='employee'") && del.includes('uploaded_by::text='));
  assert.ok(del.includes("b17_setting('current_mode')='consultant'"), 'scoped GE delete authority');
  assert.ok(!del.includes("b17_setting('current_mode')='client'"), 'C delete denied');
});

test('U2-B0 action scope is W create / W+C update with no WF-04 logic in SQL', () => {
  const create = section('CREATE POLICY b17_actions_insert', 'CREATE POLICY b17_actions_update');
  assert.ok(create.includes("b17_setting('current_mode')='consultant'"), 'create is W-only');
  assert.ok(create.includes('b17_work_tenant(client_id)'));
  assert.ok(create.includes("b17_content_fact('department',client_id,owner_department_id)"));
  assert.ok(create.includes("WHEN item_id IS NULL"), 'standalone needs an explicit linked service');
  const update = section('CREATE POLICY b17_actions_update', '-- audit_log:');
  assert.ok(update.includes("b17_setting('current_mode')<>'employee'"), 'E denied');
  assert.ok(update.includes("b17_content_fact('corrective',client_id,item_id,service_id)"), 'C visible/owned rows');
  assert.ok(update.includes('WITH CHECK'));
  // WF-04 transition legality + required reason are handler rules (src/lib/actions.ts).
  for (const state of ['awaiting_verification', 'reopened', "'closed'", "'in_progress'"])
    assert.ok(!create.includes(state) && !update.includes(state), `no WF-04 state in policies: ${state}`);
});

test('U2-B0+E2 audit scope is P platform-events / W A-filtered / C-E general-log denied, business INSERT under work', () => {
  const read = section('CREATE POLICY b17_audit_read', 'DROP POLICY b17_audit_insert');
  assert.ok(read.includes('b17_platform_scope() AND client_id IS NULL'), 'P platform events only');
  assert.ok(read.includes("b17_work_tenant(client_id) AND b17_setting('current_mode')='consultant'"), 'W A-filtered');
  // §9(a) ruling (SHIELD-U2E-E2-HISTORY): the ONLY C/E admission is the narrow
  // ITEM-LOCAL history branch — purpose-bound, entity-whitelisted and
  // ownership-resolved. There is no other C/E path through the general feed.
  assert.equal((read.match(/entity_type='evaluations'/g) ?? []).length, 1,
    'exactly one entity-whitelisted item-local history branch');
  assert.ok(read.includes("b17_setting('current_purpose')='work'"), 'history branch is purpose-bound');
  assert.ok(read.includes("b17_content_fact('evaluation',e.client_id,e.id)"),
    'E needs own-department provenance (G-SHARED fail-closed)');
  assert.ok(read.includes('b17_item_visible(e.client_id,e.item_id)'), 'ownership resolved to a linked item');
  assert.ok(!read.includes("'client'"), 'no client-mode branch outside the history grant');
  const insert = section('CREATE POLICY b17_audit_insert', '-- U2-B0 adds row scope only');
  assert.ok(insert.includes("IN ('auth.login','auth.password','auth.bootstrap')"), 'U1 auth branch retained');
  assert.ok(insert.includes("action IN ('WORKSPACE_ENTER','WORKSPACE_EXIT')"), 'U1 workspace branch retained');
  assert.ok(insert.includes('OR b17_work_tenant(client_id)'), 'business INSERT under work context');
  assert.ok(insert.includes("user_id::text=b17_setting('current_actor_id')"), 'actor-bound');
});

test('U2-E E-2 write substrate: only the §3.3 contexts gain INSERT/UPDATE, no DELETE, no new definer', () => {
  const sql = readFileSync(new URL('../db/b17-content.sql', import.meta.url), 'utf8');
  // Exactly these five tables gain a write policy (task §4.1 / SHIELD-U2E-E2).
  for (const [table, cmd, policy] of [
    ['answers', 'INSERT', 'b17_answers_draft_insert'],
    ['answers', 'UPDATE', 'b17_answers_workflow_update'],
    ['evaluations', 'INSERT', 'b17_evaluations_draft_insert'],
    ['evaluations', 'UPDATE', 'b17_evaluations_workflow_update'],
    ['approvals', 'INSERT', 'b17_approvals_insert'],
    ['review_snapshots', 'INSERT', 'b17_review_snapshots_insert'],
    ['snapshot_notes', 'INSERT', 'b17_snapshot_notes_insert'],
  ] as const) {
    assert.ok(sql.includes(`CREATE POLICY ${policy} ON ${table} FOR ${cmd}`), `${policy} must exist`);
  }
  // Nothing else in the tenant surface mutates: no DELETE anywhere on them,
  // no UPDATE on the immutable snapshot tables. The U2-F round-1 exception is
  // EXACTLY the §3.4 link/unlink/flags + assignment-unlink set below (task §3(1),
  // SHIELD-U2F-01) — still target-bound platform configuration, never a work
  // context, never an answers/evaluations/approvals DELETE.
  for (const [table, cmd] of [
    ['answers', 'DELETE'], ['evaluations', 'DELETE'], ['approvals', 'UPDATE'], ['approvals', 'DELETE'],
    ['review_snapshots', 'UPDATE'], ['review_snapshots', 'DELETE'],
    ['snapshot_notes', 'UPDATE'], ['snapshot_notes', 'DELETE'],
    ['assignments', 'UPDATE'], ['departments', 'DELETE'], ['users', 'DELETE'], ['clients', 'DELETE'],
  ] as const)
    assert.ok(!sql.includes(`ON ${table} FOR ${cmd}`), `no ${cmd} policy on ${table}`);
  // G-SHARED stays fail-closed: the draft INSERTs are own-department/actor
  // bound, and the UPDATE policies carry the provenance facts (the INSERT path
  // cannot re-read the table it is writing — see the note in b17-content.sql).
  for (const [policy, pred] of [
    ['b17_answers_draft_insert', "department_id::text=b17_setting('current_user_department_id')"],
    ['b17_answers_draft_insert', "submitted_by::text=b17_setting('current_actor_id')"],
    ['b17_evaluations_draft_insert', "evaluator_id::text=b17_setting('current_actor_id')"],
    ['b17_evaluations_draft_insert', "b17_item_visible(client_id,item_id)"],
    ['b17_evaluations_workflow_update', "b17_content_fact('evaluation',client_id,id)"],
    ['b17_answers_workflow_update', "b17_content_fact('assigned',client_id,item_id)"],
  ] as const)
    assert.ok(sql.slice(sql.indexOf(`CREATE POLICY ${policy}`)).includes(pred),
      `${policy} keeps ${pred}`);
  // No new definer: the E-2 delta adds zero SECURITY DEFINER functions, so the
  // sanctioned set (b17_catalog_child_count, b17_content_fact) is untouched.
  assert.equal((sql.match(/SECURITY DEFINER\s*\nSET search_path/g) ?? []).length, 2);
});

test('U2-E E-3: truthful §8 preflight kind (ruling 1) + approvals provenance pin (ruling 3)', () => {
  const sql = readFileSync(new URL('../db/b17-content.sql', import.meta.url), 'utf8');
  // Ruling 1 / SHIELD-U2E-E3: a closed-list kind whose guard admits EXACTLY the
  // W + ge_admin + consultant + own-bound-tenant context.
  assert.equal((sql.match(/tenant\.unmapped_assignments/g) ?? []).length, 3,
    'the kind appears exactly three times: closed kind list, guard, CASE arm');
  assert.ok(sql.includes("ref::text = b17_setting('current_tenant_id')"),
    'the preflight is pinned to the caller own bound tenant (never a foreign T)');
  assert.ok(sql.includes("b17_setting('current_mode')='consultant'"),
    'the preflight is W (consultant) only — not a platform context');
  assert.ok(sql.includes("NOT b17_content_fact('linked',ref,a.item_id)"),
    'the count sees UNMAPPED assignments through the linked fact (not through b17_item_visible)');
  // The platform.config kinds keep their own guard: a P context must not reach
  // the tenant kind and the tenant context must not reach the catalog kinds.
  assert.ok(/kind = 'tenant\.unmapped_assignments' THEN[\s\S]{0,2000}?RAISE EXCEPTION 'b17\.count_context'; END IF;\s*ELSIF/
    .test(sql),
    'the tenant kind fails closed outside its own context (before the catalog guard)');
  assert.ok(/ELSIF NOT coalesce\(\(b17_setting\('current_purpose'\)='platform\.config'[\s\S]{0,500}?b17\.count_context/.test(sql),
    'the catalog kinds keep the platform.config guard');
  // Ruling 3 / SHIELD-U2E-E2-01: approvals stamps an answer the caller can see.
  const approvals = sql.slice(sql.indexOf('CREATE POLICY b17_approvals_insert'));
  assert.ok(approvals.includes('b17_item_visible(a.client_id,a.item_id)'), 'approvals is item-visible pinned');
  assert.ok(approvals.includes("a.department_id::text=b17_setting('current_user_department_id')"),
    'approvals carries the own-department pin for E');
  assert.ok(approvals.includes("b17_content_fact('assigned',a.client_id,a.item_id)"),
    'approvals carries the assigned-item fact for E');
  assert.ok(!/CREATE POLICY \w+ ON approvals FOR (UPDATE|DELETE)/.test(sql),
    'approvals stays append-only (no UPDATE/DELETE policy)');
});

test('U2-B0 readiness fingerprints cover the policy delta and keep refusal paths', () => {
  assert.equal(B17_CONTENT_VERSION, 'B17_U2D');
  assert.match(B17_SHAPE, /^[0-9a-f]{32}$/);
  assert.match(B17_CONTENT_SHAPE, /^[0-9a-f]{32}$/);
  assert.notEqual(B17_CONTENT_SHAPE, B17_SHAPE);
  // Structure fingerprint enumerates policies, triggers, functions and ACLs.
  assert.ok(STRUCTURE_SQL.includes("FROM pg_policies WHERE schemaname='public'"));
  assert.ok(STRUCTURE_SQL.includes('NOT t.tgisinternal'));
  assert.ok(STRUCTURE_SQL.includes('content_authority'));
  assert.ok(STRUCTURE_SQL.includes(CONTENT_AUTHORITY_SQL));
  assert.ok(CONTENT_AUTHORITY_SQL.includes("q.prosecdef AND left(q.proname,4)='b17_'"));
  assert.equal(b17Source().checksum.length, 64);
  assert.equal(b17ContentSource().checksum.length, 64);
  assert.notEqual(b17ContentSource().checksum, b17Source().checksum);
});

test('U2-C1 substrate: catalog P policies, platform.config target policies, audit branches, bound/freeze/count/DELETE-identity deltas', () => {
  // Catalog SELECT: W/C/E fact predicates retained; both P contexts admitted.
  for (const [policy, pred] of [
    ['b17_items ON items FOR SELECT', 'b17_item_visible('],
    ['b17_standards ON standards FOR SELECT', "b17_parent_visible('standard',id)"],
    ['b17_disclosures ON disclosures FOR SELECT', "b17_parent_visible('disclosure',id)"],
    ['b17_services ON services FOR SELECT', "b17_parent_visible('service',id)"],
    ['b17_service_standards ON service_standards FOR SELECT', "b17_parent_visible('service',service_id)"],
    ['b17_item_links ON item_links FOR SELECT', 'b17_item_visible('],
  ] as const) {
    const from = sql.indexOf(`CREATE POLICY ${policy}`);
    assert.ok(from >= 0, policy);
    const body = sql.slice(from, sql.indexOf(';', from));
    assert.ok(body.includes(pred), `${policy}: W/C/E predicate retained`);
    assert.ok(body.includes('b17_platform_scope()') && body.includes('b17_platform_config()'),
      `${policy}: both P contexts admitted`);
  }
  // Catalog mutation: only the six global catalog tables, only from P contexts.
  for (const table of ['services', 'standards', 'disclosures', 'items', 'service_standards', 'item_links']) {
    for (const cmd of ['INSERT', 'UPDATE', 'DELETE'])
      assert.ok(new RegExp(`CREATE POLICY b17_catalog_config_${cmd.toLowerCase()} ON public\\.%I FOR ${cmd}`).test(sql),
        `catalog ${cmd} policy loop covers ${table}`);
  }
  assert.ok(sql.includes('WITH CHECK (b17_platform_scope() OR b17_platform_config())'));
  // U2-C1 itself gained NO mutation surface (assignments/departments stayed
  // read-only THERE); the U2-F round-1 SHIELD-U2F-01 delta is the sanctioned,
  // target-bound link/unlink + assignment-UNLINK set — pinned by its own test
  // below — and the answers/evaluations write policies remain the SEPARATE,
  // §4.1-authorized U2-E E-2 E-0 delta pinned above. Never deleted: answers,
  // evaluations, approvals, snapshots, users.
  // U2-F round 2 SUPERSEDES part of this list: users INSERT/UPDATE now exist
  // (SHIELD-U2F-01 provisioning extension, pinned by its own test below) —
  // what must still hold: no DELETE anywhere on them and assignments/
  // departments stay without DELETE/UPDATE beyond the sanctioned set.
  for (const [table, cmd] of [
    ['answers', 'DELETE'], ['evaluations', 'DELETE'],
    ['assignments', 'UPDATE'], ['departments', 'DELETE'], ['users', 'DELETE'],
  ] as const)
    assert.ok(!sql.includes(`ON ${table} FOR ${cmd}`), `no ${cmd} policy on ${table}`);
  // D2 target-bound configuration: only platform.config with explicit target.
  for (const policy of ['b17_config_clients_read', 'b17_config_departments_insert',
    'b17_config_departments_update', 'b17_config_assignments_read', 'b17_config_assignments_insert'])
    assert.ok(sql.includes(`CREATE POLICY ${policy}`), policy);
  const clientsRead = sql.slice(sql.indexOf('CREATE POLICY b17_config_clients_read'));
  assert.ok(clientsRead.slice(0, 400).includes("id::text=b17_setting('target_id')"), 'clients read is target-bound');
  // Targetless configuration may read department metadata only (never write).
  const deptRead = sql.slice(sql.indexOf('CREATE POLICY b17_config_departments_read'),
    sql.indexOf('CREATE POLICY b17_config_departments_insert'));
  assert.ok(deptRead.includes("(b17_setting('target_id') IS NULL"), 'targetless metadata read branch');
  assert.ok(deptRead.includes('client_id::text=b17_setting(\'target_id\')'), 'target-bound branch');
  // P audit config branches: closed catalog action list (NULL-client) + commit target-T.
  const audit = section('CREATE POLICY b17_audit_insert', '-- U2-B0 adds row scope only');
  for (const action of ['CREATE_SERVICE', 'DELETE_STANDARD', 'UNLINK_ITEMS', 'LINK_ITEMS', 'CREATE_ITEM'])
    assert.ok(audit.includes(`'${action}'`), `closed catalog action list: ${action}`);
  assert.ok(audit.includes('(b17_platform_scope() OR b17_platform_config()) AND client_id IS NULL'), 'NULL-client config audit');
  assert.ok(audit.includes("action='IMPORT_GRI_DISCLOSURES' AND entity_type='standards'"), 'target-T commit audit');
  assert.ok(audit.includes("b17_setting('target_id') IS NOT NULL"), 'commit audit requires explicit target');
  // D2 bound branch + freeze purpose: config identity only, never merged with
  // the tenant-NULL summary context, and tenant/identity must agree on T.
  const bound = section('CREATE FUNCTION b17_bound_tenant', 'CREATE FUNCTION b17_content_fact');
  assert.ok(bound.includes("b17_setting('current_purpose') IN ('platform.config','scope.internal')"),
    'bound_tenant platform branch is purpose-bound (config + fact re-entry)');
  assert.ok(bound.includes("t::text=b17_setting('target_id')"), 'bound to explicit target T');
  assert.ok(!bound.includes('b17_platform_scope'), 'bound branch never merges with the summary context');
  const frozen = section('CREATE OR REPLACE FUNCTION is_scope_frozen', 'CREATE FUNCTION b17_item_visible');
  assert.ok(frozen.includes("IN ('work','scope.internal','platform.config')"), 'freeze fact path admits platform.config');
  // platform.config predicate: invoker-only, purpose+actor+role, no table access.
  const config = section('CREATE FUNCTION b17_platform_config', '-- notifications: own inbox rows only');
  assert.ok(!config.includes('SECURITY DEFINER'), 'config predicate must not be a definer');
  assert.ok(config.includes("b17_setting('current_purpose')='platform.config'"));
  assert.ok(config.includes("b17_setting('current_user_role')='ge_admin'"));
  // D1 count helper visibility: ONLY the internal scope.counts purpose.
  const countRead = section('CREATE POLICY b17_count_read', 'DO $$ DECLARE');
  assert.ok(countRead.includes("b17_setting(''current_purpose'')=''scope.counts''"), 'count rows only under scope.counts');
  assert.ok(countRead.includes("b17_setting(''current_user_role'')=''ge_admin''"), 'count rows only in a GE actor context');
  assert.ok(sql.includes("'answers','evaluations','assignments','evidence_attachments'"), 'count policy covers tenant children');
  assert.equal((sql.match(/b17_catalog_child_count/g) ?? []).length >= 3, true, 'count fn defined + REVOKE + GRANT');
  assert.equal((sql.match(/set_config\('app.current_purpose','scope.counts'/g) ?? []).length, 1,
    'scope.counts is set in exactly one place: inside the count definer');
});

test('U2-F round 1: SHIELD-U2F-01 admin substrate — summary reads, target-bound link/unlink, W/C drafts, W-only N/A, admin audit, blocker kinds', () => {
  const src = readFileSync(new URL('../db/b17-content.sql', import.meta.url), 'utf8');
  // (1) §5 fixed-aggregate summary reads: ONLY a P platform WORK context, only
  // on the four tables the P /clients progress + /ge/overview totals need.
  const summary = src.slice(src.indexOf('FOREACH t IN ARRAY ARRAY[\'assignments\''),
    src.indexOf('END $$;', src.indexOf('FOREACH t IN ARRAY ARRAY[\'assignments\'')));
  assert.ok(/ARRAY\['assignments','answers','review_snapshots','client_services'\]/.test(summary),
    'the summary-read loop covers exactly assignments/answers/review_snapshots/client_services');
  assert.ok(summary.includes('b17_platform_config()') && summary.includes('target_id\'\') IS NULL'),
    'summary read is the NULL-target platform configuration context ONLY (§5 fixed-aggregate exception)');
  assert.ok(!summary.includes('b17_platform_scope'),
    'no work-purpose platform branch remains: c-proof R5 keeps answers unreachable there');
  assert.ok(!summary.includes('evaluations'), 'P never gains an evaluations summary read (no score surface)');
  // (2) clients: list/overview read + targetless create + target-bound update.
  assert.ok(src.includes('CREATE POLICY b17_admin_clients_read ON clients FOR SELECT'), 'clients summary read');
  assert.ok(src.includes('CREATE POLICY b17_admin_clients_insert ON clients FOR INSERT'), 'clients targetless create');
  assert.ok(src.includes('CREATE POLICY b17_admin_clients_update ON clients FOR UPDATE'), 'clients target-bound update');
  // (3) client_services link/flag/unlink: P@T bound; link-all only under a NULL target.
  for (const cmd of ['INSERT', 'UPDATE', 'DELETE'])
    assert.ok(src.includes(`CREATE POLICY b17_admin_links_${cmd.toLowerCase()} ON client_services FOR ${cmd}`),
      `client_services ${cmd} exists for §3.4 rows 12/13/14/15`);
  const unlink = src.slice(src.indexOf('CREATE POLICY b17_admin_links_delete'));
  assert.ok(unlink.slice(0, 300).includes("target_id') IS NOT NULL"), 'unlink is target-bound (never bulk)');
  const linkInsert = src.slice(src.indexOf('CREATE POLICY b17_admin_links_insert'), src.indexOf('CREATE POLICY b17_admin_links_update'));
  assert.ok(linkInsert.includes("target_id') IS NULL"), 'link-all bulk needs the explicit NULL-target context');
  assert.ok(linkInsert.includes("current_mode')='platform'"), 'link insert is platform mode only');
  // (4) assignments: DELETE is target-bound and that is the ONLY new command.
  const asgDelete = src.slice(src.indexOf('CREATE POLICY b17_admin_assignments_delete'));
  assert.ok(asgDelete.slice(0, 300).includes("client_id::text=b17_setting('target_id')"), 'assignment unlink is target-bound');
  // (5) staff drafts: C/W insert own-tenant DRAFT rows; work UPDATE pinned to
  // submitted/rejected (a work context can never mint 'approved' = provision);
  // P reject/approve shares one explicit target-bound branch.
  const staffInsert = src.slice(src.indexOf('CREATE POLICY b17_admin_staff_insert'), src.indexOf('CREATE POLICY b17_admin_staff_update'));
  assert.ok(staffInsert.includes("status='draft'"), 'draft insert only');
  assert.ok(staffInsert.includes('submitted_by::text'), 'submitter is the actor');
  const staffUpdate = src.slice(src.indexOf('CREATE POLICY b17_admin_staff_update'), src.indexOf('CREATE POLICY b17_admin_staff_rows_read'));
  assert.ok(staffUpdate.includes("status IN ('submitted','rejected')"), 'work context may only write submitted/rejected');
  assert.ok(staffUpdate.includes('WITH CHECK'), 'staff UPDATE carries WITH CHECK');
  assert.ok(src.includes('CREATE POLICY b17_admin_staff_rows_insert ON staff_list_rows FOR INSERT'), 'draft row insert');
  assert.ok(src.includes('CREATE POLICY b17_admin_staff_read ON staff_lists FOR SELECT'), 'staff read (summary + P@T)');
  // (6) NA shortcut: W consultant GE only, N/A row only, retained assignment.
  for (const policy of ['b17_answers_na_insert', 'b17_evaluations_na_insert'])
    assert.ok(src.includes(`CREATE POLICY ${policy} ON`), policy);
  const naEval = src.slice(src.indexOf('CREATE POLICY b17_evaluations_na_insert'));
  assert.ok(naEval.slice(0, 600).includes('not_applicable'), 'N/A evaluation must be not_applicable');
  assert.ok(naEval.slice(0, 600).includes('score IS NULL'), 'no score can be minted through the N/A shortcut');
  assert.ok(naEval.slice(0, 600).includes("'current_mode')='consultant'"), 'N/A insert is W (consultant) only');
  assert.ok(naEval.slice(0, 600).includes('EXISTS(SELECT 1 FROM assignments'), 'retained assignment required');
  // (7) admin configuration audit: closed action lists, targetless + target-bound.
  const audit = section('CREATE POLICY b17_audit_insert', '-- U2-B0 adds row scope only');
  for (const action of ['CREATE_CLIENT', 'LINK_SERVICE_ALL_TENANTS', 'CLIENT_SUSPENDED',
    'DEPARTMENT_HEAD_ASSIGNED', 'LINK_CLIENT_SERVICE', 'UNLINK_CLIENT_SERVICE',
    'ASSIGN_ITEM', 'UNASSIGN_ITEM', 'STAFF_LIST_REJECTED',
    'USER_CREATED', 'USER_DEACTIVATED', 'USER_REACTIVATED', 'STAFF_LIST_APPROVED'])
    assert.ok(audit.includes(`'${action}'`), `admin audit action: ${action}`);
  const targetlessAudit = audit.slice(audit.indexOf("b17_setting('target_id') IS NULL"),
    audit.indexOf("OR (b17_setting('target_id') IS NOT NULL", audit.indexOf("b17_setting('target_id') IS NULL")));
  assert.ok(!targetlessAudit.includes("'USER_CREATED'"), 'no targetless provisioning-audit branch');
  // (8) DELETE /assignments blockers: two tenant-scoped kinds, target-bound guard,
  // one integer each — never an answer/evaluation row in a P context.
  for (const kind of ['tenant.item.answers', 'tenant.item.evaluations'])
    assert.equal((src.match(new RegExp(kind.replace(/\./g, '\\.'), 'g')) ?? []).length >= 3, true,
      `${kind} appears in the closed kind list, its guard and its CASE arm`);
  const blockerGuard = src.slice(src.indexOf("ELSIF kind IN ('tenant.item.answers'"));
  assert.ok(blockerGuard.slice(0, 1600).includes("'platform.config'"), 'blocker kinds are platform.config-only');
  assert.ok(blockerGuard.slice(0, 1600).includes("target_id') IS NOT NULL"), 'blocker kinds need the explicit target T');
  // (9) No new definer, no PUBLIC grant, no answers/evaluations DELETE, no
  // users/clients DELETE: the sanctioned set and the REVOKE discipline hold.
  assert.equal((src.match(/SECURITY DEFINER\s*\nSET search_path/g) ?? []).length, 2);
  assert.ok(!/CREATE POLICY \w+ ON (answers|evaluations|approvals|users|clients|departments) FOR DELETE/.test(src));
});

test('U2-F round 2: provisioning substrate — users INSERT/UPDATE row scope, provisioning audit rows, no new definer', () => {
  const sql = readFileSync(new URL('../db/b17-content.sql', import.meta.url), 'utf8');
  // users INSERT = a tenant user under EXPLICIT target T only.
  // Under the legacy purpose-NULL context this INSERT was
  // denied outright (b17_bootstrap is auth.bootstrap-only) — Shield R2-B.
  const insert = sql.slice(sql.indexOf('CREATE POLICY b17_admin_users_insert'),
    sql.indexOf('CREATE POLICY b17_admin_users_update'));
  assert.ok(insert.includes('b17_platform_config()'), 'users INSERT is platform-configuration only');
  assert.ok(insert.includes("current_mode')='platform'"), 'platform mode pinned');
  assert.ok(/target_id'\) IS NOT NULL\s+AND client_id::text=b17_setting\('target_id'\)/.test(insert),
    'tenant branch is target-bound (P@T provisioning)');
  assert.ok(!insert.includes("IS NULL"), 'no NULL-target/tenant-less provisioning path');
  // users UPDATE = the target-bound deactivate/reactivate of §3.4 row 7; both
  // USING and WITH CHECK carry the target predicate (no cross-T rewrite, no
  // role/client_id movement possible through it).
  const update = sql.slice(sql.indexOf('CREATE POLICY b17_admin_users_update'));
  assert.ok(update.includes('WITH CHECK'), 'users UPDATE carries WITH CHECK');
  assert.equal((update.match(/client_id::text=b17_setting\('target_id'\)/g) ?? []).length, 2,
    'USING and WITH CHECK are both target-bound');
  // Final-SQL discipline re-asserted after the round-2 delta: no new definer,
  // no users DELETE, b17.sql trigger surface untouched (protected set diff).
  assert.equal((sql.match(/SECURITY DEFINER\s*\nSET search_path/g) ?? []).length, 2,
    'sanctioned definer set still exactly the two originals');
  assert.ok(!/CREATE POLICY \w+ ON users FOR DELETE/.test(sql), 'users stays without a DELETE policy');
  // (b17_revoke_inactive itself lives ONLY in b17.sql — proven by the empty-diff
  // of the protected set, not by this file's text.)
});
