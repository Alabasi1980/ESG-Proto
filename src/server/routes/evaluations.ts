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
  readContext,
  requireFreshPassword,
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
import { requireDomainAccess } from '../access.ts';
import {
  LINKED_ITEM_SQL,
  SCOPED_ITEM_SQL,
  assertEmployeeEvaluationWritable,
  assertOwnDepartmentRows,
  assertVisibleItem,
  linkedItemsOnly,
  optionalScopeId,
  ownDepartment,
  ownTenant,
  scopeError,
  scopeId,
  scopedAnswers,
  scopedEvaluations,
  snapshotPayloadFullyLinked,
} from '../scope.ts';

const router = express.Router();

/** JSON `code` for the spec §4 `{error, code}` contract: our own scope/auth
 * codes only. A raw PostgreSQL diagnostic code (5 alnum chars, e.g. 42501) is
 * never echoed back — a handler bug must not turn into a DB oracle. */
const errCode = (err: any): string | undefined =>
  typeof err?.code === 'string' && !/^[0-9A-Z]{5}$/.test(err.code) ? err.code : undefined;

/** Spec §4 `{error, code}` treatment for the SIX read catches (§10 ruling 4,
 * Shield-04): an error we raised ourselves (statusCode set, our own scope/auth
 * code) passes through with its message; anything else — a raw PostgreSQL
 * message or SQLSTATE — collapses to the route's generic fallback with NO code
 * echoed, so a handler bug can never become a database oracle. */
function readFailure(res: Response, err: any, fallback: string): void {
  const own = Number.isInteger(err?.statusCode);
  const pgDiagnostic = typeof err?.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code);
  if (own && !pgDiagnostic) {
    res.status(err.statusCode as number).json({
      error: typeof err?.message === 'string' ? err.message : fallback,
      code: errCode(err),
    });
    return;
  }
  res.status(500).json({ error: fallback });
}

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
// department; client_admin/consultant see the tenant queue (optional
// departmentId filter). U2-E E-1 (§3.3 `W:L;C:L;E:L+D#tenant-always-resolved-
// never-nullable`): the tenant always comes from the server-derived access
// context — a supplied clientId is a comparison only — and every row passes
// the scope.ts linked (+ own-department for E) predicate. The forced-change
// gate and suspend wall now come from requireDomainAccess (assertFreshIdentity),
// which is why the legacy b11b users/clients reads are gone from this handler:
// they cannot resolve a platform identity under the bound 'work' purpose.
router.get('/queue', authMiddleware, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const access = req.access!;
    // §9(b): a supplied departmentId is a UUID or a 400 — never a raw 22P02
    // escaping as a 500 from the uuid column comparison below.
    const namedDept = optionalScopeId(req.query.departmentId);
    const tenantId = ownTenant(access, req.query.clientId);

    if (access.mode === 'employee') {
      if (!access.departmentId) {
        return res.status(400).json({ error: 'Your user account has no department assignment.' });
      }
      if (namedDept && namedDept !== access.departmentId) {
        return res.status(403).json({
          error: 'Employees may only access items assigned to their own department.',
          code: 'scope.department_mismatch',
        });
      }
    }
    // §9(c): the E department pin is an EXPLICIT handler-level predicate on the
    // assignment row itself (`a.department_id = own`), asserted again on every
    // returned row — it does not rest on FORCE RLS or on the imported
    // EMPLOYEE_ITEM_SQL string. W/C keep departmentId as a narrowing filter
    // only, never as authorization.
    const ownDept = ownDepartment(access);
    const deptFilter = ownDept ?? namedDept;

    const rows = await withTenantContext(readContext(req), async (client) => {
      // Fixed parameter contract of the scope.ts predicates: $1 trusted tenant,
      // $2 optional linked service (NULL = any linked service), $3 own E
      // department. An unlinked/unassigned row can never enter the set. The
      // parameter list must match the highest $n the chosen predicate uses.
      const params: any[] = ownDept ? [tenantId, null, ownDept] : [tenantId, null];
      let where = ' AND a.client_id = $1';
      if (deptFilter) {
        params.push(deptFilter);
        where += ` AND a.department_id = $${params.length}`;
      }
      const scoped = ownDept ? SCOPED_ITEM_SQL : LINKED_ITEM_SQL;
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
         WHERE ${scoped}${where}
         ORDER BY s.code ASC, d.code ASC, i.code ASC`
        ,
        params
      );
      return result.rows.map((row) => ({ ...row, status: queueStatusFor(row) }));
    });
    // §9(c) defence-in-depth: refuse (never filter) if any E row leaked.
    assertOwnDepartmentRows(access, rows);

    res.json({ items: rows, count: rows.length });
  } catch (err: any) {
    console.error('Queue fetch error:', err);
    readFailure(res, err, 'Failed to fetch evaluation queue');
  }
});

// A2. Create-or-update DRAFT evaluation + answer in one transaction.
// Body: exactly one of {score} XOR {notEvaluated:true} XOR {notApplicable:true, naReason}.
// U2-E E-2 (§3.3 `E:L+D#draft-save-only-no-C-W-P-fresh-evaluation`): the §3
// matrix refuses C/W/P before this handler; the B16 bilingual refusals below
// stay as defence-in-depth. Tenant and department are server-derived
// (scope.ts ownTenant / ownDepartment) and every supplied id is a UUID or a
// 400 before any SQL (§9(b)).
router.post('/evaluations', authMiddleware, requireFreshPassword, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const access = req.access!;
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
    const { score, notEvaluated, notApplicable, naReason, evidenceNote } = body;

    // §9(b): malformed itemId is a 400 scope.id_invalid BEFORE any SQL.
    const itemId = typeof body.itemId === 'string' && body.itemId.trim() ? body.itemId.trim() : null;
    if (!itemId) {
      return res.status(400).json({ error: 'itemId is required.' });
    }
    scopeId(itemId, true);

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

    // §3.3: tenant is always the caller's own (a supplied clientId compares,
    // never selects); the department is always the caller's own for E.
    const clientId = ownTenant(access, body.clientId);
    const ownDept = ownDepartment(access);
    if (!ownDept) {
      return res.status(403).json({ error: 'Your user account has no department assignment.', code: 'scope.department_mismatch' });
    }
    const namedDept = optionalScopeId(body.departmentId);
    if (namedDept && namedDept !== ownDept) {
      return res.status(403).json({
        error: 'Employees may only access items assigned to their own department.',
        code: 'scope.department_mismatch',
      });
    }
    const departmentId = ownDept;
    const note = typeof evidenceNote === 'string' ? evidenceNote : '';

    const result = await withTenantContext(readContext(req), async (client) => {
      const assignRes = await client.query(
        'SELECT id FROM assignments WHERE client_id = $1 AND item_id = $2 AND department_id = $3',
        [clientId, itemId, departmentId]
      );
      if ((assignRes.rowCount ?? 0) === 0) {
        throw Object.assign(new Error('This item is not assigned to the department.'), { statusCode: 403 });
      }
      // G-SHARED fail-closed (U2D round-4 predicate): an ambiguous pair is
      // refused BEFORE the ON CONFLICT upsert can replace another department's
      // evaluator/answer — 409 scope.shared_ambiguous, no rekey.
      await assertEmployeeEvaluationWritable(client, access, itemId);

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

      // Pair write WITHOUT `ON CONFLICT` and WITHOUT `RETURNING`:
      //  - RETURNING is denied because PostgreSQL applies the SELECT policies
      //    to it and a brand-new evaluation has no answer yet, so
      //    b17_content_fact('evaluation', ...) is false (the answer row below
      //    is what makes it provable);
      //  - `ON CONFLICT ... DO UPDATE` on this table evaluates the UPDATE row
      //    policy against the row being written, which has the same problem on
      //    the first save. An explicit UPDATE-then-INSERT keeps both paths on
      //    their own policy: UPDATE only ever touches an EXISTING, provable
      //    pair, INSERT only ever creates one. assertEmployeeEvaluationWritable
      //    above holds the per-pair advisory lock, so the two steps cannot race.
      const updated = await client.query(
        `UPDATE evaluations
            SET evaluator_id = $1, score = $2, not_evaluated = $3, not_applicable = $4,
                na_reason = $5, justification = $6, version = version + 1, updated_at = NOW()
          WHERE client_id = $7 AND item_id = $8`,
        [user.id, finalScore, finalNotEvaluated, finalNotApplicable, finalNaReason, note || null, clientId, itemId]
      );
      if ((updated.rowCount ?? 0) === 0) {
        if (existingEval.rows[0]) {
          // The pair exists but RLS will not admit it to this caller: an
          // ambiguous/foreign-department evaluation. Fail closed, never rekey.
          throw scopeError(409, 'scope.shared_ambiguous');
        }
        await client.query(
          `INSERT INTO evaluations (client_id, item_id, evaluator_id, score, not_evaluated, not_applicable, na_reason, justification)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [clientId, itemId, user.id, finalScore, finalNotEvaluated, finalNotApplicable, finalNaReason, note || null]
        );
      }

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

      // Read the evaluation back NOW that its answer row exists (see above).
      const evalRes = await client.query(
        'SELECT * FROM evaluations WHERE client_id = $1 AND item_id = $2', [clientId, itemId]
      );
      if (!evalRes.rows[0]) {
        throw Object.assign(new Error('Evaluation not found after save.'), { statusCode: 500 });
      }

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
    res.status(mapped.statusCode || 500).json({ error: mapped.message || 'Failed to save evaluation draft', code: errCode(err) });
  }
});

// A3. Submit a draft evaluation. Double submit is refused (409).
//
// MICRO-FIX (OD-08 s3 + WF-02): submitting is a department act. Allowed
// actors = (1) the evaluation's author (evaluator_id), or (2) the designated
// head of the evaluation's department (departments.head_user_id; null head →
// author only). Everyone else — client_admin, ge_admin, non-author employees,
// cross-dept head — gets the bilingual 403 below. The guards after the gate
// (draft-exists 400, double-submit 409, frozen 409, version 409/499) stay
// exactly as-is.
export const SUBMIT_REFUSAL =
  'Only the evaluator or the department head may submit this evaluation. / لا يجوز تقديم هذا التقييم إلا من قِبل المقيّم أو رئيس القسم.';

export interface SubmitActorGateInput {
  callerId: string;
  evaluatorId: string | null;
  headUserId?: string | null;
}

export type SubmitActorGate =
  | { ok: true }
  | { ok: false; status: 403; error: string };

/**
 * Pure submit actor gate (OD-08 s3 + WF-02): the author always passes; any
 * other caller passes ONLY when they are the designated head of the
 * evaluation's department. A null head means author-only.
 */
export function submitActorGate(input: SubmitActorGateInput): SubmitActorGate {
  if (input.callerId === input.evaluatorId) return { ok: true };
  if (input.headUserId && input.callerId === input.headUserId) return { ok: true };
  return { ok: false, status: 403, error: SUBMIT_REFUSAL };
}

router.post('/evaluations/:id/submit', authMiddleware, requireFreshPassword, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    // §9(b): a malformed :id is a 400 scope.id_invalid BEFORE any SQL.
    const evaluationId = scopeId(req.params.id, true)!;

    const result = await withTenantContext(readContext(req), async (client) => {
      const { evaluation, answer } = await loadEvaluationWithAnswer(client, evaluationId);

      if (user.id !== evaluation.evaluator_id) {
        // Non-author: only the designated head of the answer's department may
        // submit. Without a draft there is no department to head — fail closed.
        let headUserId: string | null = null;
        if (answer?.department_id) {
          const headRes = await client.query('SELECT head_user_id FROM departments WHERE id = $1', [
            answer.department_id,
          ]);
          headUserId = headRes.rows[0]?.head_user_id ?? null;
        }
        const gate = submitActorGate({
          callerId: user.id,
          evaluatorId: evaluation.evaluator_id,
          headUserId,
        });
        if (!gate.ok) {
          throw Object.assign(new Error(gate.error), { statusCode: gate.status });
        }
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
      res.status(mappedSubmit.statusCode || 500).json({ error: mappedSubmit.message || 'Failed to submit evaluation', code: errCode(err) });
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
    // §9(b): a malformed :id is a 400 scope.id_invalid BEFORE any SQL.
    const evaluationId = scopeId(req.params.id, true)!;
    const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : '';
    if (decision === 'return' && !comment) {
      return res.status(400).json({ error: 'A return comment is required so the department knows what to rework.' });
    }

    const result = await withTenantContext(readContext(req), async (client) => {
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
      res.status(mappedDecision.statusCode || 500).json({ error: mappedDecision.message || 'Failed to record evaluation decision', code: errCode(err) });
    }
}

router.post('/evaluations/:id/approve', authMiddleware, requireFreshPassword, requireDomainAccess,
  (req: AuthenticatedRequest, res: Response) => handleEvaluationDecision(req, res, 'approve')
);

router.post('/evaluations/:id/return', authMiddleware, requireFreshPassword, requireDomainAccess,
  (req: AuthenticatedRequest, res: Response) => handleEvaluationDecision(req, res, 'return')
);

// A5. Post-submit correction: appended revision only. Requires a reason;
// grows answers.correction_history (trigger-enforced) and stamps
// evaluations.previous_score. Drafts must use POST /api/evaluations.
// U2-E E-2 (§3.3 `W:R+L;E:R+L+D#author-reason-version-prefinal-rules-C-P-denied`):
// the §3 matrix refuses C/P before this handler; W corrects a linked own-tenant
// evaluation, E corrects its own-department authored one.
router.put('/evaluations/:id/correct', authMiddleware, requireFreshPassword, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const access = req.access!;
    // §9(b): a malformed :id is a 400 scope.id_invalid BEFORE any SQL.
    const evaluationId = scopeId(req.params.id, true)!;
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

    const result = await withTenantContext(readContext(req), async (client) => {
      const { evaluation, answer } = await loadEvaluationWithAnswer(client, evaluationId);
      // R + L (W) / R + L + D (E) at the handler boundary as well as under
      // FORCE RLS: an unlinked or foreign-department pair is a generic 404.
      await assertVisibleItem(client, access, evaluation.item_id);

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
    res.status(err.statusCode || 500).json({ error: toFrozenError(err).message || 'Failed to correct evaluation', code: errCode(err) });
  }
});

// A6. Full history for one item: current evaluation + answers in scope +
// related audit_log revision entries (submit / approve / return / correct).
// U2-E E-1 (§3.3 `W:R+L;C:R+L;E:R+L+D#item-history-not-general-audit-or-
// foreign-department`): tenant is server-derived (comparison only), the item
// must pass the scope.ts L (+ D for E) predicate, E receives ONLY its own
// department's answers (G-SHARED), and the history stays entity-scoped to this
// item — it is never the general audit feed.
router.get('/evaluations', authMiddleware, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const access = req.access!;
    const itemId = req.query.itemId;
    if (!itemId || typeof itemId !== 'string') {
      return res.status(400).json({ error: 'itemId query parameter is required.' });
    }
    ownTenant(access, req.query.clientId);
    if (access.mode === 'employee') {
      if (!access.departmentId) {
        return res.status(400).json({ error: 'Your user account has no department assignment.' });
      }
      // §9(b): malformed departmentId is a 400 BEFORE it can be compared.
      const namedDept = optionalScopeId(req.query.departmentId);
      if (namedDept && namedDept !== access.departmentId) {
        return res.status(403).json({
          error: 'Employees may only access items assigned to their own department.',
          code: 'scope.department_mismatch',
        });
      }
    }
    const id = scopeId(itemId, true)!;

    const data = await withTenantContext(readContext(req), async (client) => {
      // L (+ D for E) at the handler boundary as well as under FORCE RLS.
      await assertVisibleItem(client, access, id);
      const itemRes = await client.query(
        `SELECT i.id, i.code, i.requirement, i.priority, i.weight, i.esg_class, i.topic,
                d.code AS disclosure_code, s.code AS standard_code
         FROM items i
         JOIN disclosures d ON d.id = i.disclosure_id
         JOIN standards s ON s.id = d.standard_id
         WHERE i.id = $1`,
        [id]
      );
      if (!itemRes.rows[0]) {
        throw Object.assign(new Error('Item not found.'), { statusCode: 404 });
      }

      const evaluation = (await scopedEvaluations(client, access, id))[0] ?? null;
      const answers = await scopedAnswers(client, access, id);
      // §9(c) MUST-FIX: the E department pin is an explicit handler-level
      // predicate on the rows about to be served (defence-in-depth beside
      // FORCE RLS), plus the G-SHARED provenance check on the evaluation row:
      // a leak is REFUSED, never silently filtered.
      assertOwnDepartmentRows(access, answers);
      // §10 ruling 6 (Shield-02): this second G-SHARED guard is DELIBERATELY
      // fail-closed-empty, not a bug. `evaluation` is only non-null when
      // b17_content_fact('evaluation') held, which requires EXACTLY ONE answer
      // for the item — so a foreign-department answer already forced
      // `evaluation` to null upstream (and the raw detection query is in turn
      // filtered by RLS). It therefore never fires, and it can only ever
      // under-report: it cannot widen a read. A patch DOES exist —
      // b17_content_fact('writable', tenant, item) already runs that foreign-
      // answer NOT-EXISTS check under its own scope.internal switch and is
      // callable from an employee work context (scope.ts) — but routing THIS
      // read through it would change the accepted E-1 semantics from
      // fail-closed-empty to a 403 refusal on shared items, which is a Tera
      // behaviour decision, not a security necessity (Shield U2-E E3-02
      // caveat, folded into U2-F round 1); documented here instead of patched.
      const ownDept = ownDepartment(access);
      if (ownDept && evaluation) {
        const foreign = await client.query(
          'SELECT 1 FROM answers WHERE client_id = $1 AND item_id = $2 AND department_id <> $3 LIMIT 1',
          [access.tenantId, id, ownDept]
        );
        if ((foreign.rowCount ?? 0) > 0) throw scopeError(403, 'scope.shared_ambiguous');
      }

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

      return { item: itemRes.rows[0], evaluation, answers, history };
    });

    res.json(data);
  } catch (err: any) {
    console.error('Evaluation history error:', err);
    readFailure(res, err, 'Failed to fetch evaluation history');
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

// B9-A1. Client approve: client_admin (own tenant) only — the §3 matrix
// (`C:R+L#own-company-all-departments-...-OD-08`) refuses P/W/E before this
// handler, so GE can never early-approve. Allowed ONLY when every
// assignment/department evaluation for the SAME DISCLOSURE is at least
// dept-approved; otherwise 409 naming departments.
router.post('/evaluations/:id/client-approve', authMiddleware, requireFreshPassword, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const access = req.access!;
    // §10 ruling 2 (Shield-06): OD-08 — GE never early-approves. The §3 matrix
    // (`C:R+L`) already refuses P/W before this handler; this is the explicit
    // handler-level twin so the rule does not rest on the dispatcher alone.
    if (user.role !== 'client_admin') {
      return res.status(403).json({ error: 'Only client administrators may client-approve evaluations.' });
    }
    // §9(b): a malformed :id is a 400 scope.id_invalid BEFORE any SQL.
    const evaluationId = scopeId(req.params.id, true)!;

    const result = await withTenantContext(readContext(req), async (client) => {
      const { evaluation, answer } = await loadEvaluationWithAnswer(client, evaluationId);
      // R + L for C: own company and a linked item, asserted at the handler
      // boundary as well as under FORCE RLS.
      await assertVisibleItem(client, access, evaluation.item_id);

      if (evaluation.client_id !== access.tenantId) {
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
    res.status(mapped.statusCode || 500).json({ error: mapped.message || 'Failed to client-approve evaluation', code: errCode(err) });
  }
});

// B9-A2. Client return: client_admin (own tenant) only — the §3 matrix
// (`C:R+L#own-company-...-OD-08`) refuses P/W/E before this handler.
// Comment is required; the item goes back to dept scope with reason preserved.
router.post('/evaluations/:id/client-return', authMiddleware, requireFreshPassword, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const access = req.access!;
    // §10 ruling 2 (Shield-06): OD-08 — GE never early-returns at client scope
    // either. The §3 matrix (`C:R+L`) already refuses P/W before this handler.
    if (user.role !== 'client_admin') {
      return res.status(403).json({ error: 'Only client administrators may return evaluations from client scope.' });
    }
    // §9(b): a malformed :id is a 400 scope.id_invalid BEFORE any SQL.
    const evaluationId = scopeId(req.params.id, true)!;
    const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : '';
    if (!comment) {
      return res.status(400).json({ error: 'A return comment is required so the department knows what to rework.' });
    }

    const result = await withTenantContext(readContext(req), async (client) => {
      const { evaluation, answer } = await loadEvaluationWithAnswer(client, evaluationId);
      // R + L for C: own company and a linked item, asserted at the handler
      // boundary as well as under FORCE RLS.
      await assertVisibleItem(client, access, evaluation.item_id);

      if (evaluation.client_id !== access.tenantId) {
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
    res.status(mapped.statusCode || 500).json({ error: mapped.message || 'Failed to return evaluation from client scope', code: errCode(err) });
  }
});

// B9-A3. Client-review queue: pending client approval grouped by disclosure,
// with a completeness bar per group. U2-E E-1 (§3.3 `W:L;C:L#no-tenant-
// selector-in-view`): own server-derived tenant only — a supplied clientId is
// a comparison (403 on mismatch), never a selector. E/P are refused by the §3
// matrix inside requireDomainAccess, and every row passes the linked predicate.
router.get('/client-review', authMiddleware, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const access = req.access!;
    const tenantId = ownTenant(access, req.query.clientId);

    const groups = await withTenantContext(readContext(req), async (client) => {
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
          WHERE a.client_id = $1 AND ${LINKED_ITEM_SQL}
          ORDER BY s.code ASC, d.code ASC, dep.name ASC`,
        [tenantId, null]
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
    readFailure(res, err, 'Failed to fetch client-review queue');
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
// U2-E E-1 (§3.3 `W:R+L#existing-disclosure-tenant-scope-types`): W only (the
// §3 matrix refuses P/C/E before the handler), the tenant is the server-derived
// own tenant (no tenant selector — a supplied clientId is a comparison only),
// and the disclosure/tenant scope types are kept unchanged. The checklist shows
// LINKED items only; ge-final keeps its own whole-scope §8 preflight, so an
// unmapped item is refused there rather than dropped here.
router.get('/reviews/ge-check', authMiddleware, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const access = req.access!;
    const scopeRaw = req.query.scope;
    if (!isGeFinalScope(scopeRaw)) {
      return res.status(400).json({ error: 'scope must be disclosure or tenant.' });
    }
    const clientId = ownTenant(access, req.query.clientId);
    const scopeRef =
      scopeRaw === 'tenant'
        ? clientId
        : typeof req.query.scopeRef === 'string' && req.query.scopeRef.trim()
          ? req.query.scopeRef.trim()
          : null;
    if (!scopeRef) {
      return res.status(400).json({ error: 'scopeRef (disclosure id) is required for disclosure scope.' });
    }
    // An id is an id: malformed input is a 400 before any SQL, never a 500.
    scopeId(scopeRef, true);

    const data = await withTenantContext(readContext(req), async (client) => {
      const { items: scoped } = await loadGeScopeRows(client, clientId, scopeRaw, scopeRef);
      const items = await linkedItemsOnly(client, access, scoped);
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
    readFailure(res, err, 'Failed to run GE final checklist');
  }
});

// B9-B1. GE final + freeze (W only): requires all in-scope evaluations
// client-approved (or N/A with reason); stamps FinalApproval (approvals
// level='ge') and creates an immutable snapshot row.
// U2-E E-2 (§3.3 `W:R+L#...-freeze-whole-scope-preflight`): the §3 matrix
// refuses P/C/E before this handler, the tenant is the server-derived own
// tenant, and BF-01 holds ONE shared tenant advisory lock across the §8
// count-only preflight + freeze + snapshot so a concurrent POST /gri/commit
// provisioning can never interleave with a freeze.
router.post('/reviews/ge-final', authMiddleware, requireFreshPassword, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const access = req.access!;
    if (user.role !== 'ge_admin') {
      return res.status(403).json({ error: 'Only platform administrators may freeze a GE final review.' });
    }
    const body = req.body ?? {};
    if (!isGeFinalScope(body.scope)) {
      return res.status(400).json({ error: 'scope must be disclosure or tenant.' });
    }
    const scope = body.scope;
    // §3.3: own tenant only — a supplied clientId is a comparison, never a
    // selector (403 scope.tenant_mismatch on a foreign one).
    const clientId = ownTenant(access, body.clientId);
    const scopeRef =
      scope === 'tenant'
        ? clientId
        : typeof body.scopeRef === 'string' && body.scopeRef.trim()
          ? body.scopeRef.trim()
          : null;
    if (!scopeRef) {
      return res.status(400).json({ error: 'scopeRef (disclosure id) is required for disclosure scope.' });
    }
    // §9(b): a malformed scopeRef is a 400 BEFORE any SQL.
    scopeId(scopeRef, true);
    if (typeof body.confirm !== 'boolean' || body.confirm !== true) {
      return res.status(400).json({ error: 'Explicit confirmation is required: pass { confirm: true } to freeze.' });
    }

    // ONE trusted work transaction holds the whole operation (BF-01).
    const result = await withTenantContext(readContext(req), async (client) => {
      // BF-01: the shared tenant lock — byte-identical key to the provisioning
      // section of POST /gri/commit (spec §8 vs concurrent provisioning).
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1717005))',
        [`b17.freeze:${clientId}`]);

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

      // §8 whole-tenant preflight, count-only, INSIDE the BF-01 lock (task §10
      // ruling 1): the count runs through the count-only definer's dedicated
      // `tenant.unmapped_assignments` kind, whose scope.internal branch SEES
      // unmapped/unlinked assignments that the handler's own W RLS hides — the
      // previous inline query was structurally always 0, so 409 scope.unmapped
      // was dead code and a visible-subset freeze could commit. Payload stays
      // the FULL authorized scope: an unmapped row refuses the freeze outright,
      // it is never filtered out of it. linkedItemsOnly (the checklist read)
      // must never narrow this count.
      const unmapped = await client.query(
        "SELECT b17_catalog_child_count('tenant.unmapped_assignments', $1) AS n", [clientId]);
      if ((unmapped.rows[0]?.n ?? 0) > 0) throw scopeError(409, 'scope.unmapped');

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
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to freeze GE final review', code: errCode(err) });
  }
});

// B9-B4. Snapshot list + viewer (frozen numbers + hash + actor + time).
// U2-E E-1 (§3.3 `W#own-tenant-only-safe-metadata-for-inaccessible-mixed-
// snapshots`): own tenant only (comparison-only clientId) and the payload is
// served ONLY when the entire payload item set is linked. A mixed/inaccessible
// snapshot keeps its stored metadata — including the untouched content_hash —
// and simply loses the payload: never a partial payload, never a rewritten hash.
router.get('/reviews/snapshots', authMiddleware, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const access = req.access!;
    const tenantId = ownTenant(access, req.query.clientId);

    const rows = await withTenantContext(readContext(req), async (client) => {
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
      const rows: any[] = [];
      for (const row of result.rows) {
        if (await snapshotPayloadFullyLinked(client, access, row.payload)) {
          rows.push(row);
          continue;
        }
        const metadata = { ...row };
        delete metadata.payload;
        rows.push(metadata);
      }
      return rows;
    });

    res.json({ tenantId, items: rows, count: rows.length });
  } catch (err: any) {
    console.error('Snapshots list error:', err);
    readFailure(res, err, 'Failed to fetch snapshots');
  }
});

// U2-E E-1 (§3.3 `W:R#full-blob-only-if-entire-payload-item-set-L-else-403-
// scope.not_visible`): R is the own-tenant row (FORCE RLS hides a foreign
// snapshot → generic 404) and the full immutable blob is served only when the
// ENTIRE payload item set is linked; otherwise 403 scope.not_visible. No
// partial blob and no hash rewrite, ever.
router.get('/reviews/snapshots/:id', authMiddleware, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const access = req.access!;
    const id = scopeId(req.params.id, true)!;
    const data = await withTenantContext(readContext(req), async (client) => {
      const snapRes = await client.query(
        `SELECT s.id, s.client_id, s.scope_type, s.scope_ref, s.payload, s.content_hash,
                s.created_by, u.name AS created_by_name, s.created_at
          FROM review_snapshots s
          LEFT JOIN users u ON u.id = s.created_by
          WHERE s.id = $1`,
        [id]
      );
      const snapshot = snapRes.rows[0];
      if (!snapshot) {
        throw scopeError(404, 'scope.not_found');
      }
      if (!(await snapshotPayloadFullyLinked(client, access, snapshot.payload))) {
        throw scopeError(403, 'scope.not_visible');
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
    readFailure(res, err, 'Failed to fetch snapshot');
  }
});

// B9-B2. Post-freeze append-only note: the ONLY write allowed on frozen scope.
// U2-E E-2 (§3.3 `W:R#append-only-2000-char-cap-same-full-scope-authorization`):
// W only (matrix), own tenant only (R), append-only, existing 2,000-char cap.
router.post('/reviews/snapshots/:id/notes', authMiddleware, requireFreshPassword, requireDomainAccess, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = req.user!;
    const access = req.access!;
    // §9(b): a malformed :id is a 400 scope.id_invalid BEFORE any SQL.
    const snapshotId = scopeId(req.params.id, true)!;
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    if (!note) {
      return res.status(400).json({ error: 'note is required.' });
    }
    if (note.length > 2000) {
      return res.status(400).json({ error: 'note must be at most 2000 characters.' });
    }

    const created = await withTenantContext(readContext(req), async (client) => {
      const snapRes = await client.query(
        'SELECT id, client_id, payload FROM review_snapshots WHERE id = $1', [snapshotId]);
      const snapshot = snapRes.rows[0];
      if (!snapshot) {
        throw scopeError(404, 'scope.not_found');
      }
      // R (own tenant): FORCE RLS already hides a foreign snapshot above, this
      // comparison is the handler-level twin of it.
      if (snapshot.client_id !== access.tenantId) throw scopeError(403, 'scope.tenant_mismatch');
      // §10 ruling 5 (Shield-05): "same full-scope authorization" as GET /:id —
      // you may not annotate a blob you cannot read. A payload whose item set is
      // not entirely linked is refused outright (append-only + the 2,000-char
      // cap below are unchanged for every snapshot you CAN read).
      if (!(await snapshotPayloadFullyLinked(client, access, snapshot.payload))) {
        throw scopeError(403, 'scope.not_visible');
      }
      const insRes = await client.query(
        `INSERT INTO snapshot_notes (snapshot_id, client_id, note, created_by)
          VALUES ($1, $2, $3, $4) RETURNING *`,
        [snapshot.id, snapshot.client_id, note, access.actorId]
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
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to add snapshot note', code: errCode(err) });
  }
});

export default router;
