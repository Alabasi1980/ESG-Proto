import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, PauseCircle } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';

interface DeptScore {
  departmentId: string;
  departmentName: string;
  score: number | null;
  coveragePercentage: number | null;
  evaluatedItems: number;
  applicableItems: number;
}

interface DashboardData {
  suspended?: boolean;
  message?: string;
  tenant?: { id: string; code: string; name: string };
  services?: { id: string; code: string; name: string; showGap: boolean; showCorrective: boolean }[];
  review?: {
    aggregateScore: number | null;
    coveragePercentage: number | null;
    evaluatedCount: number;
    applicableCount: number;
    notApplicableCount: number;
    notEvaluatedCount: number;
    fullGapCount: number | null;
    partialGapCount: number | null;
    noGapCount: number | null;
  };
  departments?: DeptScore[];
}

function fmt(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${v}%`;
}

export const ClientDashboardView: React.FC = () => {
  const { t } = useLanguage();
  const { user, token } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/client/dashboard', {
        headers: { Authorization: token ? `Bearer ${token}` : '' },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load client dashboard');
      setData(json);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (user?.role !== 'client_admin' && user?.role !== 'ge_admin') {
    return <p className="text-xs text-rose-600">Only client administrators may view the client dashboard.</p>;
  }
  if (loading) return <p className="text-xs text-slate-500">{t.common.loading}</p>;
  if (error) return <p className="text-xs text-rose-600">{error}</p>;
  if (!data) return null;

  if (data.suspended) {
    return (
      <div className="p-8 bg-white dark:bg-slate-800 rounded-2xl border border-rose-200 text-center">
        <PauseCircle className="w-8 h-8 mx-auto text-rose-500 mb-3" />
        <h3 className="font-bold text-base">{t.clientDashboard.suspendedTitle}</h3>
        <p className="text-xs text-slate-500 mt-2">{t.clientDashboard.suspendedDesc}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 p-6 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60">
        <div>
          <h3 className="text-xl font-bold text-slate-900 dark:text-white">{t.clientDashboard.title}</h3>
          <p className="text-xs text-slate-500 mt-1">{t.clientDashboard.subtitle}</p>
          <p className="text-xs text-slate-500 mt-2">
            {data.tenant?.name} ({data.tenant?.code})
          </p>
        </div>
        <button
          onClick={fetchData}
          className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600"
          title={t.common.refresh}
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60">
          <div className="text-xs text-slate-500 mb-1">{t.clientDashboard.aggregateTitle}</div>
          <div className="text-3xl font-extrabold">{fmt(data.review?.aggregateScore)}</div>
          <div className="text-[11px] text-slate-500 mt-1">
            {t.clientDashboard.coverageLabel} {fmt(data.review?.coveragePercentage)} ({data.review?.evaluatedCount}/
            {data.review?.applicableCount})
          </div>
        </div>
        <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60">
          <div className="text-xs text-slate-500 mb-1">Gaps (full/partial/none)</div>
          <div className="text-3xl font-extrabold">
            {data.review?.fullGapCount ?? '—'}/{data.review?.partialGapCount ?? '—'}/{data.review?.noGapCount ?? '—'}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            N/A {data.review?.notApplicableCount} · Pending {data.review?.notEvaluatedCount}
          </div>
        </div>
        <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60">
          <div className="text-xs text-slate-500 mb-1">{t.clientDashboard.servicesTitle}</div>
          <ul className="text-xs space-y-1">
            {(data.services ?? []).map((s) => (
              <li key={s.id}>
                {s.code}
                {!s.showGap && <span className="text-[10px] text-amber-600"> · {t.clientDashboard.hiddenNote}</span>}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="p-6 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60">
        <h4 className="font-bold text-sm mb-3">{t.clientDashboard.departmentsTitle}</h4>
        <ul className="space-y-2">
          {(data.departments ?? []).map((d) => (
            <li key={d.departmentId} className="flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-700">
              <span className="text-xs font-bold">{d.departmentName}</span>
              <span className="text-xs">
                {fmt(d.score)} · {t.clientDashboard.coverageLabel} {fmt(d.coveragePercentage)} ({d.evaluatedItems}/
                {d.applicableItems})
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
