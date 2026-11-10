import React, { useEffect, useState } from 'react';
import {
  Save,
  Send,
  CheckCircle2,
  Undo2,
  History,
  AlertTriangle,
  PencilLine,
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
  score: number | null;
  not_evaluated: boolean | null;
  not_applicable: boolean | null;
  na_reason: string | null;
  justification: string | null;
  evaluator_id: string | null;
  previous_score: number | null;
  answer_id: string | null;
  answer_status: string | null;
  answer_submitted_by: string | null;
  status: string;
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

  // Reset local form whenever a different queue item is selected.
  useEffect(() => {
    setMode(initialMode);
    setScore(typeof item.score === 'number' ? item.score : 100);
    setNaReason(item.na_reason || 'not-applicable');
    setNote(item.justification || '');
    setFormMsg(null);
    setDecisionMsg(null);
    setCorrectMsg(null);
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
    return body;
  };

  const saveDraft = async (): Promise<boolean> => {
    setSaving(true);
    setFormMsg(null);
    try {
      const res = await fetch('/api/evaluations', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(buildDraftBody()),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save draft');
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
      const res = await fetch(`/api/evaluations/${evalId}/submit`, { method: 'POST', headers: authHeaders });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit');
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
    try {
      const res = await fetch(`/api/evaluations/${item.evaluation_id}/${decision}`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ comment }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Decision failed');
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
    try {
      const body: Record<string, unknown> = { reason: correctReason };
      if (mode === 'score') body.newScore = score;
      else if (mode === 'notEvaluated') body.notEvaluated = true;
      else {
        body.notApplicable = true;
        body.naReason = naReason;
      }
      const res = await fetch(`/api/evaluations/${item.evaluation_id}/correct`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Correction failed');
      setCorrectMsg({ kind: 'ok', text: t.common.success });
      setCorrectReason('');
      onChanged();
    } catch (err: any) {
      setCorrectMsg({ kind: 'err', text: err.message });
    } finally {
      setCorrecting(false);
    }
  };

  const isAdmin = user?.role === 'client_admin' || user?.role === 'ge_admin';
  const isSubmitted = item.answer_status === 'submitted';
  const isDecided = item.answer_status === 'approved' || item.answer_status === 'returned';
  const isPostSubmit = isSubmitted || item.answer_status === 'approved';
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
          {item.answer_status === 'approved' ? t.gapAnalysis.decidedApproved : t.gapAnalysis.decidedReturned}
        </div>
      )}

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
