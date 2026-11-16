import React, { useCallback, useEffect, useState } from 'react';
import { Building2, PauseCircle, RefreshCw, Sprout, Users } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { apiFetch } from '../lib/api.ts';

/**
 * TASK-PROTO-U3-B2 §1 — `ge-overview` is TOTALS ONLY.
 *
 * The server row (GET /ge/overview) is an operational aggregate: clients /
 * active / suspended / services / pending staff lists. Per-client assessment
 * cards, the suspend control and the bulk-link shortcut were removed here; those
 * live only on the Clients page (suspend) and service configuration (bulk link).
 * Nothing is recomputed client-side.
 */
interface OverviewTotals {
  clients: number;
  active: number;
  suspended: number;
  services: number;
  pendingStaffLists: number;
}

const EMPTY_TOTALS: OverviewTotals = { clients: 0, active: 0, suspended: 0, services: 0, pendingStaffLists: 0 };

export const GeOverviewView: React.FC = () => {
  const { t } = useLanguage();
  const { user, token } = useAuth();
  const [totals, setTotals] = useState<OverviewTotals>(EMPTY_TOTALS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOverview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await apiFetch('/api/ge/overview', { headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t.common.error);
      const server = data.totals ?? {};
      setTotals({
        clients: Number(server.clients) || 0,
        active: Number(server.active) || 0,
        suspended: Number(server.suspended) || 0,
        services: Number(server.services) || 0,
        pendingStaffLists: Number(server.pendingStaffLists) || 0,
      });
    } catch (err) {
      setError((err as Error)?.message || t.common.error);
    } finally {
      setLoading(false);
    }
  }, [token, t.common.error]);

  useEffect(() => {
    if (user?.role === 'ge_admin') void fetchOverview();
  }, [user?.role, fetchOverview]);

  if (user?.role !== 'ge_admin') {
    return <p className="text-xs text-danger">{t.geOverview.subtitle}</p>;
  }

  if (loading) return <p className="text-xs text-muted">{t.common.loading}</p>;

  const cards: { key: string; label: string; value: number; icon: React.ReactNode; tone: string }[] = [
    {
      key: 'clients',
      label: t.geOverview.totalsClients,
      value: totals.clients,
      icon: <Building2 className="w-4 h-4" />,
      tone: 'bg-brand-soft text-brand-text',
    },
    {
      key: 'active',
      label: t.geOverview.activeLabel,
      value: totals.active,
      icon: <Users className="w-4 h-4" />,
      tone: 'bg-success-soft text-success-text',
    },
    {
      key: 'suspended',
      label: t.geOverview.totalsSuspended,
      value: totals.suspended,
      icon: <PauseCircle className="w-4 h-4" />,
      tone: 'bg-danger-soft text-danger',
    },
    {
      key: 'services',
      label: t.geOverview.totalsServices,
      value: totals.services,
      icon: <Sprout className="w-4 h-4" />,
      tone: 'bg-info-soft text-info',
    },
    {
      key: 'pendingStaffLists',
      label: t.geOverview.pendingStaffListsLabel,
      value: totals.pendingStaffLists,
      icon: <Users className="w-4 h-4" />,
      tone: 'bg-warning-soft text-warning-text',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-surface-2 rounded-2xl border border-border">
        <div className="min-w-0">
          <h3 className="text-xl font-bold text-text">{t.geOverview.title}</h3>
          <p className="text-xs text-muted mt-1">{t.geOverview.subtitle}</p>
        </div>
        <button
          type="button"
          onClick={() => void fetchOverview()}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-muted hover:bg-surface-3 text-xs font-semibold"
          title={t.common.refresh}
        >
          <RefreshCw className="w-4 h-4" />
          <span>{t.common.refresh}</span>
        </button>
      </div>

      {error && (
        <div role="alert" className="p-3 rounded-xl bg-danger-soft border border-danger text-danger text-xs">
          {error}
        </div>
      )}

      <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((card) => (
          <div key={card.key} className="p-5 bg-surface-2 rounded-2xl border border-border">
            <dt className="flex items-center gap-2 text-xs font-medium text-muted">
              <span className={`inline-flex items-center justify-center w-8 h-8 rounded-xl ${card.tone}`}>
                {card.icon}
              </span>
              <span>{card.label}</span>
            </dt>
            <dd dir="ltr" className="mt-2 text-2xl font-extrabold text-text">{card.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
};
