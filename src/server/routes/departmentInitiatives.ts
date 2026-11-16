// TASK-PROTO-U4-1c (OD-12 sections 4 and 8) — department initiative status.
//
// Declarations owned by this file (2):
//   P@T;W:L;C:L;E:L+D  GET /initiatives/department   (own scope rows + proof metadata)
//   E  PATCH /initiatives/department/:id             (performed/note, own department)
//
// The department assignment OF a selected initiative IS the per-department
// status row: nothing is pre-assigned, and the employee creates/updates only its
// own department's row (the matrix + FORCE RLS + ownEmployeeDepartment agree).
// W/C read every department's status; they never write. Proof files live in the
// unified evidence_files surface (see routes/documents.ts, entity_type
// 'initiative_status') so the 5 MB/MIME/lock rules are identical everywhere.
import express, { type Response } from 'express';
import { recordAuditLog } from '../../db/index.ts';
import { authMiddleware, type AuthenticatedRequest } from '../auth.ts';
import { requireDomainAccess } from '../access.ts';
import { domainTransaction, deferredFailure, DeferredRefusal, domainTenant } from './initiativeScope.ts';
import { platformConfigContext, readContext, requireFreshPassword, writeFailure } from './_shared.ts';
import { ownDepartment, ownEmployeeDepartment, scopeError, scopeId } from '../scope.ts';
import { stampsSubmission, validateInitiativeStatusPatch } from '../../lib/departmentInitiatives.ts';

const router = express.Router();

router.get('/initiatives/department', authMiddleware, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const tenant = domainTenant(req, req.query.clientId);
    const department = ownDepartment(req.access!);
    const rows = await domainTransaction(req, async (client) => (await client.query(
      `SELECT ci.id AS client_initiative_id, l.id AS initiative_id, l.title, l.sector,
              l.esg_class, l.standards_ref, l.notes, l.sort_order,
              coalesce((SELECT json_agg(json_build_object(
                  'id', st.id, 'departmentId', st.department_id, 'departmentName', dp.name,
                  'performed', st.performed, 'note', st.note, 'submittedAt', st.submitted_at,
                  'files', coalesce((SELECT json_agg(json_build_object(
                      'id', f.id, 'filename', f.filename, 'mime', f.mime,
                      'sizeBytes', f.size_bytes, 'uploadedBy', f.uploaded_by,
                      'createdAt', f.created_at) ORDER BY f.created_at)
                    FROM evidence_files f
                    WHERE f.entity_type = 'initiative_status' AND f.entity_id = st.id
                      AND f.client_id = $1), '[]'::json))
                ORDER BY dp.name, st.id)
              FROM initiative_department_status st JOIN departments dp ON dp.id = st.department_id
              WHERE st.client_initiative_id = ci.id
                AND ($2::uuid IS NULL OR st.department_id = $2)), '[]'::json) AS statuses
         FROM client_initiatives ci JOIN initiatives_library l ON l.id = ci.initiative_id
        WHERE ci.client_id = $1
        ORDER BY l.sort_order ASC NULLS LAST, l.title ASC, ci.id ASC`, [tenant, department])).rows, (live) =>
      live.access!.mode === 'platform' ? platformConfigContext(live, tenant) : readContext(live));
    res.json(rows);
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    writeFailure(res, err, 'Failed to fetch departmental initiatives');
  }
});

router.patch('/initiatives/department/:id', authMiddleware, requireFreshPassword, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const clientInitiativeId = scopeId(req.params.id, true)!;
    const parsed = validateInitiativeStatusPatch(req.body ?? {});
    if (!parsed.ok) return res.status(400).json({ error: parsed.error, code: parsed.code });
    const patch = parsed.value;
    const result = await domainTransaction(req, async (client) => {
      const access = req.access!;
      const own = ownEmployeeDepartment(access); // W/C/P refused, zero writes
      // The selection must belong to the caller's own tenant; the E read
      // policy admits only selected + service-linked initiatives.
      const selected = (await client.query(
        'SELECT id FROM client_initiatives WHERE id = $1 AND client_id = $2',
        [clientInitiativeId, access.tenantId])).rows[0];
      if (!selected) throw scopeError(404, 'scope.not_found');
      const existing = (await client.query(
        `SELECT * FROM initiative_department_status
          WHERE client_initiative_id = $1 AND department_id = $2`,
        [clientInitiativeId, own])).rows[0];
      // ROUND 2 (F-04/L-02): once the department submitted its status, the
      // recorded outcome is part of the record — `performed` may not be reset
      // (mirror of the document submission lock). Notes stay editable.
      if (existing?.submitted_at && patch.performed === false) {
        throw new DeferredRefusal(409, {
          error: 'This initiative status is already submitted. Notes stay editable; performed cannot be reset.',
          code: 'initiatives.locked',
        });
      }
      const performed = patch.performed ?? existing?.performed ?? false;
      const note = patch.note !== undefined ? patch.note : existing?.note ?? null;
      const submitting = stampsSubmission(performed, existing?.submitted_at);
      const row = existing
        ? (await client.query(
          `UPDATE initiative_department_status SET performed = $1, note = $2,
             submitted_by = $3, submitted_at = $4 WHERE id = $5 RETURNING *`,
          [performed, note, submitting ? access.actorId : existing.submitted_by,
            submitting ? new Date() : existing.submitted_at, existing.id])).rows[0]
        : (await client.query(
          `INSERT INTO initiative_department_status (client_initiative_id, department_id,
             performed, note, submitted_by, submitted_at)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [clientInitiativeId, own, performed, note,
            submitting ? access.actorId : null, submitting ? new Date() : null])).rows[0];
      await recordAuditLog(client, { clientId: access.tenantId, userId: access.actorId,
        action: 'INITIATIVE_STATUS_UPDATED', entityType: 'initiative_department_status',
        entityId: row.id, payload: { clientInitiativeId, departmentId: own, performed,
          fields: Object.keys(patch) } });
      return { id: row.id, clientInitiativeId, departmentId: own, performed: row.performed,
        note: row.note, submittedAt: row.submitted_at, submittedBy: row.submitted_by };
    });
    res.json(result);
  } catch (err: any) {
    if (deferredFailure(res, err)) return;
    writeFailure(res, err, 'Failed to update the department initiative status');
  }
});

export default router;
