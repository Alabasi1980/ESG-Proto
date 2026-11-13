import express from 'express';
import { withTenantContext, setTenantContext, recordAuditLog } from '../../db/index.ts';
import { comparePassword, hashPassword, issueSession, withSession, revokePresentedSession,
  identityContext, sendAuthError, authError, type AuthUser, type AuthenticatedRequest } from '../auth.ts';
import { suspendedLoginBody } from '../../lib/b11b.ts';
import { validateSelfChosenPassword } from '../../lib/password.ts';

const router = express.Router();
export const sessionCookie = () => ({ httpOnly: true, sameSite: 'strict' as const,
  secure: process.env.NODE_ENV === 'production', maxAge: 604800000, path: '/' });

router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password
      || email.length > 320 || password.length > 1024) throw authError(400, 'auth.credentials_required');
    const result = await withTenantContext({ purpose: 'auth.login', loginEmail: email.trim().toLowerCase() }, async client => {
      const row = (await client.query(`SELECT id,email,name,password_hash,role,client_id,department_id,
        is_active,must_change_password FROM users WHERE lower(email)=lower($1) FOR SHARE`, [email.trim()])).rows[0];
      if (!row || !await comparePassword(password, row.password_hash)) throw authError(401, 'auth.credentials_invalid');
      if (!row.is_active) throw authError(401, 'auth.inactive');
      if (row.role !== 'ge_admin' && !row.client_id || row.role === 'employee' && !row.department_id)
        throw authError(401, 'auth.binding_invalid');
      const user: AuthUser = { id: row.id, email: row.email, name: row.name, role: row.role,
        clientId: row.client_id, departmentId: row.department_id };
      await setTenantContext(client, { purpose: 'auth.login', userId: user.id, role: user.role,
        tenantId: user.clientId, departmentId: user.departmentId });
      if (user.clientId) {
        const tenant = (await client.query('SELECT name,suspended FROM clients WHERE id=$1 FOR SHARE', [user.clientId])).rows[0];
        if (!tenant) throw authError(401, 'auth.binding_invalid');
        if (tenant.suspended && user.role !== 'ge_admin') return { suspended: true as const };
        user.clientName = tenant.name;
      }
      if (user.departmentId) {
        const department = (await client.query('SELECT name FROM departments WHERE id=$1 AND client_id=$2 FOR SHARE',
          [user.departmentId, user.clientId])).rows[0];
        if (!department) throw authError(401, 'auth.binding_invalid');
        user.departmentName = department.name;
      }
      const { token } = await issueSession(client, user);
      await recordAuditLog(client, { clientId: user.clientId, userId: user.id,
        action: 'USER_LOGIN', entityType: 'users', entityId: user.id });
      return { token, user: { ...user, mustChangePassword: row.must_change_password }, mustChangePassword: row.must_change_password };
    });
    if ('suspended' in result) { res.json(suspendedLoginBody()); return; }
    res.cookie('token', result.token, sessionCookie());
    res.json(result);
  } catch (err) { sendAuthError(res, err); }
});
router.post('/auth/logout', async (req: AuthenticatedRequest, res) => {
  try {
    if (req.cookies?.token && req.headers.authorization === undefined) throw authError(403, 'auth.explicit_required');
    if (req.headers.authorization !== undefined) {
      await revokePresentedSession(req);
    }
    res.clearCookie('token', { path: '/', sameSite: 'strict', secure: process.env.NODE_ENV === 'production' });
    res.json({ success: true, message: 'Logged out successfully.' });
  } catch (err) { sendAuthError(res, err); }
});
router.get('/auth/me', async (req: AuthenticatedRequest, res) => {
  try {
    res.json(await withSession(req, 'auth.session', async (_client, identity) => ({ user: {
      ...identity.user, mustChangePassword: identity.mustChangePassword, suspended: identity.suspended,
    } })));
  } catch (err) { sendAuthError(res, err); }
});
router.post('/auth/change-password', async (req: AuthenticatedRequest, res) => {
  try {
    const { currentPassword, newPassword } = req.body ?? {};
    if (typeof currentPassword !== 'string' || currentPassword.length > 1024) throw authError(400, 'auth.password_invalid');
    const check = validateSelfChosenPassword(newPassword);
    if (!check.ok || newPassword.length > 1024) throw authError(400, 'auth.password_invalid');
    await withSession(req, 'auth.password', async (client, identity) => {
      const row = (await client.query('SELECT password_hash FROM users WHERE id=$1', [identity.user.id])).rows[0];
      if (!row || !await comparePassword(currentPassword, row.password_hash)) throw authError(400, 'auth.password_incorrect');
      await client.query('UPDATE users SET password_hash=$1,must_change_password=false,updated_at=NOW() WHERE id=$2',
        [await hashPassword(newPassword), identity.user.id]);
      await setTenantContext(client, identityContext(identity, 'auth.password'));
      await recordAuditLog(client, { clientId: identity.user.clientId, userId: identity.user.id,
        action: 'PASSWORD_CHANGED', entityType: 'users', entityId: identity.user.id });
    }, { exclusive: true, explicit: true });
    res.json({ success: true, message: 'Password updated successfully.' });
  } catch (err) { sendAuthError(res, err); }
});
export default router;
