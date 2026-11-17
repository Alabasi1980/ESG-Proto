// Business authority stays on the checked-out client until transaction settlement.
import type pg from 'pg';
import type { Response } from 'express';
import { withSession, assertFreshIdentity, authError, identityContext, sendAuthError, type AuthenticatedRequest } from '../auth.ts';
import { hashTab, assertRouteActivated, assertRouteContext, type WorkspaceRow } from '../access.ts';
import { classifyRoute } from '../accessRegistry.ts';
import { setTenantContext, type TenantContext } from '../../db/index.ts';
import { TAB_IDLE_MS, validGeneration } from '../../lib/capabilities.ts';
import { readContext, platformConfigContext } from './_shared.ts';
import { scopeError, scopeId } from '../scope.ts';

/** Revalidate session/tab/matrix INSIDE the business transaction, holding the
 * same locks/connection through the audit and commit. T is configuration only. */
export async function domainTransaction<T>(req: AuthenticatedRequest,
  operation: (client: pg.PoolClient) => Promise<T>,
  target: string | null | ((liveReq: AuthenticatedRequest) => TenantContext) = null): Promise<T> {
  const route = classifyRoute(req.method, req.path);
  if (!route) throw authError(404, 'api.not_found');
  assertRouteActivated(route);
  if (target !== null && typeof target !== 'string' && typeof target !== 'function') throw scopeError(403, 'scope.denied');
  return withSession(req, 'workspace', async (client, identity) => {
    assertFreshIdentity(identity);
    // withWorkspace parity, on THIS client: nesting that wrapper would release
    // authority independently and consume another connection from the same pool.
    if (identity.user.role === 'ge_admin') {
      const handle = req.get('X-Workspace-Tab');
      if (!handle || !/^[A-Za-z0-9_-]{43}$/.test(handle)) throw authError(409, 'workspace.invalid');
      const result = await client.query(`SELECT id,mode,client_id,generation,expires_at FROM workspace_tabs
        WHERE handle_hash=$1 AND session_id=$2 AND user_id=$3 AND revoked_at IS NULL
        AND expires_at>clock_timestamp() FOR UPDATE`, [hashTab(handle), identity.sid, identity.user.id]);
      const tab = result.rows[0] as WorkspaceRow | undefined;
      if (!tab) throw authError(409, 'workspace.invalid');
      const now: Date = (await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
      if (identity.expiresAt <= now) throw authError(401, 'auth.invalid');
      if (tab.expires_at <= now) throw authError(409, 'workspace.invalid');
      const version = req.get('X-Workspace-Version');
      if (!validGeneration(version)) throw authError(400, 'workspace.version_required');
      if (Number(version) !== tab.generation) throw authError(409, 'workspace.stale');
      req.access = { actorId: identity.user.id, sessionId: identity.sid, role: identity.user.role,
        mode: tab.mode, tenantId: tab.client_id, departmentId: null,
        tabId: tab.id, generation: tab.generation, capability: route.capability };
      assertRouteContext(route, req.access);
      await setTenantContext(client, { ...identityContext(identity, 'workspace'), mode: tab.mode,
        tenantId: tab.client_id, tabId: tab.id });
      await client.query(`UPDATE workspace_tabs SET last_seen_at=clock_timestamp(),
        expires_at=LEAST($2::timestamptz,clock_timestamp()+$3*interval '1 millisecond') WHERE id=$1`,
      [tab.id, identity.expiresAt, TAB_IDLE_MS]);
    } else if (identity.user.role === 'client_admin' || identity.user.role === 'employee') {
      req.access = { actorId: identity.user.id, sessionId: identity.sid, role: identity.user.role,
        mode: identity.user.role === 'client_admin' ? 'client' : 'employee',
        tenantId: identity.user.clientId ?? null, departmentId: identity.user.departmentId ?? null,
        tabId: null, generation: null, capability: route.capability };
      assertRouteContext(route, req.access);
    } else throw authError(401, 'auth.invalid');
    const live = readContext(req);
    if (typeof target === 'string') {
      scopeId(target, true);
      if (req.access.mode !== 'platform' && target !== req.access.tenantId) throw scopeError(403, 'scope.tenant_mismatch');
    }
    const context = typeof target === 'function' ? target(req)
      : req.access.mode === 'platform'
        ? platformConfigContext(req, target === null ? null : scopeId(target, true)) : live;
    // Selectors are server code, not an alternative source of identity. Only
    // the enumerated work/configuration purpose and its target may differ.
    for (const key of ['userId','sessionId','role','departmentId','mode','tabId'] as const)
      if (context[key] !== live[key]) throw scopeError(403, 'scope.denied');
    if (context.loginEmail != null) throw scopeError(403, 'scope.denied');
    if (context.purpose === 'work') {
      if (context.tenantId !== live.tenantId || context.targetId != null) throw scopeError(403, 'scope.denied');
    } else if (context.purpose === 'platform.config' && live.mode === 'platform') {
      if (context.tenantId !== context.targetId || (context.targetId != null && scopeId(context.targetId, true) !== context.targetId))
        throw scopeError(403, 'scope.denied');
    } else throw scopeError(403, 'scope.denied');
    await setTenantContext(client, context);
    return operation(client);
  }, { explicit: req.method !== 'GET' });
}

/** Narrow lifecycle plumbing for older catches; domain error shapes stay owned
 * by their handlers. Call only after the transaction promise has rejected. */
export function boundaryFailure(res: Response, error: unknown): boolean {
  const err = error as { statusCode?: number; code?: string };
  if (![400,401,403,404,409].includes(err?.statusCode ?? 0)
    || typeof err.code !== 'string'
    || !/^(auth\.|workspace\.|tenant\.suspended$|access\.unactivated$|api\.not_found$)/.test(err.code)) return false;
  sendAuthError(res, error);
  return true;
}

export class DeferredRefusal extends Error {
  constructor(readonly statusCode: number, readonly body: Record<string, unknown>) {
    super(String(body.error));
  }
}
export function deferredFailure(res: Response, error: unknown): boolean {
  if (!(error instanceof DeferredRefusal)) return boundaryFailure(res, error);
  res.status(error.statusCode).json(error.body);
  return true;
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

// ---------------------------------------------------------------------------
// TASK-PROTO-U4-1c-PROTECT — one canonical server-derived advisory anchor.
//
// WHY a single helper: POST select has no selection row yet, DELETE/unselect,
// status PATCH and initiative evidence all need the SAME lock. Locking by the
// selection row ID cannot serialize the first select and changes identity
// after delete/reselect (ABA). The anchor is therefore the domain tuple
// (kind, server-bound tenant UUID, library/requirement resource UUID) — never
// a selection row ID, service/user/department ID, or raw client input.
//
// Lock-key canonicalization only: both UUIDs must already be validated
// (8-4-4-4-12 hex-and-hyphen), then lowercased before concatenation with
// fixed separators/kinds. Full UUIDs + fixed kinds prevent aliasing; a 64-bit
// hash collision only adds serialization, never authorization (advisory locks
// are not row security — every path rechecks tenant/scope after waiting).
// ---------------------------------------------------------------------------

export type U41cProtectKind = 'initiative' | 'requirement';

const U41C_PROTECT_PREFIX = 'u41c-protect:v1';

export function u41cProtectKey(kind: U41cProtectKind, tenantId: string, resourceId: string): string {
  if (kind !== 'initiative' && kind !== 'requirement') throw scopeError(403, 'scope.denied');
  const tenant = scopeId(tenantId, true)!.toLowerCase();
  const resource = scopeId(resourceId, true)!.toLowerCase();
  return `${U41C_PROTECT_PREFIX}:${kind}:${tenant}:${resource}`;
}

/** Transaction-scoped exclusive lock on the canonical anchor, held to commit. */
export async function u41cProtectLock(
  client: pg.PoolClient, kind: U41cProtectKind, tenantId: string, resourceId: string,
): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    u41cProtectKey(kind, tenantId, resourceId),
  ]);
}

/** Parse the optimistic-revision input shared by both status PATCH routes.
 * 0 = caller observed no row, >=1 = observed revision. Missing/empty,
 * non-integer, negative or out-of-range (PG integer) values fail closed with
 * 400 version.required using the existing baseline message — no new wording. */
export const U41C_MAX_VERSION = 2147483647;

export function parseExpectedVersion(raw: unknown): { ok: true; value: number } | { ok: false; status: 400; code: string; error: string } {
  if (raw === undefined || raw === null || raw === '') {
    return {
      ok: false, status: 400, code: 'version.required',
      error: 'A version is required to save (optimistic locking). Reload the item and retry.',
    };
  }
  const numeric = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > U41C_MAX_VERSION) {
    return {
      ok: false, status: 400, code: 'version.required',
      error: 'A version is required to save (optimistic locking). Reload the item and retry.',
    };
  }
  return { ok: true, value: numeric };
}

export function domainFailure(res: Response, err: any, fallback: string) {
  // SQL diagnostics/constraint names and reflected raw values are not API errors.
  const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
  const code = typeof err?.code === 'string' && !/^[0-9A-Z]{5}$/.test(err.code) ? err.code : undefined;
  return res.status(status).json({ error: status === 500 ? fallback : err.message, code });
}
