/**
 * TASK-PROTO-U4-3 unit (b) — pure helpers for the client console.
 *
 * WHY a separate module: service grouping, counts, resubmit prefill and the
 * read-only status vocabulary are pure (no DB, no DOM) so they are
 * unit-testable without a database. All server semantics stay server-side;
 * this file only shapes what the existing APIs return (client dashboard,
 * client-review queue, queue, services catalogue) into the own-tenant console
 * the spec (UI-2) requires. C never answers, never attaches, never N/A-marks,
 * never rates items — there is intentionally no write helper here except the
 * staff resubmit prefill (draft shape only; provisioning stays server-side).
 */

import type { QueueItem } from '../../views/EvaluationPanel.tsx';
import type { ServiceRow } from '../services/ServiceRail.tsx';

/** Linked service as returned by GET /api/client/dashboard (own tenant). */
export interface LinkedService {
  id: string;
  code: string;
  name: string;
}

/** One dept row inside a client-review disclosure group (server shape). */
export interface ConsoleDeptRow {
  departmentId: string;
  departmentName: string;
  answerId: string | null;
  answerStatus: string | null;
  evaluationId: string | null;
  evaluationVersion: number | null;
  score: number | null;
  notEvaluated: boolean | null;
  notApplicable: boolean | null;
}

/** One disclosure group as returned by GET /api/client-review (server shape). */
export interface ConsoleReviewGroup {
  disclosureId: string;
  disclosureCode: string;
  disclosureTitle: string;
  standardCode: string;
  departments: ConsoleDeptRow[];
  total: number;
  approved: number;
  clientApproved: number;
  notApplicable: number;
  completeness: number;
  readyForClient: boolean;
  fullyClientApproved: boolean;
  incompleteDepartments: string[];
}

/** Service-centric roll-up of the review queue for the C rail + drill. */
export interface ConsoleServiceGroup {
  id: string;
  code: string;
  name: string;
  /** True when the catalogue named no service for these rows (standard-code fallback). */
  fallback: boolean;
  groups: ConsoleReviewGroup[];
  /** Dept rows in this service. */
  assigned: number;
  /** Dept rows on the confirmed path (dept-approved, client-approved, or N/A). */
  confirmed: number;
  /** Dept rows still pending department work. */
  pending: number;
  completeness: number;
}

/** A dept row is on the confirmed path exactly when it needs no more dept work. */
export function isConfirmedRow(row: { answerStatus: string | null; notApplicable: boolean | null }): boolean {
  if (row.notApplicable === true) return true;
  return row.answerStatus === 'approved' || row.answerStatus === 'client_approved';
}

export function countsForDeptRows(rows: ConsoleDeptRow[]): { assigned: number; confirmed: number; pending: number } {
  const confirmed = rows.filter(isConfirmedRow).length;
  return { assigned: rows.length, confirmed, pending: rows.length - confirmed };
}

/**
 * Group the own-tenant review queue under the tenant's linked services.
 * A service owns a disclosure group exactly when the group's standardCode is
 * one of the service's linked standards. Groups whose standard is in no
 * catalogue service stay visible under a standard-code fallback — never
 * silently dropped.
 */
export function groupReviewByService(
  groups: ConsoleReviewGroup[],
  services: Array<Pick<ServiceRow, 'id' | 'code' | 'name' | 'standards'>>,
): ConsoleServiceGroup[] {
  const standardToService = new Map<string, (typeof services)[number]>();
  for (const service of services) {
    for (const ref of service.standards ?? []) {
      if (ref?.code && !standardToService.has(ref.code)) standardToService.set(ref.code, service);
    }
  }
  const serviceOrder = new Map<string, number>(services.map((service, index) => [service.id, index]));
  const byService = new Map<string, ConsoleReviewGroup[]>();
  const fallback = new Map<string, ConsoleReviewGroup[]>();
  for (const group of groups) {
    const service = standardToService.get(group.standardCode);
    if (service) {
      const list = byService.get(service.id) ?? [];
      list.push(group);
      byService.set(service.id, list);
    } else {
      const list = fallback.get(group.standardCode) ?? [];
      list.push(group);
      fallback.set(group.standardCode, list);
    }
  }
  const out: ConsoleServiceGroup[] = [];
  for (const [serviceId, list] of byService) {
    const service = services.find((s) => s.id === serviceId)!;
    const rows = list.flatMap((g) => g.departments);
    const counts = countsForDeptRows(rows);
    out.push({
      id: service.id,
      code: service.code,
      name: service.name,
      fallback: false,
      groups: [...list].sort((a, b) => a.disclosureCode.localeCompare(b.disclosureCode)),
      ...counts,
      completeness: counts.assigned > 0 ? Math.round((counts.confirmed / counts.assigned) * 100) : 0,
    });
  }
  for (const [code, list] of fallback) {
    const rows = list.flatMap((g) => g.departments);
    const counts = countsForDeptRows(rows);
    out.push({
      id: `standard:${code}`,
      code,
      name: code,
      fallback: true,
      groups: [...list].sort((a, b) => a.disclosureCode.localeCompare(b.disclosureCode)),
      ...counts,
      completeness: counts.assigned > 0 ? Math.round((counts.confirmed / counts.assigned) * 100) : 0,
    });
  }
  out.sort((a, b) => (serviceOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (serviceOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER));
  return out;
}

/** Queue items (read-only for C) that belong to one service's standards. */
export function itemsForService(queue: QueueItem[], standardCodes: string[]): QueueItem[] {
  const codes = new Set(standardCodes);
  return queue.filter((row) => codes.has(row.standard_code));
}

/** Read-only status word for a C queue row (reuses the gap-analysis vocabulary). */
export function consoleStatusLabel(
  status: string | null,
  t: {
    gapAnalysis: {
      stDraft: string;
      stSubmitted: string;
      stApproved: string;
      stClientApproved: string;
      stReturned: string;
      stNotApplicable: string;
      stNotEvaluated: string;
    };
  },
): string {
  switch (status) {
    case 'draft':
      return t.gapAnalysis.stDraft;
    case 'submitted':
      return t.gapAnalysis.stSubmitted;
    case 'approved':
      return t.gapAnalysis.stApproved;
    case 'client_approved':
      return t.gapAnalysis.stClientApproved;
    case 'returned':
      return t.gapAnalysis.stReturned;
    case 'not_applicable':
      return t.gapAnalysis.stNotApplicable;
    default:
      return t.gapAnalysis.stNotEvaluated;
  }
}

/** Staff-list row shape for the C draft form. */
export interface ConsoleStaffDraftRow {
  email: string;
  name: string;
  departmentId: string;
  role: 'employee' | 'client_admin';
}

export function emptyDraftRow(): ConsoleStaffDraftRow {
  return { email: '', name: '', departmentId: '', role: 'employee' };
}

/**
 * Resubmit prefill (G7 default: reject = whole list; resubmit as new version).
 * A rejected list is never edited in place — its rows are copied into a fresh
 * draft payload. Pure shape copy; the draft POST + submit stay in the view.
 */
export function resubmitPrefill(
  rows: Array<{ email: string; name: string; department_id: string | null; department_name: string | null; role: string }>,
  departments: Array<{ id: string; name: string }>,
): ConsoleStaffDraftRow[] {
  const byName = new Map(departments.map((d) => [d.name.trim().toLowerCase(), d.id]));
  const prefilled = rows.map((row) => ({
    email: row.email ?? '',
    name: row.name ?? '',
    departmentId: row.department_id ?? byName.get((row.department_name ?? '').trim().toLowerCase()) ?? '',
    role: row.role === 'client_admin' ? ('client_admin' as const) : ('employee' as const),
  }));
  return prefilled.length > 0 ? prefilled : [emptyDraftRow()];
}
