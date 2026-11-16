import React, { useState } from 'react';
import { ShieldCheck, User, Mail, Lock, Building, AlertTriangle, ArrowLeft, RefreshCw, Globe } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import { useAuth, AuthUser } from '../context/AuthContext.tsx';
import { validateSelfChosenPassword } from '../lib/password.ts';

interface SetupViewProps {
  onBackToLogin: () => void;
}

export const SetupView: React.FC<SetupViewProps> = ({ onBackToLogin }) => {
  const { t, lang, setLang } = useLanguage();
  const { login } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isClientTenant, setIsClientTenant] = useState(false);
  const [clientName, setClientName] = useState('');
  const [clientCode, setClientCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // B12 (S-02): client mirrors the shared complexity rule (server re-validates).
    const pwCheck = validateSelfChosenPassword(password);
    if (!pwCheck.ok) {
      setError(pwCheck.error ?? t.auth.passwordTooShort);
      setLoading(false);
      return;
    }

    try {
      const payload: Record<string, any> = {
        name,
        email,
        password,
        role: isClientTenant ? 'client_admin' : 'ge_admin',
      };

      if (isClientTenant) {
        payload.clientName = clientName;
        payload.clientCode = clientCode;
      }

      const res = await fetch('/api/setup/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Setup failed');
      }

      login(data.token, data.user);
    } catch (err: any) {
      setError(err.message || 'Failed to complete initial platform setup');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface flex flex-col justify-center py-12 sm:px-6 lg:px-8 text-text relative">
      <div className="absolute top-6 end-6">
        <button
          onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-surface-2 border border-border text-xs font-semibold text-muted hover:text-text transition-colors"
        >
          <Globe className="w-4 h-4 text-brand-text" />
          <span>{lang === 'en' ? 'العربية' : 'English'}</span>
        </button>
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-brand text-brand-ink shadow-[var(--shadow)] mb-4">
          <ShieldCheck className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-extrabold tracking-tight text-text">
          {t.setup.title}
        </h2>
        <p className="mt-2 text-xs text-muted max-w-sm mx-auto">
          {t.setup.subtitle}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4 sm:px-0">
        <div className="bg-surface-2 py-8 px-6 sm:px-10 shadow-[var(--shadow)] rounded-2xl border border-border">
          <button
            type="button"
            onClick={onBackToLogin}
            className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-text mb-5 font-semibold"
          >
            <ArrowLeft className="w-3.5 h-3.5 rtl:rotate-180" />
            <span>{t.common.back}</span>
          </button>

          {error && (
            <div className="mb-4 p-3 rounded-xl bg-danger-soft border border-danger text-danger text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-danger" />
              <span>{error}</span>
            </div>
          )}

          <form className="space-y-4" onSubmit={handleSetup}>
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">
                {t.setup.adminName}
              </label>
              <div className="relative">
                <User className="absolute start-3 top-2.5 w-4 h-4 text-muted" />
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Sara Al-Mansoor"
                  className="w-full ps-9 pe-4 py-2.5 rounded-xl text-xs bg-surface-3 border border-border-strong text-text placeholder-muted focus:outline-none focus:ring-2 focus:ring-focus-ring/30"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1">
                {t.setup.adminEmail}
              </label>
              <div className="relative">
                <Mail className="absolute start-3 top-2.5 w-4 h-4 text-muted" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@company.com"
                  dir="ltr"
                  className="w-full ps-9 pe-4 py-2.5 rounded-xl text-xs bg-surface-3 border border-border-strong text-text placeholder-muted focus:outline-none focus:ring-2 focus:ring-focus-ring/30"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1">
                {t.setup.adminPassword}
              </label>
              <div className="relative">
                <Lock className="absolute start-3 top-2.5 w-4 h-4 text-muted" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full ps-9 pe-4 py-2.5 rounded-xl text-xs bg-surface-3 border border-border-strong text-text placeholder-muted focus:outline-none focus:ring-2 focus:ring-focus-ring/30"
                />
              </div>
              <p className="text-[10px] text-muted mt-1">
                {t.setup.adminPasswordHint}
              </p>
            </div>

            {/* Optional Tenant Organization setup */}
            <div className="pt-2">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-muted font-semibold">
                <input
                  type="checkbox"
                  checked={isClientTenant}
                  onChange={(e) => setIsClientTenant(e.target.checked)}
                  className="rounded border-border-strong text-brand-text focus:ring-focus-ring bg-surface-3"
                />
                <span>{t.setup.clientSectionTitle}</span>
              </label>

              {isClientTenant && (
                <div className="mt-3 p-4 rounded-xl bg-surface-3 border border-border space-y-3">
                  <div>
                    <label className="block text-xs text-muted mb-1">
                      {t.setup.clientName}
                    </label>
                    <input
                      type="text"
                      required={isClientTenant}
                      value={clientName}
                      onChange={(e) => setClientName(e.target.value)}
                      placeholder="e.g. Al-Noor Energy Corp"
                      className="w-full px-3 py-2 rounded-lg text-xs bg-surface-3 border border-border-strong text-text placeholder-muted focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs text-muted mb-1">
                      {t.setup.clientCode}
                    </label>
                    <input
                      type="text"
                      required={isClientTenant}
                      value={clientCode}
                      onChange={(e) => setClientCode(e.target.value)}
                      placeholder="e.g. ALNOOR-01"
                      className="w-full px-3 py-2 rounded-lg text-xs bg-surface-3 border border-border-strong text-text placeholder-muted focus:outline-none"
                    />
                  </div>
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-5 flex justify-center items-center gap-2 py-3 px-4 rounded-xl shadow-md text-xs font-bold text-brand-ink bg-brand hover:bg-brand-strong transition-colors disabled:opacity-50"
            >
              {loading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <ShieldCheck className="w-4 h-4" />
              )}
              <span>{loading ? t.setup.submitting : t.setup.submitButton}</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
