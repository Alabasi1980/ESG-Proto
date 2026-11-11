import React, { useCallback, useEffect, useState } from 'react';
import { Lock, AlertTriangle, RefreshCw, FileCheck2 } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';

interface CheckItem {
  itemId: string;
  code: string;
  answerStatus: string | null;
  notApplicable: boolean | null;
  naReason: string | null;
  score: number | null;
}

interface CheckResult {
  clientId: string;
  scope: string;
  scopeRef: string;
  items: CheckItem[];
  total: number;
  gate: { ok: boolean; incomplete?: string[] };
  alreadyFrozen: boolean;
  snapshot: { id: string } | null;
}

interface SnapshotRow {
  id: string;
  client_id: string;
  scope_type: string;
  scope_ref: string;
  payload: any;
  content_hash: string;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  notes_count: number;
}

/**
 * B9-B4: GE final-review screen (ge_admin only): scope picker, completeness
 * checklist, freeze button with explicit confirm, plus a snapshot viewer
 * (frozen numbers + hash + actor + time, AR+EN) with append-only notes.
 */
export const GeFinalView: React.FC = () => {
  const { t } = useLanguage();
  const { user, token } = useAuth();
  if (user?.role !== 'ge_admin') return null;

  return <GeFinalInner t={t} token={token} />;
};

const GeFinalInner: React.FC<{ t: any; token: string | null }> = ({ t, token }) => {
  const [tenants, setTenants] = useState<{ id: string; code: string; name: string }[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [scope, setScope] = useState<'disclosure' | 'tenant'>('disclosure');
  const [scopeRef, setScopeRef] = useState('');
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [freezing, setFreezing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [selected, setSelected] = useState<{ snapshot: SnapshotRow; notes: any[] } | null>(null);
  const [note, setNote] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  const authOnly = { Authorization: token ? `Bearer ${token}` : '' };
  const authJson = { 'Content-Type': 'application/json', Authorization: token ? `Bearer ${token}` : '' };

  useEffect(() => {
    const load = async () => {
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
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const fetchSnapshots = useCallback(async () => {
    if (!tenantId) {
      setSnapshots([]);
      return;
    }
    try {
      const res = await fetch(`/api/reviews/snapshots?clientId=${encodeURIComponent(tenantId)}`, { headers: authOnly });
      if (res.ok) {
        const data = await res.json();
        setSnapshots(data.items || []);
      }
    } catch (err) {
      console.error('Failed to load snapshots:', err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, token]);

  useEffect(() => {
    fetchSnapshots();
  }, [fetchSnapshots]);

  const runCheck = async () => {
    if (!tenantId) return;
    if (scope === 'disclosure' && !scopeRef.trim()) {
      setError(t.geFinal.selectDisclosure);
      return;
    }
    setChecking(true);
    setError(null);
    setCheck(null);
    try {
      const params = new URLSearchParams({ clientId: tenantId, scope });
      if (scope === 'disclosure') params.set('scopeRef', scopeRef.trim());
      const res = await fetch(`/api/reviews/ge-check?${params.toString()}`, { headers: authOnly });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Check failed');
      setCheck(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setChecking(false);
    }
  };

  const freeze = async () => {
    if (!check || !confirm) return;
    setFreezing(true);
    setNotice(null);
    try {
      const res = await fetch('/api/reviews/ge-final', {
        method: 'POST',
        headers: authJson,
        body: JSON.stringify({ clientId: tenantId, scope, scopeRef: check.scopeRef, confirm: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Freeze failed');
      setNotice({ kind: 'ok', text: t.common.success });
      setConfirm(false);
      runCheck();
      fetchSnapshots();
    } catch (err: any) {
      setNotice({ kind: 'err', text: err.message });
    } finally {
      setFreezing(false);
    }
  };

  const openSnapshot = async (id: string) => {
    try {
      const res = await fetch(`/api/reviews/snapshots/${encodeURIComponent(id)}`, { headers: authOnly });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to load snapshot');
      setSelected(data);
    } catch (err: any) {
      setNotice({ kind: 'err', text: err.message });
    }
  };

  const addNote = async () => {
    if (!selected || !note.trim()) return;
    setAddingNote(true);
    try {
      const res = await fetch(`/api/reviews/snapshots/${encodeURIComponent(selected.snapshot.id)}/notes`, {
        method: 'POST',
        headers: authJson,
        body: JSON.stringify({ note: note.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to add note');
      setNote('');
      openSnapshot(selected.snapshot.id);
      fetchSnapshots();
    } catch (err: any) {
      setNotice({ kind: 'err', text: err.message });
    } finally {
      setAddingNote(false);
    }
  };

  return (
    <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-xs">
      <div className="flex items-center gap-2 mb-1">
        <Lock className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t.geFinal.title}</h3>
      </div>
      <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3">{t.geFinal.subtitle}</p>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
        <div>
          <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">{t.users.tenantLabel}</label>
          <select
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            className="w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-[11px] text-slate-900 dark:text-white"
          >
            <option value="">{t.importGRI.selectTenantPlaceholder}</option>
            {tenants.map((tn) => (
              <option key={tn.id} value={tn.id}>
                {tn.name} ({tn.code})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">{t.geFinal.scopeLabel}</label>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as 'disclosure' | 'tenant')}
            className="w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-[11px] text-slate-900 dark:text-white"
          >
            <option value="disclosure">{t.geFinal.scopeDisclosure}</option>
            <option value="tenant">{t.geFinal.scopeTenant}</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">{t.geFinal.disclosureLabel}</label>
          <input
            value={scopeRef}
            onChange={(e) => setScopeRef(e.target.value)}
            disabled={scope === 'tenant'}
            placeholder={t.geFinal.selectDisclosure}
            className="w-full px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-[11px] text-slate-900 dark:text-white placeholder:text-slate-400 disabled:opacity-50 font-mono"
            dir="ltr"
          />
        </div>
        <div className="flex items-end">
          <button
            onClick={runCheck}
            disabled={checking || !tenantId}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-[11px] font-bold hover:opacity-90 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
            <span>{checking ? t.geFinal.checking : t.geFinal.runCheck}</span>
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
          className={`mt-2 p-3 rounded-xl text-[11px] ${
            notice.kind === 'ok'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800'
              : 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 border border-rose-200 dark:border-rose-800'
          }`}
        >
          {notice.text}
        </div>
      )}

      {check && (
        <div className="mt-3 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700">
          <h4 className="text-xs font-bold text-slate-900 dark:text-white mb-2">{t.geFinal.checklistTitle}</h4>
          {check.alreadyFrozen && (
            <p className="mb-2 px-2 py-1 rounded-full inline-block text-[10px] font-bold uppercase bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300">
              {t.geFinal.frozenBadge} · {t.geFinal.alreadyFrozen}
            </p>
          )}
          {check.gate.ok ? (
            <p className="text-[11px] text-emerald-700 dark:text-emerald-300 font-semibold">{t.geFinal.allClear}</p>
          ) : (
            <div className="text-[11px]">
              <p className="font-bold text-rose-700 dark:text-rose-300 mb-1">
                {t.geFinal.blockedItems}: {(check.gate.incomplete || []).join(', ')}
              </p>
            </div>
          )}
          <ul className="mt-2 max-h-48 overflow-y-auto space-y-1 text-[11px]">
            {check.items.map((it) => (
              <li key={it.itemId} className="flex items-center justify-between gap-2 font-mono text-slate-600 dark:text-slate-300">
                <span>{it.code}</span>
                <span className="font-sans font-semibold">
                  {it.notApplicable ? t.gapAnalysis.stNotApplicable : it.answerStatus === 'client_approved' ? t.gapAnalysis.stClientApproved : it.answerStatus || '—'}
                  {typeof it.score === 'number' ? ` · ${it.score}` : ''}
                </span>
              </li>
            ))}
          </ul>

          {!check.alreadyFrozen && check.gate.ok && (
            <div className="mt-3 p-3 rounded-xl bg-rose-50/60 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800">
              <p className="text-[11px] font-bold text-slate-900 dark:text-white mb-1">{t.geFinal.confirmTitle}</p>
              <p className="text-[11px] text-slate-600 dark:text-slate-300 mb-2">{t.geFinal.confirmDesc}</p>
              <label className="flex items-start gap-2 text-[11px] text-slate-700 dark:text-slate-200 cursor-pointer mb-2">
                <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-0.5 accent-rose-600" />
                <span>{t.geFinal.confirmCheck}</span>
              </label>
              <button
                onClick={freeze}
                disabled={freezing || !confirm}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-600 text-white text-[11px] font-bold hover:bg-rose-700 disabled:opacity-50 transition-colors"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>{freezing ? t.geFinal.freezing : t.geFinal.freezeBtn}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Snapshot viewer */}
      <div className="mt-4">
        <h4 className="text-xs font-bold text-slate-900 dark:text-white mb-2">
          {t.geFinal.snapshotTitle} ({snapshots.length})
        </h4>
        {snapshots.length === 0 && (
          <p className="text-[11px] text-slate-500 dark:text-slate-400">{t.geFinal.snapshotEmpty}</p>
        )}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <ul className="space-y-2 max-h-72 overflow-y-auto">
            {snapshots.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => openSnapshot(s.id)}
                  className={`w-full text-start p-3 rounded-xl border transition-colors ${
                    selected?.snapshot.id === s.id
                      ? 'border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/30'
                      : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-750'
                  }`}
                >
                  <div className="flex items-center gap-2 text-[11px]">
                    <FileCheck2 className="w-4 h-4 text-indigo-500 shrink-0" />
                    <span className="font-bold text-slate-800 dark:text-slate-100">
                      {s.scope_type}: <span className="font-mono" dir="ltr">{s.scope_type === 'tenant' ? s.scope_ref.slice(0, 8) : s.scope_ref.slice(0, 8)}</span>
                    </span>
                    <span className="ms-auto px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300">
                      {t.geFinal.frozenBadge}
                    </span>
                  </div>
                  <div className="mt-1 text-[10px] text-slate-400 font-mono break-all" dir="ltr">
                    {t.geFinal.hashLabel}: {s.content_hash}
                  </div>
                  <div className="mt-0.5 text-[10px] text-slate-400">
                    {s.created_by_name || s.created_by} · {new Date(s.created_at).toLocaleString()} · {s.notes_count} notes
                  </div>
                </button>
              </li>
            ))}
          </ul>

          <div>
            {selected ? (
              <div className="p-3.5 rounded-xl border border-indigo-200 dark:border-indigo-800/60 text-[11px]">
                <h5 className="text-xs font-bold text-slate-900 dark:text-white mb-2">{t.geFinal.viewerTitle}</h5>
                <div className="space-y-1 text-slate-600 dark:text-slate-300">
                  <div>{t.geFinal.aggregateLabel}: <span className="font-bold font-mono" dir="ltr">{selected.snapshot.payload?.aggregate ?? '—'}</span></div>
                  <div>{t.geFinal.coverageLabel}: <span className="font-bold font-mono" dir="ltr">{selected.snapshot.payload?.coveragePercentage ?? '—'}%</span></div>
                  <div>{t.geFinal.hashLabel}: <span className="font-mono break-all" dir="ltr">{selected.snapshot.content_hash}</span></div>
                  <div>{t.geFinal.actorLabel}: <span className="font-semibold">{selected.snapshot.created_by_name || selected.snapshot.created_by}</span></div>
                  <div>{t.geFinal.timeLabel}: {new Date(selected.snapshot.created_at).toLocaleString()}</div>
                  <div>
                    Items ({selected.snapshot.payload?.items?.length ?? 0}):{' '}
                    <span className="font-mono" dir="ltr">
                      {(selected.snapshot.payload?.items || []).map((it: any) => `${it.code}:${it.score ?? (it.notApplicable ? 'N/A' : '?')}`).join(', ')}
                    </span>
                  </div>
                </div>
                <div className="mt-3">
                  <label className="block font-semibold text-slate-600 dark:text-slate-300 mb-1">{t.geFinal.noteLabel}</label>
                  <div className="flex gap-2">
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder={t.geFinal.notePh}
                      maxLength={2000}
                      className="flex-1 px-2.5 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-[11px] text-slate-900 dark:text-white placeholder:text-slate-400"
                    />
                    <button
                      onClick={addNote}
                      disabled={addingNote || !note.trim()}
                      className="px-3 py-2 rounded-lg bg-indigo-600 text-white font-bold hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                    >
                      {addingNote ? t.geFinal.addingNote : t.geFinal.addNote}
                    </button>
                  </div>
                  <ul className="mt-2 space-y-1.5 max-h-32 overflow-y-auto">
                    {selected.notes.map((n: any) => (
                      <li key={n.id} className="p-2 rounded-lg bg-slate-50 dark:bg-slate-750/50 border border-slate-100 dark:border-slate-700/40">
                        <div className="text-slate-700 dark:text-slate-200">{n.note}</div>
                        <div className="text-slate-400 mt-0.5">{n.created_by_name || n.created_by} · {new Date(n.created_at).toLocaleString()}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 p-3 text-center border border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
                {t.geFinal.viewerTitle}…
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
