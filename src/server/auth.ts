import type { Request, Response, NextFunction } from 'express';
import type pg from 'pg';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { setTenantContext, withTenantContext, type TenantContext } from '../db/index.ts';
import { UUID, type AccessContext } from '../lib/capabilities.ts';

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret?.trim()) throw new Error('JWT_SECRET is required; refusing token operation.');
  return secret;
}
export interface AuthUser {
  id: string;
  clientId?: string | null;
  clientName?: string | null;
  departmentId?: string | null;
  departmentName?: string | null;
  email: string;
  name: string;
  role: 'ge_admin' | 'client_admin' | 'employee';
}
export interface SessionIdentity {
  user: AuthUser;
  sid: string;
  expiresAt: Date;
  mustChangePassword: boolean;
  suspended: boolean;
}
export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
  access?: AccessContext;
  identity?: SessionIdentity;
}
export const authError = (statusCode: number, code: string): Error & { statusCode: number; code: string } =>
  Object.assign(new Error(code), { statusCode, code });
export function sendAuthError(res: Response, error: unknown): void {
  const err = error as { statusCode?: number; code?: string };
  const status = err.statusCode ?? 503;
  const code = err.statusCode ? err.code ?? 'access.denied' : 'access.unavailable';
  res.status(status).json({ error: code, code });
}
export function hashPassword(plain: string): Promise<string> { return bcrypt.hash(plain, 10); }
export function comparePassword(plain: string, hash: string): Promise<boolean> { return bcrypt.compare(plain, hash); }

// sid-less callers can still construct tokens for compatibility tests, but verification rejects them.
export function generateToken(user: AuthUser, sid?: string, expiresAt?: Date): string {
  return jwt.sign({ id: user.id, sid, exp: Math.floor((expiresAt?.getTime() ?? Date.now() + 604800000) / 1000) },
    getJwtSecret(), { algorithm: 'HS256' });
}
function verifySignedSession(token: string, allowExpired = false): { id: string; sid: string } | null {
  // Configuration failure is not an invalid/expired credential or a successful logout.
  const secret = getJwtSecret();
  try {
    const claims = jwt.verify(token, secret, { algorithms: ['HS256'], ignoreExpiration: allowExpired });
    if (typeof claims === 'string' || !UUID.test(claims.id) || !UUID.test(claims.sid)) return null;
    return { id: claims.id, sid: claims.sid };
  } catch { return null; }
}
export function verifyToken(token: string): { id: string; sid: string } | null {
  try { return verifySignedSession(token); } catch { return null; }
}
export function presentedToken(req: Request, explicit = false): string | undefined {
  if ((req.rawHeaders?.filter((value, index) => index % 2 === 0 && value.toLowerCase() === 'authorization').length ?? 0) > 1)
    return undefined;
  // A malformed supplied header must never fall back to a different cookie identity.
  if (req.headers.authorization !== undefined) {
    const match = /^Bearer ([^\s]+)$/.exec(req.headers.authorization);
    return match?.[1];
  }
  return explicit ? undefined : req.cookies?.token;
}
export function identityContext(identity: SessionIdentity, purpose: string): TenantContext {
  return { userId: identity.user.id, sessionId: identity.sid, role: identity.user.role,
    tenantId: identity.user.clientId, departmentId: identity.user.departmentId,
    mode: identity.user.role === 'ge_admin' ? 'platform' : identity.user.role === 'employee' ? 'employee' : 'client', purpose };
}
export async function issueSession(client: pg.PoolClient, user: AuthUser): Promise<{ token: string; sid: string }> {
  const sid = randomUUID();
  const expiresAt = new Date(Math.floor((Date.now() + 604800000) / 1000) * 1000);
  await client.query(`INSERT INTO auth_sessions (sid,user_id,expires_at) VALUES ($1,$2,$3)`, [sid, user.id, expiresAt]);
  return { token: generateToken(user, sid, expiresAt), sid };
}

export async function withSession<T>(req: AuthenticatedRequest, purpose: string,
  operation: (client: pg.PoolClient, identity: SessionIdentity) => Promise<T>,
  options: { exclusive?: boolean; explicit?: boolean } = {}): Promise<T> {
  const token = presentedToken(req, options.explicit);
  const claims = token && verifyToken(token);
  if (!claims) throw authError(401, 'auth.invalid');
  return withTenantContext({ userId: claims.id, sessionId: claims.sid, purpose: 'auth.session' }, async client => {
    // Session precedes user/tab/domain locks. Exclusive issuance makes count+insert a critical section.
    const sessions = await client.query(`SELECT expires_at FROM auth_sessions WHERE sid=$1 AND user_id=$2
      AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR ${options.exclusive ? 'UPDATE' : 'SHARE'}`,
    [claims.sid, claims.id]);
    if (!sessions.rows[0]) throw authError(401, 'auth.invalid');
    if (sessions.rows[0].expires_at <= (await client.query('SELECT clock_timestamp() AS now')).rows[0].now)
      throw authError(401, 'auth.invalid');
    const users = await client.query(`SELECT id,email,name,role,client_id,department_id,is_active,must_change_password
      FROM users WHERE id=$1 FOR ${purpose === 'auth.password' ? 'UPDATE' : 'SHARE'}`, [claims.id]);
    const row = users.rows[0];
    if (!row?.is_active || !['ge_admin','client_admin','employee'].includes(row.role)) throw authError(401, 'auth.invalid');
    const identity: SessionIdentity = { sid: claims.sid, expiresAt: sessions.rows[0].expires_at,
      user: { id: row.id, email: row.email, name: row.name, role: row.role,
        clientId: row.client_id, departmentId: row.department_id },
      mustChangePassword: row.must_change_password === true, suspended: false };
    if (row.role !== 'ge_admin' && !row.client_id) throw authError(401, 'auth.binding_invalid');
    if (row.role === 'employee' && !row.department_id) throw authError(401, 'auth.binding_invalid');
    await setTenantContext(client, identityContext(identity, 'auth.session'));
    if (row.client_id) {
      const tenant = (await client.query('SELECT name,suspended FROM clients WHERE id=$1 FOR SHARE', [row.client_id])).rows[0];
      if (!tenant) throw authError(401, 'auth.binding_invalid');
      identity.user.clientName = tenant.name;
      identity.suspended = tenant.suspended === true;
    }
    if (row.department_id) {
      const department = (await client.query('SELECT name FROM departments WHERE id=$1 AND client_id=$2 FOR SHARE',
        [row.department_id, row.client_id])).rows[0];
      if (!department) throw authError(401, 'auth.binding_invalid');
      identity.user.departmentName = department.name;
    }
    // Identity/tenant locks can queue behind remediation; expiry must still hold afterwards.
    if (identity.expiresAt <= (await client.query('SELECT clock_timestamp() AS now')).rows[0].now)
      throw authError(401, 'auth.invalid');
    await setTenantContext(client, identityContext(identity, purpose));
    req.user = identity.user; req.identity = identity;
    return operation(client, identity);
  });
}
export function assertFreshIdentity(identity: SessionIdentity): void {
  if (identity.mustChangePassword) throw authError(403, 'auth.password_change_required');
  if (identity.user.role !== 'ge_admin' && identity.suspended) throw authError(403, 'tenant.suspended');
}
export async function revokeSession(client: pg.PoolClient, sid: string): Promise<void> {
  await client.query('UPDATE auth_sessions SET revoked_at=clock_timestamp() WHERE sid=$1 AND revoked_at IS NULL', [sid]);
  await client.query('UPDATE workspace_tabs SET revoked_at=clock_timestamp() WHERE session_id=$1 AND revoked_at IS NULL', [sid]);
}
export async function revokePresentedSession(req: AuthenticatedRequest): Promise<void> {
  const token = presentedToken(req, true);
  // Expired signed tokens are accepted ONLY for revocation, never by normal identity validation.
  const claims = token && verifySignedSession(token, true);
  if (!claims) throw authError(401, 'auth.invalid');
  await withTenantContext({ userId: claims.id, sessionId: claims.sid, purpose: 'auth.logout' }, async client => {
    // Cleanup authority is signed sid+user ownership, not a currently usable company/department.
    // Keep the exclusive session lock until its tabs and session revocation commit together.
    const session = await client.query('SELECT sid FROM auth_sessions WHERE sid=$1 AND user_id=$2 FOR UPDATE',
      [claims.sid, claims.id]);
    if (!session.rows[0]) return;
    // Also clean remaining tabs of an already-revoked/expired session; repeats preserve revoked_at.
    await revokeSession(client, claims.sid);
  });
}
export async function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    await withSession(req, 'auth.session', async () => undefined);
    next();
  } catch (err) { sendAuthError(res, err); }
}
export async function optionalAuthMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  if (req.headers.authorization !== undefined || req.cookies?.token) return authMiddleware(req, res, next);
  next();
}
