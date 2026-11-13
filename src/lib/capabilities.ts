import { LEGACY_ROUTES } from '../server/accessRegistry.ts';

export type AccessMode = 'platform' | 'consultant' | 'client' | 'employee';
export type BusinessRole = 'ge_admin' | 'client_admin' | 'employee';
export interface AccessContext {
  actorId: string;
  sessionId: string;
  role: BusinessRole;
  mode: AccessMode;
  tenantId: string | null;
  departmentId: string | null;
  tabId: string | null;
  generation: number | null;
  capability: string;
}

export const TAB_LIMIT = 20;
export const TAB_IDLE_MS = 30 * 60 * 1000;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validGeneration(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value)
    && Number.isSafeInteger(Number(value)) && Number(value) <= 2147483647;
}
export function validBinding(access: AccessContext): boolean {
  if (access.role !== 'ge_admin' && access.role !== 'client_admin' && access.role !== 'employee') return false;
  if (!access.actorId || !access.sessionId) return false;
  if (access.role === 'ge_admin') return !!access.tabId && Number.isInteger(access.generation) && access.generation! > 0
    && (access.mode === 'platform' ? access.tenantId === null
      : access.mode === 'consultant' && !!access.tenantId);
  return !access.tabId && !!access.tenantId && (access.role === 'client_admin'
    ? access.mode === 'client' : access.role === 'employee' && access.mode === 'employee' && !!access.departmentId);
}

// Describes the approved future navigation contract; U1 activated NO business
// capability, and each later flip is an explicit accessRegistry edit.
const pages: Record<AccessMode, readonly string[]> = {
  platform: ['ge-overview','clients','client-detail','standards','initiatives','import-gri','settings','staff-lists','audit-log','notifications'],
  consultant: ['client-detail','dashboard','client-dashboard','standards','gap-analysis','actions','initiatives','esg-profile','reports','staff-lists','audit-log','notifications'],
  client: ['client-detail','client-dashboard','standards','gap-analysis','actions','initiatives','esg-profile','reports','staff-lists','notifications'],
  employee: ['gap-analysis'],
};
export function permittedPages(access: AccessContext): readonly string[] {
  return validBinding(access) ? pages[access.mode] : [];
}
/** Truthful by construction (task §19(3), §17 Info O2): derived from the SAME
 * registry the dispatcher enforces, so the workspace envelope (workspace.ts)
 * can never under-report a landed flip. system/session are shell capabilities,
 * not business ones, and are excluded. */
export function activeBusinessCapabilities(): readonly string[] {
  return [...new Set(LEGACY_ROUTES.filter(route => route.activation === 'U1'
    && route.capability !== 'system' && route.capability !== 'session')
    .map(route => route.capability))];
}
