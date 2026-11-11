import React, { useEffect, useMemo, useState } from 'react';
import { Link2, Pencil, Plus, RefreshCw, Save, Trash2, Unlink } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';

interface StandardRow {
  id: string;
  code: string;
  title: string;
  category: string;
}

interface DisclosureRow {
  id: string;
  standard_id: string;
  code: string;
  title: string;
  description: string | null;
}

interface ItemRow {
  id: string;
  disclosure_id: string;
  code: string;
  requirement: string;
  answer_type: string;
  hint: string | null;
  priority: string;
  esg_class: string;
  weight: number;
  objective: string | null;
  topic: string | null;
  reference: string | null;
  disclosure_code?: string;
}

interface ItemLink {
  id: string;
  relation: string;
  otherItem: {
    id: string;
    code: string;
    requirement: string;
    priority: string;
    disclosureCode: string;
    standardCode: string;
  };
  evaluation: { score: number | null; notEvaluated: boolean; notApplicable: boolean } | null;
  state: string;
}

const inputCls =
  'px-3 py-1.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-750 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20';

/** B11a (S-05/S-06/S-08): GE-only taxonomy management. Rendered inside StandardsView. */
export const TaxonomyManage: React.FC = () => {
  const { t } = useLanguage();
  const { user, token } = useAuth();
  const [standards, setStandards] = useState<StandardRow[]>([]);
  const [disclosures, setDisclosures] = useState<DisclosureRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const [expandedStd, setExpandedStd] = useState<string | null>(null);
  const [expandedDisc, setExpandedDisc] = useState<string | null>(null);
  const [expandedItemLinks, setExpandedItemLinks] = useState<string | null>(null);
  const [links, setLinks] = useState<ItemLink[]>([]);
  const [linkCode, setLinkCode] = useState('');

  const [editStd, setEditStd] = useState<{ id: string; title: string; category: string } | null>(null);
  const [editDisc, setEditDisc] = useState<{ id: string; title: string; description: string } | null>(null);
  const [editItem, setEditItem] = useState<any | null>(null);
  const [newItem, setNewItem] = useState({ code: '', requirement: '', priority: 'mid', esg_class: 'general', answer_type: 'text' });
  const [addingFor, setAddingFor] = useState<string | null>(null);

  if (user?.role !== 'ge_admin') return null;

  const headers = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    Authorization: token ? `Bearer ${token}` : '',
  });
  const readHeaders = (): Record<string, string> => ({
    Authorization: token ? `Bearer ${token}` : '',
  });

  const fetchAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [sRes, dRes, iRes] = await Promise.all([
        fetch('/api/standards', { headers: readHeaders() }),
        fetch('/api/disclosures', { headers: readHeaders() }),
        fetch('/api/items', { headers: readHeaders() }),
      ]);
      if (sRes.ok) setStandards(await sRes.json());
      if (dRes.ok) setDisclosures(await dRes.json());
      if (iRes.ok) setItems(await iRes.json());
    } catch (err: any) {
      setError(err.message || 'Failed to load taxonomy');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const discsOf = useMemo(() => {
    const m = new Map<string, DisclosureRow[]>();
    for (const d of disclosures) {
      const arr = m.get(d.standard_id) || [];
      arr.push(d);
      m.set(d.standard_id, arr);
    }
    return m;
  }, [disclosures]);

  const itemsOf = useMemo(() => {
    const m = new Map<string, ItemRow[]>();
    for (const i of items) {
      const arr = m.get(i.disclosure_id) || [];
      arr.push(i);
      m.set(i.disclosure_id, arr);
    }
    return m;
  }, [items]);

  const itemByCode = useMemo(() => {
    const m = new Map<string, ItemRow>();
    for (const i of items) m.set(i.code.toLowerCase(), i);
    return m;
  }, [items]);

  const mutate = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await fetchAll();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const api = async (path: string, method: string, body?: any) => {
    const res = await fetch(path, {
      method,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  };

  const saveStd = (id: string) =>
    mutate(async () => {
      if (!editStd) return;
      await api(`/api/standards/${id}`, 'PATCH', { title: editStd.title, category: editStd.category });
      setEditStd(null);
    });

  const delStd = (s: StandardRow) =>
    mutate(async () => {
      if (!window.confirm(t.taxonomy.deleteStdConfirm)) return;
      await api(`/api/standards/${s.id}`, 'DELETE');
    });

  const saveDisc = (id: string) =>
    mutate(async () => {
      if (!editDisc) return;
      await api(`/api/disclosures/${id}`, 'PATCH', {
        title: editDisc.title,
        description: editDisc.description || null,
      });
      setEditDisc(null);
    });

  const delDisc = (d: DisclosureRow) =>
    mutate(async () => {
      if (!window.confirm(t.taxonomy.deleteDiscConfirm)) return;
      await api(`/api/disclosures/${d.id}`, 'DELETE');
    });

  const addItem = (disclosureId: string) =>
    mutate(async () => {
      await api('/api/items', 'POST', { disclosureId, ...newItem });
      setNewItem({ code: '', requirement: '', priority: 'mid', esg_class: 'general', answer_type: 'text' });
      setAddingFor(null);
    });

  const saveItem = (id: string) =>
    mutate(async () => {
      if (!editItem) return;
      const { code, disclosure_id, disclosureId, weight, ...rest } = editItem;
      await api(`/api/items/${id}`, 'PATCH', rest);
      setEditItem(null);
    });

  const delItem = (it: ItemRow) =>
    mutate(async () => {
      if (!window.confirm(t.taxonomy.deleteItemConfirm)) return;
      await api(`/api/items/${it.id}`, 'DELETE');
    });

  const loadLinks = async (itemId: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/items/${itemId}/links`, { headers: readHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load links');
      setLinks(data.links || []);
      setExpandedItemLinks(itemId);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const addLink = (itemId: string) =>
    mutate(async () => {
      const other = itemByCode.get(linkCode.trim().toLowerCase());
      if (!other) throw new Error(`Item code '${linkCode.trim()}' was not found.`);
      await api(`/api/items/${itemId}/links`, 'POST', { otherItemId: other.id });
      setLinkCode('');
      await loadLinks(itemId);
    });

  const removeLink = (itemId: string, linkId: string) =>
    mutate(async () => {
      if (!window.confirm(t.taxonomy.unlinkConfirm)) return;
      await api(`/api/items/${itemId}/links`, 'DELETE', { linkId });
      await loadLinks(itemId);
    });

  return (
    <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-xs">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-2 text-start"
      >
        <div>
          <h4 className="text-xs font-bold text-slate-900 dark:text-white">{t.taxonomy.manageTitle}</h4>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{t.taxonomy.manageSubtitle}</p>
        </div>
        <span className="px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-750 text-slate-700 dark:text-slate-200 shrink-0">
          {open ? t.taxonomy.hideManage : t.taxonomy.showManage}
        </span>
      </button>

      {open && (
        <div className="mt-4">
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-900/40">
            {t.taxonomy.importOwnsNote} {t.taxonomy.codeImmutableNote}
          </p>

          {error && (
            <div className="mb-3 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end mb-2">
            <button
              onClick={fetchAll}
              className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-750"
              title={t.common.refresh}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {loading ? (
            <p className="text-xs text-slate-500">{t.common.loading}</p>
          ) : (
            <ul className="space-y-3">
              {standards.map((s) => (
                <li key={s.id} className="p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 font-extrabold text-xs border border-emerald-200 dark:border-emerald-800/60">
                          {s.code}
                        </span>
                        {editStd?.id === s.id ? (
                          <div className="flex items-center gap-1.5 flex-1 flex-wrap">
                            <input value={editStd.title} onChange={(e) => setEditStd({ ...editStd, title: e.target.value })} placeholder={t.taxonomy.titleLabel} className={`${inputCls} flex-1 min-w-32`} />
                            <input value={editStd.category} onChange={(e) => setEditStd({ ...editStd, category: e.target.value })} placeholder={t.taxonomy.categoryLabel} className={`${inputCls} w-28`} />
                            <button onClick={() => saveStd(s.id)} disabled={busy} title={t.taxonomy.saveButton} className="p-1.5 rounded-lg border border-emerald-200 text-emerald-600 hover:bg-emerald-50 disabled:opacity-50">
                              <Save className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs font-bold text-slate-900 dark:text-white">
                            {s.title} <span className="font-normal text-slate-500">· {s.category}</span>
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => setExpandedStd(expandedStd === s.id ? null : s.id)}
                        className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-100 dark:bg-slate-750 text-slate-700 dark:text-slate-200"
                      >
                        {t.taxonomy.disclosuresTitle} ({(discsOf.get(s.id) || []).length})
                      </button>
                      {editStd?.id !== s.id && (
                        <button onClick={() => setEditStd({ id: s.id, title: s.title, category: s.category })} title={t.taxonomy.editButton} className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-750">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button onClick={() => delStd(s)} disabled={busy} title={t.taxonomy.deleteButton} className="p-1.5 rounded-lg border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {expandedStd === s.id && (
                    <div className="mt-3 ps-2 border-s-2 border-slate-100 dark:border-slate-700/60 space-y-2">
                      {(discsOf.get(s.id) || []).map((d) => (
                        <div key={d.id} className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-750/40 border border-slate-100 dark:border-slate-700/40">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="text-[11px] font-extrabold text-slate-500">{d.code}</div>
                              {editDisc?.id === d.id ? (
                                <div className="mt-1 space-y-1.5">
                                  <input value={editDisc.title} onChange={(e) => setEditDisc({ ...editDisc, title: e.target.value })} placeholder={t.taxonomy.titleLabel} className={`${inputCls} w-full`} />
                                  <input value={editDisc.description} onChange={(e) => setEditDisc({ ...editDisc, description: e.target.value })} placeholder={t.taxonomy.descLabel} className={`${inputCls} w-full`} />
                                </div>
                              ) : (
                                <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">{d.title}</div>
                              )}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button onClick={() => setExpandedDisc(expandedDisc === d.id ? null : d.id)} className="px-2 py-1 rounded-lg text-[11px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200">
                                {t.taxonomy.itemsTitle} ({(itemsOf.get(d.id) || []).length})
                              </button>
                              {editDisc?.id === d.id ? (
                                <button onClick={() => saveDisc(d.id)} disabled={busy} className="p-1.5 rounded-lg border border-emerald-200 text-emerald-600 hover:bg-emerald-50 disabled:opacity-50">
                                  <Save className="w-3.5 h-3.5" />
                                </button>
                              ) : (
                                <button onClick={() => setEditDisc({ id: d.id, title: d.title, description: d.description || '' })} title={t.taxonomy.editButton} className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800">
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <button onClick={() => delDisc(d)} disabled={busy} title={t.taxonomy.deleteButton} className="p-1.5 rounded-lg border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 hover:bg-rose-50 disabled:opacity-50">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          {expandedDisc === d.id && (
                            <div className="mt-2 space-y-1.5">
                              {(itemsOf.get(d.id) || []).map((it) => (
                                <div key={it.id} className="p-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                                  {editItem?.id === it.id ? (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                      <input value={editItem.requirement} onChange={(e) => setEditItem({ ...editItem, requirement: e.target.value })} placeholder={t.taxonomy.requirementLabel} className={`${inputCls} sm:col-span-2`} />
                                      <select value={editItem.priority} onChange={(e) => setEditItem({ ...editItem, priority: e.target.value })} className={inputCls}>
                                        <option value="high">high</option>
                                        <option value="mid">mid</option>
                                        <option value="low">low</option>
                                      </select>
                                      <select value={editItem.esg_class} onChange={(e) => setEditItem({ ...editItem, esg_class: e.target.value })} className={inputCls}>
                                        <option value="environmental">environmental</option>
                                        <option value="social">social</option>
                                        <option value="governance">governance</option>
                                        <option value="general">general</option>
                                      </select>
                                      <select value={editItem.answer_type} onChange={(e) => setEditItem({ ...editItem, answer_type: e.target.value })} className={inputCls}>
                                        <option value="text">text</option>
                                        <option value="number">number</option>
                                        <option value="boolean">boolean</option>
                                        <option value="date">date</option>
                                        <option value="file">file</option>
                                      </select>
                                      <input value={editItem.hint || ''} onChange={(e) => setEditItem({ ...editItem, hint: e.target.value })} placeholder={t.taxonomy.hintLabel} className={inputCls} />
                                      <input value={editItem.objective || ''} onChange={(e) => setEditItem({ ...editItem, objective: e.target.value })} placeholder={t.taxonomy.objectiveLabel} className={inputCls} />
                                      <input value={editItem.topic || ''} onChange={(e) => setEditItem({ ...editItem, topic: e.target.value })} placeholder={t.taxonomy.topicLabel} className={inputCls} />
                                      <input value={editItem.reference || ''} onChange={(e) => setEditItem({ ...editItem, reference: e.target.value })} placeholder={t.taxonomy.referenceLabel} className={`${inputCls} sm:col-span-2`} />
                                      <div className="sm:col-span-2 flex gap-1.5">
                                        <button onClick={() => saveItem(it.id)} disabled={busy} className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-bold disabled:opacity-50">
                                          {busy ? t.taxonomy.saving : t.taxonomy.saveButton}
                                        </button>
                                        <button onClick={() => setEditItem(null)} className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs">
                                          {t.common.cancel}
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div>
                                      <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                          <span className="text-[11px] font-extrabold text-violet-600 dark:text-violet-400">{it.code}</span>
                                          <span className="text-xs text-slate-800 dark:text-slate-100 ms-2">{it.requirement}</span>
                                          <div className="text-[10px] text-slate-500 mt-0.5">
                                            {it.priority} · {it.esg_class} · {it.answer_type} · weight {it.weight}
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0">
                                          <button onClick={() => (expandedItemLinks === it.id ? setExpandedItemLinks(null) : loadLinks(it.id))} title={t.taxonomy.linksTitle} className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50">
                                            <Link2 className="w-3.5 h-3.5" />
                                          </button>
                                          <button onClick={() => setEditItem({ ...it })} title={t.taxonomy.editButton} className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50">
                                            <Pencil className="w-3.5 h-3.5" />
                                          </button>
                                          <button onClick={() => delItem(it)} disabled={busy} title={t.taxonomy.deleteButton} className="p-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-50">
                                            <Trash2 className="w-3.5 h-3.5" />
                                          </button>
                                        </div>
                                      </div>
                                      {expandedItemLinks === it.id && (
                                        <div className="mt-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-750/60 border border-slate-200 dark:border-slate-700">
                                          <div className="text-[11px] font-bold text-slate-700 dark:text-slate-200 mb-1.5">
                                            {t.taxonomy.linksTitle}
                                          </div>
                                          {links.length === 0 ? (
                                            <p className="text-[11px] text-slate-500">{t.taxonomy.noLinksText}</p>
                                          ) : (
                                            <ul className="space-y-1.5">
                                              {links.map((l) => (
                                                <li key={l.id} className="flex items-start justify-between gap-2 text-[11px] p-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                                                  <div className="min-w-0">
                                                    <span className="font-extrabold text-violet-600 dark:text-violet-400">{l.otherItem.code}</span>
                                                    <span className="text-slate-600 dark:text-slate-300 ms-1.5">{l.otherItem.requirement}</span>
                                                    <div className="text-slate-500 mt-0.5">
                                                      {l.otherItem.standardCode} · {l.otherItem.disclosureCode} · {t.taxonomy.relationLabel}: {l.relation}
                                                    </div>
                                                    <div className="mt-0.5">
                                                      {l.evaluation && !l.evaluation.notEvaluated && !l.evaluation.notApplicable ? (
                                                        <span className="px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-bold">
                                                          {t.taxonomy.evaluatedBadge}: {l.evaluation.score}
                                                        </span>
                                                      ) : (
                                                        <span className="px-1.5 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold">
                                                          {t.taxonomy.notEvaluatedByDept}
                                                        </span>
                                                      )}
                                                    </div>
                                                  </div>
                                                  <button onClick={() => removeLink(it.id, l.id)} disabled={busy} title={t.taxonomy.unlinkButton} className="p-1 rounded-lg text-rose-600 hover:bg-rose-50 disabled:opacity-50 shrink-0">
                                                    <Unlink className="w-3.5 h-3.5" />
                                                  </button>
                                                </li>
                                              ))}
                                            </ul>
                                          )}
                                          <div className="mt-2 flex items-center gap-1.5">
                                            <input value={linkCode} onChange={(e) => setLinkCode(e.target.value)} placeholder={t.taxonomy.linkToLabel} className={`${inputCls} flex-1`} />
                                            <button onClick={() => addLink(it.id)} disabled={busy || !linkCode.trim()} className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-[11px] font-bold disabled:opacity-50">
                                              {t.taxonomy.linkButton}
                                            </button>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              ))}
                              {addingFor === d.id ? (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 p-2 rounded-lg border border-emerald-200 dark:border-emerald-900">
                                  <input value={newItem.code} onChange={(e) => setNewItem({ ...newItem, code: e.target.value })} placeholder={t.taxonomy.codePh} className={inputCls} />
                                  <input value={newItem.requirement} onChange={(e) => setNewItem({ ...newItem, requirement: e.target.value })} placeholder={t.taxonomy.requirementPh} className={inputCls} />
                                  <select value={newItem.priority} onChange={(e) => setNewItem({ ...newItem, priority: e.target.value })} className={inputCls}>
                                    <option value="high">high</option>
                                    <option value="mid">mid</option>
                                    <option value="low">low</option>
                                  </select>
                                  <select value={newItem.esg_class} onChange={(e) => setNewItem({ ...newItem, esg_class: e.target.value })} className={inputCls}>
                                    <option value="environmental">environmental</option>
                                    <option value="social">social</option>
                                    <option value="governance">governance</option>
                                    <option value="general">general</option>
                                  </select>
                                  <div className="sm:col-span-2 flex gap-1.5">
                                    <button onClick={() => addItem(d.id)} disabled={busy} className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-xs font-bold disabled:opacity-50">
                                      {busy ? t.taxonomy.addingItem : t.taxonomy.addItemButton}
                                    </button>
                                    <button onClick={() => setAddingFor(null)} className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs">
                                      {t.common.cancel}
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <button onClick={() => setAddingFor(d.id)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-dashed border-slate-300 dark:border-slate-600 text-[11px] font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-750">
                                  <Plus className="w-3.5 h-3.5" /> {t.taxonomy.addItemButton}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
