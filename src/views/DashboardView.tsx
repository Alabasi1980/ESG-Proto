import React, { useEffect, useState } from 'react';
import {
  BarChart3,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  ShieldCheck,
  Leaf,
  Users,
  Building,
  RefreshCw,
} from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { apiFetch } from '../lib/api.ts';
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
      const res = await apiFetch('/api/dashboard/stats', { headers });
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
        <RefreshCw className="w-8 h-8 text-brand-text animate-spin" />
        <p className="text-sm text-muted">{t.common.loading}</p>
      </div>
    );
  }

  // Clear Empty State when database has no records
  if (!stats || !stats.hasData || stats.itemsCount === 0) {
    return (
      <div className="space-y-6">
        <div className="bg-surface-2 rounded-2xl border border-border p-8 md:p-12 text-center max-w-3xl mx-auto shadow-xs">
          <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-brand-soft flex items-center justify-center text-brand-text border border-brand">
            <BarChart3 className="w-8 h-8" />
          </div>

          <h3 className="text-2xl font-bold text-text mb-3">
            {t.dashboard.emptyTitle}
          </h3>

          <p className="text-muted text-sm max-w-xl mx-auto leading-relaxed mb-8">
            {t.dashboard.emptyDescription}
          </p>

          {/* TASK-PROTO-U3-B2 §3 (F3): no Import-GRI / Settings CTAs are rendered
              in the W workspace — those pages do not exist for this context. */}
          <div className="mt-10 pt-8 border-t border-border grid grid-cols-1 sm:grid-cols-3 gap-4 text-start">
            <div className="p-4 rounded-xl bg-surface-3 border border-border">
              <div className="flex items-center gap-2 text-brand-text mb-1">
                <Leaf className="w-4 h-4" />
                <span className="font-semibold text-xs">{t.dashboard.environmental}</span>
              </div>
              <p className="text-xs text-muted">
                GRI 300 Series (Emissions, Energy, Water, Waste)
              </p>
            </div>

            <div className="p-4 rounded-xl bg-surface-3 border border-border">
              <div className="flex items-center gap-2 text-info mb-1">
                <Users className="w-4 h-4" />
                <span className="font-semibold text-xs">{t.dashboard.social}</span>
              </div>
              <p className="text-xs text-muted">
                GRI 400 Series (Labor, Health, Safety, Communities)
              </p>
            </div>

            <div className="p-4 rounded-xl bg-surface-3 border border-border">
              <div className="flex items-center gap-2 text-accent-text mb-1">
                <Building className="w-4 h-4" />
                <span className="font-semibold text-xs">{t.dashboard.governance}</span>
              </div>
              <p className="text-xs text-muted">
                GRI 2 &amp; 200 Series (Governance, Ethics, Anti-corruption)
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
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-surface-2 rounded-2xl border border-border shadow-xs">
        <div>
          <h3 className="text-xl font-bold text-text">
            {t.dashboard.welcome}{user ? `, ${user.name}` : ''}
          </h3>
          <p className="text-xs text-muted mt-1">
            {t.dashboard.standardsOverviewDesc}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchStats}
            className="p-2 rounded-lg text-muted hover:bg-surface-3 text-xs flex items-center gap-1.5 border border-border"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{t.common.refresh}</span>
          </button>
        </div>
      </div>

      {/* Main KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Weighted Index KPI */}
        <div className="p-5 bg-surface-2 rounded-2xl border border-border shadow-xs">
          <div className="flex items-center justify-between text-muted mb-2">
            <span className="text-xs font-medium">{t.dashboard.overallScore}</span>
            <span
              className="cursor-help text-muted hover:text-text"
              title={t.dashboard.scoreTooltip}
            >
              <HelpCircle className="w-3.5 h-3.5" />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-text">
              {stats.aggregateScore !== null ? `${stats.aggregateScore}%` : '—'}
            </span>
            <span className="text-xs font-medium text-brand-text">
              {stats.aggregateScore !== null ? 'Weighted Score' : 'Pending Review'}
            </span>
          </div>
          <div className="mt-3 text-[11px] text-muted">
            {t.dashboard.scoreTooltip}
          </div>
        </div>

        {/* Review Coverage KPI */}
        <div className="p-5 bg-surface-2 rounded-2xl border border-border shadow-xs">
          <div className="flex items-center justify-between text-muted mb-2">
            <span className="text-xs font-medium">{t.dashboard.reviewCoverage}</span>
            <span
              className="cursor-help text-muted hover:text-text"
              title={t.dashboard.coverageTooltip}
            >
              <HelpCircle className="w-3.5 h-3.5" />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-text">
              {stats.coveragePercentage}%
            </span>
            <span className="text-xs text-muted">
              ({stats.evaluatedCount} / {stats.applicableCount})
            </span>
          </div>
          <div className="w-full bg-surface-3 rounded-full h-2 mt-3 overflow-hidden">
            <div
              className="bg-brand h-2 rounded-full transition-all duration-500"
              style={{ width: `${stats.coveragePercentage}%` }}
            />
          </div>
        </div>

        {/* Total Standards */}
        <div className="p-5 bg-surface-2 rounded-2xl border border-border shadow-xs">
          <div className="text-xs font-medium text-muted mb-2">
            {t.dashboard.totalStandards}
          </div>
          <div className="text-3xl font-extrabold text-text">
            {stats.standardsCount}
          </div>
          <div className="mt-3 text-xs text-brand-text flex items-center gap-1 font-medium">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>GRI Modular Standards</span>
          </div>
        </div>

        {/* Total Reporting Items */}
        <div className="p-5 bg-surface-2 rounded-2xl border border-border shadow-xs">
          <div className="text-xs font-medium text-muted mb-2">
            {t.dashboard.totalItems}
          </div>
          <div className="text-3xl font-extrabold text-text">
            {stats.itemsCount}
          </div>
          <div className="mt-3 text-xs text-muted flex items-center gap-2">
            <span>{stats.notApplicableCount} {t.dashboard.notApplicable}</span>
          </div>
        </div>
      </div>

      {/* Gap Analysis Distribution Section */}
      <div className="bg-surface-2 rounded-2xl border border-border p-6 shadow-xs">
        <h4 className="text-base font-bold text-text mb-4">
          {t.dashboard.gapAnalysisTitle}
        </h4>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Full Gap */}
          <div className="p-4 rounded-xl bg-danger-soft/60 border border-danger/60">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-danger">
                <XCircle className="w-4 h-4" />
                <span className="font-bold text-sm">{t.dashboard.fullGap}</span>
              </div>
              <span className="text-xl font-black text-danger">
                {stats.fullGapCount}
              </span>
            </div>
            <p className="text-xs text-danger/80">
              {t.dashboard.fullGapDesc}
            </p>
          </div>

          {/* Partial Gap */}
          <div className="p-4 rounded-xl bg-warning-soft/60 border border-warning/60">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-warning-text">
                <AlertTriangle className="w-4 h-4" />
                <span className="font-bold text-sm">{t.dashboard.partialGap}</span>
              </div>
              <span className="text-xl font-black text-warning-text">
                {stats.partialGapCount}
              </span>
            </div>
            <p className="text-xs text-warning-text/80">
              {t.dashboard.partialGapDesc}
            </p>
          </div>

          {/* No Gap */}
          <div className="p-4 rounded-xl bg-success-soft/60 border border-success/60">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-success-text">
                <CheckCircle2 className="w-4 h-4" />
                <span className="font-bold text-sm">{t.dashboard.noGap}</span>
              </div>
              <span className="text-xl font-black text-success-text">
                {stats.noGapCount}
              </span>
            </div>
            <p className="text-xs text-success-text/80">
              {t.dashboard.noGapDesc}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
