import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { getPool } from './index.ts';

export const B17_VERSION = 'B17_U1';
// Canonical PostgreSQL 18 catalog fingerprints, independently compared, not trusted from ledger alone.
export const PREDECESSOR_SHAPE = '18851d69e9808bf86a41314173406ef9';
export const B17_SHAPE = '4b4e39e3a13eae0d336d30fa94bbf52f';
export const B17_CONTENT_VERSION = 'B17_U2D';
// U2-D: PG18 recomputation after narrow library/mapping, W selection,
// target+linked Profile/settings policies, closed audit additions and the
// item.actions count repair. Sanctioned definer set/owner ACLs unchanged.
export const B17_CONTENT_SHAPE = '3b40916e614a7743f9d2d5a0fed34908';
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
