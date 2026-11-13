import express from 'express';
import type pg from 'pg';
import { randomBytes } from 'node:crypto';
import { withSession, assertFreshIdentity, authError, sendAuthError, identityContext,
  type AuthenticatedRequest, type SessionIdentity } from './auth.ts';
import { hashTab, withWorkspace, type WorkspaceRow } from './access.ts';
import { TAB_LIMIT, TAB_IDLE_MS, UUID, activeBusinessCapabilities } from '../lib/capabilities.ts';
import { recordAuditLog, setTenantContext } from '../db/index.ts';

const router = express.Router();
router.use('/workspace', (req, res, next) => {
  if (Object.keys(req.query).length) { sendAuthError(res, authError(400, 'workspace.input_invalid')); return; }
  next();
});
async function envelope(client: pg.PoolClient, tab: WorkspaceRow) {
  const tenant = tab.client_id ? (await client.query('SELECT id,name,suspended FROM clients WHERE id=$1', [tab.client_id])).rows[0] : null;
  if (tab.client_id && !tenant) throw authError(409, 'workspace.invalid');
  const expires = (await client.query('SELECT expires_at FROM workspace_tabs WHERE id=$1', [tab.id])).rows[0];
  return { mode: tab.mode, client: tenant, generation: tab.generation, expiresAt: expires.expires_at,
    capabilities: activeBusinessCapabilities() };
}
function emptyBody(body: unknown): void {
  if (body !== undefined && (body === null || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).length)) throw authError(400, 'workspace.input_invalid');
}
router.post('/workspace/tab', async (req: AuthenticatedRequest, res) => {
  try {
    emptyBody(req.body);
    const result = await withSession(req, 'workspace', async (client, identity) => {
      if (identity.user.role !== 'ge_admin') throw authError(403, 'workspace.forbidden');
      assertFreshIdentity(identity);
      const count = (await client.query(`SELECT count(*)::int AS n FROM workspace_tabs WHERE session_id=$1
        AND revoked_at IS NULL AND expires_at>clock_timestamp()`, [identity.sid])).rows[0].n;
      if (count >= TAB_LIMIT) throw authError(429, 'workspace.limit');
      const tabHandle = randomBytes(32).toString('base64url');
      const tab = (await client.query(`INSERT INTO workspace_tabs (handle_hash,session_id,user_id,expires_at)
        VALUES ($1,$2,$3,LEAST($4::timestamptz,clock_timestamp()+$5*interval '1 millisecond')) RETURNING *`,
      [hashTab(tabHandle), identity.sid, identity.user.id, identity.expiresAt, TAB_IDLE_MS])).rows[0];
      return { tabHandle, ...await envelope(client, tab) };
    }, { exclusive: true, explicit: true });
    res.status(201).json(result);
  } catch (err) { sendAuthError(res, err); }
});
router.get('/workspace', async (req: AuthenticatedRequest, res) => {
  try { res.json(await withWorkspace(req, 'workspace.read', (client, _identity, tab) => envelope(client, tab), true)); }
  catch (err) { sendAuthError(res, err); }
});
export async function transitionWorkspace(client: pg.PoolClient, identity: SessionIdentity, tab: WorkspaceRow, target: string | null) {
  const previous = { mode: tab.mode, clientId: tab.client_id, generation: tab.generation };
  if (tab.generation >= 2147483647) throw authError(409, 'workspace.invalid');
  const updated = (await client.query(`UPDATE workspace_tabs SET mode=$2,client_id=$3,generation=generation+1
    WHERE id=$1 RETURNING *`, [tab.id, target ? 'consultant' : 'platform', target])).rows[0];
  // Retain old A on exit audit; mode change and audit are in the same locked transaction.
  await setTenantContext(client, { ...identityContext(identity, 'workspace'),
    mode: target ? 'consultant' : 'platform', tenantId: target ?? tab.client_id, tabId: tab.id, targetId: target });
  await recordAuditLog(client, { clientId: target ?? tab.client_id, userId: identity.user.id,
    action: target ? 'WORKSPACE_ENTER' : 'WORKSPACE_EXIT', entityType: 'workspace_tabs', entityId: tab.id,
    payload: { sessionId: identity.sid, tabId: tab.id, previous, mode: updated.mode, clientId: target, generation: updated.generation } });
  return envelope(client, updated);
}
router.post('/workspace/enter', async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.body || Object.keys(req.body).length !== 1 || typeof req.body.clientId !== 'string'
      || !UUID.test(req.body.clientId)) throw authError(400, 'workspace.input_invalid');
    res.json(await withWorkspace(req, 'workspace.enter', async (client, identity, tab) => {
      if (tab.mode !== 'platform') throw authError(409, 'workspace.exit_required');
      await setTenantContext(client, { ...identityContext(identity, 'workspace'), tabId: tab.id, targetId: req.body.clientId });
      const tenant = await client.query('SELECT id FROM clients WHERE id=$1 FOR SHARE', [req.body.clientId]);
      if (!tenant.rows[0]) throw authError(404, 'workspace.client_not_found');
      return transitionWorkspace(client, identity, tab, req.body.clientId);
    }));
  } catch (err) { sendAuthError(res, err); }
});
router.post('/workspace/exit', async (req: AuthenticatedRequest, res) => {
  try {
    emptyBody(req.body);
    res.json(await withWorkspace(req, 'workspace.exit', (client, identity, tab) =>
      tab.mode === 'platform' ? envelope(client, tab) : transitionWorkspace(client, identity, tab, null)));
  } catch (err) { sendAuthError(res, err); }
});
export default router;
