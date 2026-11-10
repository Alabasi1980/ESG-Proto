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
} from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';

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

    if (newPassword.length < 6) {
      setPassMessage({ type: 'error', text: t.auth.passwordTooShort });
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
    </div>
  );
};
