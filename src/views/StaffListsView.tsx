import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Plus, Trash2, KeyRound } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';

interface StaffRow {
  email: string;
  name: string;
  departmentId: string;
  departmentName?: string;
  role: string;
}

interface StaffList {
  id: string;
  client_id: string;
  status: string;
  note: string | null;
  reject_reason: string | null;
  client_code: string;
  client_name: string;
  row_count: number;
  rows: { id: string; email: string; name: string; department_id: string | null; department_name: string | null; department_resolved: string | null; role: string }[];
}

interface Dept {
  id: string;
  name: string;
  client_id: string;
}

interface OtpAccount {
  email: string;
  oneTimePassword: string;
}

export const StaffListsView: React.FC = () => {
  const { t } = useLanguage();
  const { user, token } = useAuth();
  const [lists, setLists] = useState<StaffList[]>([]);
  const [departments, setDepartments] = useState<Dept[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<StaffRow[]>([{ email: '', name: '', departmentId: '', role: 'employee' }]);
  const [creating, setCreating] = useState(false);
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});
  const [lastOtps, setLastOtps] = useState<{ listId: string; accounts: OtpAccount[] } | null>(null);

  const headers = useCallback((): Record<string, string> => {
    const h: Record<string, string> = {};
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  }, [token]);

  const jsonHeaders = useCallback((): Record<string, string> => ({ ...headers(), 'Content-Type': 'application/json' }), [headers]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [lRes, dRes] = await Promise.all([
        fetch('/api/staff-lists', { headers: headers() }),
        fetch('/api/departments', { headers: headers() }),
      ]);
      if (lRes.ok) {
        const data = await lRes.json();
        setLists(data.items ?? []);
      }
      if (dRes.ok) setDepartments(await dRes.json());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [headers]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  if (user?.role !== 'ge_admin' && user?.role !== 'client_admin') {
    return <p className="text-xs text-rose-600">{t.staffLists.subtitle}</p>;
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const payload = {
        rows: rows.map((r) => ({ email: r.email, name: r.name, departmentId: r.departmentId || undefined, departmentName: r.departmentName, role: r.role })),
      };
      const res = await fetch('/api/staff-lists', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      // Auto-submit the draft so the WF-01 chain (Fill → Submit) completes in one action.
      const sub = await fetch(`/api/staff-lists/${data.id}/submit`, { method: 'POST', headers: jsonHeaders() });
      const subData = await sub.json().catch(() => ({}));
      if (!sub.ok) throw new Error(subData.error || 'Created, but submit failed — submit manually.');
      setRows([{ email: '', name: '', departmentId: '', role: 'employee' }]);
      await fetchAll();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleSubmit = async (id: string) => {
    try {
      const res = await fetch(`/api/staff-lists/${id}/submit`, { method: 'POST', headers: jsonHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await fetchAll();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleApprove = async (id: string) => {
    if (!window.confirm('Approve and provision accounts? OTPs show ONCE.')) return;
    try {
      const res = await fetch(`/api/staff-lists/${id}/approve`, { method: 'POST', headers: jsonHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setLastOtps({ listId: id, accounts: data.accounts ?? [] });
      await fetchAll();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleReject = async (id: string) => {
    const reason = (rejectReason[id] || '').trim();
    if (!reason) {
      setError('A rejection reason is required.');
      return;
    }
    try {
      const res = await fetch(`/api/staff-lists/${id}/reject`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await fetchAll();
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (loading) return <p className="text-xs text-slate-500">{t.common.loading}</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 p-6 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60">
        <div>
          <h3 className="text-xl font-bold">{t.staffLists.title}</h3>
          <p className="text-xs text-slate-500 mt-1">{t.staffLists.subtitle}</p>
        </div>
        <button onClick={fetchAll} className="p-2 rounded-lg border border-slate-200 dark:border-slate-700" title={t.common.refresh}>
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {error && <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs">{error}</div>}

      {lastOtps && (
        <div className="p-5 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 text-xs">
          <div className="flex items-center gap-2 font-bold text-amber-800 dark:text-amber-200 mb-1">
            <KeyRound className="w-4 h-4" />
            <span>{t.staffLists.otpTitle}</span>
          </div>
          <p className="text-amber-700 dark:text-amber-300 mb-3">{t.staffLists.otpWarning}</p>
          <ul className="space-y-1 font-mono">
            {lastOtps.accounts.map((a) => (
              <li key={a.email}>
                {a.email} — {a.oneTimePassword}
              </li>
            ))}
          </ul>
          <button onClick={() => setLastOtps(null)} className="mt-3 px-4 py-1.5 rounded-lg bg-amber-600 text-white font-bold">
            {t.common.close}
          </button>
        </div>
      )}

      {(user?.role === 'client_admin' || user?.role === 'ge_admin') && (
        <form onSubmit={handleCreate} className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 space-y-3">
          <div className="text-xs font-bold">{t.staffLists.createTitle}</div>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-1 sm:grid-cols-4 gap-2">
              <input
                value={r.email}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))}
                placeholder={t.staffLists.emailPh}
                required
                className="px-3 py-2 rounded-xl text-xs border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-750"
              />
              <input
                value={r.name}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                placeholder={t.staffLists.namePh}
                required
                className="px-3 py-2 rounded-xl text-xs border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-750"
              />
              <select
                value={r.departmentId}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, departmentId: e.target.value } : x)))}
                required
                className="px-3 py-2 rounded-xl text-xs border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-750"
              >
                <option value="">—</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-2">
                <select
                  value={r.role}
                  onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))}
                  className="flex-1 px-3 py-2 rounded-xl text-xs border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-750"
                >
                  <option value="employee">employee</option>
                  <option value="client_admin">client_admin</option>
                </select>
                <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="p-2 rounded-lg border border-rose-200 text-rose-600">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setRows([...rows, { email: '', name: '', departmentId: '', role: 'employee' }])} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border text-xs font-bold">
              <Plus className="w-3.5 h-3.5" /> {t.staffLists.addRow}
            </button>
            <button type="submit" disabled={creating} className="px-4 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold disabled:opacity-50">
              {creating ? t.common.loading : t.staffLists.submitList}
            </button>
          </div>
        </form>
      )}

      {lists.length === 0 ? (
        <p className="text-xs text-slate-500 p-4 rounded-xl border">{t.staffLists.emptyText}</p>
      ) : (
        <ul className="space-y-3">
          {lists.map((l) => (
            <li key={l.id} className="p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs">
                  <span className="font-bold">
                    {l.client_name} ({l.client_code})
                  </span>{' '}
                  · {(t.staffLists.statusLabels as any)[l.status] ?? l.status} · {l.row_count} rows
                  {l.reject_reason && <span className="text-rose-600"> · {l.reject_reason}</span>}
                </div>
                <div className="flex items-center gap-2">
                  {l.status === 'draft' && (
                    <button onClick={() => handleSubmit(l.id)} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold">
                      {t.common.submit}
                    </button>
                  )}
                  {user?.role === 'ge_admin' && l.status === 'submitted' && (
                    <>
                      <button onClick={() => handleApprove(l.id)} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold">
                        {t.staffLists.approveBtn}
                      </button>
                      <input
                        value={rejectReason[l.id] || ''}
                        onChange={(e) => setRejectReason({ ...rejectReason, [l.id]: e.target.value })}
                        placeholder={t.staffLists.rejectReasonPh}
                        className="px-3 py-1.5 rounded-lg text-xs border"
                      />
                      <button onClick={() => handleReject(l.id)} className="px-3 py-1.5 rounded-lg border border-rose-300 text-rose-600 text-xs font-bold">
                        {t.staffLists.rejectBtn}
                      </button>
                    </>
                  )}
                </div>
              </div>
              <ul className="mt-2 text-[11px] text-slate-500 space-y-0.5">
                {l.rows.map((r) => (
                  <li key={r.id}>
                    {r.email} · {r.name} · {r.department_resolved || r.department_name || '—'} · {r.role}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
