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
import { RefreshCw } from 'lucide-react';

const MainApp: React.FC = () => {
  const { user, loading } = useAuth();
  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inSetupMode, setInSetupMode] = useState(false);
  const [dbConnected, setDbConnected] = useState(false);

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
