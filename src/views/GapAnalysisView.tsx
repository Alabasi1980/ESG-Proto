import React, { useCallback, useEffect, useState } from 'react';
import { Scale, UploadCloud, RefreshCw, AlertTriangle, ClipboardList } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { ActiveTab } from '../components/Sidebar.tsx';
import { EvaluationPanel, QueueItem } from './EvaluationPanel.tsx';
import { ClientReviewView } from './ClientReviewView.tsx';
import { GeFinalView } from './GeFinalView.tsx';

interface GapAnalysisViewProps {
  setActiveTab: (tab: ActiveTab) => void;
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

export const GapAnalysisView: React.FC<GapAnalysisViewProps> = ({ setActiveTab }) => {
  const { t } = useLanguage();
  const { token, user } = useAuth();

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
      case 'client_approved':
        return t.gapAnalysis.stClientApproved;
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
        <RefreshCw className="w-8 h-8 text-brand-text animate-spin" />
        <p className="text-sm text-muted">{t.common.loading}</p>
      </div>
    );
  }

  // No assignments and no evaluations visible: keep the original empty state
  // that routes the user to GRI import.
  if (!error && items.length === 0) {
    return (
      <div className="space-y-6">
        <div className="bg-surface-2 rounded-2xl border border-border p-8 md:p-12 text-center max-w-2xl mx-auto shadow-xs">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-warning-soft flex items-center justify-center text-warning-text">
            <Scale className="w-8 h-8" />
          </div>
          <h3 className="text-xl font-bold text-text mb-2">{t.gapAnalysis.emptyTitle}</h3>
          <p className="text-muted text-xs max-w-md mx-auto mb-6 leading-relaxed">
            {t.gapAnalysis.emptyDescription}
          </p>
          <button
            onClick={() => setActiveTab('import-gri')}
            className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-brand text-brand-ink font-medium hover:bg-brand-strong text-xs transition-colors shadow-xs"
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-5 bg-surface-2 rounded-2xl border border-border shadow-xs">
        <div>
          <h3 className="text-lg font-bold text-text">{t.gapAnalysis.queueTitle}</h3>
          <p className="text-[11px] text-muted mt-0.5">{t.gapAnalysis.queueSubtitle}</p>
        </div>
        <button
          onClick={fetchQueue}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-muted hover:bg-surface-3 text-xs border border-border"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>{t.common.refresh}</span>
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-danger-soft border border-danger text-danger text-xs flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
        {/* Queue list */}
        <div className="lg:col-span-2 p-4 bg-surface-2 rounded-2xl border border-border shadow-xs">
          <div className="flex items-center gap-2 mb-3 px-1">
            <ClipboardList className="w-4 h-4 text-muted" />
            <span className="text-xs font-bold text-text">
              {t.gapAnalysis.queueTitle} ({items.length})
            </span>
          </div>
          {items.length === 0 && (
            <div className="p-4 text-center">
              <p className="text-sm font-bold text-text mb-1">{t.gapAnalysis.emptyQueueTitle}</p>
              <p className="text-[11px] text-muted">{t.gapAnalysis.emptyQueueDesc}</p>
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
                        ? 'border-brand bg-brand-soft'
                        : 'border-border hover:bg-surface-3'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-mono font-bold text-brand-text">
                        {qi.code}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${STATUS_STYLES[qi.status] || STATUS_STYLES.not_evaluated}`}
                      >
                        {statusLabel(qi.status)}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted mt-1 line-clamp-2">
                      {qi.requirement}
                    </div>
                    <div className="text-[10px] text-muted mt-1">
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
              key={`${selected.item_id}::${selected.department_id}::${selected.answer_status}::${selected.evaluation_id}::${selected.evaluation_version}::${selected.answer_version}`}
              item={selected}
              onChanged={onChanged}
            />
          ) : (
            <div className="p-8 bg-surface-2 rounded-2xl border border-border shadow-xs text-center">
              <Scale className="w-10 h-10 mx-auto mb-3 text-muted" />
              <p className="text-xs text-muted">{t.gapAnalysis.selectPrompt}</p>
            </div>
          )}
        </div>
      </div>

      {/* B9-A3: client-review queue (admins only) */}
      {(user?.role === 'client_admin' || user?.role === 'ge_admin') && (
        <ClientReviewView onChanged={onChanged} />
      )}

      {/* B9-B4: GE final review + freeze (ge_admin only) */}
      {user?.role === 'ge_admin' && <GeFinalView />}
    </div>
  );
};
