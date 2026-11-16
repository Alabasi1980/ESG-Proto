import React, { useEffect, useState } from 'react';
import { Boxes, Copy, Link2, Pencil, Plus, RefreshCw, Save, Unlink } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { apiFetch } from '../lib/api.ts';

interface LinkedStandard {
  id: string;
  code: string;
  title: string;
}

interface ServiceRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  standards: LinkedStandard[];
  standard_count: number;
}

interface StandardOption {
  id: string;
  code: string;
  title: string;
}

/** B11a (S-04): GE-only services management. Rendered inside SettingsView. */
export const ServicesManage: React.FC = () => {
  const { t } = useLanguage();
  const { user, token } = useAuth();
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [standards, setStandards] = useState<StandardOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [saving, setSaving] = useState(false);

  const [dupId, setDupId] = useState<string | null>(null);
  const [dupCode, setDupCode] = useState('');
  const [duplicating, setDuplicating] = useState(false);

  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [linkStdId, setLinkStdId] = useState('');

  if (user?.role !== 'ge_admin') return null;

  const headers = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    Authorization: token ? `Bearer ${token}` : '',
  });

  const fetchAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const h: Record<string, string> = { Authorization: token ? `Bearer ${token}` : '' };
      const [svcRes, stdRes] = await Promise.all([
        apiFetch('/api/services', { headers: h }),
        apiFetch('/api/standards', { headers: h }),
      ]);
      if (svcRes.ok) setServices(await svcRes.json());
      if (stdRes.ok) {
        const stds = await stdRes.json();
        setStandards(stds.map((s: any) => ({ id: s.id, code: s.code, title: s.title })));
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load services');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const res = await apiFetch('/api/services', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ code: newCode, name: newName, description: newDesc || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create service');
      setNewCode('');
      setNewName('');
      setNewDesc('');
      await fetchAll();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (s: ServiceRow) => {
    setEditingId(s.id);
    setEditName(s.name);
    setEditDesc(s.description || '');
  };

  const handleSave = async (id: string) => {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/services/${id}`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ name: editName, description: editDesc || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update service');
      setEditingId(null);
      await fetchAll();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDuplicate = async (id: string) => {
    if (!dupCode.trim()) return;
    setDuplicating(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/services/${id}/duplicate`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ code: dupCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to duplicate service');
      setDupId(null);
      setDupCode('');
      await fetchAll();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setDuplicating(false);
    }
  };

  const handleLink = async (serviceId: string) => {
    if (!linkStdId) return;
    setError(null);
    try {
      const res = await apiFetch(`/api/services/${serviceId}/standards`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ standardId: linkStdId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to link standard');
      setLinkStdId('');
      await fetchAll();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleUnlink = async (serviceId: string, standardId: string) => {
    setError(null);
    try {
      const res = await apiFetch(`/api/services/${serviceId}/standards`, {
        method: 'DELETE',
        headers: headers(),
        body: JSON.stringify({ standardId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to unlink standard');
      await fetchAll();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="bg-surface-2 rounded-2xl border border-border p-6 shadow-xs">
      <div className="flex items-center justify-between gap-4 mb-1">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-accent-soft text-accent-text">
            <Boxes className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-base text-text">{t.services.title}</h3>
            <p className="text-xs text-muted">{t.services.subtitle}</p>
          </div>
        </div>
        <button
          onClick={fetchAll}
          className="p-2 rounded-xl border border-border text-muted hover:bg-surface-3 transition-colors"
          title={t.common.refresh}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <p className="text-[11px] text-muted mb-4">{t.services.manageHint}</p>

      {error && (
        <div className="mb-4 p-3 rounded-xl bg-danger-soft border border-danger text-danger text-xs">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-xs text-muted">{t.common.loading}</p>
      ) : services.length === 0 ? (
        <p className="text-xs text-muted p-3 rounded-xl bg-surface-3 border border-border mb-4">
          {t.services.emptyText}
        </p>
      ) : (
        <ul className="space-y-3 mb-5">
          {services.map((s) => (
            <li key={s.id} className="p-4 rounded-xl bg-surface-3 border border-border">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded-lg bg-accent-soft text-text font-extrabold text-xs border border-border-strong">
                      {s.code}
                    </span>
                    {editingId === s.id ? (
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="flex-1 min-w-32 px-2 py-1 rounded-lg text-xs bg-surface-3 border border-border-strong text-text focus:outline-none focus:ring-2 focus:ring-focus-ring/20"
                      />
                    ) : (
                      <span className="text-xs font-bold text-text">{s.name}</span>
                    )}
                  </div>
                  {editingId === s.id ? (
                    <input
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      placeholder={t.services.descLabel}
                      className="mt-2 w-full px-2 py-1 rounded-lg text-xs bg-surface-3 border border-border-strong text-text focus:outline-none focus:ring-2 focus:ring-focus-ring/20"
                    />
                  ) : (
                    s.description && (
                      <p className="text-[11px] text-muted mt-1">{s.description}</p>
                    )
                  )}
                  <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-bold uppercase text-muted">
                      {t.services.linkedLabel} ({s.standard_count}):
                    </span>
                    {s.standards.length === 0 && (
                      <span className="text-[11px] text-muted">—</span>
                    )}
                    {s.standards.map((st) => (
                      <span
                        key={st.id}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-brand-soft text-text border border-border-strong"
                      >
                        {st.code}
                        <button
                          onClick={() => handleUnlink(s.id, st.id)}
                          title={t.services.unlinkButton}
                          className="hover:text-danger"
                        >
                          <Unlink className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {editingId === s.id ? (
                    <button
                      onClick={() => handleSave(s.id)}
                      disabled={saving}
                      title={t.services.saveButton}
                      className="p-1.5 rounded-lg border border-success text-success hover:bg-success-soft disabled:opacity-50"
                    >
                      <Save className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      onClick={() => startEdit(s)}
                      title={t.services.editButton}
                      className="p-1.5 rounded-lg border border-border text-muted hover:bg-surface-3"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => (dupId === s.id ? setDupId(null) : (setDupId(s.id), setDupCode('')))}
                    title={t.services.duplicateButton}
                    className="p-1.5 rounded-lg border border-border text-muted hover:bg-surface-3"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() =>
                      linkingId === s.id ? setLinkingId(null) : (setLinkingId(s.id), setLinkStdId(''))
                    }
                    title={t.services.linkButton}
                    className="p-1.5 rounded-lg border border-border text-muted hover:bg-surface-3"
                  >
                    <Link2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {dupId === s.id && (
                <div className="mt-3 flex items-center gap-2">
                  <input
                    value={dupCode}
                    onChange={(e) => setDupCode(e.target.value)}
                    placeholder={t.services.newCodePh}
                    className="flex-1 px-3 py-1.5 rounded-xl text-xs bg-surface-3 border border-border-strong text-text placeholder-muted focus:outline-none focus:ring-2 focus:ring-focus-ring/20"
                  />
                  <button
                    onClick={() => handleDuplicate(s.id)}
                    disabled={duplicating || !dupCode.trim()}
                    className="px-4 py-1.5 rounded-xl bg-brand hover:bg-brand-strong text-brand-ink text-xs font-bold disabled:opacity-50"
                  >
                    {duplicating ? t.services.duplicating : t.services.duplicateButton}
                  </button>
                </div>
              )}

              {linkingId === s.id && (
                <div className="mt-3 flex items-center gap-2">
                  <select
                    value={linkStdId}
                    onChange={(e) => setLinkStdId(e.target.value)}
                    className="flex-1 px-3 py-1.5 rounded-xl text-xs bg-surface-3 border border-border-strong text-text focus:outline-none"
                  >
                    <option value="">—</option>
                    {standards
                      .filter((st) => !s.standards.some((x) => x.id === st.id))
                      .map((st) => (
                        <option key={st.id} value={st.id}>
                          {st.code} — {st.title}
                        </option>
                      ))}
                  </select>
                  <button
                    onClick={() => handleLink(s.id)}
                    disabled={!linkStdId}
                    className="px-4 py-1.5 rounded-xl bg-brand hover:bg-brand-strong text-brand-ink text-xs font-bold disabled:opacity-50"
                  >
                    {t.services.linkButton}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleCreate} className="pt-4 border-t border-border">
        <div className="flex items-center gap-2 text-xs font-bold text-text mb-3">
            <Plus className="w-4 h-4 text-accent-text" />
          <span>{t.services.createButton}</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            placeholder={t.services.codeLabel}
            required
            className="px-3 py-2 rounded-xl text-xs bg-surface-3 border border-border-strong text-text placeholder-muted focus:outline-none focus:ring-2 focus:ring-focus-ring/20"
          />
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t.services.nameLabel}
            required
            className="px-3 py-2 rounded-xl text-xs bg-surface-3 border border-border-strong text-text placeholder-muted focus:outline-none focus:ring-2 focus:ring-focus-ring/20"
          />
          <input
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            placeholder={t.services.descLabel}
            className="px-3 py-2 rounded-xl text-xs bg-surface-3 border border-border-strong text-text placeholder-muted focus:outline-none focus:ring-2 focus:ring-focus-ring/20"
          />
        </div>
        <button
          type="submit"
          disabled={creating}
          className="mt-3 px-5 py-2.5 rounded-xl bg-brand hover:bg-brand-strong text-brand-ink text-xs font-bold transition-colors shadow-xs disabled:opacity-50"
        >
          {creating ? t.services.creating : t.services.createButton}
        </button>
      </form>
    </div>
  );
};
