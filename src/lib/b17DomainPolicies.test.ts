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

test('U2-B round 3: notify fan-out/trim is work-context + tenant/recipient bound; users SELECT is narrowly scoped', () => {
  // §19(1) / §20 D1+D2: the server-side notify context and the cap-trim.
  const insert = section('CREATE POLICY b17_notifications_insert', 'CREATE POLICY b17_notifications_delete');
  assert.ok(insert.includes('WITH CHECK'), 'INSERT must carry WITH CHECK');
  assert.ok(insert.includes('b17_work_tenant(client_id)'), 'insert requires the caller own work tenant');
  assert.ok(insert.includes('EXISTS(SELECT 1 FROM users u WHERE u.id=user_id AND u.client_id=client_id)'),
    'recipient must be a member of that tenant: cross-tenant/cross-user recipients refused');
  assert.ok(!insert.includes('b17_platform_scope'), 'platform fan-out stays deferred (no caller until U2-F)');
  const del = section('CREATE POLICY b17_notifications_delete', '-- D1 (task');
  assert.ok(del.includes('b17_work_tenant(client_id)'), 'trim is scoped to the caller own work tenant');
  assert.ok(del.includes('u.id=user_id AND u.client_id=client_id'),
    'cap-trim deletes own inbox rows only: never platform rows, never another tenant rows');
  assert.ok(!del.includes('b17_platform_scope'), 'no platform trim');
  // §19(1): the cap-trim needs a recipient-row identity signal, because a
  // DELETE with a WHERE clause also has the SELECT policy enforced (PG18).
  const read = section('CREATE POLICY b17_notifications ON notifications', 'CREATE POLICY b17_notifications_update');
  assert.ok(read.includes("user_id::text=b17_setting('notify_trim_target')"),
    'trim-target branch lets the notify insert mark exactly the inbox being trimmed');
  assert.ok(read.includes("b17_setting('current_purpose')='work'"), 'trim-target branch is purpose-bound');
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

test('U2-B0 audit scope is P platform-events / W A-filtered / C-E denied, business INSERT under work', () => {
  const read = section('CREATE POLICY b17_audit_read', 'DROP POLICY b17_audit_insert');
  assert.ok(read.includes('b17_platform_scope() AND client_id IS NULL'), 'P platform events only');
  assert.ok(read.includes("b17_work_tenant(client_id) AND b17_setting('current_mode')='consultant'"), 'W A-filtered');
  assert.ok(!read.includes("'client'") && !read.includes("'employee'"), 'C/E denied');
  const insert = section('CREATE POLICY b17_audit_insert', '-- U2-B0 adds row scope only');
  assert.ok(insert.includes("IN ('auth.login','auth.password','auth.bootstrap')"), 'U1 auth branch retained');
  assert.ok(insert.includes("action IN ('WORKSPACE_ENTER','WORKSPACE_EXIT')"), 'U1 workspace branch retained');
  assert.ok(insert.includes('OR b17_work_tenant(client_id)'), 'business INSERT under work context');
  assert.ok(insert.includes("user_id::text=b17_setting('current_actor_id')"), 'actor-bound');
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
  // Tenant tables gain NO new mutation surface: client_services never gets any
  // policy (no implicit grant), answers/evaluations get no write policy.
  for (const [table, cmd] of [['client_services', 'INSERT'], ['client_services', 'UPDATE'], ['client_services', 'DELETE'],
    ['answers', 'INSERT'], ['answers', 'UPDATE'], ['answers', 'DELETE'],
    ['evaluations', 'INSERT'], ['evaluations', 'UPDATE'], ['evaluations', 'DELETE'],
    ['assignments', 'UPDATE'], ['assignments', 'DELETE'], ['departments', 'DELETE']] as const)
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
