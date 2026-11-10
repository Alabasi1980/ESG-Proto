import React, { useEffect, useState } from 'react';
import {
  UploadCloud,
  Database,
  BarChart3,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  ShieldCheck,
  Leaf,
  Users,
  Building,
  ArrowRight,
  RefreshCw,
} from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { ActiveTab } from '../components/Sidebar.tsx';

interface DashboardStats {
  hasData: boolean;
  standardsCount: number;
  itemsCount: number;
  aggregateScore: number | null;
  coveragePercentage: number;
  coverageRatio: number;
  evaluatedCount: number;
  applicableCount: number;
  notApplicableCount: number;
  notEvaluatedCount: number;
  totalCount: number;
  fullGapCount: number;
  partialGapCount: number;
  noGapCount: number;
}

interface DashboardViewProps {
  setActiveTab: (tab: ActiveTab) => void;
  dbConnected: boolean;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  setActiveTab,
  dbConnected,
}) => {
  const { t } = useLanguage();
  const { user, token } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const res = await fetch('/api/dashboard/stats', { headers });
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (err) {
      console.error('Failed to load dashboard metrics:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, [token]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 space-y-4">
        <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin" />
        <p className="text-sm text-slate-500">{t.common.loading}</p>
      </div>
    );
  }

  // Clear Empty State when database has no records
  if (!stats || !stats.hasData || stats.itemsCount === 0) {
    return (
      <div className="space-y-6">
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 p-8 md:p-12 text-center max-w-3xl mx-auto shadow-xs">
          <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 flex items-center justify-center text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800/60">
            <BarChart3 className="w-8 h-8" />
          </div>

          <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-3">
            {t.dashboard.emptyTitle}
          </h3>

          <p className="text-slate-600 dark:text-slate-300 text-sm max-w-xl mx-auto leading-relaxed mb-8">
            {t.dashboard.emptyDescription}
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={() => setActiveTab('import-gri')}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 shadow-sm transition-colors text-sm"
            >
              <UploadCloud className="w-4 h-4" />
              <span>{t.dashboard.importDataAction}</span>
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 font-medium hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors text-sm"
            >
              <Database className="w-4 h-4" />
              <span>{t.dashboard.configureDbAction}</span>
            </button>
          </div>

          <div className="mt-10 pt-8 border-t border-slate-100 dark:border-slate-700/50 grid grid-cols-1 sm:grid-cols-3 gap-4 text-start">
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-750/50 border border-slate-100 dark:border-slate-700/40">
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 mb-1">
                <Leaf className="w-4 h-4" />
                <span className="font-semibold text-xs">{t.dashboard.environmental}</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                GRI 300 Series (Emissions, Energy, Water, Waste)
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-750/50 border border-slate-100 dark:border-slate-700/40">
              <div className="flex items-center gap-2 text-sky-600 dark:text-sky-400 mb-1">
                <Users className="w-4 h-4" />
                <span className="font-semibold text-xs">{t.dashboard.social}</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                GRI 400 Series (Labor, Health, Safety, Communities)
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-750/50 border border-slate-100 dark:border-slate-700/40">
              <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 mb-1">
                <Building className="w-4 h-4" />
                <span className="font-semibold text-xs">{t.dashboard.governance}</span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                GRI 2 & 200 Series (Governance, Ethics, Anti-corruption)
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Populated Dashboard with Evaluation Rules strictly displayed
  return (
    <div className="space-y-6">
      {/* Top Banner with Welcome and Tenant */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-xs">
        <div>
          <h3 className="text-xl font-bold text-slate-900 dark:text-white">
            {t.dashboard.welcome}{user ? `, ${user.name}` : ''}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {t.dashboard.standardsOverviewDesc}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchStats}
            className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs flex items-center gap-1.5 border border-slate-200 dark:border-slate-700"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{t.common.refresh}</span>
          </button>
          <button
            onClick={() => setActiveTab('import-gri')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors shadow-xs"
          >
            <UploadCloud className="w-3.5 h-3.5" />
            <span>{t.dashboard.importDataAction}</span>
          </button>
        </div>
      </div>

      {/* Main KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Weighted Index KPI */}
        <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-medium">{t.dashboard.overallScore}</span>
            <span
              className="cursor-help text-slate-400 hover:text-slate-600"
              title={t.dashboard.scoreTooltip}
            >
              <HelpCircle className="w-3.5 h-3.5" />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-900 dark:text-white">
              {stats.aggregateScore !== null ? `${stats.aggregateScore}%` : '—'}
            </span>
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
              {stats.aggregateScore !== null ? 'Weighted Score' : 'Pending Review'}
            </span>
          </div>
          <div className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">
            {t.dashboard.scoreTooltip}
          </div>
        </div>

        {/* Review Coverage KPI */}
        <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-2">
            <span className="text-xs font-medium">{t.dashboard.reviewCoverage}</span>
            <span
              className="cursor-help text-slate-400 hover:text-slate-600"
              title={t.dashboard.coverageTooltip}
            >
              <HelpCircle className="w-3.5 h-3.5" />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-slate-900 dark:text-white">
              {stats.coveragePercentage}%
            </span>
            <span className="text-xs text-slate-500">
              ({stats.evaluatedCount} / {stats.applicableCount})
            </span>
          </div>
          <div className="w-full bg-slate-100 dark:bg-slate-700 rounded-full h-2 mt-3 overflow-hidden">
            <div
              className="bg-emerald-600 h-2 rounded-full transition-all duration-500"
              style={{ width: `${stats.coveragePercentage}%` }}
            />
          </div>
        </div>

        {/* Total Standards */}
        <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-xs">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
            {t.dashboard.totalStandards}
          </div>
          <div className="text-3xl font-extrabold text-slate-900 dark:text-white">
            {stats.standardsCount}
          </div>
          <div className="mt-3 text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>GRI Modular Standards</span>
          </div>
        </div>

        {/* Total Reporting Items */}
        <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-xs">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
            {t.dashboard.totalItems}
          </div>
          <div className="text-3xl font-extrabold text-slate-900 dark:text-white">
            {stats.itemsCount}
          </div>
          <div className="mt-3 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
            <span>{stats.notApplicableCount} {t.dashboard.notApplicable}</span>
          </div>
        </div>
      </div>

      {/* Gap Analysis Distribution Section */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 p-6 shadow-xs">
        <h4 className="text-base font-bold text-slate-900 dark:text-white mb-4">
          {t.dashboard.gapAnalysisTitle}
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Full Gap */}
          <div className="p-4 rounded-xl bg-rose-50/60 dark:bg-rose-950/20 border border-rose-200/60 dark:border-rose-900/40">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-rose-700 dark:text-rose-400">
                <XCircle className="w-4 h-4" />
                <span className="font-bold text-sm">{t.dashboard.fullGap}</span>
              </div>
              <span className="text-xl font-black text-rose-700 dark:text-rose-300">
                {stats.fullGapCount}
              </span>
            </div>
            <p className="text-xs text-rose-600/80 dark:text-rose-400/80">
              {t.dashboard.fullGapDesc}
            </p>
          </div>

          {/* Partial Gap */}
          <div className="p-4 rounded-xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="w-4 h-4" />
                <span className="font-bold text-sm">{t.dashboard.partialGap}</span>
              </div>
              <span className="text-xl font-black text-amber-700 dark:text-amber-300">
                {stats.partialGapCount}
              </span>
            </div>
            <p className="text-xs text-amber-600/80 dark:text-amber-400/80">
              {t.dashboard.partialGapDesc}
            </p>
          </div>

          {/* No Gap */}
          <div className="p-4 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-900/40">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="w-4 h-4" />
                <span className="font-bold text-sm">{t.dashboard.noGap}</span>
              </div>
              <span className="text-xl font-black text-emerald-700 dark:text-emerald-300">
                {stats.noGapCount}
              </span>
            </div>
            <p className="text-xs text-emerald-600/80 dark:text-emerald-400/80">
              {t.dashboard.noGapDesc}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
