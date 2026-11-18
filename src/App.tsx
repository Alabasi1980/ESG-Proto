import React, { useState, useEffect, useRef, useCallback } from 'react';
import { LanguageProvider, useLanguage } from './i18n/LanguageContext.tsx';
import { useAuth } from './context/AuthContext.tsx';
import { Sidebar, ActiveTab } from './components/Sidebar.tsx';
import { Header } from './components/Header.tsx';
import { deriveNavContext, resolveShellPage, workspaceExitLanding, type PageId } from './lib/navModel.ts';
import { idleState, idleSecondsRemaining } from './lib/idleTimeout.ts';
import { validateSelfChosenPassword } from './lib/password.ts';
import { DashboardView } from './views/DashboardView.tsx';
import { StandardsView } from './views/StandardsView.tsx';
import { ServicesView } from './views/ServicesView.tsx';
import { GapAnalysisView } from './views/GapAnalysisView.tsx';
import { EmployeeServicesView } from './views/EmployeeServicesView.tsx';
import { ClientConsoleView } from './views/ClientConsoleView.tsx';
import { ActionsView } from './views/ActionsView.tsx';
import { InitiativesView } from './views/InitiativesView.tsx';
import { EsgProfileView } from './views/EsgProfileView.tsx';
import { ReportsView } from './views/ReportsView.tsx';
import { ImportGRIView } from './views/ImportGRIView.tsx';
import { SettingsView } from './views/SettingsView.tsx';
import { LoginView } from './views/LoginView.tsx';
import { SetupView } from './views/SetupView.tsx';
import { GeOverviewView } from './views/GeOverviewView.tsx';
import { ClientsView } from './views/ClientsView.tsx';
import { ClientDetailView } from './views/ClientDetailView.tsx';
import { StaffListsView } from './views/StaffListsView.tsx';
import { ClientDashboardView } from './views/ClientDashboardView.tsx';
import { AuditLogView } from './views/AuditLogView.tsx';
import { NotificationsView } from './views/NotificationsView.tsx';
import { RefreshCw, TimerOff } from 'lucide-react';

const MainApp: React.FC = () => {
  const {
    user,
    token,
    loading,
    refreshUser,
    logout,
    workspace,
    workspacePhase,
    bootLanding,
    recoveryLandingToken,
    enterWorkspace,
    exitWorkspace,
    retryWorkspace,
  } = useAuth();
  const { t } = useLanguage();
  // TASK-PROTO-U3-B1 §3: the REQUESTED tab (may be a stale/forbidden value from
  // a previous context). It is never rendered directly — see `currentPage`.
  const [activeTab, setActiveTab] = useState<ActiveTab | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inSetupMode, setInSetupMode] = useState(false);
  // B1-03 / U3-B2 §3: `null` = not checked yet. The value is only ever polled
  // and displayed in P; W/C/E get no db diagnostics.
  const [dbConnected, setDbConnected] = useState<boolean | null>(null);
  // §3 Configure: a sub-state of the Clients page (sidebar stays on `clients`).
  const [clientConfig, setClientConfig] = useState<{ id: string; name: string } | null>(null);
  // M1: a destination that must survive the upcoming context change (Exit /
  // recovery). It outranks the raw tab, so the old context cannot coerce it.
  const [pendingLanding, setPendingLanding] = useState<PageId | null>(null);
  // B11b (S-12): forced-change gate state (AuthContext type is frozen, so the
  // flag travels via /api/auth/me without editing the context module).
  const [mustChange, setMustChange] = useState(false);
  const [suspended, setSuspended] = useState(false);
  const [newPass, setNewPass] = useState('');
  const [curPass, setCurPass] = useState('');
  const [gateMsg, setGateMsg] = useState<string | null>(null);

  // §7 acknowledgment: after a confirmed transition the destination heading
  // receives focus (never the old client content).
  const focusAfterTransition = useRef(false);

  // B12 (S-01): client-side inactivity timer — 30 min → auto logout, warning
  // at 28 min with a bilingual notice + countdown. Any pointer/key/touch
  // activity resets the clock.
  const lastActivityRef = useRef<number>(Date.now());
  const [idleWarning, setIdleWarning] = useState(false);
  const [idleSecsLeft, setIdleSecsLeft] = useState(0);

  useEffect(() => {
    if (!token) {
      setMustChange(false);
      setSuspended(false);
      return;
    }
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => {
        setMustChange(Boolean((d.user as any)?.mustChangePassword));
        setSuspended(Boolean((d.user as any)?.suspended));
      })
      .catch(() => {});
  }, [token, user]);

  useEffect(() => {
    if (!token) return;
    const bump = () => {
      lastActivityRef.current = Date.now();
      setIdleWarning(false);
    };
    window.addEventListener('pointerdown', bump);
    window.addEventListener('keydown', bump);
    window.addEventListener('touchstart', bump);
    const id = setInterval(() => {
      const now = Date.now();
      const state = idleState(lastActivityRef.current, now);
      if (state === 'expired') {
        clearInterval(id);
        logout();
      } else if (state === 'warning') {
        setIdleWarning(true);
        setIdleSecsLeft(idleSecondsRemaining(lastActivityRef.current, now));
      } else {
        setIdleWarning(false);
      }
    }, 1000);
    return () => {
      window.removeEventListener('pointerdown', bump);
      window.removeEventListener('keydown', bump);
      window.removeEventListener('touchstart', bump);
      clearInterval(id);
    };
  }, [token, logout]);

  // TASK-PROTO-U3-B1 §2: the context derives ONLY from the session role plus the
  // workspace tab mirror (platform/consultant + bound client). No URL, no
  // localStorage, no guessed tenant; an unknown role yields no context (no pages).
  const context = user
    ? deriveNavContext(user.role, workspace?.mode ?? null, Boolean(workspace?.client))
    : null;

  // §2/§7: while a workspace transition is pending the resolved page/chrome is
  // NOT rendered — the named transition/recovery state replaces it. This is the
  // W-chrome-only-after-reconcile gate (B1-01).
  const workspaceBlocked = Boolean(user && user.role === 'ge_admin' && workspacePhase !== 'idle');

  // B1-03 / U3-B2 §3: db/status polling is P ONLY (no C/E diagnostics, no
  // interval at all outside platform). No "RLS proven" claim anywhere.
  const checkDb = useCallback(async () => {
    try {
      const res = await fetch('/api/db/status');
      if (res.ok) {
        const data = await res.json();
        setDbConnected(Boolean(data.connected));
      } else {
        setDbConnected(false);
      }
    } catch {
      setDbConnected(false);
    }
  }, []);

  useEffect(() => {
    if (context !== 'platform' || workspaceBlocked) {
      setDbConnected(null);
      return;
    }
    void checkDb();
    const interval = setInterval(checkDb, 15000);
    return () => clearInterval(interval);
  }, [context, workspaceBlocked, checkDb]);

  // §3 guard: the requested tab is resolved through the model BEFORE any mount.
  // An absent or not-yet-implemented page becomes the context landing, so a
  // forbidden view is never instantiated, fetched or polled (and nothing of the
  // old view flashes, because rendering only ever uses `currentPage`).
  // M4: a generated recovery destination is consumed exactly once, and it is
  // part of the SAME deterministic resolution (no transient P page paints).
  const recoveryConsumedRef = useRef(-1);
  const recoveryLandingActive = recoveryLandingToken > 0
    && recoveryConsumedRef.current !== recoveryLandingToken;
  const shellPending = pendingLanding ?? (recoveryLandingActive ? workspaceExitLanding() : null);

  // M1: ONE deterministic resolution (pendingLanding > activeTab > bootLanding).
  // During a transition nothing is resolved/mounted.
  const currentPage = resolveShellPage({
    context,
    phase: workspacePhase,
    activeTab,
    bootLanding,
    pendingLanding: shellPending,
    hasConfigTarget: Boolean(clientConfig),
  });

  useEffect(() => {
    if (!context || workspacePhase !== 'idle') return;
    if (shellPending) {
      // Commit + clear the destination only after the new context is settled.
      setActiveTab(resolveShellPage({
        context, phase: 'idle', activeTab: null, bootLanding, pendingLanding: shellPending, hasConfigTarget: Boolean(clientConfig),
      }) ?? shellPending);
      if (recoveryLandingActive) recoveryConsumedRef.current = recoveryLandingToken;
      setPendingLanding(null);
      return;
    }
    if (currentPage && currentPage !== activeTab) setActiveTab(currentPage);
  }, [context, workspacePhase, shellPending, recoveryLandingActive, recoveryLandingToken, bootLanding, currentPage, activeTab, clientConfig]);

  // §2/§7: logout (or expiry) resets the tab request, so the next fresh login
  // lands on the context landing (§2) rather than replaying a stale W tab.
  useEffect(() => {
    if (!user) {
      setActiveTab(null);
      setPendingLanding(null);
      setClientConfig(null);
    }
  }, [user]);



  // §3: the configuration sub-state belongs to Clients only.
  useEffect(() => {
    if (currentPage !== 'clients') setClientConfig(null);
  }, [currentPage]);

  // §7 acknowledgment: focus the destination heading once the transition settles.
  useEffect(() => {
    if (workspacePhase === 'idle' && focusAfterTransition.current) {
      focusAfterTransition.current = false;
      const heading = document.querySelector<HTMLElement>('[data-page-heading]');
      heading?.focus();
    }
  }, [workspacePhase, currentPage]);

  /**
   * §2 Enter. The row confirmation already named client+action; this only runs
   * the server transition. On success the verified W context lands `dashboard`.
   */
  const handleEnter = async (clientId: string) => {
    focusAfterTransition.current = true;
    const result = await enterWorkspace(clientId);
    if (result.ok && result.mode === 'consultant') setActiveTab('dashboard');
  };

  /** §2 Exit: confirm the action, then POST exit → P landing `clients`. */
  const handleExit = async () => {
    if (workspacePhase !== 'idle') return;
    if (!window.confirm(t.workspace.exitConfirm)) return;
    focusAfterTransition.current = true;
    // M1: park the destination BEFORE the context changes; pendingLanding wins
    // over the old tab, so the first post-exit render is Clients (no coercion).
    setPendingLanding(workspaceExitLanding());
    await exitWorkspace();
  };

  /** §7 Retry: reconcile first; a boot recovery always lands P → Clients. */
  const handleRetry = async () => {
    focusAfterTransition.current = true;
    const result = await retryWorkspace();
    if (result.ok) {
      setActiveTab(result.mode === 'consultant' ? 'dashboard' : workspaceExitLanding());
    }
  };

  const handleConfigure = (clientId: string, clientName: string) => {
    setClientConfig({ id: clientId, name: clientName });
  };

  // §3 mount switch: exactly ONE view per resolved page. Views are statically
  // imported (as before) but only the resolved one is ever instantiated/rendered
  // — a forbidden page therefore mounts nothing and fires no fetch/poll.
  const renderView = (page: PageId) => {
    switch (page) {
      case 'dashboard':
        return <DashboardView setActiveTab={setActiveTab} dbConnected={dbConnected === true} />;
      case 'standards':
        // B17 §10 (OD-11) / TASK-PROTO-U4-2: the `standards` id is the P
        // services workspace; W/C keep the GRI catalogue page unchanged.
        return context === 'platform' ? <ServicesView /> : <StandardsView setActiveTab={setActiveTab} />;
      case 'gap-analysis':
        // TASK-PROTO-U4-3 unit (a): the employee landing mounts the services
        // workspace (own-dept services → items + documents + initiatives).
        // TASK-PROTO-U4-3 unit (b): the client_admin landing mounts the client
        // console (linked-services read + preliminary confirm + staff fill).
        // No nav-matrix change: the page id and its labels are untouched.
        return user?.role === 'employee' ? <EmployeeServicesView /> : user?.role === 'client_admin' ? <ClientConsoleView /> : <GapAnalysisView setActiveTab={setActiveTab} />;
      case 'actions':
        return <ActionsView />;
      case 'initiatives':
        return <InitiativesView />;
      case 'esg-profile':
        return <EsgProfileView />;
      case 'reports':
        return <ReportsView />;
      case 'import-gri':
        return (
          <ImportGRIView
            setActiveTab={setActiveTab}
            onDataImported={() => {
              void checkDb();
            }}
          />
        );
      case 'settings':
        return (
          <SettingsView
            onDbStatusChanged={() => {
              void checkDb();
            }}
          />
        );
      case 'ge-overview':
        return <GeOverviewView />;
      case 'clients':
        return (
          <ClientsView
            onEnter={handleEnter}
            onConfigure={handleConfigure}
            transitionBusy={workspacePhase !== 'idle'}
          />
        );
      case 'client-detail':
        // P mounts Client Detail only through the Configure sub-state (explicit
        // T); W/C derive their own verified client inside the view.
        return context === 'platform' ? null : <ClientDetailView />;
      case 'staff-lists':
        return <StaffListsView />;
      case 'client-dashboard':
        return <ClientDashboardView />;
      case 'audit-log':
        return <AuditLogView />;
      case 'notifications':
        return <NotificationsView />;
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="w-8 h-8 text-brand-text animate-spin" />
          <span className="text-xs text-muted">Loading ESG GRI Platform...</span>
        </div>
      </div>
    );
  }

  // If user is not authenticated: show Login or Setup view
  if (!user) {
    if (inSetupMode) {
      return <SetupView onBackToLogin={() => setInSetupMode(false)} />;
    }
    return <LoginView onSwitchToSetup={() => setInSetupMode(true)} />;
  }

  // B11b (S-12/S-09): fail-closed gates. Forced change blocks every other
  // action until the password is replaced; suspended tenants see no data.
  if (suspended) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface p-6">
        <div className="max-w-md w-full p-8 bg-surface-2 rounded-2xl border border-danger text-center">
          <h2 className="font-bold text-base">Tenant suspended</h2>
          <p className="text-xs text-muted mt-2">This tenant is suspended. Contact the platform administrator.</p>
        </div>
      </div>
    );
  }
  if (mustChange) {
    const submitChange = async (e: React.FormEvent) => {
      e.preventDefault();
      setGateMsg(null);
      // B12 (S-02): client mirrors the shared complexity rule (server is
      // source of truth and re-validates).
      const localCheck = validateSelfChosenPassword(newPass);
      if (!localCheck.ok) {
        setGateMsg(localCheck.error ?? t.auth.passwordTooShort);
        return;
      }
      try {
        const res = await fetch('/api/auth/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' },
          body: JSON.stringify({ currentPassword: curPass, newPassword: newPass }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to change password');
        setCurPass('');
        setNewPass('');
        await refreshUser();
        setMustChange(false);
      } catch (err: any) {
        setGateMsg(err.message);
      }
    };
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface p-6">
        <form onSubmit={submitChange} className="max-w-md w-full p-8 bg-surface-2 rounded-2xl border space-y-3">
          <h2 className="font-bold text-base">{t.auth.forcedChangeTitle}</h2>
          <p className="text-xs text-muted">{t.auth.forcedChangeDesc}</p>
          <p className="text-[11px] text-muted">{t.auth.passwordComplexityHint}</p>
          {gateMsg && <p className="text-xs text-danger">{gateMsg}</p>}
          <input
            type="password"
            required
            value={curPass}
            onChange={(e) => setCurPass(e.target.value)}
            placeholder={t.auth.currentPassword}
            className="w-full px-3 py-2 rounded-xl text-xs border"
          />
          <input
            type="password"
            required
            minLength={10}
            value={newPass}
            onChange={(e) => setNewPass(e.target.value)}
            placeholder={t.auth.newPassword}
            className="w-full px-3 py-2 rounded-xl text-xs border"
          />
          <button type="submit" className="w-full py-2.5 rounded-xl bg-brand text-brand-ink text-xs font-bold">
            {t.auth.changeAndContinue}
          </button>
        </form>
      </div>
    );
  }

  // §2/§7: the transition states replace ALL protected content — old client
  // views, context chrome and caches are unmounted, never flashed behind it.
  if (workspaceBlocked) {
    if (workspacePhase === 'failed') {
      return (
        <div className="min-h-screen bg-surface flex items-center justify-center p-6">
          <div role="alert" className="max-w-md w-full p-8 bg-surface-2 rounded-2xl border border-danger text-center">
            <h2 className="text-base font-bold text-text">{t.workspace.confirmFailed}</h2>
            <p className="text-xs text-muted mt-2">{t.workspace.confirmFailedDesc}</p>
            <button
              type="button"
              onClick={() => void handleRetry()}
              className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand text-brand-ink text-xs font-bold hover:bg-brand-strong"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>{t.workspace.retry}</span>
            </button>
          </div>
        </div>
      );
    }
    const message = workspacePhase === 'opening'
      ? t.workspace.opening
      : workspacePhase === 'closing'
        ? t.workspace.closing
        : t.workspace.checking;
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-6">
        <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 text-center">
          <RefreshCw className="w-8 h-8 text-brand-text animate-spin" />
          <p className="text-sm font-semibold text-text">{message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-surface text-text overflow-hidden font-sans">
      {/* Sidebar with RTL and Tenant Context. `key` remounts it on a context
          transition so the unread badge/drawer state cannot leak across W/P
          (§7: clear unread count on transitions). */}
      <Sidebar
        key={context ?? 'none'}
        context={context}
        activeTab={currentPage}
        setActiveTab={setActiveTab}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header
          context={context}
          activeTab={currentPage}
          onOpenMobileMenu={() => setSidebarOpen(true)}
          dbConnected={dbConnected}
          onExitToClients={() => void handleExit()}
          exitBusy={workspacePhase !== 'idle'}
        />

        {/* B12 (S-01): inactivity warning — bilingual notice + countdown. */}
        {idleWarning && user && (
          <div className="mx-4 sm:mx-6 lg:mx-8 mt-4 p-4 rounded-2xl border border-warning bg-warning-soft text-warning text-xs flex items-center gap-3">
            <TimerOff className="w-5 h-5 shrink-0" />
            <div className="flex-1">
              <p className="font-bold">{t.idle.warningTitle}</p>
              <p>
                {t.idle.warningMessage} ({idleSecsLeft} {t.idle.secondsLeft})
              </p>
            </div>
            <button
              onClick={() => {
                lastActivityRef.current = Date.now();
                setIdleWarning(false);
              }}
              className="px-3 py-1.5 rounded-xl bg-warning text-brand-ink font-bold"
            >
              {t.idle.staySignedIn}
            </button>
            <button
              onClick={() => logout()}
              className="px-3 py-1.5 rounded-xl border border-warning font-bold"
            >
              {t.idle.signOutNow}
            </button>
          </div>
        )}

        <main data-testid="main-content" className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="max-w-7xl mx-auto">
            {context && currentPage ? (
              context === 'platform' && currentPage === 'clients' && clientConfig ? (
                <div className="space-y-4">
                  {/* §3: stay P, highlight `clients`, offer Back to Clients. */}
                  <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-surface-2 rounded-2xl border border-border">
                    <h3 className="text-sm font-bold text-text break-words">
                      {t.workspace.configureTitle}: {clientConfig.name}
                    </h3>
                    <button
                      type="button"
                      onClick={() => setClientConfig(null)}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold bg-surface-2 border border-border-strong text-text hover:bg-surface-3"
                    >
                      {t.workspace.backToClients}
                    </button>
                  </div>
                  <ClientDetailView key={clientConfig.id} clientId={clientConfig.id} />
                </div>
              ) : renderView(currentPage)
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
};

export default function App() {
  // AuthProvider/ThemeProvider live in main.tsx (Auth outer, Theme inner): the
  // theme provider reads the authenticated session, so it must sit below it.
  return (
    <LanguageProvider>
      <MainApp />
    </LanguageProvider>
  );
}
