import React, { useMemo, useState } from 'react';
import { CheckCircle2, Copy, KeyRound, Mail, RefreshCw, Search, Send, XCircle } from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext.tsx';
import { apiFetch } from '../../lib/api.ts';
import { headers as workspaceTabHeaders } from '../../lib/workspaceClient.ts';
import { validateSelfChosenPassword } from '../../lib/password.ts';
import { friendlyError, isFrozenRefusal } from '../../views/ServicesView.tsx';
import { consultantJsonHeaders } from './consultantConsole.ts';

export interface ConsultantStaffList {
  id: string;
  status: string;
  note: string | null;
  reject_reason: string | null;
  row_count: number;
  delivery_channel: string | null;
  delivery_status: string | null;
  rows: Array<{ id: string; email: string; name: string; department_name: string | null; department_resolved: string | null; role: string }>;
}

export interface PendingAccount {
  id: string;
  email: string;
  name: string;
  must_change_password: boolean;
}

interface OtpAccount {
  email: string;
  oneTimePassword: string;
}

interface ConsultantStaffTabProps {
  token: string | null;
  lists: ConsultantStaffList[];
  pendingAccounts: PendingAccount[];
  frozen: boolean;
  suspended: boolean;
  onChanged: () => void;
  onFrozen: () => void;
  notify: (kind: 'ok' | 'err', text: string) => void;
}

/**
 * TASK-PROTO-U4-3 unit (c2) — W staff completion + reveal delivery (G1/G5).
 *
 * Own-tenant lists only (bound A, no tenant picker). Writes ONLY the c1 +
 * shifted pre-existing routes: POST /api/staff-lists/:id/approve (OTP shown
 * ONCE — kept in component memory, never stored/logged, cleared on
 * acknowledge/unmount/tab-switch), POST …/:id/reject (reason required),
 * POST …/:id/deliver (reveal-ack only; email honestly 400s
 * delivery.email_unavailable, no email form invented), POST
 * /api/workspace/staff/:userId/complete-password (temporary + must_change
 * preserved notice). The deliver/complete-password legs touch metadata only.
 */
export const ConsultantStaffTab: React.FC<ConsultantStaffTabProps> = ({
  token,
  lists,
  pendingAccounts,
  frozen,
  suspended,
  onChanged,
  onFrozen,
  notify,
}) => {
  const { t } = useLanguage();
  const s = t.consultantConsole;

  const [search, setSearch] = useState('');
  const [working, setWorking] = useState<string | null>(null);
  const [confirmApprove, setConfirmApprove] = useState<string | null>(null);
  const [rejectReasons, setRejectReasons] = useState<Record<string, string>>({});
  const [otps, setOtps] = useState<{ listId: string; accounts: OtpAccount[] } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [temps, setTemps] = useState<Record<string, string>>({});
  const [tempWorking, setTempWorking] = useState<string | null>(null);

  // OTPs live in component memory only: unmounting this tab (tab switch,
  // exit, reload) destroys them. There is intentionally no persistence.
  React.useEffect(() => () => setOtps(null), []);

  const locked = frozen || suspended;

  const visibleLists = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return lists;
    return lists.filter((list) =>
      list.rows.some((row) => row.email.toLowerCase().includes(query) || row.name.toLowerCase().includes(query)),
    );
  }, [lists, search]);

  const fail = (data: unknown): never => {
    if (isFrozenRefusal(data)) onFrozen();
    throw new Error((data as { error?: string }).error || s.actionFailed);
  };

  const handleApprove = async (id: string) => {
    if (locked) {
      notify('err', frozen ? s.frozenBanner : s.suspendedBanner);
      return;
    }
    setWorking(`approve:${id}`);
    try {
      const res = await apiFetch(`/api/staff-lists/${encodeURIComponent(id)}/approve`, {
        method: 'POST',
        headers: consultantJsonHeaders(token),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) fail(data);
      setOtps({ listId: id, accounts: (data as { accounts?: OtpAccount[] }).accounts ?? [] });
      setConfirmApprove(null);
      notify('ok', s.approveDone);
      onChanged();
    } catch (err) {
      notify('err', friendlyError(err, s.actionFailed));
    } finally {
      setWorking(null);
    }
  };

  const handleReject = async (id: string) => {
    const reason = (rejectReasons[id] ?? '').trim();
    if (!reason) {
      notify('err', s.rejectReasonPh);
      return;
    }
    if (locked) {
      notify('err', frozen ? s.frozenBanner : s.suspendedBanner);
      return;
    }
    setWorking(`reject:${id}`);
    try {
      const res = await apiFetch(`/api/staff-lists/${encodeURIComponent(id)}/reject`, {
        method: 'POST',
        headers: consultantJsonHeaders(token),
        body: JSON.stringify({ reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) fail(data);
      setRejectReasons((prev) => ({ ...prev, [id]: '' }));
      notify('ok', s.rejectDone);
      onChanged();
    } catch (err) {
      notify('err', friendlyError(err, s.actionFailed));
    } finally {
      setWorking(null);
    }
  };

  const handleDeliver = async (id: string, channel: 'reveal-ack' | 'email') => {
    if (locked) {
      notify('err', frozen ? s.frozenBanner : s.suspendedBanner);
      return;
    }
    setWorking(`deliver:${id}:${channel}`);
    try {
      const res = await apiFetch(`/api/staff-lists/${encodeURIComponent(id)}/deliver`, {
        method: 'POST',
        headers: consultantJsonHeaders(token),
        body: JSON.stringify({ channel }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) fail(data);
      notify('ok', (data as { status?: string }).status === 'acked' ? s.ackedNote : s.revealedNote);
      onChanged();
    } catch (err) {
      notify('err', friendlyError(err, s.actionFailed));
    } finally {
      setWorking(null);
    }
  };

  const handleCompletePassword = async (userId: string) => {
    const temporary = temps[userId] ?? '';
    const check = validateSelfChosenPassword(temporary);
    if (!check.ok) {
      notify('err', check.error ?? s.actionFailed);
      return;
    }
    if (locked) {
      notify('err', frozen ? s.frozenBanner : s.suspendedBanner);
      return;
    }
    setTempWorking(userId);
    try {
      const res = await fetch(`/api/workspace/staff/${encodeURIComponent(userId)}/complete-password`, {
        method: 'POST',
        headers: { ...consultantJsonHeaders(token), ...workspaceTabHeaders() },
        body: JSON.stringify({ temporaryPassword: temporary }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) fail(data);
      setTemps((prev) => ({ ...prev, [userId]: '' }));
      notify('ok', s.completedNote);
      onChanged();
    } catch (err) {
      notify('err', friendlyError(err, s.actionFailed));
    } finally {
      setTempWorking(null);
    }
  };

  const copyOtp = async (email: string, secret: string) => {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(email);
      window.setTimeout(() => setCopied((prev) => (prev === email ? null : prev)), 2000);
      notify('ok', s.copied);
    } catch {
      notify('err', s.actionFailed);
    }
  };

  const statusBadge = (status: string) => (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
      status === 'approved' ? 'bg-success-soft text-success-text'
      : status === 'submitted' ? 'bg-warning-soft text-warning-text'
      : status === 'rejected' ? 'bg-danger-soft text-danger'
      : 'bg-info-soft text-info'
    }`}>
      {(t.staffLists.statusLabels as Record<string, string>)[status] ?? status}
    </span>
  );

  return (
    <div className="space-y-4">
      <div className="bg-surface-2 border border-border rounded-2xl p-4">
        <h4 className="text-sm font-bold text-text">{s.staffTitle}</h4>
        <p className="text-[11px] text-muted mt-0.5 leading-relaxed">{s.staffHint}</p>
      </div>

      {otps && (
        <div role="alert" className="p-4 rounded-2xl bg-warning-soft border border-warning text-xs space-y-2">
          <div className="flex items-center gap-2 font-bold text-warning-text">
            <KeyRound className="w-4 h-4" />
            <span>{s.otpTitle}</span>
          </div>
          <p className="text-warning-text text-[11px] leading-relaxed">{s.otpWarning}</p>
          <p className="text-warning-text text-[11px] leading-relaxed font-bold">{s.otpOnceNote}</p>
          <ul className="space-y-1.5">
            {otps.accounts.map((account) => (
              <li key={account.email} className="flex flex-wrap items-center gap-2 p-2 rounded-lg bg-surface-2 border border-warning">
                <span className="font-mono text-[11px] text-text" dir="ltr">{account.email}</span>
                <code className="font-mono text-[11px] font-bold text-text" dir="ltr">{account.oneTimePassword}</code>
                <button
                  type="button"
                  onClick={() => void copyOtp(account.email, account.oneTimePassword)}
                  className="ms-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-warning text-warning-text text-[11px] font-bold"
                >
                  <Copy className="w-3 h-3" />
                  <span>{copied === account.email ? s.copied : s.copyButton}</span>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => { setOtps(null); notify('ok', s.ackedNote); }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand text-brand-ink text-xs font-bold"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>{s.acknowledgeButton}</span>
          </button>
        </div>
      )}

      <div className="relative">
        <Search className="w-3.5 h-3.5 absolute start-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={s.staffSearchPh}
          aria-label={s.staffSearchPh}
          className="w-full ps-8 pe-3 py-2 rounded-xl text-xs border border-border-strong bg-surface-2 text-text placeholder-muted"
        />
      </div>

      {visibleLists.length === 0 ? (
        <div className="p-6 text-center bg-surface-2 border border-border rounded-2xl">
          <p className="text-xs font-bold text-text mb-1">{s.staffEmpty}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {visibleLists.map((list) => (
            <li
              key={list.id}
              className="p-4 rounded-2xl border border-border bg-surface-2 transition-colors"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs">
                  {statusBadge(list.status)}
                  <span className="text-muted" dir="ltr">{list.row_count} rows</span>
                  {list.delivery_status && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-info-soft text-info" dir="ltr">
                      {list.delivery_channel}:{list.delivery_status}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {list.status === 'submitted' && confirmApprove !== list.id && (
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => setConfirmApprove(list.id)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-brand text-brand-ink text-[11px] font-bold disabled:opacity-50"
                    >
                      <Send className="w-3 h-3" />
                      <span>{s.approveButton}</span>
                    </button>
                  )}
                  {list.status === 'approved' && list.delivery_status !== 'acked' && (
                    <button
                      type="button"
                      disabled={working !== null || locked}
                      onClick={() => void handleDeliver(list.id, 'reveal-ack')}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border-strong text-text text-[11px] font-bold disabled:opacity-50"
                    >
                      <span>{working === `deliver:${list.id}:reveal-ack` ? s.delivering : s.deliverReveal}</span>
                    </button>
                  )}
                </div>
              </div>

              {confirmApprove === list.id && (
                <div role="alert" className="mt-2 p-3 rounded-xl bg-warning-soft border border-warning flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-bold text-warning-text flex-1">{s.approveConfirm}</span>
                  <button
                    type="button"
                    disabled={working !== null}
                    onClick={() => void handleApprove(list.id)}
                    className="px-3 py-1.5 rounded-lg bg-brand text-brand-ink text-[11px] font-bold disabled:opacity-50"
                  >
                    {working === `approve:${list.id}` ? s.approving : s.approveButton}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmApprove(null)}
                    className="px-3 py-1.5 rounded-lg border border-warning text-warning-text text-[11px] font-bold"
                  >
                    <XCircle className="w-3 h-3" />
                  </button>
                </div>
              )}

              {list.reject_reason && (
                <p className="mt-2 text-[11px] text-danger">
                  <span className="font-bold">{s.rejectDone} </span>
                  <span dir="auto">{list.reject_reason}</span>
                </p>
              )}

              {list.status === 'submitted' && (
                <div className="mt-2 flex flex-col sm:flex-row gap-2">
                  <input
                    value={rejectReasons[list.id] ?? ''}
                    onChange={(e) => setRejectReasons((prev) => ({ ...prev, [list.id]: e.target.value }))}
                    placeholder={s.rejectReasonPh}
                    disabled={locked}
                    dir="auto"
                    aria-label={s.rejectReasonPh}
                    className="flex-1 px-3 py-2 rounded-xl text-[11px] border border-border-strong bg-surface-3 text-text placeholder-muted"
                  />
                  <button
                    type="button"
                    disabled={working !== null || locked}
                    onClick={() => void handleReject(list.id)}
                    className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-danger text-danger text-[11px] font-bold disabled:opacity-50"
                  >
                    <span>{working === `reject:${list.id}` ? s.rejecting : s.rejectButton}</span>
                  </button>
                </div>
              )}

              {list.status === 'approved' && (
                <div className="mt-2 p-3 rounded-xl border border-border bg-surface-3">
                  <p className="text-[11px] font-bold text-text mb-1">{s.deliveryTitle}</p>
                  <p className="text-[10px] text-muted leading-relaxed mb-2">
                    {list.delivery_status === 'acked' ? s.ackedNote : list.delivery_status === 'revealed' ? s.revealedNote : s.deliveryTitle}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {list.delivery_status === 'revealed' && (
                      <button
                        type="button"
                        disabled={working !== null || locked}
                        onClick={() => void handleDeliver(list.id, 'reveal-ack')}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-brand text-brand-ink text-[11px] font-bold disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        <span>{s.acknowledgeButton}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={working !== null || locked}
                      onClick={() => void handleDeliver(list.id, 'email')}
                      title="delivery.email_unavailable"
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border-strong text-muted text-[11px] font-bold disabled:opacity-50"
                    >
                      <Mail className="w-3 h-3" />
                      <span>{s.emailTry}</span>
                    </button>
                  </div>
                  <p className="mt-1.5 text-[10px] text-muted leading-relaxed">{s.emailUnavailableNote}</p>
                </div>
              )}

              <ul className="mt-2 text-[11px] text-muted space-y-0.5">
                {list.rows.map((row) => (
                  <li key={row.id} dir="auto">
                    <span dir="ltr">{row.email}</span> · {row.name} · {row.department_resolved || row.department_name || '—'} · {row.role}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <section aria-label={s.completePwTitle} className="bg-surface-2 border border-border rounded-2xl p-4 space-y-2">
        <h4 className="text-sm font-bold text-text">{s.completePwTitle}</h4>
        <p className="text-[11px] text-muted leading-relaxed">{s.completePwHint}</p>
        <p className="text-[11px] text-muted leading-relaxed font-bold">{s.mustChangeNote}</p>
        {pendingAccounts.length === 0 ? (
          <p className="text-[11px] text-muted text-center p-3">{s.pendingPwEmpty}</p>
        ) : (
          <ul className="space-y-2">
            {pendingAccounts.map((account) => (
              <li key={account.id} className="flex flex-col sm:flex-row sm:items-center gap-2 p-2.5 rounded-xl border border-border">
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[11px] text-text truncate" dir="ltr">{account.email}</div>
                  <div className="text-[10px] text-muted truncate" dir="auto">{account.name}</div>
                </div>
                <div className="flex gap-1.5">
                  <input
                    type="password"
                    value={temps[account.id] ?? ''}
                    onChange={(e) => setTemps((prev) => ({ ...prev, [account.id]: e.target.value }))}
                    placeholder={s.tempPasswordPh}
                    disabled={locked}
                    dir="ltr"
                    aria-label={`${s.tempPasswordPh} ${account.email}`}
                    autoComplete="new-password"
                    className="w-44 px-3 py-2 rounded-xl text-[11px] border border-border-strong bg-surface-3 text-text placeholder-muted"
                  />
                  <button
                    type="button"
                    disabled={tempWorking !== null || locked}
                    onClick={() => void handleCompletePassword(account.id)}
                    className="px-3 py-2 rounded-xl bg-brand text-brand-ink text-[11px] font-bold disabled:opacity-50 shrink-0"
                  >
                    {tempWorking === account.id ? s.settingTemp : s.setTempButton}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};
