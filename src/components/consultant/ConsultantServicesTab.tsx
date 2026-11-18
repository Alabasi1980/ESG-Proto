import React, { useMemo, useState } from 'react';
import { Building2, Link2, RefreshCw, Search, Unlink } from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext.tsx';
import type { ServiceRow } from '../services/ServiceRail.tsx';
import { matches } from '../services/ServiceContentPanel.tsx';
import { friendlyError, isFrozenRefusal } from '../../views/ServicesView.tsx';
import {
  consultantHeaders,
  type ConsultantDept,
  type ConsultantLinkedService,
} from './consultantConsole.ts';

interface ConsultantServicesTabProps {
  tenantId: string;
  token: string | null;
  linked: ConsultantLinkedService[];
  catalogue: ServiceRow[];
  departments: ConsultantDept[];
  participating: string[];
  assignmentCounts: Record<string, number>;
  frozen: boolean;
  suspended: boolean;
  onChanged: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onParticipatingSaved: (ids: string[]) => void;
  onFrozen: () => void;
  notify: (kind: 'ok' | 'err', text: string) => void;
}

/**
 * TASK-PROTO-U4-3 unit (c2) — W service linking + participating departments.
 *
 * Writes ONLY the c1 workspace routes (bound A, no tenant picker):
 * POST /api/workspace/client-services (409 service.link_conflict surfaced),
 * DELETE …/:serviceId (409 service.unlink_blocked surfaced),
 * PUT /api/workspace/participating-departments (409 participating.dept_has_work).
 * Reads are the pre-existing catalogue/department projections. Departments
 * carrying assignments show a has-work badge; removing one is refused by the
 * server and the refusal is shown honestly (no invented unassign flow).
 */
export const ConsultantServicesTab: React.FC<ConsultantServicesTabProps> = ({
  tenantId,
  token,
  linked,
  catalogue,
  departments,
  participating,
  assignmentCounts,
  frozen,
  suspended,
  onChanged,
  onDirtyChange,
  onParticipatingSaved,
  onFrozen,
  notify,
}) => {
  const { t } = useLanguage();
  const s = t.consultantConsole;
  const [search, setSearch] = useState('');
  const [linking, setLinking] = useState<string | null>(null);
  const [confirmUnlink, setConfirmUnlink] = useState<string | null>(null);
  const [unlinking, setUnlinking] = useState(false);
  const [picked, setPicked] = useState<string[]>(participating);
  const [saving, setSaving] = useState(false);

  const linkedIds = useMemo(() => new Set(linked.map((row) => row.id)), [linked]);

  const unlinkedCatalogue = useMemo(() => {
    const query = search.trim();
    const rows = catalogue.filter((svc) => !linkedIds.has(svc.id));
    if (!query) return rows;
    return rows.filter((svc) => matches(query, svc.name, svc.code));
  }, [catalogue, linkedIds, search]);

  const locked = frozen || suspended;

  const handleLink = async (serviceId: string) => {
    if (locked) {
      notify('err', frozen ? s.frozenBanner : s.suspendedBanner);
      return;
    }
    setLinking(serviceId);
    try {
      const res = await fetch('/api/workspace/client-services', {
        method: 'POST',
        headers: consultantHeaders(token),
        body: JSON.stringify({ serviceId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (isFrozenRefusal(data)) onFrozen();
        throw new Error((data as { error?: string }).error || s.actionFailed);
      }
      notify('ok', s.svcLink);
      onChanged();
    } catch (err) {
      notify('err', friendlyError(err, s.actionFailed));
    } finally {
      setLinking(null);
    }
  };

  const handleUnlink = async (serviceId: string) => {
    if (locked) {
      notify('err', frozen ? s.frozenBanner : s.suspendedBanner);
      return;
    }
    setUnlinking(true);
    try {
      const res = await fetch(`/api/workspace/client-services/${encodeURIComponent(serviceId)}`, {
        method: 'DELETE',
        headers: consultantHeaders(token),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (isFrozenRefusal(data)) onFrozen();
        throw new Error((data as { error?: string }).error || s.actionFailed);
      }
      setConfirmUnlink(null);
      notify('ok', s.svcUnlink);
      onChanged();
    } catch (err) {
      notify('err', friendlyError(err, s.actionFailed));
    } finally {
      setUnlinking(false);
    }
  };

  const toggleDept = (id: string) => {
    setPicked((prev) => {
      const next = prev.includes(id) ? prev.filter((row) => row !== id) : [...prev, id];
      onDirtyChange(next.join(',') !== participating.join(','));
      return next;
    });
  };

  const handleSaveParticipating = async () => {
    if (locked) {
      notify('err', frozen ? s.frozenBanner : s.suspendedBanner);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/workspace/participating-departments', {
        method: 'PUT',
        headers: consultantHeaders(token),
        body: JSON.stringify({ departmentIds: picked, clientId: tenantId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (isFrozenRefusal(data)) onFrozen();
        throw new Error((data as { error?: string }).error || s.actionFailed);
      }
      onDirtyChange(false);
      notify('ok', s.svcParticipatingSaved);
      onParticipatingSaved([...picked]);
      onChanged();
    } catch (err) {
      notify('err', friendlyError(err, s.actionFailed));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      <section aria-label={s.svcLinkedTitle} className="bg-surface-2 border border-border rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-muted" />
          <h4 className="text-sm font-bold text-text">{s.svcLinkedTitle} ({linked.length})</h4>
        </div>
        {linked.length === 0 ? (
          <p className="text-[11px] text-muted p-4 text-center border border-border rounded-xl">{s.svcLinkedEmpty}</p>
        ) : (
          <ul className="space-y-2">
            {linked.map((svc) => (
              <li key={svc.id} className="p-3 rounded-xl border border-border bg-surface-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-text truncate" dir="auto">{svc.name}</div>
                    <div className="text-[10px] text-muted" dir="ltr">{svc.code}</div>
                  </div>
                  {confirmUnlink === svc.id ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={unlinking}
                        onClick={() => void handleUnlink(svc.id)}
                        className="px-3 py-1.5 rounded-lg bg-danger text-brand-ink text-[11px] font-bold disabled:opacity-50"
                      >
                        {s.svcUnlinkConfirm}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmUnlink(null)}
                        className="px-3 py-1.5 rounded-lg border border-border-strong text-text text-[11px] font-bold"
                      >
                        {s.svcUnlinkCancel}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => setConfirmUnlink(svc.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-danger text-danger text-[11px] font-bold disabled:opacity-50"
                    >
                      <Unlink className="w-3 h-3" />
                      <span>{s.svcUnlink}</span>
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="space-y-4">
        <section aria-label={s.svcCatalogTitle} className="bg-surface-2 border border-border rounded-2xl p-4 space-y-3">
          <h4 className="text-sm font-bold text-text">{s.svcCatalogTitle}</h4>
          <label className="sr-only" htmlFor="consultant-svc-search">{s.svcSearchPh}</label>
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute start-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              id="consultant-svc-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={s.svcSearchPh}
              className="w-full ps-8 pe-3 py-2 rounded-xl text-xs border border-border-strong bg-surface-3 text-text placeholder-muted"
            />
          </div>
          {catalogue.length === 0 ? (
            <p className="text-[11px] text-muted text-center">{s.svcNoCatalog}</p>
          ) : unlinkedCatalogue.length === 0 ? (
            <p className="text-[11px] text-muted text-center">{search.trim() ? s.emptySearch : s.svcCatalogEmpty}</p>
          ) : (
            <ul className="space-y-2 max-h-[40vh] overflow-y-auto">
              {unlinkedCatalogue.map((svc) => (
                <li key={svc.id} className="flex items-center justify-between gap-2 p-2.5 rounded-xl border border-border">
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold text-text truncate" dir="auto">{svc.name}</div>
                    <div className="text-[10px] text-muted" dir="ltr">{svc.code}</div>
                  </div>
                  <button
                    type="button"
                    disabled={linking !== null || locked}
                    onClick={() => void handleLink(svc.id)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-brand text-brand-ink text-[11px] font-bold disabled:opacity-50 shrink-0"
                  >
                    <Link2 className="w-3 h-3" />
                    <span>{linking === svc.id ? s.svcLinking : s.svcLink}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label={s.svcParticipatingTitle} className="bg-surface-2 border border-border rounded-2xl p-4 space-y-3">
          <div>
            <h4 className="text-sm font-bold text-text">{s.svcParticipatingTitle}</h4>
            <p className="text-[11px] text-muted mt-0.5 leading-relaxed">{s.svcParticipatingHint}</p>
          </div>
          {departments.length === 0 ? (
            <p className="text-[11px] text-muted p-4 text-center border border-border rounded-xl">{s.svcLinkedEmpty}</p>
          ) : (
            <ul className="space-y-1.5">
              {departments.map((dept) => {
                const work = assignmentCounts[dept.id] ?? 0;
                return (
                  <li key={dept.id}>
                    <label className="flex items-center justify-between gap-2 p-2.5 rounded-xl border border-border cursor-pointer hover:bg-surface-3">
                      <span className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={picked.includes(dept.id)}
                          onChange={() => toggleDept(dept.id)}
                          disabled={locked}
                          className="w-4 h-4 accent-brand"
                        />
                        <span className="text-[11px] font-semibold text-text truncate" dir="auto">{dept.name}</span>
                        {dept.code && (
                          <span className="text-[10px] text-muted font-mono" dir="ltr">{dept.code}</span>
                        )}
                      </span>
                      {work > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-info-soft text-info shrink-0">
                          {s.svcHasWork} · <span dir="ltr">{work}</span>
                        </span>
                      )}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <button
            type="button"
            disabled={saving || locked}
            onClick={() => void handleSaveParticipating()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand text-brand-ink text-xs font-bold disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${saving ? 'animate-spin' : ''}`} />
            <span>{saving ? s.svcSaving : s.svcSaveParticipating}</span>
          </button>
        </section>
      </div>
    </div>
  );
};
