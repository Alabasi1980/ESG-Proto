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
import { TaxonomyManage } from './TaxonomyManage.tsx';

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
        <RefreshCw className="w-8 h-8 text-brand-text animate-spin" />
        <p className="text-sm text-muted">{t.common.loading}</p>
      </div>
    );
  }

  if (standards.length === 0) {
    return (
      <div className="bg-surface-2 rounded-2xl border border-border p-8 md:p-12 text-center max-w-2xl mx-auto shadow-xs">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-brand-soft flex items-center justify-center text-brand-text">
          <FolderOpen className="w-8 h-8" />
        </div>
        <h3 className="text-xl font-bold text-text mb-2">
          {t.standards.emptyTitle}
        </h3>
        <p className="text-muted text-xs max-w-md mx-auto mb-6 leading-relaxed">
          {t.standards.emptyDescription}
        </p>
        <button
          onClick={() => setActiveTab('import-gri')}
          className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-brand text-brand-ink font-medium hover:bg-brand-strong text-xs transition-colors shadow-xs"
        >
          <UploadCloud className="w-4 h-4" />
          <span>{t.standards.emptyAction}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* B11a (S-05/S-06/S-08): GE-only taxonomy management (titles, items, links). */}
      <TaxonomyManage />

      {/* Search and Filters */}
      <div className="p-4 bg-surface-2 rounded-2xl border border-border flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs">
        <div className="relative w-full sm:w-80">
          <Search className="absolute start-3 top-2.5 w-4 h-4 text-muted" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t.standards.searchPlaceholder}
            className="w-full ps-9 pe-4 py-2 rounded-xl text-xs bg-surface-3 border border-border-strong text-text placeholder-muted focus:outline-none focus:ring-2 focus:ring-focus-ring/30 focus:border-focus-ring"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="w-full sm:w-auto px-3 py-2 rounded-xl text-xs bg-surface-3 border border-border-strong text-text focus:outline-none"
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
            className="p-2 rounded-xl border border-border text-muted hover:bg-surface-3 transition-colors"
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
            className="p-5 bg-surface-2 rounded-2xl border border-border shadow-xs hover:border-brand transition-colors"
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <span className="px-2.5 py-1 rounded-lg bg-brand-soft text-brand-text font-extrabold text-xs border border-brand">
                {std.code}
              </span>
              <span className="text-[10px] font-semibold text-muted bg-surface-3 px-2 py-0.5 rounded-full">
                {std.category}
              </span>
            </div>

            <h4 className="font-bold text-sm text-text mb-4 line-clamp-2">
              {std.title}
            </h4>

            <div className="pt-3 border-t border-border flex items-center justify-between text-xs text-muted">
              <div className="flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-muted" />
                <span>
                  {std.disclosure_count} {t.standards.disclosuresCount}
                </span>
              </div>
              <div className="flex items-center gap-1.5 font-medium text-brand-text">
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
      <div className="p-4 bg-surface-2 rounded-2xl border border-border shadow-xs">
        <h4 className="text-xs font-bold text-text">{t.weights.title}</h4>
        <p className="text-[11px] text-muted mt-0.5">{t.weights.subtitle}</p>
        <div className="flex flex-wrap gap-2 mt-3 text-[11px] font-bold">
          <span className="px-2.5 py-1 rounded-full bg-danger-soft text-danger border border-danger">
            {t.weights.high}
          </span>
          <span className="px-2.5 py-1 rounded-full bg-warning-soft text-warning-text border border-warning">
            {t.weights.mid}
          </span>
          <span className="px-2.5 py-1 rounded-full bg-success-soft text-success-text border border-success">
            {t.weights.low}
          </span>
        </div>
        <p className="text-[11px] text-muted mt-3">{t.weights.notice}</p>
      </div>
    </div>
  );
};
