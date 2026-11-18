import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, PauseCircle, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { apiFetch } from '../lib/api.ts';
import { friendlyError, isFrozenRefusal } from './ServicesView.tsx';
import type { QueueItem } from './EvaluationPanel.tsx';
import type { ServiceRow } from '../components/services/ServiceRail.tsx';
import { ConfirmDialog } from '../components/employee/ConfirmDialog.tsx';
import { ConsultantServicesTab } from '../components/consultant/ConsultantServicesTab.tsx';
import { ConsultantMatchingTab } from '../components/consultant/ConsultantMatchingTab.tsx';
import { ConsultantScopeTab } from '../components/consultant/ConsultantScopeTab.tsx';
import { ConsultantMasksTab } from '../components/consultant/ConsultantMasksTab.tsx';
import { ConsultantStaffTab, type ConsultantStaffList, type PendingAccount } from '../components/consultant/ConsultantStaffTab.tsx';
import type { ConsultantDept, ConsultantLinkedService } from '../components/consultant/consultantConsole.ts';

const CONSOLE_TABS = ['services', 'matching', 'scope', 'masks', 'staff'] as const;
type ConsoleTab = (typeof CONSOLE_TABS)[number];

interface Toast {
  id: number;
  kind: 'ok' | 'err';
  text: string;
}

/**
 * TASK-PROTO-U4-3 unit (c2) — consultant application console (W bound to A).
 *
 * Research refs: ContraForce Workspace Center (per-workspace settings tabs) +
 * Intuit Expert Portal (one consolidated expert tool) + Genesys admin tiles;
 * executed strictly in the repo's FIX rail/drill/drawer/banner language with
 * STYLE tokens (no second visual language).
 *
 * UI composition ONLY: c1 workspace writes (link/unlink, participating,
 * dept-matching, complete-password) + the extended pre-existing routes (N/A
 * scope + lift, visibility masks, staff approve/reject/deliver). No new
 * endpoints, no API changes, no DB. Bound to the session workspace tenant A —
 * there is no tenant picker and no cross-tenant query wiring anywhere here.
 * W never answers/attaches (INV-W-NEVER-ANSWERS); no scores, no evaluator
 * identity, no correction internals, no secrets beyond the OTP-once and
 * reveal-once panels (memory-only, cleared on acknowledge/unmount/tab-switch).
 */
export const ConsultantConsoleView: React.FC = () => {
  const { t } = useLanguage();
  const { user, token, workspace } = useAuth();
  const s = t.consultantConsole;

  const isConsultant = user?.role === 'ge_admin' && workspace?.mode === 'consultant' && Boolean(workspace?.client);
  const tenantId = workspace?.client?.id ?? '';
  const tenantName = workspace?.client?.name ?? '';

  const [tab, setTab] = useState<ConsoleTab>('services');
  const [linked, setLinked] = useState<ConsultantLinkedService[]>([]);
  const [catalogue, setCatalogue] = useState<ServiceRow[]>([]);
  const [departments, setDepartments] = useState<ConsultantDept[]>([]);
  const [users, setUsers] = useState<PendingAccount[]>([]);
  const [suspendedTenant, setSuspendedTenant] = useState(false);
  const [participating, setParticipating] = useState<string[]>([]);
  const [explicitParticipating, setExplicitParticipating] = useState(false);
  const [assignmentCounts, setAssignmentCounts] = useState<Record<string, number>>({});
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [catalogItems, setCatalogItems] = useState<Array<{ id: string; code: string; requirement: string; disclosure_code?: string | null }>>([]);
  const [catalogDisclosures, setCatalogDisclosures] = useState<Array<{ id: string; code: string; title: string }>>([]);
  const [staffLists, setStaffLists] = useState<ConsultantStaffList[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [frozen, setFrozen] = useState(false);
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dirty, setDirty] = useState(false);
  const [pendingNav, setPendingNav] = useState<(() => void) | null>(null);
  const toastId = useRef(0);

  const notify = useCallback((kind: 'ok' | 'err', text: string) => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev.slice(-3), { id, kind, text }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((row) => row.id !== id));
    }, 4000);
  }, []);

  const fetchAll = useCallback(async () => {
    if (!tenantId) {
      setError(s.loadFailed);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const [detailRes, svcRes, queueRes, depRes, listsRes, asgRes, itemsRes, discsRes] = await Promise.all([
        apiFetch(`/api/clients/${encodeURIComponent(tenantId)}`, { headers }),
        apiFetch('/api/services', { headers }),
        apiFetch('/api/queue', { headers }),
        apiFetch('/api/departments', { headers }),
        apiFetch('/api/staff-lists', { headers }),
        apiFetch(`/api/assignments?clientId=${encodeURIComponent(tenantId)}`, { headers }),
        apiFetch('/api/items', { headers }),
        apiFetch('/api/disclosures', { headers }),
      ]);
      const detailData = await detailRes.json().catch(() => ({}));
      if (!detailRes.ok) {
        if (isFrozenRefusal(detailData)) setFrozen(true);
        throw new Error((detailData as { error?: string }).error || s.loadFailed);
      }
      const detail = detailData as {
        client?: { suspended?: boolean };
        services?: ConsultantLinkedService[];
        departments?: ConsultantDept[];
        users?: Array<{ id: string; email: string; name: string; must_change_password?: boolean }>;
      };
      setSuspendedTenant(detail.client?.suspended === true);
      setLinked(Array.isArray(detail.services) ? detail.services : []);
      if (Array.isArray(detail.departments)) {
        setDepartments(detail.departments.map((dept) => ({ id: dept.id, code: dept.code ?? null, name: dept.name })));
      }
      setUsers(
        Array.isArray(detail.users)
          ? detail.users.filter((row) => row.must_change_password === true).map((row) => ({ id: row.id, email: row.email, name: row.name, must_change_password: true }))
          : [],
      );
      if (svcRes.ok) {
        const svcData = await svcRes.json().catch(() => []);
        setCatalogue(Array.isArray(svcData) ? svcData : []);
      } else setCatalogue([]);
      if (queueRes.ok) {
        const queueData = await queueRes.json().catch(() => ({}));
        setQueue(Array.isArray((queueData as { items?: unknown }).items) ? (queueData as { items: QueueItem[] }).items : []);
      } else setQueue([]);
      if (depRes.ok) {
        const depData = await depRes.json().catch(() => []);
        if (Array.isArray(depData) && depData.length > 0) {
          setDepartments(depData.map((dept: { id: string; code?: string | null; name: string }) => ({ id: dept.id, code: dept.code ?? null, name: dept.name })));
        }
      }
      if (listsRes.ok) {
        const listsData = await listsRes.json().catch(() => ({}));
        setStaffLists(Array.isArray((listsData as { items?: unknown }).items) ? (listsData as { items: ConsultantStaffList[] }).items : []);
      } else setStaffLists([]);
      if (asgRes.ok) {
        const asgData = await asgRes.json().catch(() => []);
        const counts: Record<string, number> = {};
        if (Array.isArray(asgData)) {
          for (const row of asgData as Array<{ department_id?: string }>) {
            if (row.department_id) counts[row.department_id] = (counts[row.department_id] ?? 0) + 1;
          }
        }
        setAssignmentCounts(counts);
        if (!explicitParticipating) setParticipating(Object.keys(counts));
      } else setAssignmentCounts({});
      if (itemsRes.ok) {
        const itemsData = await itemsRes.json().catch(() => []);
        setCatalogItems(Array.isArray(itemsData) ? itemsData : []);
      } else setCatalogItems([]);
      if (discsRes.ok) {
        const discsData = await discsRes.json().catch(() => []);
        setCatalogDisclosures(Array.isArray(discsData) ? discsData : []);
      } else setCatalogDisclosures([]);
    } catch (err) {
      setError(friendlyError(err, s.loadFailed));
      setLinked([]);
      setQueue([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, token]);

  useEffect(() => {
    if (isConsultant) void fetchAll();
  }, [isConsultant, fetchAll]);

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
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  const requestNav = useCallback((action: () => void) => {
    if (dirty) setPendingNav(() => action);
    else action();
  }, [dirty]);

  const onTabKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const rtl = document.documentElement.dir === 'rtl';
    const index = CONSOLE_TABS.indexOf(tab);
    const delta = event.key === (rtl ? 'ArrowLeft' : 'ArrowRight') ? 1 : event.key === (rtl ? 'ArrowRight' : 'ArrowLeft') ? -1 : 0;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? CONSOLE_TABS.length - 1 : delta ? (index + delta + CONSOLE_TABS.length) % CONSOLE_TABS.length : -1;
    if (next < 0) return;
    event.preventDefault();
    const target = CONSOLE_TABS[next];
    requestNav(() => setTab(target));
    document.getElementById(`consultant-tab-${target}`)?.focus();
  };

  const tabLabel: Record<ConsoleTab, string> = {
    services: s.tabServices,
    matching: s.tabMatching,
    scope: s.tabScope,
    masks: s.tabMasks,
    staff: s.tabStaff,
  };

  const linkedIds = useMemo(() => linked.map((row) => row.id), [linked]);
  const pendingAccounts = useMemo(() => users, [users]);

  if (!isConsultant) {
    return (
      <div role="alert" className="p-8 text-center bg-surface-2 rounded-2xl border border-border">
        <p className="text-sm font-bold text-text">{s.modeMismatch}</p>
        <p className="text-[11px] text-muted mt-1">{s.boundOnlyNote}</p>
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
          <p className="text-[11px] text-muted mt-1">
            {s.boundTenant}: <span className="font-bold text-text" dir="auto">{tenantName}</span>
          </p>
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

      {frozen && (
        <p role="status" className="p-3 rounded-xl bg-warning-soft border border-warning text-warning-text text-xs font-bold flex items-center gap-2">
          <PauseCircle className="w-4 h-4 shrink-0" />
          <span>{s.frozenBanner}</span>
        </p>
      )}

      {suspendedTenant && (
        <p role="alert" className="p-3 rounded-xl bg-danger-soft border border-danger text-danger text-xs font-bold">
          {s.suspendedBanner}
        </p>
      )}

      {!online && (
        <p role="alert" className="p-3 rounded-xl bg-danger-soft border border-danger text-danger text-xs font-bold">
          {s.offlineNote}
        </p>
      )}

      <div aria-live="polite" className="space-y-2">
        {toasts.map((toast) => (
          <p
            key={toast.id}
            role={toast.kind === 'err' ? 'alert' : 'status'}
            className={`p-3 rounded-xl text-[11px] border ${
              toast.kind === 'ok'
                ? 'bg-success-soft text-success-text border-success'
                : 'bg-danger-soft text-danger border-danger'
            }`}
          >
            {toast.text}
          </p>
        ))}
      </div>

      {error && !loading && (
        <div role="alert" className="p-4 rounded-xl bg-danger-soft border border-danger text-danger text-xs flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span className="flex-1 break-words">{error}</span>
          <button
            type="button"
            onClick={() => void fetchAll()}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-danger text-[11px] font-bold"
          >
            <RefreshCw className="w-3 h-3" />
            <span>{t.common.retry}</span>
          </button>
        </div>
      )}

      <p role="note" className="p-3 rounded-xl bg-info-soft border border-info text-info text-[11px] leading-relaxed">
        {s.boundOnlyNote}
      </p>

      <div role="tablist" aria-label={s.title} onKeyDown={onTabKey} className="flex flex-wrap gap-1">
        {CONSOLE_TABS.map((id) => (
          <button
            key={id}
            id={`consultant-tab-${id}`}
            role="tab"
            aria-selected={tab === id}
            aria-controls={`consultant-panel-${id}`}
            onClick={() => requestNav(() => setTab(id))}
            className={`px-4 py-2 rounded-xl text-xs font-bold border transition-colors ${
              tab === id ? 'bg-brand text-brand-ink border-brand' : 'bg-surface-2 text-muted border-border hover:bg-surface-3'
            }`}
          >
            {tabLabel[id]}
            {id === 'staff' && staffLists.some((list) => list.status === 'submitted') && (
              <span className="ms-1.5 px-1.5 py-0.5 rounded-full text-[10px] bg-warning-soft text-warning-text" dir="ltr">
                {staffLists.filter((list) => list.status === 'submitted').length}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start" aria-hidden="true">
          <div className="bg-surface-2 border border-border rounded-2xl p-4 space-y-2">
            <div className="h-10 rounded-xl bg-surface-3 animate-pulse" />
            <div className="h-40 rounded-xl bg-surface-3 animate-pulse" />
          </div>
          <div className="bg-surface-2 border border-border rounded-2xl p-4 space-y-2">
            <div className="h-10 rounded-xl bg-surface-3 animate-pulse" />
            <div className="h-40 rounded-xl bg-surface-3 animate-pulse" />
          </div>
          <span className="sr-only">{t.common.loading}</span>
        </div>
      ) : (
        <>
          <div id="consultant-panel-services" role="tabpanel" aria-labelledby="consultant-tab-services" hidden={tab !== 'services'}>
            {tab === 'services' && (
              <ConsultantServicesTab
                tenantId={tenantId}
                token={token}
                linked={linked}
                catalogue={catalogue}
                departments={departments}
                participating={explicitParticipating ? participating : [...new Set([...participating, ...Object.keys(assignmentCounts)])]}
                assignmentCounts={assignmentCounts}
                frozen={frozen}
                suspended={suspendedTenant}
                onChanged={() => void fetchAll()}
                onDirtyChange={setDirty}
                onParticipatingSaved={(ids) => { setParticipating(ids); setExplicitParticipating(true); }}
                onFrozen={() => setFrozen(true)}
                notify={notify}
              />
            )}
          </div>

          <div id="consultant-panel-matching" role="tabpanel" aria-labelledby="consultant-tab-matching" hidden={tab !== 'matching'}>
            {tab === 'matching' && (
              <ConsultantMatchingTab
                tenantId={tenantId}
                token={token}
                queue={queue}
                catalogue={catalogue}
                linkedIds={linkedIds}
                departments={departments}
                frozen={frozen}
                suspended={suspendedTenant}
                onChanged={() => void fetchAll()}
                onDirtyChange={setDirty}
                onFrozen={() => setFrozen(true)}
                notify={notify}
              />
            )}
          </div>

          <div id="consultant-panel-scope" role="tabpanel" aria-labelledby="consultant-tab-scope" hidden={tab !== 'scope'}>
            {tab === 'scope' && (
              <ConsultantScopeTab
                tenantId={tenantId}
                token={token}
                queue={queue}
                items={catalogItems}
                disclosures={catalogDisclosures}
                departments={departments}
                frozen={frozen}
                suspended={suspendedTenant}
                onChanged={() => void fetchAll()}
                onDirtyChange={setDirty}
                onFrozen={() => setFrozen(true)}
                notify={notify}
              />
            )}
          </div>

          <div id="consultant-panel-masks" role="tabpanel" aria-labelledby="consultant-tab-masks" hidden={tab !== 'masks'}>
            {tab === 'masks' && (
              <ConsultantMasksTab
                token={token}
                linked={linked}
                frozen={frozen}
                suspended={suspendedTenant}
                onChanged={() => void fetchAll()}
                onFrozen={() => setFrozen(true)}
                notify={notify}
              />
            )}
          </div>

          <div id="consultant-panel-staff" role="tabpanel" aria-labelledby="consultant-tab-staff" hidden={tab !== 'staff'}>
            {tab === 'staff' && (
              <ConsultantStaffTab
                token={token}
                lists={staffLists}
                pendingAccounts={pendingAccounts}
                frozen={frozen}
                suspended={suspendedTenant}
                onChanged={() => void fetchAll()}
                onFrozen={() => setFrozen(true)}
                notify={notify}
              />
            )}
          </div>
        </>
      )}

      {pendingNav && (
        <ConfirmDialog
          title={s.unsavedTitle}
          message={`${s.unsavedChanges} ${s.boundOnlyNote}.`}
          confirmLabel={s.confirmDiscard}
          onConfirm={() => {
            const action = pendingNav;
            setPendingNav(null);
            setDirty(false);
            action();
          }}
          onCancel={() => setPendingNav(null)}
        />
      )}
    </div>
  );
};
