import React, { useEffect, useState } from 'react';
import {
  Save,
  Send,
  CheckCircle2,
  Undo2,
  History,
  AlertTriangle,
  PencilLine,
  RefreshCw,
  Paperclip,
  Download,
  Trash2,
} from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';

export interface QueueItem {
  item_id: string;
  code: string;
  requirement: string;
  priority: string;
  weight: number;
  esg_class: string;
  topic: string | null;
  objective: string | null;
  disclosure_code: string;
  disclosure_title: string;
  standard_code: string;
  pillar: string;
  department_id: string;
  department_code: string;
  department_name: string;
  evaluation_id: string | null;
  evaluation_version: number | null;
  score: number | null;
  not_evaluated: boolean | null;
  not_applicable: boolean | null;
  na_reason: string | null;
  justification: string | null;
  evaluator_id: string | null;
  previous_score: number | null;
  answer_id: string | null;
  answer_status: string | null;
  answer_version: number | null;
  answer_submitted_by: string | null;
  status: string;
}

interface VersionConflictPayload {
  expectedVersion?: number | null;
  providedVersion?: number | null;
  evaluation?: {
    version?: number | null;
    score?: number | null;
    notEvaluated?: boolean | null;
    notApplicable?: boolean | null;
    naReason?: string | null;
    evidenceNote?: string | null;
    actorId?: string | null;
    actorName?: string | null;
    updatedAt?: string | null;
  } | null;
  answer?: {
    version?: number | null;
    status?: string | null;
    evidenceNote?: string | null;
    actorId?: string | null;
    actorName?: string | null;
    updatedAt?: string | null;
  } | null;
  attempted?: unknown;
}

interface AttachmentRow {
  id: string;
  answer_id: string;
  file_name: string;
  mime: string;
  size_bytes: number;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  created_at: string;
}

interface HistoryEntry {
  id: string;
  action: string;
  actor_name: string | null;
  user_id: string | null;
  payload: {
    before?: { score: number | null; notEvaluated?: boolean; notApplicable?: boolean; naReason?: string | null };
    after?: { score: number | null; notEvaluated?: boolean; notApplicable?: boolean; naReason?: string | null };
    reason?: string;
    actor?: string;
    comment?: string | null;
  } | null;
  created_at: string;
}

type EvalMode = 'score' | 'notEvaluated' | 'notApplicable';

function outcomeLabel(item: QueueItem, t: any): string {
  if (item.not_applicable) return t.gapAnalysis.stNotApplicable;
  if (item.not_evaluated || item.evaluation_id === null || item.score === null) return t.gapAnalysis.stNotEvaluated;
  return `${t.gapAnalysis.scoreLabel}: ${item.score}`;
}

/** Map stable API message keys to localized UI strings (fallback: server text). */
function serverMessage(code: string | undefined, fallback: string, t: any): string {
  switch (code) {
    case 'attachments.oversize':
      return t.attachments.oversize;
    case 'attachments.mime':
      return t.attachments.mime;
    case 'attachments.missing':
      return t.attachments.missing;
    default:
      return fallback;
  }
}

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10} ${units[u]}`;
}

/** Mine-vs-theirs conflict box (A-15): shows the server's current values + reload. */
const ConflictBox: React.FC<{ conflict: VersionConflictPayload; t: any; onReload: () => void }> = ({
  conflict,
  t,
  onReload,
}) => {
  const ev = conflict.evaluation;
  const an = conflict.answer;
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex justify-between gap-2 py-0.5">
      <span className="text-slate-400">{label}</span>
      <span className="font-semibold text-slate-700 dark:text-slate-200 text-end break-all">{value}</span>
    </div>
  );
  return (
    <div className="mt-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 text-[11px]">
      <div className="flex items-center gap-2 font-bold text-amber-800 dark:text-amber-200 mb-1">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span>{t.conflict.title}</span>
      </div>
      <p className="text-amber-700 dark:text-amber-300 mb-2">{t.conflict.desc}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="p-2 rounded-lg bg-white/70 dark:bg-slate-900/50 border border-amber-200 dark:border-amber-800">
          <div className="font-bold text-slate-800 dark:text-slate-100 mb-1">{t.conflict.theirsLabel}</div>
          {row(t.conflict.versionLabel, ev?.version ?? an?.version ?? '—')}
          {row(t.gapAnalysis.scoreLabel, ev?.score ?? (ev?.notApplicable ? t.gapAnalysis.stNotApplicable : t.gapAnalysis.stNotEvaluated))}
          {row(t.gapAnalysis.evidenceNoteLabel, ev?.evidenceNote || an?.evidenceNote || '—')}
          {row(t.gapAnalysis.status, an?.status ?? '—')}
          {row(t.conflict.actorLabel, ev?.actorName || an?.actorName || '—')}
          {row(t.conflict.timeLabel, ev?.updatedAt ? new Date(ev.updatedAt).toLocaleString() : '—')}
        </div>
        <div className="p-2 rounded-lg bg-white/70 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700">
          <div className="font-bold text-slate-800 dark:text-slate-100 mb-1">{t.conflict.mineLabel}</div>
          <pre className="whitespace-pre-wrap font-mono text-slate-600 dark:text-slate-300" dir="ltr">
            {JSON.stringify(conflict.attempted ?? {}, null, 1)}
          </pre>
        </div>
      </div>
      <button
        onClick={onReload}
        className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-[11px] font-bold hover:bg-amber-700 transition-colors"
      >
        <RefreshCw className="w-3 h-3" />
        <span>{t.conflict.reloadRetry}</span>
      </button>
    </div>
  );
};

/** Evidence attachments: attach / list / download / delete + usage readout (D). */
const AttachmentsSection: React.FC<{ answerId: string; token: string | null; t: any }> = ({ answerId, token, t }) => {
  const [files, setFiles] = useState<AttachmentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [usage, setUsage] = useState<{ bytes: number; files: number; formatted: string; warn: boolean } | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const authOnly = { Authorization: token ? `Bearer ${token}` : '' };

  const fetchFiles = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/answers/${encodeURIComponent(answerId)}/attachments`, { headers: authOnly });
      if (res.ok) {
        const data = await res.json();
        setFiles(data.items || []);
      }
    } catch (err) {
      console.error('Failed to load attachments:', err);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answerId, token]);

  const fetchUsage = React.useCallback(async () => {
    try {
      const res = await fetch('/api/storage/usage', { headers: authOnly });
      if (res.ok) setUsage(await res.json());
    } catch (err) {
      console.error('Failed to load storage usage:', err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    fetchFiles();
    fetchUsage();
  }, [fetchFiles, fetchUsage]);

  const doUpload = async () => {
    if (!pendingFile) {
      setMsg({ kind: 'err', text: t.attachments.missing });
      return;
    }
    setUploading(true);
    setMsg(null);
    try {
      const form = new FormData();
      form.append('file', pendingFile);
      const res = await fetch(`/api/answers/${encodeURIComponent(answerId)}/attachments`, {
        method: 'POST',
        headers: authOnly,
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(serverMessage(data.code, data.error || t.attachments.uploadFailed, t));
      setMsg({ kind: 'ok', text: t.common.success });
      setPendingFile(null);
      setInputKey((k) => k + 1);
      fetchFiles();
      fetchUsage();
    } catch (err: any) {
      setMsg({ kind: 'err', text: err.message });
    } finally {
      setUploading(false);
    }
  };

  const doDownload = async (f: AttachmentRow) => {
    try {
      const res = await fetch(`/api/answers/${encodeURIComponent(answerId)}/attachments/${encodeURIComponent(f.id)}/download`, {
        headers: authOnly,
      });
      if (!res.ok) throw new Error(t.attachments.uploadFailed);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = f.file_name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setMsg({ kind: 'err', text: err.message });
    }
  };

  const doDelete = async (f: AttachmentRow) => {
    if (!window.confirm(t.attachments.deleteConfirm)) return;
    try {
      const res = await fetch(`/api/answers/${encodeURIComponent(answerId)}/attachments/${encodeURIComponent(f.id)}`, {
        method: 'DELETE',
        headers: authOnly,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(serverMessage(data.code, data.error || t.attachments.uploadFailed, t));
      fetchFiles();
      fetchUsage();
    } catch (err: any) {
      setMsg({ kind: 'err', text: err.message });
    }
  };

  return (
    <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-xs">
      <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-1">{t.attachments.title}</h4>
      <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3">{t.attachments.typesNote}</p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          key={inputKey}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.xlsx,.csv,.txt"
          onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
          className="text-[11px] text-slate-600 dark:text-slate-300 file:me-2 file:px-3 file:py-1.5 file:rounded-lg file:border file:border-slate-300 dark:file:border-slate-600 file:bg-slate-50 dark:file:bg-slate-700 file:text-[11px] file:font-semibold"
        />
        <button
          onClick={doUpload}
          disabled={uploading || !pendingFile}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-[11px] font-bold hover:opacity-90 disabled:opacity-50 transition-colors"
        >
          <Paperclip className="w-3.5 h-3.5" />
          <span>{uploading ? t.attachments.uploading : t.attachments.attachBtn}</span>
        </button>
      </div>

      {msg && (
        <div
          className={`mt-2 p-2.5 rounded-lg text-[11px] flex items-center gap-2 ${
            msg.kind === 'ok'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200'
              : 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200'
          }`}
        >
          {msg.kind === 'err' && <AlertTriangle className="w-4 h-4 shrink-0" />}
          <span>{msg.text}</span>
        </div>
      )}

      <div className="mt-3">
        {loading && <p className="text-[11px] text-slate-500">{t.common.loading}</p>}
        {!loading && files.length === 0 && (
          <p className="text-[11px] text-slate-500 dark:text-slate-400">{t.attachments.emptyText}</p>
        )}
        <ul className="space-y-2">
          {files.map((f) => (
            <li
              key={f.id}
              className="flex items-center justify-between gap-2 p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px]"
            >
              <div className="min-w-0">
                <div className="font-bold text-slate-800 dark:text-slate-100 truncate">{f.file_name}</div>
                <div className="text-slate-400">
                  {f.mime} · {fmtBytes(f.size_bytes)} · {f.uploaded_by_name || f.uploaded_by} ·{' '}
                  {new Date(f.created_at).toLocaleString()}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => doDownload(f)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 font-semibold hover:bg-slate-50 dark:hover:bg-slate-700"
                >
                  <Download className="w-3 h-3" />
                  <span>{t.attachments.downloadBtn}</span>
                </button>
                <button
                  onClick={() => doDelete(f)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-300 dark:border-rose-700 text-rose-700 dark:text-rose-300 font-semibold hover:bg-rose-50 dark:hover:bg-rose-950/40"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>{t.attachments.deleteBtn}</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {usage && (
        <div className="mt-3 p-2.5 rounded-lg bg-slate-50 dark:bg-slate-750/50 border border-slate-100 dark:border-slate-700/40 text-[11px] text-slate-600 dark:text-slate-300">
          {t.attachments.usageLabel}: <span className="font-bold">{usage.formatted}</span> · {usage.files}{' '}
          {t.storage.filesLabel}
          {usage.warn && <span className="ms-1 font-bold text-amber-600 dark:text-amber-400">· {t.storage.warnMsg}</span>}
        </div>
      )}
    </div>
  );
};

export const EvaluationPanel: React.FC<{ item: QueueItem; onChanged: () => void }> = ({ item, onChanged }) => {
  const { t } = useLanguage();
  const { user, token } = useAuth();

  const initialMode: EvalMode = item.not_applicable ? 'notApplicable' : item.not_evaluated || !item.evaluation_id ? 'score' : item.score !== null ? 'score' : 'notEvaluated';
  const [mode, setMode] = useState<EvalMode>(item.not_applicable ? 'notApplicable' : item.score !== null ? 'score' : item.not_evaluated ? 'notEvaluated' : 'score');
  const [score, setScore] = useState<number>(typeof item.score === 'number' ? item.score : 100);
  const [naReason, setNaReason] = useState<string>(item.na_reason || 'not-applicable');
  const [note, setNote] = useState<string>(item.justification || '');
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formMsg, setFormMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [comment, setComment] = useState('');
  const [deciding, setDeciding] = useState<'approve' | 'return' | null>(null);
  const [decisionMsg, setDecisionMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [correctReason, setCorrectReason] = useState('');
  const [correcting, setCorrecting] = useState(false);
  const [correctMsg, setCorrectMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // B9-C (A-15): optimistic-locking version + mine-vs-theirs conflict state.
  const pairVersion = item.evaluation_version ?? item.answer_version ?? null;
  const [conflict, setConflict] = useState<VersionConflictPayload | null>(null);

  // Reset local form whenever a different queue item is selected.
  useEffect(() => {
    setMode(initialMode);
    setScore(typeof item.score === 'number' ? item.score : 100);
    setNaReason(item.na_reason || 'not-applicable');
    setNote(item.justification || '');
    setFormMsg(null);
    setDecisionMsg(null);
    setCorrectMsg(null);
    setConflict(null);
    setComment('');
    setCorrectReason('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.item_id, item.department_id]);

  useEffect(() => {
    let cancelled = false;
    const fetchHistory = async () => {
      if (!item.evaluation_id) {
        setHistory(null);
        return;
      }
      setHistoryLoading(true);
      try {
        const res = await fetch(`/api/evaluations?itemId=${encodeURIComponent(item.item_id)}`, {
          headers: { Authorization: token ? `Bearer ${token}` : '' },
        });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setHistory(data.history || []);
        }
      } catch (err) {
        console.error('Failed to load revision history:', err);
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    };
    fetchHistory();
    return () => {
      cancelled = true;
    };
  }, [item.item_id, item.evaluation_id, token]);

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: token ? `Bearer ${token}` : '',
  };

  const buildDraftBody = () => {
    const body: Record<string, unknown> = {
      itemId: item.item_id,
      departmentId: item.department_id,
      evidenceNote: note,
    };
    if (mode === 'score') body.score = score;
    else if (mode === 'notEvaluated') body.notEvaluated = true;
    else {
      body.notApplicable = true;
      body.naReason = naReason;
    }
    // B9-C: an existing draft requires the caller's version.
    if (pairVersion !== null) body.version = pairVersion;
    return body;
  };

  /** Surfaces a 409-with-diff as the mine-vs-theirs box; returns true when handled. */
  const handleConflictResponse = (data: any): boolean => {
    if (data && (data.code === 'version.conflict' || data.code === 'version.required') && data.conflict) {
      setConflict(data.conflict as VersionConflictPayload);
      return true;
    }
    return false;
  };

  const saveDraft = async (): Promise<boolean> => {
    setSaving(true);
    setFormMsg(null);
    setConflict(null);
    try {
      const res = await fetch('/api/evaluations', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(buildDraftBody()),
      });
      const data = await res.json();
      if (!res.ok) {
        if (handleConflictResponse(data)) return false;
        throw new Error(data.error || 'Failed to save draft');
      }
      setFormMsg({ kind: 'ok', text: t.common.success });
      onChanged();
      return true;
    } catch (err: any) {
      setFormMsg({ kind: 'err', text: err.message });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const submitForApproval = async () => {
    setSubmitting(true);
    setFormMsg(null);
    setConflict(null);
    try {
      // Persist the current form as a draft first (idempotent for draft/returned),
      // then submit. Submitted rows are never edited here — corrections use A5.
      const saved = await saveDraft();
      if (!saved) return;
      const queueRes = await fetch('/api/queue', { headers: { Authorization: token ? `Bearer ${token}` : '' } });
      const queueData = queueRes.ok ? await queueRes.json() : { items: [] };
      const fresh = (queueData.items || []).find(
        (q: QueueItem) => q.item_id === item.item_id && q.department_id === item.department_id
      );
      const evalId: string | null = fresh?.evaluation_id || item.evaluation_id;
      if (!evalId) throw new Error('Draft was not created.');
      const freshVersion = fresh?.evaluation_version ?? fresh?.answer_version ?? pairVersion;
      const res = await fetch(`/api/evaluations/${evalId}/submit`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(freshVersion !== null ? { version: freshVersion } : {}),
      });
      const data = await res.json();
      if (!res.ok) {
        if (handleConflictResponse(data)) return;
        throw new Error(data.error || 'Failed to submit');
      }
      setFormMsg({ kind: 'ok', text: t.common.success });
      onChanged();
    } catch (err: any) {
      setFormMsg({ kind: 'err', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const decide = async (decision: 'approve' | 'return') => {
    if (!item.evaluation_id) return;
    setDeciding(decision);
    setDecisionMsg(null);
    setConflict(null);
    try {
      const res = await fetch(`/api/evaluations/${item.evaluation_id}/${decision}`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ comment, ...(pairVersion !== null ? { version: pairVersion } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data && data.conflict) setConflict(data.conflict as VersionConflictPayload);
        throw new Error(data.error || 'Decision failed');
      }
      setDecisionMsg({ kind: 'ok', text: decision === 'approve' ? t.gapAnalysis.decidedApproved : t.gapAnalysis.decidedReturned });
      setComment('');
      onChanged();
    } catch (err: any) {
      setDecisionMsg({ kind: 'err', text: err.message });
    } finally {
      setDeciding(null);
    }
  };

  const applyCorrection = async () => {
    if (!item.evaluation_id) return;
    setCorrecting(true);
    setCorrectMsg(null);
    setConflict(null);
    try {
      const body: Record<string, unknown> = { reason: correctReason };
      if (mode === 'score') body.newScore = score;
      else if (mode === 'notEvaluated') body.notEvaluated = true;
      else {
        body.notApplicable = true;
        body.naReason = naReason;
      }
      // B9-C: corrections require the caller's version.
      if (pairVersion !== null) body.version = pairVersion;
      const res = await fetch(`/api/evaluations/${item.evaluation_id}/correct`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        if (handleConflictResponse(data)) return;
        throw new Error(data.error || 'Correction failed');
      }
      setCorrectMsg({ kind: 'ok', text: t.common.success });
      setCorrectReason('');
      onChanged();
    } catch (err: any) {
      setCorrectMsg({ kind: 'err', text: err.message });
    } finally {
      setCorrecting(false);
    }
  };

  const reloadAndRetry = () => {
    setConflict(null);
    onChanged();
  };

  const isAdmin = user?.role === 'client_admin' || user?.role === 'ge_admin';
  const isSubmitted = item.answer_status === 'submitted';
  const isClientApproved = item.answer_status === 'client_approved';
  const isDecided = item.answer_status === 'approved' || isClientApproved || item.answer_status === 'returned';
  const isPostSubmit = isSubmitted || item.answer_status === 'approved' || isClientApproved;
  const isOwn = !!user && (user.id === item.evaluator_id || user.id === item.answer_submitted_by);
  const showApproval = isAdmin && isSubmitted && !isOwn;
  const showSelfNote = isAdmin && isSubmitted && isOwn;

  const naReasonKeys = ['not-applicable', 'legal-prohibitions', 'confidentiality-constraints', 'information-unavailable-incomplete'];

  return (
    <div className="space-y-4">
      {/* Item header */}
      <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-xs">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
              {item.standard_code} · {item.disclosure_code} · {item.code}
            </div>
            <h4 className="text-sm font-bold text-slate-900 dark:text-white mt-1">{item.disclosure_title}</h4>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">{item.requirement}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-3 text-[11px]">
          <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold">
            {t.gapAnalysis.priority}: {item.priority} (×{item.weight})
          </span>
          <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold">
            {t.gapAnalysis.pillar}: {item.pillar}
          </span>
          {item.topic && (
            <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold">
              {t.gapAnalysis.topic}: {item.topic}
            </span>
          )}
          <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold">
            {t.gapAnalysis.department}: {item.department_name}
          </span>
          {item.evaluation_id && (
            <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200 font-bold">
              {outcomeLabel(item, t)}
            </span>
          )}
        </div>
      </div>

      {/* Evaluate form */}
      <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-xs">
        <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-1">{t.gapAnalysis.evaluateTitle}</h4>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-4">{t.gapAnalysis.scoreLabel}</p>

        <div className="space-y-2">
          {[
            { value: 0, label: t.gapAnalysis.score0, desc: t.gapAnalysis.score0Desc },
            { value: 50, label: t.gapAnalysis.score50, desc: t.gapAnalysis.score50Desc },
            { value: 100, label: t.gapAnalysis.score100, desc: t.gapAnalysis.score100Desc },
          ].map((opt) => (
            <label
              key={opt.value}
              className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                mode === 'score' && score === opt.value
                  ? 'border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/30'
                  : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-750'
              }`}
            >
              <input
                type="radio"
                name={`eval-mode-${item.item_id}`}
                checked={mode === 'score' && score === opt.value}
                onChange={() => {
                  setMode('score');
                  setScore(opt.value);
                }}
                className="mt-1 accent-emerald-600"
              />
              <span>
                <span className="block text-xs font-bold text-slate-900 dark:text-white">{opt.label}</span>
                <span className="block text-[11px] text-slate-500 dark:text-slate-400">{opt.desc}</span>
              </span>
            </label>
          ))}

          <label
            className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
              mode === 'notEvaluated'
                ? 'border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/30'
                : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-750'
            }`}
          >
            <input
              type="radio"
              name={`eval-mode-${item.item_id}`}
              checked={mode === 'notEvaluated'}
              onChange={() => setMode('notEvaluated')}
              className="mt-1 accent-emerald-600"
            />
            <span>
              <span className="block text-xs font-bold text-slate-900 dark:text-white">{t.gapAnalysis.notEvalLabel}</span>
              <span className="block text-[11px] text-slate-500 dark:text-slate-400">{t.gapAnalysis.notEvalDesc}</span>
            </span>
          </label>

          <div
            className={`p-3 rounded-xl border transition-colors ${
              mode === 'notApplicable'
                ? 'border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/30'
                : 'border-slate-200 dark:border-slate-700'
            }`}
          >
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="radio"
                name={`eval-mode-${item.item_id}`}
                checked={mode === 'notApplicable'}
                onChange={() => setMode('notApplicable')}
                className="mt-1 accent-emerald-600"
              />
              <span>
                <span className="block text-xs font-bold text-slate-900 dark:text-white">{t.gapAnalysis.naLabel}</span>
                <span className="block text-[11px] text-slate-500 dark:text-slate-400">{t.gapAnalysis.naDesc}</span>
              </span>
            </label>
            {mode === 'notApplicable' && (
              <div className="mt-3 ms-6">
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                  {t.gapAnalysis.naReasonLabel}
                </label>
                <select
                  value={naReason}
                  onChange={(e) => setNaReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white"
                >
                  {naReasonKeys.map((k) => (
                    <option key={k} value={k}>
                      {t.gapAnalysis.naReasonOptions[k] || k}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
            {t.gapAnalysis.evidenceNoteLabel}
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t.gapAnalysis.evidenceNotePh}
            rows={3}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white placeholder:text-slate-400"
          />
        </div>

        {formMsg && (
          <div
            className={`mt-3 p-2.5 rounded-lg text-xs flex items-center gap-2 ${
              formMsg.kind === 'ok'
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200'
                : 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200'
            }`}
          >
            {formMsg.kind === 'err' && <AlertTriangle className="w-4 h-4 shrink-0" />}
            <span>{formMsg.text}</span>
          </div>
        )}

        {!isPostSubmit && !isDecided && (
          <div className="flex flex-wrap gap-2 mt-4">
            <button
              onClick={saveDraft}
              disabled={saving || submitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? t.gapAnalysis.saving : t.gapAnalysis.saveDraft}</span>
            </button>
            <button
              onClick={submitForApproval}
              disabled={saving || submitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{submitting ? t.gapAnalysis.submitting : t.gapAnalysis.submitEval}</span>
            </button>
          </div>
        )}
      </div>

      {/* Post-submit correction (appended revision only) */}
      {isPostSubmit && (
        <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-amber-200 dark:border-amber-800/60 shadow-xs">
          <div className="flex items-center gap-2 mb-1">
            <PencilLine className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <h4 className="text-sm font-bold text-slate-900 dark:text-white">{t.gapAnalysis.correctionTitle}</h4>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3">{t.gapAnalysis.correctionDesc}</p>
          <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
            {t.gapAnalysis.correctionReasonLabel}
          </label>
          <textarea
            value={correctReason}
            onChange={(e) => setCorrectReason(e.target.value)}
            placeholder={t.gapAnalysis.correctionReasonPh}
            rows={2}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white placeholder:text-slate-400"
          />
          {correctMsg && (
            <div
              className={`mt-2 p-2.5 rounded-lg text-xs flex items-center gap-2 ${
                correctMsg.kind === 'ok'
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200'
                  : 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200'
              }`}
            >
              {correctMsg.kind === 'err' && <AlertTriangle className="w-4 h-4 shrink-0" />}
              <span>{correctMsg.text}</span>
            </div>
          )}
          <button
            onClick={applyCorrection}
            disabled={correcting || !correctReason.trim()}
            className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-600 text-white text-xs font-bold hover:bg-amber-700 disabled:opacity-50 transition-colors"
          >
            <PencilLine className="w-3.5 h-3.5" />
            <span>{t.gapAnalysis.applyCorrection}</span>
          </button>
        </div>
      )}

      {/* Approval panel (admins only; never offered for own evaluations) */}
      {showSelfNote && (
        <div className="p-4 rounded-xl bg-slate-100 dark:bg-slate-750 border border-slate-200 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-300">
          {t.gapAnalysis.selfApprovalNote}
        </div>
      )}
      {showApproval && (
        <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-indigo-200 dark:border-indigo-800/60 shadow-xs">
          <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-1">{t.gapAnalysis.approvalTitle}</h4>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3">{t.gapAnalysis.approvalDesc}</p>
          <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
            {t.gapAnalysis.commentLabel}
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t.gapAnalysis.commentPh}
            rows={2}
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white placeholder:text-slate-400"
          />
          {decisionMsg && (
            <div
              className={`mt-2 p-2.5 rounded-lg text-xs flex items-center gap-2 ${
                decisionMsg.kind === 'ok'
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200'
                  : 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200'
              }`}
            >
              {decisionMsg.kind === 'err' && <AlertTriangle className="w-4 h-4 shrink-0" />}
              <span>{decisionMsg.text}</span>
            </div>
          )}
          <div className="flex flex-wrap gap-2 mt-3">
            <button
              onClick={() => decide('approve')}
              disabled={deciding !== null}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{t.gapAnalysis.approveBtn}</span>
            </button>
            <button
              onClick={() => decide('return')}
              disabled={deciding !== null}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-rose-300 dark:border-rose-700 text-rose-700 dark:text-rose-300 text-xs font-bold hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50 transition-colors"
            >
              <Undo2 className="w-3.5 h-3.5" />
              <span>{t.gapAnalysis.returnBtn}</span>
            </button>
          </div>
        </div>
      )}
      {isDecided && (
        <div className="p-4 rounded-xl bg-slate-100 dark:bg-slate-750 border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
          {isClientApproved
            ? t.gapAnalysis.stClientApproved
            : item.answer_status === 'approved'
              ? t.gapAnalysis.decidedApproved
              : t.gapAnalysis.decidedReturned}
        </div>
      )}

      {/* B9-C: mine-vs-theirs conflict surface */}
      {conflict && <ConflictBox conflict={conflict} t={t} onReload={reloadAndRetry} />}

      {/* B9-D: evidence attachments (per answer) */}
      {item.answer_id && <AttachmentsSection answerId={item.answer_id} token={token} t={t} />}

      {/* Revision history */}
      <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-xs">
        <div className="flex items-center gap-2 mb-3">
          <History className="w-4 h-4 text-slate-500" />
          <h4 className="text-sm font-bold text-slate-900 dark:text-white">{t.gapAnalysis.historyTitle}</h4>
        </div>
        {historyLoading && <p className="text-[11px] text-slate-500">{t.common.loading}</p>}
        {!historyLoading && (!history || history.length === 0) && (
          <p className="text-[11px] text-slate-500 dark:text-slate-400">{t.gapAnalysis.historyEmpty}</p>
        )}
        {!historyLoading && history && history.length > 0 && (
          <ol className="space-y-3">
            {history.map((h) => (
              <li key={h.id} className="text-[11px] border-s-2 border-slate-200 dark:border-slate-700 ps-3">
                <div className="font-bold text-slate-800 dark:text-slate-200">{h.action}</div>
                {h.payload?.before && h.payload?.after && (
                  <div className="mt-1 font-mono text-slate-600 dark:text-slate-300" dir="ltr">
                    {JSON.stringify(h.payload.before)} → {JSON.stringify(h.payload.after)}
                  </div>
                )}
                {h.payload?.comment && (
                  <div className="mt-1 text-slate-600 dark:text-slate-300">{h.payload.comment}</div>
                )}
                {h.payload?.reason && (
                  <div className="mt-1 text-slate-600 dark:text-slate-300">{h.payload.reason}</div>
                )}
                <div className="mt-1 text-slate-400">
                  {h.actor_name || h.user_id} · {new Date(h.created_at).toLocaleString()}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
};
