import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { getPool } from './index.ts';

export const B17_VERSION = 'B17_U1';
// Canonical PostgreSQL 18 catalog fingerprints, independently compared, not trusted from ledger alone.
// H12 (TASK-PROTO-H12, D-H01-01): PREDECESSOR_SHAPE recomputed on an own fresh
// PG18 scratch after `clients.theme` was appended to schema.sql. STRUCTURE_SQL
// fingerprints EVERY public column, so the schema-only, post-U1 and post-content
// constants move together — never edit one without re-measuring all three.
// U4-1a (TASK-PROTO-U4-1a, OD-11 §4): recomputed on an own fresh PG18 scratch
// after schema.sql appended items.attachment_required, services.settings and
// client_services.client_field_mask. Falsifiability proved in the same run:
// dropping the three columns restores the previous constants EXACTLY
// (62e7586e… / bbcb018e… / 5def29de…), re-adding the same DDL restores these.
// U4-1c (TASK-PROTO-U4-1c, OD-12 §3–§8): recomputed on an own fresh PG18
// scratch after schema.sql appended items.indicator_code/items.tags, the four
// document/initiative/evidence tables and their indexes, and after
// b17-content.sql appended the row-scope policies for those tables (they MUST
// live there: b17.sql's activation block replaces every predecessor policy, so
// a policy defined next to the tables in schema.sql would not survive a fresh
// install — the H13 app_settings precedent), widened the E/P@T branch of
// b17_scope (client_initiatives) and b17_library, and added the three
// DOCUMENT_REQUIREMENT_* P actions to b17_audit_insert. Both the content
// checksum and the content shape therefore move together with the schema
// constants. Falsifiability proved in scripts/u41c-scratch.ts: dropping the new
// columns/tables restores d093f472… / 99455c0b… exactly; removing this unit's
// policy block and restoring the three predecessor policy texts restores the
// pre-change content md5 (6f67b44d…) on the pre-change structure, and re-adding
// the block restores these values.
// U4-1c round 2 (H-01/M-01/F-03/F-05): recomputed after the schema and policy
// deltas — document_submissions.requirement_id FK RESTRICT (no cascade), the
// client-scoped document_requirements (client_id column + uniqueness) and the
// client-matching requirement/submission policies. The bucket-code suffix and
// the `initiatives.locked` rule are handler-level and change no structure.
// Falsifiability proved in scripts/u41c-scratch.ts: undoing exactly the round-2
// schema delta restores the round-1 md5 (c320ef6f… / 99455c0b…), the seven
// round-2 policy texts restored to their round-1 form restore the schema-only
// content md5, and re-applying them restores these values.
export const PREDECESSOR_SHAPE = 'e75eb5f4e4754549849757daec7c478b';
export const B17_SHAPE = 'f28b8352a1b6f68e01b3cc9d5b725546';
export const B17_CONTENT_VERSION = 'B17_U2D';
// G2 E1-04 (truthfulness note — comment-only, no logic change): 'B17_U2D' is
// the CANONICAL content label. Tera ruling: renaming it would strand every
// existing local DB (including the owner's showcase) behind a version_drift
// refusal with no upgrade path — the ledger has no intermediate-version
// sequence to walk. Consistency is FOUR-WAY and is proved on a fresh scratch
// by scripts/b17-domain-g2-od10.ts:
//   1. this constant === the ledger row version applyB17ContentOffline inserts
//      (b17ContentMigration.ts INSERT uses B17_CONTENT_VERSION);
//   2. that row's checksum === b17ContentSource().checksum (sha256 of the
//      current b17-content.sql) — else verifyB17 refuses b17.version_drift;
//   3. that row's structure_checksum === B17_CONTENT_SHAPE === the live
//      STRUCTURE_SQL catalog fingerprint — else b17.version_drift /
//      b17.schema_drift (drift is REFUSED fail-closed, never silently
//      accepted);
//   4. b17-content.sql's own header/guard names the same 'B17_U2D' label.
// Recovery after drift: restore the matching content file and/or catalog
// structure (or re-apply on a DB that has no content row yet), then
// assertB17Ready goes green again — the fresh-apply / drift-REFUSED /
// restore-recovered cycle is the G2 proof.
// U2-D: PG18 recomputation after narrow library/mapping, W selection,
// target+linked Profile/settings policies, closed audit additions and the
// item.actions count repair. Sanctioned definer set/owner ACLs unchanged.
// U2-E E-1: recomputed after the review_snapshots/snapshot_notes W-only SELECT
// substrate (SHIELD-U2E-E1).
// U2-E E-2: recomputed after the E-0 write substrate + the §9(a) item-local
// history branch (SHIELD-U2E-E2), the §10 ruling-1 tenant preflight kind and
// the ruling-3 approvals provenance pin (SHIELD-U2E-E3); definer set/owner
// ACLs still unchanged (no new SECURITY DEFINER).
// U2-F round 1: recomputed after SHIELD-U2F-01 — the 22-row §3.4 admin
// substrate (NULL-target platform-progress summary reads, target-bound
// clients/client_services/assignments writes, staff draft/submit/reject rows,
// W-only N/A inserts, the P@T notify/trim + audit branches, the users target
// branch and the two tenant.item.* blocker kinds).
// U2-F round 2 (final): recomputed after the SHIELD-U2F-01 PROVISIONING
// extension — b17_admin_users_insert (explicit T only),
// b17_admin_users_update (target-bound
// deactivation) and the USER_CREATED/USER_DEACTIVATED/USER_REACTIVATED/
// STAFF_LIST_APPROVED audit rows. Still no new definer; owner ACLs untouched.
// H12 (TASK-PROTO-H12, D-H01-01): recomputed on an own fresh PG18 scratch after
// schema.sql appended `clients.theme TEXT NOT NULL DEFAULT 'ge'`. STRUCTURE_SQL
// enumerates EVERY public column, so this pin MUST equal the value measured after
// the column exists — it is not cosmetic and may change only with a re-measure.
// U4-1a (round 2, Option A approved): b17-content.sql gained ONE narrow W UPDATE
// policy (b17_consultant_service_visibility), so BOTH its checksum (sha256,
// ledger `checksum`) and its catalog shape moved; measured content sha256 was
// 2e07a7c1… with structure 6f67b44d… (the U4-1c block below supersedes both).
// U4-1c round 3 (G-01): recomputed after b17_audit_insert gained the
// target-bound DOCUMENT_REQUIREMENT_* branch (the requirement audits are written
// with client_id = T). New content sha256: 4ff0f31c… (measured in the same
// scratch run as the shape; the schema is untouched, so PREDECESSOR_SHAPE and
// B17_SHAPE above do not move).
export const B17_CONTENT_SHAPE = 'c927183564e59ce9777b92e854dfc40a';
/** The complete sanctioned b17_* SECURITY DEFINER surface (task §23 goal 6),
 * sorted. Drift refusal is strict: the live definer set must equal this list
 * EXACTLY, and every member must keep owner-only EXECUTE. */
export const SANCTIONED_DEFINER_FUNCTIONS: readonly string[] =
  ['b17_catalog_child_count', 'b17_content_fact'];
// Normalize the existing app principal by its ledger ownership, not a hardcoded
// deployment username/OID. Only that SAME current/session principal may own/call
// the definers. Any additional grant/default ACL, owner transfer or bypass is drift.
// The authority query below covers EVERY sanctioned definer individually (owner,
// ACL, definer flag) plus the complete live b17_% definer list, so introducing,
// renaming or over-granting any privileged helper refuses content_authority_drift.
const SANCTIONED_SQL = SANCTIONED_DEFINER_FUNCTIONS.map(name => `'${name}'`).join(',');
export const CONTENT_AUTHORITY_SQL = `SELECT jsonb_build_object(
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
      AND p.proname = ANY(ARRAY[${SANCTIONED_SQL}])
  ) f)) AS authority
  WHERE to_regprocedure('public.b17_content_fact(text,uuid,uuid,uuid)') IS NOT NULL`;
export const STRUCTURE_SQL = `SELECT md5((jsonb_build_object(
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
    FROM (${CONTENT_AUTHORITY_SQL}) auth),'{}'::jsonb))::text) AS checksum`;

export function b17Source(): { sql: string; checksum: string } {
  const sql = readFileSync(new URL('./b17.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  return { sql, checksum: createHash('sha256').update(sql).digest('hex') };
}
export function b17ContentSource(): { sql: string; checksum: string } {
  const sql = readFileSync(new URL('./b17-content.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  return { sql, checksum: createHash('sha256').update(sql).digest('hex') };
}
async function assertRuntimeRole(client: pg.PoolClient): Promise<void> {
  const row = (await client.query(`SELECT r.rolsuper,r.rolbypassrls,
    (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=session_user) AS session_bypass,
    current_setting('row_security') AS row_security FROM pg_roles r WHERE rolname=current_user`)).rows[0];
  if (!row || row.rolsuper || row.rolbypassrls || row.session_bypass || row.row_security !== 'on')
    throw new Error('b17.runtime_role_unsafe');
}
/** SHIELD-H13-02 (TASK-PROTO-H13 round 2): the platform settings table must be
 * owned by the SAME runtime principal that owns the rest of the substrate.
 * WHY it is a correctness check and not a preference: STRUCTURE_SQL fingerprints
 * every public column through information_schema.columns, and that view only
 * exposes tables the querying role holds a privilege on — so a table created by
 * another role (e.g. a superuser running the H13 live DDL) is INVISIBLE to the
 * runtime role, readiness then reports a misleading b17.schema_drift, and the
 * feature itself would fail on "permission denied". Deliberately narrow: one
 * table, no other table is inspected, STRUCTURE_SQL and every constant are
 * untouched, and a pre-H13 install (no such table) is a no-op. */
async function assertAppSettingsOwnership(client: pg.PoolClient): Promise<void> {
  const row = (await client.query(`SELECT pg_get_userbyid(c.relowner)=current_user AS owned
    FROM pg_class c WHERE c.oid = to_regclass('public.app_settings')`)).rows[0];
  if (row && row.owned !== true) throw new Error('b17.ownership_drift');
}
export async function assertB17ContentAuthority(client: pg.PoolClient): Promise<void> {
  const a = (await client.query(CONTENT_AUTHORITY_SQL)).rows[0]?.authority;
  const sanctioned = [...SANCTIONED_DEFINER_FUNCTIONS].sort();
  // Exact set equality on BOTH views: the sanctioned list covers what is
  // checked per-function; the live b17_% definer list must not contain an
  // extra, renamed or missing privileged helper (task §23 goal 6).
  if (!a || !Array.isArray(a.definer_functions)
    || JSON.stringify(a.definer_functions) !== JSON.stringify(sanctioned)
    || !Array.isArray(a.authority) || a.authority.length !== sanctioned.length)
    throw new Error('b17.content_authority_drift');
  for (const f of a.authority) {
    if (!sanctioned.includes(f.name) || f.definer !== true || f.explicit_acl !== true
      || f.owner_is_app !== true || f.owner_is_current !== true || f.owner_is_session !== true
      || f.owner_super !== false || f.owner_bypass !== false
      || !Array.isArray(f.execute) || f.execute.length !== 1
      || f.execute[0].grantee_is_owner !== true || f.execute[0].grantor_is_owner !== true
      || f.execute[0].privilege !== 'EXECUTE' || f.execute[0].grantable !== false)
      throw new Error('b17.content_authority_drift');
  }
}
export async function verifyB17(client: pg.PoolClient): Promise<void> {
  await assertRuntimeRole(client);
  // SHIELD-H13-02: names the real defect (a table owned by another role) instead
  // of letting it surface as a misleading column-visibility schema_drift.
  await assertAppSettingsOwnership(client);
  const exists = (await client.query("SELECT to_regclass('public.app_schema_versions') IS NOT NULL AS present")).rows[0].present;
  if (!exists) throw new Error('b17.activation_required');
  const versions = (await client.query('SELECT version,checksum,structure_checksum FROM app_schema_versions ORDER BY version')).rows;
  const row = versions.find(v => v.version === B17_VERSION);
  if (!row || row.checksum !== b17Source().checksum || row.structure_checksum !== B17_SHAPE)
    throw new Error('b17.version_drift');
  const content = versions.find(v => v.version === B17_CONTENT_VERSION);
  if (versions.length !== (content ? 2 : 1) || (content &&
    (content.checksum !== b17ContentSource().checksum || content.structure_checksum !== B17_CONTENT_SHAPE)))
    throw new Error('b17.version_drift');
  if (content) await assertB17ContentAuthority(client);
  if ((await client.query(STRUCTURE_SQL)).rows[0].checksum !== (content ? B17_CONTENT_SHAPE : B17_SHAPE))
    throw new Error('b17.schema_drift');
}
export async function verifyB17Content(client: pg.PoolClient): Promise<void> {
  await verifyB17(client);
  if (!(await client.query('SELECT 1 FROM app_schema_versions WHERE version=$1', [B17_CONTENT_VERSION])).rowCount)
    throw new Error('b17.content_required');
}
export async function assertB17Ready(): Promise<void> {
  const client = await getPool().connect();
  try {
    // Read-only, coherent metadata snapshot. No advisory locks, schema repair, seeds or writes.
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await verifyB17(client);
    await client.query('COMMIT');
  } catch (err) { await client.query('ROLLBACK'); throw err; }
  finally { client.release(); }
}

/** Explicit OFFLINE operator/harness entry only; never called by startup or an HTTP handler. */
export async function applyB17Offline(client: pg.PoolClient): Promise<'applied' | 'verified'> {
  const { sql, checksum } = b17Source();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(1717001)');
    await assertRuntimeRole(client);
    const present = (await client.query("SELECT to_regclass('public.app_schema_versions') IS NOT NULL AS present")).rows[0].present;
    if (present) { await verifyB17(client); await client.query('COMMIT'); return 'verified'; }
    if ((await client.query(STRUCTURE_SQL)).rows[0].checksum !== PREDECESSOR_SHAPE) throw new Error('b17.predecessor_drift');
    await client.query("SELECT set_config('app.b17_checksum',$1,true)", [checksum]);
    await client.query(sql);
    const shape = (await client.query(STRUCTURE_SQL)).rows[0].checksum;
    if (shape !== B17_SHAPE) throw new Error(`b17.result_shape_mismatch:${shape}`);
    // Version is LAST, after effective shape/policy checks; any failure rolls back the entire delta.
    await client.query("SELECT set_config('app.current_purpose','migration',true)");
    await client.query(`INSERT INTO app_schema_versions(version,checksum,structure_checksum) VALUES ($1,$2,$3)`,
      [B17_VERSION, checksum, shape]);
    await client.query('COMMIT');
    return 'applied';
  } catch (err) { await client.query('ROLLBACK'); throw err; }
}
