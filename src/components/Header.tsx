import React from 'react';
import { Menu, Globe, Database, Building2, LogOut, AlertTriangle } from 'lucide-react';
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
  /** null = not checked yet (safe shell “Checking”, never a false “Connected”). */
  dbConnected: boolean | null;
  /** §2/§7 exit control — W only, at every width; App owns the confirmation. */
  onExitToClients: () => void;
  /** True while any workspace transition is pending (duplicate clicks suppressed). */
  exitBusy: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  context,
  activeTab,
  onOpenMobileMenu,
  dbConnected,
  onExitToClients,
  exitBusy,
}) => {
  const { t, lang, setLang } = useLanguage();
  const { user, workspace } = useAuth();

  // TASK-PROTO-U3-B1 §3: the title is the nav model's label for the resolved
  // page in the current context (same labels drive sidebar and header; E's
  // gap-analysis reads "My department disclosures", W/C's initiatives read
  // "Assigned Initiatives").
  const title = context && activeTab ? labelOf(activeTab, context)[lang] : t.appName;

  // §2: the header pill carries the SAME identity as the sidebar block.
  const identity = context
    ? shellIdentity(context, {
      clientName: workspace?.client?.name ?? null,
      companyName: user?.clientName ?? null,
      departmentName: user?.departmentName ?? null,
    })
    : null;

  // §4 / B1-03: connection status is a safe boolean shell indicator for P only.
  // It makes no database-security claim and never appears in W/C/E.
  const connectionLabel = dbConnected === null
    ? t.common.checking
    : dbConnected
      ? t.settings.connected
      : t.settings.disconnected;

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
      case 'clients':
        return t.clients.subtitle;
      default:
        return t.appTagline;
    }
  };

  return (
    <div className="sticky top-0 z-30 print:hidden">
      <DemoBanner />
      <header className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 bg-surface-2/95 backdrop-blur-xs border-b border-border transition-colors">
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
            <h2
              data-page-heading
              tabIndex={-1}
              className="text-xl font-bold tracking-tight text-text break-words outline-none"
            >
              {title}
            </h2>
            <p className="hidden sm:block text-xs text-muted mt-0.5">
              {getTabSubtitle()}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 min-w-0">
          {/* Context identity pill (same truthful identity as the sidebar).
              F4: the full client title WRAPS at narrow widths — never hidden. */}
          {identity && (
            <div
              data-testid="context-identity"
              className="flex flex-wrap items-center gap-1.5 min-w-0 max-w-full px-2.5 py-1 rounded-full text-xs font-medium border border-border bg-surface-3 text-text"
              title={identity.value ?? t.contextIdentity[identity.labelKey]}
            >
              <Building2 className="w-3.5 h-3.5 shrink-0 text-brand-text" />
              <span className="whitespace-normal break-words">{t.contextIdentity[identity.labelKey]}</span>
              {identity.value && (
                <span className="whitespace-normal break-words text-muted">
                  · {identity.value}
                </span>
              )}
            </div>
          )}

          {/* B1-03: db diagnostics/pill are P ONLY (no W/C/E diagnostics). */}
          {context === 'platform' && (
            <div
              role="status"
              aria-label={connectionLabel}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                dbConnected === true
                  ? 'bg-success-soft text-success-text border-success'
                  : dbConnected === false
                    ? 'bg-warning-soft text-warning-text border-warning'
                    : 'bg-surface-3 text-muted border-border'
              }`}
              title={connectionLabel}
            >
              <Database className="w-3.5 h-3.5" />
              <span className="hidden md:inline">{connectionLabel}</span>
            </div>
          )}

          {/* §2/§7: the W exit control is always visible (never hover-only) and
              is absent for P/C/E (no client selector, no W actions there). */}
          {context === 'consultant' && (
            <button
              type="button"
              onClick={onExitToClients}
              disabled={exitBusy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-surface-2 border border-border-strong text-text hover:bg-surface-3 disabled:opacity-50"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="whitespace-normal">{t.workspace.exitToClients}</span>
            </button>
          )}

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

      {/* §2: suspended A is a read-only GE inspection warning, never a W control. */}
      {context === 'consultant' && workspace?.client?.suspended === true && (
        <div
          role="status"
          className="mx-4 sm:mx-6 lg:mx-8 mt-3 p-3 rounded-xl border border-warning bg-warning-soft text-warning-text text-xs flex items-center gap-2"
        >
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{t.workspace.clientSuspended}</span>
        </div>
      )}
    </div>
  );
};
