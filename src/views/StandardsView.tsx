import React, { useEffect, useState } from 'react';
import {
  BookOpen,
  Search,
  UploadCloud,
  FileText,
  Layers,
  RefreshCw,
  FolderOpen,
} from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { ActiveTab } from '../components/Sidebar.tsx';

interface StandardRow {
  id: string;
  code: string;
  title: string;
  category: string;
  version?: string;
  disclosure_count: number;
  item_count: number;
}

interface StandardsViewProps {
  setActiveTab: (tab: ActiveTab) => void;
}

export const StandardsView: React.FC<StandardsViewProps> = ({ setActiveTab }) => {
  const { t } = useLanguage();
  const { token } = useAuth();
  const [standards, setStandards] = useState<StandardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const fetchStandards = async () => {
    setLoading(true);
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/standards', { headers });
      if (res.ok) {
        const data = await res.json();
        setStandards(data);
      }
    } catch (err) {
      console.error('Failed to fetch standards:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStandards();
  }, [token]);

  const categories = Array.from(new Set(standards.map((s) => s.category)));

  const filteredStandards = standards.filter((s) => {
    const matchesSearch =
      s.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.category.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || s.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 space-y-4">
        <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin" />
        <p className="text-sm text-slate-500">{t.common.loading}</p>
      </div>
    );
  }

  if (standards.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 p-8 md:p-12 text-center max-w-2xl mx-auto shadow-xs">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
          <FolderOpen className="w-8 h-8" />
        </div>
        <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-2">
          {t.standards.emptyTitle}
        </h3>
        <p className="text-slate-600 dark:text-slate-300 text-xs max-w-md mx-auto mb-6 leading-relaxed">
          {t.standards.emptyDescription}
        </p>
        <button
          onClick={() => setActiveTab('import-gri')}
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 text-white font-medium hover:bg-emerald-700 text-xs transition-colors shadow-xs"
        >
          <UploadCloud className="w-4 h-4" />
          <span>{t.standards.emptyAction}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Search and Filters */}
      <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs">
        <div className="relative w-full sm:w-80">
          <Search className="absolute start-3 top-2.5 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t.standards.searchPlaceholder}
            className="w-full ps-9 pe-4 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-750 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="w-full sm:w-auto px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-750 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 focus:outline-none"
          >
            <option value="all">{t.standards.allCategories}</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <button
            onClick={fetchStandards}
            className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-750 transition-colors"
            title={t.common.refresh}
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Standards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredStandards.map((std) => (
          <div
            key={std.id}
            className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-xs hover:border-emerald-500/50 transition-colors"
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <span className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 font-extrabold text-xs border border-emerald-200 dark:border-emerald-800/60">
                {std.code}
              </span>
              <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 dark:bg-slate-750 px-2 py-0.5 rounded-full">
                {std.category}
              </span>
            </div>

            <h4 className="font-bold text-sm text-slate-900 dark:text-white mb-4 line-clamp-2">
              {std.title}
            </h4>

            <div className="pt-3 border-t border-slate-100 dark:border-slate-700/50 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <div className="flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-slate-400" />
                <span>
                  {std.disclosure_count} {t.standards.disclosuresCount}
                </span>
              </div>
              <div className="flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400">
                <Layers className="w-3.5 h-3.5" />
                <span>
                  {std.item_count} {t.standards.itemsCount}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* MP-43: priority weights — display-only reference footer */}
      <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-xs">
        <h4 className="text-xs font-bold text-slate-900 dark:text-white">{t.weights.title}</h4>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{t.weights.subtitle}</p>
        <div className="flex flex-wrap gap-2 mt-3 text-[11px] font-bold">
          <span className="px-2.5 py-1 rounded-full bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200/60 dark:border-rose-900/40">
            {t.weights.high}
          </span>
          <span className="px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200/60 dark:border-amber-900/40">
            {t.weights.mid}
          </span>
          <span className="px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-900/40">
            {t.weights.low}
          </span>
        </div>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-3">{t.weights.notice}</p>
      </div>
    </div>
  );
};
