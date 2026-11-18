import React, { useMemo, useState } from 'react';
import { EyeOff, RefreshCw, ShieldCheck } from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext.tsx';
import { apiFetch } from '../../lib/api.ts';
import { friendlyError, isFrozenRefusal } from '../../views/ServicesView.tsx';
import {
  MASK_FIELDS,
  NEW_MASK_FIELDS,
  consultantJsonHeaders,
  readMask,
  type ConsultantLinkedService,
} from './consultantConsole.ts';

interface ConsultantMasksTabProps {
  token: string | null;
  linked: ConsultantLinkedService[];
  frozen: boolean;
  suspended: boolean;
  onChanged: () => void;
  onFrozen: () => void;
  notify: (kind: 'ok' | 'err', text: string) => void;
}

/**
 * TASK-PROTO-U4-3 unit (c2) — client-visible columns (existing visibility
 * route, G6 vocabulary incl. documents/initiatives/na_status, visible-by-
 * default per DG-D2). Writes ONLY PATCH
 * /api/workspace/services/:serviceId/visibility with exactly
 * `{clientFieldMask}` (single-column guard; unknown keys refused 400).
 * Fail-closed note is shown, never invented math. No secret/OTP/password
 * surface exists anywhere in this tab.
 */
export const ConsultantMasksTab: React.FC<ConsultantMasksTabProps> = ({
  token,
  linked,
  frozen,
  suspended,
  onChanged,
  onFrozen,
  notify,
}) => {
  const { t, lang } = useLanguage();
  const s = t.consultantConsole;

  const [openId, setOpenId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [saving, setSaving] = useState<string | null>(null);

  React.useEffect(() => {
    setDrafts((prev) => {
      const next: Record<string, string[]> = { ...prev };
      for (const svc of linked) {
        if (!(svc.id in next)) next[svc.id] = readMask(svc.clientFieldMask);
      }
      return next;
    });
    setOpenId((prev) => prev ?? linked[0]?.id ?? null);
  }, [linked]);

  const maskLabel: Record<string, { ar: string; en: string }> = useMemo(() => ({
    hint: { ar: 'التلميح', en: 'Hint' },
    priority: { ar: 'الأولوية', en: 'Priority' },
    weight: { ar: 'الوزن', en: 'Weight' },
    esg_class: { ar: 'الفئة', en: 'ESG class' },
    reference: { ar: 'المرجع', en: 'Reference' },
    topic: { ar: 'الموضوع', en: 'Topic' },
    objective: { ar: 'الهدف', en: 'Objective' },
    sort_order: { ar: 'الترتيب', en: 'Sort order' },
    documents: { ar: 'المستندات', en: 'Documents' },
    initiatives: { ar: 'المبادرات', en: 'Initiatives' },
    na_status: { ar: 'حالة N/A', en: 'N/A status' },
  }), []);

  const locked = frozen || suspended;

  const toggle = (serviceId: string, field: string) => {
    setDrafts((prev) => {
      const current = prev[serviceId] ?? [];
      return {
        ...prev,
        [serviceId]: current.includes(field)
          ? current.filter((entry) => entry !== field)
          : [...current, field],
      };
    });
  };

  const handleSave = async (serviceId: string) => {
    if (locked) {
      notify('err', frozen ? s.frozenBanner : s.suspendedBanner);
      return;
    }
    setSaving(serviceId);
    try {
      const res = await apiFetch(`/api/workspace/services/${encodeURIComponent(serviceId)}/visibility`, {
        method: 'PATCH',
        headers: consultantJsonHeaders(token),
        body: JSON.stringify({ clientFieldMask: drafts[serviceId] ?? [] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (isFrozenRefusal(data)) onFrozen();
        throw new Error((data as { error?: string }).error || s.actionFailed);
      }
      notify('ok', s.masksSaved);
      onChanged();
    } catch (err) {
      notify('err', friendlyError(err, s.actionFailed));
    } finally {
      setSaving(null);
    }
  };

  if (linked.length === 0) {
    return <p className="text-[11px] text-muted p-4 text-center bg-surface-2 border border-border rounded-2xl">{s.svcLinkedEmpty}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="bg-surface-2 border border-border rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-1">
          <EyeOff className="w-4 h-4 text-muted" />
          <h4 className="text-sm font-bold text-text">{s.masksTitle}</h4>
        </div>
        <p className="text-[11px] text-muted leading-relaxed">{s.masksHint}</p>
        <p className="text-[11px] text-muted leading-relaxed mt-1">{s.masksDefaultVisible}</p>
        <p className="text-[11px] text-muted leading-relaxed mt-1 flex items-start gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{s.masksFailClosed}</span>
        </p>
      </div>

      <ul className="space-y-3">
        {linked.map((svc) => {
          const draft = drafts[svc.id] ?? [];
          return (
            <li key={svc.id} className="bg-surface-2 border border-border rounded-2xl p-4">
              <button
                type="button"
                onClick={() => setOpenId((prev) => (prev === svc.id ? null : svc.id))}
                aria-expanded={openId === svc.id}
                className="w-full flex items-center justify-between gap-2"
              >
                <span className="text-start min-w-0">
                  <span className="block text-xs font-bold text-text truncate" dir="auto">{svc.name}</span>
                  <span className="block text-[10px] text-muted" dir="ltr">
                    {svc.code} · {draft.length} / {MASK_FIELDS.length}
                  </span>
                </span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${draft.length === 0 ? 'bg-success-soft text-success-text' : 'bg-warning-soft text-warning-text'}`} dir="ltr">
                  {draft.length}
                </span>
              </button>
              {openId === svc.id && (
                <div className="mt-3 pt-3 border-t border-border space-y-2">
                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {MASK_FIELDS.map((field) => (
                      <li key={field}>
                        <label className="flex items-center gap-2 p-2 rounded-lg border border-border cursor-pointer hover:bg-surface-3">
                          <input
                            type="checkbox"
                            checked={draft.includes(field)}
                            disabled={locked}
                            onChange={() => toggle(svc.id, field)}
                            className="w-4 h-4 accent-brand"
                          />
                          <span className="text-[11px] font-semibold text-text" dir="auto">
                            {maskLabel[field]?.[lang] ?? field}
                          </span>
                          <span className="text-[10px] text-muted font-mono" dir="ltr">{field}</span>
                          {NEW_MASK_FIELDS.includes(field) && (
                            <span className="ms-auto px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-info-soft text-info shrink-0">
                              {s.masksNewBadge}
                            </span>
                          )}
                        </label>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    disabled={saving !== null || locked}
                    onClick={() => void handleSave(svc.id)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand text-brand-ink text-xs font-bold disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${saving === svc.id ? 'animate-spin' : ''}`} />
                    <span>{saving === svc.id ? s.masksSaving : s.masksSave}</span>
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};
