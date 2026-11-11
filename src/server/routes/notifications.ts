// B12 (S-23) — in-app notification inbox API (no e-mail sending anywhere).
//
// - GET /notifications — caller's own latest-50 inbox (unreadOnly filter).
// - GET /notifications/unread-count — badge number.
// - POST /notifications/:id/read — mark one own notification read (404 when
//   it is not the caller's — never leaks another user's inbox).
// - POST /notifications/read-all — mark all own unread read.
// Fan-out generation lives in the domain routers (evaluations, actions,
// admin); the cap (latest 50/user) is enforced by notifyUsers on insert.

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
  requireFreshPassword,
  NOTIFICATION_INBOX_LIMIT,
} from './_shared.ts';

const router = express.Router();

/** B12 (S-23): own inbox, newest first. */
router.get('/notifications', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const q = req.query as Record<string, unknown>;
    const unreadOnly = q.unreadOnly === 'true' || q.unreadOnly === '1';
    const limitRaw = Number(q.limit ?? NOTIFICATION_INBOX_LIMIT);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(Math.floor(limitRaw), 1), NOTIFICATION_INBOX_LIMIT)
      : NOTIFICATION_INBOX_LIMIT;
    const offsetRaw = Number(q.offset ?? 0);
    const offset = Number.isFinite(offsetRaw) ? Math.max(Math.floor(offsetRaw), 0) : 0;

    const data = await withTenantContext(contextFromUser(user), async (client) => {
      const params: any[] = [user.id];
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
    });

    res.json(data);
  } catch (err: any) {
    console.error('Notifications list error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to fetch notifications' });
  }
});

/** B12 (S-23): unread badge number for the caller's inbox. */
router.get('/notifications/unread-count', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const data = await withTenantContext(contextFromUser(user), async (client) => {
      const result = await client.query(
        'SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL',
        [user.id]
      );
      return { unreadCount: result.rows[0]?.n ?? 0 };
    });
    res.json(data);
  } catch (err: any) {
    console.error('Unread count error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to fetch unread count' });
  }
});

/** B12 (S-23): mark one own notification read. */
router.post('/notifications/:id/read', authMiddleware, requireFreshPassword, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const updated = await withTenantContext(contextFromUser(user), async (client) => {
      const upd = await client.query(
        `UPDATE notifications SET read_at = COALESCE(read_at, NOW())
          WHERE id = $1 AND user_id = $2 RETURNING id, read_at`,
        [req.params.id, user.id]
      );
      if (!upd.rows[0]) {
        throw Object.assign(new Error('Notification not found.'), { statusCode: 404 });
      }
      return upd.rows[0];
    });
    res.json(updated);
  } catch (err: any) {
    console.error('Notification read error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to mark notification read' });
  }
});

/** B12 (S-23): mark all own unread notifications read. */
router.post('/notifications/read-all', authMiddleware, requireFreshPassword, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const data = await withTenantContext(contextFromUser(user), async (client) => {
      const upd = await client.query(
        'UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL',
        [user.id]
      );
      return { updated: upd.rowCount ?? 0 };
    });
    res.json(data);
  } catch (err: any) {
    console.error('Notifications read-all error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to mark notifications read' });
  }
});

export default router;
