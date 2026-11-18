import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, RefreshCw, Trash2, Send, Save } from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext.tsx';
import { useAuth } from '../../context/AuthContext.tsx';
import { apiFetch } from '../../lib/api.ts';
import { isFrozenRefusal } from '../../views/ServicesView.tsx';
import {
  emptyDraftRow,
  resubmitPrefill,
  type ConsoleStaffDraftRow,
} from './clientConsole.ts';

interface StaffListRow {
  id: string;
  email: string;
  name: string;
  department_id: string | null;
  department_name: string | null;
  department_resolved: string | null;
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
  rows: StaffListRow[];
}

interface ClientStaffSectionProps {
  departments: { id: string; name: string }[];
  frozen: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onFrozen: () => void;
  notify: (kind: 'ok' | 'err', text: string) => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ROWS = 200;

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-info-soft text-info',
  submitted: 'bg-warning-soft text-warning-text',
  approved: 'bg-success-soft text-success-text',
  rejected: 'bg-danger-soft text-danger',
};

/**
 * TASK-PROTO-U4-3 unit (b) — C staff-list fill part 1 (own tenant only).
 *
 * UI composition ONLY over existing staff APIs: POST /api/staff-lists (draft),
 * POST /api/staff-lists/:id/submit, GET /api/staff-lists, GET /api/departments.
 * Draft → submit → track (draft/submitted/approved/rejected) + resubmit-as-new
 * -draft for rejected lists (G7 default: reject = whole list, resubmit as new
 * version). NO provisioning, NO password display, NO approve/reject controls —
 * those belong to W (spec API-5 matrix: C draft/submit own-company only).
 * Server scopes everything to the session's own tenant; there is no tenant
 * picker and no cross-tenant query wiring anywhere in this file.
 */
export const ClientStaffSection: React.FC<ClientStaffSectionProps> = ({
  departments,
  frozen,
  onDirtyChange,
  onFrozen,
  notify,
}) => {
  const { t } = useLanguage();
  const { token } = useAuth();
  const s = t.clientConsole;
  const [lists, setLists] = useState<StaffList[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ConsoleStaffDraftRow[]>([emptyDraftRow()]);
  const [working, setWorking] = useState<string | null>(null);
  const dirtyRef = useRef(false);

  const headers = useCallback((): Record<string, string> => {
    const h: Record<string, string> = {};
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }, [token]);
  const jsonHeaders = useCallback(() => ({ ...headers(), 'Content-Type': 'application/json' }), [headers]);

  const setDirty = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
    onDirtyChange(dirty);
  }, [onDirtyChange]);

  const fetchLists = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/staff-lists', { headers: headers() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as { error?: string }).error || s.loadFailed);
      setLists(Array.isArray((data as { items?: unknown }).items) ? (data as { items: StaffList[] }).items : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : s.loadFailed);
      setLists([]);
    } finally {
      setLoading(false);
    }
  }, [headers, s.loadFailed]);

  useEffect(() => {
    void fetchLists();
  }, [fetchLists]);

  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  const updateRow = (index: number, patch: Partial<ConsoleStaffDraftRow>) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    setDirty(true);
  };

  const rowError = (row: ConsoleStaffDraftRow): string | null => {
    if (!row.email.trim() || !EMAIL_RE.test(row.email.trim().toLowerCase())) return s.emailPh;
    if (!row.name.trim()) return s.namePh;
    if (!row.departmentId) return s.deptPh;
    return null;
  };

  const handleCreateDraft = async (event: React.FormEvent) => {
    event.preventDefault();
    if (frozen) {
      notify('err', s.frozenBanner);
      return;
    }
    if (rows.length === 0 || rows.length > MAX_ROWS) {
      notify('err', s.actionFailed);
      return;
    }
    for (const row of rows) {
      if (rowError(row)) {
        notify('err', `${s.actionFailed} (${rowError(row)})`);
        return;
      }
    }
    setWorking('create');
    try {
      const res = await apiFetch('/api/staff-lists', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({
          rows: rows.map((r) => ({
            email: r.email.trim().toLowerCase(),
            name: r.name.trim(),
            departmentId: r.departmentId,
            role: r.role,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (isFrozenRefusal(data)) onFrozen();
        throw new Error((data as { error?: string }).error || s.actionFailed);
      }
      setRows([emptyDraftRow()]);
      setDirty(false);
      notify('ok', s.draftSaved);
      await fetchLists();
    } catch (err) {
      notify('err', err instanceof Error ? err.message : s.actionFailed);
    } finally {
      setWorking(null);
    }
  };

  const handleSubmit = async (id: string) => {
    if (frozen) {
      notify('err', s.frozenBanner);
      return;
    }
    setWorking(`submit:${id}`);
    try {
      const res = await apiFetch(`/api/staff-lists/${encodeURIComponent(id)}/submit`, {
        method: 'POST',
        headers: jsonHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (isFrozenRefusal(data)) onFrozen();
        throw new Error((data as { error?: string }).error || s.actionFailed);
      }
      notify('ok', s.submitDone);
      await fetchLists();
    } catch (err) {
      notify('err', err instanceof Error ? err.message : s.actionFailed);
    } finally {
      setWorking(null);
    }
  };

  const statusBadge = (status: string) => (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${STATUS_STYLES[status] || 'bg-surface-3 text-muted'}`}>
      {(t.staffLists.statusLabels as Record<string, string>)[status] ?? status}
    </span>
  );

  if (loading) {
    return (
      <div className="space-y-2" aria-hidden="true">
        <div className="h-10 rounded-xl bg-surface-3 animate-pulse" />
        <div className="h-32 rounded-xl bg-surface-3 animate-pulse" />
        <span className="sr-only">{t.common.loading}</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-sm font-bold text-text">{s.staffTitle}</h4>
        <p className="text-[11px] text-muted mt-0.5 leading-relaxed">{s.staffSubtitle}</p>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-danger-soft border border-danger text-danger text-xs flex items-center gap-2">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void fetchLists()}
            className="ms-auto inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-danger text-[11px] font-bold"
          >
            <RefreshCw className="w-3 h-3" />
            <span>{t.common.retry}</span>
          </button>
        </div>
      )}

      {/* Draft form: names + emails + own-company departments only */}
      <form onSubmit={(e) => void handleCreateDraft(e)} className="p-4 bg-surface-3 rounded-2xl border border-border space-y-3">
        <div className="text-xs font-bold text-text">{s.draftTitle}</div>
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <input
              value={row.email}
              onChange={(e) => updateRow(i, { email: e.target.value })}
              placeholder={s.emailPh}
              required
              type="email"
              dir="ltr"
              className="px-3 py-2 rounded-xl text-xs border border-border-strong bg-surface-2 text-text placeholder-muted"
            />
            <input
              value={row.name}
              onChange={(e) => updateRow(i, { name: e.target.value })}
              placeholder={s.namePh}
              required
              dir="auto"
              className="px-3 py-2 rounded-xl text-xs border border-border-strong bg-surface-2 text-text placeholder-muted"
            />
            <select
              value={row.departmentId}
              onChange={(e) => updateRow(i, { departmentId: e.target.value })}
              required
              className="px-3 py-2 rounded-xl text-xs border border-border-strong bg-surface-2 text-text"
            >
              <option value="">{s.deptPh}</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <select
                value={row.role}
                onChange={(e) => updateRow(i, { role: e.target.value as 'employee' | 'client_admin' })}
                className="flex-1 px-3 py-2 rounded-xl text-xs border border-border-strong bg-surface-2 text-text"
              >
                <option value="employee">{s.roleEmployee}</option>
                <option value="client_admin">{s.roleClientAdmin}</option>
              </select>
              <button
                type="button"
                onClick={() => { setRows((prev) => prev.filter((_, j) => j !== i)); setDirty(true); }}
                title={s.removeRow}
                className="p-2 rounded-lg border border-danger bg-surface-2 text-danger"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => { setRows((prev) => (prev.length >= MAX_ROWS ? prev : [...prev, emptyDraftRow()])); setDirty(true); }}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border-strong text-text text-xs font-bold"
          >
            <Plus className="w-3.5 h-3.5" /> {s.addRow}
          </button>
          <button
            type="submit"
            disabled={working === 'create' || frozen}
            className="inline-flex items-center gap-1 px-4 py-1.5 rounded-lg bg-brand text-brand-ink text-xs font-bold disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{working === 'create' ? s.creatingDraft : s.createDraft}</span>
          </button>
        </div>
      </form>

      {/* Track: draft / submitted / approved / rejected + resubmit */}
      {lists.length === 0 ? (
        <div className="p-4 text-center rounded-xl border border-border">
          <p className="text-xs font-bold text-text mb-1">{s.staffEmpty}</p>
          <p className="text-[11px] text-muted">{s.staffEmptyHint}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {lists.map((list) => (
            <li key={list.id} className="p-4 rounded-2xl border border-border bg-surface-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs">
                  {statusBadge(list.status)}
                  <span className="text-muted" dir="ltr">{list.row_count} rows</span>
                </div>
                <div className="flex items-center gap-2">
                  {list.status === 'draft' && (
                    <button
                      type="button"
                      onClick={() => void handleSubmit(list.id)}
                      disabled={working !== null || frozen}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-brand text-brand-ink text-xs font-bold disabled:opacity-50"
                    >
                      <Send className="w-3 h-3" />
                      <span>{working === `submit:${list.id}` ? s.submittingDraft : s.submitDraft}</span>
                    </button>
                  )}
                  {list.status === 'rejected' && (
                    <button
                      type="button"
                      onClick={() => {
                        setRows(resubmitPrefill(list.rows, departments));
                        setDirty(true);
                        notify('ok', s.resubmitHint);
                        document.getElementById('client-staff-draft')?.scrollIntoView({ block: 'nearest' });
                      }}
                      className="px-3 py-1.5 rounded-lg border border-border-strong text-text text-xs font-bold hover:bg-surface-2"
                    >
                      {s.resubmitAsDraft}
                    </button>
                  )}
                </div>
              </div>
              {list.reject_reason && (
                <p className="mt-2 text-[11px] text-danger">
                  <span className="font-bold">{s.rejectReasonLabel}: </span>
                  <span dir="auto">{list.reject_reason}</span>
                </p>
              )}
              <ul className="mt-2 text-[11px] text-muted space-y-0.5">
                {list.rows.map((r) => (
                  <li key={r.id} dir="auto">
                    <span dir="ltr">{r.email}</span> · {r.name} · {r.department_resolved || r.department_name || '—'} · {r.role}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <span id="client-staff-draft" className="sr-only" />
    </div>
  );
};
