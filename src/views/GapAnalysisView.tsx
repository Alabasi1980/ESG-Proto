import React, { useCallback, useEffect, useState } from 'react';
import { Scale, UploadCloud, RefreshCw, AlertTriangle, ClipboardList } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { ActiveTab } from '../components/Sidebar.tsx';
import { EvaluationPanel, QueueItem } from './EvaluationPanel.tsx';

interface GapAnalysisViewProps {
  setActiveTab: (tab: ActiveTab) => void;
}

const STATUS_STYLES: Record<string, string> = {
  not_evaluated: 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300',
  draft: 'bg-sky-100 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300',
  submitted: 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300',
  approved: 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300',
  returned: 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300',
  not_applicable: 'bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300',
};

export const GapAnalysisView: React.FC<GapAnalysisViewProps> = ({ setActiveTab }) => {
  const { t } = useLanguage();
  const { token } = useAuth();

  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/queue', {
        headers: { Authorization: token ? `Bearer ${token}` : '' },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to load evaluation queue');
      }
      const data = await res.json();
      setItems(data.items || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load evaluation queue');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  const statusLabel = (status: string): string => {
    switch (status) {
      case 'draft':
        return t.gapAnalysis.stDraft;
      case 'submitted':
        return t.gapAnalysis.stSubmitted;
      case 'approved':
        return t.gapAnalysis.stApproved;
      case 'returned':
        return t.gapAnalysis.stReturned;
      case 'not_applicable':
        return t.gapAnalysis.stNotApplicable;
      default:
        return t.gapAnalysis.stNotEvaluated;
    }
  };

  const selected: QueueItem | null =
    items.find((i) => `${i.item_id}::${i.department_id}` === selectedKey) || null;

  const onChanged = useCallback(() => {
    fetchQueue();
  }, [fetchQueue]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 space-y-4">
        <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin" />
        <p className="text-sm text-slate-500">{t.common.loading}</p>
      </div>
    );
  }

  // No assignments and no evaluations visible: keep the original empty state
  // that routes the user to GRI import.
  if (!error && items.length === 0) {
    return (
      <div className="space-y-6">
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 p-8 md:p-12 text-center max-w-2xl mx-auto shadow-xs">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-amber-50 dark:bg-amber-950/50 flex items-center justify-center text-amber-600 dark:text-amber-400">
            <Scale className="w-8 h-8" />
          </div>
          <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">{t.gapAnalysis.emptyTitle}</h3>
          <p className="text-slate-600 dark:text-slate-300 text-xs max-w-md mx-auto mb-6 leading-relaxed">
            {t.gapAnalysis.emptyDescription}
          </p>
          <button
            onClick={() => setActiveTab('import-gri')}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 text-xs transition-colors shadow-xs"
          >
            <UploadCloud className="w-4 h-4" />
            <span>{t.gapAnalysis.emptyAction}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-xs">
        <div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">{t.gapAnalysis.queueTitle}</h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{t.gapAnalysis.queueSubtitle}</p>
        </div>
        <button
          onClick={fetchQueue}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs border border-slate-200 dark:border-slate-700"
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

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
        {/* Queue list */}
        <div className="lg:col-span-2 p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-xs">
          <div className="flex items-center gap-2 mb-3 px-1">
            <ClipboardList className="w-4 h-4 text-slate-500" />
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
              {t.gapAnalysis.queueTitle} ({items.length})
            </span>
          </div>
          {items.length === 0 && (
            <div className="p-4 text-center">
              <p className="text-sm font-bold text-slate-900 dark:text-white mb-1">{t.gapAnalysis.emptyQueueTitle}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">{t.gapAnalysis.emptyQueueDesc}</p>
            </div>
          )}
          <ul className="space-y-2 max-h-[70vh] overflow-y-auto pe-1">
            {items.map((qi) => {
              const key = `${qi.item_id}::${qi.department_id}`;
              const active = key === selectedKey;
              return (
                <li key={key}>
                  <button
                    onClick={() => setSelectedKey(key)}
                    className={`w-full text-start p-3 rounded-xl border transition-colors ${
                      active
                        ? 'border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/30'
                        : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-750'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-mono font-bold text-emerald-700 dark:text-emerald-400">
                        {qi.code}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${STATUS_STYLES[qi.status] || STATUS_STYLES.not_evaluated}`}
                      >
                        {statusLabel(qi.status)}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-300 mt-1 line-clamp-2">
                      {qi.requirement}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1">
                      {qi.priority} · ×{qi.weight} · {qi.department_name}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Detail panel */}
        <div className="lg:col-span-3">
          {selected ? (
            <EvaluationPanel
              key={`${selected.item_id}::${selected.department_id}::${selected.answer_status}::${selected.evaluation_id}`}
              item={selected}
              onChanged={onChanged}
            />
          ) : (
            <div className="p-8 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-xs text-center">
              <Scale className="w-10 h-10 mx-auto mb-3 text-slate-300 dark:text-slate-600" />
              <p className="text-xs text-slate-500 dark:text-slate-400">{t.gapAnalysis.selectPrompt}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
