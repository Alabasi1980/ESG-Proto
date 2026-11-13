import { createHash } from 'node:crypto';
import type pg from 'pg';
import * as XLSX from 'xlsx';
import { UUID } from '../lib/capabilities.ts';
import { setTenantContext } from './index.ts';
import { verifyB17, verifyB17Content, STRUCTURE_SQL,
  B17_CONTENT_VERSION, B17_CONTENT_SHAPE, b17ContentSource } from './b17Readiness.ts';

export interface ContentTarget {
  clientId: string;
  griBatchId: string;
  profileBatchId: string;
  reportSettingId: string;
  reportAuditId: string;
}
export interface ContentSources { griKeys: readonly string[]; profileKeys: readonly string[]; digest: string }
export interface ContentInventory {
  targets: readonly ContentTarget[];
  sourceDigest: string;
  serviceId: string;
  standardIds: string[];
  itemIds: string[];
  profileIds: string[];
  reportIds: string[];
  lineage: { clientId: string; griAuditId: string; profileAuditId: string; reportAuditId: string }[];
  memberships: { id: string; client_id: string; service_id: string; show_gap: boolean; show_corrective: boolean }[];
  bindings: { table_name: string; id: string; service_id: string | null }[];
  serviceStandards: { id: string; service_id: string; standard_id: string }[];
  rowHashes: Record<string, { id: string; hash: string }[]>;
  beforeHash: string;
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const key = (parts: unknown[]) => JSON.stringify(parts.map(p => String(p ?? '').trim()));
const fail = (code: string, id?: string): never => { throw new Error(`b17.content_${code}${id ? `:${id}` : ''}`); };

/** Approved CSV extracts or explicitly supplied disposable fixture extracts. No path/URL/env lookup. */
export function parseB17ContentSources(griCsv: string, profileCsv: string): ContentSources {
  const keys = (csv: string, headers: string[]) => {
    const book = XLSX.read(csv.replace(/^\uFEFF/,''), { type: 'string', raw: true });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[book.SheetNames[0]], { defval: '' });
    if (!rows.length || headers.some(h => !(h in rows[0]))) fail('source_headers');
    const result = rows.map(row => {
      if (headers.some(h => !String(row[h] ?? '').trim())) fail('source_key');
      return key(headers.map(h => row[h]));
    });
    if (new Set(result).size !== result.length) fail('source_duplicate');
    return result.sort();
  };
  const griKeys = keys(griCsv, ['Standard Code','Disclosure Code','Item Code','Requirement']);
  const profileKeys = keys(profileCsv, ['pillar','department','topic','parameter']);
  return { griKeys, profileKeys, digest: hash([griKeys, profileKeys]) };
}

// Fixed necessary business/catalog allowlist. NEVER users/auth_sessions/workspace_tabs.
const GLOBAL_TABLES = ['services','standards','disclosures','items','service_standards'] as const;
const TENANT_TABLES = ['clients','departments','client_services','assignments','answers','approvals','evaluations',
  'actions','profile_assessments','report_settings','esg_profile','audit_log','review_snapshots',
  'snapshot_notes','client_initiatives'] as const;
const INVENTORY_TABLES = [...GLOBAL_TABLES, ...TENANT_TABLES, 'evidence_attachments'] as const;

function checkedTargets(targets: readonly ContentTarget[]): ContentTarget[] {
  if (!targets.length || targets.length > 100) fail('explicit_targets_required');
  if (new Set(targets.map(t => t.clientId)).size !== targets.length) fail('duplicate_target');
  return targets.map(t => {
    if (![t.clientId,t.reportSettingId,t.reportAuditId].every(v => typeof v === 'string' && UUID.test(v))
      || ![t.griBatchId,t.profileBatchId].every(v => typeof v === 'string' && v.length > 0 && v.length <= 200))
      fail('invalid_target');
    return { clientId: t.clientId, griBatchId: t.griBatchId, profileBatchId: t.profileBatchId,
      reportSettingId: t.reportSettingId, reportAuditId: t.reportAuditId };
  }).sort((a,b) => a.clientId.localeCompare(b.clientId));
}

async function openInventory(client: pg.PoolClient, targets: readonly ContentTarget[]): Promise<boolean> {
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  await client.query('SELECT pg_advisory_xact_lock(1717001)');
  await verifyB17(client);
  if ((await client.query('SELECT 1 FROM app_schema_versions WHERE version=$1', [B17_CONTENT_VERSION])).rowCount)
    return false; // known content version: no temporary policies or data repair
  await setTenantContext(client, { purpose: 'migration.inventory' });
  await client.query("SELECT set_config('app.inventory_targets',$1,true)", [JSON.stringify(targets.map(t => t.clientId))]);
  // Transactional DDL, NOT SQL READ ONLY. Dry-run ALWAYS rolls this back; apply
  // removes every temporary policy before committing the final fingerprint/ledger.
  for (const table of INVENTORY_TABLES) {
    const filter = (GLOBAL_TABLES as readonly string[]).includes(table) ? 'true'
      : table === 'evidence_attachments' ? `EXISTS(SELECT 1 FROM answers a WHERE a.id=answer_id
          AND current_setting('app.inventory_targets')::jsonb ? a.client_id::text)`
      : `current_setting('app.inventory_targets')::jsonb ? ${table === 'clients' ? 'id' : 'client_id'}::text`;
    await client.query(`CREATE POLICY b17_inventory ON public.${table} FOR SELECT USING
      (b17_setting('current_purpose')='migration.inventory' AND (${filter}))`);
  }
  return true;
}

async function businessHashes(client: pg.PoolClient): Promise<ContentInventory['rowHashes']> {
  const result: ContentInventory['rowHashes'] = {};
  for (const table of INVENTORY_TABLES) {
    if (table === 'service_standards') continue; // exact association changes are checked separately
    const value = ['actions','esg_profile','report_settings'].includes(table) ? "to_jsonb(t)-'service_id'" : 'to_jsonb(t)';
    result[table] = (await client.query(`SELECT id,encode(sha256(convert_to((${value})::text,'UTF8')),'hex') AS hash
      FROM public.${table} t ORDER BY id`)).rows;
  }
  return result;
}
async function bindings(client: pg.PoolClient): Promise<ContentInventory['bindings']> {
  const rows: ContentInventory['bindings'] = [];
  for (const table of ['actions','esg_profile','report_settings']) rows.push(...(await client.query(
    `SELECT '${table}' AS table_name,id,to_jsonb(t)->>'service_id' AS service_id FROM ${table} t ORDER BY id`)).rows);
  return rows;
}

async function capture(client: pg.PoolClient, targets: ContentTarget[], sources: ContentSources): Promise<ContentInventory> {
  if (sources.digest !== hash([sources.griKeys,sources.profileKeys])) fail('source_digest');
  const service = (await client.query("SELECT id FROM services WHERE code='GRI'")).rows[0];
  if (!service) fail('gri_missing');
  const gri = new Set(sources.griKeys), profile = new Set(sources.profileKeys);
  const standardIds = new Set<string>(), itemIds = new Set<string>(), profileIds: string[] = [], reportIds: string[] = [];
  const lineageIds: ContentInventory['lineage'] = [];
  const allItems = (await client.query(`SELECT i.id,i.import_batch_id,i.requirement,i.code,d.id AS disclosure_id,
    d.code AS disclosure_code,s.id AS standard_id,s.code AS standard_code FROM items i
    JOIN disclosures d ON d.id=i.disclosure_id JOIN standards s ON s.id=d.standard_id ORDER BY i.id`)).rows;
  const batches = new Set(targets.map(t => t.griBatchId));
  for (const target of targets) {
    if (!(await client.query('SELECT 1 FROM clients WHERE id=$1', [target.clientId])).rowCount) fail('client_missing',target.clientId);
    const lineage = async (action: string, batch: string) => {
      const rows = (await client.query(`SELECT id FROM audit_log WHERE client_id=$1 AND action=$2 AND entity_type=$4
        AND payload->>'targetTenant'=$1::text AND payload->>'importBatchId'=$3`,
      [target.clientId,action,batch,action === 'IMPORT_GRI_DISCLOSURES' ? 'standards' : 'esg_profile'])).rows;
      if (rows.length !== 1) fail('lineage_ambiguous',target.clientId);
      return rows[0].id as string;
    };
    const griAuditId=await lineage('IMPORT_GRI_DISCLOSURES',target.griBatchId);
    const profileAuditId=await lineage('ESG_PROFILE_IMPORTED',target.profileBatchId);
    lineageIds.push({clientId:target.clientId,griAuditId,profileAuditId,reportAuditId:target.reportAuditId});
    const imported = allItems.filter(i => i.import_batch_id === target.griBatchId);
    if (!imported.length) fail('items_missing',target.clientId);
    for (const item of imported) { standardIds.add(item.standard_id); itemIds.add(item.id); }
    const profiles = (await client.query(`SELECT id,pillar,department,topic,parameter,import_batch_id,
      to_jsonb(p)->>'service_id' AS service_id FROM esg_profile p WHERE client_id=$1 ORDER BY id`, [target.clientId])).rows;
    const candidates = profiles.filter(p => p.import_batch_id === target.profileBatchId);
    if (!candidates.length) fail('profile_missing',target.clientId);
    for (const p of profiles) {
      if (!p.service_id && p.import_batch_id !== target.profileBatchId) fail('profile_unknown',p.id);
      if (p.import_batch_id !== target.profileBatchId) continue;
      if (!profile.has(key([p.pillar,p.department,p.topic,p.parameter]))) fail('profile_source_unknown',p.id);
      if (p.service_id && p.service_id !== service.id) fail('profile_conflict',p.id);
      profileIds.push(p.id);
    }
    const settings = (await client.query('SELECT * FROM report_settings WHERE client_id=$1 ORDER BY id', [target.clientId])).rows;
    const report = settings.find(r => r.id === target.reportSettingId);
    if (!report || (report.service_id && report.service_id !== service.id)
      || settings.some(r => r.id !== report.id && r.service_id === service.id)) fail('report_conflict',target.reportSettingId);
    // A NULL-service legacy report needs explicit same-row audit evidence plus the
    // positively identified GRI import above, never an arbitrary tenant/default row.
    const audit = (await client.query(`SELECT id,payload->>'serviceId' AS service_id,
      payload->>'targetTenant' AS target,payload->>'disclosureLevel' AS disclosure_level,
      payload->>'reportLevel' AS report_level,payload->>'notified' AS notified FROM audit_log
      WHERE client_id=$1 AND entity_type='report_settings' AND entity_id=$2
      AND action='REPORT_SETTINGS_SAVED' ORDER BY created_at DESC,id DESC`, [target.clientId,report.id])).rows;
    if (!audit.length || audit[0].id !== target.reportAuditId || audit[0].target !== target.clientId
      || audit.some(a => a.service_id && a.service_id !== service.id)
      || audit[0].disclosure_level !== report.disclosure_level || audit[0].report_level !== report.report_level
      || audit[0].notified !== report.notified) fail('report_lineage_unknown',report.id);
    reportIds.push(report.id);
    if ((await client.query(`SELECT 1 FROM review_snapshots WHERE client_id=$1 AND
      (scope_type='tenant' OR (scope_type='disclosure' AND scope_ref=ANY($2::text[]))) LIMIT 1`,
    [target.clientId,imported.map(i => i.disclosure_id)])).rowCount) fail('frozen',target.clientId);
  }
  // Mapping a standard exposes ALL its children: every child must be evidenced,
  // not merely the first code that looked like GRI or one row in an import batch.
  for (const item of allItems.filter(i => standardIds.has(i.standard_id))) {
    if (!batches.has(item.import_batch_id) || !gri.has(key([item.standard_code,item.disclosure_code,item.code,item.requirement])))
      fail('item_source_unknown',item.id);
    itemIds.add(item.id);
  }
  const disclosureIds=[...new Set(allItems.filter(i => standardIds.has(i.standard_id)).map(i => i.disclosure_id))];
  for (const target of targets) if ((await client.query(`SELECT 1 FROM review_snapshots WHERE client_id=$1
    AND (scope_type='tenant' OR (scope_type='disclosure' AND scope_ref=ANY($2::text[]))) LIMIT 1`,
  [target.clientId,disclosureIds])).rowCount) fail('frozen',target.clientId);
  const mappings = (await client.query('SELECT id,service_id,standard_id FROM service_standards ORDER BY id')).rows;
  if (mappings.some(m => standardIds.has(m.standard_id) && m.service_id !== service.id)) fail('standard_service_conflict');
  const memberships = (await client.query('SELECT id,client_id,service_id,show_gap,show_corrective FROM client_services ORDER BY id')).rows;
  const rowHashes = await businessHashes(client);
  const base = { targets,sourceDigest:sources.digest,serviceId:service.id,standardIds:[...standardIds].sort(),
    itemIds:[...itemIds].sort(),profileIds:profileIds.sort(),reportIds:reportIds.sort(),memberships,rowHashes,
    bindings:await bindings(client),serviceStandards:mappings,lineage:lineageIds };
  return { ...base, beforeHash:hash(base) };
}

/** Explicit offline dry-run. Transactional SELECT-policy DDL is ALWAYS rolled back, including on success. */
export async function inventoryB17ContentOffline(client: pg.PoolClient, input: readonly ContentTarget[], sources: ContentSources): Promise<ContentInventory> {
  const targets = checkedTargets(input);
  try {
    if (!await openInventory(client,targets)) fail('already_applied');
    return await capture(client,targets,sources);
  } finally { await client.query('ROLLBACK'); }
}

/** Explicit offline apply only. Never imported/called by startup or any HTTP route. */
export async function applyB17ContentOffline(client: pg.PoolClient, expected: ContentInventory, sources: ContentSources): Promise<'applied' | 'verified'> {
  const targets = checkedTargets(expected.targets);
  try {
    // One lock/transaction from predecessor verification through re-inventory,
    // metadata association, final policies and ledger-last. No inter-transaction gap.
    if (!await openInventory(client,targets)) {
      await verifyB17Content(client); await client.query('COMMIT'); return 'verified';
    }
    const actual = await capture(client,targets,sources);
    if (actual.beforeHash !== expected.beforeHash || hash(actual) !== hash(expected)) fail('before_state_drift');
    const { sql,checksum } = b17ContentSource();
    await client.query(sql);
    // Temporary write policies admit only positively inventoried exact metadata IDs.
    await client.query("SELECT set_config('app.inventory_profile',$1,true),set_config('app.inventory_report',$2,true),set_config('app.inventory_service',$3,true),set_config('app.inventory_standard',$4,true)",
      [JSON.stringify(actual.profileIds),JSON.stringify(actual.reportIds),actual.serviceId,JSON.stringify(actual.standardIds)]);
    for (const [table,list] of [['esg_profile','profile'],['report_settings','report']] as const) {
      await client.query(`CREATE POLICY b17_inventory_write ON ${table} FOR UPDATE USING
        (b17_setting('current_purpose')='migration.inventory' AND current_setting('app.inventory_${list}')::jsonb ? id::text)
        WITH CHECK(service_id::text=current_setting('app.inventory_service'))`);
      await client.query(`UPDATE ${table} SET service_id=$1 WHERE id=ANY($2::uuid[]) AND service_id IS NULL`,
        [actual.serviceId,list === 'profile' ? actual.profileIds : actual.reportIds]);
      await client.query(`DROP POLICY b17_inventory_write ON ${table}`);
    }
    await client.query(`CREATE POLICY b17_inventory_write ON service_standards FOR INSERT WITH CHECK
      (b17_setting('current_purpose')='migration.inventory' AND service_id::text=current_setting('app.inventory_service')
        AND current_setting('app.inventory_standard')::jsonb ? standard_id::text)`);
    for (const standardId of actual.standardIds) await client.query(`INSERT INTO service_standards(service_id,standard_id)
      VALUES($1,$2) ON CONFLICT(service_id,standard_id) DO NOTHING`, [actual.serviceId,standardId]);
    await client.query('DROP POLICY b17_inventory_write ON service_standards');
    if (hash(await businessHashes(client)) !== hash(actual.rowHashes)) fail('business_values_changed');
    const expectedBindings = actual.bindings.map(b => ({ ...b,service_id:
      (b.table_name === 'esg_profile' && actual.profileIds.includes(b.id))
      || (b.table_name === 'report_settings' && actual.reportIds.includes(b.id)) ? actual.serviceId : b.service_id }));
    if (hash(await bindings(client)) !== hash(expectedBindings)) fail('association_values_changed');
    const finalMappings: ContentInventory['serviceStandards'] = (await client.query(
      'SELECT id,service_id,standard_id FROM service_standards ORDER BY id')).rows;
    if (actual.serviceStandards.some(old => !finalMappings.some(now => hash(now) === hash(old)))
      || finalMappings.some(now => !actual.serviceStandards.some(old => old.id === now.id)
        && (now.service_id !== actual.serviceId || !actual.standardIds.includes(now.standard_id)))) fail('mapping_values_changed');
    for (const table of INVENTORY_TABLES) await client.query(`DROP POLICY b17_inventory ON public.${table}`);
    const shape = (await client.query(STRUCTURE_SQL)).rows[0].checksum;
    if (shape !== B17_CONTENT_SHAPE) fail('result_shape_mismatch',shape);
    await setTenantContext(client, { purpose:'migration' });
    await client.query('INSERT INTO app_schema_versions(version,checksum,structure_checksum) VALUES($1,$2,$3)',
      [B17_CONTENT_VERSION,checksum,shape]);
    await verifyB17Content(client);
    await client.query('COMMIT');
    return 'applied';
  } catch (err) { await client.query('ROLLBACK'); throw err; }
}
