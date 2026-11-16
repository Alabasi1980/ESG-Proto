// TASK-PROTO-U4-1c (OD-12 sections 3-7) — department documents + the ONE
// unified evidence-file surface for document submissions and department
// initiative statuses.
//
// Declarations owned by this file (9):
//   P  GET/POST/PATCH/DELETE /services/:id/documents        (requirements CRUD)
//   P@T;W:L;C:L;E:L+D  GET /requirements                    (list + state + files)
//   E  PATCH /requirements/:id                              (provided/note/tag)
//   E  POST /evidence/:entityType/:entityId/files
//   P@T;W:L;C:L;E:L+D  GET /evidence/.../:fileId/download
//   E  DELETE /evidence/.../:fileId
//
// The matrix refuses W/C/P on every write before this file runs, FORCE RLS
// row-scopes each statement, and the handlers add the third gate the task
// requires (own-employee-department on every write; 5 MB + MIME allowlist;
// delete locked once the parent's submitted_at is set — mirror U4-1b; zero-write
// refusals; audit on submissions/status changes).
import express, { type Response } from 'express';
import multer from 'multer';
import { recordAuditLog } from '../../db/index.ts';
import { authMiddleware, type AuthenticatedRequest } from '../auth.ts';
import { requireDomainAccess } from '../access.ts';
import { domainTransaction, deferredFailure, DeferredRefusal, domainTenant } from './initiativeScope.ts';
import { platformConfigContext, readContext, requireFreshPassword, writeFailure } from './_shared.ts';
import { ownDepartment, ownEmployeeDepartment, scopeError, scopeId } from '../scope.ts';
import { MAX_ATTACHMENT_BYTES, validateAttachment } from '../../lib/approvalChain.ts';
import {
  EVIDENCE_ENTITY_TYPES,
  isEvidenceEntityType,
  validateRequirementInput,
  validateSubmissionPatch,
} from '../../lib/documents.ts';

const router = express.Router();

// OD-06 demo-scale caps stay exactly the attachment path's: 5 MB stream cap +
// the same allowlist re-check (never trust the client).
const evidenceUpload = multer({
  limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 },
  storage: multer.memoryStorage(),
});

const REQUIREMENT_COLUMNS = `id, service_id, department_id, title, description, required,
  sort_order, tags, created_at`;

async function assertServiceExists(client: any, serviceId: string): Promise<void> {
  const row = (await client.query('SELECT id FROM services WHERE id = $1', [serviceId])).rows[0];
  if (!row) throw scopeError(404, 'scope.not_found');
}

// ----------------------------------------------------------------------
// P — requirements CRUD under a service.
// ----------------------------------------------------------------------

router.get('/services/:id/documents', authMiddleware, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const serviceId = scopeId(req.params.id, true)!;
    const rows = await domainTransaction(req, async (client) => {
      await assertServiceExists(client, serviceId);
      return (await client.query(
        `SELECT ${REQUIREMENT_COLUMNS} FROM document_requirements
          WHERE service_id = $1 ORDER BY sort_order ASC, title ASC, id ASC`, [serviceId])).rows;
    }, readContext);
    res.json(rows);
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    writeFailure(res, err, 'Failed to fetch document requirements');
  }
});

router.post('/services/:id/documents', authMiddleware, requireFreshPassword, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const serviceId = scopeId(req.params.id, true)!;
    const parsed = validateRequirementInput(req.body ?? {}, false);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error, code: parsed.code });
    const v = parsed.value;
    const created = await domainTransaction(req, async (client) => {
      await assertServiceExists(client, serviceId);
      if (v.departmentId) {
        const dept = (await client.query('SELECT id FROM departments WHERE id = $1', [v.departmentId])).rows[0];
        if (!dept) throw scopeError(400, 'documents.department_invalid');
      }
      const row = (await client.query(
        `INSERT INTO document_requirements (service_id, department_id, title, description,
           required, sort_order, tags)
         VALUES ($1, $2, $3, $4, $5, $6, $7::text[]) RETURNING ${REQUIREMENT_COLUMNS}`,
        [serviceId, v.departmentId ?? null, v.title, v.description ?? null,
          v.required ?? true, v.sortOrder ?? 0, v.tags ?? []])).rows[0];
      await recordAuditLog(client, { clientId: null, userId: req.access!.actorId,
        action: 'DOCUMENT_REQUIREMENT_CREATED', entityType: 'document_requirements',
        entityId: row.id, payload: { serviceId, title: row.title, departmentId: row.department_id } });
      return row;
    });
    res.status(201).json(created);
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    writeFailure(res, err, 'Failed to create document requirement');
  }
});

router.patch('/services/:id/documents/:reqId', authMiddleware, requireFreshPassword, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const serviceId = scopeId(req.params.id, true)!;
    const requirementId = scopeId(req.params.reqId, true)!;
    const parsed = validateRequirementInput(req.body ?? {}, true);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error, code: parsed.code });
    const v = parsed.value;
    const updated = await domainTransaction(req, async (client) => {
      await assertServiceExists(client, serviceId);
      const cur = (await client.query(
        'SELECT id FROM document_requirements WHERE id = $1 AND service_id = $2', [requirementId, serviceId])).rows[0];
      if (!cur) throw scopeError(404, 'scope.not_found');
      if (v.departmentId !== undefined && v.departmentId) {
        const dept = (await client.query('SELECT id FROM departments WHERE id = $1', [v.departmentId])).rows[0];
        if (!dept) throw scopeError(400, 'documents.department_invalid');
      }
      const sets: string[] = [];
      const params: any[] = [];
      const push = (column: string, value: unknown, cast = '') => {
        params.push(value); sets.push(`${column} = $${params.length}${cast}`);
      };
      if (v.title !== undefined) push('title', v.title);
      if (v.description !== undefined) push('description', v.description);
      if (v.required !== undefined) push('required', v.required);
      if (v.sortOrder !== undefined) push('sort_order', v.sortOrder);
      if (v.departmentId !== undefined) push('department_id', v.departmentId);
      if (v.tags !== undefined) push('tags', v.tags, '::text[]');
      params.push(requirementId, serviceId);
      const row = (await client.query(
        `UPDATE document_requirements SET ${sets.join(', ')}
          WHERE id = $${params.length - 1} AND service_id = $${params.length}
          RETURNING ${REQUIREMENT_COLUMNS}`, params)).rows[0];
      await recordAuditLog(client, { clientId: null, userId: req.access!.actorId,
        action: 'DOCUMENT_REQUIREMENT_UPDATED', entityType: 'document_requirements',
        entityId: row.id, payload: { serviceId, fields: Object.keys(v) } });
      return row;
    });
    res.json(updated);
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    writeFailure(res, err, 'Failed to update document requirement');
  }
});

router.delete('/services/:id/documents/:reqId', authMiddleware, requireFreshPassword, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const serviceId = scopeId(req.params.id, true)!;
    const requirementId = scopeId(req.params.reqId, true)!;
    const result = await domainTransaction(req, async (client) => {
      await assertServiceExists(client, serviceId);
      const cur = (await client.query(
        'SELECT id, title FROM document_requirements WHERE id = $1 AND service_id = $2 FOR UPDATE',
        [requirementId, serviceId])).rows[0];
      if (!cur) throw scopeError(404, 'scope.not_found');
      // Truthful, catalog-wide blocker count: a department's submission is
      // evidence and must never be removed by a catalog delete (zero writes).
      const submissions = (await client.query(
        'SELECT count(*)::int AS n FROM document_submissions WHERE requirement_id = $1', [requirementId])).rows[0];
      if ((submissions?.n ?? 0) > 0) {
        throw new DeferredRefusal(409, {
          error: `${submissions.n} department submission(s) reference this document requirement. Remove the reference first.`,
          code: 'documents.dependency',
        });
      }
      await client.query('DELETE FROM document_requirements WHERE id = $1', [requirementId]);
      await recordAuditLog(client, { clientId: null, userId: req.access!.actorId,
        action: 'DOCUMENT_REQUIREMENT_DELETED', entityType: 'document_requirements',
        entityId: requirementId, payload: { serviceId, title: cur.title } });
      return { deleted: true };
    });
    res.json(result);
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    writeFailure(res, err, 'Failed to delete document requirement');
  }
});

// ----------------------------------------------------------------------
// E (+ W/C read, P@T read) — the department document list.
// ----------------------------------------------------------------------

router.get('/requirements', authMiddleware, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenant = domainTenant(req, req.query.clientId);
    const department = ownDepartment(req.access!);
    const rows = await domainTransaction(req, async (client) => (await client.query(
      `SELECT r.id, r.service_id, r.department_id, r.title, r.description, r.required,
              r.sort_order, r.tags, r.created_at,
              coalesce((SELECT json_agg(json_build_object(
                  'departmentId', s.department_id, 'departmentName', dp.name,
                  'provided', s.provided, 'note', s.note, 'tag', s.tag,
                  'submittedAt', s.submitted_at,
                  'files', coalesce((SELECT json_agg(json_build_object(
                      'id', f.id, 'filename', f.filename, 'mime', f.mime,
                      'sizeBytes', f.size_bytes, 'uploadedBy', f.uploaded_by,
                      'createdAt', f.created_at) ORDER BY f.created_at)
                    FROM evidence_files f
                    WHERE f.entity_type = 'document_submission' AND f.entity_id = s.id
                      AND f.client_id = $1), '[]'::json))
                ORDER BY dp.name, s.id)
              FROM document_submissions s JOIN departments dp ON dp.id = s.department_id
              WHERE s.requirement_id = r.id AND s.client_id = $1
                AND ($2::uuid IS NULL OR s.department_id = $2)), '[]'::json) AS submissions
         FROM document_requirements r
        WHERE b17_content_fact('service', $1, r.service_id)
          AND ($2::uuid IS NULL OR r.department_id IS NULL OR r.department_id = $2)
        ORDER BY r.sort_order ASC, r.title ASC, r.id ASC`, [tenant, department])).rows, (live) =>
      live.access!.mode === 'platform' ? platformConfigContext(live, tenant) : readContext(live));
    res.json(rows);
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    writeFailure(res, err, 'Failed to fetch departmental requirements');
  }
});

router.patch('/requirements/:id', authMiddleware, requireFreshPassword, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const requirementId = scopeId(req.params.id, true)!;
    const parsed = validateSubmissionPatch(req.body ?? {});
    if (!parsed.ok) return res.status(400).json({ error: parsed.error, code: parsed.code });
    const patch = parsed.value;
    const result = await domainTransaction(req, async (client) => {
      const access = req.access!;
      const own = ownEmployeeDepartment(access); // W/C/P refused, zero writes
      const requirement = (await client.query(
        'SELECT id, service_id, department_id, title FROM document_requirements WHERE id = $1',
        [requirementId])).rows[0];
      if (!requirement) throw scopeError(404, 'scope.not_found');
      if (requirement.department_id && requirement.department_id !== own)
        throw scopeError(403, 'scope.department_mismatch');
      const existing = (await client.query(
        `SELECT * FROM document_submissions
          WHERE client_id = $1 AND department_id = $2 AND requirement_id = $3`,
        [access.tenantId, own, requirementId])).rows[0];
      // Once submitted, the row is a record: provided may not be reset and the
      // proof files are locked (append-only, mirror U4-1b).
      if (existing?.submitted_at && patch.provided === false) {
        throw new DeferredRefusal(409, {
          error: 'This requirement is already submitted. Notes and tags stay editable; provided cannot be reset.',
          code: 'documents.locked',
        });
      }
      const provided = patch.provided ?? existing?.provided ?? false;
      const note = patch.note !== undefined ? patch.note : existing?.note ?? null;
      const tag = patch.tag !== undefined ? patch.tag : existing?.tag ?? null;
      const firstSubmit = provided === true && !existing?.submitted_at;
      const row = existing
        ? (await client.query(
          `UPDATE document_submissions SET provided = $1, note = $2, tag = $3,
             submitted_by = $4, submitted_at = $5 WHERE id = $6 RETURNING *`,
          [provided, note, tag, firstSubmit ? access.actorId : existing.submitted_by,
            firstSubmit ? new Date() : existing.submitted_at, existing.id])).rows[0]
        : (await client.query(
          `INSERT INTO document_submissions (client_id, department_id, requirement_id, provided,
             note, tag, submitted_by, submitted_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
          [access.tenantId, own, requirementId, provided, note, tag,
            firstSubmit ? access.actorId : null, firstSubmit ? new Date() : null])).rows[0];
      await recordAuditLog(client, { clientId: access.tenantId, userId: access.actorId,
        action: firstSubmit ? 'DOCUMENT_SUBMITTED' : 'DOCUMENT_UPDATED',
        entityType: 'document_submissions', entityId: row.id,
        payload: { requirementId, serviceId: requirement.service_id, departmentId: own,
          provided, fields: Object.keys(patch) } });
      return { id: row.id, requirementId, departmentId: own, provided: row.provided,
        note: row.note, tag: row.tag, submittedAt: row.submitted_at, submittedBy: row.submitted_by };
    });
    res.json(result);
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    writeFailure(res, err, 'Failed to update the document submission');
  }
});

// ----------------------------------------------------------------------
// Evidence files (unified parent surface).
// ----------------------------------------------------------------------

/** The parent row of one evidence entity, in the caller's scope. */
async function loadEvidenceParent(client: any, access: any, entityType: string, entityId: string) {
  if (entityType === 'document_submission') {
    return (await client.query('SELECT * FROM document_submissions WHERE id = $1 AND client_id = $2',
      [entityId, access.tenantId])).rows[0];
  }
  const row = (await client.query('SELECT * FROM initiative_department_status WHERE id = $1', [entityId])).rows[0];
  return row;
}

router.post('/evidence/:entityType/:entityId/files', authMiddleware, requireFreshPassword, requireDomainAccess, (req: AuthenticatedRequest, res: Response) => {
  evidenceUpload.single('file')(req, res, async (multerErr: any) => {
    try {
      if (multerErr) {
        if (multerErr.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            error: 'File is too large. Evidence files are limited to 5 MB per file.',
            code: 'attachments.oversize',
          });
        }
        return res.status(400).json({ error: 'Upload failed.', code: 'attachments.upload' });
      }
      if (!isEvidenceEntityType(req.params.entityType)) {
        return res.status(400).json({
          error: `entityType must be one of: ${EVIDENCE_ENTITY_TYPES.join(', ')}.`,
          code: 'evidence.entity_type',
        });
      }
      const entityType = req.params.entityType;
      const entityId = scopeId(req.params.entityId, true)!;
      const file = (req as any).file;
      if (!file) return res.status(400).json({ error: 'A file field named "file" is required.', code: 'attachments.missing' });
      const check = validateAttachment({ mime: file.mimetype, sizeBytes: file.size });
      if (!check.ok) {
        const reason = check.code === 'attachments.oversize'
          ? 'File is too large. Evidence files are limited to 5 MB per file.'
          : 'File type not allowed. Accepted types: PDF, PNG, JPEG, XLSX, CSV, TXT.';
        return res.status(400).json({ error: reason, code: check.code });
      }
      const created = await domainTransaction(req, async (client) => {
        const access = req.access!;
        const own = ownEmployeeDepartment(access);
        const parent = await loadEvidenceParent(client, access, entityType, entityId);
        if (!parent) throw scopeError(404, 'evidence.not_found');
        if (parent.department_id !== own) throw scopeError(403, 'scope.department_mismatch');
        const row = (await client.query(
          `INSERT INTO evidence_files (client_id, department_id, entity_type, entity_id,
             filename, mime, size_bytes, content, uploaded_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id, client_id, department_id, entity_type, entity_id, filename, mime,
                     size_bytes, uploaded_by, created_at`,
          [access.tenantId, own, entityType, entityId, String(file.originalname).slice(0, 255),
            file.mimetype, file.size, file.buffer, access.actorId])).rows[0];
        await recordAuditLog(client, { clientId: access.tenantId, userId: access.actorId,
          action: 'EVIDENCE_FILE_UPLOADED', entityType: 'evidence_files', entityId: row.id,
          payload: { parentType: entityType, parentId: entityId, filename: row.filename,
            mime: row.mime, sizeBytes: file.size } });
        return row;
      });
      res.status(201).json(created);
    } catch (err: any) {
      if (deferredFailure(res, err)) return;
      writeFailure(res, err, 'Failed to upload evidence file');
    }
  });
});

router.get('/evidence/:entityType/:entityId/files/:fileId/download', authMiddleware, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isEvidenceEntityType(req.params.entityType)) {
      return res.status(400).json({
        error: `entityType must be one of: ${EVIDENCE_ENTITY_TYPES.join(', ')}.`,
        code: 'evidence.entity_type',
      });
    }
    const entityType = req.params.entityType;
    const entityId = scopeId(req.params.entityId, true)!;
    const fileId = scopeId(req.params.fileId, true)!;
    const tenant = domainTenant(req, req.query.clientId);
    const file = await domainTransaction(req, async (client) => (await client.query(
      `SELECT * FROM evidence_files WHERE id = $1 AND entity_type = $2 AND entity_id = $3`,
      [fileId, entityType, entityId])).rows[0], (live) =>
      live.access!.mode === 'platform' ? platformConfigContext(live, tenant) : readContext(live));
    if (!file) throw scopeError(404, 'evidence.not_found');
    // Defence in depth beside the RLS row scope: an employee reads only its own
    // department's proof, W/C only their own tenant (never a guessed file id).
    if (req.access!.mode === 'employee' && file.department_id !== req.access!.departmentId)
      throw scopeError(403, 'scope.department_mismatch');
    if (req.access!.mode !== 'platform' && file.client_id !== req.access!.tenantId)
      throw scopeError(404, 'evidence.not_found');
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Length', String(file.size_bytes));
    res.setHeader('Content-Disposition', `attachment; filename="${String(file.filename).replace(/"/g, '')}"`);
    res.send(file.content);
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    writeFailure(res, err, 'Failed to download evidence file');
  }
});

router.delete('/evidence/:entityType/:entityId/files/:fileId', authMiddleware, requireFreshPassword, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!isEvidenceEntityType(req.params.entityType)) {
      return res.status(400).json({
        error: `entityType must be one of: ${EVIDENCE_ENTITY_TYPES.join(', ')}.`,
        code: 'evidence.entity_type',
      });
    }
    const entityType = req.params.entityType;
    const entityId = scopeId(req.params.entityId, true)!;
    const fileId = scopeId(req.params.fileId, true)!;
    await domainTransaction(req, async (client) => {
      const access = req.access!;
      const own = ownEmployeeDepartment(access);
      const parent = await loadEvidenceParent(client, access, entityType, entityId);
      if (!parent) throw scopeError(404, 'evidence.not_found');
      if (parent.department_id !== own) throw scopeError(403, 'scope.department_mismatch');
      // U4-1b evidence lock: once the parent is submitted its proof is part of
      // the record — DELETE is refused with zero writes (append stays allowed).
      if (parent.submitted_at) {
        throw new DeferredRefusal(409, {
          error: 'Evidence files on a submitted record are locked; only unsubmitted records may delete proof.',
          code: 'evidence.locked',
        });
      }
      const file = (await client.query(
        'SELECT * FROM evidence_files WHERE id = $1 AND entity_type = $2 AND entity_id = $3',
        [fileId, entityType, entityId])).rows[0];
      if (!file) throw scopeError(404, 'evidence.not_found');
      if (file.uploaded_by !== access.actorId) throw scopeError(403, 'evidence.not_owner');
      await client.query('DELETE FROM evidence_files WHERE id = $1', [fileId]);
      await recordAuditLog(client, { clientId: access.tenantId, userId: access.actorId,
        action: 'EVIDENCE_FILE_DELETED', entityType: 'evidence_files', entityId: fileId,
        payload: { parentType: entityType, parentId: entityId, filename: file.filename,
          sizeBytes: file.size_bytes } });
    });
    res.json({ success: true });
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    writeFailure(res, err, 'Failed to delete evidence file');
  }
});

export default router;
