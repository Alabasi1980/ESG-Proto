import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Link2, Unlink, Save } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { apiFetch } from '../lib/api.ts';

interface LinkedService {
  id: string;
  code: string;
  name: string;
  description: string | null;
  show_gap: boolean;
  show_corrective: boolean;
  showGap?: boolean;
  showCorrective?: boolean;
}

interface DetailData {
  client: { id: string; code: string; name: string; suspended: boolean; industry: string | null };
  services: LinkedService[];
  departments: { id: string; code: string; name: string; head_user_id: string | null; head_name: string | null }[];
  users: { id: string; email: string; name: string; role: string; must_change_password: boolean; department_id: string | null }[];
}

interface Assignment {
  id: string;
  item_id: string;
  department_id: string;
  item_code: string;
  requirement: string;
  department_name: string;
}

const NA_REASONS = [
  'not-applicable',
  'legal-prohibitions',
  'confidentiality-constraints',
  'information-unavailable-incomplete',
];

/**
 * TASK-PROTO-U3-B2 R1 (round 2) — §3/§6: exactly ONE tenant per client-detail
 * view, resolved from the verified context; there is no client selector and no
 * client-list lookup in this file.
 *
 *  - P: the explicit target supplied by the app (Configure from a Clients row).
 *    No explicit target ⇒ null (the page must not render; App routes P → Clients).
 *  - W: the verified workspace envelope's client (never a GE `user.clientName`).
 *  - C: the session's own company.
 *  - E / unknown: no client-detail page ⇒ null.
 */
export interface ClientTargetInput {
  role: 'ge_admin' | 'client_admin' | 'employee' | null | undefined;
  explicitClientId: string | null | undefined;
  workspaceMode: 'platform' | 'consultant' | null | undefined;
  workspaceClientId: string | null | undefined;
  sessionClientId: string | null | undefined;
}

/** M2: the platform-EDITOR mode is the platform context (ge_admin in platform
 * mode), not `role === 'ge_admin'` — a consultant actor is also ge_admin but
 * must get the read-only W projection. Employees get no client-detail page. */
export interface ClientDetailMode {
  canEdit: boolean;
  showUsers: boolean;
  fetchCatalogs: boolean;
}

export function clientDetailMode(input: {
  role: 'ge_admin' | 'client_admin' | 'employee' | null | undefined;
  workspaceMode: 'platform' | 'consultant' | null | undefined;
}): ClientDetailMode {
  if (input.role === 'client_admin') return { canEdit: false, showUsers: true, fetchCatalogs: false };
  if (input.role !== 'ge_admin') return { canEdit: false, showUsers: false, fetchCatalogs: false };
  const consultant = input.workspaceMode === 'consultant';
  return { canEdit: !consultant, showUsers: !consultant, fetchCatalogs: !consultant };
}

export function resolveTargetClientId(input: ClientTargetInput): string | null {
  if (input.role === 'client_admin') return input.sessionClientId || null;
  if (input.role !== 'ge_admin') return null;
  if (input.workspaceMode === 'consultant') return input.workspaceClientId || null;
  // P: explicit T only — never a first-client default.
  return input.explicitClientId || null;
}

interface ClientDetailViewProps {
  /** Explicit T (P Configure). W/C ignore it and use their verified context. */
  clientId?: string | null;
}

export const ClientDetailView: React.FC<ClientDetailViewProps> = ({ clientId = null }) => {
  const { t } = useLanguage();
  const { user, token, workspace } = useAuth();
  const [services, setServices] = useState<{ id: string; code: string; name: string }[]>([]);
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [items, setItems] = useState<{ id: string; code: string; requirement: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flags, setFlags] = useState<Record<string, { showGap: boolean; showCorrective: boolean }>>({});
  const [assignForm, setAssignForm] = useState({ itemId: '', departmentId: '' });
  const [naForm, setNaForm] = useState({ itemId: '', departmentId: '', naReason: NA_REASONS[0], justification: '' });
  const [linkServiceId, setLinkServiceId] = useState('');
  // B16-A1: per-department head designation (GE only).
  const [headPick, setHeadPick] = useState<Record<string, string>>({});
  const [headMsg, setHeadMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [headSaving, setHeadSaving] = useState<string | null>(null);

  const headers = useCallback((): Record<string, string> => {
    const h: Record<string, string> = {};
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  }, [token]);
  const jsonHeaders = useCallback(() => ({ ...headers(), 'Content-Type': 'application/json' }), [headers]);

  // §3/§6: the tenant is never enumerated here. Only the P configuration
  // catalogs (services/items) are read; the client comes from the verified
  // context above. No `/api/clients` list request exists in this view.
  const fetchCatalogs = useCallback(async () => {
    try {
      const sRes = await apiFetch('/api/services', { headers: headers() });
      if (sRes.ok) setServices(await sRes.json());
      const iRes = await apiFetch('/api/items', { headers: headers() });
      if (iRes.ok) setItems(await iRes.json());
    } catch {
      /* ignore */
    }
  }, [headers]);

  const selected = resolveTargetClientId({
    role: user?.role,
    explicitClientId: clientId,
    workspaceMode: workspace?.mode,
    workspaceClientId: workspace?.client?.id,
    sessionClientId: user?.clientId,
  }) ?? '';

  const mode = clientDetailMode({ role: user?.role, workspaceMode: workspace?.mode });

  const fetchDetail = useCallback(
    async (id: string) => {
      if (!id) return;
      setLoading(true);
      setError(null);
      try {
        const [dRes, aRes] = await Promise.all([
          apiFetch(`/api/clients/${id}`, { headers: headers() }),
          apiFetch(`/api/assignments?clientId=${id}`, { headers: headers() }),
        ]);
        const dData = await dRes.json();
        if (!dRes.ok) throw new Error(dData.error);
        setDetail(dData);
        const f: Record<string, { showGap: boolean; showCorrective: boolean }> = {};
        for (const s of dData.services ?? []) {
          f[s.id] = { showGap: s.show_gap !== false, showCorrective: s.show_corrective !== false };
        }
        setFlags(f);
        if (aRes.ok) {
          const aData = await aRes.json();
          setAssignments(aData.items ?? []);
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    [headers]
  );

  // M2: only the platform configuration context needs the editor catalogs; W/C
  // issue no services/items fetches from this view.
  useEffect(() => {
    if (mode.fetchCatalogs) fetchCatalogs();
  }, [mode.fetchCatalogs, fetchCatalogs]);
  useEffect(() => {
    if (selected) fetchDetail(selected);
  }, [selected, fetchDetail]);

  const handleLink = async () => {
    if (!linkServiceId || !selected) return;
    try {
      const res = await apiFetch(`/api/clients/${selected}/services`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ serviceId: linkServiceId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setLinkServiceId('');
      await fetchDetail(selected);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleUnlink = async (serviceId: string) => {
    try {
      const res = await apiFetch(`/api/clients/${selected}/services/${serviceId}`, {
        method: 'DELETE',
        headers: headers(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await fetchDetail(selected);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleSaveFlags = async (serviceId: string) => {
    try {
      const res = await apiFetch(`/api/clients/${selected}/services/${serviceId}`, {
        method: 'PATCH',
        headers: jsonHeaders(),
        body: JSON.stringify(flags[serviceId]),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await fetchDetail(selected);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch('/api/assignments', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ clientId: selected, itemId: assignForm.itemId, departmentId: assignForm.departmentId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAssignForm({ itemId: '', departmentId: '' });
      await fetchDetail(selected);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleUnassign = async (itemId: string, departmentId: string) => {
    try {
      const res = await apiFetch('/api/assignments', {
        method: 'DELETE',
        headers: jsonHeaders(),
        body: JSON.stringify({ clientId: selected, itemId, departmentId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await fetchDetail(selected);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleNa = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch('/api/assignments/na', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({
          clientId: selected,
          itemId: naForm.itemId,
          departmentId: naForm.departmentId,
          naReason: naForm.naReason,
          justification: naForm.justification,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setNaForm({ itemId: '', departmentId: '', naReason: NA_REASONS[0], justification: '' });
      await fetchDetail(selected);
    } catch (err: any) {
      setError(err.message);
    }
  };

  // B16-A1: designate or clear the department head (GE only).
  const handleSetHead = async (departmentId: string, clear: boolean) => {
    setHeadMsg(null);
    setHeadSaving(departmentId);
    try {
      const res = await apiFetch(`/api/departments/${departmentId}/head`, {
        method: 'PATCH',
        headers: jsonHeaders(),
        body: JSON.stringify({ headUserId: clear ? null : headPick[departmentId] || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setHeadMsg({ kind: 'ok', text: t.b16.headSaved });
      setHeadPick((p) => ({ ...p, [departmentId]: '' }));
      await fetchDetail(selected);
    } catch (err: any) {
      setHeadMsg({ kind: 'err', text: err.message });
    } finally {
      setHeadSaving(null);
    }
  };

  // M2: editors are the platform context only (consultant actors are ge_admin).
  const canEdit = mode.canEdit;

  // §3: P Client Detail is explicit-target only. Without one the page must not
  // render (App routes P → Clients); W/C always resolve their own verified id.
  if (!selected) return null;

  return (
    <div className="space-y-6">
      <div className="p-6 bg-surface-2 rounded-2xl border border-border">
        <h3 className="text-xl font-bold">{t.clientDetail.title}</h3>
        <p className="text-xs text-muted mt-1">{t.clientDetail.subtitle}</p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          {/* Read-only target identity (server truth once loaded); no selector. */}
          <p className="text-xs text-text break-words">
            {detail ? (
              <>
                <span>{detail.client.name}</span>{' '}
                <span dir="ltr" className="text-muted">{detail.client.code}</span>
              </>
            ) : (
              <span className="text-muted">{t.common.loading}</span>
            )}
          </p>
          <button onClick={() => selected && fetchDetail(selected)} className="p-2 rounded-lg border border-border text-muted hover:bg-surface-3" title={t.common.refresh}>
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {error && <div className="p-3 rounded-xl bg-danger-soft border border-danger text-danger text-xs">{error}</div>}
      {loading && <p className="text-xs text-muted">{t.common.loading}</p>}

      {detail && (
        <>
          <div className="p-5 bg-surface-2 rounded-2xl border border-border">
            <h4 className="font-bold text-sm mb-2">{t.clientDetail.servicesTitle}</h4>
            <ul className="space-y-2">
              {detail.services.map((s) => (
                <li key={s.id} className="p-3 rounded-xl border border-border text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold">
                      {s.code} — {s.name}
                    </span>
                    {canEdit && (
                      <button onClick={() => handleUnlink(s.id)} title={t.clientDetail.unlinkBtn} className="p-1.5 rounded-lg border border-danger text-danger">
                        <Unlink className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  {canEdit && flags[s.id] && (
                    <div className="mt-2 flex items-center gap-3">
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={flags[s.id].showGap}
                          onChange={(e) => setFlags({ ...flags, [s.id]: { ...flags[s.id], showGap: e.target.checked } })}
                        />
                        <span>{t.clientDetail.showGap}</span>
                      </label>
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={flags[s.id].showCorrective}
                          onChange={(e) => setFlags({ ...flags, [s.id]: { ...flags[s.id], showCorrective: e.target.checked } })}
                        />
                        <span>{t.clientDetail.showCorrective}</span>
                      </label>
                      <button onClick={() => handleSaveFlags(s.id)} className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-brand text-brand-ink font-bold">
                        <Save className="w-3 h-3" /> {t.clientDetail.saveFlags}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {canEdit && (
              <div className="mt-3 flex items-center gap-2">
                <select value={linkServiceId} onChange={(e) => setLinkServiceId(e.target.value)} className="flex-1 px-3 py-2 rounded-xl text-xs border border-border-strong bg-surface-3 text-text">
                  <option value="">—</option>
                  {services
                    .filter((s) => !detail.services.some((x) => x.id === s.id))
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code} — {s.name}
                      </option>
                    ))}
                </select>
                <button onClick={handleLink} disabled={!linkServiceId} className="inline-flex items-center gap-1 px-4 py-2 rounded-xl bg-brand text-brand-ink text-xs font-bold disabled:opacity-50">
                  <Link2 className="w-3.5 h-3.5" /> {t.clientDetail.linkService}
                </button>
              </div>
            )}
          </div>

          {/* §5: suspend/unsuspend lives ONLY on the Clients list — removed here. */}

          <div className="p-5 bg-surface-2 rounded-2xl border border-border">
            <h4 className="font-bold text-sm mb-2">{t.assignments.title}</h4>
            {!canEdit && (
              <p className="text-[11px] text-muted mb-3 leading-relaxed">
                <span className="font-bold text-text">{t.b16.assignGeOnlyTitle}. </span>
                {t.b16.assignGeOnlyDesc}
              </p>
            )}
            {canEdit && (
            <form onSubmit={handleAssign} className="flex flex-col sm:flex-row gap-2 mb-3">
              <select value={assignForm.itemId} onChange={(e) => setAssignForm({ ...assignForm, itemId: e.target.value })} required className="flex-1 px-3 py-2 rounded-xl text-xs border border-border-strong bg-surface-3 text-text">
                <option value="">{t.assignments.itemLabel}…</option>
                {items.slice(0, 500).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.code}
                  </option>
                ))}
              </select>
              <select value={assignForm.departmentId} onChange={(e) => setAssignForm({ ...assignForm, departmentId: e.target.value })} required className="flex-1 px-3 py-2 rounded-xl text-xs border border-border-strong bg-surface-3 text-text">
                <option value="">{t.assignments.deptLabel}…</option>
                {detail.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <button type="submit" className="px-4 py-2 rounded-xl bg-brand text-brand-ink text-xs font-bold">
                {t.assignments.assignBtn}
              </button>
            </form>
            )}
            <ul className="space-y-1 max-h-64 overflow-y-auto">
              {assignments.slice(0, 200).map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 p-2 rounded-lg border border-border text-[11px]">
                  <span>
                    {a.item_code} → {a.department_name}
                  </span>
                  {canEdit && (
                    <button onClick={() => handleUnassign(a.item_id, a.department_id)} className="px-2 py-1 rounded-lg border border-danger text-danger font-bold">
                      {t.assignments.unassignBtn}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {canEdit && (
            <form onSubmit={handleNa} className="mt-4 pt-4 border-t border-border grid grid-cols-1 sm:grid-cols-2 gap-2">
              <select value={naForm.itemId} onChange={(e) => setNaForm({ ...naForm, itemId: e.target.value })} required className="px-3 py-2 rounded-xl text-xs border border-border-strong bg-surface-3 text-text">
                <option value="">Item…</option>
                {items.slice(0, 500).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.code}
                  </option>
                ))}
              </select>
              <select value={naForm.departmentId} onChange={(e) => setNaForm({ ...naForm, departmentId: e.target.value })} required className="px-3 py-2 rounded-xl text-xs border border-border-strong bg-surface-3 text-text">
                <option value="">Dept…</option>
                {detail.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <select value={naForm.naReason} onChange={(e) => setNaForm({ ...naForm, naReason: e.target.value })} className="px-3 py-2 rounded-xl text-xs border border-border-strong bg-surface-3 text-text">
                {NA_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <input value={naForm.justification} onChange={(e) => setNaForm({ ...naForm, justification: e.target.value })} placeholder={t.assignments.justificationPh} className="px-3 py-2 rounded-xl text-xs border border-border-strong bg-surface-3 text-text placeholder-muted" />
              <button type="submit" className="sm:col-span-2 px-4 py-2 rounded-xl bg-warning text-brand-ink text-xs font-bold">
                {t.assignments.naBtn}
              </button>
            </form>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-5 bg-surface-2 rounded-2xl border border-border">
              <h4 className="font-bold text-sm mb-1">
                {t.clientDetail.departmentsTitle} ({detail.departments.length})
                {canEdit && <span className="ms-2 text-[11px] font-semibold text-muted">· {t.b16.headTitle}</span>}
              </h4>
              {canEdit && <p className="text-[11px] text-muted mb-3 leading-relaxed">{t.b16.headDesc}</p>}
              {headMsg && (
                <div className={`mb-2 p-2.5 rounded-lg text-[11px] ${headMsg.kind === 'ok' ? 'bg-success-soft text-success-text' : 'bg-danger-soft text-danger'}`}>
                  {headMsg.text}
                </div>
              )}
              <ul className="text-xs space-y-2">
                {detail.departments.map((d) => {
                  const members = detail.users.filter((u) => u.department_id === d.id && u.role === 'employee');
                  return (
                    <li key={d.id} className="p-2 rounded-lg border border-border">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">
                          {d.name} ({d.code})
                        </span>
                        {d.head_user_id ? (
                          <span className="px-2 py-0.5 rounded-full bg-info-soft text-info text-[10px] font-bold">
                            {t.b16.deptHeadBadge}: {d.head_name || d.head_user_id.slice(0, 8)}
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted">{t.b16.headNone}</span>
                        )}
                      </div>
                      {canEdit && (
                        <div className="mt-2 flex items-center gap-2">
                          <select
                            value={headPick[d.id] ?? ''}
                            onChange={(e) => setHeadPick((p) => ({ ...p, [d.id]: e.target.value }))}
                            className="flex-1 px-2 py-1.5 rounded-lg text-[11px] border border-border-strong bg-surface-3 text-text"
                          >
                            <option value="">{t.b16.headLabel}…</option>
                            {members.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name} ({m.email})
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => handleSetHead(d.id, false)}
                            disabled={headSaving === d.id || !(headPick[d.id] || '').trim()}
                            className="px-3 py-1.5 rounded-lg bg-brand text-brand-ink text-[11px] font-bold hover:bg-brand-strong disabled:opacity-50"
                          >
                            {t.b16.headAssign}
                          </button>
                          {d.head_user_id && (
                            <button
                              onClick={() => handleSetHead(d.id, true)}
                              disabled={headSaving === d.id}
                              className="px-3 py-1.5 rounded-lg border border-danger text-danger text-[11px] font-bold disabled:opacity-50"
                            >
                              {t.b16.headClear}
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
            {/* M2 §6: no user roster is rendered in the W read-only context. */}
            {mode.showUsers && (
              <div className="p-5 bg-surface-2 rounded-2xl border border-border">
                <h4 className="font-bold text-sm mb-2">{t.clientDetail.usersTitle} ({detail.users.length})</h4>
                <ul className="text-xs space-y-1 max-h-48 overflow-y-auto">
                  {detail.users.map((u) => (
                    <li key={u.id}>
                      {u.name} · {u.email} · {u.role}
                      {u.must_change_password && <span className="text-warning-text"> · {t.clientDetail.mustChangeBadge}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
