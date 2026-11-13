import type { Response, NextFunction } from 'express';
import type pg from 'pg';
import { createHash } from 'node:crypto';
import { setTenantContext } from '../db/index.ts';
import { assertB17Ready } from '../db/b17Readiness.ts';
import { classifyRoute, type MatrixContext, type RouteDeclaration } from './accessRegistry.ts';
import { validGeneration, validBinding, TAB_IDLE_MS, type AccessContext, type AccessMode,
  type BusinessRole } from '../lib/capabilities.ts';
import { withSession, authError, sendAuthError, assertFreshIdentity, identityContext,
  type AuthenticatedRequest, type SessionIdentity } from './auth.ts';

export function hashTab(handle: string): string { return createHash('sha256').update(handle).digest('hex'); }
export function assertSameOrigin(req: AuthenticatedRequest): void {
  if (['GET','HEAD','OPTIONS'].includes(req.method)) return;
  if (req.get('sec-fetch-site') === 'cross-site') throw authError(403, 'origin.denied');
  const origin = req.get('origin');
  if (origin && origin !== `${req.protocol}://${req.get('host')}`) throw authError(403, 'origin.denied');
}
export async function accessDispatcher(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const route = classifyRoute(req.method, req.path);
    if (!route) throw authError(404, 'api.not_found');
    // U2-A pre-check: every mounted declaration must carry §3 matrix data; a
    // declaration without it fails closed exactly like an unretrofitted route.
    // Outcomes are byte-identical to U1: no auth/parser/domain handler runs for
    // an unretrofitted combination (even a public legacy read) — it stays
    // access.unactivated — and the declarations currently carrying activation
    // 'U1' (8 system/session + 4 workspace + every sub-unit flipped so far,
    // see accessRegistry.ts) take the unchanged path below. Every activation
    // flip is an explicit per-sub-unit edit of accessRegistry.ts (task §15);
    // requireDomainAccess re-checks this same gate for any route that mounts
    // it (SHIELD-U2A-01).
    if (!route.matrix.length || route.activation !== 'U1') throw authError(403, 'access.unactivated');
    assertSameOrigin(req);
    if (!['/db/status','/setup/status','/db/migrate'].includes(route.path)) await assertB17Ready();
    next();
  } catch (err) { sendAuthError(res, err); }
}
export interface WorkspaceRow {
  id: string; mode: 'platform' | 'consultant'; client_id: string | null;
  generation: number; expires_at: Date;
}
export async function withWorkspace<T>(req: AuthenticatedRequest, capability: string,
  operation: (client: pg.PoolClient, identity: SessionIdentity, tab: WorkspaceRow, access: AccessContext) => Promise<T>,
  reconcile = false): Promise<T> {
  return withSession(req, 'workspace', async (client, identity) => {
    if (identity.user.role !== 'ge_admin') throw authError(403, 'workspace.forbidden');
    if (capability !== 'workspace.exit') assertFreshIdentity(identity);
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
    if (!reconcile) {
      const version = req.get('X-Workspace-Version');
      if (!validGeneration(version)) throw authError(400, 'workspace.version_required');
      if (Number(version) !== tab.generation) throw authError(409, 'workspace.stale');
    }
    const access: AccessContext = { actorId: identity.user.id, sessionId: identity.sid,
      role: identity.user.role, mode: tab.mode, tenantId: tab.client_id, departmentId: null,
      tabId: tab.id, generation: tab.generation, capability };
    req.access = access;
    await setTenantContext(client, { ...identityContext(identity, 'workspace'), mode: tab.mode,
      tenantId: tab.client_id, tabId: tab.id });
    await client.query(`UPDATE workspace_tabs SET last_seen_at=clock_timestamp(),
      expires_at=LEAST($2::timestamptz,clock_timestamp()+$3*interval '1 millisecond') WHERE id=$1`,
    [tab.id, identity.expiresAt, TAB_IDLE_MS]);
    return operation(client, identity, tab, access);
  }, { explicit: req.method !== 'GET' });
}

// ---------------------------------------------------------------------------
// B17 U2-A — request-level domain access wrapper.
//
// This is THE single place legacy handlers consult during U2-B..F: it attaches
// `req.access` (src/lib/capabilities.ts AccessContext). Context derivation is
// server-side only; no client-supplied id ever becomes the context source:
// - ge_admin: the U1 tab handle validated exactly like withWorkspace above
//   (mode platform/consultant + tenant + generation + expiry) under the SAME
//   lock semantics (session lock via withSession, then workspace_tabs FOR
//   UPDATE — spec §4 order), read-only; data transactions still lock/revalidate
//   per spec §4.
// - client_admin: the live session's own company, mode 'client'.
// - employee: the live session's own company + own department, mode 'employee'.
// req.user stays unchanged. Admission is checked HERE as well as by
// accessDispatcher (SHIELD-U2A-01): a route that is not activated U1 is refused
// before any context is derived, so mounting this wrapper always fails closed.
// The derived context must also be one of the route's §3 matrix rows
// (SHIELD-U2A-02): platform mode on a W-only row and consultant mode on a
// P-only row are both 403 workspace.mode_mismatch.
// ---------------------------------------------------------------------------
/** SHIELD-U2A-01: this wrapper itself refuses routes that are not activated. */
export function assertRouteActivated(route: RouteDeclaration): void {
  if (route.activation !== 'U1') throw authError(403, 'access.unactivated');
}

const CONTEXT_OF_MODE: Record<AccessMode, MatrixContext> = {
  platform: 'P', consultant: 'W', client: 'C', employee: 'E',
};

/** SHIELD-U2A-02: mode/tenant must match a §3 row of the route being guarded.
 * PUBLIC/SESSION rows are not mode-scoped; GE rows require the GE identity.
 * Everything else must name the caller's own context, else 403
 * workspace.mode_mismatch (§4 role/mode mismatch). */
export function assertRouteContext(route: RouteDeclaration, access: AccessContext): void {
  if (!validBinding(access)) throw authError(403, 'workspace.mode_mismatch');
  const caller = CONTEXT_OF_MODE[access.mode];
  for (const rule of route.matrix) {
    if (rule.context === 'PUBLIC' || rule.context === 'SESSION') return;
    if (rule.context === 'GE') { if (access.role === 'ge_admin') return; continue; }
    if (rule.context === caller) return;
  }
  throw authError(403, 'workspace.mode_mismatch');
}

export async function deriveDomainAccess(req: AuthenticatedRequest,
  route: RouteDeclaration): Promise<AccessContext> {
  assertRouteActivated(route);
  let derived!: AccessContext;
  // Purpose 'workspace': the b17_tabs RLS policy grants this session's tab read
  // under exactly that purpose (same authority withWorkspace already uses).
  await withSession(req, 'workspace', async (client, identity) => {
    assertFreshIdentity(identity);
    const capability = route.capability;
    if (identity.user.role === 'ge_admin') {
      const handle = req.get('X-Workspace-Tab');
      if (!handle || !/^[A-Za-z0-9_-]{43}$/.test(handle)) throw authError(409, 'workspace.invalid');
      // SHIELD-U2A-02: same locked read as withWorkspace (session FOR SHARE via
      // withSession first, then this row FOR UPDATE) so mode/tenant cannot be
      // re-read from a tab that enter/exit is concurrently transitioning.
      const rows = await client.query(`SELECT id,mode,client_id,generation,expires_at FROM workspace_tabs
        WHERE handle_hash=$1 AND session_id=$2 AND user_id=$3 AND revoked_at IS NULL
        AND expires_at>clock_timestamp() FOR UPDATE`, [hashTab(handle), identity.sid, identity.user.id]);
      const tab = rows.rows[0] as WorkspaceRow | undefined;
      if (!tab) throw authError(409, 'workspace.invalid');
      const now: Date = (await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
      if (tab.expires_at <= now) throw authError(409, 'workspace.invalid');
      const version = req.get('X-Workspace-Version');
      if (!validGeneration(version)) throw authError(400, 'workspace.version_required');
      if (Number(version) !== tab.generation) throw authError(409, 'workspace.stale');
      derived = { actorId: identity.user.id, sessionId: identity.sid, role: 'ge_admin', mode: tab.mode,
        tenantId: tab.client_id, departmentId: null, tabId: tab.id, generation: tab.generation, capability };
    } else {
      const role: BusinessRole = identity.user.role;
      derived = { actorId: identity.user.id, sessionId: identity.sid, role,
        mode: role === 'client_admin' ? 'client' : 'employee',
        tenantId: identity.user.clientId ?? null, departmentId: identity.user.departmentId ?? null,
        tabId: null, generation: null, capability };
    }
    // Never attach a context that is not a §3 row of this route.
    assertRouteContext(route, derived);
    req.access = derived;
  }, { explicit: req.method !== 'GET' });
  return derived;
}

/** Express middleware form: classify the route, admit it, derive its §3 context,
 * attach req.access. SHIELD-U2A-01 makes this check the wrapper's own, so a
 * mis-mounted route can never reach its handler with a derived context. */
export async function requireDomainAccess(req: AuthenticatedRequest, res: Response,
  next: NextFunction): Promise<void> {
  try {
    const route = classifyRoute(req.method, req.path);
    if (!route) throw authError(404, 'api.not_found');
    assertRouteActivated(route);
    await deriveDomainAccess(req, route);
    next();
  } catch (err) { sendAuthError(res, err); }
}
