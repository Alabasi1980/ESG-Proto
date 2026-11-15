import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Mail,
  Lock,
  AlertTriangle,
  ArrowRight,
  UserPlus,
  Globe,
  Database,
} from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { DemoBanner } from '../components/DemoBanner.tsx';

interface LoginViewProps {
  onSwitchToSetup: () => void;
}

export const LoginView: React.FC<LoginViewProps> = ({ onSwitchToSetup }) => {
  const { t, lang, setLang } = useLanguage();
  const { login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canSetup, setCanSetup] = useState(false);
  const [dbConfigured, setDbConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/setup/status')
      .then((res) => res.json())
      .then((data) => {
        if (data.canSetup) {
          setCanSetup(true);
        }
      })
      .catch(() => {});

    fetch('/api/db/status')
      .then((res) => res.json())
      .then((data) => {
        setDbConfigured(Boolean(data.configured));
      })
      .catch(() => {
        setDbConfigured(false);
      });
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      // B11b (S-09): suspended tenants get 200 {suspended:true} with no data.
      if (res.ok && (data as any).suspended === true) {
        throw new Error((data as any).message || 'This tenant is suspended. Contact the platform administrator.');
      }
      if (!res.ok) {
        throw new Error(data.error || t.auth.invalidCredentials);
      }

      login(data.token, data.user);
    } catch (err: any) {
      setError(err.message || t.auth.invalidCredentials);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface flex flex-col justify-center py-12 sm:px-6 lg:px-8 text-text relative">
      <DemoBanner />
      {/* Language Switch top corner */}
      <div className="absolute top-6 end-6">
        <button
          onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-surface-3 border border-border text-xs font-semibold text-muted hover:text-text hover:border-border-strong transition-colors"
        >
          <Globe className="w-4 h-4 text-brand" />
          <span>{lang === 'en' ? 'العربية' : 'English'}</span>
        </button>
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-brand text-brand-ink shadow-[var(--shadow)] mb-4">
          <span className="font-extrabold text-2xl tracking-wider">GE</span>
        </div>
        <h2 className="text-2xl font-extrabold tracking-tight text-text">
          {t.auth.signInTitle}
        </h2>
        <p className="mt-2 text-xs text-muted max-w-sm mx-auto">
          {t.auth.signInSubtitle}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4 sm:px-0">
        <div className="bg-surface-3 py-8 px-6 sm:px-10 shadow-[var(--shadow)] rounded-2xl">
          {/* Notice when live DB is not yet set in environment */}
          {dbConfigured === false && (
            <div className="mb-6 p-4 rounded-xl bg-surface-2 border border-border text-xs">
              <div className="flex items-center gap-2 font-bold text-warning mb-1">
                <Database className="w-4 h-4 shrink-0" />
                <span>{t.auth.dbUnconfiguredNotice}</span>
              </div>
              <p className="text-[11px] text-muted leading-relaxed">
                {t.auth.dbUnconfiguredHelp}
              </p>
            </div>
          )}

          {/* First-time setup prompt if DB has 0 users */}
          {canSetup && (
            <div className="mb-6 p-4 rounded-xl bg-brand-soft text-xs">
              <div className="font-bold mb-1 flex items-center gap-1.5 text-text">
                <UserPlus className="w-4 h-4" />
                <span>{t.setup.title}</span>
              </div>
              <p className="text-[11px] text-muted leading-relaxed mb-3">
                No administrator account has been created yet. You can initialize the database and create your primary admin account now.
              </p>
              <button
                type="button"
                onClick={onSwitchToSetup}
                className="w-full inline-flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-brand text-brand-ink font-bold text-xs hover:bg-brand-strong transition-colors shadow-xs"
              >
                <span>{t.setup.submitButton}</span>
                <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" />
              </button>
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 rounded-xl bg-danger-soft border border-danger text-danger text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-danger" />
              <span>{error}</span>
            </div>
          )}

          <form className="space-y-4" onSubmit={handleLogin}>
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">
                {t.auth.emailLabel}
              </label>
              <div className="relative">
                <Mail className="absolute start-3 top-2.5 w-4 h-4 text-muted" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t.auth.emailPlaceholder}
                  dir="ltr"
                  className="w-full ps-9 pe-4 py-2.5 rounded-xl text-xs bg-surface-2 border border-border-strong text-text placeholder-muted focus:outline-none focus:ring-2 focus:ring-focus-ring/30 focus:border-focus-ring"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1">
                {t.auth.passwordLabel}
              </label>
              <div className="relative">
                <Lock className="absolute start-3 top-2.5 w-4 h-4 text-muted" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t.auth.passwordPlaceholder}
                  className="w-full ps-9 pe-4 py-2.5 rounded-xl text-xs bg-surface-2 border border-border-strong text-text placeholder-muted focus:outline-none focus:ring-2 focus:ring-focus-ring/30 focus:border-focus-ring"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-4 flex justify-center items-center gap-2 py-3 px-4 border border-transparent rounded-xl shadow-md text-xs font-bold text-brand-ink bg-brand hover:bg-brand-strong focus:outline-none transition-colors disabled:opacity-50"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>{loading ? t.auth.signingIn : t.auth.signInButton}</span>
            </button>
          </form>

          {canSetup && (
            <div className="mt-6 pt-4 border-t border-border text-center">
              <button
                type="button"
                onClick={onSwitchToSetup}
                className="text-xs text-brand-strong font-semibold hover:underline"
              >
                {t.setup.title} →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
