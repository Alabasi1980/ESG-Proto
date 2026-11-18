import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Download, Lightbulb, Paperclip, RefreshCw, Save, Trash2 } from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext.tsx';
import { useAuth } from '../../context/AuthContext.tsx';
import { apiFetch } from '../../lib/api.ts';
import { friendlyError, isFrozenRefusal } from '../../views/ServicesView.tsx';
import { pickOwnStatus } from './employeeWorkspace.ts';

interface EvidenceFile {
  id: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  uploadedBy: string | null;
  createdAt: string;
}

interface DeptStatus {
  id: string;
  departmentId: string;
  departmentName: string;
  performed: boolean;
  note: string | null;
  submittedAt: string | null;
  version: number;
  files: EvidenceFile[];
}

interface AssignedInitiative {
  client_initiative_id: string;
  initiative_id: string;
  title: string;
  sector: string | null;
  esg_class: string | null;
  standards_ref: string | null;
  notes: string | null;
  archived: boolean;
  statuses: DeptStatus[];
  ownVersion: number | null;
}

interface EmployeeInitiativesTabProps {
  onFrozen: () => void;
  onDirtyChange: (key: string, dirty: boolean) => void;
  notify: (kind: 'ok' | 'err', text: string) => void;
}

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const StatusCard: React.FC<{
  row: AssignedInitiative;
  departmentId: string;
  onChanged: () => void;
  onFrozen: () => void;
  onDirtyChange: (key: string, dirty: boolean) => void;
  notify: (kind: 'ok' | 'err', text: string) => void;
}> = ({ row, departmentId, onChanged, onFrozen, onDirtyChange, notify }) => {
  const { t } = useLanguage();
  const { token } = useAuth();
  const s = t.employeeServices;
  const own = pickOwnStatus(row.statuses, departmentId);
  const archived = row.archived === true;

  const [performed, setPerformed] = useState(own?.performed ?? false);
  const [note, setNote] = useState(own?.note ?? '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);

  const ownVersion = own?.version ?? -1;
  const ownId = own?.id ?? null;
  useEffect(() => {
    setPerformed(own?.performed ?? false);
    setNote(own?.note ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownId, ownVersion]);

  const dirty = !archived && (own
    ? performed !== own.performed || (note || '') !== (own.note ?? '')
    : performed || note.trim() !== '');
  useEffect(() => {
    onDirtyChange(`init:${row.client_initiative_id}`, dirty);
    return () => onDirtyChange(`init:${row.client_initiative_id}`, false);
  }, [dirty, onDirtyChange, row.client_initiative_id]);

  const locked = !!own?.submittedAt || archived;

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await apiFetch(`/api/initiatives/department/${encodeURIComponent(row.client_initiative_id)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          performed,
          note: note.trim() === '' ? null : note.trim(),
          expectedVersion: own ? own.version : (row.ownVersion ?? 0),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (isFrozenRefusal(data)) onFrozen();
        throw new Error((data as { error?: string }).error || s.actionFailed);
      }
      setMsg({ kind: 'ok', text: t.common.success });
      notify('ok', t.common.success);
      onChanged();
    } catch (err) {
      const message = friendlyError(err, s.actionFailed);
      setMsg({ kind: 'err', text: message });
      notify('err', message);
    } finally {
      setSaving(false);
    }
  };

  const doUpload = async () => {
    if (!ownId || !pendingFile) return;
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
      const res = await apiFetch(`/api/evidence/initiative_status/${encodeURIComponent(ownId)}/files`, {
        method: 'POST',
        headers,
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (isFrozenRefusal(data)) onFrozen();
        const code = (data as { code?: string }).code;
        throw new Error(code === 'attachments.oversize' ? t.attachments.oversize
          : code === 'attachments.mime' ? t.attachments.mime
          : (data as { error?: string }).error || t.attachments.uploadFailed);
      }
      notify('ok', t.common.success);
      setPendingFile(null);
      setInputKey((k) => k + 1);
      onChanged();
    } catch (err) {
      notify('err', friendlyError(err, t.attachments.uploadFailed));
    } finally {
      setUploading(false);
    }
  };

  const doDownload = async (file: EvidenceFile) => {
    if (!ownId) return;
    try {
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await apiFetch(
        `/api/evidence/initiative_status/${encodeURIComponent(ownId)}/files/${encodeURIComponent(file.id)}/download`,
        { headers },
      );
      if (!res.ok) throw new Error(t.attachments.uploadFailed);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      notify('err', friendlyError(err, t.attachments.uploadFailed));
    }
  };

  const doDelete = async (file: EvidenceFile) => {
    if (!ownId) return;
    if (!window.confirm(t.attachments.deleteConfirm)) return;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await apiFetch(
        `/api/evidence/initiative_status/${encodeURIComponent(ownId)}/files/${encodeURIComponent(file.id)}`,
        { method: 'DELETE', headers },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (isFrozenRefusal(data)) onFrozen();
        throw new Error((data as { error?: string }).error || t.attachments.uploadFailed);
      }
      onChanged();
    } catch (err) {
      notify('err', friendlyError(err, t.attachments.uploadFailed));
    }
  };

  return (
    <div className={`p-4 bg-surface-2 rounded-2xl border border-border shadow-xs space-y-2.5 ${archived ? 'opacity-80' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-bold text-text break-words">{row.title}</h4>
          <p className="text-[11px] text-muted break-words">
            {[row.sector, row.esg_class, row.standards_ref].filter(Boolean).join(' · ')}
            {row.notes ? ` — ${row.notes}` : ''}
          </p>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${own?.performed ? 'bg-success-soft text-success-text' : 'bg-surface-3 text-muted'}`}>
          {archived ? t.servicesWorkspace.archivedBadge : own?.performed ? s.performedLabel : s.notPerformedLabel}
        </span>
      </div>

      {!archived && (
        <>
          <label className="flex items-center gap-2 text-xs font-bold text-text cursor-pointer">
            <input
              type="checkbox"
              checked={performed}
              onChange={(e) => setPerformed(e.target.checked)}
              disabled={locked}
              className="accent-brand"
            />
            <span>{s.performedLabel}</span>
          </label>
          <label className="block text-[11px] font-semibold text-muted">
            {s.noteLabel}
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={s.notePh}
              rows={2}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-border-strong bg-surface-3 text-xs text-text placeholder-muted"
            />
          </label>
          {msg && (
            <div role={msg.kind === 'err' ? 'alert' : 'status'} className={`p-2.5 rounded-lg text-xs ${msg.kind === 'ok' ? 'bg-success-soft text-success-text' : 'bg-danger-soft text-danger'}`}>
              {msg.text}
            </div>
          )}
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !dirty}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand text-brand-ink text-xs font-bold hover:bg-brand-strong disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? s.savingChanges : s.saveChanges}</span>
          </button>
        </>
      )}

      <div className="mt-1">
        <h5 className="text-[11px] font-bold text-text mb-1.5">{s.proofFilesTitle}</h5>
        {!ownId ? (
          <p className="text-[11px] text-muted">{s.noAnswerYet}</p>
        ) : (
          <>
            {!locked && (
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
            {(own?.files ?? []).length === 0 ? (
              <p className="text-[11px] text-muted mt-1.5">{t.attachments.emptyText}</p>
            ) : (
              <ul className="space-y-1.5 mt-1.5">
                {(own?.files ?? []).map((file) => (
                  <li key={file.id} className="flex items-center justify-between gap-2 p-2 rounded-lg border border-border text-[11px]">
                    <span className="font-bold text-text truncate">{file.filename}</span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => void doDownload(file)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-border-strong text-text font-semibold hover:bg-surface-3"
                      >
                        <Download className="w-3 h-3" />
                        <span>{t.attachments.downloadBtn}</span>
                      </button>
                      {!locked && (
                        <button
                          type="button"
                          onClick={() => void doDelete(file)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-danger text-danger font-semibold hover:bg-danger-soft"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>{t.attachments.deleteBtn}</span>
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export const EmployeeInitiativesTab: React.FC<EmployeeInitiativesTabProps> = ({ onFrozen, onDirtyChange, notify }) => {
  const { t } = useLanguage();
  const { user, token } = useAuth();
  const s = t.employeeServices;

  const [rows, setRows] = useState<AssignedInitiative[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    setError(null);
    try {
      const headers: Record<string, string> = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await apiFetch('/api/initiatives/department', { headers });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || s.loadFailed);
      }
      setRows(await res.json());
    } catch (err) {
      setRows([]);
      setError(friendlyError(err, s.loadFailed));
    }
  }, [token, s.loadFailed]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  const departmentId = user?.departmentId ?? null;

  if (rows === null) {
    return (
      <div aria-hidden="true" className="space-y-2">
        {[0, 1].map((n) => (
          <div key={n} className="h-28 rounded-2xl bg-surface-3 animate-pulse" />
        ))}
        <span className="sr-only">{t.common.loading}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="p-6 text-center space-y-3 bg-surface-2 rounded-2xl border border-border">
        <p className="text-sm font-bold text-text">{s.loadFailed}</p>
        <p className="text-xs text-muted break-words">{error}</p>
        <button
          type="button"
          onClick={() => void fetchRows()}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-brand text-brand-ink hover:bg-brand-strong"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>{t.common.retry}</span>
        </button>
      </div>
    );
  }

  if (!departmentId) {
    return (
      <div className="p-6 text-center bg-surface-2 rounded-2xl border border-border">
        <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-warning-text" />
        <p className="text-xs text-muted">{s.loadFailed}</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="p-8 md:p-12 text-center bg-surface-2 rounded-2xl border border-border">
        <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-brand-soft flex items-center justify-center text-brand-text">
          <Lightbulb className="w-7 h-7" />
        </div>
        <h3 className="text-base font-bold text-text mb-1">{s.initsEmpty}</h3>
        <p className="text-muted text-xs max-w-md mx-auto leading-relaxed">{s.initsEmptyHint}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-bold text-text px-1">
        {s.initsTitle} (<bdi dir="ltr">{rows.length}</bdi>)
      </h3>
      {rows.map((row) => (
        <StatusCard
          key={row.client_initiative_id}
          row={row}
          departmentId={departmentId}
          onChanged={fetchRows}
          onFrozen={onFrozen}
          onDirtyChange={onDirtyChange}
          notify={notify}
        />
      ))}
    </div>
  );
};
