import React, { useCallback, useEffect, useState } from 'react';
import { Sprout, RefreshCw, AlertTriangle, BarChart3, PieChart } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';

interface EsgRow {
  id: string;
  pillar: string;
  department: string;
  topic: string;
  parameter: string;
  observations: string | null;
  market_scenario: string | null;
  profile: string | null;
  profile_rating: number | null;
  timeline: string | null;
  eco_impact: string | null;
  rating: number | null;
  max_rating: number | null;
  sort_order: number | null;
}

const PROFILE_STYLES: Record<string, string> = {
  'Needs Improvement': 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300',
  Moderate: 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300',
  Good: 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300',
};

export const EsgProfileView: React.FC = () => {
  const { t } = useLanguage();
  const { token } = useAuth();

  const [rows, setRows] = useState<EsgRow[]>([]);
  const [score, setScore] = useState<number | null>(null);
  const [coverage, setCoverage] = useState(0);
  const [ratedCount, setRatedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/esg-profile', {
        headers: { Authorization: token ? `Bearer ${token}` : '' },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to load ESG profile');
      }
      const data = await res.json();
      setRows(data.rows || []);
      setScore(data.score ?? null);
      setCoverage(data.coveragePercentage ?? 0);
      setRatedCount(data.ratedCount ?? 0);
      setTotalCount(data.totalCount ?? 0);
    } catch (err: any) {
      setError(err.message || 'Failed to load ESG profile');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 space-y-4">
        <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin" />
        <p className="text-sm text-slate-500">{t.common.loading}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-xs">
        <div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">{t.esgProfile.title}</h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{t.esgProfile.subtitle}</p>
        </div>
        <button
          onClick={fetchProfile}
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

      {!error && rows.length === 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 p-8 text-center max-w-2xl mx-auto shadow-xs">
          <Sprout className="w-10 h-10 mx-auto mb-3 text-slate-300 dark:text-slate-600" />
          <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">{t.esgProfile.emptyTitle}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t.esgProfile.emptyDesc}</p>
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-xs">
              <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 mb-2">
                <BarChart3 className="w-4 h-4" />
                <span className="text-xs font-medium">{t.esgProfile.scoreLabel}</span>
              </div>
              <span className="text-3xl font-extrabold text-slate-900 dark:text-white">
                {score !== null ? `${score}%` : '—'}
              </span>
            </div>
            <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-xs">
              <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 mb-2">
                <PieChart className="w-4 h-4" />
                <span className="text-xs font-medium">{t.esgProfile.coverageLabel}</span>
              </div>
              <span className="text-3xl font-extrabold text-slate-900 dark:text-white">{coverage}%</span>
              <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-2 mt-3 overflow-hidden">
                <div className="bg-emerald-600 h-2 rounded-full transition-all duration-500" style={{ width: `${coverage}%` }} />
              </div>
            </div>
            <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-xs">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">{t.esgProfile.ratedLabel}</div>
              <span className="text-3xl font-extrabold text-slate-900 dark:text-white">
                {ratedCount} <span className="text-base font-semibold text-slate-400">/ {totalCount}</span>
              </span>
              <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">{t.esgProfile.groupNote}</p>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-xs overflow-x-auto">
            <table className="w-full text-xs min-w-[900px]">
              <thead>
                <tr className="text-start text-[10px] uppercase tracking-wide text-slate-400 border-b border-slate-100 dark:border-slate-700/60">
                  <th className="text-start font-bold p-3">{t.esgProfile.pillar}</th>
                  <th className="text-start font-bold p-3">{t.esgProfile.department}</th>
                  <th className="text-start font-bold p-3">{t.esgProfile.topic}</th>
                  <th className="text-start font-bold p-3">{t.esgProfile.parameter}</th>
                  <th className="text-start font-bold p-3">{t.esgProfile.profile}</th>
                  <th className="text-start font-bold p-3">{t.esgProfile.rating}</th>
                  <th className="text-start font-bold p-3">{t.esgProfile.timeline}</th>
                  <th className="text-start font-bold p-3">{t.esgProfile.impact}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-50 dark:border-slate-700/40 last:border-0">
                    <td className="p-3 font-bold text-slate-700 dark:text-slate-200">{r.pillar}</td>
                    <td className="p-3 text-slate-600 dark:text-slate-300">{r.department}</td>
                    <td className="p-3 text-slate-600 dark:text-slate-300">{r.topic}</td>
                    <td className="p-3 text-slate-900 dark:text-white font-medium">{r.parameter}</td>
                    <td className="p-3">
                      {r.profile && (
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${PROFILE_STYLES[r.profile] || 'bg-slate-100 text-slate-600'}`}>
                          {r.profile} ({r.profile_rating}/3)
                        </span>
                      )}
                    </td>
                    <td className="p-3 font-mono text-slate-600 dark:text-slate-300" dir="ltr">
                      {r.rating !== null ? `${r.rating}/${r.max_rating}` : '—'}
                    </td>
                    <td className="p-3 text-slate-600 dark:text-slate-300">{r.timeline || '—'}</td>
                    <td className="p-3 text-slate-600 dark:text-slate-300">{r.eco_impact || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};
