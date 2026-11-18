import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Copy, Download, FileSpreadsheet, RefreshCw, UploadCloud } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import { apiFetch } from '../lib/api.ts';
import { sanitizeServiceCode, serviceBucketSuffix } from '../lib/generalBucket.ts';
import { ServiceRail, type ServiceRow, type ServiceCounts, type NewServiceInput } from '../components/services/ServiceRail.tsx';
import {
  DEFAULT_NAMED_SETTINGS,
  ServiceSettingsPanel,
  type ServiceNamedSettings,
} from '../components/services/ServiceSettingsPanel.tsx';
import {
  ServiceContentPanel, matches, FIELD_CLS,
  type BulkPatch, type BulkRowResult, type DepartmentOption, type EligibleClient, type ItemHistory,
  type ItemPatch, type ItemRow, type NewItemInput, type StandardNode,
} from '../components/services/ServiceContentPanel.tsx';
/**
 * TASK-PROTO-U4-2-FIX P5 — P services workspace (master → detail, sectioned by tabs).
 *
 * Tabs are `overview·content·settings·import` (OD-13 G-1…G-5, spec UI-1): the
 * Rules tab and the raw JSON settings editor are deleted, and the surface
 * performs no client/department linking writes (INV-DEF-APP). Every panel shows
 * only what the API really returns (no invented fields).
 */
export const SERVICE_TABS = ['overview', 'content', 'settings', 'import'] as const;
export type ServiceTab = (typeof SERVICE_TABS)[number];
/** Tab gating: no service selected → the workspace shows its honest empty state. */
export function tabsFor(serviceId: string | null): ServiceTab[] {
  return serviceId ? [...SERVICE_TABS] : [];
}
/** P2-08: never surface a raw browser string ("Failed to fetch"); messages our
 * own server produced pass through unchanged. */
export function friendlyError(err: unknown, fallback: string): string {
  const message = (err as Error)?.message ?? '';
  return !message || /failed to fetch|networkerror|load failed/i.test(message) ? fallback : message;
}
/** A refusal our server coded as FROZEN_SCOPE (own {error, code} body) — the
 * reactive frozen-scope banner derives from this, never from invented state. */
export function isFrozenRefusal(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const code = (data as { code?: unknown }).code;
  const error = (data as { error?: unknown }).error;
  return code === 'FROZEN_SCOPE' || (typeof error === 'string' && /FROZEN_SCOPE|frozen by GE final/i.test(error));
}
export function filterServices(services: ServiceRow[], query: string): ServiceRow[] {
  return services.filter((service) => matches(query, service.name, service.code, service.description));
}
/** Linked-only disclosure/item roll-up (a service owns nothing it is not linked to). */
export function countsForService(service: ServiceRow, nodes: StandardNode[]): ServiceCounts {
  return {
    standards: service.standards.length,
    disclosures: nodes.reduce((sum, node) => sum + node.disclosures.length, 0),
    items: nodes.reduce((sum, node) => sum + node.disclosures.reduce((n, d) => n + d.items.length, 0), 0),
  };
}
/** The drill tree for one service: linked standards → their disclosures → items. */
export function buildContent(service: ServiceRow, disclosures: DisclosureRow[], items: ItemRow[]): StandardNode[] {
  return service.standards.map((ref) => ({
    id: ref.id, code: ref.code, title: ref.title,
    disclosures: disclosures.filter((d) => d.standard_id === ref.id).map((d) => ({
      id: d.id, code: d.code, title: d.title, description: d.description,
      items: items.filter((item) => item.disclosure_id === d.id),
    })),
  }));
}
export function contentStatus(counts: ServiceCounts): 'ready' | 'empty' {
  return counts.items > 0 ? 'ready' : 'empty';
}
/** Clients this service is actually linked to (P list already carries services[]). */
export function eligibleClients(clients: ClientOption[], serviceId: string | null): EligibleClient[] {
  if (!serviceId) return [];
  return clients
    .filter((client) => Array.isArray(client.services) && client.services.some((ref) => ref.id === serviceId))
    .map((client) => ({ id: client.id, name: client.name }));
}
/** A group = one disclosure rendered as a group (its standard carries
 * category 'group'); a direct item = one item of the GENERAL disclosure under
 * the service's GENERAL bucket standard. Details are never a tree level. */
export interface GroupEntry {
  id: string; code: string; title: string; description: string | null;
  standardId: string; standardCode: string; items: ItemRow[];
}
export interface FlexibleContent { standards: StandardNode[]; groups: GroupEntry[]; direct: ItemRow[]; }
/** P5: TRUE only for the group-bucket category (never for general/universal). */
export function isGroupCategory(category: unknown): boolean {
  return typeof category === 'string' && category.trim().toLowerCase() === 'group';
}
/** P5: the GENERAL bucket standard of one service (direct items live there). */
export function isGeneralStandard(code: unknown, category: unknown): boolean {
  const c = typeof code === 'string' ? code.trim().toUpperCase() : '';
  const cat = typeof category === 'string' ? category.trim().toLowerCase() : '';
  return c.startsWith('GENERAL-') || cat === 'general';
}
/** P5: the suggested code for a new group-bucket standard (globally unique by
 * the same service-suffix convention as the GENERAL bucket — no DB change). */
export function suggestedGroupStandardCode(serviceCode: string, serviceId: string): string {
  return `GROUP-${sanitizeServiceCode(serviceCode)}-${serviceBucketSuffix(serviceId)}`;
}
/** P5: split the linked tree into regular standards + groups + direct items. */
export function buildFlexibleContent(
  service: ServiceRow, disclosures: DisclosureRow[], items: ItemRow[],
  categories: Record<string, string> = {},
): FlexibleContent {
  const flex: FlexibleContent = { standards: [], groups: [], direct: [] };
  for (const ref of service.standards) {
    const category = categories[ref.id];
    const rows = disclosures.filter((d) => d.standard_id === ref.id);
    if (isGroupCategory(category)) {
      for (const d of rows) {
        flex.groups.push({
          id: d.id, code: d.code, title: d.title, description: d.description,
          standardId: ref.id, standardCode: ref.code,
          items: items.filter((item) => item.disclosure_id === d.id),
        });
      }
      continue;
    }
    if (isGeneralStandard(ref.code, category)) {
      const general = rows.filter((d) => d.code === 'GENERAL');
      const rest = rows.filter((d) => d.code !== 'GENERAL');
      for (const d of general) flex.direct.push(...items.filter((item) => item.disclosure_id === d.id));
      if (rest.length > 0) {
        flex.standards.push({
          id: ref.id, code: ref.code, title: ref.title,
          disclosures: rest.map((d) => ({
            id: d.id, code: d.code, title: d.title, description: d.description,
            items: items.filter((item) => item.disclosure_id === d.id),
          })),
        });
      }
      continue;
    }
    flex.standards.push({
      id: ref.id, code: ref.code, title: ref.title,
      disclosures: rows.map((d) => ({
        id: d.id, code: d.code, title: d.title, description: d.description,
        items: items.filter((item) => item.disclosure_id === d.id),
      })),
    });
  }
  return flex;
}
/** P5: counts over the flexible tree (standards/groups/direct/disclosures/items). */
export function flexibleCounts(flex: FlexibleContent): {
  standards: number; groups: number; direct: number; disclosures: number; items: number;
} {
  const disclosures = flex.standards.reduce((sum, node) => sum + node.disclosures.length, 0) + flex.groups.length;
  const items = flex.standards.reduce((sum, node) => sum + node.disclosures.reduce((n, d) => n + d.items.length, 0), 0)
    + flex.groups.reduce((sum, g) => sum + g.items.length, 0) + flex.direct.length;
  return { standards: flex.standards.length, groups: flex.groups.length, direct: flex.direct.length, disclosures, items };
}
/** P5: live scope (active) vs retained history (archived) — archived items are
 * never in the drill tree but stay viewable with their history. */
export function splitArchived(items: ItemRow[]): { active: ItemRow[]; archived: ItemRow[] } {
  return {
    active: items.filter((item) => item.status !== 'archived'),
    archived: items.filter((item) => item.status === 'archived'),
  };
}
/** P5 DG-04: reopened answers are status-only (counts by status, never values). */
export function reopenedCount(summary: Array<{ status: string; count: number }>): number {
  return summary.filter((row) => row.status === 'reopened').reduce((sum, row) => sum + (Number(row.count) || 0), 0);
}
// (W-P5-01: the named-settings closed set + ServiceSettingsPanel live in
// ../components/services/ServiceSettingsPanel.tsx — pure move, same exports.)
// --- P5 service-scoped import: canonical columns the mapping table offers.
// Canonical key → the parser's built-in synonyms (unmapped headers are shown,
// never silently dropped).
export const IMPORT_CANONICAL_COLUMNS = [
  'standardCode', 'standardTitle', 'category', 'disclosureCode', 'disclosureTitle',
  'itemCode', 'requirement', 'priority', 'esgClass', 'answerType', 'hint',
  'department', 'objective', 'topic', 'reference',
] as const;
/** P5: split one CSV line respecting double-quoted cells (pure, unit-tested). */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') { current += '"'; i++; } else quoted = false;
      } else current += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { cells.push(current.trim()); current = ''; }
    else current += ch;
  }
  cells.push(current.trim());
  return cells.map((cell) => cell.replace(/^"|"$/g, '').trim());
}
/** P5: auto-match canonical columns to file headers (normalized equality). */
export function autoMapColumns(canonical: readonly string[], headers: string[]): Record<string, string> {
  const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  const byNorm = new Map(headers.map((h) => [norm(h), h] as [string, string]));
  const mapping: Record<string, string> = {};
  for (const key of canonical) {
    const hit = byNorm.get(norm(key));
    if (hit) mapping[key] = hit;
  }
  return mapping;
}
interface ClientOption { id: string; name: string; services?: Array<{ id: string }>; }
interface CatalogueStandard { id: string; code: string; title: string; category: string; }
interface DisclosureRow { id: string; standard_id: string; code: string; title: string; description: string | null; }
interface ImportPreviewRow { row: number; standardCode: string; disclosureCode: string; itemCode: string; requirement: string; }
interface ImportRowError { row: number; column: string; code: string; message: string; }
interface ImportPreview {
  serviceId: string;
  summary: { totalStandards: number; totalDisclosures: number; totalItems: number };
  standards: unknown[]; rows: ImportPreviewRow[];
  errors: ImportRowError[]; warnings: string[]; unmappedColumns: string[];
}
interface CommitResult {
  standardsCount: number; disclosuresCount: number; itemsCount: number;
  inserted: number; updated: number; skipped: number; skippedFrozen: number;
  importBatchId: string; mappedStandards: number; unmappedStandards: number; setupNotice: string | null;
}
/** Field look without a width: P1-03 — `w-full` inside a base class beats every
 * explicit `w-*` (CSS order), so widths are only ever applied next to this. */
const inputCls = `w-full ${FIELD_CLS}`;
const cardCls = 'bg-surface-2 border border-border rounded-2xl p-4 space-y-3';
const primaryBtn = 'inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-brand text-brand-ink hover:bg-brand-strong disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-focus-ring/40';
const secondaryBtn = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold bg-surface-2 border border-border-strong text-text hover:bg-surface-3 focus:outline-none focus:ring-2 focus:ring-focus-ring/30';
const msgCls = 'p-2.5 rounded-xl border text-[11px]';
const IMPORT_ROW_LIMIT = 100;
export const ServicesView: React.FC = () => {
  const { t } = useLanguage();
  const s = t.servicesWorkspace;
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [catalogue, setCatalogue] = useState<CatalogueStandard[]>([]);
  const [disclosures, setDisclosures] = useState<DisclosureRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [railSearch, setRailSearch] = useState('');
  const [tab, setTab] = useState<ServiceTab>('overview');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [frozen, setFrozen] = useState(false);
  const [dupOpen, setDupOpen] = useState(false);
  const [dupCode, setDupCode] = useState('');
  const [dupName, setDupName] = useState('');
  const [identity, setIdentity] = useState({ name: '', description: '' });
  const [namedSettings, setNamedSettings] = useState<ServiceNamedSettings>(DEFAULT_NAMED_SETTINGS);
  const [settingsEcho, setSettingsEcho] = useState<string | null>(null);
  // P5 service-scoped import (no client anywhere on this path).
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importText, setImportText] = useState('');
  const [importHeaders, setImportHeaders] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [commitInfo, setCommitInfo] = useState<CommitResult | null>(null);
  const [lastImport, setLastImport] = useState<{ batchId: string; counts: string } | null>(null);
  const [copies, setCopies] = useState<Record<string, { sealedAt: string; hash: string } | null>>({});
  const load = async () => {
    setLoading(true); setError(null);
    try {
      const responses = await Promise.all([
        apiFetch('/api/services'), apiFetch('/api/standards'), apiFetch('/api/disclosures'),
        apiFetch('/api/items?includeArchived=true'), apiFetch('/api/clients'),
      ]);
      if (responses.some((res) => !res.ok)) throw new Error(s.workspaceLoadFailed);
      const [svc, std, disc, itm, cli] = await Promise.all(responses.map((res) => res.json()));
      setServices(svc as ServiceRow[]); setCatalogue(std as CatalogueStandard[]);
      setDisclosures(disc as DisclosureRow[]); setItems(itm as ItemRow[]); setClients(cli as ClientOption[]);
    } catch (err) {
      setError(friendlyError(err, s.workspaceLoadFailed));
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); /* first paint only: apiFetch owns identity + workspace */ }, []);
  // Auto-select the first service, and never keep an id the server dropped.
  useEffect(() => {
    if (!services.length) { setSelectedId(null); return; }
    if (!selectedId || !services.some((service) => service.id === selectedId)) setSelectedId(services[0].id);
  }, [services, selectedId]);
  const service = services.find((row) => row.id === selectedId) ?? null;
  // WHY one memo: the rail needs counts for every service, the workspace needs
  // the full tree for one — both derive from the SAME fetched catalogue.
  const categories = useMemo(() => Object.fromEntries(catalogue.map((row) => [row.id, row.category ?? ''])), [catalogue]);
  const contentByService = useMemo(() => {
    const map = new Map<string, StandardNode[]>();
    for (const row of services) map.set(row.id, buildContent(row, disclosures, items.filter((i) => i.status !== 'archived')));
    return map;
  }, [services, disclosures, items]);
  const flexByService = useMemo(() => {
    const map = new Map<string, FlexibleContent>();
    for (const row of services) {
      map.set(row.id, buildFlexibleContent(row, disclosures, items.filter((i) => i.status !== 'archived'), categories));
    }
    return map;
  }, [services, disclosures, items, categories]);
  const archivedByService = useMemo(() => {
    const map = new Map<string, ItemRow[]>();
    for (const row of services) {
      const ids = new Set(disclosures.filter((d) => row.standards.some((ref) => ref.id === d.standard_id)).map((d) => d.id));
      map.set(row.id, items.filter((i) => i.status === 'archived' && ids.has(i.disclosure_id)));
    }
    return map;
  }, [services, disclosures, items]);
  const content = contentByService.get(service?.id ?? '') ?? [];
  const flex = flexByService.get(service?.id ?? '') ?? { standards: [], groups: [], direct: [] };
  const flexCounts = useMemo(() => flexibleCounts(flex), [flex]);
  const archivedItems = archivedByService.get(service?.id ?? '') ?? [];
  // The GENERAL disclosure carrying the direct items (create-target for the direct section).
  const directDisclosureId = useMemo(() => {
    if (!service) return null;
    const generalRef = service.standards.find((ref) => isGeneralStandard(ref.code, categories[ref.id]));
    if (!generalRef) return null;
    return disclosures.find((d) => d.standard_id === generalRef.id && d.code === 'GENERAL')?.id ?? null;
  }, [service, disclosures, categories]);
  const counts = useMemo(() => (service ? countsForService(service, content) : { standards: 0, disclosures: 0, items: 0 }), [service, content]);
  const linkedClients = useMemo(() => eligibleClients(clients, service?.id ?? null), [clients, service]);
  // Drafts follow the selected service (never carry over across services).
  useEffect(() => {
    setIdentity({ name: service?.name ?? '', description: service?.description ?? '' });
    setNamedSettings(DEFAULT_NAMED_SETTINGS); setSettingsEcho(null);
    setDupOpen(false); setDupCode(''); setDupName('');
    setImportFile(null); setImportText(''); setImportHeaders([]); setColumnMapping({});
    setPreview(null); setCommitInfo(null); setFrozen(false); setCopies({});
  }, [service?.id, service?.name, service?.description]);
  // Departments for the single-department item select: read-only aggregate over
  // the service's linked clients (definition data, never an assignment write).
  useEffect(() => {
    let cancelled = false;
    const loadDepartments = async () => {
      if (!linkedClients.length) { setDepartments([]); return; }
      const seen = new Map<string, string>();
      await Promise.all(linkedClients.map(async (client) => {
        try {
          const res = await apiFetch(`/api/departments?clientId=${encodeURIComponent(client.id)}`);
          if (!res.ok) return;
          const rows = await res.json() as Array<{ id: string; name: string }>;
          for (const row of (Array.isArray(rows) ? rows : [])) {
            if (row?.id && !seen.has(String(row.id))) seen.set(String(row.id), String(row.name ?? row.id));
          }
        } catch { /* read-only enrichment: one failing tenant never blocks the screen */ }
      }));
      if (!cancelled) {
        setDepartments([...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)));
      }
    };
    void loadDepartments();
    return () => { cancelled = true; };
  }, [linkedClients]);
  // Approved-copy strip (read-only, per linked client; works after source
  // deletion per N-3 — here the service exists, so this is the sealed state).
  useEffect(() => {
    let cancelled = false;
    const loadCopies = async () => {
      if (!service || tab !== 'overview' || !linkedClients.length) return;
      const next: Record<string, { sealedAt: string; hash: string } | null> = {};
      await Promise.all(linkedClients.map(async (client) => {
        try {
          const res = await apiFetch(`/api/services/${service.id}/approved-copy?clientId=${encodeURIComponent(client.id)}`);
          if (!res.ok) { next[client.id] = null; return; }
          const copy = await res.json() as { sealed_at?: string; content_hash?: string };
          next[client.id] = copy?.sealed_at ? { sealedAt: String(copy.sealed_at), hash: String(copy.content_hash ?? '') } : null;
        } catch { next[client.id] = null; }
      }));
      if (!cancelled) setCopies(next);
    };
    void loadCopies();
    return () => { cancelled = true; };
  }, [service, tab, linkedClients]);
  const send = async (path: string, method: string, body?: unknown) => {
    const res = await apiFetch(path, { method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      if (isFrozenRefusal(data)) setFrozen(true);
      throw new Error((data as { error?: string } | null)?.error || s.actionFailed);
    }
    return data;
  };
  const runMutation = async (action: () => Promise<void>, successText: string): Promise<boolean> => {
    setBusy(true); setFormError(null); setNotice(null);
    try {
      await action(); await load(); setNotice(successText);
      return true;
    } catch (err) {
      setFormError(friendlyError(err, s.actionFailed));
      return false;
    } finally { setBusy(false); }
  };
  // The rail owns its own error surface: a create failure is about the form,
  // not about the selected service's workspace panels.
  const createService = async (input: NewServiceInput): Promise<boolean> => {
    setBusy(true); setCreateError(null);
    try {
      const created = await send('/api/services', 'POST', { ...input, description: input.description || null });
      await load(); setSelectedId((created as { id: string }).id); setNotice(t.common.success);
      return true;
    } catch (err) {
      setCreateError(friendlyError(err, s.actionFailed));
      return false;
    } finally { setBusy(false); }
  };
  const duplicateService = async () => {
    if (!service) return;
    const ok = await runMutation(async () => {
      const created = await send(`/api/services/${service.id}/duplicate`, 'POST', { code: dupCode.trim(), name: dupName.trim() || undefined });
      setSelectedId((created as { service: { id: string } }).service.id);
    }, t.common.success);
    if (ok) setDupOpen(false);
  };
  const saveIdentity = async () => {
    if (!service) return;
    if (!identity.name.trim()) { setFormError(s.fieldRequired); return; }
    await runMutation(async () => {
      await send(`/api/services/${service.id}`, 'PATCH', { name: identity.name.trim(), description: identity.description.trim() || null });
    }, t.common.success);
  };
  const saveNamedSettings = async () => {
    if (!service) return;
    const payload: ServiceNamedSettings = {
      default_answer_type: namedSettings.default_answer_type,
      default_priority: namedSettings.default_priority,
      default_esg_class: namedSettings.default_esg_class,
      attachment_required_default: namedSettings.attachment_required_default,
      report_visible_default: namedSettings.report_visible_default,
    };
    setBusy(true); setFormError(null); setNotice(null);
    try {
      const updated = await send(`/api/services/${service.id}`, 'PATCH', { settings: payload });
      setSettingsEcho(JSON.stringify((updated as { settings?: unknown }).settings ?? payload, null, 2));
      setNotice(t.common.success);
    } catch (err) {
      setFormError(friendlyError(err, s.actionFailed));
    } finally { setBusy(false); }
  };
  const linkStandard = (standardId: string) => runMutation(async () => {
    if (!service) throw new Error(s.actionFailed);
    await send(`/api/services/${service.id}/standards`, 'POST', { standardId });
  }, t.common.success);
  const unlinkStandard = (standardId: string) => runMutation(async () => {
    if (!service) throw new Error(s.actionFailed);
    await send(`/api/services/${service.id}/standards`, 'DELETE', { standardId });
  }, t.common.success);
  /** P5: creates + links a standard, resolving the new id (group flow chains on it). */
  const createStandard = async (input: { code: string; title: string; category: string }): Promise<string | null> => {
    if (!service) return null;
    setBusy(true); setFormError(null); setNotice(null);
    try {
      const created = await send('/api/standards', 'POST', input) as { id: string };
      await send(`/api/services/${service.id}/standards`, 'POST', { standardId: created.id });
      await load(); setNotice(t.common.success);
      return created.id;
    } catch (err) {
      setFormError(friendlyError(err, s.actionFailed));
      return null;
    } finally { setBusy(false); }
  };
  const updateStandard = (id: string, patch: { title?: string; category?: string }) => runMutation(async () => {
    await send(`/api/standards/${id}`, 'PATCH', patch);
  }, t.common.success);
  const deleteStandard = (id: string) => runMutation(async () => {
    await send(`/api/standards/${id}`, 'DELETE');
  }, t.common.success);
  const createDisclosure = (standardId: string, input: { code: string; title: string; description?: string | null }) =>
    runMutation(async () => {
      await send('/api/disclosures', 'POST', { standardId, ...input });
    }, t.common.success);
  const updateDisclosure = (id: string, patch: { title?: string; description?: string | null }) => runMutation(async () => {
    await send(`/api/disclosures/${id}`, 'PATCH', patch);
  }, t.common.success);
  const deleteDisclosure = (id: string) => runMutation(async () => {
    await send(`/api/disclosures/${id}`, 'DELETE');
  }, t.common.success);
  const createItem = (disclosureId: string, input: NewItemInput) => runMutation(async () => {
    await send('/api/items', 'POST', { disclosureId, ...input });
  }, t.common.success);
  /** P5 N-7: version-conflict is a first-class outcome (drawer shows the
   * conflict box with reload), not a silent boolean. */
  const saveItem = async (itemId: string, patch: ItemPatch): Promise<number | 'conflict' | null> => {
    setBusy(true); setFormError(null); setNotice(null);
    try {
      const updated = await send(`/api/items/${itemId}`, 'PATCH', patch) as { version?: number };
      await load(); setNotice(t.common.success);
      return typeof updated?.version === 'number' ? updated.version : null;
    } catch (err) {
      const message = (err as Error)?.message ?? '';
      setFormError(friendlyError(err, s.actionFailed));
      return /changed since version|version_conflict/i.test(message) ? 'conflict' : null;
    } finally { setBusy(false); }
  };
  /** P5 G-4: archive-with-history vs permanent delete — the outcome decides the message. */
  const deleteItem = async (itemId: string, reason: string | null): Promise<'archived' | 'deleted' | null> => {
    setBusy(true); setFormError(null); setNotice(null);
    try {
      const data = await send(`/api/items/${itemId}`, 'DELETE', reason ? { reason } : {});
      await load();
      const outcome = (data as { archived?: boolean; deleted?: boolean })?.archived ? 'archived' as const : 'deleted' as const;
      setNotice(outcome === 'archived' ? s.itemArchivedNote : t.common.success);
      return outcome;
    } catch (err) {
      setFormError(friendlyError(err, s.actionFailed));
      return null;
    } finally { setBusy(false); }
  };
  const bulkEdit = async (ids: string[], patch: BulkPatch, expectedVersions: Record<string, number>): Promise<BulkRowResult[] | null> => {
    setBusy(true); setFormError(null); setNotice(null);
    try {
      const data = await send('/api/items/bulk', 'POST', { ids, patch, expectedVersions });
      await load();
      const results = (data as { results?: BulkRowResult[] }).results ?? [];
      const okCount = results.filter((r) => r.ok).length;
      setNotice(s.bulkEditDone.replace('{ok}', String(okCount)).replace('{n}', String(results.length)));
      return results;
    } catch (err) {
      setFormError(friendlyError(err, s.actionFailed));
      return null;
    } finally { setBusy(false); }
  };
  const fetchHistory = async (itemId: string): Promise<ItemHistory | null> => {
    try {
      const res = await apiFetch(`/api/items/${itemId}/history`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error || s.actionFailed);
      return data as ItemHistory;
    } catch (err) {
      setFormError(friendlyError(err, s.actionFailed));
      return null;
    }
  };
  // --- P5 service-scoped import (template → file → mapping → preview → commit).
  const downloadTemplate = async () => {
    if (!service) return;
    setBusy(true); setFormError(null);
    try {
      const res = await apiFetch(`/api/services/${service.id}/import/template`);
      if (!res.ok) throw new Error(s.importFailed);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `Import_Template_${service.code}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setFormError(friendlyError(err, s.importFailed));
    } finally { setBusy(false); }
  };
  const pickImportFile = async (file: File | null) => {
    setImportFile(file); setPreview(null); setCommitInfo(null); setFormError(null);
    if (!file) { setImportText(''); setImportHeaders([]); setColumnMapping({}); return; }
    try {
      const name = file.name.toLowerCase();
      if (name.endsWith('.csv') || name.endsWith('.txt')) {
        const text = await file.text();
        const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
        const headers = splitCsvLine(firstLine).filter(Boolean);
        setImportText(text); setImportHeaders(headers);
        setColumnMapping(autoMapColumns(IMPORT_CANONICAL_COLUMNS, headers));
      } else {
        const XLSX = await import('xlsx');
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false }) as unknown[][];
        const headers = ((grid[0] ?? []) as unknown[]).map((cell) => String(cell ?? '').trim()).filter(Boolean);
        const csv = XLSX.utils.sheet_to_csv(sheet);
        setImportText(csv); setImportHeaders(headers);
        setColumnMapping(autoMapColumns(IMPORT_CANONICAL_COLUMNS, headers));
      }
    } catch {
      setFormError(s.importFailed);
      setImportText(''); setImportHeaders([]); setColumnMapping({});
    }
  };
  const previewImport = async () => {
    if (!service || !importText) return;
    setBusy(true); setFormError(null); setCommitInfo(null); setPreview(null);
    try {
      const data = await send('/api/import/preview', 'POST', {
        serviceId: service.id, csvContent: importText, columnMapping,
      });
      setPreview(data as ImportPreview);
    } catch (err) {
      setFormError(friendlyError(err, s.importFailed));
    } finally { setBusy(false); }
  };
  const commitImport = async () => {
    if (!service || !preview) return;
    setBusy(true); setFormError(null);
    try {
      const data = await send('/api/import/commit', 'POST', { serviceId: service.id, standards: preview.standards });
      const committed = data as CommitResult;
      setCommitInfo(committed);
      setLastImport({
        batchId: committed.importBatchId,
        counts: `${committed.standardsCount} / ${committed.disclosuresCount} / ${committed.itemsCount}`,
      });
      setPreview(null); setImportFile(null); setImportText(''); setImportHeaders([]); setColumnMapping({});
      setNotice(s.importDone);
      await load();
    } catch (err) {
      setFormError(friendlyError(err, s.importFailed));
    } finally { setBusy(false); }
  };
  const tabLabel: Record<ServiceTab, string> = { overview: s.tabOverview, content: s.tabContent, settings: s.tabSettings, import: s.tabImport };
  const status = contentStatus(counts);
  // P2-11: a real tablist — roving tabindex + arrow/Home/End, panels always in
  // the DOM (hidden), so every aria-controls target exists.
  const onTabKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const rtl = document.documentElement.dir === 'rtl';
    const index = SERVICE_TABS.indexOf(tab);
    const delta = event.key === (rtl ? 'ArrowLeft' : 'ArrowRight') ? 1 : event.key === (rtl ? 'ArrowRight' : 'ArrowLeft') ? -1 : 0;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? SERVICE_TABS.length - 1 : delta ? (index + delta + SERVICE_TABS.length) % SERVICE_TABS.length : -1;
    if (next < 0) return;
    event.preventDefault();
    setTab(SERVICE_TABS[next]);
    document.getElementById(`svc-tab-${SERVICE_TABS[next]}`)?.focus();
  };
  const frozenBanner = frozen && service ? (
    <p role="alert" className={`${msgCls} bg-warning-soft border-warning text-warning-text font-bold`}>{s.frozenScopeBanner}</p>
  ) : null;
  const panels: Record<ServiceTab, React.ReactNode> = {
    overview: (
      <div className="space-y-3">
        {frozenBanner}
        <div className={cardCls}>
          <h2 className="text-xs font-bold text-text">{s.definition}</h2>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
            <div className="min-w-0"><dt className="text-muted font-semibold">{t.services.codeLabel}</dt><dd className="font-bold text-text break-all"><bdi dir="ltr">{service?.code}</bdi></dd></div>
            <div className="min-w-0"><dt className="text-muted font-semibold">{t.services.nameLabel}</dt><dd className="font-bold text-text break-words"><bdi dir="ltr">{service?.name}</bdi></dd></div>
            <div className="sm:col-span-2 min-w-0"><dt className="text-muted font-semibold">{t.services.descLabel}</dt><dd className="text-text break-words"><bdi dir="ltr">{service?.description || s.descriptionEmpty}</bdi></dd></div>
            {service?.created_at && (
              <div className="min-w-0"><dt className="text-muted font-semibold">{s.created}</dt><dd className="text-text"><bdi dir="ltr">{new Date(service.created_at).toLocaleDateString()}</bdi></dd></div>
            )}
          </dl>
        </div>
        <div className={cardCls}>
          <h2 className="text-xs font-bold text-text">{s.contentState}</h2>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[11px] text-muted">
            <span>{s.levelStandards} <bdi dir="ltr" className="text-sm font-extrabold text-text">{flexCounts.standards}</bdi></span>
            <span>{s.contentGroups} <bdi dir="ltr" className="text-sm font-extrabold text-text">{flexCounts.groups}</bdi></span>
            <span>{s.contentDirect} <bdi dir="ltr" className="text-sm font-extrabold text-text">{flexCounts.direct}</bdi></span>
            <span>{s.levelDisclosures} <bdi dir="ltr" className="text-sm font-extrabold text-text">{flexCounts.disclosures}</bdi></span>
            <span>{s.levelItems} <bdi dir="ltr" className="text-sm font-extrabold text-text">{flexCounts.items}</bdi></span>
          </div>
          <p className={`text-[11px] font-bold ${status === 'ready' ? 'text-success-text' : 'text-warning-text'}`}>{status === 'ready' ? s.contentOk : s.contentEmpty}</p>
          {archivedItems.length > 0 && (
            <p className="text-[11px] text-muted">{s.archivedCount}: <bdi dir="ltr" className="font-bold text-text">{archivedItems.length}</bdi></p>
          )}
          <p className="text-[11px] text-muted">{s.clientsUnit}: <bdi dir="ltr" className="font-bold text-text">{linkedClients.length}</bdi> <span className="text-muted">({s.linkedReadOnly})</span></p>
          <p className="text-[11px] text-muted">{s.lastImport}: {lastImport
            ? <><bdi dir="ltr" className="font-bold text-text">{lastImport.counts}</bdi> <bdi dir="ltr" className="text-muted">({lastImport.batchId})</bdi></>
            : <>{s.lastImportNone} — {s.lastImportHint}</>}</p>
        </div>
        <div className={cardCls}>
          <h2 className="text-xs font-bold text-text">{s.approvedCopiesTitle}</h2>
          {linkedClients.length === 0 ? (
            <p className="text-[11px] text-muted">{s.approvedCopiesNone}</p>
          ) : (
            <ul className="space-y-1.5">
              {linkedClients.map((client) => {
                const copy = copies[client.id];
                return (
                  <li key={client.id} className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-xl bg-surface-3 border border-border text-[11px]">
                    <span className="font-bold text-text break-words">{client.name}</span>
                    {copy ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="px-1.5 py-0.5 rounded-full bg-success-soft text-success-text font-bold">{s.approvedCopySealed}</span>
                        <bdi dir="ltr" className="text-muted">{new Date(copy.sealedAt).toLocaleDateString()} · {copy.hash.slice(0, 12)}</bdi>
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded-full bg-surface-2 text-muted font-bold">{s.approvedCopyMissing}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-[10px] text-muted">{s.approvedCopiesHint}</p>
        </div>
      </div>
    ),
    content: service && tab === 'content' ? (
      <ServiceContentPanel service={service} nodes={content} groups={flex.groups} direct={flex.direct} archived={archivedItems}
        catalogue={catalogue} categories={categories} busy={busy} frozen={frozen} departments={departments}
        groupStandardCode={suggestedGroupStandardCode(service.code, service.id)}
        onLinkStandard={linkStandard} onUnlinkStandard={unlinkStandard}
        onCreateStandard={createStandard} onUpdateStandard={updateStandard} onDeleteStandard={deleteStandard}
        onCreateDisclosure={createDisclosure} onUpdateDisclosure={updateDisclosure} onDeleteDisclosure={deleteDisclosure}
        onCreateItem={createItem} onSaveItem={saveItem} onDeleteItem={deleteItem}
        onBulkEdit={bulkEdit} onFetchHistory={fetchHistory} onReload={() => void load()}
        directDisclosureId={directDisclosureId} />
    ) : null,
    settings: (
      <ServiceSettingsPanel serviceCode={service?.code ?? ''}
        identity={identity} onIdentity={(next) => setIdentity(next)}
        namedSettings={namedSettings} onNamedSettings={(next) => setNamedSettings(next)}
        settingsEcho={settingsEcho} busy={busy} frozen={frozen} frozenBanner={frozenBanner}
        onSaveIdentity={() => void saveIdentity()} onSaveNamedSettings={() => void saveNamedSettings()} />
    ),
    import: (
      <div className={cardCls}>
        <h2 className="text-xs font-bold text-text">{s.importTitle}</h2>
        <p className="text-[11px] text-muted" dir="auto">{s.importFormats}</p>
        <div>
          <button type="button" disabled={busy || !service} onClick={() => void downloadTemplate()} className={secondaryBtn}>
            <Download className="w-3.5 h-3.5" /><span>{s.templateDownload}</span>
          </button>
          <p className="text-[10px] text-muted mt-1">{s.templateDownloadHint}</p>
        </div>
        <label className="flex flex-col items-center justify-center gap-1.5 p-5 rounded-2xl border border-dashed border-border-strong bg-surface-3 text-center cursor-pointer hover:bg-surface-2">
          <UploadCloud className="w-6 h-6 text-brand-text" />
          <span className="text-[11px] font-bold text-text flex items-center gap-1.5"><FileSpreadsheet className="w-3.5 h-3.5" />{s.importDrop}</span>
          <span dir="ltr" className="text-[10px] text-muted">{importFile ? importFile.name : '.xlsx / .csv'}</span>
          <input type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={(e) => { void pickImportFile(e.target.files?.[0] ?? null); }} />
        </label>
        {importHeaders.length > 0 && (
          <div className="p-3 rounded-xl bg-surface-3 border border-border space-y-2">
            <h3 className="text-[11px] font-bold text-text">{s.mappingTitle}</h3>
            <p className="text-[10px] text-muted">{s.mappingHint}</p>
            <div className="space-y-1.5 max-h-96 overflow-y-auto pe-1">
              {IMPORT_CANONICAL_COLUMNS.map((canonical) => (
                <label key={canonical} className="flex flex-wrap items-center gap-2 text-[10px]">
                  <bdi dir="ltr" className="font-extrabold text-info min-w-28">{canonical}</bdi>
                  <select value={columnMapping[canonical] ?? ''}
                    onChange={(e) => setColumnMapping({ ...columnMapping, ...(e.target.value ? { [canonical]: e.target.value } : { [canonical]: undefined as unknown as string }) })}
                    aria-label={`${s.mappingFileColumn}: ${canonical}`}
                    className={`${FIELD_CLS} flex-1 min-w-40`}>
                    <option value="">—</option>
                    {importHeaders.map((header) => <option key={header} value={header}>{header}</option>)}
                  </select>
                </label>
              ))}
            </div>
          </div>
        )}
        {!preview ? (
          <button type="button" disabled={!importText || busy} onClick={() => void previewImport()} className={primaryBtn}>{busy ? s.importPreviewing : s.importPreview}</button>
        ) : (
          <div className="p-3 rounded-xl bg-surface-3 border border-border space-y-2">
            <p className="text-[11px] font-bold text-text">{s.importConfirmService.replace('{service}', service?.name ?? '')}</p>
            <p className="text-[10px] text-muted" dir="ltr">{preview.summary.totalStandards} / {preview.summary.totalDisclosures} / {preview.summary.totalItems}</p>
            {preview.unmappedColumns.length > 0 && (
              <div className="text-[10px]">
                <p className="font-bold text-warning-text">{s.unmappedTitle}</p>
                <ul className="flex flex-wrap gap-1 mt-1">
                  {preview.unmappedColumns.map((col) => (
                    <li key={col} dir="ltr" className="px-1.5 py-0.5 rounded-full bg-warning-soft text-warning-text font-bold">{col}</li>
                  ))}
                </ul>
              </div>
            )}
            {preview.warnings.length > 0 && (
              <ul className="text-[10px] text-muted space-y-0.5">
                {preview.warnings.map((w, n) => <li key={n} dir="auto">{w}</li>)}
              </ul>
            )}
            {preview.errors.length > 0 ? (
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-danger">{s.rowErrorsTitle} <bdi dir="ltr">({preview.errors.length})</bdi></p>
                <ul className="space-y-1 max-h-96 overflow-y-auto pe-1">
                  {preview.errors.slice(0, IMPORT_ROW_LIMIT).map((rowError, n) => (
                    <li key={n} className="p-1.5 rounded-lg bg-danger-soft border border-danger text-[10px] text-danger">
                      <bdi dir="ltr" className="font-extrabold">#{rowError.row} · {rowError.column} · {rowError.code}</bdi>
                      <span className="block" dir="auto">{rowError.message}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-[10px] text-muted">{s.commitBlocked}</p>
              </div>
            ) : (
              <>
                <p role="status" className="text-[10px] font-bold text-success-text">{s.previewClean}</p>
                <div className="space-y-1 max-h-96 overflow-y-auto pe-1">
                  {preview.rows.slice(0, IMPORT_ROW_LIMIT).map((row) => (
                    <p key={row.row} className="text-[10px] text-muted"><bdi dir="ltr" className="font-bold text-text">#{row.row} {row.standardCode} / {row.disclosureCode} / {row.itemCode}</bdi> <span dir="auto">{row.requirement}</span></p>
                  ))}
                </div>
                <button type="button" disabled={busy} onClick={() => void commitImport()} className={primaryBtn}>{busy ? s.importing : s.importConfirmAction}</button>
              </>
            )}
          </div>
        )}
        {commitInfo && (
          <div className="p-3 rounded-xl bg-surface-3 border border-border space-y-1 text-[11px]">
            <p role="status" className="font-bold text-success-text">{s.importDone}</p>
            <p className="text-muted" dir="ltr">{commitInfo.standardsCount} / {commitInfo.disclosuresCount} / {commitInfo.itemsCount}</p>
            <p className="text-muted" dir="ltr">+{commitInfo.inserted} · ~{commitInfo.updated} · ={commitInfo.skipped}</p>
            {commitInfo.setupNotice && <p className="text-warning-text flex items-start gap-1"><AlertTriangle className="w-3 h-3 shrink-0" /><span dir="auto">{commitInfo.setupNotice}</span></p>}
          </div>
        )}
      </div>
    ),
  };
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-4 items-start">
      <ServiceRail services={filterServices(services, railSearch)} total={services.length} countsOf={(row) => countsForService(row, contentByService.get(row.id) ?? [])}
        selectedId={selectedId} onSelect={(id) => { setSelectedId(id); setTab('overview'); setNotice(null); setFormError(null); setCreateError(null); }}
        search={railSearch} onSearch={setRailSearch} loading={loading} error={error} onRetry={() => void load()}
        onCreate={createService} creating={busy} createError={createError} />
      {/* P1-01: NO overflow-hidden here — it made the sticky header a scroll
          context and pinned nothing. The rounded card border stays. */}
      <section className="bg-surface-2 border border-border rounded-2xl">
        {!service ? (
          error ? (
            <div role="alert" className="p-8 text-center space-y-3">
              <p className="text-sm font-bold text-text">{s.workspaceLoadFailed}</p>
              <p className="text-xs text-muted break-words">{error}</p>
              <button type="button" onClick={() => void load()} className={primaryBtn}><RefreshCw className="w-3.5 h-3.5" /><span>{t.common.retry}</span></button>
            </div>
          ) : (loading || services.length > 0) ? (
            <div aria-hidden="true" className="p-4 space-y-2">
              {[0, 1, 2].map((n) => <div key={n} className="h-20 rounded-xl bg-surface-3 animate-pulse" />)}
              <span className="sr-only">{t.common.loading}</span>
            </div>
          ) : (
            <div className="p-10 text-center space-y-2">
              <p className="text-sm font-bold text-text">{s.selectTitle}</p>
              <p className="text-xs text-muted">{s.selectHint}</p>
            </div>
          )
        ) : (
          <>
            <header className="sticky top-0 z-20 bg-surface-2 border-b border-border rounded-t-2xl px-4 py-3 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h1 className="text-base font-bold text-text break-words" data-page-heading tabIndex={-1}>{service.name}</h1>
                  <p dir="ltr" className="text-[11px] font-extrabold text-muted break-all">{service.code}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setDupOpen(!dupOpen)} className={secondaryBtn}>
                    <Copy className="w-3.5 h-3.5" /><span>{t.services.duplicateButton}</span>
                  </button>
                  <button type="button" onClick={() => void load()} title={t.common.refresh} aria-label={t.common.refresh} className={secondaryBtn}>
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>
              {dupOpen && (
                <div className="flex flex-wrap items-end gap-2 p-2.5 rounded-xl bg-surface-3 border border-border">
                  <input value={dupCode} onChange={(e) => setDupCode(e.target.value)} placeholder={s.duplicateCodeLabel} dir="ltr" className={`${inputCls} flex-1 min-w-40`} />
                  <input value={dupName} onChange={(e) => setDupName(e.target.value)} placeholder={s.duplicateNameLabel} className={`${inputCls} flex-1 min-w-40`} />
                  <button type="button" disabled={!dupCode.trim() || busy} onClick={() => void duplicateService()} className={primaryBtn}>{busy ? t.services.duplicating : s.duplicateSubmit}</button>
                  <p className="w-full text-[10px] text-muted">{s.duplicateHint}</p>
                </div>
              )}
              <div role="tablist" aria-label={service.name} onKeyDown={onTabKey} className="flex flex-wrap gap-1">
                {tabsFor(service.id).map((key) => (
                  <button key={key} type="button" role="tab" id={`svc-tab-${key}`} aria-selected={tab === key} aria-controls={`svc-panel-${key}`}
                    tabIndex={tab === key ? 0 : -1}
                    onClick={() => { setTab(key); setNotice(null); setFormError(null); }}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border focus:outline-none focus:ring-2 focus:ring-focus-ring/30 ${tab === key ? 'bg-brand-soft text-brand-text border-brand' : 'text-muted hover:bg-surface-3 border-transparent'}`}>
                    {tabLabel[key]}
                  </button>
                ))}
              </div>
            </header>
            <div className="p-4 space-y-3">
              {formError && <p role="alert" className={`${msgCls} bg-danger-soft border-danger text-danger`}>{formError}</p>}
              {notice && <p role="status" className={`${msgCls} bg-success-soft border-success text-success-text`}>{notice}</p>}
              {SERVICE_TABS.map((key) => (
                <div key={key} id={`svc-panel-${key}`} role="tabpanel" aria-labelledby={`svc-tab-${key}`} hidden={tab !== key} className="space-y-3">
                  {panels[key]}
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
};
