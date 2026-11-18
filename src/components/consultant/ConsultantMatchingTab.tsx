import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, GitFork, RefreshCw, Sparkles } from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext.tsx';
import type { QueueItem } from '../../views/EvaluationPanel.tsx';
import type { ServiceRow } from '../services/ServiceRail.tsx';
import { friendlyError, isFrozenRefusal } from '../../views/ServicesView.tsx';
import {
  autoMatchServiceDepts,
  consultantHeaders,
  serviceDeptEntries,
  type ConsultantDept,
  type DeptMapping,
} from './consultantConsole.ts';

interface ConsultantMatchingTabProps {
  tenantId: string;
  token: string | null;
  queue: QueueItem[];
  catalogue: ServiceRow[];
  linkedIds: string[];
  departments: ConsultantDept[];
  frozen: boolean;
  suspended: boolean;
  onChanged: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onFrozen: () => void;
  notify: (kind: 'ok' | 'err', text: string) => void;
}

/**
 * TASK-PROTO-U4-3 unit (c2) — dept matching (G4: code auto-match + override).
 *
 * Service-side department keys come from the tenant queue rows of linked
 * services (standard → service via the catalogue, department_code as the
 * service-side key). Exact code equality proposes the tenant department;
 * everything else stays unmatched and blocks assignment-affecting actions
 * (server: 400 match.incomplete). The override table is saved with the one
 * c1 route PUT /api/workspace/dept-matching — no other write exists here.
 */
export const ConsultantMatchingTab: React.FC<ConsultantMatchingTabProps> = ({
  tenantId,
  token,
  queue,
  catalogue,
  linkedIds,
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

  const entries = useMemo(
    () => serviceDeptEntries(queue, catalogue, new Set(linkedIds)),
    [queue, catalogue, linkedIds],
  );

  const suggestion = useMemo(
    () => autoMatchServiceDepts(entries, departments),
    [entries, departments],
  );

  const [rows, setRows] = useState<DeptMapping[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRows(suggestion.matched.map((row) => ({ ...row })));
    onDirtyChange(false);
    // Re-seed only when the underlying suggestion set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestion.matched.map((row) => `${row.serviceId}::${row.serviceDeptCode}::${row.clientDeptId}`).join('|')]);

  const unmatchedKeys = useMemo(() => {
    const mapped = new Set(rows.map((row) => `${row.serviceId}::${row.serviceDeptCode}`));
    return suggestion.unmatched.filter((entry) => !mapped.has(`${entry.serviceId}::${entry.serviceDeptCode}`));
  }, [rows, suggestion.unmatched]);

  const locked = frozen || suspended;

  const setOverride = (serviceId: string, serviceDeptCode: string, clientDeptId: string) => {
    setRows((prev) => {
      const key = (row: DeptMapping) => row.serviceId === serviceId && row.serviceDeptCode === serviceDeptCode;
      const next = clientDeptId
        ? (prev.some(key) ? prev.map((row) => (key(row) ? { ...row, clientDeptId } : row)) : [...prev, { serviceId, serviceDeptCode, clientDeptId }])
        : prev.filter((row) => !key(row));
      const baseline = suggestion.matched.map((row) => `${row.serviceId}::${row.serviceDeptCode}::${row.clientDeptId}`).sort().join('|');
      const current = next.map((row) => `${row.serviceId}::${row.serviceDeptCode}::${row.clientDeptId}`).sort().join('|');
      onDirtyChange(current !== baseline);
      return next;
    });
  };

  const handleSave = async () => {
    if (locked) {
      notify('err', frozen ? s.frozenBanner : s.suspendedBanner);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/workspace/dept-matching', {
        method: 'PUT',
        headers: consultantHeaders(token),
        body: JSON.stringify({
          clientId: tenantId,
          mappings: rows.map((row) => ({
            serviceId: row.serviceId,
            serviceDeptCode: row.serviceDeptCode,
            clientDeptId: row.clientDeptId,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (isFrozenRefusal(data)) onFrozen();
        throw new Error((data as { error?: string }).error || s.actionFailed);
      }
      onDirtyChange(false);
      notify('ok', s.matchSaved);
      onChanged();
    } catch (err) {
      notify('err', friendlyError(err, s.actionFailed));
    } finally {
      setSaving(false);
    }
  };

  const deptName = (id: string) => departments.find((dept) => dept.id === id)?.name ?? id;

  if (entries.length === 0) {
    return <p className="text-[11px] text-muted p-4 text-center bg-surface-2 border border-border rounded-2xl">{s.matchEmpty}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="bg-surface-2 border border-border rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-1">
          <GitFork className="w-4 h-4 text-muted" />
          <h4 className="text-sm font-bold text-text">{s.matchTitle}</h4>
        </div>
        <p className="text-[11px] text-muted leading-relaxed">{s.matchHint}</p>
        <p className="text-[11px] text-muted leading-relaxed mt-1 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 shrink-0" />
          <span>{s.matchSuggestNote}</span>
        </p>
      </div>

      {unmatchedKeys.length > 0 && (
        <div role="alert" className="p-3 rounded-xl bg-danger-soft border border-danger text-danger text-[11px] font-bold flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p>{s.matchBlocking}</p>
            <p className="mt-1 font-semibold">{s.matchUnmatchedTitle} ({unmatchedKeys.length})</p>
            <ul className="mt-1 space-y-0.5 font-normal">
              {unmatchedKeys.map((entry) => (
                <li key={`${entry.serviceId}::${entry.serviceDeptCode}`} dir="ltr" className="font-mono">
                  {entry.serviceCode} · {entry.serviceDeptCode}
                </li>
              ))}
            </ul>
            <p className="mt-1 font-normal">{s.matchUnmatchedHint}</p>
          </div>
        </div>
      )}

      <div className="bg-surface-2 border border-border rounded-2xl p-4 space-y-2">
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-muted text-start">
                <th className="text-start font-bold py-2 pe-2" dir="ltr">{s.matchSvcCode}</th>
                <th className="text-start font-bold py-2 pe-2" dir="ltr">{s.matchSvcDeptCode}</th>
                <th className="text-start font-bold py-2">{s.matchOverrideLabel}</th>
              </tr>
            </thead>
            <tbody>
              {[...rows, ...unmatchedKeys.map((entry) => ({ serviceId: entry.serviceId, serviceDeptCode: entry.serviceDeptCode, clientDeptId: '' }))].map((row) => (
                <tr key={`${row.serviceId}::${row.serviceDeptCode}`} className="border-t border-border">
                  <td className="py-2 pe-2 font-mono text-muted" dir="ltr">
                    {catalogue.find((svc) => svc.id === row.serviceId)?.code ?? row.serviceId}
                  </td>
                  <td className="py-2 pe-2 font-mono font-bold text-text" dir="ltr">{row.serviceDeptCode}</td>
                  <td className="py-2">
                    <select
                      value={row.clientDeptId}
                      disabled={locked}
                      onChange={(e) => setOverride(row.serviceId, row.serviceDeptCode, e.target.value)}
                      aria-label={`${s.matchOverrideLabel} ${row.serviceDeptCode}`}
                      className="w-full px-2.5 py-1.5 rounded-lg text-[11px] border border-border-strong bg-surface-3 text-text"
                    >
                      <option value="">{s.matchUnmappedLabel}</option>
                      {departments.map((dept) => (
                        <option key={dept.id} value={dept.id}>
                          {dept.name}{dept.code ? ` (${dept.code})` : ''}
                        </option>
                      ))}
                    </select>
                    {row.clientDeptId && (
                      <span className="block mt-1 text-[10px] text-success-text font-bold">
                        {deptName(row.clientDeptId)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          disabled={saving || locked}
          onClick={() => void handleSave()}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand text-brand-ink text-xs font-bold disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${saving ? 'animate-spin' : ''}`} />
          <span>{saving ? s.matchSaving : s.matchSave}</span>
        </button>
      </div>
    </div>
  );
};
