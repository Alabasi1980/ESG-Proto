// B17 U2-F — §3.4 client/overview rows: GET+POST /clients (1,2), GET /ge/overview
// (8), GET+PATCH /clients/:id (9,10), the four client×service rows (11-14) and
// POST /services/link-all (15). Handlers only; declarations + middleware stay in
// admin.ts so registry coverage (assertRegistryCoverage) sees the same 25 keys.
//
// §6 progress contract (row 1, P branch): client row fields + services[{id,code,
// name, mappedItemCount, assignedPairCount, submittedPairCount, pendingPairCount,
// frozenPairCount, unmapped}] — count/pair columns ONLY, never a score, gap,
// answer value or assessment payload. Assignment/answer pairs are keyed
// (item, department); submitted = status IN (submitted, approved, client_approved);
// pending = assigned − submitted; frozen derives the tenant/disclosure snapshots;
// `unmapped` is the PER-SERVICE flag of that service's own mapping chain
// (0 mapped items => true — round-2 ruling 2 / UI binding "Service standards
// not mapped"), NOT a client-level boolean; the client-level orphan population
// drives only the §8 ge-final preflight (b17_catalog_child_count, unchanged).
// C's row stays MINIMAL (own company row, not an enumeration capability) and
// carries no progress block: §6 defines the progress response for P only.

import type { Response } from 'express';
import { recordAuditLog } from '../../db/index.ts';
import { domainTransaction } from './initiativeScope.ts';
import type { AuthenticatedRequest } from '../auth.ts';
import { stripSecrets } from '../../lib/b11b.ts';
import { readContext, platformConfigContext, writeFailure, type DbClient } from './_shared.ts';
import { ownTenant, scopeId } from '../scope.ts';
import {
  adminTenantContext, platformGlobalContext, platformTarget,
  searchableFilter,
} from './adminCommon.ts';

const CLIENT_COLUMNS = 'id, code, name, industry, contact_email, suspended, created_at';

// ---------------------------------------------------------------------------
// §6 progress computation (P list only). Sources are read once through the
// NULL-target platform CONFIGURATION context (platformGlobalContext — §5's
// enumerated fixed-aggregate exception); every projected column is a count/key,
// never a value/blob (routeGates pins: no SELECT * on answers/review_snapshots
// here), so §5's projection-only rule holds by construction.
// ---------------------------------------------------------------------------
interface ServiceProgress {
  id: string; code: string; name: string;
  mappedItemCount: number; assignedPairCount: number; submittedPairCount: number;
  pendingPairCount: number; frozenPairCount: number; unmapped: boolean;
}

const pairKey = (row: { item_id: string; department_id: string }) => `${row.item_id}:${row.department_id}`;

async function clientProgressByTenant(client: DbClient): Promise<Map<string, ServiceProgress[]>> {
  const links = (await client.query(
    `SELECT cs.client_id, cs.service_id, s.code, s.name
     FROM client_services cs JOIN services s ON s.id = cs.service_id`)).rows as
    { client_id: string; service_id: string; code: string; name: string }[];
  const serviceItems = (await client.query(
    `SELECT ss.service_id, i.id AS item_id, i.disclosure_id
     FROM service_standards ss
     JOIN disclosures d ON d.standard_id = ss.standard_id
     JOIN items i ON i.disclosure_id = d.id`)).rows as
    { service_id: string; item_id: string; disclosure_id: string }[];
  const assignments = (await client.query(
    'SELECT client_id, item_id, department_id FROM assignments')).rows as
    { client_id: string; item_id: string; department_id: string }[];
  const submitted = (await client.query(
    `SELECT client_id, item_id, department_id FROM answers
     WHERE status IN ('submitted','approved','client_approved')`)).rows as
    { client_id: string; item_id: string; department_id: string }[];
  const snapshots = (await client.query(
    'SELECT client_id, scope_type, scope_ref FROM review_snapshots')).rows as
    { client_id: string; scope_type: string; scope_ref: string }[];

  const itemsByService = new Map<string, { itemId: string; disclosureId: string }[]>();
  for (const row of serviceItems) {
    const list = itemsByService.get(row.service_id) ?? [];
    list.push({ itemId: row.item_id, disclosureId: row.disclosure_id });
    itemsByService.set(row.service_id, list);
  }
  const servicesByTenant = new Map<string, typeof links>();
  for (const link of links) {
    const list = servicesByTenant.get(link.client_id) ?? [];
    list.push(link);
    servicesByTenant.set(link.client_id, list);
  }
  const tenantFrozen = new Set<string>(), disclosureFrozen = new Map<string, Set<string>>();
  for (const snap of snapshots) {
    if (snap.scope_type === 'tenant') tenantFrozen.add(snap.client_id);
    else if (snap.scope_type === 'disclosure') {
      const set = disclosureFrozen.get(snap.client_id) ?? new Set<string>();
      set.add(snap.scope_ref);
      disclosureFrozen.set(snap.client_id, set);
    }
  }
  const assignmentsByTenant = new Map<string, typeof assignments>();
  const submittedByTenant = new Map<string, typeof submitted>();
  for (const row of assignments) {
    const list = assignmentsByTenant.get(row.client_id) ?? [];
    list.push(row); assignmentsByTenant.set(row.client_id, list);
  }
  for (const row of submitted) {
    const list = submittedByTenant.get(row.client_id) ?? [];
    list.push(row); submittedByTenant.set(row.client_id, list);
  }

  const result = new Map<string, ServiceProgress[]>();
  for (const [tenantId, tenantLinks] of servicesByTenant) {
    const tenantAssignments = assignmentsByTenant.get(tenantId) ?? [];
    const tenantSubmitted = submittedByTenant.get(tenantId) ?? [];
    const frozenDisclosures = disclosureFrozen.get(tenantId) ?? new Set<string>();
    const frozenPair = (disclosureId: string) =>
      tenantFrozen.has(tenantId) || frozenDisclosures.has(disclosureId);
    const entries: ServiceProgress[] = tenantLinks.map(link => {
      const items = itemsByService.get(link.service_id) ?? [];
      const itemIds = new Set(items.map(item => item.itemId));
      const disclosureOf = new Map(items.map(item => [item.itemId, item.disclosureId]));
      const assignedPairs = new Set(
        tenantAssignments.filter(row => itemIds.has(row.item_id)).map(pairKey)).size;
      const submittedPairs = new Set(
        tenantSubmitted.filter(row => itemIds.has(row.item_id)).map(pairKey)).size;
      const frozenPairs = new Set(
        tenantAssignments.filter(row => itemIds.has(row.item_id)
          && frozenPair(disclosureOf.get(row.item_id) ?? '')).map(pairKey)).size;
      return {
        id: link.service_id,
        code: link.code,
        name: link.name,
        mappedItemCount: items.length,
        assignedPairCount: assignedPairs,
        submittedPairCount: submittedPairs,
        pendingPairCount: Math.max(0, assignedPairs - submittedPairs),
        frozenPairCount: frozenPairs,
        // Round-2 ruling 2 (QA): PER-SERVICE flag from THIS service's own
        // mapping chain — 0 mapped items => unmapped=true ("Service standards
        // not mapped"). The client-level orphan population is a different
        // fact: it still drives only the §8 ge-final preflight through
        // b17_catalog_child_count('tenant.unmapped_assignments'), unchanged.
        unmapped: items.length === 0,
      };
    });
    result.set(tenantId, entries);
  }
  return result;
}

/** GET /clients — P searchable list + per-linked-service progress; C own minimal row. */
export async function listClients(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const search = searchableFilter(req.query.search);
    const rows = await domainTransaction(req, async (client) => {
      const access = req.access!;
      if (access.mode === 'platform') {
        const params: any[] = [];
        let where = '';
        if (search) { params.push(search); where = ' WHERE (name ILIKE $1 OR code ILIKE $1)'; }
        const list = (await client.query(
          `SELECT ${CLIENT_COLUMNS} FROM clients${where} ORDER BY name ASC`, params)).rows;
        const progress = await clientProgressByTenant(client);
        return list.map(row => ({
          ...row,
          suspended: row.suspended === true,
          services: progress.get(row.id) ?? [],
        }));
      }
      const tenant = ownTenant(access, req.query.clientId);
      return (await client.query(
        `SELECT ${CLIENT_COLUMNS} FROM clients WHERE id = $1 ORDER BY name ASC`, [tenant])).rows
        .map(row => ({ ...row, suspended: row.suspended === true }));
    }, live => live.access!.mode === 'platform' ? platformGlobalContext(live) : readContext(live));
    res.json(rows);
  } catch (err: any) {
    writeFailure(res, err, 'Failed to fetch clients');
  }
}

/** POST /clients — P tenant creation, targetless configuration context, no
 * implicit services/assessments (nothing is inserted but the client row). */
export async function createClient(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const { code, name, industry, contactEmail } = req.body ?? {};
    if (typeof code !== 'string' || !code.trim() || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Client code and name are required.' }); return;
    }
    const newClient = await domainTransaction(req, async (client) => {
      const result = await client.query(
        `INSERT INTO clients (code, name, industry, contact_email)
         VALUES ($1, $2, $3, $4)
         RETURNING id, code, name, industry, contact_email, created_at`,
        [code.trim(), name.trim(),
          typeof industry === 'string' && industry.trim() ? industry.trim() : null,
          typeof contactEmail === 'string' && contactEmail.trim() ? contactEmail.trim() : null]
      );
      const created = result.rows[0];
      await recordAuditLog(client, {
        clientId: created.id,
        userId: req.access!.actorId,
        action: 'CREATE_CLIENT',
        entityType: 'clients',
        entityId: created.id,
        payload: { code: created.code, name: created.name },
      });
      return created;
    }, platformGlobalContext);
    res.json(newClient);
  } catch (err: any) {
    writeFailure(res, err, 'Failed to create client tenant');
  }
}

/** GET /clients/:id — P@T configuration projection; W/C own-company projection
 * WITHOUT account-operational flags/credentials in users[] (round-2 ruling 1,
 * §3.4 row 9). */
export async function getClient(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const data = await domainTransaction(req, async (client) => {
      const { tenant, platform } = adminTenantContext(req, req.params.id);
      const cRes = await client.query(
        `SELECT ${CLIENT_COLUMNS} FROM clients WHERE id = $1`, [tenant]);
      const clientRow = cRes.rows[0];
      if (!clientRow) throw Object.assign(new Error('Client not found.'), { statusCode: 404 });
      const svcRes = await client.query(
        `SELECT s.id, s.code, s.name, s.description, cs.show_gap, cs.show_corrective, cs.created_at AS linked_at,
                rs.disclosure_level, rs.report_level, rs.statement_name, rs.statement_period
         FROM client_services cs JOIN services s ON s.id = cs.service_id
         LEFT JOIN report_settings rs ON rs.client_id = cs.client_id AND rs.service_id = cs.service_id
         WHERE cs.client_id = $1 ORDER BY s.code ASC`,
        [tenant]
      );
      const deptRes = await client.query(
        `SELECT d.id, d.code, d.name, d.head_user_id, hu.name AS head_name
         FROM departments d LEFT JOIN users hu ON hu.id = d.head_user_id
         WHERE d.client_id = $1 ORDER BY d.name ASC`,
        [tenant]
      );
      const userRes = await client.query(
        `SELECT id, email, name, role, is_active, must_change_password, department_id, created_at
         FROM users WHERE client_id = $1 ORDER BY created_at ASC`,
        [tenant]
      );
      const staffRes = await client.query(
        `SELECT id, status, note, reject_reason, created_at, decided_at FROM staff_lists
         WHERE client_id = $1 ORDER BY created_at DESC`,
        [tenant]
      );
      return {
        client: { ...clientRow, suspended: clientRow.suspended === true },
        services: svcRes.rows.map((s: any) => ({
          ...stripSecrets(s),
          showGap: s.show_gap !== false,
          showCorrective: s.show_corrective !== false,
        })),
        departments: deptRes.rows,
        // Round-2 ruling 1 (Shield-1): W/C get ONLY non-operational roster
        // fields — is_active/must_change_password are account-operational flags
        // and email is the credential identifier (login handle), all stripped
        // for the own-company projection. P (explicit T) keeps its full safe
        // projection (password_hash is never selected anywhere).
        users: platform
          ? userRes.rows.map((u: any) => stripSecrets(u))
          : userRes.rows.map((u: any) => ({
              id: u.id,
              name: u.name,
              role: u.role,
              department_id: u.department_id,
              created_at: u.created_at,
            })),
        staffLists: staffRes.rows,
      };
    }, live => adminTenantContext(live, req.params.id).context);
    res.json(data);
  } catch (err: any) {
    writeFailure(res, err, 'Failed to fetch client detail');
  }
}

/** PATCH /clients/:id — P only: suspend/unsuspend + rename/industry (Clients
 * list semantics). The suspend wall itself stays in /auth/login (200
 * {suspended:true}, no data) — untouched by this row. */
export async function updateClient(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const target = platformTarget(req.params.id);
    const body = req.body ?? {};
    const sets: string[] = [];
    const params: any[] = [];
    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) { res.status(400).json({ error: 'Client name must not be empty.' }); return; }
      params.push(name);
      sets.push(`name = $${params.length}`);
    }
    if (body.suspended !== undefined) {
      if (typeof body.suspended !== 'boolean') {
        res.status(400).json({ error: 'suspended must be a boolean.' }); return;
      }
      params.push(body.suspended);
      sets.push(`suspended = $${params.length}`);
    }
    if (body.industry !== undefined) {
      params.push(typeof body.industry === 'string' && body.industry.trim() ? body.industry.trim() : null);
      sets.push(`industry = $${params.length}`);
    }
    if (sets.length === 0) { res.status(400).json({ error: 'Provide name and/or suspended to update.' }); return; }
    const updated = await domainTransaction(req, async (client) => {
      params.push(target);
      const upd = await client.query(
        `UPDATE clients SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length}
         RETURNING id, code, name, industry, contact_email, suspended, created_at`,
        params
      );
      const row = upd.rows[0];
      if (!row) throw Object.assign(new Error('Client not found.'), { statusCode: 404 });
      await recordAuditLog(client, {
        clientId: row.id,
        userId: req.access!.actorId,
        action: body.suspended === true ? 'CLIENT_SUSPENDED'
          : body.suspended === false ? 'CLIENT_UNSUSPENDED' : 'CLIENT_UPDATED',
        entityType: 'clients',
        entityId: row.id,
        payload: { suspended: row.suspended },
      });
      return { ...row, suspended: row.suspended === true };
    }, live => platformConfigContext(live, target));
    res.json(updated);
  } catch (err: any) {
    writeFailure(res, err, 'Failed to update client');
  }
}

/** GET /clients/:id/services — P@T / W / C bound tenant; E assigned-service
 * projection (RLS parent.service fact narrows E to assigned services). */
export async function listClientServices(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const rows = await domainTransaction(req, async (client) => {
      const { tenant } = adminTenantContext(req, req.params.id);
      const result = await client.query(
        `SELECT s.id, s.code, s.name, s.description, cs.show_gap, cs.show_corrective, cs.created_at AS linked_at
         FROM client_services cs JOIN services s ON s.id = cs.service_id
         WHERE cs.client_id = $1 ORDER BY s.code ASC`,
        [tenant]
      );
      return result.rows.map((r: any) => ({
        ...r,
        showGap: r.show_gap !== false,
        showCorrective: r.show_corrective !== false,
      }));
    }, live => adminTenantContext(live, req.params.id).context);
    res.json(rows);
  } catch (err: any) {
    writeFailure(res, err, 'Failed to fetch client services');
  }
}

/** POST /clients/:id/services — P@T link configuration (§3.4 row 12): validate
 * tenant + service, never create a subscription implicitly, audit. */
export async function linkClientService(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const target = platformTarget(req.params.id);
    const body = req.body ?? {};
    const serviceId = typeof body.serviceId === 'string' ? body.serviceId.trim() : '';
    if (!serviceId) { res.status(400).json({ error: 'serviceId is required.' }); return; }
    const showGap = body.showGap === undefined ? true : body.showGap;
    const showCorrective = body.showCorrective === undefined ? true : body.showCorrective;
    if (typeof showGap !== 'boolean' || typeof showCorrective !== 'boolean') {
      res.status(400).json({ error: 'showGap and showCorrective must be booleans.' }); return;
    }
    const result = await domainTransaction(req, async (client) => {
      const cRes = await client.query('SELECT id FROM clients WHERE id = $1', [target]);
      if (!cRes.rows[0]) throw Object.assign(new Error('Client not found.'), { statusCode: 404 });
      const sRes = await client.query('SELECT id, code FROM services WHERE id = $1', [serviceId]);
      if (!sRes.rows[0]) throw Object.assign(new Error('Service not found.'), { statusCode: 404 });
      const ins = await client.query(
        `INSERT INTO client_services (client_id, service_id, show_gap, show_corrective)
         VALUES ($1, $2, $3, $4) ON CONFLICT (client_id, service_id) DO NOTHING RETURNING *`,
        [target, serviceId, showGap, showCorrective]
      );
      const created = (ins.rowCount ?? 0) > 0;
      if (created) {
        await recordAuditLog(client, {
          clientId: target,
          userId: req.access!.actorId,
          action: 'LINK_CLIENT_SERVICE',
          entityType: 'client_services',
          payload: { clientId: target, serviceId, showGap, showCorrective },
        });
      }
      const cur = await client.query(
        `SELECT s.id, s.code, s.name, cs.show_gap, cs.show_corrective FROM client_services cs
         JOIN services s ON s.id = cs.service_id WHERE cs.client_id = $1 AND cs.service_id = $2`,
        [target, serviceId]
      );
      return { linked: true, existed: !created, link: cur.rows[0] };
    }, live => platformConfigContext(live, target));
    res.status(result.existed ? 200 : 201).json(result);
  } catch (err: any) {
    writeFailure(res, err, 'Failed to link service');
  }
}

/** PATCH /clients/:id/services/:serviceId — P@T visibility flags only. */
export async function updateClientServiceFlags(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const target = platformTarget(req.params.id);
    const serviceId = scopeId(req.params.serviceId, true)!;
    const body = req.body ?? {};
    if (body.showGap !== undefined && typeof body.showGap !== 'boolean') {
      res.status(400).json({ error: 'showGap must be a boolean.' }); return;
    }
    if (body.showCorrective !== undefined && typeof body.showCorrective !== 'boolean') {
      res.status(400).json({ error: 'showCorrective must be a boolean.' }); return;
    }
    if (body.showGap === undefined && body.showCorrective === undefined) {
      res.status(400).json({ error: 'Provide showGap and/or showCorrective.' }); return;
    }
    const updated = await domainTransaction(req, async (client) => {
      const sets: string[] = [];
      const params: any[] = [];
      if (body.showGap !== undefined) {
        params.push(body.showGap);
        sets.push(`show_gap = $${params.length}`);
      }
      if (body.showCorrective !== undefined) {
        params.push(body.showCorrective);
        sets.push(`show_corrective = $${params.length}`);
      }
      params.push(target, serviceId);
      const upd = await client.query(
        `UPDATE client_services SET ${sets.join(', ')} WHERE client_id = $${params.length - 1}
         AND service_id = $${params.length}
         RETURNING client_id, service_id, show_gap, show_corrective`,
        params
      );
      const row = upd.rows[0];
      if (!row) throw Object.assign(new Error('Client×service link not found.'), { statusCode: 404 });
      await recordAuditLog(client, {
        clientId: target,
        userId: req.access!.actorId,
        action: 'UPDATE_CLIENT_SERVICE_FLAGS',
        entityType: 'client_services',
        payload: { clientId: target, serviceId, ...body },
      });
      return { ...row, showGap: row.show_gap !== false, showCorrective: row.show_corrective !== false };
    }, live => platformConfigContext(live, target));
    res.json(updated);
  } catch (err: any) {
    writeFailure(res, err, 'Failed to update client service flags');
  }
}

/** DELETE /clients/:id/services/:serviceId — P@T unlink: the LINK row goes, the
 * business rows (assignments/answers/evaluations) are preserved, and visibility
 * revokes immediately through the mapping predicate — the §8 preflight then
 * refuses 409 scope.unmapped for that tenant (proved in the harness). */
export async function unlinkClientService(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    const target = platformTarget(req.params.id);
    const serviceId = scopeId(req.params.serviceId, true)!;
    const result = await domainTransaction(req, async (client) => {
      const del = await client.query(
        'DELETE FROM client_services WHERE client_id = $1 AND service_id = $2',
        [target, serviceId]
      );
      if ((del.rowCount ?? 0) === 0) {
        throw Object.assign(new Error('Client×service link not found.'), { statusCode: 404 });
      }
      await recordAuditLog(client, {
        clientId: target,
        userId: req.access!.actorId,
        action: 'UNLINK_CLIENT_SERVICE',
        entityType: 'client_services',
        payload: { clientId: target, serviceId },
      });
      return { unlinked: true };
    }, live => platformConfigContext(live, target));
    res.json(result);
  } catch (err: any) {
    writeFailure(res, err, 'Failed to unlink service');
  }
}
