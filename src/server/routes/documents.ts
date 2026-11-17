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
import { domainTransaction, deferredFailure, DeferredRefusal, domainTenant, parseExpectedVersion, u41cProtectLock } from './initiativeScope.ts';
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

const REQUIREMENT_COLUMNS = `id, client_id, service_id, department_id, title, description, required,
  sort_order, tags, created_at`;

// ----------------------------------------------------------------------
// P — requirements CRUD under a service, PER CLIENT (round 2, F-05/L-03).
// Every row is client-scoped: the platform names the target client explicitly
// (clientId), the service must be linked to it, and the write runs under the
// platform.config context with that target — so the P@T matrix rows are real.
// ----------------------------------------------------------------------

/** The explicit target client of a P requirement operation (T). */
function requirementTenant(req: AuthenticatedRequest): string {
  const name = req.query.clientId ?? (req.body ?? {}).clientId;
  return domainTenant(req, name);
}

/** The service must be linked to the target client (no orphan catalog rows). */
async function assertLinkedService(client: any, tenant: string, serviceId: string): Promise<void> {
  const linked = (await client.query("SELECT b17_content_fact('service',$1,$2) AS ok",
    [tenant, serviceId])).rows[0]?.ok;
  if (!linked) throw scopeError(403, 'scope.service_unlinked');
}

router.get('/services/:id/documents', authMiddleware, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const serviceId = scopeId(req.params.id, true)!;
    const tenant = requirementTenant(req);
    const rows = await domainTransaction(req, async (client) => {
      await assertLinkedService(client, tenant, serviceId);
      return (await client.query(
        `SELECT ${REQUIREMENT_COLUMNS} FROM document_requirements
          WHERE client_id = $1 AND service_id = $2 ORDER BY sort_order ASC, title ASC, id ASC`,
        [tenant, serviceId])).rows;
    }, (live) => live.access!.mode === 'platform' ? platformConfigContext(live, tenant) : readContext(live));
    res.json(rows);
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    writeFailure(res, err, 'Failed to fetch document requirements');
  }
});

router.post('/services/:id/documents', authMiddleware, requireFreshPassword, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const serviceId = scopeId(req.params.id, true)!;
    const tenant = requirementTenant(req);
    const parsed = validateRequirementInput(req.body ?? {}, false);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error, code: parsed.code });
    const v = parsed.value;
    const created = await domainTransaction(req, async (client) => {
      await assertLinkedService(client, tenant, serviceId);
      if (v.departmentId) {
        const dept = (await client.query('SELECT id FROM departments WHERE id = $1 AND client_id = $2',
          [v.departmentId, tenant])).rows[0];
        if (!dept) throw scopeError(400, 'documents.department_invalid');
      }
      const row = (await client.query(
        `INSERT INTO document_requirements (client_id, service_id, department_id, title, description,
           required, sort_order, tags)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[]) RETURNING ${REQUIREMENT_COLUMNS}`,
        [tenant, serviceId, v.departmentId ?? null, v.title, v.description ?? null,
          v.required ?? true, v.sortOrder ?? 0, v.tags ?? []])).rows[0];
      await recordAuditLog(client, { clientId: tenant, userId: req.access!.actorId,
        action: 'DOCUMENT_REQUIREMENT_CREATED', entityType: 'document_requirements',
        entityId: row.id, payload: { clientId: tenant, serviceId, title: row.title,
          departmentId: row.department_id } });
      return row;
    }, (live) => live.access!.mode === 'platform' ? platformConfigContext(live, tenant) : readContext(live));
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
    const tenant = requirementTenant(req);
    const parsed = validateRequirementInput(req.body ?? {}, true);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error, code: parsed.code });
    const v = parsed.value;
    const updated = await domainTransaction(req, async (client) => {
      await assertLinkedService(client, tenant, serviceId);
      const cur = (await client.query(
        'SELECT id FROM document_requirements WHERE id = $1 AND service_id = $2 AND client_id = $3',
        [requirementId, serviceId, tenant])).rows[0];
      if (!cur) throw scopeError(404, 'scope.not_found');
      if (v.departmentId !== undefined && v.departmentId) {
        const dept = (await client.query('SELECT id FROM departments WHERE id = $1 AND client_id = $2',
          [v.departmentId, tenant])).rows[0];
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
      params.push(requirementId, serviceId, tenant);
      const row = (await client.query(
        `UPDATE document_requirements SET ${sets.join(', ')}
          WHERE id = $${params.length - 2} AND service_id = $${params.length - 1}
            AND client_id = $${params.length}
          RETURNING ${REQUIREMENT_COLUMNS}`, params)).rows[0];
      await recordAuditLog(client, { clientId: tenant, userId: req.access!.actorId,
        action: 'DOCUMENT_REQUIREMENT_UPDATED', entityType: 'document_requirements',
        entityId: row.id, payload: { clientId: tenant, serviceId, fields: Object.keys(v) } });
      return row;
    }, (live) => live.access!.mode === 'platform' ? platformConfigContext(live, tenant) : readContext(live));
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
    const tenant = requirementTenant(req);
    const result = await domainTransaction(req, async (client) => {
      await assertLinkedService(client, tenant, serviceId);
      const cur = (await client.query(
        'SELECT id, title FROM document_requirements WHERE id = $1 AND service_id = $2 AND client_id = $3 FOR UPDATE',
        [requirementId, serviceId, tenant])).rows[0];
      if (!cur) throw scopeError(404, 'scope.not_found');
      // ROUND 2 (H-01): NO count pre-check. The guarantee is the FK itself —
      // document_submissions.requirement_id is ON DELETE RESTRICT — so a
      // department's submission can never be cascade-deleted, and a delete is
      // atomic whether or not the caller can see the child rows. ROUND 3 (G-02):
      // a RESTRICT refusal can surface as either SQLSTATE — 23001
      // (restrict_violation) or 23503 (foreign_key_violation) depending on the
      // plan — so BOTH map to the unit's own 409 body with no raw PG text.
      try {
        await client.query('DELETE FROM document_requirements WHERE id = $1', [requirementId]);
      } catch (fkErr: any) {
        if (fkErr?.code === '23001' || fkErr?.code === '23503') {
          throw new DeferredRefusal(409, {
            error: 'A department submission references this document requirement. Remove the reference first.',
            code: 'documents.dependency',
          });
        }
        throw fkErr;
      }
      await recordAuditLog(client, { clientId: tenant, userId: req.access!.actorId,
        action: 'DOCUMENT_REQUIREMENT_DELETED', entityType: 'document_requirements',
        entityId: requirementId, payload: { clientId: tenant, serviceId, title: cur.title } });
      return { deleted: true };
    }, (live) => live.access!.mode === 'platform' ? platformConfigContext(live, tenant) : readContext(live));
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
    // ROUND 3 (G-03/M-02): the department is resolved INSIDE the transaction and
    // only for a work mode — a platform caller has no department, and
    // ownDepartment() (which asserts a work scope) must never run for P.
    // PROTECT: each submission carries its id + revision; employees also get
    // the scalar ownVersion (own department revision or 0). W/C/P rows carry
    // their revision but never another department's ownVersion.
    const rows = await domainTransaction(req, async (client) => {
      const own = req.access!.mode === 'platform' ? null : ownDepartment(req.access!);
      return (await client.query(
      `SELECT r.id, r.service_id, r.department_id, r.title, r.description, r.required,
              r.sort_order, r.tags, r.created_at,
              coalesce((SELECT json_agg(json_build_object(
                  'id', s.id, 'departmentId', s.department_id, 'departmentName', dp.name,
                  'provided', s.provided, 'note', s.note, 'tag', s.tag,
                  'submittedAt', s.submitted_at, 'version', s.version,
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
                AND ($2::uuid IS NULL OR s.department_id = $2)), '[]'::json) AS submissions,
              CASE WHEN $2::uuid IS NULL THEN NULL ELSE
                coalesce((SELECT s.version FROM document_submissions s
                  WHERE s.requirement_id = r.id AND s.client_id = $1 AND s.department_id = $2), 0) END AS "ownVersion"
         FROM document_requirements r
        WHERE r.client_id = $1
          AND b17_content_fact('service', $1, r.service_id)
          AND ($2::uuid IS NULL OR r.department_id IS NULL OR r.department_id = $2)
        ORDER BY r.sort_order ASC, r.title ASC, r.id ASC`,
      [tenant, own])).rows; }, (live) =>
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
    // PROTECT: missing/non-integer/negative/overflow versions use the existing
    // baseline 400 (evaluations wording); no new visible message.
    const versioned = parseExpectedVersion((req.body ?? {}).expectedVersion);
    if (!versioned.ok) return res.status(versioned.status).json({
      error: versioned.error, code: versioned.code,
      conflict: { expectedVersion: null, providedVersion: null },
    });
    const expectedVersion = versioned.value;
    const stale = (current: number | null): never => {
      throw new DeferredRefusal(409, {
        error: 'تغيّرت البيانات منذ فتحها. يرجى تحديثها ومراجعة التعديلات قبل الحفظ.',
        code: 'version.conflict',
        conflict: { expectedVersion: current, providedVersion: expectedVersion },
      });
    };
    const result = await domainTransaction(req, async (client) => {
      const access = req.access!;
      const own = ownEmployeeDepartment(access); // W/C/P refused, zero writes
      // Pre-lock scoped read: the requirement must belong to the caller's own
      // tenant before the anchor can be derived from it.
      const pre = (await client.query(
        'SELECT id, service_id, department_id, title FROM document_requirements WHERE id = $1 AND client_id = $2',
        [requirementId, access.tenantId])).rows[0];
      if (!pre) throw scopeError(404, 'scope.not_found');
      if (pre.department_id && pre.department_id !== own)
        throw scopeError(403, 'scope.department_mismatch');
      // One canonical anchor (server tenant + requirement ID). Serializes the
      // two first-inserts (both expect 0) and every same-version update, plus
      // the submit/delete ordering against evidence on the same requirement.
      await u41cProtectLock(client, 'requirement', access.tenantId!, requirementId);
      // Post-wait scoped revalidation: same requirement, tenant and
      // department binding must still hold before touching the submission.
      const requirement = (await client.query(
        'SELECT id, service_id, department_id, title FROM document_requirements WHERE id = $1 AND client_id = $2',
        [requirementId, access.tenantId])).rows[0];
      if (!requirement) throw scopeError(404, 'scope.not_found');
      if (requirement.department_id && requirement.department_id !== own)
        throw scopeError(403, 'scope.department_mismatch');
      const existing = (await client.query(
        `SELECT * FROM document_submissions
          WHERE client_id = $1 AND department_id = $2 AND requirement_id = $3`,
        [access.tenantId, own, requirementId])).rows[0];
      const current = existing ? Number(existing.version ?? 1) : 0;
      if (current !== expectedVersion) stale(existing ? current : 0);
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
      let row;
      if (existing) {
        // Conditional single-row update: first same-version writer wins; the
        // loser sees zero rows and conflicts (no silent retry/merge).
        row = (await client.query(
          `UPDATE document_submissions SET provided = $1, note = $2, tag = $3,
             submitted_by = $4, submitted_at = $5, version = version + 1
            WHERE id = $6 AND version = $7 RETURNING *`,
          [provided, note, tag, firstSubmit ? access.actorId : existing.submitted_by,
            firstSubmit ? new Date() : existing.submitted_at, existing.id, expectedVersion])).rows[0];
        if (!row) stale(Number(existing.version ?? 1));
      } else {
        row = (await client.query(
          `INSERT INTO document_submissions (client_id, department_id, requirement_id, provided,
             note, tag, submitted_by, submitted_at, version)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1) RETURNING *`,
          [access.tenantId, own, requirementId, provided, note, tag,
            firstSubmit ? access.actorId : null, firstSubmit ? new Date() : null])).rows[0];
      }
      await recordAuditLog(client, { clientId: access.tenantId, userId: access.actorId,
        action: firstSubmit ? 'DOCUMENT_SUBMITTED' : 'DOCUMENT_UPDATED',
        entityType: 'document_submissions', entityId: row.id,
        payload: { requirementId, serviceId: requirement.service_id, departmentId: own,
          provided, fields: Object.keys(patch), expectedVersion, version: row.version } });
      return { id: row.id, requirementId, departmentId: own, provided: row.provided,
        note: row.note, tag: row.tag, submittedAt: row.submitted_at, submittedBy: row.submitted_by,
        version: row.version };
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

/** The parent row of one evidence entity, in the caller's scope. Tenant-bound:
 * a foreign or orphan parent is indistinguishable from absent (404), and no
 * foreign row is ever returned. For initiative statuses the tenant is proven
 * through the selection + department join, not the status row alone.
 * PROTECT round 4 (M-01, fail-closed): the selection join binds ACTIVE only,
 * so an archived selection resolves as absent and upload/delete reuse the
 * existing evidence.not_found 404 — no new user-visible text. */
async function loadEvidenceParent(client: any, access: any, entityType: string, entityId: string) {
  if (entityType === 'document_submission') {
    return (await client.query('SELECT * FROM document_submissions WHERE id = $1 AND client_id = $2',
      [entityId, access.tenantId])).rows[0];
  }
  return (await client.query(
    `SELECT st.* FROM initiative_department_status st
       JOIN client_initiatives ci ON ci.id = st.client_initiative_id AND ci.client_id = $2
         AND ci.archived_at IS NULL
       JOIN departments d ON d.id = st.department_id AND d.client_id = $2
      WHERE st.id = $1`,
    [entityId, access.tenantId])).rows[0];
}

/** Resolve the canonical anchor resource for an evidence parent. Returns the
 * (kind, resourceId) tuple; throws 404 when linkage is ambiguous/orphaned. */
async function evidenceAnchor(client: any, access: any, entityType: string, parent: any) {
  if (entityType === 'document_submission') {
    const req = (await client.query(
      'SELECT id FROM document_requirements WHERE id = $1 AND client_id = $2',
      [parent.requirement_id, access.tenantId])).rows[0];
    if (!req) throw scopeError(404, 'evidence.not_found');
    return { kind: 'requirement' as const, resourceId: String(req.id) };
  }
  const sel = (await client.query(
    'SELECT ci.id, ci.initiative_id FROM client_initiatives ci WHERE ci.id = $1 AND ci.client_id = $2',
    [parent.client_initiative_id, access.tenantId])).rows[0];
  if (!sel) throw scopeError(404, 'evidence.not_found');
  return { kind: 'initiative' as const, resourceId: String(sel.initiative_id), selectionId: String(sel.id) };
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
        const pre = await loadEvidenceParent(client, access, entityType, entityId);
        if (!pre) throw scopeError(404, 'evidence.not_found');
        if (pre.department_id !== own) throw scopeError(403, 'scope.department_mismatch');
        // PROTECT: same anchor as the parent status/submission writer, then
        // reread the SAME scoped parent before acting (no redirect to a
        // replacement row, no inferred missing parent).
        const anchor = await evidenceAnchor(client, access, entityType, pre);
        await u41cProtectLock(client, anchor.kind, access.tenantId!, anchor.resourceId);
        const parent = await loadEvidenceParent(client, access, entityType, entityId);
        if (!parent || parent.department_id !== own) throw scopeError(404, 'evidence.not_found');
        if (entityType === 'initiative_status') {
          const reselected = await evidenceAnchor(client, access, entityType, parent);
          if (reselected.resourceId !== anchor.resourceId
            || (anchor as any).selectionId !== (reselected as any).selectionId) {
            throw scopeError(404, 'evidence.not_found');
          }
        } else if (String(parent.requirement_id) !== anchor.resourceId) {
          throw scopeError(404, 'evidence.not_found');
        }
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
      const pre = await loadEvidenceParent(client, access, entityType, entityId);
      if (!pre) throw scopeError(404, 'evidence.not_found');
      if (pre.department_id !== own) throw scopeError(403, 'scope.department_mismatch');
      // PROTECT: same anchor as the submit writer; delete commits first only
      // when the submit has not yet stamped the parent. Re-read after waiting.
      const anchor = await evidenceAnchor(client, access, entityType, pre);
      await u41cProtectLock(client, anchor.kind, access.tenantId!, anchor.resourceId);
      const parent = await loadEvidenceParent(client, access, entityType, entityId);
      if (!parent || parent.department_id !== own) throw scopeError(404, 'evidence.not_found');
      if (entityType === 'initiative_status') {
        const reselected = await evidenceAnchor(client, access, entityType, parent);
        if (reselected.resourceId !== anchor.resourceId
          || (anchor as any).selectionId !== (reselected as any).selectionId) {
          throw scopeError(404, 'evidence.not_found');
        }
      } else if (String(parent.requirement_id) !== anchor.resourceId) {
        throw scopeError(404, 'evidence.not_found');
      }
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
