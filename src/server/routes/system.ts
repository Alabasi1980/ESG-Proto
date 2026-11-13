import express from 'express';
import { isDatabaseConfigured, withTenantContext, setTenantContext, recordAuditLog, getPool } from '../../db/index.ts';
import { assertB17Ready } from '../../db/b17Readiness.ts';
import { hashPassword, issueSession, sendAuthError, authError, type AuthUser } from '../auth.ts';
import { sessionCookie } from './session.ts';
import { validateSelfChosenPassword } from '../../lib/password.ts';
import { randomUUID } from 'node:crypto';

const router = express.Router();
router.get('/db/status', async (_req, res) => {
  const configured = isDatabaseConfigured();
  let connected = false;
  if (configured) { try { await getPool().query('SELECT 1'); connected = true; } catch { /* Minimal public diagnostics only. */ } }
  res.json({ configured, connected });
});
router.post('/db/migrate', (_req, res) => {
  res.status(409).json({ error: 'migrations.offline_only', code: 'migrations.offline_only' });
});
router.get('/setup/status', async (_req, res) => {
  try {
    await assertB17Ready();
    const canSetup = await withTenantContext({ purpose: 'auth.setup' }, async client =>
      !(await client.query('SELECT 1 FROM users LIMIT 1')).rows.length);
    res.json({ canSetup, needsMigration: false });
  } catch { res.json({ canSetup: false, needsMigration: true }); }
});
router.post('/setup/admin', async (req, res) => {
  try {
    if (req.headers.authorization !== undefined || req.cookies?.token) throw authError(403, 'setup.denied');
    const { email, password, name, role = 'ge_admin', clientName, clientCode } = req.body ?? {};
    const clientBootstrap = clientName !== undefined || clientCode !== undefined;
    if (typeof email !== 'string' || !email.trim() || email.length > 320 || typeof name !== 'string'
      || !name.trim() || name.length > 200 || !['ge_admin','client_admin'].includes(role)
      || (!clientBootstrap && role !== 'ge_admin')
      || (clientBootstrap && (typeof clientName !== 'string' || !clientName.trim() || clientName.length > 200
        || typeof clientCode !== 'string' || !clientCode.trim() || clientCode.length > 100))
      || !validateSelfChosenPassword(password).ok || password.length > 1024) throw authError(400, 'setup.input_invalid');
    const result = await withTenantContext({ purpose: 'auth.bootstrap' }, async client => {
      // Held across count+insert+session+audit; readiness has already been checked without DDL.
      await client.query('SELECT pg_advisory_xact_lock(1717002)');
      if ((await client.query('SELECT 1 FROM users LIMIT 1')).rows.length) throw authError(403, 'setup.completed');
      const clientId = clientBootstrap ? randomUUID() : null;
      await setTenantContext(client, { purpose: 'auth.bootstrap', targetId: clientId });
      if (clientId) await client.query('INSERT INTO clients(id,code,name) VALUES($1,$2,$3)', [clientId,clientCode.trim(),clientName.trim()]);
      const row = (await client.query(`INSERT INTO users (email,password_hash,name,role,client_id)
        VALUES ($1,$2,$3,$4,$5) RETURNING id,email,name,role`,
      [email.trim().toLowerCase(), await hashPassword(password), name.trim(),clientId?'client_admin':'ge_admin',clientId])).rows[0];
      const user: AuthUser = { ...row, clientId, clientName: clientId ? clientName.trim() : null, departmentId: null };
      await setTenantContext(client, { purpose: 'auth.bootstrap', userId: user.id, role: user.role, tenantId: clientId });
      const { token } = await issueSession(client, user);
      await recordAuditLog(client, { clientId, userId: user.id, action: 'BOOTSTRAP_INITIAL_ADMIN', entityType: 'users', entityId: user.id });
      return { token, user };
    });
    res.cookie('token', result.token, sessionCookie()); res.json(result);
  } catch (err) { sendAuthError(res, err); }
});
export default router;
