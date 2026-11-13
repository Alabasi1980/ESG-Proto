// Shared boundary plumbing for the initiatives/Profile/report unit only.
import type pg from 'pg';
import type { Response } from 'express';
import { withSession, assertFreshIdentity, type AuthenticatedRequest } from '../auth.ts';
import { withWorkspace, assertRouteContext } from '../access.ts';
import { classifyRoute } from '../accessRegistry.ts';
import { setTenantContext } from '../../db/index.ts';
import { readContext, platformConfigContext } from './_shared.ts';
import { scopeError, scopeId } from '../scope.ts';

/** Revalidate session/tab/matrix INSIDE the business transaction, holding the
 * same locks/connection through the audit and commit. T is configuration only. */
export async function domainTransaction<T>(req: AuthenticatedRequest,
  operation: (client: pg.PoolClient) => Promise<T>, target: string | null = null): Promise<T> {
  const route = classifyRoute(req.method, req.path)!;
  const run = async (client: pg.PoolClient) => {
    assertRouteContext(route, req.access!);
    await setTenantContext(client, req.access!.mode === 'platform'
      ? platformConfigContext(req, target) : readContext(req));
    return operation(client);
  };
  if (req.access?.role === 'ge_admin') {
    return withWorkspace(req, route.capability, async (client, _identity, _tab, access) => {
      req.access = access;
      return run(client);
    });
  }
  return withSession(req, 'work', async (client, identity) => {
    assertFreshIdentity(identity);
    req.access = { actorId: identity.user.id, sessionId: identity.sid, role: identity.user.role,
      mode: identity.user.role === 'client_admin' ? 'client' : 'employee',
      tenantId: identity.user.clientId ?? null, departmentId: identity.user.departmentId ?? null,
      tabId: null, generation: null, capability: route.capability };
    return run(client);
  }, { explicit: req.method !== 'GET' });
}

export function textFilter(value: unknown, fallback = ''): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') throw scopeError(400, 'scope.filter_invalid');
  return value.trim();
}

export function validateDomainIds(req: AuthenticatedRequest): void {
  for (const source of [req.query, req.body ?? {}]) {
    for (const key of ['clientId','serviceId','initiativeId','departmentId','itemId','standardId','disclosureId']) {
      if (source[key] !== undefined) scopeId(source[key], true);
    }
    if (source.clientId !== undefined && req.access!.mode !== 'platform'
      && source.clientId !== req.access!.tenantId) throw scopeError(403, 'scope.tenant_mismatch');
  }
  for (const key of ['clientId','serviceId']) if (req.query[key] !== undefined && req.body?.[key] !== undefined
    && req.query[key] !== req.body[key]) throw scopeError(403, 'scope.tenant_mismatch');
  if (req.params.id !== undefined) scopeId(req.params.id, true);
}

/** On P, T is explicit and later checked for existence. On W/C supplied T is
 * only a comparison with the live bound tenant, never an authority source. */
export function domainTenant(req: AuthenticatedRequest, explicit?: unknown): string {
  const named = scopeId(explicit, req.access!.mode === 'platform');
  if (req.access!.mode === 'platform') return named!;
  if (named && named !== req.access!.tenantId) throw scopeError(403, 'scope.tenant_mismatch');
  return req.access!.tenantId!;
}

export async function configurationService(client: pg.PoolClient, tenant: string,
  supplied: unknown, required = true): Promise<string | null> {
  const service = scopeId(supplied, required || supplied !== undefined);
  if (!(await client.query('SELECT id FROM clients WHERE id=$1', [tenant])).rowCount)
    throw scopeError(404, 'scope.not_found');
  if (service) {
    if (!(await client.query("SELECT b17_content_fact('service',$1,$2) AS ok", [tenant, service])).rows[0]?.ok)
      throw scopeError(403, 'scope.service_unlinked');
    return service;
  }
  const links = (await client.query('SELECT service_id FROM client_services WHERE client_id=$1 ORDER BY service_id', [tenant])).rows;
  if (links.length > 1) throw scopeError(400, 'service.required');
  return links[0]?.service_id ?? null;
}

export function domainFailure(res: Response, err: any, fallback: string) {
  // SQL diagnostics/constraint names and reflected raw values are not API errors.
  const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
  const code = typeof err?.code === 'string' && !/^[0-9A-Z]{5}$/.test(err.code) ? err.code : undefined;
  return res.status(status).json({ error: status === 500 ? fallback : err.message, code });
}
