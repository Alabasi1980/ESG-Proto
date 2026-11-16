import React, { useState, useEffect } from 'react';
import {
  Database,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Globe,
  Lock,
  ShieldCheck,
  User,
  Building,
  Users,
  UserPlus,
  UserX,
  UserCheck,
  HardDrive,
  Palette,
} from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { apiFetch } from '../lib/api.ts';
import { ServicesManage } from './ServicesManage.tsx';
import { validateSelfChosenPassword } from '../lib/password.ts';

interface SettingsViewProps {
  onDbStatusChanged?: () => void;
}

// TASK-PROTO-H13: the closed option set of the platform-wide app theme. 'auto'
// is the UI spelling of "no global override" (the server stores NULL).
type AppThemeOption = 'auto' | 'ge' | 'lime' | 'dark';
const APP_THEME_CHOICES: readonly AppThemeOption[] = ['auto', 'ge', 'lime', 'dark'];

export const SettingsView: React.FC<SettingsViewProps> = ({ onDbStatusChanged }) => {
  const { t, lang, setLang } = useLanguage();
  const { user, token, refreshUser } = useAuth();

  // Database status state
  const [dbStatus, setDbStatus] = useState<{
    configured: boolean;
    connected: boolean;
    tableCount: number;
    tables: string[];
    userCount: number;
    error?: string;
  } | null>(null);
  const [loadingDb, setLoadingDb] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migrateSuccess, setMigrateSuccess] = useState<string | null>(null);
  const [migrateError, setMigrateError] = useState<string | null>(null);

  // Change password state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPass, setChangingPass] = useState(false);
  const [passMessage, setPassMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // C2: minimal user management (admins only)
  interface ManagedUser {
    id: string;
    email: string;
    name: string;
    role: string;
    is_active: boolean;
    client_id: string | null;
    department_id: string | null;
    client_name: string | null;
    department_name: string | null;
    created_at: string;
  }
  const isAdmin = user?.role === 'ge_admin' || user?.role === 'client_admin';
  const isGeAdmin = user?.role === 'ge_admin';
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [departments, setDepartments] = useState<{ id: string; name: string; client_id: string }[]>([]);
  const [tenants, setTenants] = useState<{ id: string; code: string; name: string }[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('employee');
  const [newTenantId, setNewTenantId] = useState('');
  const [newDeptId, setNewDeptId] = useState('');
  const [creatingUser, setCreatingUser] = useState(false);
  const [userMessage, setUserMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const authHeaders = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    Authorization: token ? `Bearer ${token}` : '',
  });

  // TASK-PROTO-H13: platform-wide application theme (app_settings). Platform
  // only — client_admin/employee never see this section and keep their tenant
  // theme. The value is server-owned, so after a successful save we re-read the
  // session (refreshUser) and ThemeContext applies it immediately.
  const [appTheme, setAppTheme] = useState<AppThemeOption>('auto');
  const [loadingAppTheme, setLoadingAppTheme] = useState(false);
  const [savingAppTheme, setSavingAppTheme] = useState(false);
  const [appThemeMessage, setAppThemeMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const appThemeLabel = (option: AppThemeOption): string =>
    option === 'auto' ? t.settings.appThemeAuto
      : option === 'ge' ? t.settings.appThemeGe
        : option === 'lime' ? t.settings.appThemeLime : t.settings.appThemeDark;

  const fetchAppTheme = async () => {
    if (!isGeAdmin) return;
    setLoadingAppTheme(true);
    try {
      const res = await apiFetch('/api/settings', { headers: { Authorization: token ? `Bearer ${token}` : '' } });
      if (res.ok) {
        const data = await res.json();
        const stored = data?.theme;
        setAppTheme(stored === 'ge' || stored === 'lime' || stored === 'dark' ? stored : 'auto');
      }
    } catch (err) {
      console.error('Error querying application theme:', err);
    } finally {
      setLoadingAppTheme(false);
    }
  };

  useEffect(() => {
    fetchAppTheme();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user?.role]);

  const handleSaveAppTheme = async () => {
    setAppThemeMessage(null);
    setSavingAppTheme(true);
    try {
      const res = await apiFetch('/api/settings', {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ theme: appTheme }),
      });
      const data = await res.json();
      if (res.ok) {
        setAppThemeMessage({ type: 'success', text: t.settings.appThemeSaved });
        await refreshUser();
      } else {
        setAppThemeMessage({ type: 'error', text: data.error || t.settings.appThemeFailed });
      }
    } catch (err: any) {
      setAppThemeMessage({ type: 'error', text: err.message || t.settings.appThemeFailed });
    } finally {
      setSavingAppTheme(false);
    }
  };

  const fetchUsers = async () => {
    if (!isAdmin) return;
    setLoadingUsers(true);
    try {
      const res = await apiFetch('/api/users', { headers: { Authorization: token ? `Bearer ${token}` : '' } });
      if (res.ok) {
        setManagedUsers(await res.json());
      }
    } catch (err) {
      console.error('Error querying users:', err);
    } finally {
      setLoadingUsers(false);
    }
  };

  const fetchUserLookups = async () => {
    if (!isAdmin) return;
    try {
      const headers = { Authorization: token ? `Bearer ${token}` : '' };
      const [deptRes, tenantRes] = await Promise.all([
        apiFetch('/api/departments', { headers }),
        isGeAdmin ? apiFetch('/api/clients', { headers }) : Promise.resolve(null),
      ]);
      if (deptRes.ok) setDepartments(await deptRes.json());
      if (tenantRes && tenantRes.ok) setTenants(await tenantRes.json());
    } catch (err) {
      console.error('Error querying user lookups:', err);
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchUserLookups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user?.role]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserMessage(null);
    // B12 (S-02): client mirrors the shared complexity rule (server re-validates).
    const newUserPwCheck = validateSelfChosenPassword(newPasswordInput);
    if (!newUserPwCheck.ok) {
      setUserMessage({ type: 'error', text: newUserPwCheck.error ?? t.auth.passwordTooShort });
      return;
    }
    setCreatingUser(true);
    try {
      const body: Record<string, string> = {
        email: newEmail,
        password: newPasswordInput,
        name: newName,
        role: newRole,
      };
      if (newRole === 'employee' && newDeptId) body.departmentId = newDeptId;
      if (isGeAdmin && newRole !== 'ge_admin' && newTenantId) body.clientId = newTenantId;
      const res = await apiFetch('/api/users', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        setUserMessage({ type: 'success', text: t.users.createdSuccess });
        setNewEmail('');
        setNewPasswordInput('');
        setNewName('');
        setNewDeptId('');
        await fetchUsers();
      } else {
        setUserMessage({ type: 'error', text: data.error || 'Failed to create user' });
      }
    } catch (err: any) {
      setUserMessage({ type: 'error', text: err.message || 'Error occurred' });
    } finally {
      setCreatingUser(false);
    }
  };

  const handleToggleActive = async (target: ManagedUser) => {
    if (target.is_active && !window.confirm(t.users.deactivateConfirm)) return;
    setUserMessage(null);
    try {
      const res = await apiFetch(`/api/users/${target.id}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ isActive: !target.is_active }),
      });
      const data = await res.json();
      if (res.ok) {
        await fetchUsers();
      } else {
        setUserMessage({ type: 'error', text: data.error || 'Failed to update user' });
      }
    } catch (err: any) {
      setUserMessage({ type: 'error', text: err.message || 'Error occurred' });
    }
  };

  // B9-D3: evidence storage monitor (per-tenant usage readout).
  const [storageUsage, setStorageUsage] = useState<{
    tenantId: string;
    bytes: number;
    files: number;
    formatted: string;
    warnThresholdBytes: number;
    warn: boolean;
    capNote: string;
  } | null>(null);
  const [loadingStorage, setLoadingStorage] = useState(false);

  const fetchStorageUsage = async () => {
    setLoadingStorage(true);
    try {
      const res = await apiFetch('/api/storage/usage', { headers: { Authorization: token ? `Bearer ${token}` : '' } });
      if (res.ok) {
        setStorageUsage(await res.json());
      } else {
        setStorageUsage(null);
      }
    } catch (err) {
      console.error('Error querying storage usage:', err);
    } finally {
      setLoadingStorage(false);
    }
  };

  useEffect(() => {
    fetchStorageUsage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const checkDb = async () => {
    setLoadingDb(true);
    try {
      const res = await fetch('/api/db/status');
      if (res.ok) {
        const data = await res.json();
        setDbStatus(data);
      }
    } catch (err) {
      console.error('Error querying DB status:', err);
    } finally {
      setLoadingDb(false);
    }
  };

  useEffect(() => {
    checkDb();
  }, []);

  const handleRunMigrations = async () => {
    setMigrating(true);
    setMigrateSuccess(null);
    setMigrateError(null);

    try {
      const res = await fetch('/api/db/migrate', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.success) {
        setMigrateSuccess(t.settings.migrationsSuccess);
        await checkDb();
        if (onDbStatusChanged) onDbStatusChanged();
      } else {
        setMigrateError(data.error || 'Failed to apply migrations.');
      }
    } catch (err: any) {
      setMigrateError(err.message || 'Network error running migrations.');
    } finally {
      setMigrating(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPassMessage(null);

    // B12 (S-02): client mirrors the shared complexity rule (server re-validates).
    const pwCheck = validateSelfChosenPassword(newPassword);
    if (!pwCheck.ok) {
      setPassMessage({ type: 'error', text: pwCheck.error ?? t.auth.passwordTooShort });
      return;
    }

    if (newPassword !== confirmPassword) {
      setPassMessage({ type: 'error', text: t.auth.passwordMismatch });
      return;
    }

    setChangingPass(true);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setPassMessage({ type: 'success', text: t.auth.passwordChangedSuccess });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setPassMessage({ type: 'error', text: data.error || 'Failed to update password' });
      }
    } catch (err: any) {
      setPassMessage({ type: 'error', text: err.message || 'Error occurred' });
    } finally {
      setChangingPass(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* PostgreSQL Database Status Card */}
      <div className="bg-surface-2 rounded-2xl border border-border p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-5 pb-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-brand-soft text-brand-text">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-text">
                {t.settings.databaseConnection}
              </h3>
              <p className="text-xs text-muted">
                {t.settings.databaseUrlNote}
              </p>
            </div>
          </div>

          <button
            onClick={checkDb}
            disabled={loadingDb}
            className="p-2 rounded-xl border border-border text-muted hover:bg-surface-3 transition-colors"
            title={t.common.refresh}
          >
            <RefreshCw className={`w-4 h-4 ${loadingDb ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {dbStatus && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="p-4 rounded-xl bg-surface-3 border border-border">
              <span className="text-[10px] uppercase font-bold text-muted block mb-1">
                {t.settings.dbStatus}
              </span>
              <div className="flex items-center gap-2">
                {dbStatus.connected ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-success-text" />
                    <span className="text-xs font-bold text-success-text">
                      {t.settings.connected}
                    </span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-4 h-4 text-warning-text" />
                    <span className="text-xs font-bold text-warning-text">
                      {t.settings.disconnected}
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-surface-3 border border-border">
              <span className="text-[10px] uppercase font-bold text-muted block mb-1">
                Configuration
              </span>
              <span className="text-xs font-semibold text-text">
                {dbStatus.configured ? t.settings.configured : t.settings.notConfigured}
              </span>
            </div>

            <div className="p-4 rounded-xl bg-surface-3 border border-border">
              <span className="text-[10px] uppercase font-bold text-muted block mb-1">
                {t.settings.tableCount}
              </span>
              <span className="text-xs font-extrabold text-text">
                {dbStatus.tableCount} tables created
              </span>
            </div>
          </div>
        )}

        {migrateSuccess && (
          <div className="mb-4 p-3 rounded-xl bg-success-soft border border-success text-success-text text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{migrateSuccess}</span>
          </div>
        )}

        {migrateError && (
          <div className="mb-4 p-3 rounded-xl bg-danger-soft border border-danger text-danger text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{migrateError}</span>
          </div>
        )}

        <button
          onClick={handleRunMigrations}
          disabled={migrating}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand hover:bg-brand-strong text-brand-ink text-xs font-bold shadow-xs disabled:opacity-50 transition-colors"
        >
          {migrating ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <ShieldCheck className="w-4 h-4" />
          )}
          <span>{migrating ? t.settings.migrating : t.settings.runMigrations}</span>
        </button>
      </div>

      {/* B9-D3: evidence storage monitor */}
      {/* B11a (S-04): GE-only services management (Settings-adjacent, one place). */}
      {isGeAdmin && <ServicesManage />}

      <div className="bg-surface-2 rounded-2xl border border-border p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4 pb-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-warning-soft text-warning-text">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-text">
                {t.storage.title}
              </h3>
              <p className="text-xs text-muted">
                {t.storage.subtitle}
              </p>
            </div>
          </div>
          <button
            onClick={fetchStorageUsage}
            disabled={loadingStorage}
            className="p-2 rounded-xl border border-border text-muted hover:bg-surface-3 transition-colors"
            title={t.common.refresh}
          >
            <RefreshCw className={`w-4 h-4 ${loadingStorage ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {!storageUsage && (
          <p className="text-xs text-muted">
            {loadingStorage ? t.common.loading : t.attachments.emptyText}
          </p>
        )}
        {storageUsage && (
          <div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-surface-3 border border-border">
                <span className="text-[10px] uppercase font-bold text-muted block mb-1">
                  {t.storage.bytesLabel}
                </span>
                <span className="text-sm font-extrabold text-text">
                  {storageUsage.formatted}
                </span>
              </div>
              <div className="p-4 rounded-xl bg-surface-3 border border-border">
                <span className="text-[10px] uppercase font-bold text-muted block mb-1">
                  {t.storage.filesLabel}
                </span>
                <span className="text-sm font-extrabold text-text">
                  {storageUsage.files}
                </span>
              </div>
            </div>
            <div
              className={`mt-3 p-3 rounded-xl text-xs flex items-center gap-2 ${
                storageUsage.warn
                  ? 'bg-warning-soft border border-warning text-warning-text'
                  : 'bg-success-soft border border-success text-success-text'
              }`}
            >
              {storageUsage.warn ? (
                <AlertTriangle className="w-4 h-4 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              )}
              <span>{storageUsage.warn ? t.storage.warnMsg : t.storage.okMsg}</span>
            </div>
          </div>
        )}
      </div>

      {/* Language & RTL Settings Card */}
      <div className="bg-surface-2 rounded-2xl border border-border p-6 shadow-xs">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 rounded-xl bg-info-soft text-info">
            <Globe className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-base text-text">
              {t.settings.languageSettings}
            </h3>
            <p className="text-xs text-muted">
              {t.settings.languageDescription}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
          <button
            onClick={() => setLang('en')}
            className={`p-4 rounded-xl border text-start flex items-center justify-between transition-colors ${
              lang === 'en'
                ? 'border-brand bg-brand-soft text-text ring-2 ring-focus-ring/20'
                : 'border-border text-muted hover:bg-surface-3'
            }`}
          >
            <div>
              <div className="font-bold text-xs">{t.settings.english}</div>
              <div className="text-[11px] text-muted mt-0.5">Left-to-Right (LTR)</div>
            </div>
            {lang === 'en' && <CheckCircle2 className="w-4 h-4 text-success-text" />}
          </button>

          <button
            onClick={() => setLang('ar')}
            className={`p-4 rounded-xl border text-start flex items-center justify-between transition-colors ${
              lang === 'ar'
                ? 'border-brand bg-brand-soft text-text ring-2 ring-focus-ring/20'
                : 'border-border text-muted hover:bg-surface-3'
            }`}
          >
            <div>
              <div className="font-bold text-xs">{t.settings.arabic}</div>
              <div className="text-[11px] text-muted mt-0.5">من اليمين إلى اليسار (RTL)</div>
            </div>
            {lang === 'ar' && <CheckCircle2 className="w-4 h-4 text-success-text" />}
          </button>
        </div>
      </div>

      {/* TASK-PROTO-H13: platform-only «ثيم التطبيق» — one theme for the whole
          application; auto (NULL) hands control back to each tenant theme. */}
      {isGeAdmin && (
        <div className="bg-surface-2 rounded-2xl border border-border p-6 shadow-xs">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2.5 rounded-xl bg-brand-soft text-brand-text">
              <Palette className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-text">
                {t.settings.appThemeSection}
              </h3>
              <p className="text-xs text-muted">
                {t.settings.appThemeDescription}
              </p>
            </div>
          </div>

          {appThemeMessage && (
            <div
              className={`mb-4 p-3 rounded-xl text-xs flex items-center gap-2 ${
                appThemeMessage.type === 'success'
                  ? 'bg-success-soft text-success-text border border-success'
                  : 'bg-danger-soft text-danger border border-danger'
              }`}
            >
              {appThemeMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0" />
              )}
              <span>{appThemeMessage.text}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
            {APP_THEME_CHOICES.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setAppTheme(option)}
                className={`p-4 rounded-xl border text-start flex items-center justify-between transition-colors ${
                  appTheme === option
                    ? 'border-brand bg-brand-soft text-text ring-2 ring-focus-ring/20'
                    : 'border-border text-muted hover:bg-surface-3'
                }`}
              >
                <div>
                  <div className="font-bold text-xs">{appThemeLabel(option)}</div>
                  {option === 'auto' && (
                    <div className="text-[11px] text-muted mt-0.5">{t.settings.appThemeAutoHint}</div>
                  )}
                </div>
                {appTheme === option && <CheckCircle2 className="w-4 h-4 text-success-text" />}
              </button>
            ))}
          </div>

          <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <button
              type="button"
              onClick={handleSaveAppTheme}
              disabled={savingAppTheme || loadingAppTheme}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand hover:bg-brand-strong text-brand-ink text-xs font-bold shadow-xs disabled:opacity-50 transition-colors"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>{savingAppTheme ? t.settings.appThemeSaving : t.settings.appThemeSave}</span>
            </button>
            <p className="text-[11px] text-muted">{t.settings.appThemePlatformOnly}</p>
          </div>
        </div>
      )}

      {/* Account Security & Change Password Card */}
      {user && (
        <div className="bg-surface-2 rounded-2xl border border-border p-6 shadow-xs">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2.5 rounded-xl bg-accent-soft text-accent-text">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-text">
                {t.settings.securitySettings}
              </h3>
              <p className="text-xs text-muted">
                {t.auth.changePasswordTitle}
              </p>
            </div>
          </div>

          <form onSubmit={handleChangePassword} className="space-y-4 max-w-md mt-4">
            {passMessage && (
              <div
                className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                  passMessage.type === 'success'
                    ? 'bg-success-soft text-success-text border border-success'
                    : 'bg-danger-soft text-danger border border-danger'
                }`}
              >
                {passMessage.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                )}
                <span>{passMessage.text}</span>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-muted mb-1">
                {t.auth.currentPassword}
              </label>
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-xl text-xs bg-surface-3 border border-border-strong text-text placeholder-muted focus:outline-none focus:ring-2 focus:ring-focus-ring/20"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1">
                {t.auth.newPassword}
              </label>
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-xl text-xs bg-surface-3 border border-border-strong text-text placeholder-muted focus:outline-none focus:ring-2 focus:ring-focus-ring/20"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1">
                {t.auth.confirmPassword}
              </label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-xl text-xs bg-surface-3 border border-border-strong text-text placeholder-muted focus:outline-none focus:ring-2 focus:ring-focus-ring/20"
              />
            </div>

            <button
              type="submit"
              disabled={changingPass}
              className="px-5 py-2.5 rounded-xl bg-brand hover:bg-brand-strong text-brand-ink text-xs font-bold transition-colors shadow-xs disabled:opacity-50"
            >
              {changingPass ? t.common.loading : t.settings.updatePasswordButton}
            </button>
          </form>
        </div>
      )}

      {/* C2: Minimal user management (admins only) */}
      {isAdmin && (
        <div className="bg-surface-2 rounded-2xl border border-border p-6 shadow-xs">
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2.5 rounded-xl bg-brand-soft text-brand-text">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-text">
                {t.users.title}
              </h3>
              <p className="text-xs text-muted">
                {t.users.subtitle}
              </p>
            </div>
          </div>

          {userMessage && (
            <div
              className={`mt-4 p-3 rounded-xl text-xs flex items-center gap-2 ${
                userMessage.type === 'success'
                  ? 'bg-success-soft text-success-text border border-success'
                  : 'bg-danger-soft text-danger border border-danger'
              }`}
            >
              {userMessage.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0" />
              )}
              <span>{userMessage.text}</span>
            </div>
          )}

          {/* User list */}
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-text">
                {t.users.listTitle} ({managedUsers.length})
              </span>
              <button
                onClick={fetchUsers}
                disabled={loadingUsers}
                className="p-1.5 rounded-lg border border-border text-muted hover:bg-surface-3 transition-colors"
                title={t.common.refresh}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingUsers ? 'animate-spin' : ''}`} />
              </button>
            </div>
            {managedUsers.length === 0 ? (
              <p className="text-xs text-muted p-3 rounded-xl bg-surface-3 border border-border">
                {t.users.emptyList}
              </p>
            ) : (
              <ul className="space-y-2 max-h-64 overflow-y-auto pe-1">
                {managedUsers.map((u) => (
                  <li
                    key={u.id}
                    className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-text truncate">
                        {u.name} <span className="font-normal text-muted">· {u.email}</span>
                      </div>
                      <div className="text-[11px] text-muted mt-0.5 truncate">
                        {t.auth.roles[u.role as keyof typeof t.auth.roles] || u.role}
                        {u.client_name ? ` · ${u.client_name}` : ''}
                        {u.department_name ? ` · ${u.department_name}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                          u.is_active
                            ? 'bg-success-soft text-success-text'
                            : 'bg-surface-3 text-muted'
                        }`}
                      >
                        {u.is_active ? t.users.activeLabel : t.users.inactiveLabel}
                      </span>
                      {isGeAdmin && u.id !== user?.id && (
                        <button
                          onClick={() => handleToggleActive(u)}
                          title={u.is_active ? t.users.deactivateButton : t.users.reactivateButton}
                          className={`p-1.5 rounded-lg border transition-colors ${
                            u.is_active
                              ? 'border-danger text-danger hover:bg-danger-soft'
                              : 'border-success text-success-text hover:bg-success-soft'
                          }`}
                        >
                          {u.is_active ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Create form — GE ONLY (04 matrix + WF-01: العميل لا ينشئ حسابات).
              Non-GE admins see a pointer to the staff-list flow instead. */}
          {isGeAdmin ? (
          <form onSubmit={handleCreateUser} className="mt-5 pt-5 border-t border-border space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-text">
              <UserPlus className="w-4 h-4 text-brand-text" />
              <span>{t.users.createButton}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-muted mb-1">
                  {t.users.nameLabel}
                </label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-xs bg-surface-3 border border-border-strong text-text placeholder-muted focus:outline-none focus:ring-2 focus:ring-focus-ring/20"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted mb-1">
                  {t.users.emailLabel}
                </label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-xs bg-surface-3 border border-border-strong text-text placeholder-muted focus:outline-none focus:ring-2 focus:ring-focus-ring/20"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted mb-1">
                  {t.users.passwordLabel}
                </label>
                <input
                  type="password"
                  required
                  minLength={10}
                  value={newPasswordInput}
                  onChange={(e) => setNewPasswordInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-xs bg-surface-3 border border-border-strong text-text placeholder-muted focus:outline-none focus:ring-2 focus:ring-focus-ring/20"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted mb-1">
                  {t.users.roleLabel}
                </label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-xs bg-surface-3 border border-border-strong text-text placeholder-muted focus:outline-none focus:ring-2 focus:ring-focus-ring/20"
                >
                  <option value="employee">{t.auth.roles.employee}</option>
                  <option value="client_admin">{t.auth.roles.client_admin}</option>
                  {isGeAdmin && <option value="ge_admin">{t.auth.roles.ge_admin}</option>}
                </select>
              </div>
              {isGeAdmin && newRole !== 'ge_admin' && (
                <div>
                  <label className="block text-xs font-semibold text-muted mb-1">
                    {t.users.tenantLabel}
                  </label>
                  <select
                    value={newTenantId}
                    onChange={(e) => setNewTenantId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl text-xs bg-surface-3 border border-border-strong text-text placeholder-muted focus:outline-none focus:ring-2 focus:ring-focus-ring/20"
                  >
                    <option value="">{t.users.tenantPlaceholder}</option>
                    {tenants.map((tn) => (
                      <option key={tn.id} value={tn.id}>
                        {tn.name} ({tn.code})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {newRole === 'employee' && (
                <div>
                  <label className="block text-xs font-semibold text-muted mb-1">
                    {t.users.departmentLabel}
                  </label>
                  <select
                    value={newDeptId}
                    onChange={(e) => setNewDeptId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl text-xs bg-surface-3 border border-border-strong text-text placeholder-muted focus:outline-none focus:ring-2 focus:ring-focus-ring/20"
                  >
                    <option value="">—</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <button
              type="submit"
              disabled={creatingUser}
              className="px-5 py-2.5 rounded-xl bg-brand hover:bg-brand-strong text-brand-ink text-xs font-bold transition-colors shadow-xs disabled:opacity-50"
            >
              {creatingUser ? t.users.creating : t.users.createButton}
            </button>
          </form>
          ) : (
            <div className="mt-5 pt-5 border-t border-border">
              <p className="p-3 rounded-xl bg-surface-3 border border-border text-xs text-muted">
                {t.users.geOnlyNote}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
