import React, { useCallback, useEffect, useState } from 'react';
import { ClipboardCheck, Plus, RefreshCw, AlertTriangle, Save, ArrowRight, RotateCcw, CheckCircle2 } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';

interface ActionRow {
  id: string;
  client_id: string;
  item_id: string | null;
  owner_department_id: string;
  department_code: string;
  department_name: string;
  item_code: string | null;
  title: string;
  description: string | null;
  due_date: string | null;
  status: 'open' | 'in_progress' | 'awaiting_verification' | 'closed' | 'reopened';
  evidence_note: string | null;
  created_at: string;
  updated_at: string;
}

const NEXT_STATUS: Record<string, string | null> = {
  open: 'in_progress',
  in_progress: 'awaiting_verification',
  awaiting_verification: 'closed',
  reopened: 'in_progress',
  closed: null,
};

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300',
  in_progress: 'bg-sky-100 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300',
  awaiting_verification: 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300',
  closed: 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300',
  reopened: 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300',
};

export const ActionsView: React.FC = () => {
  const { t } = useLanguage();
  const { user, token } = useAuth();

  const [items, setItems] = useState<ActionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newDept, setNewDept] = useState('');
  const [newDue, setNewDue] = useState('');
  const [creating, setCreating] = useState(false);

  const [evidence, setEvidence] = useState('');
  const [reason, setReason] = useState('');
  const [mutating, setMutating] = useState(false);
  const [formMsg, setFormMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const authHeaders: Record<string, string> = { Authorization: token ? `Bearer ${token}` : '' };
  const isAdmin = user?.role === 'client_admin' || user?.role === 'ge_admin';

  const fetchActions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (deptFilter) params.set('departmentId', deptFilter);
      const q = params.toString() ? `?${params.toString()}` : '';
      const res = await fetch(`/api/actions${q}`, { headers: authHeaders });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to load actions');
      }
      const data = await res.json();
      setItems(data.items || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load actions');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [token, statusFilter, deptFilter]);

  const fetchDepartments = useCallback(async () => {
    try {
      const res = await fetch('/api/departments', { headers: authHeaders });
      if (res.ok) setDepartments(await res.json());
    } catch {
      setDepartments([]);
    }
  }, [token]);

  useEffect(() => {
    fetchActions();
  }, [fetchActions]);

  useEffect(() => {
    fetchDepartments();
  }, [fetchDepartments]);

  const selected: ActionRow | null = items.find((a) => a.id === selectedId) || null;

  useEffect(() => {
    setEvidence(selected?.evidence_note || '');
    setReason('');
    setFormMsg(null);
  }, [selected?.id]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const deptId = user?.role === 'employee' ? user.departmentId : newDept;
      const res = await fetch('/api/actions', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle,
          description: newDesc,
          departmentId: deptId,
          dueDate: newDue || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create action');
      setNewTitle('');
      setNewDesc('');
      setNewDept('');
      setNewDue('');
      setShowCreate(false);
      await fetchActions();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const patchAction = async (body: Record<string, unknown>) => {
    if (!selected) return;
    setMutating(true);
    setFormMsg(null);
    try {
      const res = await fetch(`/api/actions/${selected.id}`, {
        method: 'PATCH',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update action');
      setFormMsg({ kind: 'ok', text: t.actions.updatedMsg });
      setReason('');
      await fetchActions();
    } catch (err: any) {
      setFormMsg({ kind: 'err', text: err.message });
    } finally {
      setMutating(false);
    }
  };

  const statusLabel = (s: string): string => t.actions.statusLabels[s] || s;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-xs">
        <div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">{t.actions.title}</h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{t.actions.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchActions}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs border border-slate-200 dark:border-slate-700"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{t.common.refresh}</span>
          </button>
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t.actions.createButton}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-xs space-y-3"
        >
          <h4 className="text-sm font-bold text-slate-900 dark:text-white">{t.actions.createTitle}</h4>
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">{t.actions.titleLabel}</label>
            <input
              type="text"
              required
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder={t.actions.titlePh}
              className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-750 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">{t.actions.descLabel}</label>
            <textarea
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder={t.actions.descPh}
              rows={2}
              className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-750 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {user?.role === 'employee' ? (
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-750 border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300">
                {t.actions.deptLabel}: {user.departmentName || user.departmentId}
              </div>
            ) : (
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">{t.actions.deptLabel}</label>
                <select
                  value={newDept}
                  onChange={(e) => setNewDept(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-750 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none"
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
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">{t.actions.dueLabel}</label>
              <input
                type="date"
                value={newDue}
                onChange={(e) => setNewDue(e.target.value)}
                className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-750 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={creating}
            className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors disabled:opacity-50"
          >
            {creating ? t.actions.creating : t.actions.createButton}
          </button>
        </form>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 rounded-xl text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
        >
          <option value="">{t.actions.allStatuses}</option>
          {Object.keys(t.actions.statusLabels).map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
        {isAdmin && (
          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="px-3 py-2 rounded-xl text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
          >
            <option value="">{t.actions.allDepartments}</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center p-12 space-y-4">
          <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin" />
          <p className="text-sm text-slate-500">{t.common.loading}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
          <div className="lg:col-span-2 p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-xs">
            <div className="flex items-center gap-2 mb-3 px-1">
              <ClipboardCheck className="w-4 h-4 text-slate-500" />
              <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                {t.actions.listTitle} ({items.length})
              </span>
            </div>
            {items.length === 0 ? (
              <div className="p-4 text-center">
                <p className="text-sm font-bold text-slate-900 dark:text-white mb-1">{t.actions.emptyTitle}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">{t.actions.emptyDesc}</p>
              </div>
            ) : (
              <ul className="space-y-2 max-h-[70vh] overflow-y-auto pe-1">
                {items.map((a) => (
                  <li key={a.id}>
                    <button
                      onClick={() => setSelectedId(a.id)}
                      className={`w-full text-start p-3 rounded-xl border transition-colors ${
                        a.id === selectedId
                          ? 'border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/30'
                          : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-750'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold text-slate-900 dark:text-white truncate">{a.title}</span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase shrink-0 ${STATUS_STYLES[a.status]}`}>
                          {statusLabel(a.status)}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400 mt-1">
                        {a.department_name}
                        {a.due_date ? ` · ${a.due_date}` : ''}
                        {a.item_code ? ` · ${a.item_code}` : ''}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="lg:col-span-3">
            {selected ? (
              <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-xs space-y-4">
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="text-sm font-bold text-slate-900 dark:text-white">{selected.title}</h4>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase shrink-0 ${STATUS_STYLES[selected.status]}`}>
                      {statusLabel(selected.status)}
                    </span>
                  </div>
                  {selected.description && (
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">{selected.description}</p>
                  )}
                  <div className="text-[11px] text-slate-400 mt-2">
                    {selected.department_name}
                    {selected.due_date ? ` · ${t.actions.dueLabel}: ${selected.due_date}` : ''}
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    {t.actions.evidenceLabel}
                  </label>
                  <textarea
                    value={evidence}
                    onChange={(e) => setEvidence(e.target.value)}
                    placeholder={t.actions.evidencePh}
                    rows={2}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white placeholder:text-slate-400"
                  />
                  <button
                    onClick={() => patchAction({ evidenceNote: evidence })}
                    disabled={mutating}
                    className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{t.actions.saveEvidence}</span>
                  </button>
                </div>

                {formMsg && (
                  <div
                    className={`p-2.5 rounded-lg text-xs flex items-center gap-2 ${
                      formMsg.kind === 'ok'
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200'
                        : 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200'
                    }`}
                  >
                    {formMsg.kind === 'err' && <AlertTriangle className="w-4 h-4 shrink-0" />}
                    <span>{formMsg.text}</span>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {NEXT_STATUS[selected.status] && (
                    <button
                      onClick={() => patchAction({ status: NEXT_STATUS[selected.status] })}
                      disabled={mutating}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50"
                    >
                      <ArrowRight className="w-3.5 h-3.5" />
                      <span>
                        {selected.status === 'awaiting_verification'
                          ? t.actions.closeButton
                          : t.actions.nextOf[selected.status] || t.actions.advanceButton}
                      </span>
                    </button>
                  )}
                  {isAdmin && (selected.status === 'awaiting_verification' || selected.status === 'closed') && (
                    <span className="inline-flex items-center gap-2">
                      <input
                        type="text"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder={t.actions.reasonPh}
                        className="px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 w-56"
                      />
                      <button
                        onClick={() => {
                          if (!reason.trim()) {
                            setFormMsg({ kind: 'err', text: t.actions.reasonRequired });
                            return;
                          }
                          patchAction({ status: 'reopened', reason: reason.trim() });
                        }}
                        disabled={mutating}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-rose-300 dark:border-rose-700 text-rose-700 dark:text-rose-300 text-xs font-bold hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>{t.actions.reopenButton}</span>
                      </button>
                    </span>
                  )}
                </div>
                {selected.status === 'closed' && (
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {statusLabel('closed')}
                  </p>
                )}
              </div>
            ) : (
              <div className="p-8 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-xs text-center">
                <ClipboardCheck className="w-10 h-10 mx-auto mb-3 text-slate-300 dark:text-slate-600" />
                <p className="text-xs text-slate-500 dark:text-slate-400">{t.actions.emptyTitle}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
