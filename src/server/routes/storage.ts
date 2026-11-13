// B12 (R-01) — storage sub-router: evidence attachments + storage usage,
// retrofitted for B17 U2-B round 3.
// Mounted by src/server/routes.ts under the /api prefix. B12 wiring: both
// mutating routes carry the fresh gate (F-03) plus requireDomainAccess; the
// multipart stream must parse before the handler body runs, so the wrapper is
// mounted as route middleware (it reads headers/session only, never the body).
//
// §3.6: upload = E own-assigned parent only; metadata/download = W/C R+L and
// E R+L+D with attachId bound to that answer; delete = E own uploader OR W
// scoped GE authority — C/P DENIED (the old isAdmin branch that admitted
// client_admin is gone); usage = P explicit T / W-C linked-visible / E own
// assigned. 5 MB + mime checks and the freeze trigger are retained unchanged.

import express, { type Response } from 'express';
import multer from 'multer';
import {
  withTenantContext,
  recordAuditLog,
} from '../../db/index.ts';
import {
  authMiddleware,
  type AuthenticatedRequest,
} from '../auth.ts';
import { requireDomainAccess } from '../access.ts';
import { scopeId } from '../scope.ts';
import {
  validateAttachment,
  MAX_ATTACHMENT_BYTES,
  STORAGE_WARN_BYTES,
  formatBytes,
} from '../../lib/approvalChain.ts';
import type { AccessContext } from '../../lib/capabilities.ts';
import {
  readContext,
  requireFreshPassword,
  isFrozenScope,
  frozenWriteError,
  toFrozenError,
  type DbClient,
} from './_shared.ts';

const router = express.Router();

// OD-06 (demo-scale): evidence attachments stay in DB bytea with a 5 MB cap.
// Production object-storage migration is explicitly out of scope — see the
// comment on the API upload path in routes.ts.
const attachmentUpload = multer({
  limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 },
  storage: multer.memoryStorage(),
});

// ----------------------------------------------------------------------
// 6E. Evidence attachments, 5 MB cap (MP-47, S-15, OD-06)
// ----------------------------------------------------------------------

/** Loads an answer the caller may see (RLS applies); employees: own dept only. */
async function loadVisibleAnswer(client: DbClient, access: AccessContext, answerId: string): Promise<any> {
  const ansRes = await client.query('SELECT * FROM answers WHERE id = $1', [answerId]);
  const answer = ansRes.rows[0];
  if (!answer) {
    throw Object.assign(new Error('Answer not found.'), { statusCode: 404 });
  }
  // Defence in depth: RLS already hides foreign-department answers from E, so
  // this branch only ever sees own-department rows; it mirrors §3 R+L+D.
  if (access.mode === 'employee' && answer.department_id !== access.departmentId) {
    throw Object.assign(new Error('Employees may only manage attachments for their own department.'), {
      statusCode: 403,
    });
  }
  return answer;
}

// B9-D2. Upload (multipart). Multer enforces the 5 MB stream cap first; the
// route re-checks size + allowlist via validateAttachment (never trust client).
router.post('/answers/:id/attachments', authMiddleware, requireFreshPassword, requireDomainAccess, (req: AuthenticatedRequest, res: Response) => {
  attachmentUpload.single('file')(req, res, async (multerErr: any) => {
    try {
      if (multerErr) {
        if (multerErr.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            error: 'File is too large. Evidence attachments are limited to 5 MB per file.',
            code: 'attachments.oversize',
          });
        }
        return res.status(400).json({ error: multerErr.message || 'Upload failed.', code: 'attachments.upload' });
      }
      const access = req.access!;
      const file = (req as any).file;
      if (!file) {
        return res.status(400).json({ error: 'A file field named "file" is required.', code: 'attachments.missing' });
      }
      const check = validateAttachment({ mime: file.mimetype, sizeBytes: file.size });
      if (!check.ok) {
        return res.status(400).json({
          error:
            check.code === 'attachments.oversize'
              ? 'File is too large. Evidence attachments are limited to 5 MB per file.'
              : 'File type not allowed. Accepted types: PDF, PNG, JPEG, XLSX, CSV, TXT.',
          code: check.code,
        });
      }

      const created = await withTenantContext(readContext(req), async (client) => {
        const answer = await loadVisibleAnswer(client, access, req.params.id);
        if (await isFrozenScope(client, answer.client_id, answer.item_id)) {
          throw frozenWriteError();
        }
        // RLS INSERT policy is E-only + uploaded_by=actor + own-assigned parent;
        // this handler mirrors that scope (W/P filing and C editing refused).
        if (access.mode !== 'employee') {
          throw Object.assign(new Error('Only employees may file evidence on their own assigned answers.'), {
            statusCode: 403,
          });
        }
        const insRes = await client.query(
          `INSERT INTO evidence_attachments (answer_id, file_name, mime, size_bytes, data, uploaded_by)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, answer_id, file_name, mime, size_bytes, uploaded_by, created_at`,
          [answer.id, String(file.originalname).slice(0, 255), file.mimetype, file.size, file.buffer, access.actorId]
        );

        await recordAuditLog(client, {
          clientId: answer.client_id,
          userId: access.actorId,
          action: 'ATTACHMENT_UPLOADED',
          entityType: 'evidence_attachments',
          entityId: insRes.rows[0].id,
          payload: { answerId: answer.id, fileName: insRes.rows[0].file_name, mime: insRes.rows[0].mime, sizeBytes: file.size },
        });

        return insRes.rows[0];
      });

      res.status(201).json(created);
    } catch (err: any) {
      console.error('Attachment upload error:', err);
      const mapped = toFrozenError(err);
      res.status(mapped.statusCode || 500).json({ error: mapped.message || 'Failed to upload attachment' });
    }
  });
});

// B9-D2. List metadata (never bulk bytes).
router.get('/answers/:id/attachments', authMiddleware, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const access = req.access!;
    const rows = await withTenantContext(readContext(req), async (client) => {
      await loadVisibleAnswer(client, access, req.params.id);
      const result = await client.query(
        `SELECT ea.id, ea.answer_id, ea.file_name, ea.mime, ea.size_bytes,
                ea.uploaded_by, u.name AS uploaded_by_name, ea.created_at
          FROM evidence_attachments ea
          LEFT JOIN users u ON u.id = ea.uploaded_by
          WHERE ea.answer_id = $1
          ORDER BY ea.created_at ASC`,
        [req.params.id]
      );
      return result.rows;
    });

    res.json({ items: rows, count: rows.length });
  } catch (err: any) {
    console.error('Attachments list error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to fetch attachments' });
  }
});

// B9-D2. Single-file download stream (attachId must belong to that answer).
router.get('/answers/:id/attachments/:attachId/download', authMiddleware, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const access = req.access!;
    const file = await withTenantContext(readContext(req), async (client) => {
      const answer = await loadVisibleAnswer(client, access, req.params.id);
      const fileRes = await client.query('SELECT * FROM evidence_attachments WHERE id = $1 AND answer_id = $2', [
        req.params.attachId,
        answer.id,
      ]);
      if (!fileRes.rows[0]) {
        throw Object.assign(new Error('Attachment not found.'), { statusCode: 404 });
      }
      return fileRes.rows[0];
    });

    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Length', String(file.size_bytes));
    res.setHeader('Content-Disposition', `attachment; filename="${String(file.file_name).replace(/"/g, '')}"`);
    res.send(file.data);
  } catch (err: any) {
    console.error('Attachment download error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to download attachment' });
  }
});

// B9-D2. Delete (§3.6: E own uploader OR W scoped GE authority; C/P denied).
router.delete('/answers/:id/attachments/:attachId', authMiddleware, requireFreshPassword, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const access = req.access!;
    await withTenantContext(readContext(req), async (client) => {
      const answer = await loadVisibleAnswer(client, access, req.params.id);
      if (await isFrozenScope(client, answer.client_id, answer.item_id)) {
        throw frozenWriteError();
      }
      const fileRes = await client.query('SELECT * FROM evidence_attachments WHERE id = $1 AND answer_id = $2', [
        req.params.attachId,
        answer.id,
      ]);
      const file = fileRes.rows[0];
      if (!file) {
        throw Object.assign(new Error('Attachment not found.'), { statusCode: 404 });
      }
      // Handler-side mirror of §3 DELETE: the old `isAdmin` branch admitted
      // client_admin — that contradiction is removed. Employee = own upload
      // only; consultant (W scoped GE) keeps its admin delete authority; any
      // other mode is refused here even though the matrix already refuses it.
      if (access.mode === 'employee') {
        if (String(file.uploaded_by) !== access.actorId) {
          throw Object.assign(new Error('Only the uploader or an administrator may delete this attachment.'), {
            statusCode: 403,
          });
        }
      } else if (access.mode !== 'consultant') {
        throw Object.assign(new Error('Only the uploader or an administrator may delete this attachment.'), {
          statusCode: 403,
        });
      }
      await client.query('DELETE FROM evidence_attachments WHERE id = $1', [file.id]);

      await recordAuditLog(client, {
        clientId: answer.client_id,
        userId: access.actorId,
        action: 'ATTACHMENT_DELETED',
        entityType: 'evidence_attachments',
        entityId: file.id,
        payload: { answerId: answer.id, fileName: file.file_name, sizeBytes: file.size_bytes },
      });
    });

    res.json({ success: true });
  } catch (err: any) {
    console.error('Attachment delete error:', err);
    const mapped = toFrozenError(err);
    res.status(mapped.statusCode || 500).json({ error: mapped.message || 'Failed to delete attachment' });
  }
});

// B9-D3. Storage monitor readout (bytes + files + cap note), shown in Settings.
// §3.6 usage: P needs an explicit validated target T (400 without one); W/C/E
// are pinned to their own server-derived tenant and a supplied foreign clientId
// is an explicit mismatch (403). KNOWN GAP (task §20 D3): under platform mode
// no RLS path admits answers/attachment rows, so a P@T aggregate returns zeros
// rather than true counts — deferred to a later platform-summary round.
router.get('/storage/usage', authMiddleware, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const access = req.access!;
    const namedClient = typeof req.query.clientId === 'string' && req.query.clientId.trim() ? req.query.clientId.trim() : null;
    let tenantId: string;
    if (namedClient) {
      const id = scopeId(namedClient, true)!; // malformed -> 400 scope.id_invalid
      if (access.mode !== 'platform' && id !== access.tenantId) {
        return res.status(403).json({ error: 'Cross-tenant storage access is forbidden.', code: 'scope.tenant_mismatch' });
      }
      tenantId = id;
    } else if (access.mode === 'platform') {
      return res.status(400).json({ error: 'No tenant selected. As a platform admin, choose a tenant (clientId).' });
    } else {
      tenantId = access.tenantId!;
    }

    const usage = await withTenantContext(readContext(req), async (client) => {
      const result = await client.query(
        `SELECT COUNT(*)::int AS files, COALESCE(SUM(ea.size_bytes), 0)::int AS bytes
          FROM evidence_attachments ea
          JOIN answers a ON a.id = ea.answer_id
          WHERE a.client_id = $1`,
        [tenantId]
      );
      const row = result.rows[0] ?? { files: 0, bytes: 0 };
      const bytes = Number(row.bytes) || 0;
      return {
        tenantId,
        bytes,
        files: Number(row.files) || 0,
        formatted: formatBytes(bytes),
        warnThresholdBytes: STORAGE_WARN_BYTES,
        warn: bytes >= STORAGE_WARN_BYTES,
        capNote: 'Demo database capacity is 1 GB. Attachments warn at 800 MB; production object-storage migration is out of scope (OD-06).',
      };
    });

    res.json(usage);
  } catch (err: any) {
    console.error('Storage usage error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to fetch storage usage' });
  }
});

export default router;
