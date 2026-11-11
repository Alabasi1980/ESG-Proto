import React, { useState, useEffect } from 'react';
import { LanguageProvider } from './i18n/LanguageContext.tsx';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { Sidebar, ActiveTab } from './components/Sidebar.tsx';
import { Header } from './components/Header.tsx';
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
import { RefreshCw } from 'lucide-react';

const MainApp: React.FC = () => {
  const { user, token, loading, refreshUser } = useAuth();
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
          <h2 className="font-bold text-base">Password change required</h2>
          <p className="text-xs text-slate-500">Your account was provisioned with a one-time password. Set a new password to continue.</p>
          {gateMsg && <p className="text-xs text-rose-600">{gateMsg}</p>}
          <input
            type="password"
            required
            value={curPass}
            onChange={(e) => setCurPass(e.target.value)}
            placeholder="One-time password"
            className="w-full px-3 py-2 rounded-xl text-xs border"
          />
          <input
            type="password"
            required
            minLength={6}
            value={newPass}
            onChange={(e) => setNewPass(e.target.value)}
            placeholder="New password (min 6)"
            className="w-full px-3 py-2 rounded-xl text-xs border"
          />
          <button type="submit" className="w-full py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-bold">
            Change password & continue
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

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
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
