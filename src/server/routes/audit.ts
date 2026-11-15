// B12 (S-24) — audit-log read API, retrofitted for B17 U2-B round 3.
//
// §3.6 (binding): P reads PLATFORM events only (client_id IS NULL, no global
// client payloads); W reads its own A-filtered log (mandatory, server-derived);
// C/E are denied even when the env names them delegates — admission is the §3
// matrix inside requireDomainAccess, so the GE_AUDIT_DELEGATES env grant is no
// longer consulted here (retirement checklist §2). The users JOIN stays: the
// narrowly-scoped users SELECT (b17-content.sql D1) resolves platform-event
// actors for P and own-tenant actors for W. Read-only (GET only; the table
// stays append-only).

import express, { type Response } from 'express';
import { domainTransaction, deferredFailure, DeferredRefusal } from './initiativeScope.ts';
import {
  authMiddleware,
  type AuthenticatedRequest,
} from '../auth.ts';
import { requireDomainAccess } from '../access.ts';
import {
  readContext,
} from './_shared.ts';

const router = express.Router();

// G2 E3-02 byte-preserving collapse (see taxonomy catalogFailure): our own
// errors keep today's exact body; raw PG/unknown collapses to the fallback.
function auditFailure(res: Response, err: any, fallback: string): void {
  const own = Number.isInteger(err?.statusCode)
    && !(typeof err?.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code));
  if (own) { res.status(err.statusCode as number).json({ error: err.message || fallback }); return; }
  res.status(500).json({ error: fallback });
}

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;

/** B12 (S-24): audit read UI data — who/what/when/before-after/reason + filters. */
router.get('/audit-log', authMiddleware, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
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

    // §3 preamble: an explicit client filter may only NARROW to the caller's
    // own context. P has no client scope at all (platform events only), so any
    // clientId is an explicit mismatch; W may name only its own A.
    const data = await domainTransaction(req, async (client) => {
      const access = req.access!;
      if (clientId && clientId !== access.tenantId)
        throw new DeferredRefusal(403, { error: 'Cross-tenant audit access is forbidden.', code: 'audit.forbidden' });
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
    }, readContext);

    res.json(data);
  } catch (err: any) {
    // G2 fold: the hand-rolled instanceof DeferredRefusal arm is exactly what
    // deferredFailure already does (byte-identical body/status), so the
    // sanctioned helper owns it now.
    if (deferredFailure(res, err)) return;
    console.error('Audit log read error:', err);
    auditFailure(res, err, 'Failed to read audit log');
  }
});

export default router;
