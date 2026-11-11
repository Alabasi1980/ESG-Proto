import React, { useCallback, useEffect, useState } from 'react';
import { Building2, PauseCircle, PlayCircle, RefreshCw, Link2 } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';

interface OverviewClient {
  id: string;
  code: string;
  name: string;
  suspended: boolean;
  userCount: number;
  departmentCount: number;
  services: { id: string; code: string; name: string; showGap: boolean; showCorrective: boolean; levelSet: boolean }[];
  collection: { items: number; assignments: number; answersByStatus: Record<string, number> };
  review: {
    aggregateScore: number | null;
    coveragePercentage: number;
    evaluatedCount: number;
    applicableCount: number;
    notApplicableCount: number;
    fullGapCount: number;
    partialGapCount: number;
    noGapCount: number;
  };
  actions: Record<string, number>;
  staffLists: Record<string, number>;
  frozen: boolean;
}

export const GeOverviewView: React.FC = () => {
  const { t } = useLanguage();
  const { user, token } = useAuth();
  const [clients, setClients] = useState<OverviewClient[]>([]);
  const [totals, setTotals] = useState({ clients: 0, suspended: 0, services: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  if (user?.role !== 'ge_admin') {
    return <p className="text-xs text-rose-600">{t.geOverview.subtitle}</p>;
  }

  const headers = useCallback((): Record<string, string> => {
    const h: Record<string, string> = {};
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  }, [token]);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/ge/overview', { headers: headers() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load GE overview');
      setClients(data.clients ?? []);
      setTotals(data.totals ?? { clients: 0, suspended: 0, services: 0 });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => {
    fetchOverview();
  }, [fetchOverview]);

  const toggleSuspend = async (c: OverviewClient) => {
    if (!window.confirm(`${c.suspended ? t.geOverview.unsuspendBtn : t.geOverview.suspendBtn}: ${c.name}?`)) return;
    try {
      const res = await fetch(`/api/clients/${c.id}`, {
        method: 'PATCH',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ suspended: !c.suspended }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await fetchOverview();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const linkAll = async () => {
    try {
      const svcRes = await fetch('/api/services', { headers: headers() });
      const svcs = await svcRes.json();
      const gri = (Array.isArray(svcs) ? svcs : []).find((s: any) => s.code === 'GRI');
      if (!gri) throw new Error('GRI service not found (run migrations first).');
      const res = await fetch('/api/services/link-all', {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceId: gri.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await fetchOverview();
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (loading) return <p className="text-xs text-slate-500">{t.common.loading}</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60">
        <div>
          <h3 className="text-xl font-bold text-slate-900 dark:text-white">{t.geOverview.title}</h3>
          <p className="text-xs text-slate-500 mt-1">{t.geOverview.subtitle}</p>
          <p className="text-xs text-slate-500 mt-2">
            {t.geOverview.totalsClients}: {totals.clients} · {t.geOverview.totalsSuspended}: {totals.suspended} ·{' '}
            {t.geOverview.totalsServices}: {totals.services}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={linkAll}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 text-white text-xs font-bold hover:bg-violet-700"
          >
            <Link2 className="w-3.5 h-3.5" />
            <span>{t.geOverview.linkAllBtn}</span>
          </button>
          <button
            onClick={fetchOverview}
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
            title={t.common.refresh}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 text-rose-800 text-xs">
          {error}
        </div>
      )}

      <ul className="space-y-4">
        {clients.map((c) => (
          <li key={c.id} className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Building2 className="w-4 h-4 text-emerald-600" />
                  <span className="font-bold text-sm text-slate-900 dark:text-white">
                    {c.name} ({c.code})
                  </span>
                  {c.suspended && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300">
                      {t.geOverview.suspendedBadge}
                    </span>
                  )}
                  {c.frozen && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                      {t.geOverview.frozenBadge}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  {t.geOverview.servicesLabel}: {c.services.map((s) => s.code).join(', ') || '—'} ·{' '}
                  {t.geOverview.reviewLabel}: {c.review.aggregateScore ?? '—'}% ({t.geOverview.coverageLabel}{' '}
                  {c.review.coveragePercentage}%) · {t.geOverview.actionsLabel}:{' '}
                  {Object.entries(c.actions)
                    .map(([k, v]) => `${k}:${v}`)
                    .join(' ') || '—'}
                </p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Users {c.userCount} · Depts {c.departmentCount} · Assignments {c.collection.assignments} · Gaps{' '}
                  {c.review.fullGapCount}/{c.review.partialGapCount}/{c.review.noGapCount}
                </p>
              </div>
              <button
                onClick={() => toggleSuspend(c)}
                title={c.suspended ? t.geOverview.unsuspendBtn : t.geOverview.suspendBtn}
                className={`p-2 rounded-lg border text-xs font-bold ${
                  c.suspended
                    ? 'border-emerald-200 text-emerald-600 hover:bg-emerald-50'
                    : 'border-rose-200 text-rose-600 hover:bg-rose-50'
                }`}
              >
                {c.suspended ? <PlayCircle className="w-4 h-4" /> : <PauseCircle className="w-4 h-4" />}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};
