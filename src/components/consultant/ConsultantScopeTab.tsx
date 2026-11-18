import React, { useMemo, useState } from 'react';
import { Ban, RefreshCw, Undo2 } from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext.tsx';
import { apiFetch } from '../../lib/api.ts';
import type { QueueItem } from '../../views/EvaluationPanel.tsx';
import { friendlyError, isFrozenRefusal } from '../../views/ServicesView.tsx';
import {
  NA_REASONS,
  consultantJsonHeaders,
  naStateRows,
  type ConsultantDept,
} from './consultantConsole.ts';

interface CatalogItem {
  id: string;
  code: string;
  requirement: string;
  disclosure_code?: string | null;
}

interface CatalogDisclosure {
  id: string;
  code: string;
  title: string;
}

interface ConsultantScopeTabProps {
  tenantId: string;
  token: string | null;
  queue: QueueItem[];
  items: CatalogItem[];
  disclosures: CatalogDisclosure[];
  departments: ConsultantDept[];
  frozen: boolean;
  suspended: boolean;
  onChanged: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onFrozen: () => void;
  notify: (kind: 'ok' | 'err', text: string) => void;
}

/**
 * TASK-PROTO-U4-3 unit (c2) — per-scope N/A (G2: disclosure OR item, reason
 * mandatory from the closed list, W-only set + lift).
 *
 * Writes ONLY the extended pre-existing routes POST /api/assignments/na
 * ({scope, itemId|disclosureId, departmentId, naReason, justification}) and
 * POST /api/assignments/na/lift ({scope, ref, departmentId?, reason}).
 * Attachment-required items refuse the shortcut (409 preserved + note); N/A
 * stays excluded from aggregates (note, no invented math). No C/E/P
 * affordances exist anywhere in this surface.
 */
export const ConsultantScopeTab: React.FC<ConsultantScopeTabProps> = ({
  tenantId,
  token,
  queue,
  items,
  disclosures,
  departments,
  frozen,
  suspended,
  onChanged,
  onDirtyChange,
  onFrozen,
  notify,
}) => {
  const { t } = useLanguage();
  const s = t.consultantConsole;

  const [scope, setScope] = useState<'item' | 'disclosure'>('item');
  const [itemId, setItemId] = useState('');
  const [disclosureId, setDisclosureId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [naReason, setNaReason] = useState('');
  const [justification, setJustification] = useState('');
  const [setting, setSetting] = useState(false);
  const [liftReason, setLiftReason] = useState('');
  const [lifting, setLifting] = useState(false);

  const locked = frozen || suspended;

  const touch = () => onDirtyChange(
    itemId !== '' || disclosureId !== '' || departmentId !== ''
    || naReason !== '' || justification.trim() !== '' || liftReason.trim() !== '',
  );

  const naRows = useMemo(() => naStateRows(queue), [queue]);

  const postNa = async (lift: boolean) => {
    if (locked) {
      notify('err', frozen ? s.frozenBanner : s.suspendedBanner);
      return;
    }
    const refId = scope === 'item' ? itemId : disclosureId;
    if (!refId || !departmentId) {
      notify('err', s.actionFailed);
      return;
    }
    if (lift ? !liftReason.trim() : !naReason) {
      notify('err', s.reasonRequired);
      return;
    }
    if (lift) setLifting(true);
    else setSetting(true);
    try {
      const body = lift
        ? {
          scope,
          ...(scope === 'item' ? { itemId: refId } : { disclosureId: refId }),
          departmentId, reason: liftReason.trim(), clientId: tenantId,
        }
        : {
          scope,
          ...(scope === 'item' ? { itemId: refId } : { disclosureId: refId }),
          departmentId, naReason, justification: justification.trim(), clientId: tenantId,
        };
      const res = await apiFetch(lift ? '/api/assignments/na/lift' : '/api/assignments/na', {
        method: 'POST',
        headers: consultantJsonHeaders(token),
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (isFrozenRefusal(data)) onFrozen();
        throw new Error((data as { error?: string }).error || s.actionFailed);
      }
      if (lift) setLiftReason('');
      else { setNaReason(''); setJustification(''); }
      onDirtyChange(false);
      notify('ok', lift ? s.liftDone : s.naDone);
      onChanged();
    } catch (err) {
      notify('err', friendlyError(err, s.actionFailed));
    } finally {
      if (lift) setLifting(false);
      else setSetting(false);
    }
  };

  const selectCls = 'w-full px-3 py-2 rounded-xl text-xs border border-border-strong bg-surface-3 text-text';

  return (
    <div className="space-y-4">
      <div className="bg-surface-2 border border-border rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-1">
          <Ban className="w-4 h-4 text-muted" />
          <h4 className="text-sm font-bold text-text">{s.scopeTitle}</h4>
        </div>
        <p className="text-[11px] text-muted leading-relaxed">{s.scopeHint}</p>
        <p className="text-[11px] text-muted leading-relaxed mt-1">{s.aggregatesNote}</p>
        <p className="text-[11px] text-muted leading-relaxed mt-1">{s.attachmentNote}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <section aria-label={s.scopeTitle} className="bg-surface-2 border border-border rounded-2xl p-4 space-y-3">
          {/* NOTE-2 (round 2): plain toggle group, not a tablist — the two
              scope buttons switch one form and own no tabpanels, so tab
              keyboard semantics would be dishonest here. */}
          <div role="group" aria-label={s.scopeTitle} className="flex gap-1">
            {(['item', 'disclosure'] as const).map((id) => (
              <button
                key={id}
                aria-pressed={scope === id}
                onClick={() => { setScope(id); touch(); }}
                className={`px-4 py-2 rounded-xl text-xs font-bold border transition-colors ${
                  scope === id ? 'bg-brand text-brand-ink border-brand' : 'bg-surface-2 text-muted border-border hover:bg-surface-3'
                }`}
              >
                {id === 'item' ? s.scopeItem : s.scopeDisclosure}
              </button>
            ))}
          </div>

          {scope === 'item' ? (
            <select value={itemId} onChange={(e) => { setItemId(e.target.value); touch(); }} className={selectCls} aria-label={s.scopeItemPh} disabled={locked}>
              <option value="">{s.scopeItemPh}</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.code} — {item.requirement.slice(0, 80)}
                </option>
              ))}
            </select>
          ) : (
            <select value={disclosureId} onChange={(e) => { setDisclosureId(e.target.value); touch(); }} className={selectCls} aria-label={s.scopeDisclosurePh} disabled={locked}>
              <option value="">{s.scopeDisclosurePh}</option>
              {disclosures.map((disc) => (
                <option key={disc.id} value={disc.id}>
                  {disc.code} — {disc.title}
                </option>
              ))}
            </select>
          )}

          <select value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); touch(); }} className={selectCls} aria-label={s.scopeDeptPh} disabled={locked}>
            <option value="">{s.scopeDeptPh}</option>
            {departments.map((dept) => (
              <option key={dept.id} value={dept.id}>{dept.name}</option>
            ))}
          </select>

          <div>
            <label className="block text-[11px] font-bold text-text mb-1" htmlFor="consultant-na-reason">{s.naReasonLabel}</label>
            <select id="consultant-na-reason" value={naReason} onChange={(e) => { setNaReason(e.target.value); touch(); }} className={selectCls} disabled={locked}>
              <option value="">{s.naReasonLabel}</option>
              {NA_REASONS.map((reason) => (
                <option key={reason} value={reason} dir="ltr">{reason}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-text mb-1" htmlFor="consultant-na-just">{s.justificationLabel}</label>
            <textarea
              id="consultant-na-just"
              value={justification}
              onChange={(e) => { setJustification(e.target.value); touch(); }}
              placeholder={s.justificationPh}
              disabled={locked}
              rows={2}
              className="w-full px-3 py-2 rounded-xl text-xs border border-border-strong bg-surface-3 text-text placeholder-muted"
            />
          </div>

          <button
            type="button"
            disabled={setting || locked}
            onClick={() => void postNa(false)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand text-brand-ink text-xs font-bold disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${setting ? 'animate-spin' : ''}`} />
            <span>{setting ? s.settingNa : s.setNa}</span>
          </button>
        </section>

        <div className="space-y-4">
          <section aria-label={s.liftTitle} className="bg-surface-2 border border-border rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Undo2 className="w-4 h-4 text-muted" />
              <h4 className="text-sm font-bold text-text">{s.liftTitle}</h4>
            </div>
            <p className="text-[11px] text-muted leading-relaxed">{s.liftHint}</p>
            <div>
              <label className="block text-[11px] font-bold text-text mb-1" htmlFor="consultant-lift-reason">{s.liftReasonLabel}</label>
              <textarea
                id="consultant-lift-reason"
                value={liftReason}
                onChange={(e) => { setLiftReason(e.target.value); touch(); }}
                placeholder={s.liftReasonPh}
                disabled={locked}
                rows={2}
                className="w-full px-3 py-2 rounded-xl text-xs border border-border-strong bg-surface-3 text-text placeholder-muted"
              />
            </div>
            <button
              type="button"
              disabled={lifting || locked}
              onClick={() => void postNa(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-border-strong text-text text-xs font-bold hover:bg-surface-3 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${lifting ? 'animate-spin' : ''}`} />
              <span>{lifting ? s.liftingNa : s.liftNa}</span>
            </button>
          </section>

          <section aria-label={s.naStateTitle} className="bg-surface-2 border border-border rounded-2xl p-4 space-y-2">
            <h4 className="text-sm font-bold text-text">{s.naStateTitle} ({naRows.length})</h4>
            {naRows.length === 0 ? (
              <p className="text-[11px] text-muted text-center p-3">{s.naEmpty}</p>
            ) : (
              <ul className="space-y-1.5 max-h-[30vh] overflow-y-auto">
                {naRows.map((row) => (
                  <li key={`${row.itemId}::${row.departmentName}`} className="p-2.5 rounded-xl border border-border bg-surface-3 text-[11px]">
                    <span className="font-mono font-bold text-text" dir="ltr">{row.code}</span>
                    {' · '}<span dir="auto" className="text-muted">{row.departmentName}</span>
                    {row.naReason && (
                      <span className="block mt-0.5 text-muted" dir="ltr">{row.naReason}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
