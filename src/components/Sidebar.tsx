import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  X,
} from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { apiFetch } from '../lib/api.ts';

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
      const res = await apiFetch('/api/notifications/unread-count', {
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
      roles: ['ge_admin'],
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

  // B15 (RTL docking): off-canvas transforms are scoped to mobile with
  // `max-lg:` so the desktop (lg:static) sidebar can never be translated
  // off-screen by a variant-ordering conflict. The drawer is anchored with
  // logical `start-0` (right in RTL, left in LTR); the closed state slides
  // it back toward its own anchor side per direction.
  const drawerClass = isOpen
    ? 'max-lg:translate-x-0'
    : 'max-lg:-translate-x-full max-lg:rtl:translate-x-full';

  // B15: Escape dismisses the mobile drawer; focus moves to the drawer
  // close control when the drawer opens (mobile only — isOpen is false
  // on desktop, so desktop focus is never stolen).
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    closeBtnRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          data-testid="sidebar-overlay"
          aria-hidden="true"
          className="fixed inset-0 z-40 bg-black/50 lg:hidden backdrop-blur-xs transition-opacity"
          onClick={onClose}
        />
      )}

      <aside
        data-testid="sidebar"
        aria-label={lang === 'ar' ? 'قائمة التنقل' : 'Navigation menu'}
        className={`print:hidden fixed inset-y-0 start-0 z-50 flex flex-col w-64 bg-sidebar-bg text-sidebar-text border-e border-sidebar-muted/60 transition-transform duration-200 ease-in-out lg:static lg:translate-x-0 ${drawerClass}`}
      >
        {/* Brand header */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-sidebar-muted/60">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-sidebar-active text-sidebar-active-text shadow-md shadow-sidebar-active/30">
            <span className="font-bold text-lg tracking-wider">GE</span>
          </div>
          <div className="min-w-0">
            <h1 className="font-bold text-base text-sidebar-text truncate">
              {t.brandGreenEdge}
            </h1>
            <p className="text-xs text-sidebar-muted truncate font-medium">
              ESG &amp; GRI System
            </p>
          </div>
          {/* B15: mobile drawer dismiss control (hidden on desktop where the
              sidebar is permanently docked). */}
          <button
            type="button"
            ref={closeBtnRef}
            onClick={onClose}
            data-testid="sidebar-close"
            aria-label={lang === 'ar' ? 'إغلاق القائمة' : 'Close navigation menu'}
            className="ms-auto lg:hidden p-2 -me-2 rounded-lg text-sidebar-muted hover:text-sidebar-text hover:bg-sidebar-active/15 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tenant context banner */}
        {user && (
          <div className="mx-4 mt-4 p-3 rounded-lg bg-surface-3 border border-sidebar-muted/60 text-xs">
            <div className="flex items-center gap-2 text-sidebar-muted mb-1">
              <Building2 className="w-3.5 h-3.5 text-sidebar-muted shrink-0" />
              <span className="font-medium uppercase text-[10px] text-muted">
                {t.nav.tenantBadge}
              </span>
            </div>
            <div className="font-medium text-text truncate">
              {user.clientName || (user.role === 'ge_admin' ? t.auth.notAssigned : user.clientId || 'Client Tenant')}
            </div>
            {user.departmentName && (
              <div className="text-muted mt-1 text-[11px] truncate">
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
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-sidebar-active text-sidebar-active-text font-semibold shadow-sm'
                    : 'text-sidebar-muted font-medium hover:text-sidebar-text hover:bg-sidebar-active/15'
                }`}
              >
              <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-sidebar-active-text' : 'text-sidebar-muted'}`} />
              <span className="truncate flex-1 text-start">{item.label}</span>
              {item.id === 'notifications' && unreadCount > 0 && (
                <span className="inline-flex items-center justify-center shrink-0 leading-none tabular-nums px-1.5 py-0.5 rounded-full bg-danger text-brand-ink text-[10px] font-bold">
                  {unreadCount > 50 ? '50+' : unreadCount}
                </span>
              )}
            </button>
            );
          })}
        </nav>

        {/* Footer actions: Language switch & User profile */}
        <div className="p-4 border-t border-sidebar-muted/60 space-y-2">
          {/* Language Toggle Button */}
          <button
            onClick={toggleLanguage}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-sidebar-muted hover:bg-sidebar-active/15 hover:text-sidebar-text transition-colors border border-sidebar-muted/50"
            title={lang === 'en' ? 'التبديل إلى العربية' : 'Switch to English'}
          >
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-sidebar-muted" />
              <span>{lang === 'en' ? 'Language' : 'اللغة'}</span>
            </div>
            <span className="px-2 py-0.5 rounded border border-sidebar-muted/40 text-sidebar-text font-semibold text-[11px]">
              {lang === 'en' ? 'العربية' : 'English'}
            </span>
          </button>

          {/* User info & Logout */}
          {user ? (
            <div>
              <div className="flex items-center gap-2 px-2 py-1 text-xs">
                <div className="w-7 h-7 rounded-full bg-surface-3 flex items-center justify-center font-bold text-sidebar-muted text-xs">
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sidebar-text truncate text-xs">{user.name}</p>
                  <p className="text-sidebar-muted truncate text-[10px]">{t.auth.roles[user.role]}</p>
                </div>
              </div>
              <button
                onClick={logout}
                className="w-full mt-2 flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-on-rail-danger hover:bg-danger/10 hover:text-on-rail-danger transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>{t.nav.logout}</span>
              </button>
            </div>
          ) : (
            <div className="p-2 text-center text-xs text-sidebar-muted">
              {t.appName}
            </div>
          )}
        </div>
      </aside>
    </>
  );
};
