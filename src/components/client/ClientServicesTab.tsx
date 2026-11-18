import React, { useMemo, useState } from 'react';
import { Building2, RefreshCw, Search, AlertTriangle, PauseCircle, FileText } from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext.tsx';
import type { QueueItem } from '../../views/EvaluationPanel.tsx';
import type { ServiceRow } from '../services/ServiceRail.tsx';
import { matches } from '../services/ServiceContentPanel.tsx';
import {
  consoleStatusLabel,
  groupReviewByService,
  itemsForService,
  type ConsoleReviewGroup,
  type LinkedService,
} from './clientConsole.ts';

interface ClientServicesTabProps {
  services: LinkedService[];
  catalogue: ServiceRow[];
  groups: ConsoleReviewGroup[];
  queue: QueueItem[];
  loading: boolean;
  error: string | null;
  frozen: boolean;
  onRetry: () => void;
}

const STATUS_STYLES: Record<string, string> = {
  not_evaluated: 'bg-surface-3 text-muted',
  draft: 'bg-info-soft text-info',
  submitted: 'bg-warning-soft text-warning-text',
  approved: 'bg-success-soft text-success-text',
  client_approved: 'bg-accent-soft text-text',
  returned: 'bg-danger-soft text-danger',
  not_applicable: 'bg-surface-3 text-muted',
};

/**
 * TASK-PROTO-U4-3 unit (b) — linked services read-only drill for the client.
 *
 * UI composition ONLY over existing APIs (dashboard services, client-review
 * queue, queue, services catalogue). Standard → disclosure → dept rows, plus a
 * read-only item panel. No answer inputs, no attachment uploads, no N/A
 * controls, no evaluation/score editing — C NEVER answers (INV-C-NEVER-ANSWERS).
 * Scores shown are the server-provided dept-approved review scores and company
 * aggregates only (spec UI-2/UI-5 + API-5 matrix: C confirm/reopen own-tenant).
 */
export const ClientServicesTab: React.FC<ClientServicesTabProps> = ({
  services,
  catalogue,
  groups,
  queue,
  loading,
  error,
  frozen,
  onRetry,
}) => {
  const { t } = useLanguage();
  const s = t.clientConsole;
  const [search, setSearch] = useState('');
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);

  const serviceGroups = useMemo(() => groupReviewByService(groups, catalogue), [groups, catalogue]);

  const visibleServices = useMemo(() => {
    const query = search.trim();
    if (!query) return services;
    return services.filter((svc) => matches(query, svc.name, svc.code));
  }, [services, search]);

  const activeId = selectedService ?? serviceGroups[0]?.id ?? services[0]?.id ?? null;
  const activeGroup = serviceGroups.find((g) => g.id === activeId) ?? null;
  const activeService = services.find((svc) => svc.id === activeId)
    ?? services.find((svc) => svc.code === activeGroup?.code) ?? null;

  const standardCodes = useMemo(() => {
    if (!activeGroup || activeGroup.fallback) return [activeGroup?.code ?? ''];
    const svc = catalogue.find((c) => c.id === activeGroup.id);
    return (svc?.standards ?? []).map((ref) => ref.code);
  }, [activeGroup, catalogue]);

  const serviceItems = useMemo(() => itemsForService(queue, standardCodes), [queue, standardCodes]);
  const itemById = useMemo(() => {
    const map = new Map(serviceItems.map((row) => [`${row.item_id}::${row.department_id}`, row]));
    return map;
  }, [serviceItems]);
  const detail: QueueItem | null = (selectedItem ? itemById.get(selectedItem) : undefined) ?? null;

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
          onClick={onRetry}
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
      {frozen && (
        <p role="status" className="p-3 rounded-xl bg-warning-soft border border-warning text-warning-text text-xs font-bold flex items-center gap-2">
          <PauseCircle className="w-4 h-4 shrink-0" />
          <span>{s.frozenBanner}</span>
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-4 items-start">
        {/* Rail: own-tenant linked services with confirmed-path counts */}
        <div className="bg-surface-2 border border-border rounded-2xl p-3">
          <div className="flex items-center gap-2 px-1 mb-2">
            <Building2 className="w-4 h-4 text-muted" />
            <span className="text-xs font-bold text-text">{s.railTitle} ({services.length})</span>
          </div>
          <label className="sr-only" htmlFor="client-svc-search">{s.railSearchLabel}</label>
          <div className="relative mb-2">
            <Search className="w-3.5 h-3.5 absolute start-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              id="client-svc-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={s.railSearchPh}
              className="w-full ps-8 pe-3 py-2 rounded-xl text-xs border border-border-strong bg-surface-3 text-text placeholder-muted"
            />
          </div>
          {services.length === 0 ? (
            <div className="p-4 text-center">
              <p className="text-xs font-bold text-text mb-1">{s.railEmpty}</p>
              <p className="text-[11px] text-muted">{s.railEmptyHint}</p>
            </div>
          ) : visibleServices.length === 0 ? (
            <p className="p-4 text-center text-[11px] text-muted">{s.emptySearch}</p>
          ) : (
            <ul className="space-y-1.5 max-h-[60vh] overflow-y-auto">
              {visibleServices.map((svc) => {
                const roll = serviceGroups.find((g) => g.id === svc.id || (!g.fallback && g.code === svc.code));
                const active = svc.id === activeId;
                return (
                  <li key={svc.id}>
                    <button
                      type="button"
                      onClick={() => { setSelectedService(svc.id); setSelectedItem(null); }}
                      className={`w-full text-start p-3 rounded-xl border transition-colors ${
                        active ? 'border-brand bg-brand-soft' : 'border-border hover:bg-surface-3'
                      }`}
                    >
                      <div className="text-[11px] font-bold text-text truncate" dir="auto">{svc.name}</div>
                      <div className="text-[10px] text-muted mt-0.5" dir="ltr">{svc.code}</div>
                      <div className="text-[10px] text-muted mt-1">
                        {s.countsAssigned} <span dir="ltr">{roll?.assigned ?? 0}</span>
                        {' · '}{s.countsSubmitted} <span dir="ltr">{roll?.confirmed ?? 0}</span>
                        {' · '}{s.countsPending} <span dir="ltr">{roll?.pending ?? 0}</span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Drill: standard → disclosure → dept rows (read-only) + item panel */}
        <div className="bg-surface-2 border border-border rounded-2xl p-4 space-y-3">
          {!activeGroup ? (
            <div className="p-8 text-center">
              <p className="text-xs font-bold text-text mb-1">{s.drillEmpty}</p>
              <p className="text-[11px] text-muted">{activeService ? s.selectServiceHint : s.drillEmptyHint}</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-bold text-text" dir="auto">{activeGroup.name}</h4>
                  <p className="text-[10px] text-muted" dir="ltr">{activeGroup.code}</p>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-surface-3 text-muted">
                  <span dir="ltr">{activeGroup.completeness}%</span>
                </span>
              </div>
              <div className="h-2 rounded-full bg-surface-3 overflow-hidden" dir="ltr">
                <div className="h-full bg-brand rounded-full transition-all" style={{ width: `${activeGroup.completeness}%` }} />
              </div>
              <p className="text-[11px] text-muted">{s.detailLinkedNote}</p>

              {activeGroup.groups.length === 0 ? (
                <div className="p-4 text-center">
                  <p className="text-xs font-bold text-text mb-1">{s.drillEmpty}</p>
                  <p className="text-[11px] text-muted">{s.drillEmptyHint}</p>
                </div>
              ) : (
                <ul className="space-y-3">
                  {activeGroup.groups.map((g) => (
                    <li key={g.disclosureId} className="p-3 rounded-xl border border-border">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-bold text-text">
                          <span dir="ltr">{g.disclosureCode}</span>
                          {' — '}<span dir="auto">{g.disclosureTitle}</span>
                        </span>
                        {g.fullyClientApproved ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-accent-soft text-text">{t.gapAnalysis.stClientApproved}</span>
                        ) : g.readyForClient ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-success-soft text-success-text">{t.clientReview.readyBadge}</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-warning-soft text-warning-text">{t.clientReview.blockedBadge}</span>
                        )}
                      </div>
                      <div className="mt-2">
                        <div className="text-[10px] text-muted mb-1">{s.deptRowsTitle} ({g.departments.length})</div>
                        <ul className="space-y-1.5">
                          {g.departments.map((d) => {
                            return (
                              <li
                                key={`${g.disclosureId}::${d.departmentId}`}
                                className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg bg-surface-3 border border-border"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="text-[11px] font-semibold text-text truncate" dir="auto">{d.departmentName}</span>
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${STATUS_STYLES[d.answerStatus ?? ''] || STATUS_STYLES.not_evaluated}`}>
                                    {consoleStatusLabel(d.answerStatus, t)}
                                  </span>
                                  {typeof d.score === 'number' && (
                                    <span className="text-[10px] font-mono text-muted" dir="ltr">{d.score}</span>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const hit = serviceItems.find(
                                      (row) => row.department_id === d.departmentId && row.disclosure_code === g.disclosureCode,
                                    );
                                    setSelectedItem(hit ? `${hit.item_id}::${hit.department_id}` : null);
                                    if (hit) {
                                      document.getElementById('client-item-detail')?.scrollIntoView({ block: 'nearest' });
                                    }
                                  }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border-strong text-text text-[11px] font-bold hover:bg-surface-3"
                                >
                                  <FileText className="w-3 h-3" />
                                  <span>{t.common.view}</span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {/* Read-only item panel: requirement + status + entitled score only */}
              <div id="client-item-detail" className="pt-1">
                {!detail ? (
                  <p className="text-[11px] text-muted p-3 rounded-xl border border-border text-center">{s.selectServiceHint}</p>
                ) : (
                  <div className="p-3.5 rounded-xl border border-brand bg-brand-soft">
                    <div className="text-[11px] font-mono font-bold text-brand-text" dir="ltr">{detail.code}</div>
                    <div className="mt-1">
                      <span className="text-[10px] font-bold text-muted">{s.itemRequirement}: </span>
                      <span className="text-xs text-text leading-relaxed" dir="auto">{detail.requirement}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="text-muted">{s.itemStatusLabel}:</span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${STATUS_STYLES[detail.answer_status ?? detail.status] || STATUS_STYLES.not_evaluated}`}>
                        {consoleStatusLabel(detail.answer_status ?? detail.status, t)}
                      </span>
                      {(detail.answer_status === 'approved' || detail.answer_status === 'client_approved') && typeof detail.score === 'number' && (
                        <span className="text-muted">{s.itemScoreLabel}: <span className="font-mono" dir="ltr">{detail.score}</span></span>
                      )}
                      <span className="text-muted" dir="auto">{detail.department_name}</span>
                    </div>
                    <p className="mt-2 text-[10px] text-muted leading-relaxed">{s.scoreEntitlementNote}</p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {services.length > 0 && activeGroup && activeGroup.groups.length > 0 && (
        <p role="note" className="text-[10px] text-muted flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>{s.reviewTabNote}</span>
        </p>
      )}
    </div>
  );
};
