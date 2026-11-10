import React from 'react';
import { Scale, UploadCloud, AlertCircle } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import { ActiveTab } from '../components/Sidebar.tsx';

interface GapAnalysisViewProps {
  setActiveTab: (tab: ActiveTab) => void;
}

export const GapAnalysisView: React.FC<GapAnalysisViewProps> = ({ setActiveTab }) => {
  const { t } = useLanguage();

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 p-8 md:p-12 text-center max-w-2xl mx-auto shadow-xs">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-amber-50 dark:bg-amber-950/50 flex items-center justify-center text-amber-600 dark:text-amber-400">
          <Scale className="w-8 h-8" />
        </div>
        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
          {t.gapAnalysis.emptyTitle}
        </h3>
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
};
