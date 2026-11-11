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
} from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { ServicesManage } from './ServicesManage.tsx';
import { validateSelfChosenPassword } from '../lib/password.ts';

interface SettingsViewProps {
  onDbStatusChanged?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ onDbStatusChanged }) => {
  const { t, lang, setLang } = useLanguage();
  const { user, token } = useAuth();

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

  const fetchUsers = async () => {
    if (!isAdmin) return;
    setLoadingUsers(true);
    try {
      const res = await fetch('/api/users', { headers: { Authorization: token ? `Bearer ${token}` : '' } });
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
        fetch('/api/departments', { headers }),
        isGeAdmin ? fetch('/api/clients', { headers }) : Promise.resolve(null),
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
      const res = await fetch('/api/users', {
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
      const res = await fetch(`/api/users/${target.id}`, {
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
      const res = await fetch('/api/storage/usage', { headers: { Authorization: token ? `Bearer ${token}` : '' } });
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
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-5 pb-4 border-b border-slate-100 dark:border-slate-700/60">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-white">
                {t.settings.databaseConnection}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t.settings.databaseUrlNote}
              </p>
            </div>
          </div>

          <button
            onClick={checkDb}
            disabled={loadingDb}
            className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-750 transition-colors"
            title={t.common.refresh}
          >
            <RefreshCw className={`w-4 h-4 ${loadingDb ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {dbStatus && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-750/50 border border-slate-100 dark:border-slate-700/40">
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                {t.settings.dbStatus}
              </span>
              <div className="flex items-center gap-2">
                {dbStatus.connected ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                      {t.settings.connected}
                    </span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                    <span className="text-xs font-bold text-amber-600 dark:text-amber-400">
                      {t.settings.disconnected}
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-750/50 border border-slate-100 dark:border-slate-700/40">
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                Configuration
              </span>
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                {dbStatus.configured ? t.settings.configured : t.settings.notConfigured}
              </span>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-750/50 border border-slate-100 dark:border-slate-700/40">
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                {t.settings.tableCount}
              </span>
              <span className="text-xs font-extrabold text-slate-900 dark:text-white">
                {dbStatus.tableCount} tables created
              </span>
            </div>
          </div>
        )}

        {migrateSuccess && (
          <div className="mb-4 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{migrateSuccess}</span>
          </div>
        )}

        {migrateError && (
          <div className="mb-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{migrateError}</span>
          </div>
        )}

        <button
          onClick={handleRunMigrations}
          disabled={migrating}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs disabled:opacity-50 transition-colors"
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

      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4 pb-4 border-b border-slate-100 dark:border-slate-700/60">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-white">
                {t.storage.title}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t.storage.subtitle}
              </p>
            </div>
          </div>
          <button
            onClick={fetchStorageUsage}
            disabled={loadingStorage}
            className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-750 transition-colors"
            title={t.common.refresh}
          >
            <RefreshCw className={`w-4 h-4 ${loadingStorage ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {!storageUsage && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {loadingStorage ? t.common.loading : t.attachments.emptyText}
          </p>
        )}
        {storageUsage && (
          <div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-750/50 border border-slate-100 dark:border-slate-700/40">
                <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                  {t.storage.bytesLabel}
                </span>
                <span className="text-sm font-extrabold text-slate-900 dark:text-white">
                  {storageUsage.formatted}
                </span>
              </div>
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-750/50 border border-slate-100 dark:border-slate-700/40">
                <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                  {t.storage.filesLabel}
                </span>
                <span className="text-sm font-extrabold text-slate-900 dark:text-white">
                  {storageUsage.files}
                </span>
              </div>
            </div>
            <div
              className={`mt-3 p-3 rounded-xl text-xs flex items-center gap-2 ${
                storageUsage.warn
                  ? 'bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200'
                  : 'bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
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
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 p-6 shadow-xs">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 rounded-xl bg-sky-50 dark:bg-sky-950/50 text-sky-600 dark:text-sky-400">
            <Globe className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-base text-slate-900 dark:text-white">
              {t.settings.languageSettings}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {t.settings.languageDescription}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
          <button
            onClick={() => setLang('en')}
            className={`p-4 rounded-xl border text-start flex items-center justify-between transition-colors ${
              lang === 'en'
                ? 'border-emerald-600 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-900 dark:text-emerald-200 ring-2 ring-emerald-500/20'
                : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-750'
            }`}
          >
            <div>
              <div className="font-bold text-xs">{t.settings.english}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">Left-to-Right (LTR)</div>
            </div>
            {lang === 'en' && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
          </button>

          <button
            onClick={() => setLang('ar')}
            className={`p-4 rounded-xl border text-start flex items-center justify-between transition-colors ${
              lang === 'ar'
                ? 'border-emerald-600 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-900 dark:text-emerald-200 ring-2 ring-emerald-500/20'
                : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-750'
            }`}
          >
            <div>
              <div className="font-bold text-xs">{t.settings.arabic}</div>
              <div className="text-[11px] text-slate-500 mt-0.5">من اليمين إلى اليسار (RTL)</div>
            </div>
            {lang === 'ar' && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
          </button>
        </div>
      </div>

      {/* Account Security & Change Password Card */}
      {user && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 p-6 shadow-xs">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-white">
                {t.settings.securitySettings}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t.auth.changePasswordTitle}
              </p>
            </div>
          </div>

          <form onSubmit={handleChangePassword} className="space-y-4 max-w-md mt-4">
            {passMessage && (
              <div
                className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                  passMessage.type === 'success'
                    ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200 border border-emerald-200'
                    : 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200 border border-rose-200'
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
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {t.auth.currentPassword}
              </label>
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-750 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {t.auth.newPassword}
              </label>
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-750 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                {t.auth.confirmPassword}
              </label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-750 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>

            <button
              type="submit"
              disabled={changingPass}
              className="px-5 py-2.5 rounded-xl bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-white text-white dark:text-slate-900 text-xs font-bold transition-colors shadow-xs disabled:opacity-50"
            >
              {changingPass ? t.common.loading : t.settings.updatePasswordButton}
            </button>
          </form>
        </div>
      )}

      {/* C2: Minimal user management (admins only) */}
      {isAdmin && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 p-6 shadow-xs">
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-white">
                {t.users.title}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t.users.subtitle}
              </p>
            </div>
          </div>

          {userMessage && (
            <div
              className={`mt-4 p-3 rounded-xl text-xs flex items-center gap-2 ${
                userMessage.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200 border border-emerald-200'
                  : 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200 border border-rose-200'
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
              <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                {t.users.listTitle} ({managedUsers.length})
              </span>
              <button
                onClick={fetchUsers}
                disabled={loadingUsers}
                className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-750 transition-colors"
                title={t.common.refresh}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingUsers ? 'animate-spin' : ''}`} />
              </button>
            </div>
            {managedUsers.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400 p-3 rounded-xl bg-slate-50 dark:bg-slate-750/50 border border-slate-100 dark:border-slate-700/40">
                {t.users.emptyList}
              </p>
            ) : (
              <ul className="space-y-2 max-h-64 overflow-y-auto pe-1">
                {managedUsers.map((u) => (
                  <li
                    key={u.id}
                    className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-700"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                        {u.name} <span className="font-normal text-slate-500">· {u.email}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                        {t.auth.roles[u.role as keyof typeof t.auth.roles] || u.role}
                        {u.client_name ? ` · ${u.client_name}` : ''}
                        {u.department_name ? ` · ${u.department_name}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                          u.is_active
                            ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                            : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
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
                              ? 'border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40'
                              : 'border-emerald-200 dark:border-emerald-900 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40'
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
          <form onSubmit={handleCreateUser} className="mt-5 pt-5 border-t border-slate-100 dark:border-slate-700/60 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200">
              <UserPlus className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>{t.users.createButton}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {t.users.nameLabel}
                </label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-750 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {t.users.emailLabel}
                </label>
                <input
                  type="email"
                  required
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-750 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {t.users.passwordLabel}
                </label>
                <input
                  type="password"
                  required
                  minLength={10}
                  value={newPasswordInput}
                  onChange={(e) => setNewPasswordInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-750 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  {t.users.roleLabel}
                </label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-750 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                >
                  <option value="employee">{t.auth.roles.employee}</option>
                  <option value="client_admin">{t.auth.roles.client_admin}</option>
                  {isGeAdmin && <option value="ge_admin">{t.auth.roles.ge_admin}</option>}
                </select>
              </div>
              {isGeAdmin && newRole !== 'ge_admin' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {t.users.tenantLabel}
                  </label>
                  <select
                    value={newTenantId}
                    onChange={(e) => setNewTenantId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-750 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
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
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {t.users.departmentLabel}
                  </label>
                  <select
                    value={newDeptId}
                    onChange={(e) => setNewDeptId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-750 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
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
              className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors shadow-xs disabled:opacity-50"
            >
              {creatingUser ? t.users.creating : t.users.createButton}
            </button>
          </form>
          ) : (
            <div className="mt-5 pt-5 border-t border-slate-100 dark:border-slate-700/60">
              <p className="p-3 rounded-xl bg-slate-50 dark:bg-slate-750/50 border border-slate-200 dark:border-slate-700/40 text-xs text-slate-600 dark:text-slate-300">
                {t.users.geOnlyNote}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
