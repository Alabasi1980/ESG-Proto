// B17 U2-F — shared helpers for the §3.4 admin retrofit (task §3(4) focused
// split: admin.ts keeps ONLY the route declarations + middleware, every handler
// body lives in one of adminDirectory/adminClients/adminAssignments/adminStaff,
// so no touched file crosses the ~500-line threshold).
//
// Context rule for every row of this unit (task §2): the ONLY context sources
// are the two SERVER-SELECTED ones attached by requireDomainAccess:
//   - P@T  -> platformConfigContext(req, T) with T resolved by scopeId() from
//     the request (comparison/lookup input, never the authorization source) and
//     existence-checked inside the configuration transaction (404);
//   - W/C/E -> readContext(req) (purpose 'work'), tenant always the caller's OWN
//     server-derived tenant via scope.ts ownTenant(): a supplied id is a
//     COMPARISON only (mismatch 403 scope.tenant_mismatch, malformed 400
//     scope.id_invalid, absent own tenant 400 scope.tenant_required).
// Row-level guards (freeze, blockers, OD-08, OTP-once, draft/status gates,
// notifications) stay in the handlers; RLS is the second ring, never the first.

import type { AuthenticatedRequest } from '../auth.ts';
import { platformConfigContext, readContext, type DbClient } from './_shared.ts';
import { ownTenant, scopeId } from '../scope.ts';
import type { TenantContext } from '../../db/index.ts';

/** §3.4 P@T target: required, UUID-validated BEFORE any SQL (400
 * `scope.id_required` when absent, `scope.id_invalid` when malformed). The
 * caller's mode must already be platform — the §3 matrix refused everyone else
 * in requireDomainAccess (SHIELD-U2A-02). */
export function platformTarget(named: unknown): string {
  return scopeId(named, true)!;
}

/** Mixed-context §3.4 row (P@T | W | C | E in one matrix row): platform callers
 * must name the explicit validated T; work callers get their own tenant with the
 * supplied id compared only. */
export function adminTenantContext(
  req: AuthenticatedRequest,
  named: unknown
): { context: TenantContext; tenant: string; platform: boolean } {
  if (req.access!.mode === 'platform') {
    const target = platformTarget(named);
    return { context: platformConfigContext(req, target), tenant: target, platform: true };
  }
  return { context: readContext(req), tenant: ownTenant(req.access!, named), platform: false };
}

/** P-only, targetless rows (GET /clients list, GET /ge/overview, POST /clients,
 * POST /services/link-all): the ONE platform configuration context with a NULL
 * target — global configuration plus the §6 fixed-aggregate reads (GET /clients
 * progress + /ge/overview totals) that §5 enumerates as the platform-progress
 * exception. Every targetless read that touches a TENANT row runs here, which
 * keeps the c-proof "answers unreachable under the platform summary/work
 * context" invariant literally true.
 *
 * ONE documented exception (Shield Low-3, comment corrected per round-2 ruling
 * 8): GET /users' platform-scope branch (adminDirectory.listUsers without
 * ?clientId) runs readContext on purpose — it is the only P row that needs the
 * work + platform_scope USERS row (client_id IS NULL GE accounts only) and it
 * reaches no tenant/answer/evaluation row at all, so the c-proof R5 invariant
 * still holds verbatim. */
export function platformGlobalContext(req: AuthenticatedRequest): TenantContext {
  return platformConfigContext(req, null);
}

/** Existence re-check inside the configuration transaction: a target that does
 * not exist is 404, never a silent empty result that reads as success. */
export async function assertTenantExists(client: DbClient, tenantId: string): Promise<void> {
  const found = await client.query('SELECT id FROM clients WHERE id = $1', [tenantId]);
  if ((found.rowCount ?? 0) === 0) {
    throw Object.assign(new Error('Target tenant not found for the given clientId.'), { statusCode: 404 });
  }
}

/** GET /clients `?search=` (§3.4 row 1 "searchable"): a non-string/array value is
 * AMBIGUOUS -> 400, never ignored. LIKE wildcards in the input are escaped, so
 * the filter can only narrow (§5: filters narrow, never broaden). */
export function searchableFilter(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') throw Object.assign(new Error('scope.search_invalid'), {
    statusCode: 400, code: 'scope.search_invalid',
  });
  const value = raw.trim();
  if (!value) return null;
  const escaped = value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  return `%${escaped}%`;
}

/** SAFE_USER_COLUMNS is shared by GET /users and the round-2 provisioning row
 * (PATCH /users/:id): password_hash is NEVER selected (B11b binding). */
export const SAFE_USER_COLUMNS = `
  u.id, u.email, u.name, u.role, u.is_active, u.must_change_password, u.client_id, u.department_id,
  u.created_at, c.name AS client_name, d.name AS department_name
`;
