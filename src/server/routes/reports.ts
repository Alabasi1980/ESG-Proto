// B12 (R-01) — reports sub-router: D-038 settings, disclosure index, level
// views (L1/L2/L3) and gated export. Mounted under /api. Moved verbatim;
// B12 wiring: requireFreshPassword on PUT /report-settings (F-03).

import express, { type Response } from 'express';
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
  REPORT_GATE_CODE,
  REPORT_GATE_REFUSAL,
  applyDepartmentVisibility,
  applyShowGapFlags,
  buildDisclosureIndex,
  indexIncompleteMessage,
  indexToCSV,
  isNotifiedState,
  isReportLevel,
  reportGateStatus,
  validateReportSettingsInput,
} from '../../lib/reports.ts';
import { calculateAggregateScore, gateDraftEvaluations } from '../../lib/scoring.ts';
import {
  contextFromUser,
  requireFreshPassword,
  B16_CLIENT_LEVEL_REFUSAL,
  type DbClient,
} from './_shared.ts';

const router = express.Router();

// ----------------------------------------------------------------------
// 12. Reports — D-038 gate, disclosure index, level views + export
// (FIX BATCH 10 / MP-47/48/49/50, A-09..A-13, M-11/10 §6, OD-05, 04 §4)
//
// - Report level is stored per (client × service), NO default (A-09).
// - Every report/export endpoint checks the gate FIRST → 409 + the unified
//   bilingual refusal when unset (M-11/10 §6, MP-47).
// - The disclosure index enforces the HARD RULE server-side: an omitted row
//   without BOTH reason and explanation is RETURNED flagged incomplete and
//   the endpoint answers 422 naming the disclosure codes (MP-48, A-13).
// - Notification is a RECORD only (A-11, MP-49): stored, rendered, exported.
//   No sending code and no mailer dependency exist anywhere in this path.
// - L1/L2/L3 views share one number source (dashboard math: drafts excluded,
//   N/A excluded, coverage beside every score — A-12).
// - 04 §4: screen, JSON/CSV export, and print all enforce tenant +
//   department + show/hide flags (no privileged leak through export).
// ----------------------------------------------------------------------

/** Tenant scope for report reads/writes. ge_admin may name any tenant. */
function reportTenantScope(
  user: AuthUser,
  explicit: unknown
): { clientId: string } | { error: string; status: number } {
  const named = typeof explicit === 'string' && explicit.trim() ? explicit.trim() : null;
  if (user.role === 'ge_admin') {
    if (named) return { clientId: named };
    if (user.clientId) return { clientId: user.clientId };
    return { error: 'No tenant selected. As a platform admin, choose a tenant (clientId).', status: 400 };
  }
  if (named && named !== user.clientId) {
    return { error: 'Cross-tenant report access is forbidden.', status: 403 };
  }
  if (!user.clientId) {
    return { error: 'No tenant context for this user.', status: 400 };
  }
  return { clientId: user.clientId };
}

/**
 * Service scope for the (client × service) D-038 setting. Explicit serviceId
 * wins (must exist); otherwise a single settings row for the client decides;
 * zero rows → null (the gate will refuse); several rows → 400 (ambiguous).
 */
async function resolveReportService(
  client: DbClient,
  clientId: string,
  explicit: unknown
): Promise<string | null> {
  const named = typeof explicit === 'string' && explicit.trim() ? explicit.trim() : null;
  if (named) {
    const svcRes = await client.query('SELECT id FROM services WHERE id = $1', [named]);
    if (!svcRes.rows[0]) {
      throw Object.assign(new Error('Service not found for the given serviceId.'), { statusCode: 404 });
    }
    return named;
  }
  const rowsRes = await client.query('SELECT service_id FROM report_settings WHERE client_id = $1', [clientId]);
  if (rowsRes.rows.length === 1) {
    return rowsRes.rows[0].service_id ?? null;
  }
  if (rowsRes.rows.length > 1) {
    throw Object.assign(
      new Error('This client has report settings for several services. Pass serviceId explicitly.'),
      { statusCode: 400 }
    );
  }
  return null;
}

async function loadReportSettings(client: DbClient, clientId: string, serviceId: string | null) {
  const res = await client.query(
    `SELECT id, client_id, service_id, disclosure_level, report_level,
            statement_name, statement_period, notified, notified_date, notify_ref,
            notification_recorded, level, created_at, updated_at
       FROM report_settings
      WHERE client_id = $1 AND service_id IS NOT DISTINCT FROM $2`,
    [clientId, serviceId]
  );
  return res.rows[0] ?? null;
}

/** show/hide flags for this client×service (default: everything visible). */
async function loadReportVisibilityFlags(
  client: DbClient,
  clientId: string,
  serviceId: string | null
): Promise<{ showGap: boolean; showCorrective: boolean }> {
  if (!serviceId) return { showGap: true, showCorrective: true };
  const res = await client.query(
    'SELECT show_gap, show_corrective FROM client_services WHERE client_id = $1 AND service_id = $2',
    [clientId, serviceId]
  );
  const row = res.rows[0];
  return {
    showGap: row ? row.show_gap !== false : true,
    showCorrective: row ? row.show_corrective !== false : true,
  };
}

function sendReportGateRefusal(res: Response) {
  return res.status(409).json({ error: REPORT_GATE_REFUSAL, code: REPORT_GATE_CODE });
}

/**
 * Timezone-proof DATE formatting. node-pg returns DATE columns as midnight
 * LOCAL Dates; slicing their UTC ISO string shifts the calendar day on
 * UTC+X hosts. Local getters preserve the true stored calendar date.
 */
function formatDateOnly(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.slice(0, 10) || null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

/** Public settings shape: notified_date always leaves as calendar YYYY-MM-DD. */
function publicReportSettings(row: any) {
  if (!row) return row;
  return { ...row, notified_date: formatDateOnly(row.notified_date) };
}

// B10-A1. Read the D-038 settings for a client×service (all tenant roles).
router.get('/report-settings', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const scope = reportTenantScope(user, req.query.clientId);
    if ('error' in scope) {
      return res.status(scope.status).json({ error: scope.error });
    }
    const data = await withTenantContext(contextFromUser(user), async (client) => {
      const serviceId = await resolveReportService(client, scope.clientId, req.query.serviceId);
      const settings = await loadReportSettings(client, scope.clientId, serviceId);
      const gate = reportGateStatus(settings);
      return {
        clientId: scope.clientId,
        serviceId,
        settings: publicReportSettings(settings),
        gate: gate.ok ? { ok: true } : { ok: false, code: REPORT_GATE_CODE, refusal: REPORT_GATE_REFUSAL },
      };
    });
    res.json(data);
  } catch (err: any) {
    console.error('Report settings fetch error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to fetch report settings' });
  }
});

// B10-A1. Store the D-038 level + statement + notification record for a
// client×service (B16-B2: GE-only; client reads settings, uses reports).
// Missing required fields → 409 with the unified refusal (no default, A-09).
router.put('/report-settings', authMiddleware, requireFreshPassword, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.role !== 'ge_admin') {
      return res.status(403).json({ error: B16_CLIENT_LEVEL_REFUSAL });
    }
    const scope = reportTenantScope(user, req.body?.clientId);
    if ('error' in scope) {
      return res.status(scope.status).json({ error: scope.error });
    }
    const body = req.body ?? {};
    const validation = validateReportSettingsInput(body);
    if (!validation.ok) {
      return res.status(409).json({
        error: REPORT_GATE_REFUSAL,
        code: REPORT_GATE_CODE,
        detail: validation.error,
      });
    }
    if (body.serviceId !== undefined && body.serviceId !== null && body.serviceId !== '') {
      if (typeof body.serviceId !== 'string') {
        return res.status(400).json({ error: 'serviceId must be a string.' });
      }
    }

    const saved = await withTenantContext(contextFromUser(user), async (client) => {
      const tenantRes = await client.query('SELECT id FROM clients WHERE id = $1', [scope.clientId]);
      if (!tenantRes.rows[0]) {
        throw Object.assign(new Error('Target tenant not found for the given clientId.'), { statusCode: 404 });
      }
      const serviceId: string | null =
        typeof body.serviceId === 'string' && body.serviceId.trim() ? body.serviceId.trim() : null;
      if (serviceId) {
        const svcRes = await client.query('SELECT id FROM services WHERE id = $1', [serviceId]);
        if (!svcRes.rows[0]) {
          throw Object.assign(new Error('Service not found for the given serviceId.'), { statusCode: 404 });
        }
      }
      const statementName: string = body.statementName.trim();
      const statementPeriod: string = body.statementPeriod.trim();
      const notified: string | null = isNotifiedState(body.notified) ? body.notified : null;
      const notifiedDate: string | null =
        typeof body.notifiedDate === 'string' && body.notifiedDate.trim()
          ? body.notifiedDate.trim().slice(0, 10)
          : null;
      const notifyRef: string | null =
        typeof body.notifyRef === 'string' && body.notifyRef.trim() ? body.notifyRef.trim() : null;

      const existing = await loadReportSettings(client, scope.clientId, serviceId);
      let row;
      if (existing) {
        const updRes = await client.query(
          `UPDATE report_settings
              SET disclosure_level = $1, report_level = $2,
                  statement_name = $3, statement_period = $4,
                  notified = $5, notified_date = $6, notify_ref = $7,
                  notification_recorded = $8, level = $9,
                  updated_at = NOW()
            WHERE id = $10 RETURNING *`,
          [
            body.disclosureLevel,
            body.reportLevel,
            statementName,
            statementPeriod,
            notified,
            notifiedDate,
            notifyRef,
            notified === 'done',
            body.disclosureLevel === 'in-accordance' ? 'in_accordance' : 'with_reference',
            existing.id,
          ]
        );
        row = updRes.rows[0];
      } else {
        const insRes = await client.query(
          `INSERT INTO report_settings
             (client_id, service_id, disclosure_level, report_level,
              statement_name, statement_period, notified, notified_date, notify_ref,
              notification_recorded, level)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING *`,
          [
            scope.clientId,
            serviceId,
            body.disclosureLevel,
            body.reportLevel,
            statementName,
            statementPeriod,
            notified,
            notifiedDate,
            notifyRef,
            notified === 'done',
            body.disclosureLevel === 'in-accordance' ? 'in_accordance' : 'with_reference',
          ]
        );
        row = insRes.rows[0];
      }

      await recordAuditLog(client, {
        clientId: scope.clientId,
        userId: user.id,
        action: 'REPORT_SETTINGS_SAVED',
        entityType: 'report_settings',
        entityId: row.id,
        payload: {
          targetTenant: scope.clientId,
          serviceId,
          disclosureLevel: body.disclosureLevel,
          reportLevel: body.reportLevel,
          notified,
        },
      });
      return row;
    });

    res.json({ settings: publicReportSettings(saved), gate: { ok: true } });
  } catch (err: any) {
    console.error('Report settings save error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to save report settings' });
  }
});

// Shared report payload builder: gate FIRST, then one number source for
// L1/L2/L3, visibility bounds applied (04 §4), HARD-RULE 422 on violations.
async function buildReportPayload(
  client: DbClient,
  user: AuthUser,
  clientId: string,
  serviceId: string | null,
  level: string
) {
  const settings = await loadReportSettings(client, clientId, serviceId);
  const gate = reportGateStatus(settings);
  if (!gate.ok) {
    throw Object.assign(new Error(REPORT_GATE_REFUSAL), { statusCode: 409, gateCode: REPORT_GATE_CODE });
  }
  const flags = await loadReportVisibilityFlags(client, clientId, serviceId);

  // One query feeds the index, the aggregate, and the per-department
  // breakdown — every level renders the SAME numbers (A-12).
  const srcRes = await client.query(
    `SELECT d.id AS disclosure_id, d.code AS disclosure_code, d.title AS disclosure_title,
            s.code AS standard_code, s.title AS standard_title,
            i.id AS item_id, i.code AS item_code, i.weight::float AS weight,
            dep.id AS department_id, dep.name AS department_name,
            e.score, e.not_evaluated, e.not_applicable, e.na_reason, e.justification,
            ans.value AS answer_value, ans.status AS answer_status
       FROM disclosures d
       JOIN standards s ON s.id = d.standard_id
       JOIN items i ON i.disclosure_id = d.id
       LEFT JOIN assignments a ON a.item_id = i.id AND a.client_id = $1
       LEFT JOIN departments dep ON dep.id = a.department_id
       LEFT JOIN evaluations e ON e.item_id = i.id AND e.client_id = $1
       LEFT JOIN answers ans ON ans.item_id = i.id AND ans.client_id = $1 AND ans.department_id = a.department_id
      ORDER BY s.code ASC, d.code ASC, i.code ASC`,
    [clientId]
  );

  const built = buildDisclosureIndex(
    srcRes.rows.map((r) => ({
      disclosureId: String(r.disclosure_id),
      disclosureCode: r.disclosure_code,
      disclosureTitle: r.disclosure_title,
      standardCode: r.standard_code,
      standardTitle: r.standard_title,
      itemId: String(r.item_id),
      itemCode: r.item_code,
      weight: r.weight === null || r.weight === undefined ? null : Number(r.weight),
      departmentId: r.department_id ? String(r.department_id) : null,
      departmentName: r.department_name ?? null,
      score: r.score === null || r.score === undefined ? null : (Number(r.score) as 0 | 50 | 100),
      notEvaluated: Boolean(r.not_evaluated),
      notApplicable: Boolean(r.not_applicable),
      naReason: r.na_reason ?? null,
      justification: r.justification ?? null,
      answerValue: r.answer_value ?? null,
      answerStatus: r.answer_status ?? null,
    }))
  );

  // HARD RULE (MP-48): omitted without BOTH reason and explanation → 422
  // naming the disclosure codes. Rows are returned flagged, never dropped.
  if (built.offendingCodes.length > 0) {
    throw Object.assign(new Error(indexIncompleteMessage(built.offendingCodes)), {
      statusCode: 422,
      code: 'reports.index_incomplete',
      offendingCodes: built.offendingCodes,
      index: built.rows,
    });
  }

  // Dashboard-traceable aggregate: drafts excluded (only submitted/approved/
  // client-approved answers count), N/A excluded — same rule as /dashboard/stats.
  const SUBMITTED = ['submitted', 'approved', 'client_approved'];
  const byItem = new Map<string, { weight: number; score: 0 | 50 | 100 | null; notEvaluated: boolean; notApplicable: boolean; submitted: boolean }>();
  for (const r of srcRes.rows) {
    const key = String(r.item_id);
    if (!byItem.has(key)) {
      byItem.set(key, {
        weight: Number(r.weight) || 2,
        score: r.score === null || r.score === undefined ? null : (Number(r.score) as 0 | 50 | 100),
        notEvaluated: Boolean(r.not_evaluated),
        notApplicable: Boolean(r.not_applicable),
        submitted: false,
      });
    }
    if (r.answer_status && SUBMITTED.includes(r.answer_status)) {
      byItem.get(key)!.submitted = true;
    }
  }
  const aggregate = calculateAggregateScore(
    gateDraftEvaluations(
      [...byItem.entries()].map(([itemId, v]) => ({
        itemId,
        weight: v.weight,
        score: v.score,
        notEvaluated: v.notEvaluated,
        notApplicable: v.notApplicable,
        hasEvaluation: v.score !== null || v.notEvaluated || v.notApplicable,
        hasSubmittedAnswer: v.submitted,
      }))
    )
  );

  // L2 by-department breakdown (same weighted rule, per department).
  const deptBuckets = new Map<string, { departmentId: string; departmentName: string; weightedSum: number; weightTotal: number; evaluated: number; applicable: number }>();
  for (const r of srcRes.rows) {
    if (!r.department_id) continue;
    const depId = String(r.department_id);
    let b = deptBuckets.get(depId);
    if (!b) {
      b = { departmentId: depId, departmentName: r.department_name, weightedSum: 0, weightTotal: 0, evaluated: 0, applicable: 0 };
      deptBuckets.set(depId, b);
    }
    if (r.not_applicable) continue;
    b.applicable++;
    if (r.not_evaluated || r.score === null || r.score === undefined) continue;
    if (!r.answer_status || !SUBMITTED.includes(r.answer_status)) continue; // drafts excluded
    b.evaluated++;
    const w = Number(r.weight) || 2;
    b.weightedSum += w * Number(r.score);
    b.weightTotal += w;
  }
  const departments = [...deptBuckets.values()]
    .map((b) => ({
      departmentId: b.departmentId,
      departmentName: b.departmentName,
      score: b.weightTotal > 0 ? Math.round((b.weightedSum / b.weightTotal) * 10) / 10 : null,
      coveragePercentage: b.applicable > 0 ? Math.round((b.evaluated / b.applicable) * 1000) / 10 : 0,
      evaluatedItems: b.evaluated,
      applicableItems: b.applicable,
    }))
    .sort((a, b) => a.departmentName.localeCompare(b.departmentName));

  // L2 actions summary (RLS already scopes: employees see own department).
  const actRes = await client.query(
    `SELECT status, COUNT(*)::int AS count FROM actions WHERE client_id = $1 GROUP BY status`,
    [clientId]
  );
  const actionsByStatus: Record<string, number> = {};
  for (const r of actRes.rows) actionsByStatus[r.status] = r.count;

  // Visibility bounds (04 §4): department subset for employees, then
  // show/hide flags. Same function shapes screen, export, and print.
  const visibleIndex = applyDepartmentVisibility(
    built.rows,
    user.role,
    user.departmentId ?? null,
    null
  );
  // Department names for the employee filter: resolve via departmentIds
  // (RLS already removed other departments' assignment rows, so the id
  // filter is exact even without the name).
  const visibleDepartments =
    user.role === 'employee'
      ? departments.filter((d) => (user.departmentId ? d.departmentId === user.departmentId : false))
      : departments;
  const flaggedIndex = applyShowGapFlags(visibleIndex, flags);
  const flaggedDepartments = applyShowGapFlags(visibleDepartments, flags);
  const flaggedAggregate = flags.showGap
    ? aggregate
    : { ...aggregate, aggregateScore: null, fullGapCount: 0, partialGapCount: 0, noGapCount: 0 };

  const omissions = flaggedIndex
    .filter((r) => r.omitted)
    .map((r) => ({
      disclosureCode: r.disclosureCode,
      disclosureTitle: r.disclosureTitle,
      reason: r.omissionReason,
      explanation: r.omissionExplanation,
    }));
  const locationGaps = flaggedIndex.filter((r) => !r.locationComplete).map((r) => r.disclosureCode);
  const topGaps = [...flaggedIndex]
    .filter((r) => !r.omitted && r.score !== null)
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
    .slice(0, 10);

  // B11b (S-09 flags wiring): hidden corrective work is EXCLUDED from
  // reports/exports (empty, not redacted-but-present).
  const visibleActionsByStatus: Record<string, number> = flags.showCorrective ? actionsByStatus : {};
  return {
    clientId,
    serviceId,
    level,
    settings: {
      disclosureLevel: settings.disclosure_level,
      reportLevel: settings.report_level,
      statementName: settings.statement_name,
      statementPeriod: settings.statement_period,
      notified: settings.notified,
      notifiedDate: formatDateOnly(settings.notified_date),
      notifyRef: settings.notify_ref,
    },
    visibility: { role: user.role, showGap: flags.showGap, showCorrective: flags.showCorrective },
    aggregate: flaggedAggregate,
    departments: flaggedDepartments,
    actions: { byStatus: visibleActionsByStatus, showCorrective: flags.showCorrective },
    omissions,
    topGaps,
    index: flaggedIndex,
    meta: {
      disclosureCount: flaggedIndex.length,
      omittedCount: omissions.length,
      locationGaps,
    },
  };
}

// B10-D. Level payload: L1 headline + coverage + top gaps, L2 by
// department/standard + actions + omissions, L3 full index + statement +
// notification — all from ONE builder (same numbers, UI slices per level).
router.get('/reports/index', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const scope = reportTenantScope(user, req.query.clientId);
    if ('error' in scope) {
      return res.status(scope.status).json({ error: scope.error });
    }
    const levelRaw = typeof req.query.level === 'string' ? req.query.level.trim() : '';
    if (!isReportLevel(levelRaw)) {
      return res.status(400).json({ error: 'level is required, one of: L1, L2, L3.' });
    }

    const payload = await withTenantContext(contextFromUser(user), async (client) => {
      if (user.role === 'employee' && !user.departmentId) {
        throw Object.assign(new Error('Your user account has no department assignment.'), { statusCode: 400 });
      }
      const serviceId = await resolveReportService(client, scope.clientId, req.query.serviceId);
      return buildReportPayload(client, user, scope.clientId, serviceId, levelRaw);
    });

    res.json(payload);
  } catch (err: any) {
    console.error('Report index error:', err);
    if (err?.statusCode === 422) {
      return res.status(422).json({
        error: err.message,
        code: 'reports.index_incomplete',
        offendingCodes: err.offendingCodes ?? [],
        index: err.index ?? [],
      });
    }
    if (err?.gateCode === REPORT_GATE_CODE) {
      return sendReportGateRefusal(res);
    }
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to build report index' });
  }
});

// B10-D2. Structured export (JSON default, CSV tabular). Same gate + same
// visibility bounds as the screen — no privileged leak through export.
// Print uses the browser (print-optimized views, bilingual RTL-safe);
// no heavy PDF library is introduced.
router.get('/reports/export', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const scope = reportTenantScope(user, req.query.clientId);
    if ('error' in scope) {
      return res.status(scope.status).json({ error: scope.error });
    }
    const levelRaw = typeof req.query.level === 'string' ? req.query.level.trim() : '';
    if (!isReportLevel(levelRaw)) {
      return res.status(400).json({ error: 'level is required, one of: L1, L2, L3.' });
    }
    const formatRaw = typeof req.query.format === 'string' ? req.query.format.trim().toLowerCase() : 'json';
    if (formatRaw !== 'json' && formatRaw !== 'csv') {
      return res.status(400).json({ error: 'format must be json or csv.' });
    }

    const payload = await withTenantContext(contextFromUser(user), async (client) => {
      if (user.role === 'employee' && !user.departmentId) {
        throw Object.assign(new Error('Your user account has no department assignment.'), { statusCode: 400 });
      }
      const serviceId = await resolveReportService(client, scope.clientId, req.query.serviceId);
      return buildReportPayload(client, user, scope.clientId, serviceId, levelRaw);
    });

    const fileBase = `gri-report-${payload.clientId.slice(0, 8)}-${payload.serviceId ? payload.serviceId.slice(0, 8) : 'default'}-${payload.level}`;
    if (formatRaw === 'csv') {
      const csv = indexToCSV(payload.index);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.csv"`);
      res.send(csv);
      return;
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileBase}.json"`);
    res.json(payload);
  } catch (err: any) {
    console.error('Report export error:', err);
    if (err?.statusCode === 422) {
      return res.status(422).json({
        error: err.message,
        code: 'reports.index_incomplete',
        offendingCodes: err.offendingCodes ?? [],
      });
    }
    if (err?.gateCode === REPORT_GATE_CODE) {
      return sendReportGateRefusal(res);
    }
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to export report' });
  }
});

export default router;
