// B12 (S-24) — audit read UI: who/what/when + before-after/reason + filters.
// GE ONLY (plus a named GE delegate server-side; client roles get a hard
// 403 from the API). Read-only over the existing append-only audit_log.

import React, { useCallback, useEffect, useState } from 'react';
import { ScrollText, RefreshCw, Search } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';

interface AuditRow {
  id: string;
  client_id: string | null;
  user_id: string | null;
  user_email: string | null;
  user_name: string | null;
  user_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  payload: any;
  created_at: string;
}

/** Extracts before/after/reason from the heterogeneous audit payloads. */
function payloadFacets(payload: any): { before: string; after: string; reason: string } {
  if (!payload || typeof payload !== 'object') return { before: '—', after: '—', reason: '—' };
  const before = payload.before ?? payload.from ?? payload.previousScore ?? null;
  const after = payload.after ?? payload.to ?? null;
  const reason =
    payload.reason ?? payload.comment ?? payload.reject_reason ?? payload.rejectReason ?? null;
  const fmt = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v));
  return { before: fmt(before), after: fmt(after), reason: fmt(reason) };
}

export const AuditLogView: React.FC = () => {
  const { t } = useLanguage();
  const { user, token } = useAuth();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [auditUserId, setAuditUserId] = useState('');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const headers = useCallback((): Record<string, string> => {
    const h: Record<string, string> = {};
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  }, [token]);

  const fetchLog = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (action.trim()) params.set('action', action.trim());
      if (entityType.trim()) params.set('entityType', entityType.trim());
      if (auditUserId.trim()) params.set('userId', auditUserId.trim());
      if (since) params.set('since', since);
      if (until) params.set('until', until);
      params.set('limit', '100');
      const res = await fetch(`/api/audit-log?${params.toString()}`, { headers: headers() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to read audit log');
      setRows(data.items ?? []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [headers, action, entityType, auditUserId, since, until]);

  useEffect(() => {
    fetchLog();
  }, [fetchLog]);

  if (user?.role !== 'ge_admin') {
    return (
      <div className="p-6 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
        <p className="text-xs text-rose-600">{t.audit.subtitle}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="p-6 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-3 mb-1">
          <ScrollText className="w-5 h-5 text-slate-500" />
          <h3 className="font-bold text-base">{t.audit.title}</h3>
        </div>
        <p className="text-xs text-slate-500 mb-4">{t.audit.subtitle}</p>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 mb-3">
          <input
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder={t.audit.filterAction}
            className="px-3 py-2 rounded-xl text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
          />
          <input
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            placeholder={t.audit.filterEntity}
            className="px-3 py-2 rounded-xl text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
          />
          <input
            value={auditUserId}
            onChange={(e) => setAuditUserId(e.target.value)}
            placeholder={t.audit.filterUser}
            className="px-3 py-2 rounded-xl text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
          />
          <input
            type="date"
            value={since}
            onChange={(e) => setSince(e.target.value)}
            aria-label={t.audit.filterFrom}
            className="px-3 py-2 rounded-xl text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
          />
          <input
            type="date"
            value={until}
            onChange={(e) => setUntil(e.target.value)}
            aria-label={t.audit.filterTo}
            className="px-3 py-2 rounded-xl text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
          />
          <div className="flex gap-2">
            <button
              onClick={fetchLog}
              className="flex-1 px-3 py-2 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-bold flex items-center justify-center gap-1"
            >
              <Search className="w-3.5 h-3.5" />
              {t.audit.search}
            </button>
            <button
              onClick={() => {
                setAction('');
                setEntityType('');
                setAuditUserId('');
                setSince('');
                setUntil('');
              }}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs"
            >
              {t.audit.clear}
            </button>
          </div>
        </div>
        <button
          onClick={fetchLog}
          className="text-xs text-slate-500 flex items-center gap-1 hover:text-slate-700"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t.audit.limit}: {rows.length}
        </button>
      </div>

      {error && <p className="text-xs text-rose-600">{error}</p>}
      {rows.length === 0 && !loading && <p className="text-xs text-slate-500">{t.audit.empty}</p>}

      <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-700">
        <table className="w-full text-xs" dir="auto">
          <thead>
            <tr className="bg-slate-100 dark:bg-slate-800 text-start">
              <th className="text-start px-3 py-2 font-bold">{t.audit.when}</th>
              <th className="text-start px-3 py-2 font-bold">{t.audit.who}</th>
              <th className="text-start px-3 py-2 font-bold">{t.audit.what}</th>
              <th className="text-start px-3 py-2 font-bold">{t.audit.entity}</th>
              <th className="text-start px-3 py-2 font-bold">{t.audit.before}</th>
              <th className="text-start px-3 py-2 font-bold">{t.audit.after}</th>
              <th className="text-start px-3 py-2 font-bold">{t.audit.reason}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const f = payloadFacets(r.payload);
              const open = expanded === r.id;
              return (
                <React.Fragment key={r.id}>
                  <tr
                    className="border-t border-slate-100 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer"
                    onClick={() => setExpanded(open ? null : r.id)}
                  >
                    <td className="px-3 py-2 whitespace-nowrap text-slate-500">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">{r.user_name ?? r.user_email ?? r.user_id ?? '—'}</td>
                    <td className="px-3 py-2 font-mono" dir="ltr">{r.action}</td>
                    <td className="px-3 py-2 font-mono text-slate-500" dir="ltr">
                      {r.entity_type}
                      {r.entity_id ? ` · ${r.entity_id.slice(0, 8)}` : ''}
                    </td>
                    <td className="px-3 py-2 max-w-40 truncate">{f.before}</td>
                    <td className="px-3 py-2 max-w-40 truncate">{f.after}</td>
                    <td className="px-3 py-2 max-w-48 truncate">{f.reason}</td>
                  </tr>
                  {open && (
                    <tr className="border-t border-slate-100 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-800/40">
                      <td colSpan={7} className="px-3 py-2">
                        <p className="font-bold mb-1">{t.audit.payload}</p>
                        <pre className="whitespace-pre-wrap text-[11px] text-slate-600 dark:text-slate-300" dir="ltr">
                          {JSON.stringify(r.payload ?? null, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
