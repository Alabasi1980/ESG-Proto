import type pg from 'pg';
import { UUID, validBinding, type AccessContext } from '../lib/capabilities.ts';
import { setTenantContext } from '../db/index.ts';
import { verifyB17Content } from '../db/b17Readiness.ts';

export const scopeError = (statusCode: number, code: string) => Object.assign(new Error(code), { statusCode,code });
export function scopeId(value: unknown, required = false): string | null {
  if (value === undefined || value === null) {
    if (required) throw scopeError(400,'scope.id_required');
    return null;
  }
  if (typeof value !== 'string' || !UUID.test(value)) throw scopeError(400,'scope.id_invalid');
  return value;
}
export function assertWorkScope(access: AccessContext): void {
  if (!validBinding(access) || access.mode === 'platform' || !UUID.test(access.tenantId ?? '')
    || !UUID.test(access.actorId) || !UUID.test(access.sessionId)
    || (access.mode === 'employee' && !UUID.test(access.departmentId ?? '')))
    throw scopeError(403,'scope.denied');
}

/** Called only INSIDE U1's authenticated session/tab transaction, after its locks.
 * This is not an authentication replacement and never accepts a request-selected purpose.
 */
export async function bindB17WorkScope(client: pg.PoolClient, access: AccessContext): Promise<void> {
  assertWorkScope(access);
  await verifyB17Content(client);
  const settings = (await client.query(`SELECT b17_setting('current_actor_id') AS actor,
    b17_setting('current_session_id') AS session,b17_setting('current_mode') AS mode,
    b17_setting('current_tenant_id') AS tenant,b17_setting('current_tab_id') AS tab,
    b17_setting('current_user_department_id') AS department,b17_setting('current_user_role') AS role,
    b17_setting('current_purpose') AS purpose`)).rows[0];
  if (settings.actor !== access.actorId || settings.session !== access.sessionId || settings.mode !== access.mode
    || settings.tenant !== access.tenantId || settings.tab !== access.tabId || settings.role !== access.role
    || settings.department !== access.departmentId || !['workspace','auth.session','work'].includes(settings.purpose))
    throw scopeError(403,'scope.context_mismatch');
  await setTenantContext(client, { userId:access.actorId,sessionId:access.sessionId,role:access.role,mode:access.mode,
    tenantId:access.tenantId,departmentId:access.departmentId,tabId:access.tabId,purpose:'work' });
}

// Fixed parameter contract: $1 trusted tenant, $2 optional service, $3 own E department.
// EXISTS, not fan-out joins: an item contributes once even with overlapping services.
export const LINKED_ITEM_SQL = `EXISTS (
  SELECT 1 FROM disclosures ld JOIN service_standards ls ON ls.standard_id=ld.standard_id
  JOIN client_services lc ON lc.service_id=ls.service_id AND lc.client_id=$1::uuid
  WHERE ld.id=i.disclosure_id AND ($2::uuid IS NULL OR lc.service_id=$2::uuid))`;
export const EMPLOYEE_ITEM_SQL = `($3::uuid IS NULL OR EXISTS (
  SELECT 1 FROM assignments la JOIN departments dp ON dp.id=la.department_id AND dp.client_id=la.client_id
  WHERE la.client_id=$1::uuid AND la.item_id=i.id AND la.department_id=$3::uuid))`;
export const SCOPED_ITEM_SQL = `${LINKED_ITEM_SQL} AND ${EMPLOYEE_ITEM_SQL}`;

export interface ItemFilters { serviceId?: unknown; standardId?: unknown; disclosureId?: unknown; itemId?: unknown }
export function itemQuery(access: AccessContext, filters: ItemFilters = {}) {
  assertWorkScope(access);
  for (const value of [filters.serviceId,filters.standardId,filters.disclosureId,filters.itemId])
    if (value !== undefined) scopeId(value,true); // an explicit invalid filter must never broaden the set
  return { text:`SELECT i.* FROM items i JOIN disclosures d ON d.id=i.disclosure_id
    WHERE ${SCOPED_ITEM_SQL} AND ($4::uuid IS NULL OR d.standard_id=$4)
      AND ($5::uuid IS NULL OR d.id=$5) AND ($6::uuid IS NULL OR i.id=$6) ORDER BY i.id`,
  values:[access.tenantId,scopeId(filters.serviceId),access.mode === 'employee' ? access.departmentId : null,
    scopeId(filters.standardId),scopeId(filters.disclosureId),scopeId(filters.itemId)] };
}

export async function resolveLinkedService(client: pg.PoolClient, access: AccessContext, supplied?: unknown): Promise<string | null> {
  assertWorkScope(access);
  const id = scopeId(supplied,supplied !== undefined);
  const links = (await client.query('SELECT service_id FROM client_services WHERE client_id=$1 ORDER BY service_id', [access.tenantId])).rows;
  if (id) {
    if (!links.some(row => row.service_id === id)) throw scopeError(403,'scope.service_unlinked');
    return id;
  }
  if (links.length > 1) throw scopeError(400,'service.required');
  return links[0]?.service_id ?? null;
}
export async function scopedItems(client: pg.PoolClient, access: AccessContext, filters: ItemFilters = {}) {
  if (filters.serviceId !== undefined) await resolveLinkedService(client,access,filters.serviceId);
  return (await client.query(itemQuery(access,filters))).rows;
}
export async function assertVisibleItem(client: pg.PoolClient, access: AccessContext, itemId: unknown, serviceId?: unknown): Promise<string> {
  const id = scopeId(itemId,true)!;
  if (!(await scopedItems(client,access,{ itemId:id,...(serviceId === undefined ? {} : {serviceId}) })).length)
    throw scopeError(404,'scope.not_found');
  return id;
}

export async function scopedParents(client: pg.PoolClient, access: AccessContext, kind: 'services' | 'standards' | 'disclosures', serviceId?: unknown) {
  assertWorkScope(access);
  if (!['services','standards','disclosures'].includes(kind)) throw scopeError(400,'scope.parent_invalid');
  if (serviceId !== undefined) await resolveLinkedService(client,access,serviceId);
  const inner = itemQuery(access,{serviceId});
  const authorized = `SELECT i.id,i.disclosure_id,d.standard_id FROM items i JOIN disclosures d ON d.id=i.disclosure_id
    WHERE ${SCOPED_ITEM_SQL}`;
  const condition = kind === 'disclosures' ? 'a.disclosure_id=p.id' : kind === 'standards' ? 'a.standard_id=p.id'
    : `EXISTS(SELECT 1 FROM service_standards s JOIN client_services c ON c.service_id=s.service_id
        WHERE s.standard_id=a.standard_id AND s.service_id=p.id AND c.client_id=$1
          AND ($2::uuid IS NULL OR s.service_id=$2))`;
  return (await client.query(`WITH authorized AS (${authorized}) SELECT p.* FROM ${kind} p
    WHERE EXISTS(SELECT 1 FROM authorized a WHERE ${condition}) ORDER BY p.id`, inner.values.slice(0,3))).rows;
}

/** No hidden existing UNIQUE(client,item) row may turn into a destructive upsert.
 * Future assignment/evaluation writers must share this per-pair lock before activation.
 */
export async function assertEmployeeEvaluationWritable(client: pg.PoolClient, access: AccessContext, itemId: unknown): Promise<void> {
  assertWorkScope(access);
  if (access.mode !== 'employee') throw scopeError(403,'scope.denied');
  const id = scopeId(itemId,true)!;
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1717002))', [`${access.tenantId}:${id}`]);
  await assertVisibleItem(client,access,id);
  const allowed = (await client.query("SELECT b17_content_fact('writable',$1,$2) AS allowed", [access.tenantId,id])).rows[0].allowed;
  if (!allowed) throw scopeError(409,'scope.shared_ambiguous');
}

export async function scopedEvaluations(client: pg.PoolClient, access: AccessContext, itemId: unknown) {
  const id = await assertVisibleItem(client,access,itemId);
  // Explicit fact + FORCE RLS both require retained ownership BEFORE e.* can
  // expose scores/history. A transferred evaluator's current department is not provenance.
  return (await client.query(`SELECT e.* FROM evaluations e WHERE e.client_id=$1 AND e.item_id=$2
    AND ($3::boolean=false OR b17_content_fact('evaluation',e.client_id,e.id)) ORDER BY e.id`,
  [access.tenantId,id,access.mode === 'employee'])).rows;
}
export async function scopedScoreInputs(client: pg.PoolClient, access: AccessContext, serviceId?: unknown) {
  assertWorkScope(access);
  if (access.mode === 'employee') throw scopeError(403,'scope.aggregate_denied');
  const service=scopeId(serviceId,serviceId !== undefined);
  if (service) await resolveLinkedService(client,access,service);
  return (await client.query(`SELECT e.*,i.weight FROM evaluations e JOIN items i ON i.id=e.item_id
    WHERE e.client_id=$1 AND ${SCOPED_ITEM_SQL} AND (b17_setting('current_mode')<>'client'
      OR b17_content_fact('gap',$1,i.id,$2)) ORDER BY e.id`,[access.tenantId,service,null])).rows;
}
export async function scopedAnswers(client: pg.PoolClient, access: AccessContext, itemId: unknown) {
  const id = await assertVisibleItem(client,access,itemId);
  return (await client.query(`SELECT a.* FROM answers a WHERE a.client_id=$1 AND a.item_id=$2
    AND ($3::uuid IS NULL OR a.department_id=$3) ORDER BY a.id`,
  [access.tenantId,id,access.mode === 'employee' ? access.departmentId : null])).rows;
}
export async function scopedAttachments(client: pg.PoolClient, access: AccessContext, answerId: unknown, attachmentId?: unknown) {
  assertWorkScope(access);
  const answer = scopeId(answerId,true), attachment = scopeId(attachmentId,attachmentId !== undefined);
  const projection = attachment ? 'f.*' : 'f.id,f.answer_id,f.file_name,f.mime,f.size_bytes,f.uploaded_by,f.created_at';
  return (await client.query(`SELECT ${projection} FROM evidence_attachments f JOIN answers a ON a.id=f.answer_id
    WHERE a.client_id=$1 AND a.id=$2 AND ($3::uuid IS NULL OR f.id=$3) ORDER BY f.id`,
  [access.tenantId,answer,attachment])).rows;
}

export async function scopedInitiatives(client: pg.PoolClient, access: AccessContext, view: unknown = 'selected', serviceId?: unknown) {
  assertWorkScope(access);
  if (typeof view !== 'string') throw scopeError(400,'scope.view_invalid');
  if (access.mode === 'employee' || !['selected','eligible'].includes(view)
    || (view === 'eligible' && access.mode !== 'consultant')) throw scopeError(403,'scope.initiatives_denied');
  const service = scopeId(serviceId,serviceId !== undefined);
  if (service) await resolveLinkedService(client,access,service);
  const selected = `EXISTS(SELECT 1 FROM client_initiatives ci WHERE ci.client_id=$1 AND ci.initiative_id=l.id)`;
  const from = view === 'selected' ? 'client_initiatives ci JOIN initiatives_library l ON l.id=ci.initiative_id' : 'initiatives_library l';
  return (await client.query(`SELECT l.*,${selected} AS selected FROM ${from}
    WHERE ${view === 'selected' ? 'ci.client_id=$1 AND' : ''} EXISTS(
      SELECT 1 FROM service_initiatives s JOIN client_services c ON c.service_id=s.service_id
      WHERE c.client_id=$1 AND s.initiative_id=l.id AND ($2::uuid IS NULL OR c.service_id=$2)) ORDER BY l.id`,
  [access.tenantId,service])).rows;
}

export async function scopedProfile(client: pg.PoolClient, access: AccessContext, serviceId?: unknown) {
  assertWorkScope(access);
  if (access.mode === 'employee') throw scopeError(403,'scope.profile_denied');
  const service = await resolveLinkedService(client,access,serviceId);
  if (!service) return [];
  // DD-02 remains independent. No evaluations, score joins or disclosure denominators here.
  return (await client.query(`SELECT p.* FROM esg_profile p WHERE p.client_id=$1 AND p.service_id=$2
    AND EXISTS(SELECT 1 FROM client_services c WHERE c.client_id=p.client_id AND c.service_id=p.service_id) ORDER BY p.id`,
  [access.tenantId,service])).rows;
}
export async function scopedReportSettings(client: pg.PoolClient, access: AccessContext, serviceId?: unknown) {
  assertWorkScope(access);
  if (access.mode === 'employee') throw scopeError(403,'scope.reports_denied');
  const service = await resolveLinkedService(client,access,serviceId);
  if (!service) return [];
  return (await client.query('SELECT * FROM report_settings WHERE client_id=$1 AND service_id=$2', [access.tenantId,service])).rows;
}

export async function assertActionBinding(client: pg.PoolClient, access: AccessContext,
  input: { itemId?: unknown; serviceId?: unknown; departmentId: unknown }): Promise<void> {
  assertWorkScope(access);
  if (access.mode === 'employee') throw scopeError(403,'scope.actions_denied');
  const department = scopeId(input.departmentId,true), item = scopeId(input.itemId), service = scopeId(input.serviceId);
  if (!(await client.query('SELECT 1 FROM departments WHERE id=$1 AND client_id=$2', [department,access.tenantId])).rowCount)
    throw scopeError(403,'scope.department_mismatch');
  if (!item && !service) throw scopeError(400,'service.required');
  if (service) await resolveLinkedService(client,access,service);
  if (item) await assertVisibleItem(client,access,item,service ?? undefined);
}
export async function scopedActions(client: pg.PoolClient, access: AccessContext) {
  assertWorkScope(access);
  if (access.mode === 'employee') throw scopeError(403,'scope.actions_denied');
  return (await client.query(`SELECT a.* FROM actions a JOIN departments d ON d.id=a.owner_department_id AND d.client_id=a.client_id
    WHERE a.client_id=$1 AND (CASE WHEN a.item_id IS NULL THEN a.service_id IS NOT NULL AND EXISTS(
      SELECT 1 FROM client_services c WHERE c.client_id=a.client_id AND c.service_id=a.service_id)
      ELSE b17_item_visible(a.client_id,a.item_id,a.service_id) END) ORDER BY a.id`, [access.tenantId])).rows;
}
