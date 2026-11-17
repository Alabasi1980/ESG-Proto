import React, { useState } from 'react';
import { AlertTriangle, Plus, RefreshCw, Search, X } from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext.tsx';

/**
 * TASK-PROTO-U4-2 §2 — the services rail (master column).
 *
 * WHY here: the rail is the ONE place the screen's primary action lives
 * («خدمة جديدة»), so it is a component with local form state only — it owns no
 * fetch and no page state. All server writes arrive as `onCreate`; the parent
 * refreshes authoritatively and reports the outcome back through props.
 */

export interface ServiceStandardRef {
  id: string;
  code: string;
  title: string;
}

export interface ServiceRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  created_at?: string;
  standards: ServiceStandardRef[];
  standard_count?: number;
}

export interface ServiceCounts {
  standards: number;
  disclosures: number;
  items: number;
}

export interface NewServiceInput {
  code: string;
  name: string;
  description: string;
}

interface ServiceRailProps {
  services: ServiceRow[];
  /** Unfiltered catalogue size: the badge is the TOTAL, never the search result
   * (P2-10 — a filtered "0" would read as "no services at all"). */
  total: number;
  countsOf: (service: ServiceRow) => ServiceCounts;
  selectedId: string | null;
  onSelect: (id: string) => void;
  search: string;
  onSearch: (value: string) => void;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onCreate: (input: NewServiceInput) => Promise<boolean>;
  creating: boolean;
  createError: string | null;
}

const inputCls =
  'w-full px-3 py-2 rounded-xl text-xs bg-surface-3 border border-border-strong text-text placeholder-muted focus:outline-none focus:border-focus-ring focus:ring-2 focus:ring-focus-ring/30';

export const ServiceRail: React.FC<ServiceRailProps> = ({
  services,
  total,
  countsOf,
  selectedId,
  onSelect,
  search,
  onSearch,
  loading,
  error,
  onRetry,
  onCreate,
  creating,
  createError,
}) => {
  const { t } = useLanguage();
  const s = t.servicesWorkspace;
  const [formOpen, setFormOpen] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const ok = await onCreate({ code: code.trim(), name: name.trim(), description: description.trim() });
    if (ok) {
      setCode('');
      setName('');
      setDescription('');
      setFormOpen(false);
    }
  };

  const nothingAtAll = !loading && !error && services.length === 0 && !search.trim();

  return (
    <aside aria-label={t.services.listTitle} className="bg-surface-2 border border-border rounded-2xl p-3 space-y-3 lg:sticky lg:top-0 lg:self-start lg:max-h-[calc(100vh-1rem)] lg:overflow-y-auto">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-bold text-text">{t.services.listTitle}</h2>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-surface-3 text-muted" dir="ltr">
          {total}
        </span>
      </div>

      <div>
        <label htmlFor="svc-rail-search" className="block text-[11px] font-semibold text-text mb-1">
          {s.railSearchLabel}
        </label>
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-muted absolute top-2.5 start-2.5 pointer-events-none" />
          <input
            id="svc-rail-search"
            type="search"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder={s.railSearchPh}
            className={`${inputCls} ps-8`}
          />
        </div>
      </div>

      {formOpen ? (
        <form onSubmit={submit} className="p-3 rounded-xl bg-surface-3 border border-border space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold text-text">{t.services.createButton}</span>
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              aria-label={t.common.close}
              className="p-1 rounded-lg text-muted hover:bg-surface-2 focus:outline-none focus:ring-2 focus:ring-focus-ring/30"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder={t.services.codeLabel}
            dir="ltr"
            required
            className={inputCls}
          />
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t.services.nameLabel}
            required
            className={inputCls}
          />
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t.services.descLabel}
            className={inputCls}
          />
          {createError && (
            <p role="alert" className="text-[11px] text-danger">
              {createError}
            </p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={creating || !code.trim() || !name.trim()}
              className="flex-1 px-3 py-2 rounded-xl text-[11px] font-bold bg-brand text-brand-ink hover:bg-brand-strong disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-focus-ring/40"
            >
              {creating ? t.services.creating : t.services.createButton}
            </button>
            <button
              type="button"
              onClick={() => setFormOpen(false)}
              className="px-3 py-2 rounded-xl text-[11px] font-bold bg-surface-2 border border-border-strong text-text hover:bg-surface-3"
            >
              {t.common.cancel}
            </button>
          </div>
        </form>
      ) : (
        <div>
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-bold bg-brand text-brand-ink hover:bg-brand-strong focus:outline-none focus:ring-2 focus:ring-focus-ring/40"
          >
            <Plus className="w-4 h-4" />
            <span>{t.services.createButton}</span>
          </button>
          <p className="text-[10px] text-muted mt-1.5 leading-relaxed">{s.createHint}</p>
        </div>
      )}

      {error && (
        <div role="alert" className="p-3 rounded-xl bg-danger-soft border border-danger text-danger text-[11px] space-y-2">
          <span className="flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span className="break-words">{error}</span>
          </span>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface-2 border border-border-strong text-text font-bold"
          >
            <RefreshCw className="w-3 h-3" />
            <span>{t.common.retry}</span>
          </button>
        </div>
      )}

      {loading && (
        <div className="space-y-2" aria-hidden="true">
          {[0, 1, 2].map((n) => (
            <div key={n} className="h-16 rounded-xl bg-surface-3 animate-pulse" />
          ))}
          <span className="sr-only">{t.common.loading}</span>
        </div>
      )}

      {!loading && !error && nothingAtAll && (
        <div className="p-4 rounded-xl bg-surface-3 border border-border text-center space-y-1.5">
          <p className="text-xs font-bold text-text">{s.railEmpty}</p>
          <p className="text-[11px] text-muted">{s.railEmptyHint}</p>
        </div>
      )}

      {!loading && !error && !nothingAtAll && services.length === 0 && (
        <p className="p-3 rounded-xl bg-surface-3 border border-border text-[11px] text-muted text-center">{s.emptySearch}</p>
      )}

      {!loading && services.length > 0 && (
        <ul className="space-y-2">
          {services.map((service) => {
            const counts = countsOf(service);
            const active = selectedId === service.id;
            const ready = counts.items > 0;
            return (
              <li key={service.id}>
                <button
                  type="button"
                  onClick={() => onSelect(service.id)}
                  aria-current={active ? 'true' : undefined}
                  className={`w-full text-start p-3 rounded-xl border transition-colors focus:outline-none focus:ring-2 focus:ring-focus-ring/40 ${
                    active ? 'border-brand bg-brand-soft' : 'border-border bg-surface-3 hover:bg-surface-2'
                  }`}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="font-bold text-xs text-text break-words">{service.name}</span>
                    <span dir="ltr" className="shrink-0 text-[10px] font-extrabold px-1.5 py-0.5 rounded-md bg-surface-2 border border-border-strong text-muted">
                      {service.code}
                    </span>
                  </span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-semibold text-muted">
                      {s.levelStandards} <span dir="ltr">{counts.standards}</span>{' · '}{s.levelItems} <span dir="ltr">{counts.items}</span>
                    </span>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                        ready ? 'bg-success-soft text-success-text' : 'bg-warning-soft text-warning-text'
                      }`}
                    >
                      {ready ? s.statusReady : s.statusEmpty}
                    </span>
                  </span>
                  <span className="block mt-1 text-[10px] text-muted">
                    {s.levelDisclosures} <span dir="ltr">{counts.disclosures}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
};
