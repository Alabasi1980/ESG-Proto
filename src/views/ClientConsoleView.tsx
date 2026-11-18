import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw, Wifi, WifiOff, PauseCircle } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { apiFetch } from '../lib/api.ts';
import { friendlyError, isFrozenRefusal } from './ServicesView.tsx';
import type { QueueItem } from './EvaluationPanel.tsx';
import type { ServiceRow } from '../components/services/ServiceRail.tsx';
import { ClientReviewView } from './ClientReviewView.tsx';
import { ConfirmDialog } from '../components/employee/ConfirmDialog.tsx';
import { ClientServicesTab } from '../components/client/ClientServicesTab.tsx';
import { ClientStaffSection } from '../components/client/ClientStaffSection.tsx';
import type { ConsoleReviewGroup, LinkedService } from '../components/client/clientConsole.ts';

const CONSOLE_TABS = ['services', 'review', 'staff'] as const;
type ConsoleTab = (typeof CONSOLE_TABS)[number];

interface Toast {
  id: number;
  kind: 'ok' | 'err';
  text: string;
}

/**
 * TASK-PROTO-U4-3 unit (b) — client console (own tenant only).
 *
 * CHOICE: new view (preferred per task) rather than extending ClientReviewView.
 * WHY: the console composes three concerns (linked-services read, preliminary
 * confirm, staff draft/submit) with its own rail/tabs/state; growing
 * ClientReviewView into that would overload the review queue component and
 * duplicate its confirm flow. ClientReviewView is REUSED as-is inside the
 * review tab (composition, not duplication). Mounted on the existing C
 * `gap-analysis` slot (App role-gate); no nav-matrix change.
 *
 * UI composition ONLY over existing APIs: GET /api/client/dashboard (linked
 * services + aggregates), GET /api/client-review (dept preliminary queue),
 * the client confirm / client return paths (via ClientReviewView),
 * GET /api/queue + GET /api/services (read-only drill), GET /api/departments +
 * POST /api/staff-lists + POST /api/staff-lists/:id/submit (staff fill part 1).
 * No new endpoints, no new semantics. C NEVER answers/attaches/N/A-marks/
 * rates items (INV-C-NEVER-ANSWERS); C writes are confirm/return with comment
 * and staff draft/submit only. C sees the server-provided dept-approved review
 * scores and company aggregates (spec UI-2/UI-5 + API-5 matrix row: C
 * confirm/reopen own-tenant, deny answer) — no evaluator identity, no
 * correction internals, no OTPs/passwords.
 */
export const ClientConsoleView: React.FC = () => {
  const { t } = useLanguage();
  const { user, token } = useAuth();
  const s = t.clientConsole;
  const isClient = user?.role === 'client_admin';
  const tenantId = user?.clientId ?? '';

  const [tab, setTab] = useState<ConsoleTab>('services');
  const [services, setServices] = useState<LinkedService[]>([]);
  const [catalogue, setCatalogue] = useState<ServiceRow[]>([]);
  const [groups, setGroups] = useState<ConsoleReviewGroup[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [frozen, setFrozen] = useState(false);
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [staffDirty, setStaffDirty] = useState(false);
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
      const [dashRes, reviewRes, queueRes] = await Promise.all([
        apiFetch('/api/client/dashboard', { headers }),
        apiFetch(`/api/client-review?clientId=${encodeURIComponent(tenantId)}`, { headers }),
        apiFetch('/api/queue', { headers }),
      ]);
      const dashData = await dashRes.json().catch(() => ({}));
      if (!dashRes.ok) {
        if (isFrozenRefusal(dashData)) setFrozen(true);
        throw new Error((dashData as { error?: string }).error || s.loadFailed);
      }
      setServices(Array.isArray((dashData as { services?: unknown }).services)
        ? (dashData as { services: LinkedService[] }).services : []);
      const reviewData = await reviewRes.json().catch(() => ({}));
      if (!reviewRes.ok) {
        if (isFrozenRefusal(reviewData)) setFrozen(true);
        throw new Error((reviewData as { error?: string }).error || s.loadFailed);
      }
      setGroups(Array.isArray((reviewData as { groups?: unknown }).groups)
        ? (reviewData as { groups: ConsoleReviewGroup[] }).groups : []);
      if (queueRes.ok) {
        const queueData = await queueRes.json().catch(() => ({}));
        setQueue(Array.isArray((queueData as { items?: unknown }).items)
          ? (queueData as { items: QueueItem[] }).items : []);
      } else {
        setQueue([]);
      }
      try {
        const svcRes = await apiFetch('/api/services', { headers });
        if (svcRes.ok) {
          const svcData = await svcRes.json();
          setCatalogue(Array.isArray(svcData) ? svcData : []);
        } else {
          setCatalogue([]);
        }
      } catch {
        setCatalogue([]);
      }
      try {
        const depRes = await apiFetch('/api/departments', { headers });
        if (depRes.ok) {
          const depData = await depRes.json();
          setDepartments(Array.isArray(depData) ? depData : []);
        }
      } catch {
        /* departments stay empty: the staff form degrades to no-dept options */
      }
    } catch (err) {
      setError(friendlyError(err, s.loadFailed));
      setServices([]);
      setGroups([]);
      setQueue([]);
    } finally {
      setLoading(false);
    }
  }, [tenantId, token, s.loadFailed]);

  useEffect(() => {
    if (isClient) void fetchAll();
  }, [isClient, fetchAll]);

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
    if (!staffDirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [staffDirty]);

  /** Dirty-guarded tab switches: the staff draft is never lost silently. */
  const requestNav = useCallback((action: () => void) => {
    if (staffDirty) setPendingNav(() => action);
    else action();
  }, [staffDirty]);

  const onTabKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const rtl = document.documentElement.dir === 'rtl';
    const index = CONSOLE_TABS.indexOf(tab);
    const delta = event.key === (rtl ? 'ArrowLeft' : 'ArrowRight') ? 1 : event.key === (rtl ? 'ArrowRight' : 'ArrowLeft') ? -1 : 0;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? CONSOLE_TABS.length - 1 : delta ? (index + delta + CONSOLE_TABS.length) % CONSOLE_TABS.length : -1;
    if (next < 0) return;
    event.preventDefault();
    const target = CONSOLE_TABS[next];
    requestNav(() => setTab(target));
    document.getElementById(`client-tab-${target}`)?.focus();
  };

  const tabLabel: Record<ConsoleTab, string> = { services: s.tabServices, review: s.tabReview, staff: s.tabStaff };
  const reviewPending = useMemo(
    () => groups.reduce((n, g) => n + g.departments.filter((d) => d.answerStatus === 'approved').length, 0),
    [groups],
  );

  if (!isClient) {
    return (
      <div role="alert" className="p-8 text-center bg-surface-2 rounded-2xl border border-border">
        <p className="text-sm font-bold text-text">{s.loadFailed}</p>
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

      {frozen && (
        <p role="status" className="p-3 rounded-xl bg-warning-soft border border-warning text-warning-text text-xs font-bold flex items-center gap-2">
          <PauseCircle className="w-4 h-4 shrink-0" />
          <span>{s.frozenBanner}</span>
        </p>
      )}

      {!online && (
        <p role="alert" className="p-3 rounded-xl bg-danger-soft border border-danger text-danger text-xs font-bold">
          {t.common.disconnected}
        </p>
      )}

      {/* Toasts: success / failure / warning */}
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

      <div role="tablist" aria-label={s.title} onKeyDown={onTabKey} className="flex flex-wrap gap-1">
        {CONSOLE_TABS.map((id) => (
          <button
            key={id}
            id={`client-tab-${id}`}
            role="tab"
            aria-selected={tab === id}
            aria-controls={`client-panel-${id}`}
            onClick={() => requestNav(() => setTab(id))}
            className={`px-4 py-2 rounded-xl text-xs font-bold border transition-colors ${
              tab === id ? 'bg-brand text-brand-ink border-brand' : 'bg-surface-2 text-muted border-border hover:bg-surface-3'
            }`}
          >
            {tabLabel[id]}
            {id === 'review' && reviewPending > 0 && (
              <span className="ms-1.5 px-1.5 py-0.5 rounded-full text-[10px] bg-warning-soft text-warning-text" dir="ltr">
                {reviewPending}
              </span>
            )}
          </button>
        ))}
      </div>

      <div id="client-panel-services" role="tabpanel" aria-labelledby="client-tab-services" hidden={tab !== 'services'}>
        {tab === 'services' && (
          <ClientServicesTab
            services={services}
            catalogue={catalogue}
            groups={groups}
            queue={queue}
            loading={loading}
            error={error}
            frozen={frozen}
            onRetry={() => void fetchAll()}
          />
        )}
      </div>

      <div id="client-panel-review" role="tabpanel" aria-labelledby="client-tab-review" hidden={tab !== 'review'}>
        {tab === 'review' && (
          <div className="space-y-3">
            <p role="note" className="p-3 rounded-xl bg-info-soft border border-info text-info text-[11px] leading-relaxed">
              {s.reviewTabNote}
            </p>
            <ClientReviewView onChanged={() => void fetchAll()} />
          </div>
        )}
      </div>

      <div id="client-panel-staff" role="tabpanel" aria-labelledby="client-tab-staff" hidden={tab !== 'staff'}>
        {tab === 'staff' && (
          <div className="p-4 sm:p-5 bg-surface-2 rounded-2xl border border-border">
            <ClientStaffSection
              departments={departments}
              frozen={frozen}
              onDirtyChange={setStaffDirty}
              onFrozen={() => setFrozen(true)}
              notify={notify}
            />
          </div>
        )}
      </div>

      {pendingNav && (
        <ConfirmDialog
          title={s.unsavedTitle}
          message={`${s.unsavedChanges} ${s.draftStaleNote}.`}
          confirmLabel={s.confirmDiscard}
          onConfirm={() => {
            const action = pendingNav;
            setPendingNav(null);
            setStaffDirty(false);
            action();
          }}
          onCancel={() => setPendingNav(null)}
        />
      )}
    </div>
  );
};
