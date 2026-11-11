import React, { useCallback, useEffect, useState } from 'react';
import { Building2, CheckCircle2, Undo2, AlertTriangle, RefreshCw } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';

interface ReviewDept {
  departmentId: string;
  departmentName: string;
  answerId: string | null;
  answerStatus: string | null;
  answerVersion: number | null;
  evaluationId: string | null;
  evaluationVersion: number | null;
  score: number | null;
  notEvaluated: boolean | null;
  notApplicable: boolean | null;
  naReason: string | null;
}

interface ReviewGroup {
  disclosureId: string;
  disclosureCode: string;
  disclosureTitle: string;
  standardCode: string;
  departments: ReviewDept[];
  total: number;
  approved: number;
  clientApproved: number;
  notApplicable: number;
  completeness: number;
  readyForClient: boolean;
  fullyClientApproved: boolean;
  incompleteDepartments: string[];
}

/**
 * B9-A3: client-review queue (admins only). Pending client approval grouped by
 * disclosure with a completeness bar per group; approve/return per item with
 * comment. Client approval is disclosure-gated server-side (409 names the
 * incomplete departments when any department is still pending).
 */
export const ClientReviewView: React.FC<{ onChanged: () => void }> = ({ onChanged }) => {
  const { t } = useLanguage();
  const { user, token } = useAuth();

  const isAdmin = user?.role === 'client_admin' || user?.role === 'ge_admin';
  const isGe = user?.role === 'ge_admin';

  const [tenants, setTenants] = useState<{ id: string; code: string; name: string }[]>([]);
  const [tenantId, setTenantId] = useState<string>(user?.clientId ?? '');
  const [groups, setGroups] = useState<ReviewGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [working, setWorking] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: token ? `Bearer ${token}` : '',
  };
  const authOnly = { Authorization: token ? `Bearer ${token}` : '' };

  useEffect(() => {
    if (!isGe) {
      setTenantId(user?.clientId ?? '');
      return;
    }
    const loadTenants = async () => {
      try {
        const res = await fetch('/api/clients', { headers: authOnly });
        if (res.ok) {
          const list = await res.json();
          setTenants(list || []);
          if (!tenantId && (list || []).length > 0) setTenantId(list[0].id);
        }
      } catch (err) {
        console.error('Failed to load tenants:', err);
      }
    };
    loadTenants();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGe, user?.clientId, token]);

  const fetchGroups = useCallback(async () => {
    if (!tenantId) {
      setGroups([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/client-review?clientId=${encodeURIComponent(tenantId)}`, { headers: authOnly });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to load client-review queue');
      setGroups(data.groups || []);
    } catch (err: any) {
      setError(err.message);
      setGroups([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, token]);

  useEffect(() => {
    if (isAdmin) fetchGroups();
  }, [fetchGroups, isAdmin]);

  if (!isAdmin) return null;

  const act = async (dept: ReviewDept, action: 'client-approve' | 'client-return') => {
    if (!dept.evaluationId) return;
    const comment = (comments[dept.evaluationId] || '').trim();
    if (action === 'client-return' && !comment) {
      setNotice({ kind: 'err', text: t.clientReview.commentRequired });
      return;
    }
    setWorking(`${dept.evaluationId}:${action}`);
    setNotice(null);
    try {
      const version = dept.evaluationVersion ?? dept.answerVersion ?? null;
      const res = await fetch(`/api/evaluations/${dept.evaluationId}/${action}`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ comment: comment || undefined, ...(version !== null ? { version } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data && data.conflict) {
          throw new Error(`${data.error || 'Version conflict'} — ${t.conflict.reloadRetry}.`);
        }
        throw new Error(data.error || 'Action failed');
      }
      setNotice({ kind: 'ok', text: t.common.success });
      setComments((c) => ({ ...c, [dept.evaluationId as string]: '' }));
      fetchGroups();
      onChanged();
    } catch (err: any) {
      setNotice({ kind: 'err', text: err.message });
    } finally {
      setWorking(null);
    }
  };

  const statusBadge = (s: string | null, na: boolean | null) => {
    if (na) return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300">{t.gapAnalysis.stNotApplicable}</span>;
    switch (s) {
      case 'client_approved':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300">{t.gapAnalysis.stClientApproved}</span>;
      case 'approved':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">{t.gapAnalysis.stApproved}</span>;
      case 'submitted':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300">{t.gapAnalysis.stSubmitted}</span>;
      case 'returned':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300">{t.gapAnalysis.stReturned}</span>;
      case 'draft':
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-sky-100 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300">{t.gapAnalysis.stDraft}</span>;
      default:
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">{t.gapAnalysis.stNotEvaluated}</span>;
    }
  };

  return (
    <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-1">
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t.clientReview.title}</h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{t.clientReview.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {isGe && (
            <select
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              className="px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-[11px] text-slate-900 dark:text-white"
            >
              <option value="">{t.importGRI.selectTenantPlaceholder}</option>
              {tenants.map((tn) => (
                <option key={tn.id} value={tn.id}>
                  {tn.name} ({tn.code})
                </option>
              ))}
            </select>
          )}
          <button
            onClick={fetchGroups}
            disabled={loading}
            className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            title={t.common.refresh}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-2 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-[11px] flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div
          className={`mt-2 p-3 rounded-xl text-[11px] flex items-center gap-2 ${
            notice.kind === 'ok'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800'
              : 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 border border-rose-200 dark:border-rose-800'
          }`}
        >
          {notice.kind === 'err' && <AlertTriangle className="w-4 h-4 shrink-0" />}
          <span>{notice.text}</span>
        </div>
      )}

      {!loading && !error && groups.length === 0 && (
        <div className="mt-3 p-4 text-center">
          <p className="text-xs font-bold text-slate-900 dark:text-white mb-1">{t.clientReview.emptyTitle}</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">{t.clientReview.emptyDesc}</p>
        </div>
      )}

      <div className="mt-3 space-y-3">
        {groups.map((g) => (
          <div key={g.disclosureId} className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Building2 className="w-4 h-4 text-slate-400 shrink-0" />
                <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                  {g.standardCode} · {g.disclosureCode} — {g.disclosureTitle}
                </span>
              </div>
              {g.fullyClientApproved ? (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300">
                  {t.gapAnalysis.stClientApproved}
                </span>
              ) : g.readyForClient ? (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
                  {t.clientReview.readyBadge}
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300">
                  {t.clientReview.blockedBadge}
                </span>
              )}
            </div>

            {/* Completeness bar */}
            <div className="mt-2">
              <div className="flex justify-between text-[10px] text-slate-500 dark:text-slate-400 mb-1">
                <span>
                  {t.clientReview.completeness}: {g.approved + g.notApplicable}/{g.total}
                </span>
                <span>{g.completeness}%</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden" dir="ltr">
                <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${g.completeness}%` }} />
              </div>
              {g.incompleteDepartments.length > 0 && (
                <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
                  {g.incompleteDepartments.join(', ')}
                </p>
              )}
            </div>

            <ul className="mt-2 space-y-1.5">
              {g.departments.map((d) => (
                <li
                  key={d.departmentId}
                  className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-750/50 border border-slate-100 dark:border-slate-700/40"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200 truncate">
                      {d.departmentName}
                    </span>
                    {statusBadge(d.answerStatus, d.notApplicable)}
                    {typeof d.score === 'number' && (
                      <span className="text-[10px] font-mono text-slate-500">{d.score}</span>
                    )}
                  </div>
                  {d.evaluationId && (d.answerStatus === 'approved' || d.answerStatus === 'client_approved') && (
                    <div className="flex items-center gap-1.5">
                      <input
                        value={comments[d.evaluationId] || ''}
                        onChange={(e) => setComments((c) => ({ ...c, [d.evaluationId as string]: e.target.value }))}
                        placeholder={t.gapAnalysis.commentPh}
                        className="px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-[11px] text-slate-900 dark:text-white placeholder:text-slate-400 w-40"
                      />
                      {d.answerStatus === 'approved' && (
                        <button
                          onClick={() => act(d, 'client-approve')}
                          disabled={working !== null}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white text-[11px] font-bold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                        >
                          <CheckCircle2 className="w-3 h-3" />
                          <span>{working ? t.clientReview.approving : t.clientReview.clientApproveBtn}</span>
                        </button>
                      )}
                      <button
                        onClick={() => act(d, 'client-return')}
                        disabled={working !== null}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-300 dark:border-rose-700 text-rose-700 dark:text-rose-300 text-[11px] font-bold hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50 transition-colors"
                      >
                        <Undo2 className="w-3 h-3" />
                        <span>{t.clientReview.clientReturnBtn}</span>
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
};
