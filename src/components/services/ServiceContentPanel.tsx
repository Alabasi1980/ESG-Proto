import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Link2, Pencil, Plus, Save, Search, Unlink, Users, X } from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext.tsx';
import type { ServiceRow, ServiceStandardRef } from './ServiceRail.tsx';
/**
 * TASK-PROTO-U4-2 §2 — the content tab (three-level drill + detail side panel).
 *
 * WHY a component: the drill is pure presentation over data the view already
 * fetched. It owns only *interaction* state (open level, search box, inline add
 * drafts, bulk selection) and reports every write upward; the view owns the
 * fetch, the tab and the authoritative refresh.
 */
export interface ItemRow {
  id: string; disclosure_id: string; code: string; requirement: string; answer_type: string; hint: string | null;
  priority: string; esg_class: string; weight: number; objective: string | null; topic: string | null;
  reference: string | null; attachment_required?: boolean; disclosure_code?: string; standard_code?: string;
}
export interface DisclosureNode { id: string; code: string; title: string; description: string | null; items: ItemRow[]; }
export interface StandardNode { id: string; code: string; title: string; disclosures: DisclosureNode[]; }
export interface NewItemInput { code: string; requirement: string; answerType: string; priority: string; }
export interface ItemPatch {
  requirement?: string; hint?: string; answerType?: string; priority?: string;
  esgClass?: string; objective?: string; topic?: string; reference?: string;
}
export interface EligibleClient { id: string; name: string; }
export interface DepartmentOption { id: string; name: string; }
/** Case-insensitive match over any of the given fields (codes included). */
export function matches(query: string, ...fields: Array<string | null | undefined>): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((field) => typeof field === 'string' && field.toLowerCase().includes(q));
}
/** Search inside the CURRENT level only (standards → disclosures → items). */
export function filterStandardNodes(nodes: StandardNode[], query: string): StandardNode[] {
  const q = query.trim();
  return q ? nodes.filter((node) => matches(q, node.code, node.title)) : nodes;
}
/** P2-07: true when the editor holds edits the server has not confirmed yet. */
export function draftIsDirty(item: ItemRow, draft: ItemPatch): boolean {
  return (draft.requirement ?? '') !== item.requirement
    || (draft.hint ?? '') !== (item.hint ?? '')
    || (draft.answerType ?? '') !== item.answer_type
    || (draft.priority ?? '') !== item.priority
    || (draft.esgClass ?? '') !== item.esg_class
    || (draft.objective ?? '') !== (item.objective ?? '')
    || (draft.topic ?? '') !== (item.topic ?? '')
    || (draft.reference ?? '') !== (item.reference ?? '');
}
export const ANSWER_TYPES = ['text', 'number', 'boolean', 'date', 'file'] as const;
export const PRIORITIES = ['high', 'mid', 'low'] as const;
export const ESG_CLASSES = ['environmental', 'social', 'governance', 'general'] as const;
/** Field look without a width: P1-03 — `w-full` inside a base class beats every
 * explicit `w-*` (CSS order), so widths are only ever applied next to this. */
export const FIELD_CLS =
  'px-3 py-2 rounded-xl text-xs bg-surface-3 border border-border-strong text-text placeholder-muted focus:outline-none focus:border-focus-ring focus:ring-2 focus:ring-focus-ring/30';
const inputCls = `w-full ${FIELD_CLS}`;
const secondaryBtn =
  'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold bg-surface-2 border border-border-strong text-text hover:bg-surface-3 focus:outline-none focus:ring-2 focus:ring-focus-ring/30';
const primaryBtn = 'px-3 py-2 rounded-xl text-[11px] font-bold bg-brand text-brand-ink hover:bg-brand-strong disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-focus-ring/40';
const rowBtn = 'min-w-0 flex-1 text-start rounded-lg focus:outline-none focus:ring-2 focus:ring-focus-ring/30';
const codeChip = 'text-[10px] font-extrabold px-1.5 py-0.5 rounded-md bg-surface-2 border border-border-strong text-muted';

interface ContentPanelProps {
  service: ServiceRow;
  nodes: StandardNode[];
  catalogue: ServiceStandardRef[];
  busy: boolean;
  onLinkStandard: (standardId: string) => Promise<boolean>;
  onUnlinkStandard: (standardId: string) => Promise<boolean>;
  onCreateItem: (disclosureId: string, input: NewItemInput) => Promise<boolean>;
  onSaveItem: (itemId: string, patch: ItemPatch) => Promise<boolean>;
  clients: EligibleClient[];
  onLoadDepartments: (clientId: string) => Promise<DepartmentOption[]>;
  onAssign: (clientId: string, departmentId: string, itemIds: string[]) => Promise<number>;
}
export const ServiceContentPanel: React.FC<ContentPanelProps> = ({
  service, nodes, catalogue, busy, onLinkStandard, onUnlinkStandard, onCreateItem,
  onSaveItem, clients, onLoadDepartments, onAssign,
}) => {
  const { t } = useLanguage();
  const s = t.servicesWorkspace;
  const [query, setQuery] = useState('');
  const [openStandardId, setOpenStandardId] = useState<string | null>(null);
  const [openDisclosureId, setOpenDisclosureId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newItem, setNewItem] = useState<NewItemInput>({ code: '', requirement: '', answerType: 'text', priority: 'mid' });
  const [draft, setDraft] = useState<ItemPatch | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [assignClientId, setAssignClientId] = useState('');
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [assignDepartmentId, setAssignDepartmentId] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [standardToLink, setStandardToLink] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  // The drill resets when the rail selects another service (no stale ids).
  useEffect(() => {
    setQuery(''); setOpenStandardId(null); setOpenDisclosureId(null); setSelectedItemId(null);
    setAddOpen(false); setChecked([]); setAssignClientId(''); setAssignDepartmentId(''); setNotice(null);
    setLinkPickerOpen(false);
  }, [service.id]);
  const standard = nodes.find((node) => node.id === openStandardId) ?? null;
  const disclosure = standard?.disclosures.find((node) => node.id === openDisclosureId) ?? null;
  const level: 'standards' | 'disclosures' | 'items' = disclosure ? 'items' : standard ? 'disclosures' : 'standards';
  const visibleStandards = useMemo(() => filterStandardNodes(nodes, level === 'standards' ? query : ''), [nodes, query, level]);
  const visibleDisclosures = useMemo(() => (standard ? standard.disclosures.filter((d) => matches(query, d.code, d.title)) : []), [standard, query]);
  const visibleItems = useMemo(() => (disclosure ? disclosure.items.filter((i) => matches(query, i.code, i.requirement)) : []), [disclosure, query]);
  const selectedItem = disclosure?.items.find((item) => item.id === selectedItemId) ?? null;
  const linkable = catalogue.filter((ref) => !service.standards.some((ref2) => ref2.id === ref.id));
  // The editor always starts from the persisted row (never a stale draft).
  useEffect(() => {
    setDraft(selectedItem ? {
      requirement: selectedItem.requirement, hint: selectedItem.hint ?? '', answerType: selectedItem.answer_type,
      priority: selectedItem.priority, esgClass: selectedItem.esg_class, objective: selectedItem.objective ?? '',
      topic: selectedItem.topic ?? '', reference: selectedItem.reference ?? '',
    } : null);
  }, [selectedItemId, selectedItem]);
  const dirty = Boolean(selectedItem && draft && draftIsDirty(selectedItem, draft));
  const panelMounted = Boolean(selectedItemId && selectedItem && draft);
  /** P2-07: leaving the editor with pending edits asks first; the draft never
   * disappears silently. */
  const leaveEditor = (): boolean => !dirty || window.confirm(s.discardDraft);
  const closePanel = () => { if (leaveEditor()) setSelectedItemId(null); };
  const openItem = (id: string) => {
    if (id === selectedItemId || !leaveEditor()) return;
    triggerRef.current = document.activeElement as HTMLElement | null;
    setAddOpen(false); setSelectedItemId(id);
  };
  const goLevel = (apply: () => void) => { if (leaveEditor()) apply(); };
  // P1-02: below 2xl the panel is a modal dialog — focus moves in after the
  // editor is actually committed, Tab is trapped, Escape closes, and focus
  // returns to the row that opened it.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (!panelMounted) {
      wasOpen.current = false;
      if (!selectedItemId && triggerRef.current) { triggerRef.current.focus(); triggerRef.current = null; }
      return;
    }
    const focusables = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])') ?? []).filter((el) => !el.hasAttribute('disabled'));
    if (!wasOpen.current) { wasOpen.current = true; focusables()[0]?.focus(); }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { closePanel(); return; }
      if (event.key !== 'Tab' || !window.matchMedia('(max-width: 1535.98px)').matches) return;
      const list = focusables(); if (!list.length) return;
      const first = list[0]; const last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [panelMounted, selectedItemId, dirty]);
  const run = async (action: () => Promise<boolean>) => {
    setNotice(null);
    const ok = await action();
    setNotice({ ok, text: ok ? t.common.success : s.actionFailed });
    return ok;
  };
  const answerLabel = (value: string) => (ANSWER_TYPES as readonly string[]).includes(value) ? t.common[value as (typeof ANSWER_TYPES)[number]] : value;
  const crumbCls = (active: boolean) => `px-2 py-1 rounded-lg font-bold ${active ? 'bg-surface-3 text-text' : 'text-muted hover:bg-surface-3 focus:outline-none focus:ring-2 focus:ring-focus-ring/30'}`;
  const levelTitle = level === 'standards' ? s.levelStandards : level === 'disclosures' ? s.levelDisclosures : s.levelItems;
  const levelCount = level === 'standards' ? nodes.length : level === 'disclosures' ? (standard?.disclosures.length ?? 0) : (disclosure?.items.length ?? 0);
  const emptyBox = (title: string, hint: string, action?: React.ReactNode, note?: string) => (
    <div className="p-6 rounded-2xl bg-surface-3 border border-border text-center space-y-2">
      <p className="text-xs font-bold text-text">{title}</p>
      <p className="text-[11px] text-muted">{hint}</p>
      {note && <p className="text-[10px] text-muted">{note}</p>}
      {action && <div className="flex justify-center">{action}</div>}</div>
  );
  const saveDraft = async () => {
    if (!selectedItemId || !draft) return;
    if (!(draft.requirement ?? '').trim()) { setNotice({ ok: false, text: s.fieldRequired }); return; }
    await run(() => onSaveItem(selectedItemId, draft));
  };
  const submitNewItem = async () => {
    if (!disclosure) return;
    if (!newItem.code.trim() || !newItem.requirement.trim()) { setNotice({ ok: false, text: s.fieldRequired }); return; }
    if (await run(() => onCreateItem(disclosure.id, newItem))) { setNewItem({ code: '', requirement: '', answerType: 'text', priority: 'mid' }); setAddOpen(false); }
  };
  const pickClient = async (clientId: string) => {
    setAssignClientId(clientId); setAssignDepartmentId('');
    setDepartments(clientId ? await onLoadDepartments(clientId) : []);
  };
  const bulkAssign = async () => {
    if (!assignClientId || !assignDepartmentId || checked.length === 0) return;
    const count = await onAssign(assignClientId, assignDepartmentId, checked); setChecked([]);
    setNotice(count > 0 ? { ok: true, text: s.bulkDone.replace('{n}', String(count)) } : { ok: false, text: s.actionFailed });
  };
  // P2-14: unlinking removes content scope from the service and asks first.
  const unlink = async (id: string, code: string) => {
    if (!window.confirm(s.unlinkStandardConfirm.replace('{code}', code))) return;
    await run(() => onUnlinkStandard(id));
  };
  return (
    <div className="space-y-3">
      <nav aria-label={s.breadcrumbAll} className="flex flex-wrap items-center gap-1 text-[11px]">
        <button type="button" className={crumbCls(!standard)}
          onClick={() => goLevel(() => { setOpenStandardId(null); setOpenDisclosureId(null); setQuery(''); })}>{s.breadcrumbAll}</button>
        {standard && (
          <>
            <ArrowRight className="w-3 h-3 text-muted rtl:rotate-180" aria-hidden="true" />
            <button type="button" className={crumbCls(!disclosure)} dir="ltr"
              onClick={() => goLevel(() => { setOpenDisclosureId(null); setSelectedItemId(null); setQuery(''); })}>{standard.code}</button>
          </>
        )}
        {disclosure && (
          <>
            <ArrowRight className="w-3 h-3 text-muted rtl:rotate-180" aria-hidden="true" />
            <span className="px-2 py-1 font-bold text-text" dir="ltr">{disclosure.code}</span>
          </>
        )}
      </nav>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-text">{levelTitle} <span className="text-[11px] font-semibold text-muted" dir="ltr">({levelCount})</span></h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative shrink-0">
            <Search className="w-3.5 h-3.5 text-muted absolute top-2.5 start-2.5 pointer-events-none" />
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label={s.searchLevelPh}
              placeholder={s.searchLevelPh} className={`${FIELD_CLS} ps-8 w-48`} />
          </div>
          {level === 'standards' && (
            <button type="button" onClick={() => setLinkPickerOpen(!linkPickerOpen)} className={secondaryBtn}>
              <Link2 className="w-3.5 h-3.5" /><span>{s.addStandard}</span>
            </button>
          )}
          {level === 'items' && (
            <button type="button" className={secondaryBtn}
              onClick={() => { if (!addOpen && !leaveEditor()) return; if (!addOpen) setSelectedItemId(null); setAddOpen(!addOpen); }}>
              <Plus className="w-3.5 h-3.5" /><span>{t.taxonomy.addItemButton}</span>
            </button>
          )}
        </div>
      </div>
      {notice && (
        <p role="status" className={`p-2.5 rounded-xl border text-[11px] ${notice.ok ? 'bg-success-soft border-success text-success-text' : 'bg-danger-soft border-danger text-danger'}`}>
          {notice.text}
        </p>
      )}
      {busy && <p role="status" className="text-[11px] text-muted">{t.common.loading}</p>}
      {level === 'standards' && linkPickerOpen && (
        <div className="p-3 rounded-xl bg-surface-3 border border-border flex flex-wrap items-center gap-2">
          <select value={standardToLink} onChange={(e) => setStandardToLink(e.target.value)} aria-label={s.addStandard}
            className={`${FIELD_CLS} flex-1 min-w-48`}>
            <option value="">—</option>
            {linkable.map((ref) => <option key={ref.id} value={ref.id}>{ref.code} — {ref.title}</option>)}
          </select>
          <button type="button" disabled={!standardToLink || busy} className={primaryBtn}
            onClick={async () => { if (await run(() => onLinkStandard(standardToLink))) { setStandardToLink(''); setLinkPickerOpen(false); } }}>
            {t.services.linkButton}
          </button>
          <p className="w-full text-[10px] text-muted">{s.addStandardHint}</p>
        </div>
      )}
      {level === 'items' && addOpen && (
        <div className="p-3 rounded-xl bg-surface-3 border border-border grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input value={newItem.code} onChange={(e) => setNewItem({ ...newItem, code: e.target.value })} placeholder={t.taxonomy.codePh} dir="ltr" className={inputCls} />
          <input value={newItem.requirement} onChange={(e) => setNewItem({ ...newItem, requirement: e.target.value })} placeholder={t.taxonomy.requirementPh} dir="auto" className={inputCls} />
          <select value={newItem.answerType} onChange={(e) => setNewItem({ ...newItem, answerType: e.target.value })} aria-label={s.itemAnswerType} className={inputCls}>
            {ANSWER_TYPES.map((value) => <option key={value} value={value}>{t.common[value]}</option>)}</select>
          <select value={newItem.priority} onChange={(e) => setNewItem({ ...newItem, priority: e.target.value })} aria-label={s.itemPriority} className={inputCls}>
            {PRIORITIES.map((value) => <option key={value} value={value}>{t.common[value]}</option>)}</select>
          <div className="sm:col-span-2 flex items-center gap-2">
            <button type="button" disabled={busy} onClick={() => void submitNewItem()} className={primaryBtn}>{t.taxonomy.addItemButton}</button>
            <button type="button" onClick={() => setAddOpen(false)} className={secondaryBtn}>{t.common.cancel}</button>
          </div>
        </div>
      )}
      <div className={`grid grid-cols-1 gap-3 items-start ${selectedItem ? '2xl:grid-cols-[minmax(0,1fr)_380px]' : ''}`}>
        <div className="space-y-2">
          {level === 'standards' && visibleStandards.length === 0 &&
            emptyBox(query.trim() ? s.emptySearch : s.noStandards, s.noStandardsHint,
              !query.trim() && linkable.length > 0 ? <button type="button" className={primaryBtn} onClick={() => setLinkPickerOpen(true)}>{s.addStandard}</button> : undefined)}
          {level === 'standards' && visibleStandards.map((node) => (
            <div key={node.id} className="flex items-start gap-2 p-2.5 rounded-xl bg-surface-3 border border-border">
              <button type="button" onClick={() => { setOpenStandardId(node.id); setQuery(''); }} className={rowBtn}>
                <span className="flex flex-wrap items-center gap-2"><span dir="ltr" className={codeChip}>{node.code}</span><span className="text-xs font-bold text-text break-words">{node.title}</span></span>
                <span className="block mt-1 text-[10px] text-muted">
                  {s.levelDisclosures} <span dir="ltr">{node.disclosures.length}</span>{' · '}{s.levelItems} <span dir="ltr">{node.disclosures.reduce((sum, d) => sum + d.items.length, 0)}</span>
                </span>
              </button>
              <button type="button" title={t.services.unlinkButton} aria-label={`${t.services.unlinkButton}: ${node.code}`} onClick={() => void unlink(node.id, node.code)}
                className="p-1.5 rounded-lg border border-border-strong text-muted hover:bg-surface-2 hover:text-danger focus:outline-none focus:ring-2 focus:ring-focus-ring/30">
                <Unlink className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {level === 'disclosures' && visibleDisclosures.length === 0 &&
            emptyBox(query.trim() ? s.emptySearch : s.noDisclosures, s.noDisclosuresHint, undefined, s.disclosureImportNote)}
          {level === 'disclosures' && visibleDisclosures.map((node) => (
            <button key={node.id} type="button" onClick={() => { setOpenDisclosureId(node.id); setQuery(''); }}
              className="w-full text-start p-2.5 rounded-xl bg-surface-3 border border-border hover:bg-surface-2 focus:outline-none focus:ring-2 focus:ring-focus-ring/30">
              <span className="flex flex-wrap items-center gap-2">
                <span dir="ltr" className={codeChip}>{node.code}</span>
                <span className="text-xs font-bold text-text break-words" dir="auto">{node.title}</span>
              </span>
              <span className="block mt-1 text-[10px] text-muted" dir="auto">{s.levelItems} <span dir="ltr">{node.items.length}</span>{node.description ? ` · ${node.description}` : ''}</span>
            </button>
          ))}
          {level === 'items' && visibleItems.length === 0 &&
            emptyBox(query.trim() ? s.emptySearch : s.noItems, s.noItemsHint,
              !query.trim() ? <button type="button" className={primaryBtn} onClick={() => setAddOpen(true)}>{t.taxonomy.addItemButton}</button> : undefined)}
          {level === 'items' && visibleItems.map((item) => {
            const open = item.id === selectedItemId;
            return (
              <div key={item.id} className={`flex items-start gap-2 p-2.5 rounded-xl border ${open ? 'border-brand bg-brand-soft' : 'border-border bg-surface-3'}`}>
                <input type="checkbox" checked={checked.includes(item.id)} aria-label={item.code}
                  onChange={() => setChecked(checked.includes(item.id) ? checked.filter((id) => id !== item.id) : [...checked, item.id])}
                  className="mt-1 w-3.5 h-3.5 accent-brand focus:outline-none focus:ring-2 focus:ring-focus-ring/40" />
                <button type="button" onClick={() => openItem(item.id)} className={rowBtn}
                  aria-expanded={open} aria-controls={open ? 'svc-item-panel' : undefined}>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span dir="ltr" className="text-[10px] font-extrabold text-info">{item.code}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-2 text-muted">{answerLabel(item.answer_type)}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${item.attachment_required ? 'bg-warning-soft text-warning-text' : 'bg-surface-2 text-muted'}`}>
                      {item.attachment_required ? s.attachmentRequired : s.attachmentNotRequired}
                    </span>
                  </span>
                  <span className="block mt-1 text-xs text-text break-words" dir="auto">{item.requirement}</span>
                </button>
                <button type="button" onClick={() => openItem(item.id)} title={s.itemDetail} aria-label={s.itemDetail}
                  className="p-1.5 rounded-lg border border-border-strong text-muted hover:bg-surface-2 focus:outline-none focus:ring-2 focus:ring-focus-ring/30">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
          {level === 'items' && checked.length > 0 && (
            <div className="p-3 rounded-xl bg-brand-soft border border-brand space-y-2">
              <p className="text-[11px] font-bold text-text flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" /><span>{s.selectedCount.replace('{n}', String(checked.length))}</span>
              </p>
              {clients.length === 0 ? <p className="text-[11px] text-muted">{s.bulkNoClients}</p> : (
                <div className="flex flex-wrap items-end gap-2">
                  <select value={assignClientId} onChange={(e) => void pickClient(e.target.value)} aria-label={s.bulkClient} className={`${FIELD_CLS} flex-1 min-w-40`}>
                    <option value="">{s.bulkClient}</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
                  </select>
                  <select value={assignDepartmentId} onChange={(e) => setAssignDepartmentId(e.target.value)} aria-label={s.bulkDepartment}
                    disabled={!assignClientId} className={`${FIELD_CLS} flex-1 min-w-40 disabled:opacity-50`}>
                    <option value="">{s.bulkDepartment}</option>{departments.map((dept) => <option key={dept.id} value={dept.id}>{dept.name}</option>)}
                  </select>
                  <button type="button" disabled={!assignDepartmentId || busy} onClick={() => void bulkAssign()} className={primaryBtn}>{s.bulkAssign}</button>
                </div>
              )}
            </div>
          )}
        </div>
        {selectedItem && draft && (
          <>
            <div className="2xl:hidden fixed inset-0 z-40 bg-black/50" aria-hidden="true" onClick={closePanel} />
            <aside id="svc-item-panel" ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${s.itemDetail}: ${selectedItem.code}`}
              className="fixed inset-y-0 end-0 z-50 w-full max-w-md overflow-y-auto bg-surface-2 border-s border-border p-4 space-y-2 shadow-[var(--shadow)] focus:outline-none 2xl:static 2xl:z-auto 2xl:w-auto 2xl:max-w-none 2xl:overflow-visible 2xl:rounded-2xl 2xl:border 2xl:border-border 2xl:p-3 2xl:sticky 2xl:top-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><h4 className="text-xs font-bold text-text">{s.itemDetail}</h4>
                  <p dir="ltr" className="text-[10px] font-extrabold text-info break-all">{selectedItem.code}</p></div>
                <div className="flex items-center gap-2">
                  {dirty && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-warning-soft text-warning-text">{s.dirtyDraft}</span>}
                  <button type="button" onClick={closePanel} aria-label={t.common.close} className="p-1 rounded-lg text-muted hover:bg-surface-3 focus:outline-none focus:ring-2 focus:ring-focus-ring/30"><X className="w-3.5 h-3.5" /></button>
                </div>
              </div>
              <label className="block text-[10px] font-semibold text-text">{s.itemRequirement}
                <textarea value={draft.requirement ?? ''} onChange={(e) => setDraft({ ...draft, requirement: e.target.value })} rows={5} dir="auto" className={`${inputCls} mt-1`} /></label>
              <label className="block text-[10px] font-semibold text-text">{s.itemHint}
                <textarea value={draft.hint ?? ''} onChange={(e) => setDraft({ ...draft, hint: e.target.value })} rows={3} dir="auto" className={`${inputCls} mt-1`} /></label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-[10px] font-semibold text-text">{s.itemAnswerType}
                  <select value={draft.answerType ?? 'text'} onChange={(e) => setDraft({ ...draft, answerType: e.target.value })} className={`${inputCls} mt-1`}>
                    {ANSWER_TYPES.map((value) => <option key={value} value={value}>{t.common[value]}</option>)}
                  </select></label>
                <label className="block text-[10px] font-semibold text-text">{s.itemPriority}
                  <select value={draft.priority ?? 'mid'} onChange={(e) => setDraft({ ...draft, priority: e.target.value })} className={`${inputCls} mt-1`}>
                    {PRIORITIES.map((value) => <option key={value} value={value}>{t.common[value]}</option>)}
                  </select></label>
              </div>
              <label className="block text-[10px] font-semibold text-text">{s.itemEsgClass}
                <select value={draft.esgClass ?? 'general'} onChange={(e) => setDraft({ ...draft, esgClass: e.target.value })} className={`${inputCls} mt-1`}>
                  {ESG_CLASSES.map((value) => <option key={value} value={value}>{value}</option>)}
                </select></label>
              <p className="text-[10px] text-muted flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3" />
                <span>{selectedItem.attachment_required ? s.attachmentRequired : s.attachmentNotRequired} — {s.attachmentReadOnly}</span></p>
              <div className="flex items-center gap-2">
                <button type="button" disabled={busy} onClick={() => void saveDraft()} className={`${primaryBtn} flex-1 inline-flex items-center justify-center gap-1.5`}><Save className="w-3.5 h-3.5" /><span>{t.common.save}</span></button>
                <button type="button" onClick={closePanel} className={secondaryBtn}>{t.common.close}</button>
              </div>
              <p className="text-[10px] text-muted">{s.codeImmutable}</p>
              {!service.standards.length && (
                <p className="text-[10px] text-warning-text flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{s.noStandardsHint}</p>
              )}
            </aside>
          </>
        )}
      </div>
    </div>
  );
};
