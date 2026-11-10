/**
 * Pure tenant/user-access decisions for FIX-BATCH-4 (B + C).
 *
 * These helpers encode the branching rules (403 vs 400 vs 409 shapes) WITHOUT
 * touching the database, so they are unit-testable. Routes call them first,
 * then perform the DB existence checks (tenant exists, department belongs to
 * tenant, e-mail uniqueness) inside the tenant RLS context.
 */

export interface ActorSummary {
  id: string;
  role: 'ge_admin' | 'client_admin' | 'employee' | string;
  clientId?: string | null;
}

export type TenantResolution =
  | { ok: true; effectiveClientId: string; explicit: boolean }
  | { ok: false; status: 400 | 403; error: string };

function normalizeId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * B1/B2: resolves the EFFECTIVE tenant for POST /api/gri/commit.
 * - ge_admin may name any tenant explicitly (explicit=true, audit-logged).
 * - client_admin/employee always use their own tenant: naming another → 403.
 * - No effective tenant (tenant-less ge_admin without clientId) → 400 with a
 *   human "choose a tenant" message (never orphan rows).
 */
export function resolveImportTenant(actor: ActorSummary, namedClientId: unknown): TenantResolution {
  const named = normalizeId(namedClientId);

  if (named && actor.role !== 'ge_admin' && named !== actor.clientId) {
    return {
      ok: false,
      status: 403,
      error: 'Client administrators may only import into their own tenant.',
    };
  }

  const effective = actor.role === 'ge_admin' ? named ?? actor.clientId ?? null : actor.clientId ?? null;

  if (!effective) {
    return {
      ok: false,
      status: 400,
      error: 'No tenant selected. As a platform administrator, choose a tenant (clientId) to import into.',
    };
  }

  return { ok: true, effectiveClientId: effective, explicit: actor.role === 'ge_admin' && named !== null };
}

export interface NewUserInput {
  email?: unknown;
  password?: unknown;
  name?: unknown;
  role?: unknown;
  departmentId?: unknown;
  clientId?: unknown;
}

export interface NormalizedNewUser {
  email: string;
  password: string;
  name: string;
  role: 'ge_admin' | 'client_admin' | 'employee';
  departmentId: string | null;
  /** Null only for tenant-less ge_admin accounts. */
  effectiveClientId: string | null;
  explicit: boolean;
}

export type NewUserValidation =
  | { ok: true; user: NormalizedNewUser }
  | { ok: false; status: 400 | 403; error: string };

const CREATABLE_BY_CLIENT_ADMIN = ['client_admin', 'employee'] as const;

/**
 * C1: validates POST /api/users payloads (shape + permission, no DB).
 * - ge_admin: any tenant (explicit clientId), may create ge_admin (tenant-less).
 * - client_admin: own tenant only (other tenant → 403), never ge_admin (→ 403).
 * - departmentId required iff role=employee (missing → 400, present for
 *   non-employee → 400). Department existence/tenant-match is checked in-route.
 */
export function validateNewUser(creator: ActorSummary, input: NewUserInput): NewUserValidation {
  if (creator.role !== 'ge_admin' && creator.role !== 'client_admin') {
    return { ok: false, status: 403, error: 'Only administrators can create users.' };
  }

  const email = typeof input.email === 'string' ? input.email.toLowerCase().trim() : '';
  if (!email || !email.includes('@')) {
    return { ok: false, status: 400, error: 'A valid email address is required.' };
  }
  const password = typeof input.password === 'string' ? input.password : '';
  if (password.length < 6) {
    return { ok: false, status: 400, error: 'Password must be at least 6 characters.' };
  }
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) {
    return { ok: false, status: 400, error: 'Name is required.' };
  }

  const role = typeof input.role === 'string' ? input.role : '';
  if (role === 'ge_admin' && creator.role !== 'ge_admin') {
    return { ok: false, status: 403, error: 'Only platform administrators can create a platform administrator.' };
  }
  if (role !== 'ge_admin' && role !== 'client_admin' && role !== 'employee') {
    if (creator.role === 'client_admin' && !(CREATABLE_BY_CLIENT_ADMIN as readonly string[]).includes(role)) {
      return { ok: false, status: 400, error: 'Role must be client_admin or employee.' };
    }
    return { ok: false, status: 400, error: 'Role must be ge_admin, client_admin, or employee.' };
  }

  const namedClientId = normalizeId(input.clientId);
  if (namedClientId && creator.role !== 'ge_admin' && namedClientId !== creator.clientId) {
    return { ok: false, status: 403, error: 'Client administrators may only create users in their own tenant.' };
  }

  if (role === 'ge_admin') {
    if (namedClientId) {
      return { ok: false, status: 400, error: 'Platform administrator accounts are tenant-less; do not pass a clientId.' };
    }
    // ge_admin accounts carry no tenant and no department.
    if (normalizeId(input.departmentId)) {
      return { ok: false, status: 400, error: 'Only employee accounts take a departmentId.' };
    }
    return {
      ok: true,
      user: { email, password, name, role: 'ge_admin', departmentId: null, effectiveClientId: null, explicit: false },
    };
  }

  const effectiveClientId =
    creator.role === 'ge_admin' ? namedClientId : creator.clientId ?? null;
  if (!effectiveClientId) {
    return {
      ok: false,
      status: 400,
      error: 'No tenant selected. Choose a tenant (clientId) for this user.',
    };
  }

  const departmentId = normalizeId(input.departmentId);
  if (role === 'employee' && !departmentId) {
    return { ok: false, status: 400, error: 'Employee accounts require a departmentId.' };
  }
  if (role !== 'employee' && departmentId) {
    return { ok: false, status: 400, error: 'Only employee accounts take a departmentId.' };
  }

  return {
    ok: true,
    user: {
      email,
      password,
      name,
      role: role as 'client_admin' | 'employee',
      departmentId: departmentId ?? null,
      effectiveClientId,
      explicit: creator.role === 'ge_admin',
    },
  };
}
