import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ClipboardList, RefreshCw, Search, Wifi, WifiOff } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { apiFetch } from '../lib/api.ts';
import { friendlyError, isFrozenRefusal } from './ServicesView.tsx';
import type { QueueItem } from './EvaluationPanel.tsx';
import { matches } from '../components/services/ServiceContentPanel.tsx';
import type { ServiceRow } from '../components/services/ServiceRail.tsx';
import { ConfirmDialog } from '../components/employee/ConfirmDialog.tsx';
import { EmployeeItemDetail } from '../components/employee/EmployeeItemDetail.tsx';
import { EmployeeDocumentsTab } from '../components/employee/EmployeeDocumentsTab.tsx';
import { EmployeeInitiativesTab } from '../components/employee/EmployeeInitiativesTab.tsx';
import {
  countsForItems,
  filterOwnDepartment,
  groupByDisclosure,
  groupQueueByService,
  queueStatusLabel,
  type ItemMeta,
} from '../components/employee/employeeWorkspace.ts';

/**
 * TASK-PROTO-U4-3 unit (a) — employee services workspace (own-department only).
 *
 * UI composition ONLY over existing APIs: GET /api/queue (own-dept items),
 * GET /api/items (typed-answer metadata), GET /api/services (catalogue for
 * grouping; degraded to standard groups when unreadable), the evaluations /
 * answer-attachments flow, GET+PATCH /api/requirements with unified evidence,
 * and GET+PATCH /api/initiatives/department with proof files. No new
 * endpoints, no assignment writes, no client/department pickers (identity is
 * the session's). Reuses FIX patterns: services rail, disclosure drill,
 * banners, friendlyError, dirty-draft guard, tablist, focus-trapped dialog.
 */

const STATUS_STYLES: Record<string, string> = {
  not_evaluated: 'bg-surface-3 text-muted',
  draft: 'bg-info-soft text-info',
  submitted: 'bg-warning-soft text-warning-text',
  approved: 'bg-success-soft text-success-text',
  client_approved: 'bg-accent-soft text-text',
  returned: 'bg-danger-soft text-danger',
  not_applicable: 'bg-surface-3 text-muted',
};

const WORKSPACE_TABS = ['items', 'documents', 'initiatives'] as const;
type WorkspaceTab = (typeof WORKSPACE_TABS)[number];

interface Toast {
  id: number;
  kind: 'ok' | 'err';
  text: string;
}

export const EmployeeServicesView: React.FC = () => {
  const { t } = useLanguage();
  const { user, token } = useAuth();
  const s = t.employeeServices;
  const isEmployee = user?.role === 'employee';
  const departmentId = user?.departmentId ?? null;

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [metaById, setMetaById] = useState<Record<string, ItemMeta>>({});
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [tab, setTab] = useState<WorkspaceTab>('items');
  const [search, setSearch] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [frozen, setFrozen] = useState(false);
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dirtyAny, setDirtyAny] = useState(false);
  const [pendingNav, setPendingNav] = useState<(() => void) | null>(null);

  const dirtyKeys = useRef(new Map<string, boolean>());
  const toastId = useRef(0);

  const notify = useCallback((kind: 'ok' | 'err', text: string) => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev.slice(-3), { id, kind, text }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((row) => row.id !== id));
    }, 4000);
  }, []);

  const handleDirtyChange = useCallback((key: string, dirty: boolean) => {
    if (dirty) dirtyKeys.current.set(key, true);
    else dirtyKeys.current.delete(key);
    setDirtyAny(dirtyKeys.current.size > 0);
  }, []);

  const clearDirty = useCallback(() => {
    dirtyKeys.current.clear();
    setDirtyAny(false);
  }, []);

  const handleFrozen = useCallback(() => setFrozen(true), []);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => {
    if (!dirtyAny) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirtyAny]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const [queueRes, itemsRes] = await Promise.all([
        apiFetch('/api/queue', { headers }),
        apiFetch('/api/items', { headers }),
      ]);
      if (!queueRes.ok) {
        const data = await queueRes.json().catch(() => ({}));
        if (isFrozenRefusal(data)) setFrozen(true);
        throw new Error((data as { error?: string }).error || s.loadFailed);
      }
      if (!itemsRes.ok) {
        const data = await itemsRes.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || s.loadFailed);
      }
      const queueData = await queueRes.json();
      const itemsData: ItemMeta[] = await itemsRes.json();
      setQueue(Array.isArray(queueData.items) ? queueData.items : []);
      const map: Record<string, ItemMeta> = {};
      for (const row of Array.isArray(itemsData) ? itemsData : []) {
        if (row?.id) map[row.id] = row;
      }
      setMetaById(map);
      // The catalogue read is enrichment only: when it is refused or empty the
      // workspace degrades to standard-code groups (never a failure).
      try {
        const svcRes = await apiFetch('/api/services', { headers });
        if (svcRes.ok) {
          const svcData = await svcRes.json();
          setServices(Array.isArray(svcData) ? svcData : []);
        } else {
          setServices([]);
        }
      } catch {
        setServices([]);
      }
    } catch (err) {
      setError(friendlyError(err, s.loadFailed));
      setQueue([]);
    } finally {
      setLoading(false);
    }
  }, [token, s.loadFailed]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const ownQueue = useMemo(() => filterOwnDepartment(queue, departmentId), [queue, departmentId]);
  const groups = useMemo(() => groupQueueByService(ownQueue, services), [ownQueue, services]);
  const totals = useMemo(() => countsForItems(ownQueue), [ownQueue]);

  useEffect(() => {
    if (!groups.length) {
      setSelectedService(null);
      return;
    }
    if (!selectedService || !groups.some((group) => group.id === selectedService)) {
      setSelectedService(groups[0].id);
    }
  }, [groups, selectedService]);

  const visibleGroups = useMemo(() => {
    const query = search.trim();
    if (!query) return groups;
    return groups.filter((group) => matches(query, group.name, group.code));
  }, [groups, search]);

  const activeGroup = groups.find((group) => group.id === selectedService) ?? null;
  const filteredItems = useMemo(() => {
    if (!activeGroup) return [];
    const query = itemSearch.trim();
    if (!query) return activeGroup.items;
    return activeGroup.items.filter((row) =>
      matches(query, row.code, row.requirement, row.disclosure_code, row.disclosure_title),
    );
  }, [activeGroup, itemSearch]);
  const disclosureGroups = useMemo(() => groupByDisclosure(filteredItems), [filteredItems]);

  const selected: QueueItem | null =
    filteredItems.find((row) => `${row.item_id}::${row.department_id}` === selectedKey) ?? null;
  const selectedMeta: ItemMeta | null = selected ? (metaById[selected.item_id] ?? null) : null;

  /** Dirty-guarded navigation: service / item / tab switches ask first. */
  const requestNav = useCallback((action: () => void) => {
    if (dirtyKeys.current.size > 0) setPendingNav(() => action);
    else action();
  }, []);

  const onTabKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const rtl = document.documentElement.dir === 'rtl';
    const index = WORKSPACE_TABS.indexOf(tab);
    const delta = event.key === (rtl ? 'ArrowLeft' : 'ArrowRight') ? 1 : event.key === (rtl ? 'ArrowRight' : 'ArrowLeft') ? -1 : 0;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? WORKSPACE_TABS.length - 1 : delta ? (index + delta + WORKSPACE_TABS.length) % WORKSPACE_TABS.length : -1;
    if (next < 0) return;
    event.preventDefault();
    const target = WORKSPACE_TABS[next];
    requestNav(() => setTab(target));
    document.getElementById(`emp-tab-${target}`)?.focus();
  };

  const tabLabel: Record<WorkspaceTab, string> = { items: s.tabItems, documents: s.tabDocuments, initiatives: s.tabInitiatives };

  if (!isEmployee) {
    return (
      <div role="alert" className="p-8 text-center bg-surface-2 rounded-2xl border border-border">
        <p className="text-sm font-bold text-text">{s.loadFailed}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-4 items-start">
        <div aria-hidden="true" className="bg-surface-2 border border-border rounded-2xl p-3 space-y-2">
          {[0, 1, 2].map((n) => (
            <div key={n} className="h-12 rounded-xl bg-surface-3 animate-pulse" />
          ))}
        </div>
        <div aria-hidden="true" className="bg-surface-2 border border-border rounded-2xl p-4 space-y-2">
          <div className="h-10 rounded-xl bg-surface-3 animate-pulse" />
          <div className="h-40 rounded-xl bg-surface-3 animate-pulse" />
        </div>
        <span className="sr-only">{t.common.loading}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="p-8 text-center space-y-3 bg-surface-2 rounded-2xl border border-border">
        <p className="text-sm font-bold text-text">{s.loadFailed}</p>
        <p className="text-xs text-muted break-words">{error}</p>
        <button
          type="button"
          onClick={() => void fetchAll()}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-brand text-brand-ink hover:bg-brand-strong"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>{t.common.retry}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-5 bg-surface-2 rounded-2xl border border-border shadow-xs">
        <div>
          <h3 className="text-lg font-bold text-text" data-page-heading tabIndex={-1}>
            {s.title}
          </h3>
          <p className="text-[11px] text-muted mt-0.5">{s.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            role="status"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold ${online ? 'bg-success-soft text-success-text' : 'bg-danger-soft text-danger'}`}
          >
            {online ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
            <span>{online ? t.common.connected : t.common.disconnected}</span>
          </span>
          <button
            type="button"
            onClick={() => void fetchAll()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-muted hover:bg-surface-3 text-xs border border-border"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{t.common.refresh}</span>
          </button>
        </div>
      </div>

      {!online && (
        <p role="alert" className="p-3 rounded-xl bg-danger-soft border border-danger text-danger text-xs font-bold">
          {t.common.disconnected}
        </p>
      )}
      {frozen && (
        <p role="alert" className="p-3 rounded-xl bg-warning-soft border border-warning text-warning-text text-xs font-bold">
          {t.servicesWorkspace.frozenScopeBanner}
        </p>
      )}
      {dirtyAny && (
        <p role="status" className="p-2.5 rounded-xl bg-info-soft border border-info text-info text-[11px] font-bold">
          {s.unsavedChanges}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-4 items-start">
        <aside aria-label={s.railTitle} className="bg-surface-2 border border-border rounded-2xl p-3 space-y-3 lg:sticky lg:top-0 lg:self-start lg:max-h-[calc(100vh-1rem)] lg:overflow-y-auto">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-bold text-text">{s.railTitle}</h2>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-surface-3 text-muted" dir="ltr">
              {groups.length}
            </span>
          </div>
          <div>
            <label htmlFor="emp-rail-search" className="block text-[11px] font-semibold text-text mb-1">
              {s.railSearchLabel}
            </label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-muted absolute top-2.5 start-2.5 pointer-events-none" />
              <input
                id="emp-rail-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={s.railSearchPh}
                className="w-full ps-8 pe-3 py-2 rounded-xl text-xs bg-surface-3 border border-border-strong text-text placeholder-muted focus:outline-none focus:border-focus-ring focus:ring-2 focus:ring-focus-ring/30"
              />
            </div>
          </div>
          {groups.length === 0 && !search.trim() ? (
            <div className="p-4 text-center">
              <ClipboardList className="w-8 h-8 mx-auto mb-2 text-muted" />
              <p className="text-xs font-bold text-text">{s.railEmpty}</p>
              <p className="text-[11px] text-muted mt-1">{s.railEmptyHint}</p>
            </div>
          ) : visibleGroups.length === 0 ? (
            <p className="text-[11px] text-muted text-center p-3">{s.emptySearch}</p>
          ) : (
            <ul className="space-y-1.5">
              {visibleGroups.map((group) => {
                const active = group.id === selectedService;
                return (
                  <li key={group.id}>
                    <button
                      type="button"
                      onClick={() => requestNav(() => {
                        setSelectedService(group.id);
                        setSelectedKey(null);
                        setItemSearch('');
                      })}
                      aria-current={active ? 'true' : undefined}
                      className={`w-full text-start p-3 rounded-xl border transition-colors ${
                        active ? 'border-brand bg-brand-soft' : 'border-border hover:bg-surface-3'
                      }`}
                    >
                      <div className="text-xs font-bold text-text break-words" dir="auto">
                        {group.fallback ? <bdi dir="ltr">{group.name}</bdi> : group.name}
                      </div>
                      <div className="text-[10px] text-muted mt-1" dir="ltr">
                        {group.code}
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[10px] text-muted">
                        <span>
                          {s.countsAssigned} <bdi dir="ltr" className="font-extrabold text-text">{group.assigned}</bdi>
                        </span>
                        <span>
                          {s.countsSubmitted} <bdi dir="ltr" className="font-extrabold text-success-text">{group.submitted}</bdi>
                        </span>
                        <span>
                          {s.countsPending} <bdi dir="ltr" className="font-extrabold text-warning-text">{group.pending}</bdi>
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-[10px] text-muted px-1" dir="ltr">
            {totals.assigned} · {totals.submitted} · {totals.pending}
          </p>
        </aside>

        <section className="bg-surface-2 border border-border rounded-2xl">
          {!activeGroup ? (
            <div className="p-10 text-center space-y-2">
              <p className="text-sm font-bold text-text">{s.railEmpty}</p>
              <p className="text-xs text-muted">{s.railEmptyHint}</p>
            </div>
          ) : (
            <>
              <header className="px-4 py-3 space-y-3 border-b border-border">
                <div className="min-w-0">
                  <h1 className="text-base font-bold text-text break-words" dir="auto">
                    {activeGroup.fallback ? <bdi dir="ltr">{activeGroup.name}</bdi> : activeGroup.name}
                  </h1>
                  <p dir="ltr" className="text-[11px] font-extrabold text-muted break-all">
                    {activeGroup.code}
                  </p>
                </div>
                <div role="tablist" aria-label={activeGroup.name} onKeyDown={onTabKey} className="flex flex-wrap gap-1">
                  {WORKSPACE_TABS.map((key) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      id={`emp-tab-${key}`}
                      aria-selected={tab === key}
                      aria-controls={`emp-panel-${key}`}
                      tabIndex={tab === key ? 0 : -1}
                      onClick={() => requestNav(() => setTab(key))}
                      className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border focus:outline-none focus:ring-2 focus:ring-focus-ring/30 ${
                        tab === key ? 'bg-brand-soft text-brand-text border-brand' : 'text-muted hover:bg-surface-3 border-transparent'
                      }`}
                    >
                      {tabLabel[key]}
                    </button>
                  ))}
                </div>
              </header>
              <div className="p-4 space-y-3">
                <div id="emp-panel-items" role="tabpanel" aria-labelledby="emp-tab-items" hidden={tab !== 'items'}>
                  {tab === 'items' && (
                    <div className="grid grid-cols-1 xl:grid-cols-5 gap-4 items-start">
                      <div className="xl:col-span-2 p-3 bg-surface-2 rounded-2xl border border-border">
                        <label htmlFor="emp-item-search" className="sr-only">
                          {s.searchItemsPh}
                        </label>
                        <div className="relative mb-2">
                          <Search className="w-3.5 h-3.5 text-muted absolute top-2.5 start-2.5 pointer-events-none" />
                          <input
                            id="emp-item-search"
                            type="search"
                            value={itemSearch}
                            onChange={(e) => setItemSearch(e.target.value)}
                            placeholder={s.searchItemsPh}
                            className="w-full ps-8 pe-3 py-2 rounded-xl text-xs bg-surface-3 border border-border-strong text-text placeholder-muted focus:outline-none focus:border-focus-ring focus:ring-2 focus:ring-focus-ring/30"
                          />
                        </div>
                        {filteredItems.length === 0 ? (
                          <div className="p-4 text-center">
                            <p className="text-xs font-bold text-text">{s.itemsEmpty}</p>
                            <p className="text-[11px] text-muted mt-1">{s.itemsEmptyHint}</p>
                          </div>
                        ) : (
                          <div className="space-y-3 max-h-[70vh] overflow-y-auto pe-1">
                            {disclosureGroups.map((group) => (
                              <div key={group.code}>
                                <div className="px-1 mb-1">
                                  <span className="text-[10px] font-mono font-bold text-brand-text" dir="ltr">
                                    {group.code}
                                  </span>
                                  <span className="block text-[11px] font-bold text-text">{group.title}</span>
                                </div>
                                <ul className="space-y-1.5">
                                  {group.rows.map((row) => {
                                    const key = `${row.item_id}::${row.department_id}`;
                                    const active = key === selectedKey;
                                    const status = row.status || 'not_evaluated';
                                    const archived = metaById[row.item_id]?.status === 'archived';
                                    return (
                                      <li key={key}>
                                        <button
                                          type="button"
                                          onClick={() => requestNav(() => setSelectedKey(key))}
                                          className={`w-full text-start p-2.5 rounded-xl border transition-colors ${
                                            active ? 'border-brand bg-brand-soft' : 'border-border hover:bg-surface-3'
                                          }`}
                                        >
                                          <div className="flex items-center justify-between gap-2">
                                            <span className="text-[11px] font-mono font-bold text-brand-text" dir="ltr">
                                              {row.code}
                                            </span>
                                            <span className="flex items-center gap-1">
                                              {archived && (
                                                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase bg-surface-3 text-muted">
                                                  {t.servicesWorkspace.archivedBadge}
                                                </span>
                                              )}
                                              <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase ${STATUS_STYLES[status] || STATUS_STYLES.not_evaluated}`}>
                                                {queueStatusLabel(status, t)}
                                              </span>
                                            </span>
                                          </div>
                                          <div className="text-[11px] text-muted mt-1 line-clamp-2">{row.requirement}</div>
                                        </button>
                                      </li>
                                    );
                                  })}
                                </ul>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="xl:col-span-3">
                        {selected ? (
                          <EmployeeItemDetail
                            key={`${selected.item_id}::${selected.department_id}::${selected.answer_status}::${selected.evaluation_id}::${selected.evaluation_version}::${selected.answer_version}`}
                            item={selected}
                            meta={selectedMeta}
                            onChanged={() => void fetchAll()}
                            onFrozen={handleFrozen}
                            onDirtyChange={handleDirtyChange}
                            notify={notify}
                          />
                        ) : (
                          <div className="p-8 bg-surface-2 rounded-2xl border border-border text-center">
                            <ClipboardList className="w-10 h-10 mx-auto mb-3 text-muted" />
                            <p className="text-xs text-muted">{s.selectItemHint}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                <div id="emp-panel-documents" role="tabpanel" aria-labelledby="emp-tab-documents" hidden={tab !== 'documents'}>
                  {tab === 'documents' && (
                    <EmployeeDocumentsTab
                      services={services}
                      onFrozen={handleFrozen}
                      onDirtyChange={handleDirtyChange}
                      notify={notify}
                    />
                  )}
                </div>
                <div id="emp-panel-initiatives" role="tabpanel" aria-labelledby="emp-tab-initiatives" hidden={tab !== 'initiatives'}>
                  {tab === 'initiatives' && (
                    <EmployeeInitiativesTab
                      onFrozen={handleFrozen}
                      onDirtyChange={handleDirtyChange}
                      notify={notify}
                    />
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      {pendingNav && (
        <ConfirmDialog
          title={s.unsavedTitle}
          message={s.unsavedChanges}
          confirmLabel={t.servicesWorkspace.discardDraft}
          onConfirm={() => {
            const action = pendingNav;
            setPendingNav(null);
            clearDirty();
            action();
          }}
          onCancel={() => setPendingNav(null)}
        />
      )}

      <div aria-live="polite" className="fixed bottom-4 start-4 z-50 space-y-2 max-w-sm">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.kind === 'err' ? 'alert' : 'status'}
            className={`p-3 rounded-xl border text-xs font-bold shadow-[var(--shadow)] ${
              toast.kind === 'ok' ? 'bg-success-soft border-success text-success-text' : 'bg-danger-soft border-danger text-danger'
            }`}
          >
            {toast.kind === 'err' && <AlertTriangle className="w-4 h-4 inline-block me-1.5 -mt-0.5" />}
            {toast.text}
          </div>
        ))}
      </div>
    </div>
  );
};
