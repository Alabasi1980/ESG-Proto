import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Building2, CheckCircle2, PauseCircle, RefreshCw, Users } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import { apiFetch } from '../lib/api.ts';

/**
 * TASK-PROTO-U3-B2 §1 — P Clients page.
 *
 * B17_UI_BINDINGS.md §5 is the binding: the table renders ONLY what
 * GET /api/clients returned for this exact query (no cosmetic filtering, no
 * invented pagination/sort, no scores). Every §5 fallback is displayed instead
 * of a zero: zero assignments ≠ 0 %, missing counts are "unavailable", an
 * unmapped service is named, unknown suspension is never "Active".
 *
 * The pure helpers below are exported so the §5 math and the search epoch are
 * proved in node tests without a browser.
 */

export interface ClientServiceProgress {
  id: string;
  code: string;
  name: string;
  mappedItemCount?: unknown;
  assignedPairCount?: unknown;
  submittedPairCount?: unknown;
  pendingPairCount?: unknown;
  frozenPairCount?: unknown;
  unmapped?: unknown;
}

export interface ClientRow {
  id: string;
  code: string;
  name: string;
  suspended?: unknown;
  services?: unknown;
}

export type ClientStatus = 'active' | 'suspended' | 'unknown';

/** A count is only usable as a number when it is a finite non-negative INTEGER. */
export function readCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

/** §5: `suspended=false` → Active, `true` → Suspended, anything else is unknown
 * (never silently Active). */
export function readStatus(row: { suspended?: unknown }): ClientStatus {
  if (row.suspended === true) return 'suspended';
  if (row.suspended === false) return 'active';
  return 'unknown';
}

export interface ProgressView {
  mapped: number | null;
  assigned: number | null;
  submitted: number | null;
  pending: number | null;
  frozen: number | null;
  /** null unless assigned > 0 AND submitted is known (§5: never 0 % / 100 %). */
  percent: number | null;
}

/** §5 per-service projection: counts only; percentage only when assigned > 0. */
export function readProgress(service: ClientServiceProgress): ProgressView {
  const mapped = readCount(service.mappedItemCount);
  const assigned = readCount(service.assignedPairCount);
  const submitted = readCount(service.submittedPairCount);
  const pending = readCount(service.pendingPairCount);
  const frozen = readCount(service.frozenPairCount);
  const percent = assigned !== null && assigned > 0 && submitted !== null
    ? Math.round((submitted / assigned) * 100)
    : null;
  return { mapped, assigned, submitted, pending, frozen, percent };
}

export function isUnmapped(service: ClientServiceProgress): boolean {
  return service.unmapped === true;
}

/** One server query epoch: a late reply carrying an older requestId is rejected. */
export interface ClientsQuery {
  applied: string;
  requestId: number;
}

export const INITIAL_QUERY: ClientsQuery = { applied: '', requestId: 0 };

export function beginQuery(state: ClientsQuery, search: string): ClientsQuery {
  return { applied: search.trim(), requestId: state.requestId + 1 };
}

export function isCurrentQuery(state: ClientsQuery, requestId: number): boolean {
  return state.requestId === requestId;
}

interface ClientsViewProps {
  /** §2 Enter — App owns the confirm/transition; this only names the row. */
  onEnter: (clientId: string, clientName: string) => void;
  /** §3 Configure — App keeps P and highlights `clients`. */
  onConfigure: (clientId: string, clientName: string) => void;
  /** True while a workspace transition is pending (duplicate clicks suppressed). */
  transitionBusy: boolean;
}

export const ClientsView: React.FC<ClientsViewProps> = ({ onEnter, onConfigure, transitionBusy }) => {
  const { t } = useLanguage();
  const [rows, setRows] = useState<ClientRow[] | null>(null);
  const [query, setQuery] = useState<ClientsQuery>(INITIAL_QUERY);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingRow, setPendingRow] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  // The epoch is a ref so an out-of-order reply can never overwrite a newer one.
  const queryRef = useRef<ClientsQuery>(INITIAL_QUERY);

  const load = useCallback(async (search: string) => {
    const next = beginQuery(queryRef.current, search);
    queryRef.current = next;
    setQuery(next);
    setLoading(true);
    setError(null);
    try {
      const suffix = next.applied ? `?search=${encodeURIComponent(next.applied)}` : '';
      const res = await apiFetch(`/api/clients${suffix}`);
      const data: unknown = await res.json().catch(() => null);
      if (!isCurrentQuery(queryRef.current, next.requestId)) return; // stale response
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error || t.clients.loadFailed);
      if (!Array.isArray(data)) throw new Error(t.clients.loadFailed);
      setRows(data as ClientRow[]);
    } catch (err) {
      if (!isCurrentQuery(queryRef.current, next.requestId)) return;
      setRows(null);
      setError((err as Error)?.message || t.clients.loadFailed);
    } finally {
      if (isCurrentQuery(queryRef.current, next.requestId)) setLoading(false);
    }
  }, [t.clients.loadFailed]);

  useEffect(() => {
    void load(queryRef.current.applied);
  }, [load]);

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    void load(input);
  };

  const clearSearch = () => {
    setInput('');
    void load('');
  };

  const refresh = () => {
    void load(queryRef.current.applied);
  };

  // §5: suspend/unsuspend names client+action, waits for the authoritative
  // refetch and never claims success optimistically. An unknown status offers
  // no mutation (visible, disabled, and truthfully labelled).
  const toggleSuspend = async (row: ClientRow) => {
    const status = readStatus(row);
    if (status === 'unknown' || pendingRow !== null) return;
    const nextSuspended = status === 'active';
    const actionLabel = nextSuspended ? t.clients.suspend : t.clients.unsuspend;
    const confirmText = t.clients.suspendConfirm
      .replace('{action}', actionLabel)
      .replace('{name}', row.name);
    if (!window.confirm(confirmText)) return;
    setPendingRow(row.id);
    setNotice(null);
    try {
      const res = await apiFetch(`/api/clients/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suspended: nextSuspended }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data as { error?: string } | null)?.error || t.clients.saveFailed);
      setNotice({ kind: 'success', text: t.clients.suspendSaved });
    } catch (err) {
      // Uncertain outcome: keep the last confirmed server state + error.
      setNotice({ kind: 'error', text: (err as Error)?.message || t.clients.saveFailed });
    } finally {
      setPendingRow(null);
      await load(queryRef.current.applied); // authoritative refetch before any success claim
    }
  };

  const enterRow = (row: ClientRow) => {
    if (transitionBusy) return;
    const confirmText = t.clients.enterConfirm.replace('{name}', row.name);
    if (!window.confirm(confirmText)) return;
    onEnter(row.id, row.name);
  };

  const unavailable = <span className="text-muted">{t.clients.unavailable}</span>;

  const renderCount = (value: number | null) =>
    value === null ? unavailable : <span dir="ltr">{value}</span>;

  const renderCollection = (progress: ProgressView) => {
    if (progress.assigned === null || progress.submitted === null) {
      return <span>{t.clients.collection}: {unavailable}</span>;
    }
    if (progress.assigned === 0) {
      return (
        <span>
          {t.clients.collection}: <span dir="ltr">—</span> · {t.clients.noAssignments}
        </span>
      );
    }
    return (
      <span>
        {t.clients.collection}:{' '}
        <span dir="ltr">{progress.submitted} / {progress.assigned}</span>
        {progress.percent === null
          ? ` (${t.clients.unavailable})`
          : <span dir="ltr"> ({progress.percent}%)</span>}
      </span>
    );
  };

  const renderFrozen = (progress: ProgressView) => {
    if (progress.frozen === null || progress.assigned === null) {
      return <span>{t.clients.frozenPairs}: {unavailable}</span>;
    }
    if (progress.assigned === 0) {
      return <span>{t.clients.frozenPairs}: <span dir="ltr">—</span></span>;
    }
    return (
      <span>
        {t.clients.frozenPairs}: <span dir="ltr">{progress.frozen} / {progress.assigned}</span>
      </span>
    );
  };

  const renderStatus = (row: ClientRow) => {
    const status = readStatus(row);
    if (status === 'active') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-success-soft text-success-text">
          <CheckCircle2 className="w-3 h-3" />
          <span>{t.clients.active}</span>
        </span>
      );
    }
    if (status === 'suspended') {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-danger-soft text-danger">
          <PauseCircle className="w-3 h-3" />
          <span>{t.clients.suspended}</span>
        </span>
      );
    }
    return <span className="text-muted" aria-label={t.clients.statusUnknown}>—</span>;
  };

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted">{t.clients.subtitle}</p>

      <form
        onSubmit={submitSearch}
        role="search"
        aria-label={t.clients.searchLabel}
        className="p-5 bg-surface-2 rounded-2xl border border-border space-y-3"
      >
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="flex-1 min-w-0">
            <label htmlFor="clients-search" className="block text-xs font-semibold text-text mb-1">
              {t.clients.searchLabel}
            </label>
            <input
              id="clients-search"
              type="search"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={t.clients.searchHint}
              className="w-full px-3 py-2 rounded-xl text-xs bg-surface-3 border border-border-strong text-text placeholder-muted focus:outline-none focus:border-focus-ring focus:ring-2 focus:ring-focus-ring/30"
            />
            <p className="text-[11px] text-muted mt-1">{t.clients.searchHint}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              className="px-4 py-2 rounded-xl text-xs font-bold bg-brand text-brand-ink hover:bg-brand-strong"
            >
              {t.clients.search}
            </button>
            <button
              type="button"
              onClick={clearSearch}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-surface-2 border border-border-strong text-text hover:bg-surface-3"
            >
              {t.clients.clearSearch}
            </button>
            <button
              type="button"
              onClick={refresh}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-surface-2 border border-border-strong text-text hover:bg-surface-3"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>{t.clients.refresh}</span>
            </button>
          </div>
        </div>
      </form>

      {notice && (
        <div
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`p-3 rounded-xl border text-xs ${
            notice.kind === 'error'
              ? 'bg-danger-soft border-danger text-danger'
              : 'bg-success-soft border-success text-success-text'
          }`}
        >
          {notice.text}
        </div>
      )}

      <p role="status" aria-live="polite" className="text-xs text-muted">
        {loading
          ? t.common.loading
          : rows
            ? t.clients.rowCount.replace('{count}', String(rows.length))
            : ''}
      </p>

      {error && !loading && (
        <div role="alert" className="p-4 rounded-2xl bg-danger-soft border border-danger text-danger text-xs flex flex-wrap items-center justify-between gap-3">
          <span>{error}</span>
          <button
            type="button"
            onClick={refresh}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-2 border border-border-strong text-text font-bold"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{t.common.retry}</span>
          </button>
        </div>
      )}

      {!error && !loading && rows && rows.length === 0 && (
        <div className="p-8 bg-surface-2 rounded-2xl border border-border text-center max-w-2xl mx-auto">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-surface-3 flex items-center justify-center text-muted">
            <Users className="w-7 h-7" />
          </div>
          <h3 className="text-base font-bold text-text mb-2">
            {query.applied ? t.clients.emptySearchTitle : t.clients.emptyTitle}
          </h3>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {query.applied && (
              <button
                type="button"
                onClick={clearSearch}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-brand text-brand-ink hover:bg-brand-strong"
              >
                {t.clients.clearSearch}
              </button>
            )}
            <button
              type="button"
              onClick={refresh}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-surface-2 border border-border-strong text-text hover:bg-surface-3"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>{t.clients.refresh}</span>
            </button>
          </div>
        </div>
      )}

      {!error && rows && rows.length > 0 && (
        <div className="bg-surface-2 rounded-2xl border border-border overflow-hidden">
          <div className="overflow-x-auto" role="region" aria-label={t.clients.caption} tabIndex={0}>
            <table className="w-full text-xs">
              <caption className="sr-only">{t.clients.caption}</caption>
              <thead className="bg-surface-3 text-muted">
                <tr>
                  <th scope="col" className="text-start px-4 py-3 font-semibold">{t.clients.colClient}</th>
                  <th scope="col" className="text-start px-4 py-3 font-semibold">{t.clients.colStatus}</th>
                  <th scope="col" className="text-start px-4 py-3 font-semibold">{t.clients.colServices}</th>
                  <th scope="col" className="text-start px-4 py-3 font-semibold">{t.clients.colActions}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const services = Array.isArray(row.services) ? row.services as ClientServiceProgress[] : [];
                  const busy = pendingRow === row.id;
                  const status = readStatus(row);
                  return (
                    <tr key={row.id} className="border-t border-border hover:bg-surface-3 align-top">
                      <td className="px-4 py-3">
                        <div className="font-bold text-text break-words">{row.name}</div>
                        <div dir="ltr" className="text-[11px] text-muted mt-0.5 break-all">{row.code}</div>
                      </td>
                      <td className="px-4 py-3">{renderStatus(row)}</td>
                      <td className="px-4 py-3">
                        {services.length === 0 ? (
                          <span className="text-muted">{t.clients.noLinkedServices}</span>
                        ) : (
                          <ul className="space-y-2">
                            {services.map((service) => {
                              const progress = readProgress(service);
                              return (
                                <li key={service.id} className="p-2 rounded-lg bg-surface-3 border border-border">
                                  <div className="font-semibold text-text break-words">
                                    {service.name}{' '}
                                    <span dir="ltr" className="text-[11px] text-muted">{service.code}</span>
                                  </div>
                                  <div className="mt-1 space-y-0.5 text-[11px] text-text">
                                    {isUnmapped(service) ? (
                                      <div className="inline-flex items-center gap-1 text-warning-text">
                                        <AlertTriangle className="w-3 h-3" />
                                        <span>{t.clients.unmappedService}</span>
                                      </div>
                                    ) : (
                                      <div>
                                        {t.clients.mappedItems}: {renderCount(progress.mapped)}
                                      </div>
                                    )}
                                    <div>{renderCollection(progress)}</div>
                                    <div>
                                      {t.clients.pendingSubmission}: {renderCount(progress.pending)}
                                    </div>
                                    <div>{renderFrozen(progress)}</div>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => enterRow(row)}
                            disabled={transitionBusy || busy}
                            aria-label={`${t.clients.enterWorkspace}: ${row.name}`}
                            className="px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-normal bg-brand text-brand-ink hover:bg-brand-strong disabled:opacity-50"
                          >
                            {t.clients.enterWorkspace}
                          </button>
                          <button
                            type="button"
                            onClick={() => onConfigure(row.id, row.name)}
                            aria-label={`${t.clients.configureClient}: ${row.name}`}
                            className="px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-normal bg-surface-2 border border-border-strong text-text hover:bg-surface-3"
                          >
                            {t.clients.configureClient}
                          </button>
                          <button
                            type="button"
                            onClick={() => void toggleSuspend(row)}
                            disabled={busy || status === 'unknown'}
                            aria-label={status === 'unknown'
                              ? t.clients.statusUnknown
                              : `${status === 'suspended' ? t.clients.unsuspend : t.clients.suspend}: ${row.name}`}
                            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-normal disabled:opacity-50 ${
                              status === 'suspended'
                                ? 'border border-brand text-brand-text hover:bg-brand-soft'
                                : 'border border-danger text-danger hover:bg-danger-soft'
                            }`}
                          >
                            {status === 'suspended' ? t.clients.unsuspend : t.clients.suspend}
                          </button>
                          {busy && (
                            <span role="status" className="inline-flex items-center gap-1 text-[11px] text-muted">
                              <RefreshCw className="w-3 h-3 animate-spin" />
                              <span>{t.common.loading}</span>
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {loading && !rows && (
        <div className="p-8 bg-surface-2 rounded-2xl border border-border text-center">
          <Building2 className="w-7 h-7 mx-auto mb-3 text-muted" />
          <p className="text-xs text-muted">{t.common.loading}</p>
        </div>
      )}
    </div>
  );
};
