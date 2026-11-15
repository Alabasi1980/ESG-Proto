import React from 'react';
import { Menu, Globe, ShieldCheck, Database } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { DemoBanner } from './DemoBanner.tsx';
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
      case 'reports':
        return t.reports.title;
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
      case 'reports':
        return t.reports.subtitle;
      case 'import-gri':
        return t.importGRI.subtitle;
      case 'settings':
        return t.settings.subtitle;
      default:
        return t.appTagline;
    }
  };

  return (
    <div className="sticky top-0 z-30 print:hidden">
      <DemoBanner />
    <header className="flex items-center justify-between px-6 py-4 bg-surface-2/95 backdrop-blur-xs border-b border-border transition-colors">
      <div className="flex items-center gap-4">
        {/* Mobile menu button */}
        <button
          onClick={onOpenMobileMenu}
          data-testid="open-mobile-menu"
          className="p-2 -ms-2 rounded-lg text-muted hover:bg-surface-3 lg:hidden"
          aria-label="Open navigation menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div>
          <h2 className="text-xl font-bold tracking-tight text-text">
            {getTabTitle()}
          </h2>
          <p className="hidden sm:block text-xs text-muted mt-0.5">
            {getTabSubtitle()}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Database Status indicator */}
        <div
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
            dbConnected
              ? 'bg-brand-soft text-brand border-brand'
              : 'bg-warning-soft text-warning border-warning'
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
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-surface-3 text-text hover:bg-surface-3 transition-colors"
          title={lang === 'en' ? 'تبديل إلى العربية' : 'Switch to English'}
        >
          <Globe className="w-3.5 h-3.5 text-brand" />
          <span>{lang === 'en' ? 'العربية' : 'English'}</span>
        </button>
      </div>
    </header>
    </div>
  );
};
