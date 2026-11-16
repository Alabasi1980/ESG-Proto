import type pg from 'pg';
import { UUID, validBinding, type AccessContext } from '../lib/capabilities.ts';
import { EMPTY_CLIENT_FIELD_MASK, storedClientFieldMask } from '../lib/clientFieldMask.ts';
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

// ---------------------------------------------------------------------------
// B17 U2-E E-1 — three narrowly-scoped helpers for the six evaluations/reviews
// READ declarations (task §2). Each one states the §3 tag it enforces; none of
// them resolves a tenant from request input and none of them can widen a set.
// ---------------------------------------------------------------------------

/** `L`/tenant rule (U2 retirement §2): the tenant is ALWAYS the caller's OWN
 * server-derived tenant. A supplied id is a COMPARISON only — mismatch is 403
 * `scope.tenant_mismatch`, malformed is 400 `scope.id_invalid`, an absent own
 * tenant fails closed with 400 `scope.tenant_required`. No P row exists on any
 * of the six reads, so this helper never resolves a platform target. */
export function ownTenant(access: AccessContext, supplied?: unknown): string {
  assertWorkScope(access);
  const named = optionalScopeId(supplied);
  if (named && named !== access.tenantId) throw scopeError(403,'scope.tenant_mismatch');
  if (!access.tenantId) throw scopeError(400,'scope.tenant_required');
  return access.tenantId;
}

/** §9(b) MUST-FIX (U2-D F1 class): a supplied id must be a well-formed UUID
 * BEFORE it can reach SQL, otherwise a raw 22P02 escapes as a 500. Empty /
 * absent means "not supplied" and returns null; array/number/object and any
 * malformed string are AMBIGUOUS, never ignored → 400 `scope.id_invalid`. */
export function optionalScopeId(supplied: unknown): string | null {
  if (supplied === undefined || supplied === null) return null;
  if (typeof supplied !== 'string') throw scopeError(400,'scope.id_invalid');
  const raw = supplied.trim();
  if (!raw) return null;
  return scopeId(raw, true);
}

/** §9(c) MUST-FIX: the caller's OWN department, server-derived. Employees get
 * their pinned department (an employee context without one is refused, never
 * widened); W/C get null — they have no department scope at all. */
export function ownDepartment(access: AccessContext): string | null {
  assertWorkScope(access);
  if (access.mode !== 'employee') return null;
  if (!access.departmentId) throw scopeError(403,'scope.department_mismatch');
  return access.departmentId;
}

/** §9(c) MUST-FIX: explicit handler-level department predicate for the rows an
 * employee is about to be served (defence-in-depth beside FORCE RLS and beside
 * the SQL predicate). W/C rows are never department-pinned, so this is a no-op
 * for them; an employee row carrying any other department is REFUSED with 403,
 * never silently filtered out of the response. */
export function assertOwnDepartmentRows<T extends { department_id?: string | null }>(
  access: AccessContext, rows: readonly T[]): void {
  const own = ownDepartment(access);
  if (own === null) return;
  if (rows.some(row => row.department_id !== own)) throw scopeError(403,'scope.department_mismatch');
}

/** `L` filter for the GE final checklist read: keep only items linked to the
 * caller's tenant. Applied by GET /reviews/ge-check ONLY — ge-final keeps its
 * own whole-scope §8 preflight, so this must never narrow the shared
 * scope-row loader (an unmapped item has to be REFUSED there, not dropped). */
export async function linkedItemsOnly<T extends { itemId: string }>(
  client: pg.PoolClient, access: AccessContext, items: readonly T[]): Promise<T[]> {
  assertWorkScope(access);
  if (!items.length) return [];
  const ids = [...new Set(items.map(item => item.itemId))];
  const visible = new Set<string>((await client.query(
    `SELECT i.id FROM items i WHERE i.id = ANY($3::uuid[]) AND ${LINKED_ITEM_SQL}`,
    [access.tenantId, null, ids])).rows.map(row => String(row.id)));
  return items.filter(item => visible.has(item.itemId));
}

// ---------------------------------------------------------------------------
// TASK-PROTO-U4-1a (OD-11 §4) — client field-mask lookup for the C-context item
// projections. The mask is a client-service property, so it is resolved from the
// caller's OWN server-derived tenant only; there is no request-supplied tenant
// input here. UNION semantics across the item's linked services: when ANY linked
// service hides a field it is hidden (fail-closed), never shown because a second
// service left it visible.
// ---------------------------------------------------------------------------

/** Masked item fields for the C caller, keyed by item id. E/W/P get an empty
 * map by construction (their projections are not masked). */
export async function maskedItemFields(client: pg.PoolClient, access: AccessContext,
  itemIds: readonly string[]): Promise<Map<string, Set<string>>> {
  assertWorkScope(access);
  const result = new Map<string, Set<string>>();
  if (access.mode !== 'client' || itemIds.length === 0) return result;
  // Read the RAW stored value per linked service and validate it in ONE place
  // (storedClientFieldMask, fail-closed). Expanding JSONB in SQL would turn a
  // malformed/stale value into "no rows" and silently show everything.
  const rows = (await client.query(
    `SELECT i.id::text AS item_id, cs.client_field_mask AS mask
       FROM items i
       JOIN disclosures d ON d.id = i.disclosure_id
       JOIN service_standards ss ON ss.standard_id = d.standard_id
       JOIN client_services cs ON cs.service_id = ss.service_id AND cs.client_id = $1
      WHERE i.id = ANY($2::uuid[])`,
    [access.tenantId, itemIds])).rows;
  for (const row of rows) {
    const mask = storedClientFieldMask(row.mask);
    if (mask.size === 0) continue;
    const id = String(row.item_id);
    const set = result.get(id) ?? new Set<string>();
    for (const field of mask) set.add(field);
    result.set(id, set);
  }
  return result;
}

/** The stored mask of ONE client×service. Report projections are bound to a
 * single service, so they read that link's mask directly. C only (empty set for
 * any other mode); a missing/unreadable row means "nothing hidden" — the report
 * route has already refused an unlinked service before this helper runs. */
export async function serviceFieldMask(client: pg.PoolClient, access: AccessContext,
  serviceId: string): Promise<ReadonlySet<string>> {
  assertWorkScope(access);
  if (access.mode !== 'client') return EMPTY_CLIENT_FIELD_MASK;
  const row = (await client.query(
    'SELECT client_field_mask FROM client_services WHERE client_id = $1 AND service_id = $2',
    [access.tenantId, serviceId])).rows[0];
  return storedClientFieldMask(row?.client_field_mask);
}

// ---------------------------------------------------------------------------
// TASK-PROTO-U4-1c (OD-12 §3–4) — department-owned write scoping for the
// document list and the department initiative status.
//
// The matrix already refuses W/C/P on those writes, and FORCE RLS row-scopes
// them; these two helpers are the handler-level third gate the task requires
// ("department scoping on every write"). They are deliberately literal: the
// caller must be an EMPLOYEE, and the row's department must be the employee's
// OWN server-derived department — never a request-supplied one.
// ---------------------------------------------------------------------------

/** The caller's own department for a department-owned write. W/C/P have no
 * department of their own, so they are refused here with zero writes. */
export function ownEmployeeDepartment(access: AccessContext): string {
  assertWorkScope(access);
  if (access.mode !== 'employee' || !access.departmentId)
    throw scopeError(403, 'scope.denied');
  return access.departmentId;
}

/** Same gate, against a concrete row/field department id. */
export function assertDepartmentWrite(access: AccessContext, departmentId: unknown): string {
  const own = ownEmployeeDepartment(access);
  if (typeof departmentId !== 'string' || departmentId !== own)
    throw scopeError(403, 'scope.department_mismatch');
  return own;
}

/** §3.3 snapshot reads: the FULL payload is served only when the ENTIRE item
 * set inside it is linked to the caller's tenant. A mixed, unlinked,
 * unparseable or item-less payload is INACCESSIBLE — the list route drops the
 * payload (metadata only) and the by-id route refuses 403 `scope.not_visible`.
 * Never a partial payload and never a rewritten content hash. */
export async function snapshotPayloadFullyLinked(
  client: pg.PoolClient, access: AccessContext, payload: unknown): Promise<boolean> {
  assertWorkScope(access);
  let parsed: unknown = payload;
  if (typeof payload === 'string') {
    try { parsed = JSON.parse(payload); } catch { return false; }
  }
  if (!parsed || typeof parsed !== 'object') return false;
  const items = (parsed as { items?: unknown }).items;
  if (!Array.isArray(items) || items.length === 0) return false;
  const ids: string[] = [];
  for (const entry of items) {
    const id = entry && typeof entry === 'object' ? (entry as { itemId?: unknown }).itemId : undefined;
    if (typeof id !== 'string' || !UUID.test(id)) return false;
    ids.push(id);
  }
  const unique = [...new Set(ids)];
  const visible = new Set<string>((await client.query(
    `SELECT i.id FROM items i WHERE i.id = ANY($3::uuid[]) AND ${LINKED_ITEM_SQL}`,
    [access.tenantId, null, unique])).rows.map(row => String(row.id)));
  return ids.every(id => visible.has(id));
}
