import React, { useCallback, useEffect, useState } from 'react';
import {
  LayoutDashboard,
  BookOpen,
  Scale,
  UploadCloud,
  Settings,
  LogOut,
  Globe,
  Building2,
  Wrench,
  Lightbulb,
  Sprout,
  FileText,
  Bell,
  ScrollText,
} from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';

export type ActiveTab =
  | 'dashboard'
  | 'standards'
  | 'gap-analysis'
  | 'actions'
  | 'initiatives'
  | 'esg-profile'
  | 'reports'
  | 'import-gri'
  | 'settings'
  | 'ge-overview'
  | 'client-detail'
  | 'staff-lists'
  | 'client-dashboard'
  | 'audit-log'
  | 'notifications';

interface SidebarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  isOpen: boolean;
  onClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  isOpen,
  onClose,
}) => {
  const { t, lang, setLang } = useLanguage();
  const { user, token, logout } = useAuth();
  // B12 (S-23): unread badge next to the notifications tab (own inbox only).
  const [unreadCount, setUnreadCount] = useState(0);

  const toggleLanguage = () => {
    setLang(lang === 'en' ? 'ar' : 'en');
  };

  const fetchUnread = useCallback(async () => {
    if (!token) {
      setUnreadCount(0);
      return;
    }
    try {
      const res = await fetch('/api/notifications/unread-count', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUnreadCount(Number(data.unreadCount) || 0);
      }
    } catch {
      // Badge is best-effort; the inbox view is the source of truth.
    }
  }, [token]);

  useEffect(() => {
    fetchUnread();
    const id = setInterval(fetchUnread, 30000);
    return () => clearInterval(id);
  }, [fetchUnread, activeTab]);

  const navItems = [
    {
      id: 'dashboard' as ActiveTab,
      label: t.nav.dashboard,
      icon: LayoutDashboard,
      roles: ['ge_admin', 'client_admin', 'employee'],
    },
    {
      id: 'standards' as ActiveTab,
      label: t.nav.standards,
      icon: BookOpen,
      roles: ['ge_admin', 'client_admin', 'employee'],
    },
    {
      id: 'gap-analysis' as ActiveTab,
      label: t.nav.gapAnalysis,
      icon: Scale,
      roles: ['ge_admin', 'client_admin', 'employee'],
    },
    {
      id: 'reports' as ActiveTab,
      label: t.nav.reports,
      icon: FileText,
      roles: ['ge_admin', 'client_admin', 'employee'],
    },
    {
      id: 'import-gri' as ActiveTab,
      label: t.nav.importGRI,
      icon: UploadCloud,
      roles: ['ge_admin', 'client_admin'],
    },
    {
      id: 'actions' as ActiveTab,
      label: t.nav.correctiveActions,
      icon: Wrench,
      roles: ['ge_admin', 'client_admin', 'employee'],
    },
    {
      id: 'initiatives' as ActiveTab,
      label: t.nav.initiatives,
      icon: Lightbulb,
      roles: ['ge_admin', 'client_admin', 'employee'],
    },
    {
      id: 'esg-profile' as ActiveTab,
      label: t.nav.esgProfile,
      icon: Sprout,
      roles: ['ge_admin', 'client_admin', 'employee'],
    },
    {
      id: 'settings' as ActiveTab,
      label: t.nav.settings,
      icon: Settings,
      roles: ['ge_admin', 'client_admin', 'employee'],
    },
    {
      id: 'ge-overview' as ActiveTab,
      label: t.nav.geOverview,
      icon: Building2,
      roles: ['ge_admin'],
    },
    {
      id: 'client-detail' as ActiveTab,
      label: t.nav.clientDetail,
      icon: Wrench,
      roles: ['ge_admin', 'client_admin'],
    },
    {
      id: 'staff-lists' as ActiveTab,
      label: t.nav.staffLists,
      icon: Lightbulb,
      roles: ['ge_admin', 'client_admin'],
    },
    {
      id: 'client-dashboard' as ActiveTab,
      label: t.nav.clientDashboard,
      icon: LayoutDashboard,
      roles: ['ge_admin', 'client_admin'],
    },
    {
      id: 'audit-log' as ActiveTab,
      label: t.nav.auditLog,
      icon: ScrollText,
      roles: ['ge_admin'],
    },
    {
      id: 'notifications' as ActiveTab,
      label: t.nav.notifications,
      icon: Bell,
      roles: ['ge_admin', 'client_admin', 'employee'],
    },
  ];

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden backdrop-blur-xs transition-opacity"
          onClick={onClose}
        />
      )}

      <aside
        className={`print:hidden fixed top-0 bottom-0 z-40 flex flex-col w-64 bg-slate-900 text-slate-100 border-e border-slate-800 transition-transform duration-200 ease-in-out lg:static lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full'
        }`}
      >
        {/* Brand header */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-slate-800">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-600 text-white shadow-md shadow-emerald-900/30">
            <span className="font-bold text-lg tracking-wider">GE</span>
          </div>
          <div className="min-w-0">
            <h1 className="font-bold text-base tracking-tight text-white truncate">
              {t.brandGreenEdge}
            </h1>
            <p className="text-xs text-emerald-400 truncate font-medium">
              ESG & GRI System
            </p>
          </div>
        </div>

        {/* Tenant context banner */}
        {user && (
          <div className="mx-4 mt-4 p-3 rounded-lg bg-slate-800/80 border border-slate-700/60 text-xs">
            <div className="flex items-center gap-2 text-slate-400 mb-1">
              <Building2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="font-semibold uppercase tracking-wider text-[10px]">
                {t.nav.tenantBadge}
              </span>
            </div>
            <div className="font-medium text-white truncate">
              {user.clientName || (user.role === 'ge_admin' ? t.auth.notAssigned : user.clientId || 'Client Tenant')}
            </div>
            {user.departmentName && (
              <div className="text-slate-400 mt-1 text-[11px] truncate">
                {t.auth.department}: {user.departmentName}
              </div>
            )}
          </div>
        )}

        {/* Navigation list */}
        <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isAuthorized = !user || item.roles.includes(user.role);
            if (!isAuthorized) return null;

            const isActive = activeTab === item.id;
            const Icon = item.icon;

            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  onClose();
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                }`}
              >
              <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
              <span className="truncate flex-1 text-start">{item.label}</span>
              {item.id === 'notifications' && unreadCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-bold">
                  {unreadCount > 50 ? '50+' : unreadCount}
                </span>
              )}
            </button>
            );
          })}
        </nav>

        {/* Footer actions: Language switch & User profile */}
        <div className="p-4 border-t border-slate-800 space-y-2">
          {/* Language Toggle Button */}
          <button
            onClick={toggleLanguage}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors border border-slate-700/50"
            title={lang === 'en' ? 'التبديل إلى العربية' : 'Switch to English'}
          >
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-emerald-400" />
              <span>{lang === 'en' ? 'Language' : 'اللغة'}</span>
            </div>
            <span className="px-2 py-0.5 rounded bg-slate-700 text-emerald-300 font-semibold text-[11px]">
              {lang === 'en' ? 'العربية' : 'English'}
            </span>
          </button>

          {/* User info & Logout */}
          {user ? (
            <div className="pt-2">
              <div className="flex items-center gap-2 px-2 py-1 text-xs">
                <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center font-bold text-emerald-400 text-xs">
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-white truncate text-xs">{user.name}</p>
                  <p className="text-slate-400 truncate text-[10px]">{t.auth.roles[user.role]}</p>
                </div>
              </div>
              <button
                onClick={logout}
                className="w-full mt-2 flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>{t.nav.logout}</span>
              </button>
            </div>
          ) : (
            <div className="p-2 text-center text-xs text-slate-400">
              {t.appName}
            </div>
          )}
        </div>
      </aside>
    </>
  );
};
