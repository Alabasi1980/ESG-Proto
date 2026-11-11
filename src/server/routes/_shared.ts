// B12 (R-01) — shared server helpers for the split sub-routers.
//
// WHY this module: routes.ts (~5550 lines) is split into domain sub-routers
// under src/server/routes/. Everything those routers share lives here so the
// split stays a pure move + wiring (no behavior change):
// - tenant RLS context builders (contextFromUser, readContext, ELEVATED_CONTEXT)
// - B11b scope/gate helpers (b11bRequireGeAdmin, b11bOwnTenantScope,
//   b11bAssertTenantActive, b11bAssertPasswordFresh)
// - F-03 FULL fresh-gate retrofit: assertPasswordFresh (single DB choke point)
//   + requireFreshPassword (Express middleware). EVERY mutating data route
//   carries the middleware; the ONLY exemptions are FRESH_GATE_ALLOWLIST.
// - B9 freeze pre-checks (isFrozenScope, frozenWriteError, toFrozenError) —
//   used by evaluations, storage, initiatives, and admin modules.
// - S-23 fan-out: notifyUsers (+ recipient resolvers) with the 50-row inbox cap.
// - S-24 gate: isAuditReader (ge_admin + named GE delegate via env).
//
// Binding (MEDIUM): never log passwords/tokens/OTPs in this module.

import type { Response, NextFunction } from 'express';
import {
  withTenantContext,
  type TenantContext,
} from '../../db/index.ts';
import type {
  AuthenticatedRequest,
  AuthUser,
} from '../auth.ts';
import {
  passwordChangeRequiredBody,
  PASSWORD_CHANGE_REQUIRED_CODE,
} from '../../lib/b11b.ts';

/** Minimal query surface shared by every helper below. */
export type DbClient = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

// ----------------------------------------------------------------------
// Tenant-context helpers (fix batch 1: every data query runs under an
// explicit RLS context because the app connects as table owner and
// FORCE ROW LEVEL SECURITY is enabled).
// ----------------------------------------------------------------------

/**
 * Elevated service context (ge_admin). Used ONLY for bootstrap/health
 * internals that must see true counts under FORCE RLS:
 * users-count checks, the pre-authentication login lookup, and
 * unauthenticated health counters. It is never used to return tenant rows.
 */
export const ELEVATED_CONTEXT: TenantContext = {
  tenantId: null,
  role: 'ge_admin',
  departmentId: null,
  userId: null,
};

export function contextFromUser(user?: AuthUser | null): TenantContext {
  return {
    tenantId: user?.clientId ?? null,
    role: user?.role ?? '',
    departmentId: user?.departmentId ?? null,
    userId: user?.id ?? null,
  };
}

/** Context for optional-auth reads: caller's context, or an empty one (global rows only). */
export function readContext(req: AuthenticatedRequest): TenantContext {
  return req.user ? contextFromUser(req.user) : { tenantId: null, role: '', departmentId: null, userId: null };
}

// ----------------------------------------------------------------------
// B11b scope/gate helpers (moved verbatim from routes.ts).
// ----------------------------------------------------------------------

export function b11bRequireGeAdmin(user: AuthUser, res: Response): boolean {
  if (user.role !== 'ge_admin') {
    res.status(403).json({ error: 'Only platform administrators may perform this operation.' });
    return false;
  }
  return true;
}

/** Fail-closed forced-change gate (S-12): provisioned accounts change first. */
export async function b11bAssertPasswordFresh(client: DbClient, userId: string): Promise<void> {
  await assertPasswordFresh(client, userId);
}

/** Suspend wall (S-09): non-GE callers in a suspended tenant see no data. */
export async function b11bAssertTenantActive(client: DbClient, clientId: string, role: string): Promise<void> {
  if (role === 'ge_admin') return;
  const r = await client.query('SELECT suspended FROM clients WHERE id = $1', [clientId]);
  if (r.rows[0]?.suspended === true) {
    throw Object.assign(new Error('This tenant is suspended. Contact the platform administrator.'), {
      statusCode: 403,
      code: 'tenant.suspended',
      suspended: true,
    });
  }
}

export function b11bOwnTenantScope(
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
    return { error: 'Cross-tenant access is forbidden.', status: 403 };
  }
  if (!user.clientId) return { error: 'No tenant context for this user.', status: 400 };
  return { clientId: user.clientId };
}

// ----------------------------------------------------------------------
// F-03 FULL fresh-gate retrofit (B12): one shared helper, no route left behind.
//
// assertPasswordFresh is the SINGLE DB choke point. requireFreshPassword is
// its Express middleware form: mount it right after authMiddleware on every
// POST/PUT/PATCH/DELETE data route. Grep proof: every mutating route line
// contains requireFreshPassword except the explicit allowlist below.
// ----------------------------------------------------------------------

/**
 * F-03 allowlist — the ONLY mutating routes exempt from requireFreshPassword:
 * - POST /api/auth/login — issues the token; surfaces mustChangePassword.
 * - POST /api/auth/logout — stateless, needs no user.
 * - POST /api/auth/change-password — THE remediation path itself.
 * - POST /api/setup/admin — once-only bootstrap, no session exists yet.
 * - POST /api/db/migrate — infra DDL, no user session.
 * - POST /api/gri/preview — unauthenticated parse-only preview (the commit
 *   path IS gated). No user exists to check, so gating is impossible.
 * Reads (GET) are never gated. Everything else mutating carries the gate.
 */
export const FRESH_GATE_ALLOWLIST: readonly string[] = [
  'POST /auth/login',
  'POST /auth/logout',
  'POST /auth/change-password',
  'POST /setup/admin',
  'POST /db/migrate',
  'POST /gri/preview',
] as const;

/** Single DB choke point for the forced-change gate (S-12/F-03). */
export async function assertPasswordFresh(db: DbClient, userId: string): Promise<void> {
  const r = await db.query('SELECT must_change_password FROM users WHERE id = $1', [userId]);
  if (r.rows[0]?.must_change_password === true) {
    throw Object.assign(new Error(passwordChangeRequiredBody().error), {
      statusCode: 403,
      code: PASSWORD_CHANGE_REQUIRED_CODE,
    });
  }
}

/**
 * Express middleware form of the fresh gate. authMiddleware MUST run first
 * (req.user is required). Stale-flag callers get 403 + the shared code so
 * the UI can route them to the forced-change screen.
 */
export async function requireFreshPassword(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    await withTenantContext(contextFromUser(user), async (client) => {
      await assertPasswordFresh(client, user.id);
    });
    next();
  } catch (err: any) {
    if (err?.code === PASSWORD_CHANGE_REQUIRED_CODE) {
      res.status(403).json({ error: err.message, code: err.code });
      return;
    }
    res.status(err?.statusCode || 500).json({ error: err?.message || 'Password-freshness check failed' });
  }
}

// ----------------------------------------------------------------------
// B9 freeze pre-checks (moved verbatim from routes.ts; shared by the
// evaluations, storage, initiatives, and admin modules).
// ----------------------------------------------------------------------

export async function isFrozenScope(db: DbClient, clientId: string, itemId?: string | null): Promise<boolean> {
  const res = await db.query('SELECT is_scope_frozen($1, $2) AS frozen', [clientId, itemId ?? null]);
  return res.rows[0]?.frozen === true;
}

export function frozenWriteError(): Error & { statusCode?: number } {
  return Object.assign(
    new Error(
      'This scope is frozen by GE final approval. Editing is disabled; only append-only snapshot notes are allowed.'
    ),
    { statusCode: 409 }
  );
}

export function isFrozenDbError(err: any): boolean {
  return typeof err?.message === 'string' && err.message.includes('FROZEN_SCOPE');
}

export function toFrozenError(err: any): Error & { statusCode?: number } {
  return isFrozenDbError(err) ? frozenWriteError() : err;
}

// ----------------------------------------------------------------------
// S-23 in-app notification fan-out (B12).
//
// Events + recipients (per delegation):
// - evaluation submitted → client_admin(s) of the tenant
// - approved/returned (incl. client scope) → the evaluator
// - item assigned → that department's users
// - action verified/closed/reopened → owner dept users + client_admin(s)
// - staff list approved/rejected → the submitter
// Cap: latest 50 per user (trimmed on every insert). Read state via read_at.
// No e-mail sending exists anywhere on this path (baseline-external).
// ----------------------------------------------------------------------

export const NOTIFICATION_INBOX_LIMIT = 50;

export const NOTIFICATION_TYPES = [
  'evaluation.submitted',
  'evaluation.approved',
  'evaluation.dept_approved',
  'evaluation.returned',
  'evaluation.client_approved',
  'evaluation.client_returned',
  'assignment.created',
  'action.status',
  'staff.approved',
  'staff.rejected',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationInput {
  type: NotificationType;
  title: string;
  titleAr?: string | null;
  body?: string | null;
  bodyAr?: string | null;
  entityType?: string | null;
  entityId?: string | null;
}

/**
 * Inserts one notification row per recipient (deduped) and trims each inbox
 * to the latest NOTIFICATION_INBOX_LIMIT rows. Returns the recipient count.
 */
export async function notifyUsers(
  db: DbClient,
  input: { userIds: string[]; clientId?: string | null } & NotificationInput
): Promise<number> {
  const ids = [...new Set((input.userIds ?? []).filter((v) => typeof v === 'string' && v))];
  if (ids.length === 0) return 0;
  for (const uid of ids) {
    await db.query(
      `INSERT INTO notifications (user_id, client_id, type, title, title_ar, body, body_ar, entity_type, entity_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        uid,
        input.clientId ?? null,
        input.type,
        input.title,
        input.titleAr ?? null,
        input.body ?? null,
        input.bodyAr ?? null,
        input.entityType ?? null,
        input.entityId ?? null,
      ]
    );
    await db.query(
      `DELETE FROM notifications WHERE user_id = $1 AND id NOT IN (
         SELECT id FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT ${NOTIFICATION_INBOX_LIMIT}
       )`,
      [uid]
    );
  }
  return ids.length;
}

/** Active client_admin users of a tenant (evaluation-submitted fan-out). */
export async function activeClientAdminIds(db: DbClient, clientId: string): Promise<string[]> {
  const r = await db.query(
    `SELECT id FROM users WHERE client_id = $1 AND role = 'client_admin' AND is_active = true`,
    [clientId]
  );
  return r.rows.map((row) => String(row.id));
}

/** Active users of one department (assignment + action fan-out). */
export async function activeDepartmentUserIds(
  db: DbClient,
  clientId: string,
  departmentId: string
): Promise<string[]> {
  const r = await db.query(
    `SELECT id FROM users WHERE client_id = $1 AND department_id = $2 AND is_active = true`,
    [clientId, departmentId]
  );
  return r.rows.map((row) => String(row.id));
}

// ----------------------------------------------------------------------
// S-24 audit-read gate (B12): GE ONLY plus a named GE delegate.
//
// The delegate path is env-configured (GE_AUDIT_DELEGATES, comma-separated
// e-mails, fail-closed default empty) so no schema change is needed. A
// delegate reads within their own tenant scope (RLS applies naturally);
// ge_admin reads everything.
// ----------------------------------------------------------------------

export function auditDelegateEmails(): string[] {
  const raw = process.env.GE_AUDIT_DELEGATES ?? '';
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAuditReader(user: AuthUser): boolean {
  if (user.role === 'ge_admin') return true;
  return auditDelegateEmails().includes(user.email.toLowerCase());
}

// ----------------------------------------------------------------------
// B16 (OD-08) CLIENT ROLE REALIGNMENT — bilingual refusal messages +
// department-approval actor gate (pure, unit-testable).
//
// Binding: the blanket approver≠evaluator≠submitter ban now applies ONLY at
// client and GE levels. At department level the head (or sole dept member
// when no head is assigned) MAY approve their own evaluation — the UI must
// label it plainly as preliminary ("dept-approved — pending client
// confirmation", AR+EN). Everywhere else the ban stays strict.
// ----------------------------------------------------------------------

/** B1: client_admin may never file evaluation drafts (employees own-dept only). */
export const B16_CLIENT_CREATE_EVAL_REFUSAL =
  'Only department employees may create evaluation drafts, in their own department. Client administrators confirm at client scope instead — use the client-review queue (client-approve / client-return). / يجوز لموظفي الأقسام فقط إنشاء مسودات التقييم في أقسامهم. يعتمد مدير العميل على نطاق العميل — استخدم قائمة مراجعة العميل (اعتماد العميل / الإعادة).';

/** B1: ge_admin may never file fresh evaluations (GE rates via correction). */
export const B16_GE_CREATE_EVAL_REFUSAL =
  'Platform administrators never file fresh evaluations. GE rates via reasoned correction instead — use PUT /api/evaluations/:id/correct with a reason. / لا ينشئ مديرو المنصة تقييمات جديدة أبداً. يقيّم GE عبر تصحيح مسبب — استخدم PUT /api/evaluations/:id/correct مع ذكر السبب.';

/** A2: client_admin is refused on the dept approve/return route. */
export const B16_DEPT_APPROVAL_CLIENT_REFUSAL =
  'Department approval belongs to the department. Client administrators confirm at client scope instead — use client-approve / client-return. / اعتماد القسم من اختصاص القسم. يعتمد مدير العميل على نطاق العميل — استخدم اعتماد العميل أو الإعادة إلى القسم.';

/** A2: ge_admin is refused on the dept approve/return route. */
export const B16_DEPT_APPROVAL_GE_REFUSAL =
  'GE acts at final approval, not at department scope. Use review actions (snapshot note, reasoned correction, open action) or the GE final freeze. / يتصرف GE في الاعتماد النهائي وليس على نطاق القسم. استخدم إجراءات المراجعة (ملاحظة، تصحيح مسبب، فتح إجراء) أو التجميد النهائي لـ GE.';

/** A2: employees of other departments are refused on the dept route. */
export const B16_CROSS_DEPT_APPROVAL_REFUSAL =
  'Employees may only approve or return evaluations of their own department. / يجوز للموظفين اعتماد تقييمات قسمهم فقط أو إعادتها.';

/** A2: when a head is assigned, ONLY the head may decide for that department. */
export function b16HeadOnlyRefusal(departmentName?: string | null): string {
  const dept = departmentName ? ` (${departmentName})` : '';
  return (
    `This department${dept} has an assigned head: only the head may approve or return its evaluations. / ` +
    `لهذا القسم رئيس معيَّن: يجوز للرئيس فقط اعتماد تقييماته أو إعادتها.`
  );
}

/** B3: client_admin may never correct evaluations (use return instead). */
export const B16_CLIENT_CORRECT_REFUSAL =
  'Client administrators may not correct evaluations directly. Return the evaluation to the department with a reason instead. / لا يجوز لمديري العميل تصحيح التقييمات مباشرة. أعد التقييم إلى القسم مع ذكر السبب بدلاً من ذلك.';

/** B2: GRI import is GE-only. */
export const B16_CLIENT_GRI_REFUSAL =
  'GRI imports are GE-only. Client administrators review imported data in Standards / Gap Analysis instead. / استيراد بيانات GRI من GE فقط. يراجع مديرو العميل البيانات المستوردة في المعايير / تحليل الفجوات.';

/** B2: ESG profile import is GE-only. */
export const B16_CLIENT_ESG_IMPORT_REFUSAL =
  'ESG profile imports are GE-only. Client administrators view the ESG profile read-only instead. / استيراد ملف ESG من GE فقط. يعرض مديرو العميل الملف للقراءة فقط.';

/** B2: report level settings are GE-only. */
export const B16_CLIENT_LEVEL_REFUSAL =
  'Report levels are set by GE only. Client administrators view settings and use reports / export instead. / يحدد GE مستويات التقارير فقط. يعرض مديرو العميل الإعدادات ويستخدمون التقارير / التصدير.';

/** B2: manual assignments are GE-only. */
export const B16_CLIENT_ASSIGN_REFUSAL =
  'Manual assignments are GE-only. Client administrators review the assignment list read-only instead. / الإسناد اليدوي من GE فقط. يراجع مديرو العميل قائمة الإسناد للقراءة فقط.';

/** B2: opening corrective actions is GE-only. */
export const B16_ACTION_OPEN_REFUSAL =
  'Opening corrective actions is GE-only. Departments progress their assigned actions (start work, evidence notes) instead. / فتح الإجراءات التصحيحية من GE فقط. تتابع الأقسام إجراءاتها المسندة (بدء العمل، ملاحظات الأدلة).';

/** B2: verifying / closing / reopening actions is GE-only. */
export const B16_ACTION_CLOSE_REFUSAL =
  'Verifying, closing or reopening corrective actions is GE-only. / التحقق من الإجراءات التصحيحية أو إغلاقها أو إعادة فتحها من GE فقط.';

/** B2: initiative selection is GE-only. */
export const B16_CLIENT_INITIATIVE_REFUSAL =
  'Initiative selection is GE-only. Client administrators browse the library read-only instead. / اختيار المبادرات من GE فقط. يتصفح مديرو العميل المكتبة للقراءة فقط.';

/** B16 (OD-08 s2): the dept-level preliminary label (self-approval exception). */
export const B16_PRELIMINARY_LABEL_EN = 'dept-approved — preliminary, pending client confirmation';
export const B16_PRELIMINARY_LABEL_AR = 'معتمد من القسم — أولي، بانتظار تأكيد العميل';

export interface DeptApprovalActor {
  id: string;
  role: string;
  departmentId?: string | null;
}

export type DeptApprovalGate =
  | { ok: true; selfApproved: boolean }
  | { ok: false; status: 403; error: string };

/**
 * B16-A2 pure actor gate for the repurposed A4 dept approve/return route.
 * - client_admin → 403 (belongs to the department; confirm at client scope).
 * - ge_admin → 403 (GE acts at final approval).
 * - employee of another department → 403 (cross-dept).
 * - head assigned → ONLY the head; otherwise any member of the department.
 * - Self-approval (approver = evaluator/submitter) is ALLOWED here (OD-08 s2
 *   exception) and reported via selfApproved so the UI labels it preliminary.
 */
export function deptApproveActorGate(input: {
  caller: DeptApprovalActor;
  answerDepartmentId: string;
  headUserId?: string | null;
  headDepartmentName?: string | null;
  evaluatorId?: string | null;
  submitterId?: string | null;
}): DeptApprovalGate {
  const { caller, answerDepartmentId, headUserId } = input;
  if (caller.role === 'client_admin') {
    return { ok: false, status: 403, error: B16_DEPT_APPROVAL_CLIENT_REFUSAL };
  }
  if (caller.role === 'ge_admin') {
    return { ok: false, status: 403, error: B16_DEPT_APPROVAL_GE_REFUSAL };
  }
  if (caller.role !== 'employee' || caller.departmentId !== answerDepartmentId) {
    return { ok: false, status: 403, error: B16_CROSS_DEPT_APPROVAL_REFUSAL };
  }
  if (headUserId && caller.id !== headUserId) {
    return { ok: false, status: 403, error: b16HeadOnlyRefusal(input.headDepartmentName) };
  }
  const selfApproved = caller.id === input.evaluatorId || caller.id === input.submitterId;
  return { ok: true, selfApproved };
}
