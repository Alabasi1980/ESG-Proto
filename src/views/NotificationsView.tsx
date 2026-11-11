// B12 (S-23) — in-app notification inbox for all roles.
// Newest first; mark-read (single + all); unread badge count refreshes.

import React, { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, CheckCheck, RefreshCw } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  title_ar: string | null;
  body: string | null;
  body_ar: string | null;
  entity_type: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
}

export const NotificationsView: React.FC = () => {
  const { t, lang } = useLanguage();
  const { token } = useAuth();
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const headers = useCallback((): Record<string, string> => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  }, [token]);

  const fetchInbox = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/notifications', { headers: headers() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch notifications');
      setRows(data.items ?? []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => {
    fetchInbox();
  }, [fetchInbox]);

  const markRead = async (id: string) => {
    try {
      const res = await fetch(`/api/notifications/${id}/read`, { method: 'POST', headers: headers() });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      setRows((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
    } catch (err: any) {
      setError(err.message);
    }
  };

  const markAllRead = async () => {
    try {
      const res = await fetch('/api/notifications/read-all', { method: 'POST', headers: headers() });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      setRows((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    } catch (err: any) {
      setError(err.message);
    }
  };

  const unread = rows.filter((n) => !n.read_at).length;

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="p-6 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-3">
            <Bell className="w-5 h-5 text-slate-500" />
            <h3 className="font-bold text-base">
              {t.notifications.title}
              {unread > 0 && (
                <span className="ms-2 px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 text-[11px] font-bold">
                  {unread} {t.notifications.unread}
                </span>
              )}
              {unread === 0 && rows.length > 0 && (
                <span className="ms-2 text-[11px] text-emerald-600 font-medium">{t.notifications.allCaughtUp}</span>
              )}
            </h3>
          </div>
          <div className="flex gap-2">
            <button
              onClick={fetchInbox}
              className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500"
              title={t.notifications.title}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            {unread > 0 && (
              <button
                onClick={markAllRead}
                className="px-3 py-2 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-bold flex items-center gap-1"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                {t.notifications.markAllRead}
              </button>
            )}
          </div>
        </div>
        <p className="text-xs text-slate-500">{t.notifications.subtitle}</p>
      </div>

      {error && <p className="text-xs text-rose-600">{error}</p>}
      {rows.length === 0 && !loading && (
        <div className="p-8 text-center bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700">
          <BellOff className="w-6 h-6 mx-auto text-slate-300 mb-2" />
          <p className="text-xs text-slate-500">{t.notifications.empty}</p>
        </div>
      )}

      <div className="space-y-2">
        {rows.map((n) => (
          <div
            key={n.id}
            className={`p-4 rounded-2xl border text-xs ${
              n.read_at
                ? 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 opacity-75'
                : 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-bold text-[13px]">
                  {lang === 'ar' && n.title_ar ? n.title_ar : n.title}
                </p>
                {(n.body || n.body_ar) && (
                  <p className="text-slate-500 mt-1">
                    {lang === 'ar' && n.body_ar ? n.body_ar : n.body}
                  </p>
                )}
                <p className="text-[11px] text-slate-400 mt-1">
                  {new Date(n.created_at).toLocaleString()} · <span className="font-mono">{n.type}</span>
                </p>
              </div>
              {!n.read_at && (
                <button
                  onClick={() => markRead(n.id)}
                  className="shrink-0 px-3 py-1.5 rounded-xl border border-emerald-300 text-emerald-700 text-[11px] font-bold hover:bg-emerald-100"
                >
                  {t.notifications.markRead}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
