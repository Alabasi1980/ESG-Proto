import React from 'react';
import { Menu, Globe, ShieldCheck, Database } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { ActiveTab } from './Sidebar.tsx';

interface HeaderProps {
  activeTab: ActiveTab;
  onOpenMobileMenu: () => void;
  dbConnected: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onOpenMobileMenu,
  dbConnected,
}) => {
  const { t, lang, setLang } = useLanguage();
  const { user } = useAuth();

  const getTabTitle = () => {
    switch (activeTab) {
      case 'dashboard':
        return t.dashboard.title;
      case 'standards':
        return t.standards.title;
      case 'gap-analysis':
        return t.gapAnalysis.title;
      case 'import-gri':
        return t.importGRI.title;
      case 'settings':
        return t.settings.title;
      default:
        return t.appName;
    }
  };

  const getTabSubtitle = () => {
    switch (activeTab) {
      case 'dashboard':
        return t.dashboard.subtitle;
      case 'standards':
        return t.standards.subtitle;
      case 'gap-analysis':
        return t.gapAnalysis.subtitle;
      case 'import-gri':
        return t.importGRI.subtitle;
      case 'settings':
        return t.settings.subtitle;
      default:
        return t.appTagline;
    }
  };

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between px-6 py-4 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xs border-b border-slate-200 dark:border-slate-800 transition-colors">
      <div className="flex items-center gap-4">
        {/* Mobile menu button */}
        <button
          onClick={onOpenMobileMenu}
          className="p-2 -ms-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden"
          aria-label="Open navigation menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
            {getTabTitle()}
          </h2>
          <p className="hidden sm:block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {getTabSubtitle()}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Database Status indicator */}
        <div
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
            dbConnected
              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
              : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
          }`}
          title={dbConnected ? t.settings.connected : t.settings.disconnected}
        >
          <Database className="w-3.5 h-3.5" />
          <span className="hidden md:inline">
            {dbConnected ? 'PostgreSQL RLS' : 'DB Offline'}
          </span>
        </div>

        {/* Language switch */}
        <button
          onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
          title={lang === 'en' ? 'تبديل إلى العربية' : 'Switch to English'}
        >
          <Globe className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
          <span>{lang === 'en' ? 'العربية' : 'English'}</span>
        </button>
      </div>
    </header>
  );
};
