// B12 (S-23) — in-app notification inbox API (no e-mail sending anywhere),
// retrofitted for B17 U2-B round 3.
//
// - GET /notifications — caller's own inbox (unreadOnly filter).
// - GET /notifications/unread-count — badge number.
// - POST /notifications/:id/read — mark one own notification read (404 when
//   it is not the caller's — never leaks another user's inbox).
// - POST /notifications/read-all — mark own unread rows in the current
//   permitted scope only, never other clients' rows.
// §3.6: P own platform rows / W own A / C own company / E denied (the matrix
// inside requireDomainAccess refuses E outright — no polling path exists).
// Row scope is the RLS policy set; this handler only pins user_id to the
// server-derived actor (req.access), never to a client-supplied id. Fan-out
// generation lives in the domain routers; the cap (latest 50/user) is enforced
// by notifyUsers on insert under the server-side notify context.

import express, { type Response } from 'express';
import { domainTransaction, boundaryFailure } from './initiativeScope.ts';
import {
  authMiddleware,
  type AuthenticatedRequest,
} from '../auth.ts';
import { requireDomainAccess } from '../access.ts';
import {
  readContext,
  requireFreshPassword,
  NOTIFICATION_INBOX_LIMIT,
} from './_shared.ts';

const router = express.Router();

/** B12 (S-23): own inbox, newest first. */
router.get('/notifications', authMiddleware, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const q = req.query as Record<string, unknown>;
    const unreadOnly = q.unreadOnly === 'true' || q.unreadOnly === '1';
    const limitRaw = Number(q.limit ?? NOTIFICATION_INBOX_LIMIT);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(Math.floor(limitRaw), 1), NOTIFICATION_INBOX_LIMIT)
      : NOTIFICATION_INBOX_LIMIT;
    const offsetRaw = Number(q.offset ?? 0);
    const offset = Number.isFinite(offsetRaw) ? Math.max(Math.floor(offsetRaw), 0) : 0;

    const data = await domainTransaction(req, async (client) => {
      const access = req.access!;
      const params: any[] = [access.actorId];
      let where = 'WHERE n.user_id = $1';
      if (unreadOnly) {
        where += ' AND n.read_at IS NULL';
      }
      params.push(limit, offset);
      const result = await client.query(
        `SELECT n.id, n.type, n.title, n.title_ar, n.body, n.body_ar,
                n.entity_type, n.entity_id, n.read_at, n.created_at
           FROM notifications n
           ${where}
           ORDER BY n.created_at DESC
           LIMIT $2 OFFSET $3`,
        params
      );
      return { items: result.rows, count: result.rows.length, limit, offset };
    }, readContext);

    res.json(data);
  } catch (err: any) {
    if (boundaryFailure(res, err)) return;
    console.error('Notifications list error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to fetch notifications' });
  }
});

/** B12 (S-23): unread badge number for the caller's inbox. */
router.get('/notifications/unread-count', authMiddleware, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = await domainTransaction(req, async (client) => {
      const access = req.access!;
      const result = await client.query(
        'SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL',
        [access.actorId]
      );
      return { unreadCount: result.rows[0]?.n ?? 0 };
    }, readContext);
    res.json(data);
  } catch (err: any) {
    if (boundaryFailure(res, err)) return;
    console.error('Unread count error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to fetch unread count' });
  }
});

/** B12 (S-23): mark one own notification read (scope + ownership, else 404). */
router.post('/notifications/:id/read', authMiddleware, requireFreshPassword, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const updated = await domainTransaction(req, async (client) => {
      const access = req.access!;
      const upd = await client.query(
        `UPDATE notifications SET read_at = COALESCE(read_at, NOW())
          WHERE id = $1 AND user_id = $2 RETURNING id, read_at`,
        [req.params.id, access.actorId]
      );
      if (!upd.rows[0]) {
        throw Object.assign(new Error('Notification not found.'), { statusCode: 404 });
      }
      return upd.rows[0];
    }, readContext);
    res.json(updated);
  } catch (err: any) {
    if (boundaryFailure(res, err)) return;
    console.error('Notification read error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to mark notification read' });
  }
});

/** B12 (S-23): mark all own unread notifications in the permitted scope read. */
router.post('/notifications/read-all', authMiddleware, requireFreshPassword, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = await domainTransaction(req, async (client) => {
      const access = req.access!;
      const upd = await client.query(
        'UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL',
        [access.actorId]
      );
      return { updated: upd.rowCount ?? 0 };
    }, readContext);
    res.json(data);
  } catch (err: any) {
    if (boundaryFailure(res, err)) return;
    console.error('Read-all error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to mark notifications read' });
  }
});

export default router;
