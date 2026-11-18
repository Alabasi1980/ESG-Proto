/**
 * TASK-PROTO-U4-3 unit (c2) — pure helpers for the consultant application console.
 *
 * Research refs (no new visual language; FIX rail/drill/drawer/banner reused):
 *  - ContraForce Workspace Center (per-workspace settings tabs + search + status pills)
 *    → inspire: one tab per application step, searchable rails, explicit status chips.
 *  - Connecting-Expertise admin settings (company/departments/users submenus)
 *    → inspire: checkbox participating-department set with work badges.
 *  - Intuit Expert Portal (one consolidated expert tool) → inspire: single W console.
 *  - Genesys Cloud admin tiles + right drawer → inspire: step tiles (already in repo).
 *  - Dribbble SaaS admin tables (filter + confirm-before-apply) → inspire: staff
 *    table with search and two-step approve/provision.
 *  Avoid: new colors, new layout idioms, tenant pickers, invented endpoints/math.
 *
 * WHY a separate module: code-equality auto-match (G4), the closed N/A reason
 * list (G2), the endpoint allowlist and the auth/workspace header builder are
 * pure and unit-testable without a database. All server semantics stay
 * server-side; this file only shapes what the c1 + pre-existing APIs return.
 * W is bound to the session tenant A everywhere — there is intentionally no
 * tenant picker and no cross-tenant query wiring in this surface.
 */

import type { QueueItem } from '../../views/EvaluationPanel.tsx';
import type { ServiceRow } from '../services/ServiceRail.tsx';
// NOTE (U4-3c2 boot fix): do NOT import from '../../lib/b11b.ts' here — that
// module pulls 'crypto' (node builtin, externalized in the browser) and blanks
// the whole app at load since App statically imports this console. The N/A
// vocabulary is inlined (must stay identical to STAFF_NA_REASONS server-side).
import { CLIENT_FIELD_MASK_VALUES } from '../../lib/clientFieldMask.ts';
import { headers as workspaceTabHeaders } from '../../lib/workspaceClient.ts';

/** Tenant department as consumed by the W console (code may be absent). */
export interface ConsultantDept {
  id: string;
  code: string | null;
  name: string;
}

/** Linked service row (from GET /api/clients/:id services). */
export interface ConsultantLinkedService {
  id: string;
  code: string;
  name: string;
  clientFieldMask?: unknown;
}

/** One service-side department key referenced by service content. */
export interface ServiceDeptEntry {
  serviceId: string;
  serviceCode: string;
  serviceDeptCode: string;
}

/** One auto-match suggestion (G4) or manual override row. */
export interface DeptMapping {
  serviceId: string;
  serviceDeptCode: string;
  clientDeptId: string;
}

/** G2 closed N/A reason list (mandatory; same vocabulary the server enforces
 * in STAFF_NA_REASONS — kept inline so the browser bundle never pulls 'crypto'). */
export const NA_REASONS: readonly string[] = [
  'not-applicable',
  'legal-prohibitions',
  'confidentiality-constraints',
  'information-unavailable-incomplete',
];

/** G6 mask vocabulary incl. the three new operational columns. */
export const MASK_FIELDS: readonly string[] = CLIENT_FIELD_MASK_VALUES;

/** The three G6 additions, visible-by-default per DG-D2 (unchecked = visible). */
export const NEW_MASK_FIELDS: readonly string[] = ['documents', 'initiatives', 'na_status'];

/**
 * Allowed API routes for the W console (c1 workspace routes + pre-existing
 * reads/writes from the spec UI-5/API-2). Anything else is a bug — the unit
 * test pins every fetch in this surface against this list.
 */
export const CONSULTANT_API_ALLOWLIST: readonly string[] = [
  '/api/services',
  '/api/clients/',
  '/api/assignments',
  '/api/queue',
  '/api/items',
  '/api/disclosures',
  '/api/departments',
  '/api/staff-lists',
  '/api/workspace/client-services',
  '/api/workspace/participating-departments',
  '/api/workspace/dept-matching',
  '/api/workspace/staff/',
  '/api/workspace/services/',
  '/api/assignments/na',
];

/** Auth + workspace-tab headers for direct fetch calls. */
export function consultantHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return { ...headers, ...workspaceTabHeaders() };
}

/** Auth-only headers for apiFetch calls (it attaches the tab itself). */
export function consultantAuthHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** Auth + JSON headers for apiFetch POST/PUT/PATCH calls. */
export function consultantJsonHeaders(token: string | null): Record<string, string> {
  return { ...consultantAuthHeaders(token), 'Content-Type': 'application/json' };
}

function normalizeCode(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * G4 auto-match: service-side department codes ↔ tenant department codes by
 * exact code equality (case-insensitive, trimmed). Every service-side key with
 * no equal tenant code is unmatched and must be mapped explicitly before
 * assignment-affecting actions (the server refuses with `match.incomplete`).
 */
export function autoMatchServiceDepts(
  entries: ServiceDeptEntry[],
  tenantDepts: ConsultantDept[],
): { matched: DeptMapping[]; unmatched: ServiceDeptEntry[] } {
  const byCode = new Map<string, ConsultantDept>();
  for (const dept of tenantDepts) {
    const code = normalizeCode(dept.code);
    if (code && !byCode.has(code)) byCode.set(code, dept);
  }
  const matched: DeptMapping[] = [];
  const unmatched: ServiceDeptEntry[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = `${entry.serviceId}::${normalizeCode(entry.serviceDeptCode)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const hit = byCode.get(normalizeCode(entry.serviceDeptCode));
    if (hit) matched.push({ serviceId: entry.serviceId, serviceDeptCode: entry.serviceDeptCode, clientDeptId: hit.id });
    else unmatched.push(entry);
  }
  return { matched, unmatched };
}

/**
 * Service-side department keys referenced by tenant queue rows of linked
 * services: standard_code → service id via the catalogue, department_code as
 * the service-side key. Queue rows outside linked services are ignored.
 */
export function serviceDeptEntries(
  queue: QueueItem[],
  services: Array<Pick<ServiceRow, 'id' | 'code' | 'standards'>>,
  linkedIds: Set<string>,
): ServiceDeptEntry[] {
  const standardToService = new Map<string, { id: string; code: string }>();
  for (const service of services) {
    for (const ref of service.standards ?? []) {
      if (ref?.code && !standardToService.has(ref.code)) {
        standardToService.set(ref.code, { id: service.id, code: service.code });
      }
    }
  }
  const out: ServiceDeptEntry[] = [];
  for (const row of queue) {
    const service = standardToService.get(row.standard_code);
    if (!service || !linkedIds.has(service.id)) continue;
    const code = (row.department_code ?? '').trim();
    if (!code) continue;
    out.push({ serviceId: service.id, serviceCode: service.code, serviceDeptCode: code });
  }
  return out;
}

/** N/A-state rows for the scope display (read-only shaping of queue rows). */
export interface NaStateRow {
  itemId: string;
  code: string;
  disclosureCode: string;
  departmentName: string;
  naReason: string | null;
}

export function naStateRows(queue: QueueItem[]): NaStateRow[] {
  return queue
    .filter((row) => row.not_applicable === true)
    .map((row) => ({
      itemId: row.item_id,
      code: row.code,
      disclosureCode: row.disclosure_code,
      departmentName: row.department_name,
      naReason: row.na_reason,
    }));
}

/** Stored mask read tolerantly: unknown shapes stay as-is for display only. */
export function readMask(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}
