// B12 (S-24) — audit-log read API.
//
// S-24: "who did what, when — with before/after + reason — over the existing
// append-only audit_log, GE ONLY (plus a named GE delegate), NO client access
// (403 otherwise), read-only (GET only, the table stays append-only)".
//
// Visibility: ge_admin reads everything; a named delegate (see
// isAuditReader) reads within their own tenant scope (RLS applies naturally
// — never elevated). Everyone else (client_admin, employee, anonymous) gets
// 403, even with a valid session.

import express, { type Response } from 'express';
import {
  withTenantContext,
} from '../../db/index.ts';
import {
  authMiddleware,
  type AuthenticatedRequest,
} from '../auth.ts';
import {
  contextFromUser,
  isAuditReader,
} from './_shared.ts';

const router = express.Router();

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

/** B12 (S-24): audit read UI data — who/what/when/before-after/reason + filters. */
router.get('/audit-log', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (!isAuditReader(user)) {
      return res.status(403).json({
        error: 'Only platform administrators (or a named audit delegate) may read the audit log.',
        code: 'audit.forbidden',
      });
    }

    const q = req.query as Record<string, unknown>;
    const action = typeof q.action === 'string' && q.action.trim() ? q.action.trim() : null;
    const entityType = typeof q.entityType === 'string' && q.entityType.trim() ? q.entityType.trim() : null;
    const entityId = typeof q.entityId === 'string' && q.entityId.trim() ? q.entityId.trim() : null;
    const auditUserId = typeof q.userId === 'string' && q.userId.trim() ? q.userId.trim() : null;
    const clientId = typeof q.clientId === 'string' && q.clientId.trim() ? q.clientId.trim() : null;
    const since = typeof q.since === 'string' && q.since.trim() ? q.since.trim() : null;
    const until = typeof q.until === 'string' && q.until.trim() ? q.until.trim() : null;
    const limitRaw = Number(q.limit ?? DEFAULT_LIMIT);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), MAX_LIMIT) : DEFAULT_LIMIT;
    const offsetRaw = Number(q.offset ?? 0);
    const offset = Number.isFinite(offsetRaw) ? Math.max(Math.floor(offsetRaw), 0) : 0;

    const data = await withTenantContext(contextFromUser(user), async (client) => {
      const params: any[] = [];
      const clauses: string[] = [];
      if (action) {
        params.push(`%${action}%`);
        clauses.push(`al.action ILIKE $${params.length}`);
      }
      if (entityType) {
        params.push(entityType);
        clauses.push(`al.entity_type = $${params.length}`);
      }
      if (entityId) {
        params.push(entityId);
        clauses.push(`al.entity_id = $${params.length}`);
      }
      if (auditUserId) {
        params.push(auditUserId);
        clauses.push(`al.user_id = $${params.length}`);
      }
      if (clientId) {
        params.push(clientId);
        clauses.push(`al.client_id = $${params.length}`);
      }
      if (since) {
        params.push(since);
        clauses.push(`al.created_at >= $${params.length}::timestamptz`);
      }
      if (until) {
        params.push(until);
        clauses.push(`al.created_at <= $${params.length}::timestamptz`);
      }
      const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
      params.push(limit, offset);
      const result = await client.query(
        `SELECT al.id, al.client_id, al.user_id,
                u.email AS user_email, u.name AS user_name, u.role AS user_role,
                al.action, al.entity_type, al.entity_id, al.payload, al.created_at
           FROM audit_log al
           LEFT JOIN users u ON u.id = al.user_id
           ${where}
           ORDER BY al.created_at DESC
           LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params
      );
      return { items: result.rows, count: result.rows.length, limit, offset };
    });

    res.json(data);
  } catch (err: any) {
    console.error('Audit log read error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to read audit log' });
  }
});

export default router;
