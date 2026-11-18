/**
 * TASK-PROTO-U3-B1 §1 — the ONE navigation model of the context shell.
 *
 * Authority: B17_UI_BINDINGS.md §2 (contexts / landings / persistent identity)
 * and §3 (exact page IDs, AR/EN labels, sidebar order and per-context presence).
 * Nothing outside this module may decide which page exists in which context:
 * Sidebar renders `menuPages()`, Header titles come from `labelOf()`/`navPages()`,
 * and App resolves every requested tab through `resolvePage()` before it mounts
 * anything. Pure data + pure functions — no React, no fetch, no storage, no URL,
 * so the whole matrix is testable in node.
 *
 * Context derivation uses the workspace mirror (workspaceClient) only for the
 * GE actor's tab mode; it never guesses a tenant:
 *   ge_admin + consultant tab bound to a client -> consultant (W)
 *   ge_admin otherwise                         -> platform   (P)
 *   client_admin                               -> client     (C)
 *   employee                                   -> employee   (E)
 *   anything else / malformed role             -> null (no pages)
 */

export type NavContext = 'platform' | 'consultant' | 'client' | 'employee';

export type PageId =
  | 'ge-overview'
  | 'clients'
  | 'dashboard'
  | 'client-dashboard'
  | 'client-detail'
  | 'standards'
  | 'gap-analysis'
  | 'actions'
  | 'initiatives'
  | 'esg-profile'
  | 'reports'
  | 'import-gri'
  | 'settings'
  | 'staff-lists'
  | 'audit-log'
  | 'notifications';

export interface PageLabel {
  ar: string;
  en: string;
}

export const CONTEXTS: readonly NavContext[] = ['platform', 'consultant', 'client', 'employee'];

export const PAGE_IDS: readonly PageId[] = [
  'ge-overview', 'clients', 'dashboard', 'client-dashboard', 'client-detail',
  'standards', 'gap-analysis', 'actions', 'initiatives', 'esg-profile',
  'reports', 'import-gri', 'settings', 'staff-lists', 'audit-log', 'notifications',
];

/**
 * §3 pages declared in the model but with no implementation yet. TASK-PROTO-U3-B2
 * supplies the last one (`clients`), so the list is now empty; the guard keeps
 * using it so any future placeholder stays non-mountable by construction.
 */
export const PENDING_PAGE_IDS: readonly PageId[] = [];

export function isPendingPage(id: PageId): boolean {
  return PENDING_PAGE_IDS.includes(id);
}

/** §3 default label per page (the context overrides live in LABEL_OVERRIDES). */
const DEFAULT_LABELS: Record<PageId, PageLabel> = {
  'ge-overview': { ar: 'عمليات GE', en: 'GE Operations' },
  'clients': { ar: 'العملاء', en: 'Clients' },
  'dashboard': { ar: 'لوحة المؤشرات', en: 'Dashboard' },
  'client-dashboard': { ar: 'لوحة العميل', en: 'Client Dashboard' },
  'client-detail': { ar: 'تفاصيل العميل', en: 'Client Detail' },
  'standards': { ar: 'معايير GRI', en: 'GRI Standards' },
  'gap-analysis': { ar: 'تحليل الفجوات', en: 'Gap Analysis' },
  'actions': { ar: 'الإجراءات التصحيحية', en: 'Corrective Actions' },
  'initiatives': { ar: 'مكتبة المبادرات', en: 'Initiatives Library' },
  'esg-profile': { ar: 'الملف البيئي والاجتماعي (ESG)', en: 'ESG Profile' },
  'reports': { ar: 'التقارير', en: 'Reports' },
  'import-gri': { ar: 'استيراد بيانات GRI', en: 'Import GRI Data' },
  'settings': { ar: 'الإعدادات وقاعدة البيانات', en: 'Settings & Database' },
  'staff-lists': { ar: 'قوائم الموظفين', en: 'Staff Lists' },
  'audit-log': { ar: 'سجل التدقيق', en: 'Audit Log' },
  'notifications': { ar: 'الإشعارات', en: 'Notifications' },
};

/** §3 same-ID / different-label rows (gap-analysis in E; initiatives in W/C). */
const LABEL_OVERRIDES: Partial<Record<NavContext, Partial<Record<PageId, PageLabel>>>> = {
  // TASK-PROTO-U4-2 / B17 §10 (OD-11): P's `standards` id now mounts the
  // services workspace, so the P label follows the service identity. W/C keep
  // the GRI catalogue page and its label untouched.
  platform: { 'standards': { ar: 'الخدمات', en: 'Services' } },
  consultant: {
    'initiatives': { ar: 'المبادرات المسندة', en: 'Assigned Initiatives' },
  },
  client: { 'initiatives': { ar: 'المبادرات المسندة', en: 'Assigned Initiatives' } },
  employee: { 'gap-analysis': { ar: 'إفصاحات قسمي', en: 'My department disclosures' } },
};

interface MatrixEntry {
  id: PageId;
  /** §3 sidebar number; null = contextual (`target`) page, never a menu row. */
  order: number | null;
  /** Rendered in the Sidebar (still subject to `isPendingPage`). */
  menu: boolean;
  /** §3 `target`: reachable ONLY from an explicit contextual action (P's
   * client-detail is opened from Clients with an explicit T). Without such a
   * target there is no truthful way to mount it — and mounting it would fetch
   * first-client defaults, which §3 forbids. B2 owns the target flow. */
  target?: boolean;
  /** §3 `*` row: present only when a server-reported capability proves it. */
  conditional?: boolean;
}

const PAGES: Record<NavContext, readonly MatrixEntry[]> = {
  platform: [
    { id: 'ge-overview', order: 1, menu: true },
    { id: 'clients', order: 2, menu: true },
    { id: 'standards', order: 3, menu: true },
    { id: 'initiatives', order: 4, menu: true },
    // TASK-PROTO-U4-2 (owner instruction): `import-gri` leaves the P sidebar —
    // importing now lives inside Services → Import (per service). The route id
    // stays in the model/App (unreachable from nav in P), W/C are untouched.
    { id: 'settings', order: 6, menu: true },
    { id: 'staff-lists', order: 7, menu: true },
    { id: 'audit-log', order: 8, menu: true },
    { id: 'notifications', order: 9, menu: true },
    // §3: P opens Client Detail from Clients with an explicit target; no menu row.
    { id: 'client-detail', order: null, menu: false, target: true },
  ],
  consultant: [
    { id: 'dashboard', order: 1, menu: true },
    { id: 'client-detail', order: 2, menu: true },
    { id: 'standards', order: 3, menu: true },
    { id: 'gap-analysis', order: 4, menu: true },
    { id: 'actions', order: 5, menu: true },
    { id: 'initiatives', order: 6, menu: true },
    { id: 'esg-profile', order: 7, menu: true, conditional: true },
    { id: 'reports', order: 8, menu: true, conditional: true },
    { id: 'staff-lists', order: 9, menu: true },
    { id: 'audit-log', order: 10, menu: true },
    { id: 'notifications', order: 11, menu: true },
  ],
  client: [
    { id: 'client-dashboard', order: 1, menu: true },
    { id: 'client-detail', order: 2, menu: true },
    { id: 'standards', order: 3, menu: true },
    { id: 'gap-analysis', order: 4, menu: true },
    { id: 'actions', order: 5, menu: true },
    { id: 'initiatives', order: 6, menu: true },
    { id: 'esg-profile', order: 7, menu: true, conditional: true },
    { id: 'reports', order: 8, menu: true, conditional: true },
    // TASK-PROTO-U4-3b round 3: C `staff-lists` nav row hidden — the client
    // console tab is the C staff surface; P keeps the page until unit (d).
    { id: 'notifications', order: 10, menu: true },
  ],
  employee: [
    // §3: exactly ONE work item; no dashboard/ancillary modules, no inbox row.
    { id: 'gap-analysis', order: 1, menu: true },
  ],
};

/** §3: W `client-dashboard` IS `dashboard`; C `dashboard` IS `client-dashboard`. */
const ALIASES: Partial<Record<NavContext, Partial<Record<PageId, PageId>>>> = {
  consultant: { 'client-dashboard': 'dashboard' },
  client: { 'dashboard': 'client-dashboard' },
};

/** §2 landings. P's fresh-login landing is `ge-overview`; an explicit
 * workspace Exit (and every reload/new-tab boot-exit) lands on `clients`
 * (see `workspaceExitLanding`). */
const LANDINGS: Record<NavContext, PageId> = {
  platform: 'ge-overview',
  consultant: 'dashboard',
  client: 'client-dashboard',
  employee: 'gap-analysis',
};

export interface NavEntry {
  id: PageId;
  order: number | null;
  menu: boolean;
  /** §3 `target` row: contextual only, never mountable on its own. */
  target: boolean;
  label: PageLabel;
}

export function labelOf(id: PageId, context: NavContext): PageLabel {
  return LABEL_OVERRIDES[context]?.[id] ?? DEFAULT_LABELS[id];
}

/**
 * Every page that exists in `context` (§3 row present), in §3 order, with the
 * context label. `capabilities` is the SERVER-reported capability / entitlement
 * set; the `*` rows are withheld unless it names them (never guessed true).
 */
export function navPages(context: NavContext, capabilities: readonly string[] = []): NavEntry[] {
  return PAGES[context]
    .filter((entry) => !entry.conditional || capabilities.includes(entry.id))
    .map((entry) => ({
      id: entry.id,
      order: entry.order,
      menu: entry.menu,
      target: Boolean(entry.target),
      label: labelOf(entry.id, context),
    }))
    .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER));
}

/** Presence set (contextual targets included, aliases excluded). */
export function pagesIn(context: NavContext, capabilities: readonly string[] = []): PageId[] {
  return navPages(context, capabilities).map((entry) => entry.id);
}

/** Sidebar rows: model order, implemented non-target pages only. */
export function menuPages(context: NavContext, capabilities: readonly string[] = []): NavEntry[] {
  return navPages(context, capabilities)
    .filter((entry) => entry.menu && !entry.target && !isPendingPage(entry.id));
}

export function landingFor(context: NavContext): PageId {
  return LANDINGS[context];
}

/** §7 acknowledgment: Exit → P Clients. Reload/new/duplicated-tab boot-exit
 * lands on the same page, never on a guessed W context. */
export function workspaceExitLanding(): 'clients' {
  return 'clients';
}

/** §7: the shell phase (mirrors the workspace lifecycle; kept local so this
 * module stays dependency-free). Only `idle` may resolve a protected page. */
export type ShellPhase = 'idle' | 'checking' | 'opening' | 'closing' | 'failed';

export interface ShellPageRequest {
  context: NavContext | null;
  phase: ShellPhase;
  /** The last committed tab (raw request; never rendered directly). */
  activeTab: PageId | null;
  /** §2/§7 first-boot destination: fresh login ge-overview, reload/exit clients. */
  bootLanding: 'ge-overview' | 'clients' | null;
  /** An explicit shell destination that must survive a context transition. */
  pendingLanding: PageId | null;
  /** True while the P Configure sub-state holds an explicit T. */
  hasConfigTarget: boolean;
}

/**
 * TASK-PROTO-U3-B2 M1 — ONE deterministic resolution for every transition.
 *
 * Precedence is `pendingLanding` > `activeTab` > `bootLanding`, so:
 *  - an explicit Exit/recovery destination is never coerced by the old context's
 *    raw tab (the QA F1 defect);
 *  - a reload/mid-session recovery (bootLanding = clients) wins over a stale tab;
 *  - a fresh login (no pending, no tab, bootLanding = ge-overview) lands §2;
 *  - P `client-detail` without an explicit target resolves to Clients;
 *  - while a transition is pending nothing is mounted (null).
 */
export function resolveShellPage(request: ShellPageRequest): PageId | null {
  if (!request.context || request.phase !== 'idle') return null;
  const requested = request.pendingLanding ?? request.activeTab ?? request.bootLanding;
  if (request.context === 'platform' && requested === 'client-detail' && !request.hasConfigTarget) {
    return workspaceExitLanding();
  }
  return resolvePage(request.context, requested).page;
}

export function aliasOf(context: NavContext, id: PageId): PageId | null {
  return ALIASES[context]?.[id] ?? null;
}

/**
 * True when the page may be mounted in this context: present in §3, implemented
 * in this build (Clients is B2) and not a target-only row (P's client-detail
 * needs an explicit target — mounting it without one would fetch first-client
 * defaults, which §3 forbids).
 */
export function isPageAllowed(context: NavContext, id: PageId, capabilities: readonly string[] = []): boolean {
  const entry = navPages(context, capabilities).find((page) => page.id === id);
  return Boolean(entry) && !entry!.target && !isPendingPage(id);
}

export interface ResolvedPage {
  /** The page the shell is allowed to mount (never a forbidden or pending page). */
  page: PageId;
  /** The request was normalised (alias) or denied and replaced by the landing. */
  redirected: boolean;
}

/**
 * Deny-by-default resolution used by App BEFORE anything is mounted: alias
 * first (W/C same-page rule), then presence + implementation, else the context
 * landing. A null request means "fresh shell" and yields the landing as-is.
 */
export function resolvePage(
  context: NavContext,
  requested: PageId | null,
  capabilities: readonly string[] = [],
): ResolvedPage {
  const landing = landingFor(context);
  if (requested === null) return { page: landing, redirected: false };
  const target = aliasOf(context, requested) ?? requested;
  if (!isPageAllowed(context, target, capabilities)) return { page: landing, redirected: true };
  return { page: target, redirected: target !== requested };
}

/** §2 derivation — no URL, no localStorage, no tenant guess. */
export function deriveNavContext(
  role: string | null | undefined,
  mode: 'platform' | 'consultant' | null,
  hasWorkspaceClient: boolean,
): NavContext | null {
  if (role === 'ge_admin') return mode === 'consultant' && hasWorkspaceClient ? 'consultant' : 'platform';
  if (role === 'client_admin') return 'client';
  if (role === 'employee') return 'employee';
  return null;
}

/** §2 identity block: P/W/C/E label + the one truthful name each owns. */
export type IdentityLabelKey = 'platformAdmin' | 'consultantWorkspace' | 'company' | 'department';

const IDENTITY_LABELS: Record<NavContext, IdentityLabelKey> = {
  platform: 'platformAdmin',
  consultant: 'consultantWorkspace',
  client: 'company',
  employee: 'department',
};

export interface ShellIdentity {
  labelKey: IdentityLabelKey;
  value: string | null;
  secondary: string | null;
}

export function identityLabelKey(context: NavContext): IdentityLabelKey {
  return IDENTITY_LABELS[context];
}

export function shellIdentity(
  context: NavContext,
  names: { clientName?: string | null; companyName?: string | null; departmentName?: string | null },
): ShellIdentity {
  const labelKey = IDENTITY_LABELS[context];
  if (context === 'platform') return { labelKey, value: null, secondary: null };
  // W: the authoritative workspace client (never GE user.clientName).
  if (context === 'consultant') return { labelKey, value: names.clientName ?? null, secondary: null };
  // C: own DB-derived company name from the session.
  if (context === 'client') return { labelKey, value: names.companyName ?? null, secondary: null };
  // E: own department, with the company as the secondary line.
  return { labelKey, value: names.departmentName ?? null, secondary: names.companyName ?? null };
}
