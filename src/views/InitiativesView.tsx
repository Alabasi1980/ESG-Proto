import React, { useCallback, useEffect, useState } from 'react';
import { Lightbulb, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';

interface InitiativeRow {
  id: string;
  title: string;
  sector: string;
  department: string;
  esg_class: string;
  standards_ref: string;
  notes: string;
  sort_order: number | null;
  selected: boolean;
  selected_at: string | null;
}

export const InitiativesView: React.FC = () => {
  const { t } = useLanguage();
  const { user, token } = useAuth();

  const [items, setItems] = useState<InitiativeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sector, setSector] = useState('');
  const [esg, setEsg] = useState('');
  const [department, setDepartment] = useState('');
  const [mutatingId, setMutatingId] = useState<string | null>(null);

  const isAdmin = user?.role === 'client_admin' || user?.role === 'ge_admin';
  const authHeaders: Record<string, string> = { Authorization: token ? `Bearer ${token}` : '' };

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (sector) params.set('sector', sector);
      if (esg) params.set('esg', esg);
      if (department) params.set('department', department);
      if (search.trim()) params.set('search', search.trim());
      const q = params.toString() ? `?${params.toString()}` : '';
      const res = await fetch(`/api/initiatives${q}`, { headers: authHeaders });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to load initiatives');
      }
      const data = await res.json();
      setItems(data.items || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load initiatives');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [token, sector, esg, department, search]);

  useEffect(() => {
    const timer = setTimeout(fetchItems, search ? 350 : 0);
    return () => clearTimeout(timer);
  }, [fetchItems]);

  const toggleSelect = async (row: InitiativeRow) => {
    setMutatingId(row.id);
    setError(null);
    try {
      const res = row.selected
        ? await fetch(`/api/initiatives/select/${row.id}`, { method: 'DELETE', headers: authHeaders })
        : await fetch('/api/initiatives/select', {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ initiativeId: row.id }),
          });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to update selection');
      await fetchItems();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setMutatingId(null);
    }
  };

  const sectors = Array.from(new Set(items.map((i) => i.sector).filter(Boolean)));
  const esgs = Array.from(new Set(items.map((i) => i.esg_class).filter(Boolean)));
  const depts = Array.from(new Set(items.map((i) => i.department).filter(Boolean)));
  const selectedCount = items.filter((i) => i.selected).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-xs">
        <div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">{t.initiatives.title}</h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{t.initiatives.subtitle}</p>
        </div>
        <button
          onClick={fetchItems}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs border border-slate-200 dark:border-slate-700 self-start"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>{t.common.refresh}</span>
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-xs flex flex-col lg:flex-row gap-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.initiatives.searchPh}
          className="flex-1 px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-750 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
        />
        <div className="flex flex-wrap gap-2">
          <select
            value={sector}
            onChange={(e) => setSector(e.target.value)}
            className="px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-750 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
          >
            <option value="">{t.initiatives.filterSector}: {t.initiatives.all}</option>
            {sectors.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={esg}
            onChange={(e) => setEsg(e.target.value)}
            className="px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-750 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
          >
            <option value="">{t.initiatives.filterEsg}: {t.initiatives.all}</option>
            {esgs.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className="px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-750 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
          >
            <option value="">{t.initiatives.filterDepartment}: {t.initiatives.all}</option>
            {depts.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center p-12 space-y-4">
          <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin" />
          <p className="text-sm text-slate-500">{t.common.loading}</p>
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 p-8 text-center max-w-2xl mx-auto shadow-xs">
          <Lightbulb className="w-10 h-10 mx-auto mb-3 text-slate-300 dark:text-slate-600" />
          <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">{t.initiatives.emptyTitle}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t.initiatives.emptyDesc}</p>
        </div>
      ) : (
        <>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 px-1">
            {items.length} · {selectedCount} {t.initiatives.selectedBadge}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {items.map((row) => (
              <div
                key={row.id}
                className={`p-4 bg-white dark:bg-slate-800 rounded-2xl border shadow-xs transition-colors ${
                  row.selected
                    ? 'border-emerald-500/60 dark:border-emerald-800'
                    : 'border-slate-200 dark:border-slate-700/60'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white leading-snug">{row.title}</h4>
                  {row.selected && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 shrink-0">
                      <CheckCircle2 className="w-3 h-3" />
                      {t.initiatives.selectedBadge}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2 text-[10px]">
                  {row.sector && (
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-semibold">
                      {t.initiatives.sector}: {row.sector}
                    </span>
                  )}
                  {row.esg_class && (
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-semibold">
                      {row.esg_class}
                    </span>
                  )}
                  {row.department && (
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-semibold">
                      {t.initiatives.department}: {row.department}
                    </span>
                  )}
                  {row.standards_ref && (
                    <span className="px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 font-semibold">
                      {t.initiatives.standardsRef}: {row.standards_ref}
                    </span>
                  )}
                </div>
                {isAdmin && (
                  <button
                    onClick={() => toggleSelect(row)}
                    disabled={mutatingId === row.id}
                    className={`mt-3 px-4 py-2 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 ${
                      row.selected
                        ? 'border border-rose-300 dark:border-rose-700 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40'
                        : 'bg-emerald-600 text-white hover:bg-emerald-700'
                    }`}
                  >
                    {mutatingId === row.id
                      ? t.common.loading
                      : row.selected
                        ? t.initiatives.unselectButton
                        : t.initiatives.selectButton}
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
