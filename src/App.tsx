import React, { useState, useEffect, useRef } from 'react';
import { LanguageProvider, useLanguage } from './i18n/LanguageContext.tsx';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { Sidebar, ActiveTab } from './components/Sidebar.tsx';
import { Header } from './components/Header.tsx';
import { idleState, idleSecondsRemaining } from './lib/idleTimeout.ts';
import { validateSelfChosenPassword } from './lib/password.ts';
import { DashboardView } from './views/DashboardView.tsx';
import { StandardsView } from './views/StandardsView.tsx';
import { GapAnalysisView } from './views/GapAnalysisView.tsx';
import { ActionsView } from './views/ActionsView.tsx';
import { InitiativesView } from './views/InitiativesView.tsx';
import { EsgProfileView } from './views/EsgProfileView.tsx';
import { ReportsView } from './views/ReportsView.tsx';
import { ImportGRIView } from './views/ImportGRIView.tsx';
import { SettingsView } from './views/SettingsView.tsx';
import { LoginView } from './views/LoginView.tsx';
import { SetupView } from './views/SetupView.tsx';
import { GeOverviewView } from './views/GeOverviewView.tsx';
import { ClientDetailView } from './views/ClientDetailView.tsx';
import { StaffListsView } from './views/StaffListsView.tsx';
import { ClientDashboardView } from './views/ClientDashboardView.tsx';
import { AuditLogView } from './views/AuditLogView.tsx';
import { NotificationsView } from './views/NotificationsView.tsx';
import { RefreshCw, TimerOff } from 'lucide-react';

const MainApp: React.FC = () => {
  const { user, token, loading, refreshUser, logout } = useAuth();
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inSetupMode, setInSetupMode] = useState(false);
  const [dbConnected, setDbConnected] = useState(false);
  // B11b (S-12): forced-change gate state (AuthContext type is frozen, so the
  // flag travels via /api/auth/me without editing the context module).
  const [mustChange, setMustChange] = useState(false);
  const [suspended, setSuspended] = useState(false);
  const [newPass, setNewPass] = useState('');
  const [curPass, setCurPass] = useState('');
  const [gateMsg, setGateMsg] = useState<string | null>(null);

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

  const checkDb = async () => {
    try {
      const res = await fetch('/api/db/status');
      if (res.ok) {
        const data = await res.json();
        setDbConnected(Boolean(data.connected));
      }
    } catch {
      setDbConnected(false);
    }
  };

  useEffect(() => {
    checkDb();
    const interval = setInterval(checkDb, 15000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="w-8 h-8 text-emerald-500 animate-spin" />
          <span className="text-xs text-slate-400">Loading ESG GRI Platform...</span>
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
      <div className="min-h-screen flex items-center justify-center bg-slate-100 p-6">
        <div className="max-w-md w-full p-8 bg-white rounded-2xl border border-rose-200 text-center">
          <h2 className="font-bold text-base">Tenant suspended</h2>
          <p className="text-xs text-slate-500 mt-2">This tenant is suspended. Contact the platform administrator.</p>
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
      <div className="min-h-screen flex items-center justify-center bg-slate-100 p-6">
        <form onSubmit={submitChange} className="max-w-md w-full p-8 bg-white rounded-2xl border space-y-3">
          <h2 className="font-bold text-base">{t.auth.forcedChangeTitle}</h2>
          <p className="text-xs text-slate-500">{t.auth.forcedChangeDesc}</p>
          <p className="text-[11px] text-slate-400">{t.auth.passwordComplexityHint}</p>
          {gateMsg && <p className="text-xs text-rose-600">{gateMsg}</p>}
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
          <button type="submit" className="w-full py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-bold">
            {t.auth.changeAndContinue}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 overflow-hidden font-sans">
      {/* Sidebar with RTL and Tenant Context */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header
          activeTab={activeTab}
          onOpenMobileMenu={() => setSidebarOpen(true)}
          dbConnected={dbConnected}
        />

        {/* B12 (S-01): inactivity warning — bilingual notice + countdown. */}
        {idleWarning && user && (
          <div className="mx-4 sm:mx-6 lg:mx-8 mt-4 p-4 rounded-2xl border border-amber-300 bg-amber-50 text-amber-900 text-xs flex items-center gap-3">
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
              className="px-3 py-1.5 rounded-xl bg-amber-600 text-white font-bold"
            >
              {t.idle.staySignedIn}
            </button>
            <button
              onClick={() => logout()}
              className="px-3 py-1.5 rounded-xl border border-amber-400 font-bold"
            >
              {t.idle.signOutNow}
            </button>
          </div>
        )}

        <main data-testid="main-content" className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="max-w-7xl mx-auto">
            {activeTab === 'dashboard' && (
              <DashboardView setActiveTab={setActiveTab} dbConnected={dbConnected} />
            )}
            {activeTab === 'standards' && (
              <StandardsView setActiveTab={setActiveTab} />
            )}
            {activeTab === 'gap-analysis' && (
              <GapAnalysisView setActiveTab={setActiveTab} />
            )}
            {activeTab === 'actions' && <ActionsView />}
            {activeTab === 'initiatives' && <InitiativesView />}
            {activeTab === 'esg-profile' && <EsgProfileView />}
            {activeTab === 'reports' && <ReportsView />}
            {activeTab === 'import-gri' && (
              <ImportGRIView
                setActiveTab={setActiveTab}
                onDataImported={() => {
                  checkDb();
                }}
              />
            )}
            {activeTab === 'settings' && (
              <SettingsView
                onDbStatusChanged={() => {
                  checkDb();
                }}
              />
            )}
            {activeTab === 'ge-overview' && <GeOverviewView />}
            {activeTab === 'client-detail' && <ClientDetailView />}
            {activeTab === 'staff-lists' && <StaffListsView />}
            {activeTab === 'client-dashboard' && <ClientDashboardView />}
            {activeTab === 'audit-log' && <AuditLogView />}
            {activeTab === 'notifications' && <NotificationsView />}
          </div>
        </main>
      </div>
    </div>
  );
};

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <MainApp />
      </AuthProvider>
    </LanguageProvider>
  );
}
