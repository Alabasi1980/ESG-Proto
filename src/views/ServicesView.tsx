import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Copy, FileSpreadsheet, RefreshCw, Save, UploadCloud } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import { apiFetch } from '../lib/api.ts';
import { ServiceRail, type ServiceRow, type ServiceCounts, type NewServiceInput } from '../components/services/ServiceRail.tsx';
import {
  ServiceContentPanel, matches, ANSWER_TYPES, FIELD_CLS,
  type ItemPatch, type ItemRow, type NewItemInput, type StandardNode, type DepartmentOption, type EligibleClient,
} from '../components/services/ServiceContentPanel.tsx';
/**
 * TASK-PROTO-U4-2 — P services workspace (master → detail, sectioned by tabs).
 *
 * B17_UI_BINDINGS §10 / OD-11 §5: ONE screen per service; the rail holds the
 * only screen-level primary action (create), each tab holds at most one primary
 * action, and nothing is fetched beyond the existing catalogue endpoints. Every
 * panel shows only what the API really returns (no invented fields).
 */
export const SERVICE_TABS = ['overview', 'content', 'rules', 'settings', 'import'] as const;
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
interface ClientOption { id: string; name: string; services?: Array<{ id: string }>; }
interface CatalogueStandard { id: string; code: string; title: string; }
interface DisclosureRow { id: string; standard_id: string; code: string; title: string; description: string | null; }
interface PreviewShape {
  standards: unknown[]; warnings: string[]; errors: string[];
  summary: { totalStandards: number; totalDisclosures: number; totalItems: number };
}
const inputCls = `w-full ${FIELD_CLS}`;
const cardCls = 'bg-surface-2 border border-border rounded-2xl p-4 space-y-3';
const primaryBtn = 'inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-brand text-brand-ink hover:bg-brand-strong disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-focus-ring/40';
const secondaryBtn = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold bg-surface-2 border border-border-strong text-text hover:bg-surface-3 focus:outline-none focus:ring-2 focus:ring-focus-ring/30';
const msgCls = 'p-2.5 rounded-xl border text-[11px]';
const RULES_LIMIT = 100;
export const ServicesView: React.FC = () => {
  const { t } = useLanguage();
  const s = t.servicesWorkspace;
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [catalogue, setCatalogue] = useState<CatalogueStandard[]>([]);
  const [disclosures, setDisclosures] = useState<DisclosureRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<ServiceTab>('overview');
  const [railSearch, setRailSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dupOpen, setDupOpen] = useState(false);
  const [dupCode, setDupCode] = useState('');
  const [dupName, setDupName] = useState('');
  const [identity, setIdentity] = useState({ name: '', description: '' });
  const [settingsText, setSettingsText] = useState('');
  const [settingsEcho, setSettingsEcho] = useState<string | null>(null);
  const [rulesQuery, setRulesQuery] = useState('');
  const [ruleDrafts, setRuleDrafts] = useState<Record<string, string>>({});
  const [importClientId, setImportClientId] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewShape | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const load = async () => {
    setLoading(true); setError(null);
    try {
      const responses = await Promise.all([
        apiFetch('/api/services'), apiFetch('/api/standards'), apiFetch('/api/disclosures'),
        apiFetch('/api/items'), apiFetch('/api/clients'),
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
  const contentByService = useMemo(() => {
    const map = new Map<string, StandardNode[]>();
    for (const row of services) map.set(row.id, buildContent(row, disclosures, items));
    return map;
  }, [services, disclosures, items]);
  const content = contentByService.get(service?.id ?? '') ?? [];
  const counts = useMemo(() => (service ? countsForService(service, content) : { standards: 0, disclosures: 0, items: 0 }), [service, content]);
  const linkedClients = useMemo(() => eligibleClients(clients, service?.id ?? null), [clients, service]);
  const contentItems = content.flatMap((node) => node.disclosures).flatMap((node) => node.items);
  // Drafts follow the selected service (never carry over across services).
  useEffect(() => {
    setIdentity({ name: service?.name ?? '', description: service?.description ?? '' });
    setSettingsText(''); setSettingsEcho(null); setRulesQuery(''); setRuleDrafts({});
    setDupOpen(false); setDupCode(''); setDupName('');
    setImportClientId(''); setImportFile(null); setPreview(null); setImportMsg(null);
  }, [service?.id, service?.name, service?.description]);
  const send = async (path: string, method: string, body?: unknown) => {
    const res = await apiFetch(path, { method, headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data as { error?: string } | null)?.error || s.actionFailed);
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
  const saveSettings = async () => {
    if (!service) return;
    let parsed: unknown;
    try { parsed = JSON.parse(settingsText || '{}'); } catch { setFormError(s.settingsInvalid); return; }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) { setFormError(s.settingsInvalid); return; }
    setBusy(true); setFormError(null); setNotice(null);
    try {
      const updated = await send(`/api/services/${service.id}`, 'PATCH', { settings: parsed });
      setSettingsEcho(JSON.stringify((updated as { settings?: unknown }).settings ?? parsed, null, 2));
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
  const createItem = (disclosureId: string, input: NewItemInput) => runMutation(async () => {
    await send('/api/items', 'POST', { disclosureId, ...input, esgClass: 'general' });
  }, t.common.success);
  const saveItem = (itemId: string, patch: ItemPatch) => runMutation(async () => {
    await send(`/api/items/${itemId}`, 'PATCH', patch);
  }, t.common.success);
  const loadDepartments = async (clientId: string): Promise<DepartmentOption[]> => {
    const res = await apiFetch(`/api/departments?clientId=${encodeURIComponent(clientId)}`);
    const data = res.ok ? await res.json() : [];
    return (Array.isArray(data) ? data : []).map((row: DepartmentOption) => ({ id: row.id, name: row.name }));
  };
  const assignItems = async (clientId: string, departmentId: string, itemIds: string[]): Promise<number> => {
    let assigned = 0;
    for (const itemId of itemIds) {
      // Counted only when the server confirmed it; a partial count is honest.
      try { await send('/api/assignments', 'POST', { clientId, departmentId, itemId }); assigned += 1; } catch { /* reflected above */ }
    }
    return assigned;
  };
  const saveRules = async () => {
    const changed = contentItems.filter((item) => ruleDrafts[item.id] && ruleDrafts[item.id] !== item.answer_type);
    if (changed.length === 0) { setNotice(s.rulesNoChanges); return; }
    const ok = await runMutation(async () => {
      for (const item of changed) await send(`/api/items/${item.id}`, 'PATCH', { answerType: ruleDrafts[item.id] });
    }, s.rulesSaved.replace('{n}', String(changed.length)));
    if (ok) setRuleDrafts({});
  };
  const previewImport = async () => {
    if (!importFile) return;
    setBusy(true); setFormError(null); setImportMsg(null); setPreview(null);
    try {
      const body = new FormData();
      body.append('file', importFile);
      const res = await apiFetch('/api/gri/preview', { method: 'POST', body });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error((data as { error?: string } | null)?.error || s.importFailed);
      setPreview(data as PreviewShape);
    } catch (err) {
      setFormError(friendlyError(err, s.importFailed));
    } finally { setBusy(false); }
  };
  const commitImport = async () => {
    if (!service || !preview || !importClientId) return;
    setBusy(true); setFormError(null);
    try {
      const data = await send('/api/gri/commit', 'POST', { standards: preview.standards, clientId: importClientId, serviceId: service.id });
      const committed = data as { standardsCount?: number; disclosuresCount?: number; itemsCount?: number };
      setImportMsg(`${s.importDone} — ${committed.standardsCount ?? 0} / ${committed.disclosuresCount ?? 0} / ${committed.itemsCount ?? 0}`);
      setPreview(null); setImportFile(null); await load();
    } catch (err) {
      setFormError(friendlyError(err, s.importFailed));
    } finally { setBusy(false); }
  };
  const tabLabel: Record<ServiceTab, string> = { overview: s.tabOverview, content: s.tabContent, rules: s.tabRules, settings: s.tabSettings, import: s.tabImport };
  const status = contentStatus(counts);
  const ruleRows = contentItems.filter((item) => matches(rulesQuery, item.code, item.requirement));
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
  const panels: Record<ServiceTab, React.ReactNode> = {
    overview: (
      <div className="space-y-3">
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
            <span>{s.levelStandards} <bdi dir="ltr" className="text-sm font-extrabold text-text">{counts.standards}</bdi></span>
            <span>{s.levelDisclosures} <bdi dir="ltr" className="text-sm font-extrabold text-text">{counts.disclosures}</bdi></span>
            <span>{s.levelItems} <bdi dir="ltr" className="text-sm font-extrabold text-text">{counts.items}</bdi></span>
          </div>
          <p className={`text-[11px] font-bold ${status === 'ready' ? 'text-success-text' : 'text-warning-text'}`}>{status === 'ready' ? s.contentOk : s.contentEmpty}</p>
          <p className="text-[11px] text-muted">{s.clientsUnit}: <bdi dir="ltr" className="font-bold text-text">{linkedClients.length}</bdi></p>
          <p className="text-[11px] text-muted">{s.lastImport}: {s.lastImportNone} — {s.lastImportHint}</p>
        </div>
      </div>
    ),
    content: service && tab === 'content' ? (
      <ServiceContentPanel service={service} nodes={content} catalogue={catalogue} busy={busy}
        onLinkStandard={linkStandard} onUnlinkStandard={unlinkStandard} onCreateItem={createItem}
        onSaveItem={saveItem} clients={linkedClients} onLoadDepartments={loadDepartments} onAssign={assignItems} />
    ) : null,
    rules: (
      <div className="space-y-3">
        <div className={cardCls}>
          <h2 className="text-xs font-bold text-text">{s.rulesScope}</h2>
          <p className="text-[11px] text-muted">{s.addStandardHint}</p>
          <div className="flex flex-wrap gap-1.5">
            {service?.standards.length === 0 && <span className="text-[11px] text-muted">{s.noStandards}</span>}
            {service?.standards.map((ref) => (
              <span key={ref.id} dir="ltr" className="px-2 py-1 rounded-full text-[10px] font-bold bg-surface-3 border border-border-strong text-text">{ref.code}</span>
            ))}
          </div>
          <p className="text-[11px] text-muted">{s.clientsUnit}: <bdi dir="ltr">{linkedClients.length}</bdi></p>
        </div>
        <div className={cardCls}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xs font-bold text-text">{s.rulesItems}</h2>
            <input type="search" value={rulesQuery} onChange={(e) => setRulesQuery(e.target.value)} placeholder={s.rulesFilterPh} aria-label={s.rulesFilterPh} className={`${FIELD_CLS} w-48`} />
          </div>
          <ul className="space-y-1.5 max-h-96 overflow-y-auto pe-1">
            {ruleRows.slice(0, RULES_LIMIT).map((item) => (
              <li key={item.id} className="p-2 rounded-xl bg-surface-3 border border-border">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span dir="ltr" className="text-[10px] font-extrabold text-info">{item.code}</span>
                  <select value={ruleDrafts[item.id] ?? item.answer_type} aria-label={`${s.itemAnswerType}: ${item.code}`}
                    onChange={(e) => setRuleDrafts({ ...ruleDrafts, [item.id]: e.target.value })} className={`${FIELD_CLS} w-32`}>
                    {ANSWER_TYPES.map((value) => <option key={value} value={value}>{t.common[value]}</option>)}
                  </select>
                </div>
                <p className="text-[11px] text-text break-words mt-1" dir="auto">{item.requirement}</p>
                <p className="text-[10px] mt-1">
                  <span className={`px-1.5 py-0.5 rounded-full ${item.attachment_required ? 'bg-warning-soft text-warning-text' : 'bg-surface-2 text-muted'}`}>
                    {item.attachment_required ? s.attachmentRequired : s.attachmentNotRequired}
                  </span>{' '}<span className="text-muted">{s.attachmentReadOnly}</span>
                </p>
              </li>
            ))}
          </ul>
          {contentItems.length === 0 && <p className="text-[11px] text-muted">{s.noItems}</p>}
          {ruleRows.length > RULES_LIMIT && (
            <p className="text-[10px] text-muted">{s.rulesShownOf.replace('{shown}', String(RULES_LIMIT)).replace('{total}', String(ruleRows.length))}</p>
          )}
          <div className="flex items-center gap-2">
            <button type="button" disabled={busy} onClick={() => void saveRules()} className={primaryBtn}>
              <Save className="w-3.5 h-3.5" /><span>{s.rulesSave}</span>
            </button>
            <p className="text-[10px] text-muted">{s.rulesAnswerHint}</p>
          </div>
        </div>
      </div>
    ),
    settings: (
      <div className="space-y-3">
        <div className={cardCls}>
          <h2 className="text-xs font-bold text-text">{s.identityTitle}</h2>
          <label className="block text-[10px] font-semibold text-text">{t.services.codeLabel}
            <input value={service?.code ?? ''} readOnly dir="ltr" className={`${inputCls} mt-1 opacity-70`} /></label>
          <label className="block text-[10px] font-semibold text-text">{t.services.nameLabel}
            <input value={identity.name} onChange={(e) => setIdentity({ ...identity, name: e.target.value })} className={`${inputCls} mt-1`} /></label>
          <label className="block text-[10px] font-semibold text-text">{t.services.descLabel}
            <textarea value={identity.description} onChange={(e) => setIdentity({ ...identity, description: e.target.value })} rows={2} dir="auto" className={`${inputCls} mt-1`} /></label>
          <button type="button" disabled={busy} onClick={() => void saveIdentity()} className={primaryBtn}>
            <Save className="w-3.5 h-3.5" /><span>{s.identitySave}</span></button>
        </div>
        <div className={cardCls}>
          <h2 className="text-xs font-bold text-text">{s.jsonSettingsTitle}</h2>
          <p className="text-[11px] text-muted">{s.settingsHint}</p>
          <textarea value={settingsText} onChange={(e) => setSettingsText(e.target.value)} rows={5} dir="ltr" spellCheck={false} placeholder="{ }" className={`${inputCls} font-mono`} />
          {settingsEcho && <pre dir="ltr" className="p-2 rounded-xl bg-surface-3 border border-border text-[10px] text-text overflow-x-auto">{s.settingsEcho}{'\n'}{settingsEcho}</pre>}
          <button type="button" disabled={busy || !settingsText.trim()} onClick={() => void saveSettings()} className={secondaryBtn}>
            <Save className="w-3.5 h-3.5" /><span>{s.settingsSave}</span></button>
        </div>
      </div>
    ),
    import: (
      <div className={cardCls}>
        <h2 className="text-xs font-bold text-text">{s.importTitle}</h2>
        <p className="text-[11px] text-muted" dir="auto">{s.importFormats}</p>
        {linkedClients.length === 0 ? (
          <div className="p-4 rounded-xl bg-warning-soft border border-warning text-[11px] text-warning-text space-y-1">
            <p className="font-bold">{s.importNoClient}</p><p>{s.importNoClientHint}</p>
          </div>
        ) : (
          <>
            <label className="block text-[10px] font-semibold text-text">{s.importTarget}
              <select value={importClientId} onChange={(e) => setImportClientId(e.target.value)} className={`${inputCls} mt-1`}>
                <option value="">—</option>{linkedClients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select></label>
            <label className="flex flex-col items-center justify-center gap-1.5 p-5 rounded-2xl border border-dashed border-border-strong bg-surface-3 text-center cursor-pointer hover:bg-surface-2">
              <UploadCloud className="w-6 h-6 text-brand-text" />
              <span className="text-[11px] font-bold text-text flex items-center gap-1.5"><FileSpreadsheet className="w-3.5 h-3.5" />{s.importDrop}</span>
              <span dir="ltr" className="text-[10px] text-muted">{importFile ? importFile.name : '.xlsx / .csv'}</span>
              <input type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={(e) => { setImportFile(e.target.files?.[0] ?? null); setPreview(null); setImportMsg(null); }} />
            </label>
            {!preview ? (
              <button type="button" disabled={!importFile || busy} onClick={() => void previewImport()} className={primaryBtn}>{busy ? s.importPreviewing : s.importPreview}</button>
            ) : (
              <div className="p-3 rounded-xl bg-surface-3 border border-border space-y-2">
                <p className="text-[11px] font-bold text-text">{s.importConfirm.replace('{service}', service?.name ?? '').replace('{client}', linkedClients.find((c) => c.id === importClientId)?.name ?? '—')}</p>
                <p className="text-[10px] text-muted" dir="ltr">{preview.summary.totalStandards} / {preview.summary.totalDisclosures} / {preview.summary.totalItems}</p>
                {(preview.errors.length > 0 || preview.warnings.length > 0) && (
                  <p className="text-[10px] text-warning-text flex items-start gap-1"><AlertTriangle className="w-3 h-3 shrink-0" />{[...preview.errors, ...preview.warnings].join(' · ')}</p>
                )}
                <button type="button" disabled={!importClientId || busy} onClick={() => void commitImport()} className={primaryBtn}>{busy ? s.importing : s.importConfirmAction}</button>
              </div>
            )}
            {importMsg && <p role="status" className="text-[11px] font-bold text-success-text">{importMsg}</p>}
          </>
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
