/**
 * TASK-PROTO-U4-3 unit (a) — pure helpers for the employee services workspace.
 *
 * WHY a separate module: grouping, counts, own-department pinning and the
 * submit-block mirror are pure (no DB, no DOM) so they are unit-testable
 * without a database. All server semantics stay server-side; this file only
 * shapes what the existing APIs return (queue, items, services) into the
 * service-centric workspace the spec (UI-1) requires.
 */

import type { QueueItem } from '../../views/EvaluationPanel.tsx';
import type { ServiceRow } from '../services/ServiceRail.tsx';

/** Item catalogue row as returned by GET /api/items (E L+D scope). */
export interface ItemMeta {
  id: string;
  disclosure_id: string;
  code: string;
  requirement: string;
  answer_type: string;
  hint: string | null;
  priority: string;
  esg_class: string;
  weight: number;
  objective: string | null;
  topic: string | null;
  reference: string | null;
  department_id: string | null;
  sort_order: number | null;
  attachment_required: boolean;
  indicator_code: string | null;
  tags: string[] | null;
  version: number;
  status: string;
  disclosure_code: string;
  standard_code: string;
}

export interface ServiceGroup {
  id: string;
  code: string;
  name: string;
  /** True when the catalogue gave no service for these rows (grouped by standard). */
  fallback: boolean;
  items: QueueItem[];
  assigned: number;
  submitted: number;
  pending: number;
}

const SUBMITTED_STATES = new Set(['submitted', 'approved', 'client_approved']);

/** Roll-up for one service: assigned (all MY rows) / submitted / pending. */
export function countsForItems(items: QueueItem[]): { assigned: number; submitted: number; pending: number } {
  const submitted = items.filter((row) => SUBMITTED_STATES.has(row.answer_status ?? row.status)).length;
  return { assigned: items.length, submitted, pending: items.length - submitted };
}

/**
 * Group the own-department queue into the dept's linked services.
 * A service is "linked for this dept" exactly when at least one queue row
 * (server-scoped to own dept + linked services) maps to one of its standards.
 * Rows whose standard is in no catalogue service stay visible under a
 * standard-code fallback group — never silently dropped.
 */
export function groupQueueByService(queue: QueueItem[], services: ServiceRow[]): ServiceGroup[] {
  const standardToService = new Map<string, ServiceRow>();
  for (const service of services) {
    for (const ref of service.standards ?? []) {
      if (ref?.code && !standardToService.has(ref.code)) standardToService.set(ref.code, service);
    }
  }
  const serviceOrder = new Map<string, number>(services.map((service, index) => [service.id, index]));
  const byService = new Map<string, QueueItem[]>();
  const fallback = new Map<string, QueueItem[]>();
  for (const row of queue) {
    const service = standardToService.get(row.standard_code);
    if (service) {
      const list = byService.get(service.id) ?? [];
      list.push(row);
      byService.set(service.id, list);
    } else {
      const key = row.standard_code || '—';
      const list = fallback.get(key) ?? [];
      list.push(row);
      fallback.set(key, list);
    }
  }
  const groups: ServiceGroup[] = [];
  for (const [serviceId, items] of byService) {
    const service = services.find((row) => row.id === serviceId)!;
    groups.push({
      id: service.id, code: service.code, name: service.name, fallback: false, items,
      ...countsForItems(items),
    });
  }
  groups.sort((a, b) => (serviceOrder.get(a.id) ?? 0) - (serviceOrder.get(b.id) ?? 0));
  for (const [code, items] of [...fallback.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    groups.push({ id: `std:${code}`, code, name: code, fallback: true, items, ...countsForItems(items) });
  }
  return groups;
}

/**
 * Defence-in-depth: keep only rows of the caller's own department.
 * The server already scopes the queue; this pin guarantees the workspace
 * can never render a foreign-department row even if a payload surprises us.
 */
export function filterOwnDepartment<T extends { department_id: string }>(rows: T[], departmentId: string | null | undefined): T[] {
  if (!departmentId) return [];
  return rows.filter((row) => row.department_id === departmentId);
}

export interface DisclosureGroup {
  code: string;
  title: string;
  rows: QueueItem[];
}

/** Disclosure-grouped item list (stable order: disclosure, then item code). */
export function groupByDisclosure(items: QueueItem[]): DisclosureGroup[] {
  const map = new Map<string, DisclosureGroup>();
  for (const row of items) {
    const key = row.disclosure_code || '—';
    const group = map.get(key) ?? { code: key, title: row.disclosure_title || key, rows: [] };
    group.rows.push(row);
    map.set(key, group);
  }
  return [...map.values()].map((group) => ({
    ...group,
    rows: [...group.rows].sort((a, b) => a.code.localeCompare(b.code)),
  }));
}

/** Queue status → localized label (same vocabulary as the gap-analysis queue). */
export function queueStatusLabel(status: string, t: any): string {
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

export type SubmitBlock = 'answer' | 'attachment' | null;

/**
 * Client-side mirror of the server submit gate (answerValidation.ts).
 * Decides which mandatory-submit banner to show; the server stays authoritative.
 * `provided` = a typed answer value is present (blank/absent = false).
 */
export function submitBlockReason(input: {
  answerType: string;
  attachmentRequired: boolean;
  attachmentCount: number;
  notApplicable: boolean;
  provided: boolean;
}): SubmitBlock {
  const count = Number.isFinite(input.attachmentCount) && input.attachmentCount > 0 ? input.attachmentCount : 0;
  if (input.answerType === 'file') {
    return count < 1 ? 'attachment' : null;
  }
  if (input.notApplicable) {
    return input.attachmentRequired && count < 1 ? 'attachment' : null;
  }
  if (!input.provided) return 'answer';
  return input.attachmentRequired && count < 1 ? 'attachment' : null;
}

/** Document submission strip: required vs submitted (server-derived only). */
export function docStatus(provided: boolean): 'required' | 'provided' {
  return provided ? 'provided' : 'required';
}

/** Pick the caller's own department status row (E-scoped lists carry it first). */
export function pickOwnStatus<T extends { departmentId?: string | null; department_id?: string | null }>(
  statuses: T[] | null | undefined,
  departmentId: string | null | undefined,
): T | null {
  if (!statuses || !departmentId) return null;
  return statuses.find((row) => (row.departmentId ?? row.department_id) === departmentId) ?? null;
}
