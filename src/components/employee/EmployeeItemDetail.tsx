import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  History,
  Paperclip,
  PencilLine,
  RefreshCw,
  Save,
  Send,
  Trash2,
} from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext.tsx';
import { useAuth } from '../../context/AuthContext.tsx';
import { apiFetch } from '../../lib/api.ts';
import { friendlyError, isFrozenRefusal } from '../../views/ServicesView.tsx';
import type { QueueItem } from '../../views/EvaluationPanel.tsx';
import type { ItemHistory } from '../services/ServiceContentPanel.tsx';
import { submitBlockReason, type ItemMeta } from './employeeWorkspace.ts';

interface DetailAnswer {
  id: string;
  status: string;
  value: string | null;
  version: number | null;
  submitted_by: string | null;
  updated_at: string | null;
}

interface DetailEvaluation {
  id: string;
  evaluator_id: string | null;
  version: number | null;
}

interface HistoryEntry {
  id: string;
  action: string;
  actor_name: string | null;
  user_id: string | null;
  payload: { before?: unknown; after?: unknown; reason?: string; comment?: string | null } | null;
  created_at: string;
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

interface EmployeeItemDetailProps {
  item: QueueItem;
  meta: ItemMeta | null;
  onChanged: () => void;
  onFrozen: () => void;
  onDirtyChange: (key: string, dirty: boolean) => void;
  notify: (kind: 'ok' | 'err', text: string) => void;
}

type EvalMode = 'score' | 'notEvaluated' | 'notApplicable';

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const NA_REASON_KEYS = ['not-applicable', 'legal-prohibitions', 'confidentiality-constraints', 'information-unavailable-incomplete'];
const SUBMITTED_STATES = new Set(['submitted', 'approved', 'client_approved']);

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

export const EmployeeItemDetail: React.FC<EmployeeItemDetailProps> = ({
  item,
  meta,
  onChanged,
  onFrozen,
  onDirtyChange,
  notify,
}) => {
  const { t } = useLanguage();
  const { user, token } = useAuth();
  const s = t.employeeServices;

  const [detail, setDetail] = useState<{ evaluation: DetailEvaluation | null; answers: DetailAnswer[]; history: HistoryEntry[] } | null>(null);
  const [itemHistory, setItemHistory] = useState<ItemHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [value, setValue] = useState('');
  const [mode, setMode] = useState<EvalMode>('score');
  const [score, setScore] = useState(100);
  const [naReason, setNaReason] = useState('not-applicable');
  const [baseline, setBaseline] = useState('');
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formMsg, setFormMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [conflict, setConflict] = useState(false);

  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [attLoading, setAttLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);

  const [correctReason, setCorrectReason] = useState('');
  const [correctOutcome, setCorrectOutcome] = useState('keep');
  const [correctNaReason, setCorrectNaReason] = useState('not-applicable');
  const [correcting, setCorrecting] = useState(false);
  const [correctMsg, setCorrectMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const answerType = meta?.answer_type ?? 'text';
  const attachmentRequired = meta?.attachment_required === true;
  const snapshot = (v: string, m: EvalMode, sc: number, na: string) => `${m}|${sc}|${na}|${v}`;

  const loadDetail = useCallback(async (): Promise<{ evaluation: DetailEvaluation | null; answers: DetailAnswer[] } | null> => {
    setLoading(true);
    setLoadError(null);
    try {
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const [evalRes, histRes] = await Promise.all([
        apiFetch(`/api/evaluations?itemId=${encodeURIComponent(item.item_id)}`, { headers }),
        apiFetch(`/api/items/${encodeURIComponent(item.item_id)}/history`, { headers }),
      ]);
      if (!evalRes.ok) {
        const data = await evalRes.json().catch(() => ({}));
        if (isFrozenRefusal(data)) onFrozen();
        throw new Error((data as { error?: string }).error || s.detailLoadFailed);
      }
      const data = await evalRes.json();
      const answers: DetailAnswer[] = Array.isArray(data.answers) ? data.answers : [];
      setDetail({ evaluation: data.evaluation ?? null, answers, history: Array.isArray(data.history) ? data.history : [] });
      if (histRes.ok) setItemHistory(await histRes.json());
      const current = typeof answers[0]?.value === 'string' ? (answers[0].value as string) : '';
      setValue(current);
      setBaseline(snapshot(current, 'score', 100, 'not-applicable'));
      setMode('score');
      setScore(100);
      setNaReason('not-applicable');
      return { evaluation: data.evaluation ?? null, answers };
    } catch (err) {
      setLoadError(friendlyError(err, s.detailLoadFailed));
      return null;
    } finally {
      setLoading(false);
    }
  }, [item.item_id, token, onFrozen, s.detailLoadFailed]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  const answer = detail?.answers[0] ?? null;
  const answerId = answer?.id ?? item.answer_id;
  const answerStatus = answer?.status ?? item.answer_status;
  const isPostSubmit = answerStatus ? SUBMITTED_STATES.has(answerStatus) : false;
  const isDecided = isPostSubmit || answerStatus === 'returned';
  const canEdit = !isPostSubmit && !isDecided;
  const isDraft = !answerStatus || answerStatus === 'draft' || answerStatus === 'returned';
  const isAuthor = !!user && !!detail?.evaluation && user.id === detail.evaluation.evaluator_id;
  const canCorrect = isPostSubmit && (isAuthor || user?.role === 'ge_admin');

  const dirty = canEdit && snapshot(value, mode, score, naReason) !== baseline && baseline !== '';
  useEffect(() => {
    onDirtyChange('item', dirty);
    return () => onDirtyChange('item', false);
  }, [dirty, onDirtyChange]);

  const fetchAttachments = useCallback(async (id: string) => {
    setAttLoading(true);
    try {
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await apiFetch(`/api/answers/${encodeURIComponent(id)}/attachments`, { headers });
      if (res.ok) {
        const data = await res.json();
        setAttachments(Array.isArray(data.items) ? data.items : []);
      }
    } catch {
      /* read-only enrichment: the editor stays usable without the list */
    } finally {
      setAttLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (answerId) void fetchAttachments(answerId);
    else setAttachments([]);
  }, [answerId, fetchAttachments]);

  const authHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const buildDraftBody = (pairVersion: number | null) => {
    const body: Record<string, unknown> = { itemId: item.item_id, evidenceNote: answerType === 'file' ? '' : value };
    if (mode === 'score') body.score = score;
    else if (mode === 'notEvaluated') body.notEvaluated = true;
    else {
      body.notApplicable = true;
      body.naReason = naReason;
    }
    if (pairVersion !== null) body.version = pairVersion;
    return body;
  };

  const saveDraft = async (): Promise<boolean> => {
    setSaving(true);
    setFormMsg(null);
    setConflict(false);
    try {
      const pairVersion = detail?.evaluation?.version ?? answer?.version ?? null;
      const res = await apiFetch('/api/evaluations', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(buildDraftBody(pairVersion)),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (isFrozenRefusal(data)) onFrozen();
        if ((data as { code?: string }).code === 'version.conflict') setConflict(true);
        throw new Error((data as { error?: string }).error || s.actionFailed);
      }
      setBaseline(snapshot(answerType === 'file' ? '' : value, mode, score, naReason));
      notify('ok', t.common.success);
      await loadDetail();
      if (answerId) await fetchAttachments(answerId);
      onChanged();
      return true;
    } catch (err) {
      const message = friendlyError(err, s.actionFailed);
      setFormMsg({ kind: 'err', text: message });
      notify('err', message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const submitForApproval = async () => {
    setSubmitting(true);
    setFormMsg(null);
    try {
      const saved = await saveDraft();
      if (!saved) return;
      const fresh = await loadDetail();
      const evalId = fresh?.evaluation?.id;
      if (!evalId) throw new Error(s.actionFailed);
      const freshAnswer = fresh?.answers[0] ?? null;
      const freshVersion = fresh?.evaluation?.version ?? freshAnswer?.version ?? null;
      const res = await apiFetch(`/api/evaluations/${encodeURIComponent(evalId)}/submit`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(freshVersion !== null ? { version: freshVersion } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (isFrozenRefusal(data)) onFrozen();
        if ((data as { code?: string }).code === 'version.conflict') setConflict(true);
        throw new Error((data as { error?: string }).error || s.actionFailed);
      }
      notify('ok', t.common.success);
      await loadDetail();
      onChanged();
    } catch (err) {
      const message = friendlyError(err, s.actionFailed);
      setFormMsg({ kind: 'err', text: message });
      notify('err', message);
    } finally {
      setSubmitting(false);
    }
  };

  const applyCorrection = async () => {
    const evalId = detail?.evaluation?.id;
    if (!evalId) return;
    setCorrecting(true);
    setCorrectMsg(null);
    try {
      const body: Record<string, unknown> = { reason: correctReason.trim() };
      if (correctOutcome === 'notEvaluated') body.notEvaluated = true;
      else if (correctOutcome === 'notApplicable') {
        body.notApplicable = true;
        body.naReason = correctNaReason;
      } else if (correctOutcome !== 'keep') body.newScore = Number(correctOutcome);
      else body.newScore = item.score ?? 100;
      const pairVersion = detail?.evaluation?.version ?? answer?.version ?? null;
      if (pairVersion !== null) body.version = pairVersion;
      const res = await apiFetch(`/api/evaluations/${encodeURIComponent(evalId)}/correct`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (isFrozenRefusal(data)) onFrozen();
        throw new Error((data as { error?: string }).error || s.actionFailed);
      }
      setCorrectMsg({ kind: 'ok', text: t.common.success });
      notify('ok', t.common.success);
      setCorrectReason('');
      await loadDetail();
      onChanged();
    } catch (err) {
      const message = friendlyError(err, s.actionFailed);
      setCorrectMsg({ kind: 'err', text: message });
      notify('err', message);
    } finally {
      setCorrecting(false);
    }
  };

  const doUpload = async () => {
    if (!answerId || !pendingFile) return;
    if (pendingFile.size > MAX_ATTACHMENT_BYTES) {
      notify('err', t.attachments.oversize);
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', pendingFile);
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await apiFetch(`/api/answers/${encodeURIComponent(answerId)}/attachments`, {
        method: 'POST',
        headers,
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (isFrozenRefusal(data)) onFrozen();
        const code = (data as { code?: string }).code;
        const message = code === 'attachments.oversize' ? t.attachments.oversize
          : code === 'attachments.mime' ? t.attachments.mime
          : (data as { error?: string }).error || t.attachments.uploadFailed;
        throw new Error(message);
      }
      notify('ok', t.common.success);
      setPendingFile(null);
      setInputKey((k) => k + 1);
      await fetchAttachments(answerId);
      onChanged();
    } catch (err) {
      notify('err', friendlyError(err, t.attachments.uploadFailed));
    } finally {
      setUploading(false);
    }
  };

  const doDownload = async (file: AttachmentRow) => {
    if (!answerId) return;
    try {
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await apiFetch(
        `/api/answers/${encodeURIComponent(answerId)}/attachments/${encodeURIComponent(file.id)}/download`,
        { headers },
      );
      if (!res.ok) throw new Error(t.attachments.uploadFailed);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.file_name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      notify('err', friendlyError(err, t.attachments.uploadFailed));
    }
  };

  const doDelete = async (file: AttachmentRow) => {
    if (!answerId) return;
    if (!window.confirm(t.attachments.deleteConfirm)) return;
    try {
      const res = await apiFetch(`/api/answers/${encodeURIComponent(answerId)}/attachments/${encodeURIComponent(file.id)}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (isFrozenRefusal(data)) onFrozen();
        throw new Error((data as { error?: string }).error || t.attachments.uploadFailed);
      }
      await fetchAttachments(answerId);
      onChanged();
    } catch (err) {
      notify('err', friendlyError(err, t.attachments.uploadFailed));
    }
  };

  const provided = answerType === 'file' ? false : value.trim() !== '';
  const block = submitBlockReason({
    answerType,
    attachmentRequired,
    attachmentCount: attachments.length,
    notApplicable: mode === 'notApplicable',
    provided,
  });

  if (loading) {
    return (
      <div aria-hidden="true" className="p-4 space-y-2">
        <div className="h-16 rounded-xl bg-surface-3 animate-pulse" />
        <div className="h-32 rounded-xl bg-surface-3 animate-pulse" />
        <span className="sr-only">{t.common.loading}</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div role="alert" className="p-6 text-center space-y-3">
        <p className="text-sm font-bold text-text">{s.detailLoadFailed}</p>
        <p className="text-xs text-muted break-words">{loadError}</p>
        <button
          type="button"
          onClick={() => void loadDetail()}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-brand text-brand-ink hover:bg-brand-strong"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>{t.common.retry}</span>
        </button>
      </div>
    );
  }

  const renderTypedInput = () => {
    const fieldCls = 'w-full px-3 py-2 rounded-xl text-xs bg-surface-3 border border-border-strong text-text placeholder-muted focus:outline-none focus:ring-2 focus:ring-focus-ring/30 focus:border-focus-ring';
    if (answerType === 'file') {
      return <p className="text-[11px] text-muted leading-relaxed">{s.fileAnswerNote}</p>;
    }
    if (answerType === 'boolean') {
      return (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={s.answerSection}>
          {[
            { v: 'true', label: t.common.yes },
            { v: 'false', label: t.common.no },
          ].map((opt) => (
            <label
              key={opt.v}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-xs font-bold cursor-pointer transition-colors ${
                value === opt.v ? 'border-brand bg-brand-soft text-brand-text' : 'border-border text-muted hover:bg-surface-3'
              }`}
            >
              <input
                type="radio"
                name={`bool-${item.item_id}`}
                checked={value === opt.v}
                onChange={() => setValue(opt.v)}
                disabled={!canEdit}
                className="accent-brand"
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      );
    }
    if (answerType === 'number') {
      return (
        <input
          type="text"
          inputMode="decimal"
          dir="ltr"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={!canEdit}
          placeholder="0"
          className={fieldCls}
        />
      );
    }
    if (answerType === 'date') {
      return <input type="date" value={value} onChange={(e) => setValue(e.target.value)} disabled={!canEdit} className={fieldCls} />;
    }
    return (
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={3}
        disabled={!canEdit}
        className={fieldCls}
      />
    );
  };

  return (
    <div className="space-y-4">
      <div className="p-4 bg-surface-2 rounded-2xl border border-border shadow-xs">
        <div className="text-[11px] font-mono text-muted" dir="ltr">
          {item.standard_code} · {item.disclosure_code} · {item.code}
        </div>
        <h4 className="text-sm font-bold text-text mt-1">{item.disclosure_title}</h4>
        <p className="text-xs text-muted mt-1 leading-relaxed">{item.requirement}</p>
        <div className="flex flex-wrap gap-1.5 mt-3 text-[10px]">
          <span className="px-2 py-0.5 rounded-full bg-surface-3 text-muted font-semibold">
            {s.answerTypeLabel}: <bdi dir="ltr" className="font-bold">{answerType}</bdi>
          </span>
          {meta?.indicator_code && (
            <span className="px-2 py-0.5 rounded-full bg-surface-3 text-muted font-semibold">
              <bdi dir="ltr">{meta.indicator_code}</bdi>
            </span>
          )}
          {meta?.tags?.map((tag) => (
            <span key={tag} className="px-2 py-0.5 rounded-full bg-info-soft text-info font-semibold">{tag}</span>
          ))}
          {attachmentRequired && (
            <span className="px-2 py-0.5 rounded-full bg-warning-soft text-warning-text font-bold">
              {t.servicesWorkspace.attachmentRequired}
            </span>
          )}
        </div>
        {meta?.hint && <p className="text-[11px] text-muted mt-2 leading-relaxed">{meta.hint}</p>}
      </div>

      {canEdit && (
        <div className="p-4 bg-surface-2 rounded-2xl border border-border shadow-xs space-y-4">
          <div>
            <h4 className="text-sm font-bold text-text mb-2">{s.answerSection}</h4>
            {renderTypedInput()}
          </div>

          <div>
            <h4 className="text-sm font-bold text-text mb-2">{s.outcomeSection}</h4>
            <div className="space-y-2">
              {[
                { v: 0 as number, label: t.gapAnalysis.score0 },
                { v: 50 as number, label: t.gapAnalysis.score50 },
                { v: 100 as number, label: t.gapAnalysis.score100 },
              ].map((opt) => (
                <label
                  key={opt.v}
                  className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-xs cursor-pointer transition-colors ${
                    mode === 'score' && score === opt.v ? 'border-brand bg-brand-soft' : 'border-border hover:bg-surface-3'
                  }`}
                >
                  <input
                    type="radio"
                    name={`outcome-${item.item_id}`}
                    checked={mode === 'score' && score === opt.v}
                    onChange={() => {
                      setMode('score');
                      setScore(opt.v);
                    }}
                    className="accent-brand"
                  />
                  <span className="font-bold text-text">
                    {s.outcomeScore}: <bdi dir="ltr">{opt.v}</bdi> — {opt.label}
                  </span>
                </label>
              ))}
              <label
                className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-xs cursor-pointer transition-colors ${
                  mode === 'notEvaluated' ? 'border-focus-ring bg-brand-soft' : 'border-border hover:bg-surface-3'
                }`}
              >
                <input type="radio" name={`outcome-${item.item_id}`} checked={mode === 'notEvaluated'} onChange={() => setMode('notEvaluated')} className="accent-brand" />
                <span className="font-bold text-text">{s.outcomeNotEvaluated}</span>
              </label>
              <div className={`p-2.5 rounded-xl border transition-colors ${mode === 'notApplicable' ? 'border-focus-ring bg-brand-soft' : 'border-border'}`}>
                <label className="flex items-center gap-2.5 cursor-pointer text-xs">
                  <input type="radio" name={`outcome-${item.item_id}`} checked={mode === 'notApplicable'} onChange={() => setMode('notApplicable')} className="accent-brand" />
                  <span className="font-bold text-text">{s.outcomeNA}</span>
                </label>
                {mode === 'notApplicable' && (
                  <div className="mt-2 ms-6">
                    <label className="block text-[11px] font-semibold text-muted mb-1">{s.naReasonLabel}</label>
                    <select
                      value={naReason}
                      onChange={(e) => setNaReason(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-border-strong bg-surface-3 text-xs text-text"
                    >
                      {NA_REASON_KEYS.map((k) => (
                        <option key={k} value={k}>
                          {t.gapAnalysis.naReasonOptions[k] || k}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>
          </div>

          {block === 'attachment' && (
            <div role="alert" className="p-3 rounded-xl bg-warning-soft border border-warning text-[11px]">
              <div className="font-bold text-warning-text mb-0.5">{s.attachmentRequiredTitle}</div>
              <p className="text-warning-text">{s.attachmentRequiredDesc}</p>
              {mode === 'notApplicable' && <p className="text-warning-text mt-0.5">{s.attachmentRequiredNa}</p>}
            </div>
          )}

          {formMsg && (
            <div role={formMsg.kind === 'err' ? 'alert' : 'status'} className={`p-2.5 rounded-lg text-xs ${formMsg.kind === 'ok' ? 'bg-success-soft text-success-text' : 'bg-danger-soft text-danger'}`}>
              {formMsg.text}
            </div>
          )}
          {conflict && (
            <div role="alert" className="p-3 rounded-xl bg-warning-soft border border-warning text-[11px] text-warning-text">
              {s.versionConflict}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void saveDraft()}
              disabled={saving || submitting}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-border-strong text-text text-xs font-semibold hover:bg-surface-3 disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? s.saving : s.saveDraft}</span>
            </button>
            <button
              type="button"
              onClick={() => void submitForApproval()}
              disabled={saving || submitting || block !== null}
              title={block !== null ? s.attachmentRequiredTitle : undefined}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand text-brand-ink text-xs font-bold hover:bg-brand-strong disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{submitting ? s.submitting : s.submitAnswer}</span>
            </button>
          </div>
        </div>
      )}

      {!canEdit && (
        <div className="p-4 bg-surface-2 rounded-2xl border border-border shadow-xs">
          <h4 className="text-sm font-bold text-text mb-1">{s.answerSection}</h4>
          {answer?.value ? (
            <p className="text-xs text-text leading-relaxed break-words" dir="auto">{answer.value}</p>
          ) : (
            <p className="text-[11px] text-muted">{answerType === 'file' ? s.fileAnswerNote : s.noAnswerYet}</p>
          )}
          <p className="text-[11px] font-semibold text-muted mt-2">{answerStatus ?? '—'}</p>
        </div>
      )}

      <div className="p-4 bg-surface-2 rounded-2xl border border-border shadow-xs">
        <h4 className="text-sm font-bold text-text mb-1">{t.attachments.title}</h4>
        <p className="text-[11px] text-muted mb-3">{t.attachments.typesNote}</p>
        {!answerId ? (
          <p className="text-[11px] text-muted">{s.noAnswerYet}</p>
        ) : (
          <>
            {canEdit && (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  key={inputKey}
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg,.xlsx,.csv,.txt"
                  onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)}
                  className="text-[11px] text-text file:me-2 file:px-3 file:py-1.5 file:rounded-lg file:border file:border-border-strong file:bg-surface-3 file:text-[11px] file:font-semibold"
                />
                <button
                  type="button"
                  onClick={() => void doUpload()}
                  disabled={uploading || !pendingFile}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand text-brand-ink text-[11px] font-bold hover:opacity-90 disabled:opacity-50"
                >
                  <Paperclip className="w-3.5 h-3.5" />
                  <span>{uploading ? t.attachments.uploading : t.attachments.attachBtn}</span>
                </button>
              </div>
            )}
            {!isDraft && <p className="text-[11px] text-muted mt-2">{s.attachmentLockedNote}</p>}
            <div className="mt-3">
              {attLoading && <p className="text-[11px] text-muted">{t.common.loading}</p>}
              {!attLoading && attachments.length === 0 && <p className="text-[11px] text-muted">{t.attachments.emptyText}</p>}
              <ul className="space-y-2">
                {attachments.map((file) => (
                  <li key={file.id} className="flex items-center justify-between gap-2 p-2 rounded-lg border border-border text-[11px]">
                    <div className="min-w-0">
                      <div className="font-bold text-text truncate">{file.file_name}</div>
                      <div className="text-muted" dir="ltr">
                        {file.mime} · {fmtBytes(file.size_bytes)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => void doDownload(file)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border-strong text-text font-semibold hover:bg-surface-3"
                      >
                        <Download className="w-3 h-3" />
                        <span>{t.attachments.downloadBtn}</span>
                      </button>
                      {isDraft && (
                        <button
                          type="button"
                          onClick={() => void doDelete(file)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-danger text-danger font-semibold hover:bg-danger-soft"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>{t.attachments.deleteBtn}</span>
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>

      {canCorrect && (
        <div className="p-4 bg-surface-2 rounded-2xl border border-warning shadow-xs">
          <div className="flex items-center gap-2 mb-1">
            <PencilLine className="w-4 h-4 text-warning-text" />
            <h4 className="text-sm font-bold text-text">{t.gapAnalysis.correctionTitle}</h4>
          </div>
          <p className="text-[11px] text-muted mb-3">{t.gapAnalysis.correctionDesc}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
            <label className="block text-[11px] font-semibold text-muted">
              {s.outcomeSection}
              <select
                value={correctOutcome}
                onChange={(e) => setCorrectOutcome(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-border-strong bg-surface-3 text-xs text-text"
              >
                <option value="keep">{t.gapAnalysis.scoreLabel}: {item.score ?? '—'}</option>
                <option value="0">{s.outcomeScore}: 0</option>
                <option value="50">{s.outcomeScore}: 50</option>
                <option value="100">{s.outcomeScore}: 100</option>
                <option value="notEvaluated">{s.outcomeNotEvaluated}</option>
                <option value="notApplicable">{s.outcomeNA}</option>
              </select>
            </label>
            {correctOutcome === 'notApplicable' && (
              <label className="block text-[11px] font-semibold text-muted">
                {s.naReasonLabel}
                <select
                  value={correctNaReason}
                  onChange={(e) => setCorrectNaReason(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-border-strong bg-surface-3 text-xs text-text"
                >
                  {NA_REASON_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {t.gapAnalysis.naReasonOptions[k] || k}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <label className="block text-[11px] font-semibold text-muted mb-1">{t.gapAnalysis.correctionReasonLabel}</label>
          <textarea
            value={correctReason}
            onChange={(e) => setCorrectReason(e.target.value)}
            placeholder={t.gapAnalysis.correctionReasonPh}
            rows={2}
            className="w-full px-3 py-2 rounded-lg border border-border-strong bg-surface-3 text-xs text-text placeholder-muted"
          />
          {correctMsg && (
            <div role={correctMsg.kind === 'err' ? 'alert' : 'status'} className={`mt-2 p-2.5 rounded-lg text-xs ${correctMsg.kind === 'ok' ? 'bg-success-soft text-success-text' : 'bg-danger-soft text-danger'}`}>
              {correctMsg.text}
            </div>
          )}
          <button
            type="button"
            onClick={() => void applyCorrection()}
            disabled={correcting || !correctReason.trim()}
            className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand text-brand-ink text-xs font-bold hover:bg-brand-strong disabled:opacity-50"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>{t.gapAnalysis.applyCorrection}</span>
          </button>
        </div>
      )}

      <div className="p-4 bg-surface-2 rounded-2xl border border-border shadow-xs">
        <div className="flex items-center gap-2 mb-3">
          <History className="w-4 h-4 text-muted" />
          <h4 className="text-sm font-bold text-text">{t.gapAnalysis.historyTitle}</h4>
        </div>
        {(!detail || detail.history.length === 0) && (!itemHistory || itemHistory.versions.length === 0) ? (
          <p className="text-[11px] text-muted">{t.gapAnalysis.historyEmpty}</p>
        ) : (
          <ol className="space-y-2.5">
            {detail?.history.map((h) => (
              <li key={h.id} className="text-[11px] border-s-2 border-border ps-3">
                <div className="font-bold text-text">{h.action}</div>
                {h.payload?.comment && <div className="mt-0.5 text-muted">{h.payload.comment}</div>}
                {h.payload?.reason && <div className="mt-0.5 text-muted">{h.payload.reason}</div>}
                <div className="mt-0.5 text-muted">
                  {h.actor_name || h.user_id} · {new Date(h.created_at).toLocaleString()}
                </div>
              </li>
            ))}
            {itemHistory?.versions.map((v) => (
              <li key={`v${v.version}`} className="text-[11px] border-s-2 border-border ps-3">
                <div className="font-bold text-text" dir="ltr">
                  v{v.version} · {v.changedBy ?? '—'} · {new Date(v.changedAt).toLocaleString()}
                </div>
                {v.reason && <div className="mt-0.5 text-muted" dir="auto">{v.reason}</div>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
};
