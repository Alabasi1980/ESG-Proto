// B12 (R-01) — evaluations sub-router: queue, draft/submit/approve/return/
// correct, history, client-review, GE-final freeze, snapshots + notes.
// Mounted by src/server/routes.ts under the /api prefix. Moved verbatim
// except B12 wiring: requireFreshPassword on every mutating route (F-03) and
// S-23 notification fan-out on submit + all four decision endpoints.

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
  clientApproveGate,
  clientApproveRefusalMessage,
  geFinalGate,
  isGeFinalScope,
  checkVersion,
  snapshotContentHash,
} from '../../lib/approvalChain.ts';
import { calculateAggregateScore, gateDraftEvaluations, type DashboardSourceRow } from '../../lib/scoring.ts';
import {
  contextFromUser,
  requireFreshPassword,
  b11bAssertPasswordFresh,
  b11bAssertTenantActive,
  isFrozenScope,
  frozenWriteError,
  toFrozenError,
  notifyUsers,
  activeClientAdminIds,
  deptApproveActorGate,
  B16_CLIENT_CREATE_EVAL_REFUSAL,
  B16_GE_CREATE_EVAL_REFUSAL,
  B16_CLIENT_CORRECT_REFUSAL,
  B16_PRELIMINARY_LABEL_EN,
  B16_PRELIMINARY_LABEL_AR,
  type DbClient,
} from './_shared.ts';

const router = express.Router();

// ----------------------------------------------------------------------
// 6B. Evaluation Workflow (FIX BATCH 3)
//
// One evaluation per (client, item); one answer per (client, item,
// department). Score scale: 0 = full gap, 50 = partial, 100 = no gap
// (higher is better, never inverted). "Not evaluated" rows are excluded
// from averages (never treated as zero); N/A rows are excluded from
// averages and counters and always carry one of four stored reasons.
// Submitted/approved answers are immutable except via appended revision
// (PUT .../correct) — the answers correction-history trigger is the
// backstop. B16 (OD-08): the approver≠evaluator≠submitter ban applies ONLY
// at client and GE levels. At DEPARTMENT level the head (or sole dept
// member when no head is assigned) MAY approve their own evaluation —
// labeled preliminary ("dept-approved — pending client confirmation").
// ----------------------------------------------------------------------

const EVALUATION_SCORES = [0, 50, 100] as const;

const NA_REASONS = [
  'not-applicable',
  'legal-prohibitions',
  'confidentiality-constraints',
  'information-unavailable-incomplete',
] as const;

type QueueStatus = 'not_evaluated' | 'draft' | 'submitted' | 'approved' | 'client_approved' | 'returned' | 'not_applicable';

function queueStatusFor(row: {
  not_applicable?: boolean | null;
  not_evaluated?: boolean | null;
  evaluation_id?: string | null;
  answer_status?: string | null;
}): QueueStatus {
  if (row.not_applicable) return 'not_applicable';
  if (row.not_evaluated || !row.evaluation_id) return 'not_evaluated';
  const s = row.answer_status;
  if (s === 'client_approved') return 'client_approved';
  if (s === 'submitted' || s === 'approved' || s === 'returned') return s;
  return 'draft';
}

/** Tenant scope for evaluation endpoints. ge_admin may name a client explicitly. */
function evalClientScope(user: AuthUser, explicit?: unknown): string | null {
  if (typeof explicit === 'string' && explicit.trim()) {
    if (user.role !== 'ge_admin' && explicit.trim() !== user.clientId) {
      return null; // cross-tenant access — caller rejects with 403
    }
    return explicit.trim();
  }
  return user.clientId ?? null;
}

/**
 * Department scope for evaluation reads/writes. Employees are pinned to
 * their own department: naming any other department is a 403, not a filter.
 */
function evalDepartmentScope(user: AuthUser, explicit?: unknown): { departmentId: string } | { error: string } {
  const named = typeof explicit === 'string' && explicit.trim() ? explicit.trim() : null;
  if (user.role === 'employee') {
    if (!user.departmentId) return { error: 'Your user account has no department assignment.' };
    if (named && named !== user.departmentId) {
      return { error: 'Employees may only access items assigned to their own department.' };
    }
    return { departmentId: user.departmentId };
  }
  if (named) return { departmentId: named };
  if (user.departmentId) return { departmentId: user.departmentId };
  return { error: 'A departmentId is required for this operation.' };
}

/**
 * Loads an evaluation plus its draft answer row. The answer row is the one
 * the evaluator wrote (submitted_by = evaluator_id): drafts are filed under
 * an explicit department, which need not equal the evaluator's own
 * department (tenant admins may draft on a department's behalf).
 */
async function loadEvaluationWithAnswer(
  db: { query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }> },
  evaluationId: string
): Promise<{ evaluation: any; answer: any | null; evaluatorDepartmentId: string | null }> {
  const evalRes = await db.query('SELECT * FROM evaluations WHERE id = $1', [evaluationId]);
  if (!evalRes.rows[0]) {
    throw Object.assign(new Error('Evaluation not found.'), { statusCode: 404 });
  }
  const evaluation = evalRes.rows[0];
  const ansRes = await db.query(
    'SELECT * FROM answers WHERE client_id = $1 AND item_id = $2 AND submitted_by = $3',
    [evaluation.client_id, evaluation.item_id, evaluation.evaluator_id]
  );
  const answer: any | null = ansRes.rows[0] ?? null;
  return { evaluation, answer, evaluatorDepartmentId: answer?.department_id ?? null };
}

// ----------------------------------------------------------------------
// FIX BATCH 9 helpers: optimistic-locking conflict payloads.
//
// Freeze rule (WF-05): any evaluation/answer/correction/profile write touching
// a snapshotted scope is refused with a human 409/403 — EXCEPT append-only
// snapshot notes. The API pre-checks below return the human message; the
// is_scope_frozen triggers in schema.sql are the second line of defence
// (isFrozenScope/frozenWriteError/toFrozenError live in _shared.ts).
// Version rule (A-15): the evaluations+answers pair carries lockstep versions;
// every mutation requires the caller's version and bumps both rows.
// ----------------------------------------------------------------------

/** Best-effort actor names for the mine-vs-theirs conflict payload. */
async function versionedSnapshots(
  db: DbClient,
  evaluation: any | null,
  answer: any | null
): Promise<{ evaluation: any | null; answer: any | null }> {
  let evaluatorName: string | null = null;
  let submitterName: string | null = null;
  try {
    if (evaluation?.evaluator_id) {
      const r = await db.query('SELECT name FROM users WHERE id = $1', [evaluation.evaluator_id]);
      evaluatorName = r.rows[0]?.name ?? null;
    }
    if (answer?.submitted_by) {
      const r = await db.query('SELECT name FROM users WHERE id = $1', [answer.submitted_by]);
      submitterName = r.rows[0]?.name ?? null;
    }
  } catch {
    // Names are best-effort; ids + timestamps are always present.
  }
  return {
    evaluation: evaluation
      ? {
          version: evaluation.version ?? 1,
          score: evaluation.score ?? null,
          notEvaluated: evaluation.not_evaluated ?? null,
          notApplicable: evaluation.not_applicable ?? null,
          naReason: evaluation.na_reason ?? null,
          evidenceNote: evaluation.justification ?? null,
          actorId: evaluation.evaluator_id ?? null,
          actorName: evaluatorName,
          updatedAt: evaluation.updated_at ?? null,
        }
      : null,
    answer: answer
      ? {
          version: answer.version ?? 1,
          status: answer.status ?? null,
          evidenceNote: answer.value ?? null,
          actorId: answer.submitted_by ?? null,
          actorName: submitterName,
          updatedAt: answer.updated_at ?? null,
        }
      : null,
  };
}

/**
 * Enforces the caller's version against the lockstep pair. Returns null when
 * the caller may proceed; otherwise sends the 400/409 response (with BOTH
 * versions' {score, flags, evidence note, actor, time}) and returns the
 * snapshot for logging. Missing version → 400 (reload); mismatch → 409 (diff).
 */
async function enforcePairVersion(
  res: Response,
  db: DbClient,
  evaluation: any | null,
  answer: any | null,
  provided: unknown,
  attempted: Record<string, unknown>
): Promise<{ expectedVersion: number } | null> {
  const expected = evaluation?.version ?? 1;
  const answerVersion = answer?.version ?? 1;
  const snaps = await versionedSnapshots(db, evaluation, answer);
  const outcome = {
    version: expected,
    score: evaluation?.score ?? null,
    notEvaluated: evaluation?.not_evaluated ?? null,
    notApplicable: evaluation?.not_applicable ?? null,
    naReason: evaluation?.na_reason ?? null,
    evidenceNote: evaluation?.justification ?? answer?.value ?? null,
    actorId: evaluation?.evaluator_id ?? null,
    actorName: (snaps.evaluation as any)?.actorName ?? null,
    updatedAt: evaluation?.updated_at ?? null,
  };
  // Lockstep invariant: both rows bump together. A divergence is fail-closed.
  if (expected !== answerVersion) {
    return void res.status(409).json({
      error:
        'This evaluation changed on the server (version drift). Reload the item to see the latest values, then retry.',
      code: 'version.conflict',
      conflict: { expectedVersion: expected, providedVersion: typeof provided === 'number' ? provided : null, ...snaps, attempted },
    }) as unknown as null;
  }
  const check = checkVersion(outcome, provided, attempted);
  if (!check.ok) {
    const status = check.status;
    return void res.status(status).json({
      error:
        status === 409
          ? 'Someone else updated this evaluation while you were editing (version conflict). Compare your values with the current ones below, reload, then retry.'
          : 'A version is required to save (optimistic locking). Reload the item and retry.',
      code: status === 409 ? 'version.conflict' : 'version.required',
      conflict: { expectedVersion: expected, providedVersion: check.conflict.providedVersion, ...snaps, attempted },
    }) as unknown as null;
  }
  return { expectedVersion: expected };
}

/** B12 (S-23): item code for notification bodies (best-effort, never fails the write). */
async function itemCodeFor(db: DbClient, itemId: string): Promise<string> {
  try {
    const r = await db.query('SELECT code FROM items WHERE id = $1', [itemId]);
    return r.rows[0]?.code ?? itemId;
  } catch {
    return itemId;
  }
}

// A1. Department queue: items assigned to the caller's department with
// current evaluation + answer state. Employees are pinned to their own
// department; client_admin sees the tenant queue (optional departmentId
// filter); ge_admin sees all (optional clientId + departmentId filters).
router.get('/queue', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const namedDept = typeof req.query.departmentId === 'string' && req.query.departmentId.trim()
      ? req.query.departmentId.trim()
      : null;
    const namedClient = typeof req.query.clientId === 'string' && req.query.clientId.trim()
      ? req.query.clientId.trim()
      : null;

    if (user.role === 'employee' && !user.departmentId) {
      return res.status(400).json({ error: 'Your user account has no department assignment.' });
    }
    if (user.role === 'employee' && namedDept && namedDept !== user.departmentId) {
      return res.status(403).json({ error: 'Employees may only access items assigned to their own department.' });
    }
    if (user.role === 'client_admin' && namedClient && namedClient !== user.clientId) {
      return res.status(403).json({ error: 'Client administrators may only access their own tenant queue.' });
    }
    if (!user.clientId && user.role !== 'ge_admin') {
      return res.status(400).json({ error: 'No tenant context for this user.' });
    }

    const deptFilter = user.role === 'employee' ? user.departmentId! : namedDept;
    const clientFilter = user.role === 'ge_admin' ? namedClient : null;

    const rows = await withTenantContext(contextFromUser(user), async (client) => {
      // B11b (S-09/S-12): forced-change gate + suspend wall on the queue.
      await b11bAssertPasswordFresh(client, user.id);
      if (user.clientId && user.role !== 'ge_admin') {
        await b11bAssertTenantActive(client, user.clientId, user.role);
      }
      const params: any[] = [];
      let where = '';
      if (deptFilter) {
        params.push(deptFilter);
        where += ` AND a.department_id = $${params.length}`;
      }
      if (clientFilter) {
        params.push(clientFilter);
        where += ` AND a.client_id = $${params.length}`;
      }
      const result = await client.query(
        `SELECT i.id AS item_id, i.code, i.requirement, i.priority, i.weight,
                i.esg_class, i.topic, i.objective,
                d.code AS disclosure_code, d.title AS disclosure_title,
                s.code AS standard_code, s.category AS pillar,
                dep.id AS department_id, dep.code AS department_code, dep.name AS department_name,
                e.id AS evaluation_id, e.score, e.not_evaluated, e.not_applicable, e.na_reason,
                e.justification, e.evaluator_id, e.previous_score, e.version AS evaluation_version,
                e.updated_at AS evaluation_updated_at,
                ans.id AS answer_id, ans.status AS answer_status, ans.submitted_by AS answer_submitted_by,
                ans.version AS answer_version, ans.updated_at AS answer_updated_at
         FROM assignments a
         JOIN items i ON i.id = a.item_id
         JOIN disclosures d ON d.id = i.disclosure_id
         JOIN standards s ON s.id = d.standard_id
         JOIN departments dep ON dep.id = a.department_id
         LEFT JOIN evaluations e ON e.item_id = i.id AND e.client_id = a.client_id
         LEFT JOIN answers ans ON ans.item_id = i.id AND ans.client_id = a.client_id
                              AND ans.department_id = a.department_id
         WHERE 1 = 1${where}
         ORDER BY s.code ASC, d.code ASC, i.code ASC`
        ,
        params
      );
      return result.rows.map((row) => ({ ...row, status: queueStatusFor(row) }));
    });

    res.json({ items: rows, count: rows.length });
  } catch (err: any) {
    console.error('Queue fetch error:', err);
    res
      .status(err.statusCode || 500)
      .json({ error: err.message || 'Failed to fetch evaluation queue', code: err.code, suspended: err.suspended });
  }
});

// A2. Create-or-update DRAFT evaluation + answer in one transaction.
// Body: exactly one of {score} XOR {notEvaluated:true} XOR {notApplicable:true, naReason}.
router.post('/evaluations', authMiddleware, requireFreshPassword, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    // B16-B1: employees own-dept ONLY. client_admin files nothing (confirm at
    // client scope instead); ge_admin never files fresh evaluations (GE rates
    // via reasoned correction, never by fresh evaluation).
    if (user.role === 'client_admin') {
      return res.status(403).json({ error: B16_CLIENT_CREATE_EVAL_REFUSAL });
    }
    if (user.role === 'ge_admin') {
      return res.status(403).json({ error: B16_GE_CREATE_EVAL_REFUSAL });
    }
    const body = req.body ?? {};
    const { itemId, score, notEvaluated, notApplicable, naReason, evidenceNote } = body;

    if (!itemId || typeof itemId !== 'string') {
      return res.status(400).json({ error: 'itemId is required.' });
    }

    const modeCount = [
      score !== undefined && score !== null,
      notEvaluated === true,
      notApplicable === true,
    ].filter(Boolean).length;
    if (modeCount !== 1) {
      return res.status(400).json({
        error: 'Provide exactly one of: a score (0, 50, or 100), notEvaluated: true, or notApplicable: true with an naReason.',
      });
    }

    let finalScore: number | null = null;
    let finalNotEvaluated = false;
    let finalNotApplicable = false;
    let finalNaReason: string | null = null;

    if (score !== undefined && score !== null) {
      if (!(EVALUATION_SCORES as readonly unknown[]).includes(score)) {
        return res.status(400).json({ error: 'Score must be one of 0 (full gap), 50 (partial gap), or 100 (no gap).' });
      }
      finalScore = score;
    } else if (notApplicable === true) {
      finalNotApplicable = true;
      if (typeof naReason !== 'string' || !(NA_REASONS as readonly string[]).includes(naReason)) {
        return res.status(400).json({
          error: `notApplicable requires an naReason, one of: ${NA_REASONS.join(', ')}.`,
        });
      }
      finalNaReason = naReason;
    } else {
      finalNotEvaluated = true;
    }

    const clientId = evalClientScope(user, body.clientId);
    if (!clientId) {
      return res.status(403).json({ error: 'Cross-tenant evaluation writes are forbidden.' });
    }
    const deptScope = evalDepartmentScope(user, body.departmentId);
    if ('error' in deptScope) {
      return res.status(user.role === 'employee' ? 403 : 400).json({ error: deptScope.error });
    }
    const departmentId = deptScope.departmentId;
    const note = typeof evidenceNote === 'string' ? evidenceNote : '';

    const result = await withTenantContext(contextFromUser(user), async (client) => {
      const assignRes = await client.query(
        'SELECT id FROM assignments WHERE client_id = $1 AND item_id = $2 AND department_id = $3',
        [clientId, itemId, departmentId]
      );
      if ((assignRes.rowCount ?? 0) === 0) {
        throw Object.assign(new Error('This item is not assigned to the department.'), { statusCode: 403 });
      }

      // B9-B (WF-05): frozen scope refuses evaluation writes.
      if (await isFrozenScope(client, clientId, itemId)) {
        throw frozenWriteError();
      }

      const existingAnswer = await client.query(
        'SELECT id, status, version FROM answers WHERE client_id = $1 AND item_id = $2 AND department_id = $3',
        [clientId, itemId, departmentId]
      );
      const currentStatus: string | undefined = existingAnswer.rows[0]?.status;
      if (currentStatus === 'submitted' || currentStatus === 'approved' || currentStatus === 'client_approved') {
        throw Object.assign(
          new Error('This evaluation is already submitted. Post-submit changes must go through PUT /api/evaluations/:id/correct with a reason.'),
          { statusCode: 409 }
        );
      }

      // B9-C (A-15): an existing draft requires the caller's version.
      const existingEval = await client.query(
        'SELECT * FROM evaluations WHERE client_id = $1 AND item_id = $2',
        [clientId, itemId]
      );
      if (existingEval.rows[0]) {
        const existingAnsRes = existingAnswer.rows[0]
          ? await client.query('SELECT * FROM answers WHERE id = $1', [existingAnswer.rows[0].id])
          : { rows: [] };
        const gate = await enforcePairVersion(
          res,
          client,
          existingEval.rows[0],
          existingAnsRes.rows[0] ?? null,
          body.version,
          { score, notEvaluated: finalNotEvaluated, notApplicable: finalNotApplicable, evidenceNote: note }
        );
        if (!gate) {
          throw Object.assign(new Error('__VERSION_CONFLICT_RESPONSE_SENT__'), { statusCode: 499 });
        }
      }

      const evalRes = await client.query(
        `INSERT INTO evaluations (client_id, item_id, evaluator_id, score, not_evaluated, not_applicable, na_reason, justification)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (client_id, item_id) DO UPDATE SET
            evaluator_id = EXCLUDED.evaluator_id,
            score = EXCLUDED.score,
            not_evaluated = EXCLUDED.not_evaluated,
            not_applicable = EXCLUDED.not_applicable,
            na_reason = EXCLUDED.na_reason,
            justification = EXCLUDED.justification,
            version = evaluations.version + 1,
            updated_at = NOW()
          RETURNING *`,
        [clientId, itemId, user.id, finalScore, finalNotEvaluated, finalNotApplicable, finalNaReason, note || null]
      );

      // Draft upsert: never resets correction_history on conflict — the
      // trigger guards submitted rows and history only ever grows via A5.
      const ansRes = await client.query(
        `INSERT INTO answers (client_id, item_id, department_id, submitted_by, status, value, correction_history)
          VALUES ($1, $2, $3, $4, 'draft', $5, '[]'::jsonb)
          ON CONFLICT (client_id, item_id, department_id) DO UPDATE SET
            value = EXCLUDED.value,
            status = 'draft',
            submitted_by = EXCLUDED.submitted_by,
            version = answers.version + 1,
            updated_at = NOW()
          RETURNING *`,
        [clientId, itemId, departmentId, user.id, note]
      );

      await recordAuditLog(client, {
        clientId,
        userId: user.id,
        action: 'EVALUATION_DRAFT_SAVED',
        entityType: 'evaluations',
        entityId: evalRes.rows[0].id,
        payload: {
          itemId,
          departmentId,
          score: finalScore,
          notEvaluated: finalNotEvaluated,
          notApplicable: finalNotApplicable,
          naReason: finalNaReason,
        },
      });

      return { evaluation: evalRes.rows[0], answer: ansRes.rows[0] };
    });

    res.status(201).json(result);
  } catch (err: any) {
    // B9-C: the version gate already sent the 400/409 response with the diff.
    if (err?.message === '__VERSION_CONFLICT_RESPONSE_SENT__') return;
    console.error('Evaluation save error:', err);
    const mapped = toFrozenError(err);
    res.status(mapped.statusCode || 500).json({ error: mapped.message || 'Failed to save evaluation draft' });
  }
});

// A3. Submit a draft evaluation. Double submit is refused (409).
router.post('/evaluations/:id/submit', authMiddleware, requireFreshPassword, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const evaluationId = req.params.id;

    const result = await withTenantContext(contextFromUser(user), async (client) => {
      const { evaluation, answer } = await loadEvaluationWithAnswer(client, evaluationId);

      if (user.role === 'employee' && user.id !== evaluation.evaluator_id) {
        throw Object.assign(new Error('Only the evaluator or a tenant administrator may submit this evaluation.'), {
          statusCode: 403,
        });
      }
      if (!answer) {
        throw Object.assign(new Error('No draft answer exists for this evaluation yet. Save a draft first.'), {
          statusCode: 400,
        });
      }
      if (answer.status === 'submitted' || answer.status === 'approved' || answer.status === 'client_approved') {
        throw Object.assign(new Error('This evaluation has already been submitted.'), { statusCode: 409 });
      }

      // B9-B (WF-05): frozen scope refuses evaluation writes.
      if (await isFrozenScope(client, evaluation.client_id, evaluation.item_id)) {
        throw frozenWriteError();
      }

      // B9-C (A-15): submit requires the caller's answer version.
      const gate = await enforcePairVersion(
        res,
        client,
        evaluation,
        answer,
        req.body?.version,
        { action: 'submit' }
      );
      if (!gate) {
        throw Object.assign(new Error('__VERSION_CONFLICT_RESPONSE_SENT__'), { statusCode: 499 });
      }

      const updRes = await client.query(
        `UPDATE answers SET status = 'submitted', version = version + 1, updated_at = NOW()
          WHERE id = $1 AND version = $2 RETURNING *`,
        [answer.id, gate.expectedVersion]
      );
      if ((updRes.rowCount ?? 0) === 0) {
        const fresh = await loadEvaluationWithAnswer(client, evaluationId).catch(() => null);
        const snaps = await versionedSnapshots(client, fresh?.evaluation ?? evaluation, fresh?.answer ?? answer);
        throw Object.assign(
          new Error('Someone else updated this evaluation while you were editing (version conflict). Reload, then retry.'),
          { statusCode: 409, conflictPayload: { code: 'version.conflict', conflict: { ...snaps, attempted: { action: 'submit' } } } }
        );
      }
      // Lockstep bump: the pair versions move together.
      await client.query('UPDATE evaluations SET version = version + 1, updated_at = NOW() WHERE id = $1', [
        evaluation.id,
      ]);

      await recordAuditLog(client, {
        clientId: evaluation.client_id,
        userId: user.id,
        action: 'EVALUATION_SUBMITTED',
        entityType: 'evaluations',
        entityId: evaluation.id,
        payload: { itemId: evaluation.item_id, answerId: answer.id },
      });

      // B12 (S-23): submitted → client_admin(s) of the tenant.
      const code = await itemCodeFor(client, evaluation.item_id);
      const admins = await activeClientAdminIds(client, evaluation.client_id);
      await notifyUsers(client, {
        userIds: admins,
        clientId: evaluation.client_id,
        type: 'evaluation.submitted',
        title: 'Evaluation submitted for review',
        titleAr: 'تم تقديم التقييم للمراجعة',
        body: `Item ${code} was submitted by ${user.name}.`,
        bodyAr: `تم تقديم البند ${code} بواسطة ${user.name}.`,
        entityType: 'evaluations',
        entityId: evaluation.id,
      });

      return { evaluation, answer: updRes.rows[0] };
    });

      res.json(result);
    } catch (err: any) {
      // B9-C: the version gate already sent the 400/409 response with the diff.
      if (err?.message === '__VERSION_CONFLICT_RESPONSE_SENT__') return;
      console.error('Evaluation submit error:', err);
      if (err?.statusCode === 409 && err?.conflictPayload) {
        return res.status(409).json({ error: err.message, ...err.conflictPayload });
      }
      const mappedSubmit = toFrozenError(err);
      res.status(mappedSubmit.statusCode || 500).json({ error: mappedSubmit.message || 'Failed to submit evaluation' });
    }
  });

// A4. DEPT approve / return (B16 repurpose, OD-08): the department step.
// Allowed actor = member of the evaluation's department ONLY; when a head
// is assigned (departments.head_user_id), ONLY the head; employees of other
// departments → 403; client_admin → 403 (belongs to the department —
// confirm at client scope); ge_admin → 403 (GE acts at final approval).
// Requires status submitted, NOT frozen. Stamps level='department', status
// stays 'approved'. OD-08 s2 exception: at dept level the head (or sole dept
// member when no head) MAY approve their own evaluation — flagged
// selfApproved so the UI labels it preliminary ("dept-approved — pending
// client confirmation"). Dept head may also RETURN to draft with reason
// (rework inside the dept). Fan-out: the evaluator + the tenant's
// client_admin(s) ("dept approved, awaiting your confirmation").
async function handleEvaluationDecision(
  req: AuthenticatedRequest,
  res: Response,
  decision: 'approve' | 'return'
) {
  try {
    const user = req.user!;
    const evaluationId = req.params.id;
    const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : '';
    if (decision === 'return' && !comment) {
      return res.status(400).json({ error: 'A return comment is required so the department knows what to rework.' });
    }

    const result = await withTenantContext(contextFromUser(user), async (client) => {
      const { evaluation, answer } = await loadEvaluationWithAnswer(client, evaluationId);

      if (!answer) {
        throw Object.assign(new Error('No draft answer exists for this evaluation yet. Save a draft first.'), {
          statusCode: 400,
        });
      }
      const deptId: string = answer.department_id;

      // B16-A2 actor gate: dept members only (head-only when assigned).
      // client_admin / ge_admin / cross-dept employees are refused here with
      // the bilingual path-pointing messages. No self-ban at this level
      // (OD-08 s2 exception) — selfApproved is reported for the UI label.
      const deptRes = await client.query('SELECT head_user_id, name FROM departments WHERE id = $1', [deptId]);
      const headUserId: string | null = deptRes.rows[0]?.head_user_id ?? null;
      const gate = deptApproveActorGate({
        caller: { id: user.id, role: user.role, departmentId: user.departmentId ?? null },
        answerDepartmentId: deptId,
        headUserId,
        headDepartmentName: deptRes.rows[0]?.name ?? null,
        evaluatorId: evaluation.evaluator_id,
        submitterId: answer.submitted_by,
      });
      if (!gate.ok) {
        throw Object.assign(new Error(gate.error), { statusCode: gate.status });
      }

      if (answer.status !== 'submitted') {
        throw Object.assign(new Error('Only a submitted evaluation can be dept-approved or returned.'), { statusCode: 409 });
      }

      // B9-B (WF-05): frozen scope refuses evaluation writes.
      if (await isFrozenScope(client, evaluation.client_id, evaluation.item_id)) {
        throw frozenWriteError();
      }

      // B9-C (A-15): approve/return requires the caller's answer version.
      const vgate = await enforcePairVersion(
        res,
        client,
        evaluation,
        answer,
        req.body?.version,
        { decision, comment: comment || null }
      );
      if (!vgate) {
        throw Object.assign(new Error('__VERSION_CONFLICT_RESPONSE_SENT__'), { statusCode: 499 });
      }

      const nextStatus = decision === 'approve' ? 'approved' : 'returned';
      const approvalStatus = decision === 'approve' ? 'approved' : 'rejected';

      const updRes = await client.query(
        `UPDATE answers SET status = $1, version = version + 1, updated_at = NOW()
          WHERE id = $2 AND version = $3 RETURNING *`,
        [nextStatus, answer.id, vgate.expectedVersion]
      );
      if ((updRes.rowCount ?? 0) === 0) {
        const fresh = await loadEvaluationWithAnswer(client, evaluationId).catch(() => null);
        const snaps = await versionedSnapshots(client, fresh?.evaluation ?? evaluation, fresh?.answer ?? answer);
        throw Object.assign(
          new Error('Someone else updated this evaluation while you were editing (version conflict). Reload, then retry.'),
          { statusCode: 409, conflictPayload: { code: 'version.conflict', conflict: { ...snaps, attempted: { decision } } } }
        );
      }
      // Lockstep bump: the pair versions move together.
      await client.query('UPDATE evaluations SET version = version + 1, updated_at = NOW() WHERE id = $1', [
        evaluation.id,
      ]);
      const apprRes = await client.query(
        `INSERT INTO approvals (client_id, answer_id, approver_id, level, status, comments)
          VALUES ($1, $2, $3, 'department', $4, $5) RETURNING *`,
        [evaluation.client_id, answer.id, user.id, approvalStatus, comment || null]
      );

      await recordAuditLog(client, {
        clientId: evaluation.client_id,
        userId: user.id,
        action: decision === 'approve' ? 'EVALUATION_APPROVED' : 'EVALUATION_RETURNED',
        entityType: 'evaluations',
        entityId: evaluation.id,
        payload: {
          itemId: evaluation.item_id,
          answerId: answer.id,
          comment: comment || null,
          level: 'department',
          selfApproved: gate.selfApproved,
        },
      });

      // B12 (S-23) + B16-D: approved/returned → the evaluator; dept-approve
      // additionally → the tenant's client_admin(s) ("awaiting confirmation").
      const code = await itemCodeFor(client, evaluation.item_id);
      const selfNote = gate.selfApproved ? ` (${B16_PRELIMINARY_LABEL_EN})` : '';
      await notifyUsers(client, {
        userIds: [evaluation.evaluator_id],
        clientId: evaluation.client_id,
        type: decision === 'approve' ? 'evaluation.approved' : 'evaluation.returned',
        title: decision === 'approve' ? 'Evaluation dept-approved' : 'Evaluation returned for rework',
        titleAr: decision === 'approve' ? 'تم اعتماد التقييم على مستوى القسم' : 'تمت إعادة التقييم للمعالجة داخل القسم',
        body:
          decision === 'approve'
            ? `Item ${code} was dept-approved by ${user.name}.${selfNote}`
            : `Item ${code} was returned by ${user.name}: ${comment}`,
        bodyAr:
          decision === 'approve'
            ? `تم اعتماد البند ${code} على مستوى القسم بواسطة ${user.name}.${gate.selfApproved ? ` (${B16_PRELIMINARY_LABEL_AR})` : ''}`
            : `تمت إعادة البند ${code} بواسطة ${user.name}: ${comment}`,
        entityType: 'evaluations',
        entityId: evaluation.id,
      });
      if (decision === 'approve') {
        const admins = await activeClientAdminIds(client, evaluation.client_id);
        await notifyUsers(client, {
          userIds: admins,
          clientId: evaluation.client_id,
          type: 'evaluation.dept_approved',
          title: 'Department approved an evaluation — awaiting your confirmation',
          titleAr: 'اعتمد القسم تقييماً — بانتظار تأكيدكم',
          body: `Item ${code} was dept-approved by ${user.name} — awaiting your confirmation.${selfNote}`,
          bodyAr: `تم اعتماد البند ${code} على مستوى القسم بواسطة ${user.name} وهو بانتظار تأكيد العميل.${gate.selfApproved ? ` (${B16_PRELIMINARY_LABEL_AR})` : ''}`,
          entityType: 'evaluations',
          entityId: evaluation.id,
        });
      }

      return { evaluation, answer: updRes.rows[0], approval: apprRes.rows[0], selfApproved: gate.selfApproved };
    });

      res.json(result);
    } catch (err: any) {
      // B9-C: the version gate already sent the 400/409 response with the diff.
      if (err?.message === '__VERSION_CONFLICT_RESPONSE_SENT__') return;
      console.error('Evaluation decision error:', err);
      if (err?.statusCode === 409 && err?.conflictPayload) {
        return res.status(409).json({ error: err.message, ...err.conflictPayload });
      }
      const mappedDecision = toFrozenError(err);
      res.status(mappedDecision.statusCode || 500).json({ error: mappedDecision.message || 'Failed to record evaluation decision' });
    }
}

router.post('/evaluations/:id/approve', authMiddleware, requireFreshPassword, (req: AuthenticatedRequest, res: Response) =>
  handleEvaluationDecision(req, res, 'approve')
);

router.post('/evaluations/:id/return', authMiddleware, requireFreshPassword, (req: AuthenticatedRequest, res: Response) =>
  handleEvaluationDecision(req, res, 'return')
);

// A5. Post-submit correction: appended revision only. Requires a reason;
// grows answers.correction_history (trigger-enforced) and stamps
// evaluations.previous_score. Drafts must use POST /api/evaluations.
router.put('/evaluations/:id/correct', authMiddleware, requireFreshPassword, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const evaluationId = req.params.id;
    const body = req.body ?? {};
    const { newScore, notEvaluated, notApplicable, naReason, reason } = body;

    if (typeof reason !== 'string' || !reason.trim()) {
      return res.status(400).json({ error: 'A correction reason is required.' });
    }
    const modeCount = [
      newScore !== undefined && newScore !== null,
      notEvaluated === true,
      notApplicable === true,
    ].filter(Boolean).length;
    if (modeCount !== 1) {
      return res.status(400).json({
        error: 'Provide exactly one corrected outcome: newScore, notEvaluated: true, or notApplicable: true with naReason.',
      });
    }

    let afterScore: number | null = null;
    let afterNotEvaluated = false;
    let afterNotApplicable = false;
    let afterNaReason: string | null = null;
    if (newScore !== undefined && newScore !== null) {
      if (!(EVALUATION_SCORES as readonly unknown[]).includes(newScore)) {
        return res.status(400).json({ error: 'newScore must be one of 0 (full gap), 50 (partial gap), or 100 (no gap).' });
      }
      afterScore = newScore;
    } else if (notApplicable === true) {
      afterNotApplicable = true;
      if (typeof naReason !== 'string' || !(NA_REASONS as readonly string[]).includes(naReason)) {
        return res.status(400).json({
          error: `notApplicable requires an naReason, one of: ${NA_REASONS.join(', ')}.`,
        });
      }
      afterNaReason = naReason;
    } else {
      afterNotEvaluated = true;
    }

    const result = await withTenantContext(contextFromUser(user), async (client) => {
      const { evaluation, answer } = await loadEvaluationWithAnswer(client, evaluationId);

      // B16-B3: author (own, any pre-final state) + ge_admin always, with
      // reason. client_admin → 403 (use return instead).
      if (user.role === 'client_admin') {
        throw Object.assign(new Error(B16_CLIENT_CORRECT_REFUSAL), { statusCode: 403 });
      }
      const isEvaluator = user.id === evaluation.evaluator_id;
      const isGe = user.role === 'ge_admin';
      if (!isEvaluator && !isGe) {
        throw Object.assign(new Error('Only the evaluator or a platform administrator may correct this evaluation.'), {
          statusCode: 403,
        });
      }
      if (!answer || (answer.status !== 'submitted' && answer.status !== 'approved' && answer.status !== 'client_approved')) {
        throw Object.assign(
          new Error('Only a submitted or approved evaluation can be corrected. Edit the draft instead.'),
          { statusCode: 409 }
        );
      }

      // B9-B (WF-05): frozen scope refuses corrections (use snapshot notes).
      if (await isFrozenScope(client, evaluation.client_id, evaluation.item_id)) {
        throw frozenWriteError();
      }

      // B9-C (A-15): correction requires the caller's version.
      const gate = await enforcePairVersion(
        res,
        client,
        evaluation,
        answer,
        body.version,
        { newScore, notEvaluated, notApplicable, naReason, reason: reason.trim() }
      );
      if (!gate) {
        throw Object.assign(new Error('__VERSION_CONFLICT_RESPONSE_SENT__'), { statusCode: 499 });
      }

      const before = {
        score: evaluation.score,
        notEvaluated: evaluation.not_evaluated,
        notApplicable: evaluation.not_applicable,
        naReason: evaluation.na_reason,
      };
      const after = {
        score: afterScore,
        notEvaluated: afterNotEvaluated,
        notApplicable: afterNotApplicable,
        naReason: afterNaReason,
      };

      const evalRes = await client.query(
        `UPDATE evaluations
          SET score = $1, not_evaluated = $2, not_applicable = $3, na_reason = $4,
              previous_score = score, version = version + 1, updated_at = NOW()
          WHERE id = $5 AND version = $6 RETURNING *`,
        [afterScore, afterNotEvaluated, afterNotApplicable, afterNaReason, evaluation.id, gate.expectedVersion]
      );
      if ((evalRes.rowCount ?? 0) === 0) {
        const fresh = await loadEvaluationWithAnswer(client, evaluationId).catch(() => null);
        const snaps = await versionedSnapshots(client, fresh?.evaluation ?? evaluation, fresh?.answer ?? answer);
        throw Object.assign(
          new Error('Someone else updated this evaluation while you were editing (version conflict). Reload, then retry.'),
          { statusCode: 409, conflictPayload: { code: 'version.conflict', conflict: { ...snaps, attempted: { action: 'correct' } } } }
        );
      }

      const historyEntry = [{ before, after, actor: user.id, reason: reason.trim(), at: new Date().toISOString() }];
      const ansRes = await client.query(
        `UPDATE answers
          SET correction_history = COALESCE(correction_history, '[]'::jsonb) || $1::jsonb,
              version = version + 1, updated_at = NOW()
          WHERE id = $2 RETURNING *`,
        [JSON.stringify(historyEntry), answer.id]
      );

      await recordAuditLog(client, {
        clientId: evaluation.client_id,
        userId: user.id,
        action: 'EVALUATION_CORRECTED',
        entityType: 'evaluations',
        entityId: evaluation.id,
        payload: { itemId: evaluation.item_id, answerId: answer.id, before, after, actor: user.id, reason: reason.trim() },
      });

      return { evaluation: evalRes.rows[0], answer: ansRes.rows[0], before, after };
    });

    res.json(result);
  } catch (err: any) {
    // B9-C: the version gate already sent the 400/409 response with the diff.
    if (err?.message === '__VERSION_CONFLICT_RESPONSE_SENT__') return;
    console.error('Evaluation correction error:', err);
    if (err?.statusCode === 409 && err?.conflictPayload) {
      return res.status(409).json({ error: err.message, ...err.conflictPayload });
    }
    res.status(err.statusCode || 500).json({ error: toFrozenError(err).message || 'Failed to correct evaluation' });
  }
});

// A6. Full history for one item: current evaluation + answers in scope +
// related audit_log revision entries (submit / approve / return / correct).
router.get('/evaluations', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const itemId = req.query.itemId;
    if (!itemId || typeof itemId !== 'string') {
      return res.status(400).json({ error: 'itemId query parameter is required.' });
    }

    const clientId = evalClientScope(user, req.query.clientId);
    if (!clientId && user.role !== 'ge_admin') {
      return res.status(400).json({ error: 'No tenant context for this user.' });
    }
    if (user.role === 'employee') {
      if (!user.departmentId) {
        return res.status(400).json({ error: 'Your user account has no department assignment.' });
      }
      const namedDept = typeof req.query.departmentId === 'string' && req.query.departmentId.trim()
        ? req.query.departmentId.trim()
        : null;
      if (namedDept && namedDept !== user.departmentId) {
        return res.status(403).json({ error: 'Employees may only access items assigned to their own department.' });
      }
    }

    const data = await withTenantContext(contextFromUser(user), async (client) => {
      const itemRes = await client.query(
        `SELECT i.id, i.code, i.requirement, i.priority, i.weight, i.esg_class, i.topic,
                d.code AS disclosure_code, s.code AS standard_code
         FROM items i
         JOIN disclosures d ON d.id = i.disclosure_id
         JOIN standards s ON s.id = d.standard_id
         WHERE i.id = $1`,
        [itemId]
      );
      if (!itemRes.rows[0]) {
        throw Object.assign(new Error('Item not found.'), { statusCode: 404 });
      }

      if (user.role === 'employee') {
        const assignRes = await client.query(
          'SELECT id FROM assignments WHERE client_id = $1 AND item_id = $2 AND department_id = $3',
          [clientId, itemId, user.departmentId]
        );
        if ((assignRes.rowCount ?? 0) === 0) {
          throw Object.assign(new Error('This item is not assigned to your department.'), { statusCode: 403 });
        }
      }

      const evalQuery = clientId
        ? client.query('SELECT * FROM evaluations WHERE client_id = $1 AND item_id = $2', [clientId, itemId])
        : client.query('SELECT * FROM evaluations WHERE item_id = $1', [itemId]);
      const evalRes = await evalQuery;
      const evaluation = evalRes.rows[0] ?? null;

      const ansQuery = clientId
        ? client.query('SELECT * FROM answers WHERE client_id = $1 AND item_id = $2 ORDER BY updated_at ASC', [clientId, itemId])
        : client.query('SELECT * FROM answers WHERE item_id = $1 ORDER BY updated_at ASC', [itemId]);
      const ansRes = await ansQuery;

      let history: any[] = [];
      if (evaluation) {
        const histRes = await client.query(
          `SELECT al.id, al.action, al.entity_type, al.entity_id, al.user_id,
                  u.name AS actor_name, al.payload, al.created_at
           FROM audit_log al
           LEFT JOIN users u ON u.id = al.user_id
           WHERE al.entity_type = 'evaluations' AND al.entity_id = $1
           ORDER BY al.created_at ASC`,
          [evaluation.id]
        );
        history = histRes.rows;
      }

      return { item: itemRes.rows[0], evaluation, answers: ansRes.rows, history };
    });

    res.json(data);
  } catch (err: any) {
    console.error('Evaluation history error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to fetch evaluation history' });
  }
});

// ----------------------------------------------------------------------
// 6C. Client approval + GE final freeze + attachments (FIX BATCH 9)
//
// WF-02 chain: draft → submitted → dept-approved ('approved') →
// client-approved ('client_approved') → ready-for-review (GE FinalApproval +
// immutable snapshot freezes the tenant copy, WF-03/WF-05). Client approval
// is disclosure-scoped: every department assignment under the same disclosure
// must be at least dept-approved (or N/A with reason) or the 409 names the
// incomplete ones.
// ----------------------------------------------------------------------

// B9-A1. Client approve: client_admin (own tenant) or ge_admin (any tenant).
// Allowed ONLY when every assignment/department evaluation for the SAME
// DISCLOSURE is at least dept-approved; otherwise 409 naming departments.
router.post('/evaluations/:id/client-approve', authMiddleware, requireFreshPassword, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.role !== 'client_admin' && user.role !== 'ge_admin') {
      return res.status(403).json({ error: 'Only tenant or platform administrators may client-approve evaluations.' });
    }
    const evaluationId = req.params.id;

    const result = await withTenantContext(contextFromUser(user), async (client) => {
      const { evaluation, answer } = await loadEvaluationWithAnswer(client, evaluationId);

      if (user.role === 'client_admin' && evaluation.client_id !== user.clientId) {
        throw Object.assign(new Error('Client administrators may only client-approve their own tenant.'), {
          statusCode: 403,
        });
      }
      if (user.id === evaluation.evaluator_id || (answer && user.id === answer.submitted_by)) {
        throw Object.assign(new Error('Self-approval is forbidden: the approver must differ from the evaluator and the submitter.'), {
          statusCode: 403,
        });
      }
      if (!answer || answer.status !== 'approved') {
        throw Object.assign(
          new Error('Only a dept-approved evaluation can be client-approved. It must be approved at department scope first.'),
          { statusCode: 409 }
        );
      }

      // B9-B (WF-05): frozen scope refuses evaluation writes.
      if (await isFrozenScope(client, evaluation.client_id, evaluation.item_id)) {
        throw frozenWriteError();
      }

      // B9-C (A-15): client approval requires the caller's version.
      const gate = await enforcePairVersion(
        res,
        client,
        evaluation,
        answer,
        req.body?.version,
        { action: 'client-approve' }
      );
      if (!gate) {
        throw Object.assign(new Error('__VERSION_CONFLICT_RESPONSE_SENT__'), { statusCode: 499 });
      }

      // Disclosure scope: every department assignment under the same disclosure.
      const itemRes = await client.query('SELECT disclosure_id FROM items WHERE id = $1', [evaluation.item_id]);
      const disclosureId = itemRes.rows[0]?.disclosure_id;
      if (!disclosureId) {
        throw Object.assign(new Error('Item disclosure not found.'), { statusCode: 404 });
      }
      const scopeRes = await client.query(
        `SELECT dep.id AS department_id, dep.name AS department_name,
                ans.status AS answer_status, e.not_applicable AS not_applicable
          FROM assignments a
          JOIN departments dep ON dep.id = a.department_id
          JOIN items i ON i.id = a.item_id
          LEFT JOIN answers ans ON ans.client_id = a.client_id AND ans.item_id = a.item_id AND ans.department_id = a.department_id
          LEFT JOIN evaluations e ON e.client_id = a.client_id AND e.item_id = a.item_id
          WHERE a.client_id = $1 AND i.disclosure_id = $2`,
        [evaluation.client_id, disclosureId]
      );
      const decision = clientApproveGate(
        scopeRes.rows.map((r) => ({
          departmentId: r.department_id,
          departmentName: r.department_name,
          answerStatus: r.answer_status,
          notApplicable: r.not_applicable === true,
        }))
      );
      if (!decision.ok) {
        throw Object.assign(new Error(clientApproveRefusalMessage(decision.incomplete)), { statusCode: 409 });
      }

      const updRes = await client.query(
        `UPDATE answers SET status = 'client_approved', version = version + 1, updated_at = NOW()
          WHERE id = $1 AND version = $2 RETURNING *`,
        [answer.id, gate.expectedVersion]
      );
      if ((updRes.rowCount ?? 0) === 0) {
        const fresh = await loadEvaluationWithAnswer(client, evaluationId).catch(() => null);
        const snaps = await versionedSnapshots(client, fresh?.evaluation ?? evaluation, fresh?.answer ?? answer);
        throw Object.assign(
          new Error('Someone else updated this evaluation while you were editing (version conflict). Reload, then retry.'),
          { statusCode: 409, conflictPayload: { code: 'version.conflict', conflict: { ...snaps, attempted: { action: 'client-approve' } } } }
        );
      }
      await client.query('UPDATE evaluations SET version = version + 1, updated_at = NOW() WHERE id = $1', [
        evaluation.id,
      ]);

      const apprRes = await client.query(
        `INSERT INTO approvals (client_id, answer_id, approver_id, level, status, comments)
          VALUES ($1, $2, $3, 'client', 'approved', $4) RETURNING *`,
        [evaluation.client_id, answer.id, user.id, typeof req.body?.comment === 'string' ? req.body.comment.trim() || null : null]
      );

      await recordAuditLog(client, {
        clientId: evaluation.client_id,
        userId: user.id,
        action: 'EVALUATION_CLIENT_APPROVED',
        entityType: 'evaluations',
        entityId: evaluation.id,
        payload: { itemId: evaluation.item_id, answerId: answer.id, disclosureId },
      });

      // B12 (S-23): client-approved → the evaluator.
      const code = await itemCodeFor(client, evaluation.item_id);
      await notifyUsers(client, {
        userIds: [evaluation.evaluator_id],
        clientId: evaluation.client_id,
        type: 'evaluation.client_approved',
        title: 'Evaluation client-approved',
        titleAr: 'تم الاعتماد النهائي للتقييم على مستوى العميل',
        body: `Item ${code} was client-approved by ${user.name}.`,
        bodyAr: `تم اعتماد البند ${code} على مستوى العميل بواسطة ${user.name}.`,
        entityType: 'evaluations',
        entityId: evaluation.id,
      });

      return { evaluation, answer: updRes.rows[0], approval: apprRes.rows[0] };
    });

    res.json(result);
  } catch (err: any) {
    if (err?.message === '__VERSION_CONFLICT_RESPONSE_SENT__') return;
    console.error('Client approval error:', err);
    if (err?.statusCode === 409 && err?.conflictPayload) {
      return res.status(409).json({ error: err.message, ...err.conflictPayload });
    }
    const mapped = toFrozenError(err);
    res.status(mapped.statusCode || 500).json({ error: mapped.message || 'Failed to client-approve evaluation' });
  }
});

// B9-A2. Client return: client_admin (own tenant) or ge_admin (any tenant).
// Comment is required; the item goes back to dept scope with reason preserved.
router.post('/evaluations/:id/client-return', authMiddleware, requireFreshPassword, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.role !== 'client_admin' && user.role !== 'ge_admin') {
      return res.status(403).json({ error: 'Only tenant or platform administrators may return evaluations from client scope.' });
    }
    const evaluationId = req.params.id;
    const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : '';
    if (!comment) {
      return res.status(400).json({ error: 'A return comment is required so the department knows what to rework.' });
    }

    const result = await withTenantContext(contextFromUser(user), async (client) => {
      const { evaluation, answer } = await loadEvaluationWithAnswer(client, evaluationId);

      if (user.role === 'client_admin' && evaluation.client_id !== user.clientId) {
        throw Object.assign(new Error('Client administrators may only return evaluations in their own tenant.'), {
          statusCode: 403,
        });
      }
      if (user.id === evaluation.evaluator_id || (answer && user.id === answer.submitted_by)) {
        throw Object.assign(new Error('Self-approval is forbidden: the approver must differ from the evaluator and the submitter.'), {
          statusCode: 403,
        });
      }
      if (!answer || (answer.status !== 'approved' && answer.status !== 'client_approved')) {
        throw Object.assign(
          new Error('Only a dept-approved or client-approved evaluation can be returned from client scope.'),
          { statusCode: 409 }
        );
      }

      if (await isFrozenScope(client, evaluation.client_id, evaluation.item_id)) {
        throw frozenWriteError();
      }

      const gate = await enforcePairVersion(
        res,
        client,
        evaluation,
        answer,
        req.body?.version,
        { action: 'client-return', comment }
      );
      if (!gate) {
        throw Object.assign(new Error('__VERSION_CONFLICT_RESPONSE_SENT__'), { statusCode: 499 });
      }

      const updRes = await client.query(
        `UPDATE answers SET status = 'returned', version = version + 1, updated_at = NOW()
          WHERE id = $1 AND version = $2 RETURNING *`,
        [answer.id, gate.expectedVersion]
      );
      if ((updRes.rowCount ?? 0) === 0) {
        const fresh = await loadEvaluationWithAnswer(client, evaluationId).catch(() => null);
        const snaps = await versionedSnapshots(client, fresh?.evaluation ?? evaluation, fresh?.answer ?? answer);
        throw Object.assign(
          new Error('Someone else updated this evaluation while you were editing (version conflict). Reload, then retry.'),
          { statusCode: 409, conflictPayload: { code: 'version.conflict', conflict: { ...snaps, attempted: { action: 'client-return' } } } }
        );
      }
      await client.query('UPDATE evaluations SET version = version + 1, updated_at = NOW() WHERE id = $1', [
        evaluation.id,
      ]);

      const apprRes = await client.query(
        `INSERT INTO approvals (client_id, answer_id, approver_id, level, status, comments)
          VALUES ($1, $2, $3, 'client', 'rejected', $4) RETURNING *`,
        [evaluation.client_id, answer.id, user.id, comment]
      );

      await recordAuditLog(client, {
        clientId: evaluation.client_id,
        userId: user.id,
        action: 'EVALUATION_CLIENT_RETURNED',
        entityType: 'evaluations',
        entityId: evaluation.id,
        payload: { itemId: evaluation.item_id, answerId: answer.id, comment },
      });

      // B12 (S-23): client-returned → the evaluator.
      const code = await itemCodeFor(client, evaluation.item_id);
      await notifyUsers(client, {
        userIds: [evaluation.evaluator_id],
        clientId: evaluation.client_id,
        type: 'evaluation.client_returned',
        title: 'Evaluation returned from client scope',
        titleAr: 'تمت إعادة التقييم من نطاق العميل',
        body: `Item ${code} was returned by ${user.name}: ${comment}`,
        bodyAr: `تمت إعادة البند ${code} بواسطة ${user.name}: ${comment}`,
        entityType: 'evaluations',
        entityId: evaluation.id,
      });

      return { evaluation, answer: updRes.rows[0], approval: apprRes.rows[0] };
    });

    res.json(result);
  } catch (err: any) {
    if (err?.message === '__VERSION_CONFLICT_RESPONSE_SENT__') return;
    console.error('Client return error:', err);
    if (err?.statusCode === 409 && err?.conflictPayload) {
      return res.status(409).json({ error: err.message, ...err.conflictPayload });
    }
    const mapped = toFrozenError(err);
    res.status(mapped.statusCode || 500).json({ error: mapped.message || 'Failed to return evaluation from client scope' });
  }
});

// B9-A3. Client-review queue: pending client approval grouped by disclosure,
// with a completeness bar per group. client_admin sees own tenant; ge_admin
// may name any tenant explicitly.
router.get('/client-review', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.role !== 'client_admin' && user.role !== 'ge_admin') {
      return res.status(403).json({ error: 'Only tenant or platform administrators may view the client-review queue.' });
    }
    const namedClient = typeof req.query.clientId === 'string' && req.query.clientId.trim() ? req.query.clientId.trim() : null;
    if (user.role === 'client_admin' && namedClient && namedClient !== user.clientId) {
      return res.status(403).json({ error: 'Client administrators may only access their own tenant queue.' });
    }
    const tenantId = user.role === 'ge_admin' ? namedClient ?? user.clientId ?? null : user.clientId ?? null;
    if (!tenantId) {
      return res.status(400).json({ error: 'No tenant selected. As a platform admin, choose a tenant (clientId).' });
    }

    const groups = await withTenantContext(contextFromUser(user), async (client) => {
      const rowsRes = await client.query(
        `SELECT d.id AS disclosure_id, d.code AS disclosure_code, d.title AS disclosure_title,
                s.code AS standard_code,
                dep.id AS department_id, dep.name AS department_name,
                ans.id AS answer_id, ans.status AS answer_status, ans.version AS answer_version,
                e.id AS evaluation_id, e.version AS evaluation_version,
                e.score, e.not_evaluated, e.not_applicable, e.na_reason
          FROM assignments a
          JOIN items i ON i.id = a.item_id
          JOIN disclosures d ON d.id = i.disclosure_id
          JOIN standards s ON s.id = d.standard_id
          JOIN departments dep ON dep.id = a.department_id
          LEFT JOIN answers ans ON ans.client_id = a.client_id AND ans.item_id = a.item_id AND ans.department_id = a.department_id
          LEFT JOIN evaluations e ON e.client_id = a.client_id AND e.item_id = a.item_id
          WHERE a.client_id = $1
          ORDER BY s.code ASC, d.code ASC, dep.name ASC`,
        [tenantId]
      );
      const byDisclosure = new Map<string, any>();
      for (const r of rowsRes.rows) {
        let g = byDisclosure.get(r.disclosure_id);
        if (!g) {
          g = {
            disclosureId: r.disclosure_id,
            disclosureCode: r.disclosure_code,
            disclosureTitle: r.disclosure_title,
            standardCode: r.standard_code,
            departments: [],
          };
          byDisclosure.set(r.disclosure_id, g);
        }
        g.departments.push({
          departmentId: r.department_id,
          departmentName: r.department_name,
          answerId: r.answer_id,
          answerStatus: r.answer_status,
          answerVersion: r.answer_version,
          evaluationId: r.evaluation_id,
          evaluationVersion: r.evaluation_version,
          score: r.score,
          notEvaluated: r.not_evaluated,
          notApplicable: r.not_applicable,
          naReason: r.na_reason,
        });
      }
      return [...byDisclosure.values()].map((g) => {
        const total = g.departments.length;
        const approved = g.departments.filter((x: any) => x.answerStatus === 'approved' || x.answerStatus === 'client_approved').length;
        const clientApproved = g.departments.filter((x: any) => x.answerStatus === 'client_approved').length;
        const na = g.departments.filter((x: any) => x.notApplicable === true).length;
        const gate = clientApproveGate(
          g.departments.map((x: any) => ({
            departmentId: x.departmentId,
            departmentName: x.departmentName,
            answerStatus: x.answerStatus,
            notApplicable: x.notApplicable === true,
          }))
        );
        return {
          ...g,
          total,
          approved,
          clientApproved,
          notApplicable: na,
          completeness: total === 0 ? 0 : Math.round(((approved + na) / total) * 100),
          readyForClient: gate.ok && g.departments.some((x: any) => x.answerStatus === 'approved'),
          fullyClientApproved: total > 0 && g.departments.every((x: any) => x.answerStatus === 'client_approved' || x.notApplicable === true),
          incompleteDepartments: gate.ok ? [] : (gate as { ok: false; incomplete: string[] }).incomplete,
        };
      });
    });

    res.json({ tenantId, groups, count: groups.length });
  } catch (err: any) {
    console.error('Client-review queue error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to fetch client-review queue' });
  }
});

// ----------------------------------------------------------------------
// 6D. GE final + freeze (MP-45, S-18/M-10, WF-03/WF-05)
// ----------------------------------------------------------------------

/** Shared scope-row loader for ge-check and ge-final. */
async function loadGeScopeRows(
  client: DbClient,
  tenantId: string,
  scope: 'disclosure' | 'tenant',
  scopeRef: string
): Promise<{ items: any[]; disclosureCode?: string }> {
  const params: any[] = [tenantId];
  let disclosureFilter = '';
  if (scope === 'disclosure') {
    params.push(scopeRef);
    disclosureFilter = 'AND i.disclosure_id = $2';
  }
  const rowsRes = await client.query(
    `SELECT i.id AS item_id, i.code AS item_code, i.weight::float AS weight,
            i.disclosure_id, d.code AS disclosure_code, d.title AS disclosure_title,
            ans.id AS answer_id, ans.status AS answer_status,
            e.id AS evaluation_id, e.score, e.not_evaluated, e.not_applicable, e.na_reason,
            e.justification, e.evaluator_id, e.updated_at AS evaluation_updated_at
      FROM assignments a
      JOIN items i ON i.id = a.item_id
      JOIN disclosures d ON d.id = i.disclosure_id
      LEFT JOIN answers ans ON ans.client_id = a.client_id AND ans.item_id = a.item_id AND ans.department_id = a.department_id
      LEFT JOIN evaluations e ON e.client_id = a.client_id AND e.item_id = a.item_id
      WHERE a.client_id = $1 ${disclosureFilter}
      ORDER BY d.code ASC, i.code ASC`,
    params
  );
  // One row per (item, department): collapse to one row per item, keeping the
  // weakest client-approval state across departments.
  const byItem = new Map<string, any>();
  for (const r of rowsRes.rows) {
    let entry = byItem.get(r.item_id);
    if (!entry) {
      entry = {
        itemId: r.item_id,
        code: r.item_code,
        weight: r.weight,
        disclosureId: r.disclosure_id,
        disclosureCode: r.disclosure_code,
        disclosureTitle: r.disclosure_title,
        statuses: [] as string[],
        evaluation: null as any,
      };
      byItem.set(r.item_id, entry);
    }
    entry.statuses.push(r.answer_status);
    if (!entry.evaluation && r.evaluation_id) {
      entry.evaluation = {
        id: r.evaluation_id,
        score: r.score,
        notEvaluated: r.not_evaluated,
        notApplicable: r.not_applicable,
        naReason: r.na_reason,
        justification: r.justification,
      };
    }
  }
  const items = [...byItem.values()].map((entry) => {
    const statuses: (string | null)[] = entry.statuses;
    const notApplicable = entry.evaluation?.notApplicable === true;
    // Item counts as client-approved only when EVERY department answer is.
    const allClientApproved = statuses.length > 0 && statuses.every((s) => s === 'client_approved');
    return {
      itemId: entry.itemId,
      code: entry.code,
      weight: entry.weight,
      disclosureCode: entry.disclosureCode,
      answerStatus: allClientApproved ? 'client_approved' : statuses.includes('client_approved') ? 'mixed' : statuses.find((s) => s) ?? null,
      notApplicable,
      naReason: entry.evaluation?.naReason ?? null,
      score: entry.evaluation?.score ?? null,
      notEvaluated: entry.evaluation?.notEvaluated ?? null,
      evaluation: entry.evaluation,
    };
  });
  return { items };
}

// B9-B4. GE final-review completeness checklist (read-only).
router.get('/reviews/ge-check', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.role !== 'ge_admin') {
      return res.status(403).json({ error: 'Only platform administrators may run the GE final review.' });
    }
    const scopeRaw = req.query.scope;
    if (!isGeFinalScope(scopeRaw)) {
      return res.status(400).json({ error: 'scope must be disclosure or tenant.' });
    }
    const clientId = typeof req.query.clientId === 'string' && req.query.clientId.trim() ? req.query.clientId.trim() : null;
    if (!clientId) {
      return res.status(400).json({ error: 'No tenant selected. Choose a tenant (clientId) to review.' });
    }
    const scopeRef =
      scopeRaw === 'tenant'
        ? clientId
        : typeof req.query.scopeRef === 'string' && req.query.scopeRef.trim()
          ? req.query.scopeRef.trim()
          : null;
    if (!scopeRef) {
      return res.status(400).json({ error: 'scopeRef (disclosure id) is required for disclosure scope.' });
    }

    const data = await withTenantContext(contextFromUser(user), async (client) => {
      const { items } = await loadGeScopeRows(client, clientId, scopeRaw, scopeRef);
      const gate = geFinalGate(
        items.map((it) => ({
          itemId: it.itemId,
          code: it.code,
          answerStatus: it.answerStatus,
          notApplicable: it.notApplicable,
          naReason: it.naReason,
        }))
      );
      const snapRes = await client.query(
        'SELECT id, scope_type, scope_ref, created_at FROM review_snapshots WHERE client_id = $1 AND scope_type = $2 AND scope_ref = $3',
        [clientId, scopeRaw, scopeRef]
      );
      return {
        clientId,
        scope: scopeRaw,
        scopeRef,
        items,
        total: items.length,
        gate,
        alreadyFrozen: (snapRes.rowCount ?? 0) > 0,
        snapshot: snapRes.rows[0] ?? null,
      };
    });

    res.json(data);
  } catch (err: any) {
    console.error('GE check error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to run GE final checklist' });
  }
});

// B9-B1. GE final + freeze (ge_admin only): requires all in-scope evaluations
// client-approved (or N/A with reason); stamps FinalApproval (approvals
// level='ge') and creates an immutable snapshot row.
router.post('/reviews/ge-final', authMiddleware, requireFreshPassword, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    if (user.role !== 'ge_admin') {
      return res.status(403).json({ error: 'Only platform administrators may freeze a GE final review.' });
    }
    const body = req.body ?? {};
    if (!isGeFinalScope(body.scope)) {
      return res.status(400).json({ error: 'scope must be disclosure or tenant.' });
    }
    const scope = body.scope;
    const clientId = typeof body.clientId === 'string' && body.clientId.trim() ? body.clientId.trim() : null;
    if (!clientId) {
      return res.status(400).json({ error: 'No tenant selected. Choose a tenant (clientId) to freeze.' });
    }
    const scopeRef =
      scope === 'tenant'
        ? clientId
        : typeof body.scopeRef === 'string' && body.scopeRef.trim()
          ? body.scopeRef.trim()
          : null;
    if (!scopeRef) {
      return res.status(400).json({ error: 'scopeRef (disclosure id) is required for disclosure scope.' });
    }
    if (typeof body.confirm !== 'boolean' || body.confirm !== true) {
      return res.status(400).json({ error: 'Explicit confirmation is required: pass { confirm: true } to freeze.' });
    }

    const result = await withTenantContext(contextFromUser(user), async (client) => {
      const tenantRes = await client.query('SELECT id FROM clients WHERE id = $1', [clientId]);
      if (!tenantRes.rows[0]) {
        throw Object.assign(new Error('Target tenant not found for the given clientId.'), { statusCode: 404 });
      }

      const existing = await client.query(
        'SELECT id FROM review_snapshots WHERE client_id = $1 AND scope_type = $2 AND scope_ref = $3',
        [clientId, scope, scopeRef]
      );
      if ((existing.rowCount ?? 0) > 0) {
        throw Object.assign(new Error('This scope is already frozen (a snapshot exists). Post-freeze notes are append-only.'), {
          statusCode: 409,
        });
      }

      const { items } = await loadGeScopeRows(client, clientId, scope, scopeRef);
      if (items.length === 0) {
        throw Object.assign(new Error('Nothing to freeze: this scope has no assigned items.'), { statusCode: 400 });
      }
      const gate = geFinalGate(
        items.map((it) => ({
          itemId: it.itemId,
          code: it.code,
          answerStatus: it.answerStatus,
          notApplicable: it.notApplicable,
          naReason: it.naReason,
        }))
      );
      if (!gate.ok) {
        throw Object.assign(
          new Error(
            `GE final approval is blocked: ${gate.incomplete.length} item(s) are not client-approved yet: ` +
              gate.incomplete.join(', ') +
              `. Every in-scope item must be client-approved (or N/A with a reason) first.`
          ),
          { statusCode: 409 }
        );
      }

      // B16 (OD-08): the ban stays strict at GE level — the freezer must
      // differ from every in-scope evaluator (self-freeze is refused).
      const actorRes = await client.query(
        'SELECT DISTINCT evaluator_id FROM evaluations WHERE client_id = $1 AND item_id = ANY($2)',
        [clientId, items.map((it) => it.itemId)]
      );
      if (actorRes.rows.some((r) => r.evaluator_id === user.id)) {
        throw Object.assign(
          new Error(
            'Self-approval is forbidden: the GE final approver must differ from the evaluator. Ask another platform administrator to freeze this scope.'
          ),
          { statusCode: 403 }
        );
      }

      // Aggregate over the frozen numbers (same weighted rule as the dashboard).
      const scoreRows = items.map((it) => ({
        itemId: it.itemId,
        weight: it.weight || 2,
        score: it.score as 0 | 50 | 100 | null,
        notEvaluated: Boolean(it.notEvaluated),
        notApplicable: Boolean(it.notApplicable),
        justification: it.evaluation?.justification,
        hasEvaluation: it.evaluation !== null,
        hasSubmittedAnswer: true,
      }));
      const aggregate = calculateAggregateScore(gateDraftEvaluations(scoreRows));

      // Stamp FinalApproval (approvals level='ge') on every client-approved answer.
      const finalApprovals: any[] = [];
      for (const it of items) {
        if (it.notApplicable) continue;
        const ansRes = await client.query(
          `SELECT id FROM answers
            WHERE client_id = $1 AND item_id = $2 AND status = 'client_approved'`,
          [clientId, it.itemId]
        );
        for (const a of ansRes.rows) {
          const apprRes = await client.query(
            `INSERT INTO approvals (client_id, answer_id, approver_id, level, status, comments)
              VALUES ($1, $2, $3, 'ge', 'approved', 'GE FinalApproval (freeze)') RETURNING *`,
            [clientId, a.id, user.id]
          );
          finalApprovals.push(apprRes.rows[0]);
        }
      }

      const now = new Date().toISOString();
      const payload = {
        scope,
        scopeRef,
        clientId,
        frozenBy: user.id,
        frozenAt: now,
        items: items.map((it) => ({
          itemId: it.itemId,
          code: it.code,
          score: it.score,
          notEvaluated: it.notEvaluated,
          notApplicable: it.notApplicable,
          naReason: it.naReason,
          weight: it.weight,
        })),
        aggregate: aggregate.aggregateScore,
        coveragePercentage: aggregate.coveragePercentage,
        counts: {
          total: aggregate.totalCount,
          evaluated: aggregate.evaluatedCount,
          applicable: aggregate.applicableCount,
          notApplicable: aggregate.notApplicableCount,
          notEvaluated: aggregate.notEvaluatedCount,
          fullGap: aggregate.fullGapCount,
          partialGap: aggregate.partialGapCount,
          noGap: aggregate.noGapCount,
        },
      };
      const contentHash = snapshotContentHash(payload);
      const snapRes = await client.query(
        `INSERT INTO review_snapshots (client_id, scope_type, scope_ref, payload, content_hash, created_by)
          VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [clientId, scope, scopeRef, JSON.stringify(payload), contentHash, user.id]
      );

      await recordAuditLog(client, {
        clientId,
        userId: user.id,
        action: 'GE_FINAL_FROZEN',
        entityType: 'review_snapshots',
        entityId: snapRes.rows[0].id,
        payload: { scope, scopeRef, contentHash, aggregate: aggregate.aggregateScore, coverage: aggregate.coveragePercentage },
      });

      return { snapshot: snapRes.rows[0], aggregate, finalApprovals: finalApprovals.length };
    });

    res.status(201).json(result);
  } catch (err: any) {
    console.error('GE final error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to freeze GE final review' });
  }
});

// B9-B4. Snapshot list + viewer (frozen numbers + hash + actor + time).
router.get('/reviews/snapshots', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const namedClient = typeof req.query.clientId === 'string' && req.query.clientId.trim() ? req.query.clientId.trim() : null;
    if (user.role !== 'ge_admin' && namedClient && namedClient !== user.clientId) {
      return res.status(403).json({ error: 'Cross-tenant snapshot access is forbidden.' });
    }
    const tenantId = user.role === 'ge_admin' ? namedClient ?? user.clientId ?? null : user.clientId ?? null;
    if (!tenantId && user.role === 'ge_admin') {
      return res.status(400).json({ error: 'No tenant selected. As a platform admin, choose a tenant (clientId).' });
    }
    if (!tenantId) {
      return res.status(400).json({ error: 'No tenant context for this user.' });
    }

    const rows = await withTenantContext(contextFromUser(user), async (client) => {
      const result = await client.query(
        `SELECT s.id, s.client_id, s.scope_type, s.scope_ref, s.payload, s.content_hash,
                s.created_by, u.name AS created_by_name, s.created_at,
                (SELECT COUNT(*)::int FROM snapshot_notes n WHERE n.snapshot_id = s.id) AS notes_count
          FROM review_snapshots s
          LEFT JOIN users u ON u.id = s.created_by
          WHERE s.client_id = $1
          ORDER BY s.created_at DESC`,
        [tenantId]
      );
      return result.rows;
    });

    res.json({ tenantId, items: rows, count: rows.length });
  } catch (err: any) {
    console.error('Snapshots list error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to fetch snapshots' });
  }
});

router.get('/reviews/snapshots/:id', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const data = await withTenantContext(contextFromUser(user), async (client) => {
      const snapRes = await client.query(
        `SELECT s.id, s.client_id, s.scope_type, s.scope_ref, s.payload, s.content_hash,
                s.created_by, u.name AS created_by_name, s.created_at
          FROM review_snapshots s
          LEFT JOIN users u ON u.id = s.created_by
          WHERE s.id = $1`,
        [req.params.id]
      );
      const snapshot = snapRes.rows[0];
      if (!snapshot) {
        throw Object.assign(new Error('Snapshot not found.'), { statusCode: 404 });
      }
      if (user.role !== 'ge_admin' && snapshot.client_id !== user.clientId) {
        throw Object.assign(new Error('Cross-tenant snapshot access is forbidden.'), { statusCode: 403 });
      }
      const notesRes = await client.query(
        `SELECT n.id, n.note, n.created_by, u.name AS created_by_name, n.created_at
          FROM snapshot_notes n
          LEFT JOIN users u ON u.id = n.created_by
          WHERE n.snapshot_id = $1
          ORDER BY n.created_at ASC`,
        [snapshot.id]
      );
      return { snapshot, notes: notesRes.rows };
    });

    res.json(data);
  } catch (err: any) {
    console.error('Snapshot view error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to fetch snapshot' });
  }
});

// B9-B2. Post-freeze append-only note: the ONLY write allowed on frozen scope.
router.post('/reviews/snapshots/:id/notes', authMiddleware, requireFreshPassword, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    if (!note) {
      return res.status(400).json({ error: 'note is required.' });
    }
    if (note.length > 2000) {
      return res.status(400).json({ error: 'note must be at most 2000 characters.' });
    }

    const created = await withTenantContext(contextFromUser(user), async (client) => {
      const snapRes = await client.query('SELECT id, client_id FROM review_snapshots WHERE id = $1', [req.params.id]);
      const snapshot = snapRes.rows[0];
      if (!snapshot) {
        throw Object.assign(new Error('Snapshot not found.'), { statusCode: 404 });
      }
      if (user.role !== 'ge_admin' && snapshot.client_id !== user.clientId) {
        throw Object.assign(new Error('Cross-tenant snapshot access is forbidden.'), { statusCode: 403 });
      }
      const insRes = await client.query(
        `INSERT INTO snapshot_notes (snapshot_id, client_id, note, created_by)
          VALUES ($1, $2, $3, $4) RETURNING *`,
        [snapshot.id, snapshot.client_id, note, user.id]
      );

      await recordAuditLog(client, {
        clientId: snapshot.client_id,
        userId: user.id,
        action: 'SNAPSHOT_NOTE_ADDED',
        entityType: 'review_snapshots',
        entityId: snapshot.id,
        payload: { noteLength: note.length },
      });

      return insRes.rows[0];
    });

    res.status(201).json(created);
  } catch (err: any) {
    console.error('Snapshot note error:', err);
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to add snapshot note' });
  }
});

export default router;
