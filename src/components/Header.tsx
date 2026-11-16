import React from 'react';
import { Menu, Globe, ShieldCheck, Database, Building2 } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { DemoBanner } from './DemoBanner.tsx';
import { ActiveTab } from './Sidebar.tsx';
import { labelOf, shellIdentity, type NavContext } from '../lib/navModel.ts';

interface HeaderProps {
  /** Derived by App from role + workspace tab mode; null = no pages. */
  context: NavContext | null;
  /** The GUARD-RESOLVED page (never a forbidden/pending request). */
  activeTab: ActiveTab | null;
  onOpenMobileMenu: () => void;
  dbConnected: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  context,
  activeTab,
  onOpenMobileMenu,
  dbConnected,
}) => {
  const { t, lang, setLang } = useLanguage();
  const { user, workspace } = useAuth();

  // TASK-PROTO-U3-B1 §3: the title is the nav model's label for the resolved
  // page in the current context (same labels drive sidebar and header; E's
  // gap-analysis reads "My department disclosures", W/C's initiatives read
  // "Assigned Initiatives").
  const title = context && activeTab ? labelOf(activeTab, context)[lang] : t.appName;

  // §2: the header pill carries the SAME identity as the sidebar block.
  // The B2 exit control is deliberately absent from this shell.
  const identity = context
    ? shellIdentity(context, {
      clientName: workspace?.client?.name ?? null,
      companyName: user?.clientName ?? null,
      departmentName: user?.departmentName ?? null,
    })
    : null;

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
    <header className="flex items-center justify-between gap-3 px-6 py-4 bg-surface-2/95 backdrop-blur-xs border-b border-border transition-colors">
      <div className="flex items-center gap-4 min-w-0">
        {/* Mobile menu button */}
        <button
          onClick={onOpenMobileMenu}
          data-testid="open-mobile-menu"
          className="p-2 -ms-2 rounded-lg text-muted hover:bg-surface-3 lg:hidden"
          aria-label="Open navigation menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="min-w-0">
          <h2 className="text-xl font-bold tracking-tight text-text truncate">
            {title}
          </h2>
          <p className="hidden sm:block text-xs text-muted mt-0.5">
            {getTabSubtitle()}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 min-w-0">
        {/* Context identity pill (same truthful identity as the sidebar) */}
        {identity && (
          <div
            data-testid="context-identity"
            className="flex items-center gap-1.5 min-w-0 px-2.5 py-1 rounded-full text-xs font-medium border border-border bg-surface-3 text-text"
            title={identity.value ?? t.contextIdentity[identity.labelKey]}
          >
            <Building2 className="w-3.5 h-3.5 shrink-0 text-brand-text" />
            <span className="truncate max-w-[12rem]">{t.contextIdentity[identity.labelKey]}</span>
            {identity.value && (
              <span className="hidden sm:inline truncate max-w-[14rem] text-muted">
                · {identity.value}
              </span>
            )}
          </div>
        )}

        {/* Database Status indicator */}
        <div
          className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
            dbConnected
              ? 'bg-brand-soft text-brand-text border-brand'
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
          <Globe className="w-3.5 h-3.5 text-brand-text" />
          <span>{lang === 'en' ? 'العربية' : 'English'}</span>
        </button>
      </div>
    </header>
    </div>
  );
};
