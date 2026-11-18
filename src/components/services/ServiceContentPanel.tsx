import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, History, Link2, Pencil, Plus, Save, Search, Trash2, Unlink, Users, X } from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext.tsx';
import type { ServiceRow, ServiceStandardRef } from './ServiceRail.tsx';
/**
 * TASK-PROTO-U4-2-FIX P5 §UI-2 — the content tab (flexible levels + full CRUD).
 *
 * Tree root for one service = ordered union of linked standards →
 * disclosures → items, group disclosures (standard category 'group',
 * rendered "مجموعة / Group") and direct items (the GENERAL disclosure,
 * rendered "بنود مباشرة / Direct items"). Item details open in the side
 * panel (drawer < 2xl, sticky ≥ 2xl) — details are never a tree level.
 *
 * WHY a component: the drill is pure presentation over data the view already
 * fetched. It owns only *interaction* state (open level, search box, inline
 * drafts, bulk selection) and reports every write upward; the view owns the
 * fetch, the tab and the authoritative refresh.
 */
export interface ItemRow {
  id: string; disclosure_id: string; code: string; requirement: string; answer_type: string; hint: string | null;
  priority: string; esg_class: string; weight: number; objective: string | null; topic: string | null;
  reference: string | null; attachment_required?: boolean; disclosure_code?: string; standard_code?: string;
  version?: number; status?: string; department_id?: string | null;
  archived_at?: string | null; archive_reason?: string | null;
}
export interface DisclosureNode { id: string; code: string; title: string; description: string | null; items: ItemRow[]; }
export interface StandardNode { id: string; code: string; title: string; disclosures: DisclosureNode[]; }
/** P5: a group = one disclosure under a group-category standard. */
export interface GroupNode {
  id: string; code: string; title: string; description: string | null;
  standardId: string; standardCode: string; items: ItemRow[];
}
export interface NewItemInput {
  code: string; requirement: string; answerType: string; priority: string;
  esgClass?: string; departmentId?: string | null; attachmentRequired?: boolean;
  hint?: string | null; objective?: string | null; topic?: string | null; reference?: string | null;
}
export interface ItemPatch {
  requirement?: string; hint?: string; answerType?: string; priority?: string;
  esgClass?: string; objective?: string; topic?: string; reference?: string;
  departmentId?: string | null; expectedVersion?: number; reason?: string | null;
}
export interface BulkPatch { answerType?: string; priority?: string; esgClass?: string; attachment_required?: boolean; }
export interface BulkRowResult { id: string; ok: boolean; error?: string; code?: string; version?: number; }
export interface ItemHistoryVersion { version: number; snapshot: Record<string, unknown>; changedBy: string | null; changedAt: string; reason: string | null; }
export interface ItemHistory { versions: ItemHistoryVersion[]; answersSummary: Array<{ status: string; count: number }>; }
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
    || (draft.reference ?? '') !== (item.reference ?? '')
    || (draft.departmentId ?? null) !== (item.department_id ?? null);
}
/** P5 DG-04: reopened answers are status-only (counts by status, never values). */
export function historyReopenedCount(history: ItemHistory | null): number {
  if (!history) return 0;
  return history.answersSummary
    .filter((row) => row.status === 'reopened')
    .reduce((sum, row) => sum + (Number(row.count) || 0), 0);
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
const dangerBtn = 'px-3 py-2 rounded-xl text-[11px] font-bold bg-danger-soft text-danger border border-danger hover:bg-surface-3 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-focus-ring/40';
const rowBtn = 'min-w-0 flex-1 text-start rounded-lg focus:outline-none focus:ring-2 focus:ring-focus-ring/30';
const codeChip = 'text-[10px] font-extrabold px-1.5 py-0.5 rounded-md bg-surface-2 border border-border-strong text-muted';

interface ContentPanelProps {
  service: ServiceRow;
  nodes: StandardNode[];
  groups: GroupNode[];
  direct: ItemRow[];
  archived: ItemRow[];
  catalogue: ServiceStandardRef[];
  categories: Record<string, string>;
  busy: boolean;
  frozen: boolean;
  departments: DepartmentOption[];
  groupStandardCode: string;
  directDisclosureId: string | null;
  onLinkStandard: (standardId: string) => Promise<boolean>;
  onUnlinkStandard: (standardId: string) => Promise<boolean>;
  onCreateStandard: (input: { code: string; title: string; category: string }) => Promise<string | null>;
  onUpdateStandard: (id: string, patch: { title?: string; category?: string }) => Promise<boolean>;
  onDeleteStandard: (id: string) => Promise<boolean>;
  onCreateDisclosure: (standardId: string, input: { code: string; title: string; description?: string | null }) => Promise<boolean>;
  onUpdateDisclosure: (id: string, patch: { title?: string; description?: string | null }) => Promise<boolean>;
  onDeleteDisclosure: (id: string) => Promise<boolean>;
  onCreateItem: (disclosureId: string, input: NewItemInput) => Promise<boolean>;
  onSaveItem: (itemId: string, patch: ItemPatch) => Promise<number | 'conflict' | null>;
  onDeleteItem: (itemId: string, reason: string | null) => Promise<'archived' | 'deleted' | null>;
  onBulkEdit: (ids: string[], patch: BulkPatch, expectedVersions: Record<string, number>) => Promise<BulkRowResult[] | null>;
  onFetchHistory: (itemId: string) => Promise<ItemHistory | null>;
  onReload: () => void;
}
export const ServiceContentPanel: React.FC<ContentPanelProps> = ({
  service, nodes, groups, direct, archived, catalogue, categories, busy, frozen, departments,
  groupStandardCode, directDisclosureId, onLinkStandard, onUnlinkStandard,
  onCreateStandard, onUpdateStandard, onDeleteStandard,
  onCreateDisclosure, onUpdateDisclosure, onDeleteDisclosure,
  onCreateItem, onSaveItem, onDeleteItem, onBulkEdit, onFetchHistory, onReload,
}) => {
  const { t } = useLanguage();
  const s = t.servicesWorkspace;
  const [query, setQuery] = useState('');
  const [openStandardId, setOpenStandardId] = useState<string | null>(null);
  const [openDisclosureId, setOpenDisclosureId] = useState<string | null>(null);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [directOpen, setDirectOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newItem, setNewItem] = useState<NewItemInput & { departmentId?: string | null }>({ code: '', requirement: '', answerType: 'text', priority: 'mid' });
  const [draft, setDraft] = useState<ItemPatch | null>(null);
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  const [saveConflict, setSaveConflict] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const [bulk, setBulk] = useState<BulkPatch>({});
  const [bulkAttach, setBulkAttach] = useState<'unset' | 'true' | 'false'>('unset');
  const [bulkResults, setBulkResults] = useState<BulkRowResult[] | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [history, setHistory] = useState<ItemHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [standardToLink, setStandardToLink] = useState('');
  const [stdDialog, setStdDialog] = useState<{ code: string; title: string; category: string } | null>(null);
  const [stdEdit, setStdEdit] = useState<{ id: string; title: string; category: string } | null>(null);
  const [discDialog, setDiscDialog] = useState<{ standardId: string; code: string; title: string; description: string } | null>(null);
  const [discEdit, setDiscEdit] = useState<{ id: string; title: string; description: string } | null>(null);
  const [groupDialog, setGroupDialog] = useState<{ code: string; title: string; description: string; parent: string } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  // The drill resets when the rail selects another service (no stale ids).
  useEffect(() => {
    setQuery(''); setOpenStandardId(null); setOpenDisclosureId(null); setOpenGroupId(null);
    setDirectOpen(false); setShowArchived(false); setSelectedItemId(null);
    setAddOpen(false); setChecked([]); setBulk({}); setBulkAttach('unset'); setBulkResults(null);
    setConfirmDeleteId(null); setDeleteReason(''); setHistory(null); setNotice(null);
    setLinkPickerOpen(false); setStdDialog(null); setStdEdit(null);
    setDiscDialog(null); setDiscEdit(null); setGroupDialog(null); setSaveConflict(false);
  }, [service.id]);
  const standard = nodes.find((node) => node.id === openStandardId) ?? null;
  const groupStandards = useMemo(
    () => catalogue.filter((ref) => (categories[ref.id] ?? '').trim().toLowerCase() === 'group'
      && service.standards.some((linked) => linked.id === ref.id)),
    [catalogue, categories, service],
  );
  const disclosure = standard?.disclosures.find((node) => node.id === openDisclosureId) ?? null;
  const group = groups.find((node) => node.id === openGroupId) ?? null;
  const containerItems = disclosure ? disclosure.items : group ? group.items : directOpen ? direct : [];
  const level: 'standards' | 'disclosures' | 'items' = containerItems.length > 0 || disclosure || group || directOpen ? 'items' : standard ? 'disclosures' : 'standards';
  const visibleStandards = useMemo(() => filterStandardNodes(nodes, level === 'standards' ? query : ''), [nodes, query, level]);
  const visibleGroups = useMemo(() => (level === 'standards' && !query.trim() ? groups : groups.filter((g) => matches(query, g.code, g.title))), [groups, query, level]);
  const visibleDirect = useMemo(() => (directOpen ? direct.filter((i) => matches(query, i.code, i.requirement)) : []), [direct, directOpen, query]);
  const visibleDisclosures = useMemo(() => (standard ? standard.disclosures.filter((d) => matches(query, d.code, d.title)) : []), [standard, query]);
  const visibleItems = useMemo(() => ((disclosure || group) ? containerItems.filter((i) => matches(query, i.code, i.requirement)) : visibleDirect), [disclosure, group, containerItems, visibleDirect, query]);
  const allActiveItems = useMemo(() => {
    const seen = new Map<string, ItemRow>();
    for (const list of [nodes.flatMap((n) => n.disclosures.flatMap((d) => d.items)), groups.flatMap((g) => g.items), direct]) {
      for (const item of list) if (!seen.has(item.id)) seen.set(item.id, item);
    }
    return [...seen.values()];
  }, [nodes, groups, direct]);
  const selectedItem = allActiveItems.find((item) => item.id === selectedItemId)
    ?? archived.find((item) => item.id === selectedItemId) ?? null;
  const selectedArchived = Boolean(selectedItem && selectedItem.status === 'archived');
  const linkable = catalogue.filter((ref) => !service.standards.some((ref2) => ref2.id === ref.id));
  // The editor always starts from the persisted row (never a stale draft).
  useEffect(() => {
    if (!selectedItemId) { setDraft(null); setBaseVersion(null); return; }
    const row = allActiveItems.find((item) => item.id === selectedItemId)
      ?? archived.find((item) => item.id === selectedItemId) ?? null;
    if (!row) { setDraft(null); return; }
    setDraft({
      requirement: row.requirement, hint: row.hint ?? '', answerType: row.answer_type,
      priority: row.priority, esgClass: row.esg_class, objective: row.objective ?? '',
      topic: row.topic ?? '', reference: row.reference ?? '',
      departmentId: row.department_id ?? null,
    });
    setBaseVersion(typeof row.version === 'number' ? row.version : null);
    setSaveConflict(false); setHistory(null); setHistoryError(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItemId]);
  // History loads with the drawer (versions + answers summary, E-4/G-3).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!selectedItemId) return;
      setHistoryLoading(true); setHistoryError(false);
      const data = await onFetchHistory(selectedItemId);
      if (!cancelled) {
        setHistory(data);
        setHistoryError(data === null);
        setHistoryLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItemId]);
  const dirty = Boolean(selectedItem && draft && !selectedArchived && draftIsDirty(selectedItem, draft));
  const panelMounted = Boolean(selectedItemId && selectedItem && draft);
  const reopened = historyReopenedCount(history);
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
  const levelCount = level === 'standards' ? nodes.length + groups.length + (direct.length > 0 ? 1 : 0) : level === 'disclosures' ? (standard?.disclosures.length ?? 0) : visibleItems.length;
  const writeTitle = frozen ? s.frozenScopeBanner : undefined;
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
    setSaveConflict(false);
    const outcome = await onSaveItem(selectedItemId, {
      ...draft, expectedVersion: baseVersion ?? undefined, reason: null,
    });
    if (outcome === 'conflict') { setSaveConflict(true); setNotice({ ok: false, text: s.saveConflictHint }); return; }
    if (typeof outcome === 'number') {
      setBaseVersion(outcome); setNotice({ ok: true, text: t.common.success });
    } else {
      setNotice({ ok: false, text: s.actionFailed });
    }
  };
  const submitNewItem = async (disclosureId: string) => {
    if (!newItem.code.trim() || !newItem.requirement.trim()) { setNotice({ ok: false, text: s.fieldRequired }); return; }
    if (await run(() => onCreateItem(disclosureId, {
      code: newItem.code.trim(), requirement: newItem.requirement.trim(),
      answerType: newItem.answerType, priority: newItem.priority,
      esgClass: 'general', departmentId: newItem.departmentId ?? null,
      hint: null, objective: null, topic: null, reference: null,
    }))) { setNewItem({ code: '', requirement: '', answerType: 'text', priority: 'mid' }); setAddOpen(false); }
  };
  const submitBulk = async () => {
    const patch: BulkPatch = { ...bulk };
    if (bulkAttach !== 'unset') patch.attachment_required = bulkAttach === 'true';
    if (Object.keys(patch).length === 0 || checked.length === 0) return;
    const expectedVersions: Record<string, number> = {};
    for (const id of checked) {
      const row = allActiveItems.find((item) => item.id === id);
      if (row && typeof row.version === 'number') expectedVersions[id] = row.version;
    }
    const results = await onBulkEdit(checked, patch, expectedVersions);
    setBulkResults(results);
    if (results) setChecked([]);
  };
  const askDeleteItem = (id: string) => { setConfirmDeleteId(id); setDeleteReason(''); };
  const confirmDeleteItem = async () => {
    if (!confirmDeleteId) return;
    const outcome = await onDeleteItem(confirmDeleteId, deleteReason.trim() || null);
    if (outcome) { setConfirmDeleteId(null); setDeleteReason(''); if (outcome === 'deleted') setSelectedItemId(null); }
  };
  // P2-14: unlinking removes content scope from the service and asks first.
  const unlink = async (id: string, code: string) => {
    if (!window.confirm(s.unlinkStandardConfirm.replace('{code}', code))) return;
    await run(() => onUnlinkStandard(id));
  };
  const deptName = (id: string | null | undefined) => departments.find((d) => d.id === id)?.name ?? null;
  const itemContainerId = disclosure ? disclosure.id : group ? group.id : directDisclosureId;
  const containerLabel = disclosure ? s.levelDisclosures : group ? s.contentGroup : s.contentDirect;
  return (
    <div className="space-y-3">
      {frozen && <p role="alert" className="p-2.5 rounded-xl border text-[11px] bg-warning-soft border-warning text-warning-text font-bold">{s.frozenScopeBanner}</p>}
      <nav aria-label={s.breadcrumbAll} className="flex flex-wrap items-center gap-1 text-[11px]">
        <button type="button" className={crumbCls(!standard && !group && !directOpen)}
          onClick={() => goLevel(() => { setOpenStandardId(null); setOpenDisclosureId(null); setOpenGroupId(null); setDirectOpen(false); setQuery(''); })}>{s.breadcrumbAll}</button>
        {standard && (
          <>
            <ArrowRight className="w-3 h-3 text-muted rtl:rotate-180" aria-hidden="true" />
            <button type="button" className={crumbCls(!disclosure)} dir="ltr"
              onClick={() => goLevel(() => { setOpenDisclosureId(null); setSelectedItemId(null); setQuery(''); })}>{standard.code}</button>
          </>
        )}
        {group && (
          <>
            <ArrowRight className="w-3 h-3 text-muted rtl:rotate-180" aria-hidden="true" />
            <span className="px-2 py-1 font-bold text-text" dir="ltr">{group.code}</span>
            <span className="px-1.5 py-0.5 rounded-full bg-info-soft text-info text-[10px] font-bold">{s.contentGroup}</span>
          </>
        )}
        {directOpen && !disclosure && !group && (
          <>
            <ArrowRight className="w-3 h-3 text-muted rtl:rotate-180" aria-hidden="true" />
            <span className="px-2 py-1 font-bold text-text">{s.contentDirect}</span>
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
            <>
              <button type="button" disabled={frozen} title={writeTitle} onClick={() => setLinkPickerOpen(!linkPickerOpen)} className={secondaryBtn}>
                <Link2 className="w-3.5 h-3.5" /><span>{s.addStandard}</span>
              </button>
              <button type="button" disabled={frozen} title={writeTitle} onClick={() => setStdDialog({ code: '', title: '', category: 'universal' })} className={secondaryBtn}>
                <Plus className="w-3.5 h-3.5" /><span>{s.createStandard}</span>
              </button>
            </>
          )}
          {level === 'disclosures' && (
            <button type="button" disabled={frozen} title={writeTitle}
              onClick={() => standard && setDiscDialog({ standardId: standard.id, code: '', title: '', description: '' })} className={secondaryBtn}>
              <Plus className="w-3.5 h-3.5" /><span>{s.createDisclosure}</span>
            </button>
          )}
          {level === 'standards' && (
            <button type="button" disabled={frozen} title={writeTitle} onClick={() => setGroupDialog({ code: '', title: '', description: '', parent: groupStandards[0]?.id ?? 'new' })} className={secondaryBtn}>
              <Plus className="w-3.5 h-3.5" /><span>{s.createGroup}</span>
            </button>
          )}
          {level === 'items' && itemContainerId && (
            <button type="button" disabled={frozen} title={writeTitle} className={secondaryBtn}
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
          <button type="button" disabled={!standardToLink || busy || frozen} className={primaryBtn}
            onClick={async () => { if (await run(() => onLinkStandard(standardToLink))) { setStandardToLink(''); setLinkPickerOpen(false); } }}>
            {t.services.linkButton}
          </button>
          <p className="w-full text-[10px] text-muted">{s.addStandardHint}</p>
        </div>
      )}
      {stdDialog && (
        <div className="p-3 rounded-xl bg-surface-3 border border-border grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input value={stdDialog.code} onChange={(e) => setStdDialog({ ...stdDialog, code: e.target.value })} placeholder={t.taxonomy.codePh} dir="ltr" className={inputCls} />
          <input value={stdDialog.title} onChange={(e) => setStdDialog({ ...stdDialog, title: e.target.value })} placeholder={t.taxonomy.titleLabel} dir="auto" className={inputCls} />
          <select value={stdDialog.category} onChange={(e) => setStdDialog({ ...stdDialog, category: e.target.value })} aria-label={t.taxonomy.categoryLabel} className={inputCls}>
            {['universal', 'environmental', 'social', 'governance', 'group'].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <div className="sm:col-span-2 flex items-center gap-2">
            <button type="button" disabled={busy || frozen || !stdDialog.code.trim() || !stdDialog.title.trim()} onClick={() => void (async () => {
              setNotice(null);
              const id = await onCreateStandard({ code: stdDialog.code.trim(), title: stdDialog.title.trim(), category: stdDialog.category });
              setNotice({ ok: id !== null, text: id !== null ? t.common.success : s.actionFailed });
              if (id !== null) setStdDialog(null);
            })()} className={primaryBtn}>{s.createStandard}</button>
            <button type="button" onClick={() => setStdDialog(null)} className={secondaryBtn}>{t.common.cancel}</button>
          </div>
          <p className="sm:col-span-2 text-[10px] text-muted">{s.codeImmutable}</p>
        </div>
      )}
      {groupDialog && (
        <div className="p-3 rounded-xl bg-surface-3 border border-border grid grid-cols-1 sm:grid-cols-2 gap-2">
          <select value={groupDialog.parent} onChange={(e) => setGroupDialog({ ...groupDialog, parent: e.target.value })} aria-label={s.createGroup} className={inputCls}>
            {groupStandards.map((ref) => <option key={ref.id} value={ref.id}>{ref.code} — {ref.title}</option>)}
            <option value="new">{s.newGroupStandard.replace('{code}', groupStandardCode)}</option>
          </select>
          <input value={groupDialog.code} onChange={(e) => setGroupDialog({ ...groupDialog, code: e.target.value })} placeholder={t.taxonomy.codePh} dir="ltr" className={inputCls} />
          <input value={groupDialog.title} onChange={(e) => setGroupDialog({ ...groupDialog, title: e.target.value })} placeholder={t.taxonomy.titleLabel} dir="auto" className={inputCls} />
          <input value={groupDialog.description} onChange={(e) => setGroupDialog({ ...groupDialog, description: e.target.value })} placeholder={t.taxonomy.descLabel} dir="auto" className={inputCls} />
          <div className="sm:col-span-2 flex items-center gap-2">
            <button type="button" disabled={busy || frozen || !groupDialog.code.trim() || !groupDialog.title.trim()} onClick={() => void (async () => {
              let parentId = groupDialog.parent;
              if (parentId === 'new') {
                const createdId = await onCreateStandard({ code: groupStandardCode, title: groupStandardCode, category: 'group' });
                if (!createdId) { setNotice({ ok: false, text: s.actionFailed }); return; }
                parentId = createdId;
              }
              if (await run(() => onCreateDisclosure(parentId, {
                code: groupDialog.code.trim(), title: groupDialog.title.trim(),
                description: groupDialog.description.trim() || null,
              }))) setGroupDialog(null);
            })()} className={primaryBtn}>{s.createGroup}</button>
            <button type="button" onClick={() => setGroupDialog(null)} className={secondaryBtn}>{t.common.cancel}</button>
          </div>
          <p className="sm:col-span-2 text-[10px] text-muted">{s.createGroupHint}</p>
        </div>
      )}
      {discDialog && (
        <div className="p-3 rounded-xl bg-surface-3 border border-border grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input value={discDialog.code} onChange={(e) => setDiscDialog({ ...discDialog, code: e.target.value })} placeholder={t.taxonomy.codePh} dir="ltr" className={inputCls} />
          <input value={discDialog.title} onChange={(e) => setDiscDialog({ ...discDialog, title: e.target.value })} placeholder={t.taxonomy.titleLabel} dir="auto" className={inputCls} />
          <input value={discDialog.description} onChange={(e) => setDiscDialog({ ...discDialog, description: e.target.value })} placeholder={t.taxonomy.descLabel} dir="auto" className={`${inputCls} sm:col-span-2`} />
          <div className="sm:col-span-2 flex items-center gap-2">
            <button type="button" disabled={busy || frozen || !discDialog.code.trim() || !discDialog.title.trim()} onClick={() => void (async () => {
              if (await run(() => onCreateDisclosure(discDialog.standardId, {
                code: discDialog.code.trim(), title: discDialog.title.trim(),
                description: discDialog.description.trim() || null,
              }))) setDiscDialog(null);
            })()} className={primaryBtn}>{s.createDisclosure}</button>
            <button type="button" onClick={() => setDiscDialog(null)} className={secondaryBtn}>{t.common.cancel}</button>
          </div>
        </div>
      )}
      {level === 'items' && addOpen && itemContainerId && (
        <div className="p-3 rounded-xl bg-surface-3 border border-border grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input value={newItem.code} onChange={(e) => setNewItem({ ...newItem, code: e.target.value })} placeholder={t.taxonomy.codePh} dir="ltr" className={inputCls} />
          <input value={newItem.requirement} onChange={(e) => setNewItem({ ...newItem, requirement: e.target.value })} placeholder={t.taxonomy.requirementPh} dir="auto" className={inputCls} />
          <select value={newItem.answerType} onChange={(e) => setNewItem({ ...newItem, answerType: e.target.value })} aria-label={s.itemAnswerType} className={inputCls}>
            {ANSWER_TYPES.map((value) => <option key={value} value={value}>{t.common[value]}</option>)}</select>
          <select value={newItem.priority} onChange={(e) => setNewItem({ ...newItem, priority: e.target.value })} aria-label={s.itemPriority} className={inputCls}>
            {PRIORITIES.map((value) => <option key={value} value={value}>{t.common[value]}</option>)}</select>
          <select value={newItem.departmentId ?? ''} onChange={(e) => setNewItem({ ...newItem, departmentId: e.target.value || null })} aria-label={s.itemDepartment} className={inputCls}>
            <option value="">{s.itemDepartmentNone}</option>
            {departments.map((dept) => <option key={dept.id} value={dept.id}>{dept.name}</option>)}
          </select>
          <p className="text-[10px] text-muted sm:col-span-2">{s.singleDeptNote}</p>
          <div className="sm:col-span-2 flex items-center gap-2">
            <button type="button" disabled={busy || frozen} title={writeTitle} onClick={() => void submitNewItem(itemContainerId)} className={primaryBtn}>{t.taxonomy.addItemButton}</button>
            <button type="button" onClick={() => setAddOpen(false)} className={secondaryBtn}>{t.common.cancel}</button>
          </div>
        </div>
      )}
      <div className={`grid grid-cols-1 gap-3 items-start ${selectedItem ? '2xl:grid-cols-[minmax(0,1fr)_380px]' : ''}`}>
        <div className="space-y-2">
          {level === 'standards' && visibleStandards.length === 0 && visibleGroups.length === 0 && direct.length === 0 &&
            emptyBox(query.trim() ? s.emptySearch : s.noStandards, s.noStandardsHint,
              !query.trim() && (linkable.length > 0 || !frozen) ? <button type="button" className={primaryBtn} onClick={() => setLinkPickerOpen(true)}>{s.addStandard}</button> : undefined)}
          {level === 'standards' && visibleStandards.map((node) => (
            <div key={node.id} className="flex items-start gap-2 p-2.5 rounded-xl bg-surface-3 border border-border">
              <button type="button" onClick={() => { setOpenStandardId(node.id); setQuery(''); }} className={rowBtn}>
                <span className="flex flex-wrap items-center gap-2"><span dir="ltr" className={codeChip}>{node.code}</span><span className="text-xs font-bold text-text break-words">{node.title}</span></span>
                <span className="block mt-1 text-[10px] text-muted">
                  {s.levelDisclosures} <span dir="ltr">{node.disclosures.length}</span>{' · '}{s.levelItems} <span dir="ltr">{node.disclosures.reduce((sum, d) => sum + d.items.length, 0)}</span>
                </span>
              </button>
              <button type="button" title={t.common.save} aria-label={`${s.editStandard}: ${node.code}`} disabled={frozen}
                onClick={() => setStdEdit({ id: node.id, title: node.title, category: categories[node.id] ?? 'universal' })}
                className="p-1.5 rounded-lg border border-border-strong text-muted hover:bg-surface-2 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-focus-ring/30">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button type="button" title={t.services.unlinkButton} aria-label={`${t.services.unlinkButton}: ${node.code}`} disabled={frozen} onClick={() => void unlink(node.id, node.code)}
                className="p-1.5 rounded-lg border border-border-strong text-muted hover:bg-surface-2 disabled:opacity-50 hover:text-danger focus:outline-none focus:ring-2 focus:ring-focus-ring/30">
                <Unlink className="w-3.5 h-3.5" />
              </button>
              <button type="button" title={t.taxonomy.deleteButton} aria-label={`${t.taxonomy.deleteButton}: ${node.code}`} disabled={frozen}
                onClick={() => { if (window.confirm(s.deleteStandardConfirm)) void run(() => onDeleteStandard(node.id)); }}
                className="p-1.5 rounded-lg border border-border-strong text-muted hover:bg-surface-2 disabled:opacity-50 hover:text-danger focus:outline-none focus:ring-2 focus:ring-focus-ring/30">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {level === 'standards' && stdEdit && (
            <div className="p-3 rounded-xl bg-surface-3 border border-brand grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input value={stdEdit.title} onChange={(e) => setStdEdit({ ...stdEdit, title: e.target.value })} dir="auto" aria-label={t.taxonomy.titleLabel} className={inputCls} />
              <select value={stdEdit.category} onChange={(e) => setStdEdit({ ...stdEdit, category: e.target.value })} aria-label={t.taxonomy.categoryLabel} className={inputCls}>
                {['universal', 'environmental', 'social', 'governance', 'group'].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
              <div className="sm:col-span-2 flex items-center gap-2">
                <button type="button" disabled={busy || frozen || !stdEdit.title.trim()} onClick={() => void (async () => {
                  if (await run(() => onUpdateStandard(stdEdit.id, { title: stdEdit.title.trim(), category: stdEdit.category }))) setStdEdit(null);
                })()} className={primaryBtn}>{t.common.save}</button>
                <button type="button" onClick={() => setStdEdit(null)} className={secondaryBtn}>{t.common.cancel}</button>
              </div>
            </div>
          )}
          {level === 'standards' && visibleGroups.map((entry) => (
            <div key={entry.id} className="flex items-start gap-2 p-2.5 rounded-xl bg-surface-3 border border-info">
              <button type="button" onClick={() => { setOpenGroupId(entry.id); setQuery(''); }} className={rowBtn}>
                <span className="flex flex-wrap items-center gap-2">
                  <span dir="ltr" className={codeChip}>{entry.code}</span>
                  <span className="text-xs font-bold text-text break-words" dir="auto">{entry.title}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-info-soft text-info font-bold">{s.contentGroup}</span>
                </span>
                <span className="block mt-1 text-[10px] text-muted" dir="auto">
                  {s.levelItems} <span dir="ltr">{entry.items.length}</span>{' · '}<span dir="ltr">{entry.standardCode}</span>
                </span>
              </button>
              <button type="button" title={s.editGroup} aria-label={`${s.editGroup}: ${entry.code}`} disabled={frozen}
                onClick={() => setDiscEdit({ id: entry.id, title: entry.title, description: entry.description ?? '' })}
                className="p-1.5 rounded-lg border border-border-strong text-muted hover:bg-surface-2 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-focus-ring/30">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button type="button" title={t.taxonomy.deleteButton} aria-label={`${t.taxonomy.deleteButton}: ${entry.code}`} disabled={frozen}
                onClick={() => { if (window.confirm(s.deleteGroupConfirm)) void run(() => onDeleteDisclosure(entry.id)); }}
                className="p-1.5 rounded-lg border border-border-strong text-muted hover:bg-surface-2 disabled:opacity-50 hover:text-danger focus:outline-none focus:ring-2 focus:ring-focus-ring/30">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {level === 'standards' && !query.trim() && direct.length > 0 && (
            <button type="button" onClick={() => setDirectOpen(true)}
              className="w-full text-start p-2.5 rounded-xl bg-surface-3 border border-dashed border-border-strong hover:bg-surface-2 focus:outline-none focus:ring-2 focus:ring-focus-ring/30">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-text">{s.contentDirect}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-2 text-muted font-bold" dir="ltr">{direct.length}</span>
              </span>
              <span className="block mt-1 text-[10px] text-muted">{s.directHint}</span>
            </button>
          )}
          {level === 'disclosures' && visibleDisclosures.length === 0 &&
            emptyBox(query.trim() ? s.emptySearch : s.noDisclosures, s.noDisclosuresHint,
              !query.trim() ? <button type="button" disabled={frozen} className={primaryBtn} onClick={() => standard && setDiscDialog({ standardId: standard.id, code: '', title: '', description: '' })}>{s.createDisclosure}</button> : undefined)}
          {level === 'disclosures' && visibleDisclosures.map((node) => (
            <div key={node.id} className="flex items-start gap-2 p-2.5 rounded-xl bg-surface-3 border border-border">
              <button type="button" onClick={() => { setOpenDisclosureId(node.id); setQuery(''); }}
                className="w-full text-start rounded-lg focus:outline-none focus:ring-2 focus:ring-focus-ring/30">
                <span className="flex flex-wrap items-center gap-2">
                  <span dir="ltr" className={codeChip}>{node.code}</span>
                  <span className="text-xs font-bold text-text break-words" dir="auto">{node.title}</span>
                </span>
                <span className="block mt-1 text-[10px] text-muted" dir="auto">{s.levelItems} <span dir="ltr">{node.items.length}</span>{node.description ? ` · ${node.description}` : ''}</span>
              </button>
              <button type="button" title={s.editDisclosure} aria-label={`${s.editDisclosure}: ${node.code}`} disabled={frozen}
                onClick={() => setDiscEdit({ id: node.id, title: node.title, description: node.description ?? '' })}
                className="p-1.5 rounded-lg border border-border-strong text-muted hover:bg-surface-2 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-focus-ring/30">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button type="button" title={t.taxonomy.deleteButton} aria-label={`${t.taxonomy.deleteButton}: ${node.code}`} disabled={frozen}
                onClick={() => { if (window.confirm(s.deleteDisclosureConfirm)) void run(() => onDeleteDisclosure(node.id)); }}
                className="p-1.5 rounded-lg border border-border-strong text-muted hover:bg-surface-2 disabled:opacity-50 hover:text-danger focus:outline-none focus:ring-2 focus:ring-focus-ring/30">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {level === 'disclosures' && discEdit && (
            <div className="p-3 rounded-xl bg-surface-3 border border-brand grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input value={discEdit.title} onChange={(e) => setDiscEdit({ ...discEdit, title: e.target.value })} dir="auto" aria-label={t.taxonomy.titleLabel} className={inputCls} />
              <input value={discEdit.description} onChange={(e) => setDiscEdit({ ...discEdit, description: e.target.value })} dir="auto" aria-label={t.taxonomy.descLabel} className={inputCls} />
              <div className="sm:col-span-2 flex items-center gap-2">
                <button type="button" disabled={busy || frozen || !discEdit.title.trim()} onClick={() => void (async () => {
                  if (await run(() => onUpdateDisclosure(discEdit.id, { title: discEdit.title.trim(), description: discEdit.description.trim() || null }))) setDiscEdit(null);
                })()} className={primaryBtn}>{t.common.save}</button>
                <button type="button" onClick={() => setDiscEdit(null)} className={secondaryBtn}>{t.common.cancel}</button>
              </div>
            </div>
          )}
          {level === 'items' && visibleItems.length === 0 &&
            emptyBox(query.trim() ? s.emptySearch : s.noItems, s.noItemsHint,
              !query.trim() && itemContainerId ? <button type="button" disabled={frozen} className={primaryBtn} onClick={() => setAddOpen(true)}>{t.taxonomy.addItemButton}</button> : undefined)}
          {level === 'items' && (
            <p className="text-[10px] text-muted">{containerLabel} · <span className="font-bold text-text" dir="ltr">{visibleItems.length}</span></p>
          )}
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
                <button type="button" onClick={() => askDeleteItem(item.id)} title={t.taxonomy.deleteButton} aria-label={`${t.taxonomy.deleteButton}: ${item.code}`} disabled={frozen}
                  className="p-1.5 rounded-lg border border-border-strong text-muted hover:bg-surface-2 disabled:opacity-50 hover:text-danger focus:outline-none focus:ring-2 focus:ring-focus-ring/30">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
          {level === 'items' && confirmDeleteId && (
            <div className="p-3 rounded-xl bg-danger-soft border border-danger space-y-2" role="alertdialog" aria-label={s.deleteItemTitle}>
              <p className="text-[11px] font-bold text-danger">{s.deleteItemTitle}</p>
              <p className="text-[10px] text-danger">{s.deleteItemHint}</p>
              <input value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} placeholder={s.deleteReasonPh} dir="auto" aria-label={s.deleteReasonPh} className={inputCls} />
              <div className="flex items-center gap-2">
                <button type="button" disabled={busy} onClick={() => void confirmDeleteItem()} className={dangerBtn}>{s.deleteItemConfirm}</button>
                <button type="button" onClick={() => { setConfirmDeleteId(null); setDeleteReason(''); }} className={secondaryBtn}>{t.common.cancel}</button>
              </div>
            </div>
          )}
          {level === 'items' && checked.length > 0 && (
            <div className="p-3 rounded-xl bg-brand-soft border border-brand space-y-2">
              <p className="text-[11px] font-bold text-text flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" /><span>{s.selectedCount.replace('{n}', String(checked.length))}</span>
              </p>
              <div className="grid grid-cols-2 gap-2">
                <select value={bulk.answerType ?? ''} onChange={(e) => setBulk({ ...bulk, answerType: e.target.value || undefined })} aria-label={s.itemAnswerType} className={inputCls}>
                  <option value="">{s.bulkUnset}</option>{ANSWER_TYPES.map((value) => <option key={value} value={value}>{t.common[value]}</option>)}</select>
                <select value={bulk.priority ?? ''} onChange={(e) => setBulk({ ...bulk, priority: e.target.value || undefined })} aria-label={s.itemPriority} className={inputCls}>
                  <option value="">{s.bulkUnset}</option>{PRIORITIES.map((value) => <option key={value} value={value}>{t.common[value]}</option>)}</select>
                <select value={bulk.esgClass ?? ''} onChange={(e) => setBulk({ ...bulk, esgClass: e.target.value || undefined })} aria-label={s.itemEsgClass} className={inputCls}>
                  <option value="">{s.bulkUnset}</option>{ESG_CLASSES.map((value) => <option key={value} value={value}>{value}</option>)}</select>
                <select value={bulkAttach} onChange={(e) => setBulkAttach(e.target.value as 'unset' | 'true' | 'false')} aria-label={s.attachmentRequired} className={inputCls}>
                  <option value="unset">{s.bulkUnset}</option>
                  <option value="true">{s.attachmentRequired}</option>
                  <option value="false">{s.attachmentNotRequired}</option>
                </select>
              </div>
              <p className="text-[10px] text-muted">{s.bulkEditHint}</p>
              <div className="flex items-center gap-2">
                <button type="button" disabled={busy || frozen} title={writeTitle} onClick={() => void submitBulk()} className={primaryBtn}>{s.bulkEditApply}</button>
                <button type="button" onClick={() => { setChecked([]); setBulk({}); setBulkAttach('unset'); }} className={secondaryBtn}>{t.common.cancel}</button>
              </div>
              {bulkResults && (
                <ul className="space-y-1 max-h-96 overflow-y-auto pe-1">
                  {bulkResults.map((row) => {
                    const code = allActiveItems.find((item) => item.id === row.id)?.code ?? row.id;
                    return (
                      <li key={row.id} className={`p-1.5 rounded-lg border text-[10px] ${row.ok ? 'bg-success-soft border-success text-success-text' : 'bg-danger-soft border-danger text-danger'}`}>
                        <bdi dir="ltr" className="font-extrabold">{code}</bdi>
                        <span className="block" dir="auto">{row.ok ? s.bulkRowOk : (row.error ?? s.actionFailed)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
          {archived.length > 0 && (
            <div className="p-2.5 rounded-xl bg-surface-2 border border-dashed border-border-strong">
              <button type="button" onClick={() => setShowArchived(!showArchived)} aria-expanded={showArchived}
                className="w-full flex items-center justify-between gap-2 text-[11px] font-bold text-muted hover:text-text focus:outline-none focus:ring-2 focus:ring-focus-ring/30 rounded-lg">
                <span>{s.archivedSection} <bdi dir="ltr">({archived.length})</bdi></span>
                <History className="w-3.5 h-3.5" />
              </button>
              {showArchived && (
                <ul className="mt-2 space-y-1.5">
                  {archived.filter((item) => matches(query, item.code, item.requirement)).map((item) => (
                    <li key={item.id} className="flex items-center gap-2 p-2 rounded-lg bg-surface-3 border border-border opacity-80">
                      <button type="button" onClick={() => openItem(item.id)} className={rowBtn}
                        aria-expanded={item.id === selectedItemId} aria-controls={item.id === selectedItemId ? 'svc-item-panel' : undefined}>
                        <span dir="ltr" className="text-[10px] font-extrabold text-muted">{item.code}</span>
                        <span className="block mt-0.5 text-[11px] text-muted break-words" dir="auto">{item.requirement}</span>
                        <span className="mt-0.5 inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-warning-soft text-warning-text font-bold">{s.archivedBadge}</span>
                      </button>
                    </li>
                  ))}
                </ul>
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
                  {selectedArchived && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-warning-soft text-warning-text">{s.archivedBadge}</span>}
                  {dirty && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-warning-soft text-warning-text">{s.dirtyDraft}</span>}
                  <button type="button" onClick={closePanel} aria-label={t.common.close} className="p-1 rounded-lg text-muted hover:bg-surface-3 focus:outline-none focus:ring-2 focus:ring-focus-ring/30"><X className="w-3.5 h-3.5" /></button>
                </div>
              </div>
              {selectedArchived && <p className="text-[10px] text-warning-text font-bold">{s.itemArchivedNote}</p>}
              {reopened > 0 && (
                <p role="status" className="p-2 rounded-xl border text-[11px] bg-info-soft border-info text-info font-bold">
                  {s.historyReopened.replace('{n}', String(reopened))}
                </p>
              )}
              {saveConflict && (
                <div role="alert" className="p-2.5 rounded-xl border text-[11px] bg-danger-soft border-danger text-danger space-y-1.5">
                  <p className="font-bold">{t.conflict.title}</p>
                  <p>{t.conflict.desc}</p>
                  <button type="button" onClick={() => { setSaveConflict(false); onReload(); }} className={secondaryBtn}>{t.conflict.reloadRetry}</button>
                </div>
              )}
              <label className="block text-[10px] font-semibold text-text">{s.itemRequirement}
                <textarea value={draft.requirement ?? ''} disabled={selectedArchived} onChange={(e) => setDraft({ ...draft, requirement: e.target.value })} rows={5} dir="auto" className={`${inputCls} mt-1`} /></label>
              <label className="block text-[10px] font-semibold text-text">{s.itemHint}
                <textarea value={draft.hint ?? ''} disabled={selectedArchived} onChange={(e) => setDraft({ ...draft, hint: e.target.value })} rows={3} dir="auto" className={`${inputCls} mt-1`} /></label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-[10px] font-semibold text-text">{s.itemAnswerType}
                  <select value={draft.answerType ?? 'text'} disabled={selectedArchived} onChange={(e) => setDraft({ ...draft, answerType: e.target.value })} className={`${inputCls} mt-1`}>
                    {ANSWER_TYPES.map((value) => <option key={value} value={value}>{t.common[value]}</option>)}
                  </select></label>
                <label className="block text-[10px] font-semibold text-text">{s.itemPriority}
                  <select value={draft.priority ?? 'mid'} disabled={selectedArchived} onChange={(e) => setDraft({ ...draft, priority: e.target.value })} className={`${inputCls} mt-1`}>
                    {PRIORITIES.map((value) => <option key={value} value={value}>{t.common[value]}</option>)}
                  </select></label>
              </div>
              <label className="block text-[10px] font-semibold text-text">{s.itemEsgClass}
                <select value={draft.esgClass ?? 'general'} disabled={selectedArchived} onChange={(e) => setDraft({ ...draft, esgClass: e.target.value })} className={`${inputCls} mt-1`}>
                  {ESG_CLASSES.map((value) => <option key={value} value={value}>{value}</option>)}
                </select></label>
              <label className="block text-[10px] font-semibold text-text">{s.itemDepartment}
                <select value={draft.departmentId ?? ''} disabled={selectedArchived} onChange={(e) => setDraft({ ...draft, departmentId: e.target.value || null })} className={`${inputCls} mt-1`}>
                  <option value="">{s.itemDepartmentNone}</option>
                  {departments.map((dept) => <option key={dept.id} value={dept.id}>{dept.name}</option>)}
                  {draft.departmentId && !departments.some((dept) => dept.id === draft.departmentId) && (
                    <option value={draft.departmentId}>{deptName(draft.departmentId) ?? draft.departmentId}</option>
                  )}
                </select>
                <span className="block font-normal text-muted mt-0.5">{s.singleDeptNote}</span></label>
              <p className="text-[10px] text-muted flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3" />
                <span>{selectedItem.attachment_required ? s.attachmentRequired : s.attachmentNotRequired} — {s.attachmentReadOnly}</span></p>
              {!selectedArchived && (
                <div className="flex items-center gap-2">
                  <button type="button" disabled={busy || frozen} title={frozen ? s.frozenScopeBanner : undefined} onClick={() => void saveDraft()} className={`${primaryBtn} flex-1 inline-flex items-center justify-center gap-1.5`}><Save className="w-3.5 h-3.5" /><span>{t.common.save}</span></button>
                  <button type="button" onClick={closePanel} className={secondaryBtn}>{t.common.close}</button>
                </div>
              )}
              {selectedArchived && (
                <div className="flex items-center gap-2">
                  <button type="button" onClick={closePanel} className={secondaryBtn}>{t.common.close}</button>
                </div>
              )}
              <p className="text-[10px] text-muted">{s.codeImmutable}</p>
              {!service.standards.length && (
                <p className="text-[10px] text-warning-text flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{s.noStandardsHint}</p>
              )}
              <div className="pt-1 space-y-1.5 border-t border-border">
                <h5 className="text-[11px] font-bold text-text flex items-center gap-1.5"><History className="w-3.5 h-3.5" />{s.historyTitle}</h5>
                {historyLoading && <p role="status" className="text-[10px] text-muted">{t.common.loading}</p>}
                {historyError && (
                  <div role="alert" className="p-2 rounded-xl bg-danger-soft border border-danger text-[10px] text-danger space-y-1.5">
                    <p>{s.historyFailed}</p>
                    <button type="button" onClick={() => { setHistoryError(false); setHistoryLoading(true); void onFetchHistory(selectedItem.id).then((data) => { setHistory(data); setHistoryError(data === null); setHistoryLoading(false); }); }} className={secondaryBtn}>{t.common.retry}</button>
                  </div>
                )}
                {history && history.versions.length === 0 && history.answersSummary.length === 0 && (
                  <p className="text-[10px] text-muted">{s.historyEmpty}</p>
                )}
                {history && history.answersSummary.length > 0 && (
                  <ul className="flex flex-wrap gap-1">
                    {history.answersSummary.map((row) => (
                      <li key={row.status} className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-3 border border-border text-muted font-bold">
                        {row.status} <bdi dir="ltr">{row.count}</bdi>
                      </li>
                    ))}
                  </ul>
                )}
                {history && history.versions.length > 0 && (
                  <ul className="space-y-1.5 max-h-96 overflow-y-auto pe-1">
                    {history.versions.map((entry) => (
                      <li key={entry.version} className="p-2 rounded-lg bg-surface-3 border border-border text-[10px] space-y-0.5">
                        <p className="font-extrabold text-text"><bdi dir="ltr">v{entry.version}</bdi>
                          {entry.changedAt && <span className="font-normal text-muted"> · <bdi dir="ltr">{new Date(entry.changedAt).toLocaleDateString()}</bdi></span>}</p>
                        {entry.reason && <p className="text-text break-words" dir="auto">{entry.reason}</p>}
                        {typeof (entry.snapshot as { requirement?: unknown }).requirement === 'string' && (
                          <p className="text-muted break-words" dir="auto">{String((entry.snapshot as { requirement?: unknown }).requirement)}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </aside>
          </>
        )}
      </div>
    </div>
  );
};
