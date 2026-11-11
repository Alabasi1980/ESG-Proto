/**
 * Pure report-gate / disclosure-index / visibility decisions for
 * FIX-BATCH-10 (MP-47/48/49/50, A-09..A-13, M-11/10 §6, OD-05, 04 §4).
 *
 * These helpers encode the branching rules WITHOUT touching the database, so
 * they are unit-testable (`reports.test.ts`). Routes call them first, then
 * perform the DB existence/RLS checks inside the tenant context.
 *
 * Binding summary (requirements, not suggestions):
 * - M-11/10 §6: disclosure index per disclosure (standard/disclosure code +
 *   title, location, omission + reason + explanation together). NO row without
 *   a reason. Statement of use (name + period). Notification record
 *   (done / not-done + date + reference — recorded, never sent). Export
 *   BLOCKED before the D-038 level is chosen for that client×service, with a
 *   unified refusal message.
 * - A-09: report level mandatory per (client × service), no default.
 *   A-10: statement of use valid per level (name + period).
 *   A-11: notification recorded (done/not-done/date/ref).
 *   A-12: review coverage beside every score.
 *   A-13: omission reason + explanation travel together in every omitted row.
 * - OD-05: three report levels L1 Executive / L2 Management / L3 Detailed.
 * - 04 §4: every output (screen, export, print) enforces the same visibility
 *   bounds (tenant + department + show/hide flags) — no privileged leak.
 */

// ---------------------------------------------------------------------------
// A. D-038 gate vocabulary (OD-05 levels, A-09 disclosure levels)
// ---------------------------------------------------------------------------

export const DISCLOSURE_LEVELS = ['in-accordance', 'with-reference'] as const;
export type DisclosureLevel = (typeof DISCLOSURE_LEVELS)[number];

export const REPORT_LEVELS = ['L1', 'L2', 'L3'] as const;
export type ReportLevel = (typeof REPORT_LEVELS)[number];

export const NOTIFIED_STATES = ['done', 'not-done'] as const;
export type NotifiedState = (typeof NOTIFIED_STATES)[number];

/** BR-03 omission reasons (same domain as evaluations.na_reason). */
export const OMISSION_REASONS = [
  'not-applicable',
  'legal-prohibitions',
  'confidentiality-constraints',
  'information-unavailable-incomplete',
] as const;
export type OmissionReason = (typeof OMISSION_REASONS)[number];

export function isDisclosureLevel(value: unknown): value is DisclosureLevel {
  return typeof value === 'string' && (DISCLOSURE_LEVELS as readonly string[]).includes(value);
}

export function isReportLevel(value: unknown): value is ReportLevel {
  return typeof value === 'string' && (REPORT_LEVELS as readonly string[]).includes(value);
}

export function isNotifiedState(value: unknown): value is NotifiedState {
  return typeof value === 'string' && (NOTIFIED_STATES as readonly string[]).includes(value);
}

export function isOmissionReason(value: unknown): value is OmissionReason {
  return typeof value === 'string' && (OMISSION_REASONS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// B. Unified bilingual refusal message (M-11/10 §6, MP-47).
// ---------------------------------------------------------------------------

/**
 * THE unified refusal message. Every report/export endpoint returns exactly
 * this string (plus a stable `code`) when the D-038 level is unset for the
 * requested client×service. Bilingual (EN + AR) and RTL-safe by construction
 * (plain text, no markup). Reversible labels live in i18n, not here.
 */
export const REPORT_GATE_REFUSAL =
  'Report export is blocked: no disclosure level and report level (D-038) have been set for this client and service. Set them in Report Settings first. | ' +
  'تم حظر التصدير: لم يتم تحديد مستوى الإفصاح ومستوى التقرير (D-038) لهذا العميل وهذه الخدمة. حددهما أولاً في إعدادات التقارير.';

export const REPORT_GATE_CODE = 'reports.gate_unset';

// ---------------------------------------------------------------------------
// C. Report-settings validation (A-09/A-10/A-11, MP-47).
// ---------------------------------------------------------------------------

export interface ReportSettingsInput {
  disclosureLevel?: unknown;
  reportLevel?: unknown;
  statementName?: unknown;
  statementPeriod?: unknown;
  notified?: unknown;
  notifiedDate?: unknown;
  notifyRef?: unknown;
}

export interface ReportSettingsRecord {
  id?: string;
  client_id?: string | null;
  service_id?: string | null;
  disclosure_level?: string | null;
  report_level?: string | null;
  statement_name?: string | null;
  statement_period?: string | null;
  notified?: string | null;
  notified_date?: string | null;
  notify_ref?: string | null;
}

export type SettingsValidation =
  | { ok: true }
  | { ok: false; error: string };

/**
 * PUT validation: export requires disclosureLevel + reportLevel +
 * statementName + statementPeriod (else 409 with the unified refusal).
 * notified fields are optional but stored when given (A-11).
 */
export function validateReportSettingsInput(body: ReportSettingsInput): SettingsValidation {
  if (!isDisclosureLevel(body.disclosureLevel)) {
    return {
      ok: false,
      error: `disclosureLevel is required, one of: ${DISCLOSURE_LEVELS.join(', ')}.`,
    };
  }
  if (!isReportLevel(body.reportLevel)) {
    return {
      ok: false,
      error: `reportLevel is required, one of: ${REPORT_LEVELS.join(', ')}.`,
    };
  }
  if (typeof body.statementName !== 'string' || !body.statementName.trim()) {
    return { ok: false, error: 'statementName (statement of use: organization name) is required.' };
  }
  if (typeof body.statementPeriod !== 'string' || !body.statementPeriod.trim()) {
    return { ok: false, error: 'statementPeriod (statement of use: reporting period) is required.' };
  }
  if (body.notified !== undefined && body.notified !== null && body.notified !== '') {
    if (!isNotifiedState(body.notified)) {
      return {
        ok: false,
        error: `notified must be one of: ${NOTIFIED_STATES.join(', ')}.`,
      };
    }
  }
  if (body.notifiedDate !== undefined && body.notifiedDate !== null && body.notifiedDate !== '') {
    if (typeof body.notifiedDate !== 'string' || Number.isNaN(Date.parse(body.notifiedDate))) {
      return { ok: false, error: 'notifiedDate must be a valid date.' };
    }
  }
  return { ok: true };
}

export type ReportGate =
  | { ok: true }
  | { ok: false; code: string; refusal: string };

/**
 * A-09: no default — an absent (or incomplete legacy) settings row blocks
 * export. The check runs FIRST in every report/export endpoint.
 */
export function reportGateStatus(settings: ReportSettingsRecord | null | undefined): ReportGate {
  if (
    !settings ||
    !isDisclosureLevel(settings.disclosure_level) ||
    !isReportLevel(settings.report_level) ||
    typeof settings.statement_name !== 'string' ||
    !settings.statement_name.trim() ||
    typeof settings.statement_period !== 'string' ||
    !settings.statement_period.trim()
  ) {
    return { ok: false, code: REPORT_GATE_CODE, refusal: REPORT_GATE_REFUSAL };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// D. Disclosure index builder + HARD RULE (M-11/10 §6, A-13, MP-48).
// ---------------------------------------------------------------------------

/** One joined item row feeding the index (built by SQL in the route). */
export interface IndexSourceRow {
  disclosureId: string;
  disclosureCode: string;
  disclosureTitle: string;
  standardCode: string;
  standardTitle: string;
  itemId: string;
  itemCode: string;
  /** Item weight (priority-derived). Falls back to 2 when absent. */
  weight?: number | null;
  departmentId: string | null;
  departmentName: string | null;
  score: 0 | 50 | 100 | null;
  notEvaluated: boolean;
  notApplicable: boolean;
  naReason: string | null;
  /** Evaluation justification = the omission explanation carrier (A-13). */
  justification: string | null;
  /** Linked answer evidence note = the location carrier (§6). */
  answerValue: string | null;
  answerStatus: string | null;
}

export interface DisclosureIndexRow {
  standardCode: string;
  standardTitle: string;
  disclosureCode: string;
  disclosureTitle: string;
  /** Where in the client evidence it is addressed (empty allowed ONLY when omitted). */
  location: string | null;
  locationComplete: boolean;
  omitted: boolean;
  /** Omission reason (BR-03 code; mixed-reason disclosures join codes with ' + '). */
  omissionReason: string | null;
  omissionExplanation: string | null;
  /** HARD-RULE flag: omitted without BOTH reason and explanation. */
  incomplete: boolean;
  /** Review coverage for this disclosure (A-12: beside every score). */
  evaluatedItems: number;
  applicableItems: number;
  coveragePercentage: number;
  score: number | null;
  itemsCount: number;
  departments: string[];
  departmentIds: string[];
}

export interface DisclosureIndexBuild {
  rows: DisclosureIndexRow[];
  /** Disclosure codes violating the HARD RULE (omitted without reason+explanation). */
  offendingCodes: string[];
}

/**
 * Builds one row per disclosure. The HARD RULE is enforced on the RESULT:
 * no row may be omitted without BOTH reason and explanation — violations are
 * RETURNED flagged incomplete (never silently dropped) and the route answers
 * 422 naming the offending disclosure codes.
 */
export function buildDisclosureIndex(sourceRows: IndexSourceRow[]): DisclosureIndexBuild {
  const byDisclosure = new Map<string, IndexSourceRow[]>();
  for (const r of sourceRows) {
    const list = byDisclosure.get(r.disclosureId) ?? [];
    list.push(r);
    byDisclosure.set(r.disclosureId, list);
  }

  const rows: DisclosureIndexRow[] = [];
  const offendingCodes: string[] = [];

  for (const [, items] of byDisclosure) {
    const first = items[0];
    // Dedupe repeat item rows (one row per item; joins may repeat).
    const seen = new Set<string>();
    const uniq = items.filter((r) => {
      if (seen.has(r.itemId)) return false;
      seen.add(r.itemId);
      return true;
    });

    const omittedItems = uniq.filter((r) => r.notApplicable);
    const withoutReason = omittedItems.filter((r) => !isOmissionReason(r.naReason));
    const withoutExplanation = omittedItems.filter(
      (r) => isOmissionReason(r.naReason) && !(typeof r.justification === 'string' && r.justification.trim())
    );

    // Disclosure-level omission: EVERY item omitted (with reason). Mixed
    // disclosures stay non-omitted; the omitted items surface in L2 summary.
    const allOmitted = uniq.length > 0 && omittedItems.length === uniq.length;
    const reasonSet = new Set(omittedItems.map((r) => r.naReason).filter(isOmissionReason));
    const explanations = omittedItems
      .map((r) => (typeof r.justification === 'string' ? r.justification.trim() : ''))
      .filter(Boolean);

    const omitted = allOmitted && withoutReason.length === 0 && withoutExplanation.length === 0;
    // Unanimous reason travels as-is (A-13); mixed reasons are joined — never
    // fabricated — so the row still carries its real reason(s).
    const distinctReasons = [...reasonSet].sort();
    const omissionReason: string | null = omitted ? distinctReasons.join(' + ') || null : null;
    const omissionExplanation: string | null = omitted ? explanations.join(' | ') || null : null;

    // HARD RULE: any omitted item lacking reason or explanation poisons the row.
    const incomplete = withoutReason.length > 0 || withoutExplanation.length > 0;

    // Location: derived from linked answers/evidence notes.
    const locations = uniq
      .map((r) => (typeof r.answerValue === 'string' ? r.answerValue.trim() : ''))
      .filter(Boolean);
    const deptNames = [...new Set(uniq.map((r) => r.departmentName).filter((x): x is string => Boolean(x)))];
    const deptIds = [...new Set(uniq.map((r) => r.departmentId).filter((x): x is string => Boolean(x)))];
    const location = locations.length > 0 ? locations.join(' | ').slice(0, 2000) : null;
    const locationComplete = omitted ? true : location !== null;

    // Per-disclosure score + coverage (SAME weighted rule as the dashboard:
    // weight = priority-derived item weight; drafts excluded upstream, N/A
    // excluded here, drafts-as-not-evaluated).
    let weightedSum = 0;
    let weightTotal = 0;
    let evaluatedItems = 0;
    const applicableItems = uniq.length - omittedItems.length;
    for (const r of uniq) {
      if (r.notApplicable) continue;
      if (r.notEvaluated || r.score === null || r.score === undefined) continue;
      evaluatedItems++;
      const w = typeof r.weight === 'number' && r.weight > 0 ? r.weight : 2;
      weightedSum += w * r.score;
      weightTotal += w;
    }
    const score = weightTotal > 0 ? Math.round((weightedSum / weightTotal) * 10) / 10 : null;
    const coveragePercentage =
      applicableItems > 0 ? Math.round((evaluatedItems / applicableItems) * 1000) / 10 : 0;

    const row: DisclosureIndexRow = {
      standardCode: first.standardCode,
      standardTitle: first.standardTitle,
      disclosureCode: first.disclosureCode,
      disclosureTitle: first.disclosureTitle,
      location,
      locationComplete,
      omitted,
      omissionReason,
      omissionExplanation,
      incomplete,
      evaluatedItems,
      applicableItems,
      coveragePercentage,
      score,
      itemsCount: uniq.length,
      departments: deptNames,
      departmentIds: deptIds,
    };
    rows.push(row);
    if (incomplete) offendingCodes.push(row.disclosureCode);
  }

  rows.sort((a, b) =>
    a.standardCode === b.standardCode
      ? a.disclosureCode.localeCompare(b.disclosureCode)
      : a.standardCode.localeCompare(b.standardCode)
  );
  return { rows, offendingCodes: [...new Set(offendingCodes)].sort() };
}

// ---------------------------------------------------------------------------
// E. Visibility bounds (04 §4): tenant + department + show/hide flags.
// ---------------------------------------------------------------------------

export interface VisibilityFlags {
  showGap: boolean;
  showCorrective: boolean;
}

/**
 * Same bounds for screen, export, and print: employees see ONLY disclosures
 * touching their own department; admins see all. Returns the subset (a strict
 * subset for employees whenever another department owns any disclosure).
 */
export function applyDepartmentVisibility<T extends { departments: string[]; departmentIds?: string[] }>(
  rows: T[],
  role: string,
  departmentId: string | null | undefined,
  departmentName: string | null | undefined
): T[] {
  if (role !== 'employee' || !departmentId) return rows;
  return rows.filter((r) => {
    if (Array.isArray(r.departmentIds) && r.departmentIds.length > 0) {
      return r.departmentIds.includes(departmentId);
    }
    if (departmentName) return r.departments.includes(departmentName);
    return false;
  });
}

/** Redacts gap numbers when the client×service hides them (show_gap=false). */
export function applyShowGapFlags<T extends { score?: unknown; coveragePercentage?: unknown }>(
  rows: T[],
  flags: VisibilityFlags
): T[] {
  if (flags.showGap) return rows;
  return rows.map((r) => ({ ...r, score: null, coveragePercentage: null }));
}

// ---------------------------------------------------------------------------
// F. Structured export builders (MP-50: JSON + CSV, no heavy PDF lib).
// ---------------------------------------------------------------------------

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const INDEX_CSV_HEADERS = [
  'standard_code',
  'standard_title',
  'disclosure_code',
  'disclosure_title',
  'location',
  'omitted',
  'omission_reason',
  'omission_explanation',
  'evaluated_items',
  'applicable_items',
  'coverage_pct',
  'score',
  'items_count',
  'departments',
];

/** Tabular CSV of the disclosure index (respects the same row bounds). */
export function indexToCSV(rows: DisclosureIndexRow[]): string {
  const lines = [INDEX_CSV_HEADERS.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.standardCode,
        r.standardTitle,
        r.disclosureCode,
        r.disclosureTitle,
        r.location ?? '',
        r.omitted ? 'yes' : 'no',
        r.omissionReason ?? '',
        r.omissionExplanation ?? '',
        r.evaluatedItems,
        r.applicableItems,
        r.coveragePercentage,
        r.score ?? '',
        r.itemsCount,
        r.departments.join(' | '),
      ]
        .map(csvCell)
        .join(',')
    );
  }
  return lines.join('\n');
}

/**
 * 422 message naming the offending disclosure codes (MP-48 negative checks).
 * Bilingual, same plain-text discipline as the unified refusal.
 */
export function indexIncompleteMessage(codes: string[]): string {
  return (
    `Disclosure index incomplete: ${codes.length} disclosure(s) omitted without a stored reason and explanation: ` +
    codes.join(', ') +
    `. Record the BR-03 reason and its explanation for each, then retry. | ` +
    `فهرس الإفصاحات غير مكتمل: ${codes.length} من الإفصاحات محذوفة دون سبب وتفسير مسجلين: ` +
    codes.join(', ') +
    `. سجل سبب BR-03 وتفسيره لكل منها ثم أعد المحاولة.`
  );
}
