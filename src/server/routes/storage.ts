// B12 (R-01) — storage sub-router: evidence attachments + storage usage.
// Mounted by src/server/routes.ts under the /api prefix. Moved verbatim;
// B12 wiring: both mutating routes carry the fresh gate (F-03) — DELETE via
// requireFreshPassword middleware, POST /answers/:id/attachments via the
// shared assert inside the multer callback (the multipart stream must parse
// before the handler body runs).

import express, { type Response } from 'express';
import multer from 'multer';
import {
  withTenantContext,
  recordAuditLog,
} from '../../db/index.ts';
import {
  authMiddleware,
  type AuthenticatedRequest,
  type AuthUser,
} from '../auth.ts';
import {
  validateAttachment,
  MAX_ATTACHMENT_BYTES,
  STORAGE_WARN_BYTES,
  formatBytes,
} from '../../lib/approvalChain.ts';
import {
  contextFromUser,
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
async function loadVisibleAnswer(client: DbClient, user: AuthUser, answerId: string): Promise<any> {
  const ansRes = await client.query('SELECT * FROM answers WHERE id = $1', [answerId]);
  const answer = ansRes.rows[0];
  if (!answer) {
    throw Object.assign(new Error('Answer not found.'), { statusCode: 404 });
  }
  if (user.role === 'employee') {
    if (!user.departmentId || answer.department_id !== user.departmentId) {
      throw Object.assign(new Error('Employees may only manage attachments for their own department.'), {
        statusCode: 403,
      });
    }
  }
  return answer;
}

// B9-D2. Upload (multipart). Multer enforces the 5 MB stream cap first; the
// route re-checks size + allowlist via validateAttachment (never trust client).
router.post('/answers/:id/attachments', authMiddleware, requireFreshPassword, (req: AuthenticatedRequest, res: Response) => {
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
      const user = req.user!;
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

      const created = await withTenantContext(contextFromUser(user), async (client) => {
        const answer = await loadVisibleAnswer(client, user, req.params.id);
        if (await isFrozenScope(client, answer.client_id, answer.item_id)) {
          throw frozenWriteError();
        }
        const insRes = await client.query(
          `INSERT INTO evidence_attachments (answer_id, file_name, mime, size_bytes, data, uploaded_by)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, answer_id, file_name, mime, size_bytes, uploaded_by, created_at`,
          [answer.id, String(file.originalname).slice(0, 255), file.mimetype, file.size, file.buffer, user.id]
        );

        await recordAuditLog(client, {
          clientId: answer.client_id,
          userId: user.id,
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
router.get('/answers/:id/attachments', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const rows = await withTenantContext(contextFromUser(user), async (client) => {
      await loadVisibleAnswer(client, user, req.params.id);
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

// B9-D2. Single-file download stream.
router.get('/answers/:id/attachments/:attachId/download', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const file = await withTenantContext(contextFromUser(user), async (client) => {
      const answer = await loadVisibleAnswer(client, user, req.params.id);
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

// B9-D2. Delete (uploader or admin; audited).
router.delete('/answers/:id/attachments/:attachId', authMiddleware, requireFreshPassword, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    await withTenantContext(contextFromUser(user), async (client) => {
      const answer = await loadVisibleAnswer(client, user, req.params.id);
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
      const isAdmin = user.role === 'client_admin' || user.role === 'ge_admin';
      if (!isAdmin && file.uploaded_by !== user.id) {
        throw Object.assign(new Error('Only the uploader or an administrator may delete this attachment.'), {
          statusCode: 403,
        });
      }
      await client.query('DELETE FROM evidence_attachments WHERE id = $1', [file.id]);

      await recordAuditLog(client, {
        clientId: answer.client_id,
        userId: user.id,
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
router.get('/storage/usage', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const namedClient = typeof req.query.clientId === 'string' && req.query.clientId.trim() ? req.query.clientId.trim() : null;
    if (user.role !== 'ge_admin' && namedClient && namedClient !== user.clientId) {
      return res.status(403).json({ error: 'Cross-tenant storage access is forbidden.' });
    }
    const tenantId = user.role === 'ge_admin' ? namedClient ?? user.clientId ?? null : user.clientId ?? null;
    if (!tenantId) {
      return res.status(400).json({ error: 'No tenant selected. As a platform admin, choose a tenant (clientId).' });
    }

    const usage = await withTenantContext(contextFromUser(user), async (client) => {
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
