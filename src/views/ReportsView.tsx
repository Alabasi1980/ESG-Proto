import React, { useCallback, useEffect, useState } from 'react';
import {
  FileText,
  Download,
  Printer,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
} from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';

type ReportLevel = 'L1' | 'L2' | 'L3';

interface ReportIndexRow {
  standardCode: string;
  standardTitle: string;
  disclosureCode: string;
  disclosureTitle: string;
  location: string | null;
  locationComplete: boolean;
  omitted: boolean;
  omissionReason: string | null;
  omissionExplanation: string | null;
  incomplete: boolean;
  evaluatedItems: number;
  applicableItems: number;
  coveragePercentage: number;
  score: number | null;
  itemsCount: number;
  departments: string[];
}

interface ReportPayload {
  clientId: string;
  serviceId: string | null;
  level: ReportLevel;
  settings: {
    disclosureLevel: string;
    reportLevel: string;
    statementName: string;
    statementPeriod: string;
    notified: string | null;
    notifiedDate: string | null;
    notifyRef: string | null;
  };
  visibility: { role: string; showGap: boolean; showCorrective: boolean };
  aggregate: {
    aggregateScore: number | null;
    coveragePercentage: number;
    evaluatedCount: number;
    applicableCount: number;
    notApplicableCount: number;
    notEvaluatedCount: number;
    fullGapCount: number;
    partialGapCount: number;
    noGapCount: number;
  };
  departments: {
    departmentId: string;
    departmentName: string;
    score: number | null;
    coveragePercentage: number;
    evaluatedItems: number;
    applicableItems: number;
  }[];
  actions: { byStatus: Record<string, number>; showCorrective: boolean };
  omissions: { disclosureCode: string; disclosureTitle: string; reason: string | null; explanation: string | null }[];
  topGaps: ReportIndexRow[];
  index: ReportIndexRow[];
  meta: { disclosureCount: number; omittedCount: number; locationGaps: string[] };
}

interface SettingsState {
  disclosureLevel: string;
  reportLevel: string;
  statementName: string;
  statementPeriod: string;
  notified: string;
  notifiedDate: string;
  notifyRef: string;
}

const EMPTY_SETTINGS: SettingsState = {
  disclosureLevel: '',
  reportLevel: '',
  statementName: '',
  statementPeriod: '',
  notified: '',
  notifiedDate: '',
  notifyRef: '',
};

function fmtScore(v: number | null): string {
  return v === null || v === undefined ? '—' : `${v}%`;
}

export const ReportsView: React.FC = () => {
  const { t } = useLanguage();
  const { user, token } = useAuth();
  const R = t.reports;

  const [level, setLevel] = useState<ReportLevel>('L1');
  const [settings, setSettings] = useState<SettingsState>(EMPTY_SETTINGS);
  const [gateOk, setGateOk] = useState<boolean | null>(null);
  const [gateRefusal, setGateRefusal] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [payload, setPayload] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [incompleteCodes, setIncompleteCodes] = useState<string[]>([]);

  const isAdmin = user?.role === 'ge_admin' || user?.role === 'client_admin';

  const authHeaders = useCallback((): Record<string, string> => {
    const h: Record<string, string> = {};
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  }, [token]);

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/report-settings', { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      setGateOk(Boolean(data?.gate?.ok));
      if (!data?.gate?.ok) setGateRefusal(data?.gate?.refusal ?? null);
      else setGateRefusal(null);
      const s = data?.settings;
      if (s) {
        setSettings({
          disclosureLevel: s.disclosure_level ?? '',
          reportLevel: s.report_level ?? '',
          statementName: s.statement_name ?? '',
          statementPeriod: s.statement_period ?? '',
          notified: s.notified ?? '',
          notifiedDate: typeof s.notified_date === 'string' ? s.notified_date.slice(0, 10) : '',
          notifyRef: s.notify_ref ?? '',
        });
      }
    } catch {
      // Settings load is best-effort; the report fetch carries its own gate proof.
    }
  }, [authHeaders]);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    setIncompleteCodes([]);
    try {
      const res = await fetch(`/api/reports/index?level=${level}`, { headers: authHeaders() });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setPayload(null);
        setGateOk(false);
        setGateRefusal(data?.error ?? null);
        return;
      }
      if (res.status === 422) {
        setPayload(null);
        setError(data?.error ?? R.loadError);
        setIncompleteCodes(Array.isArray(data?.offendingCodes) ? data.offendingCodes : []);
        return;
      }
      if (!res.ok) {
        setPayload(null);
        setError(data?.error ?? R.loadError);
        return;
      }
      setPayload(data);
      setGateOk(true);
      setGateRefusal(null);
      if (data?.level && data.level !== level) {
        // Server echoes the validated level; keep UI in sync without guessing.
      }
    } catch {
      setPayload(null);
      setError(R.loadError);
    } finally {
      setLoading(false);
    }
  }, [authHeaders, level, R.loadError]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const saveSettings = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch('/api/report-settings', {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          disclosureLevel: settings.disclosureLevel || undefined,
          reportLevel: settings.reportLevel || undefined,
          statementName: settings.statementName || undefined,
          statementPeriod: settings.statementPeriod || undefined,
          notified: settings.notified || undefined,
          notifiedDate: settings.notifiedDate || undefined,
          notifyRef: settings.notifyRef || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setGateOk(false);
        setGateRefusal(data?.error ?? null);
        setSaveMsg(null);
        return;
      }
      if (!res.ok) {
        setSaveMsg(data?.error ?? R.loadError);
        return;
      }
      setSaveMsg(R.savedMsg);
      setGateOk(true);
      setGateRefusal(null);
      loadReport();
    } catch {
      setSaveMsg(R.loadError);
    } finally {
      setSaving(false);
    }
  };

  const downloadExport = async (format: 'json' | 'csv') => {
    try {
      const res = await fetch(`/api/reports/export?level=${level}&format=${format}`, {
        headers: authHeaders(),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? R.loadError);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gri-report-${level}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError(R.loadError);
    }
  };

  const reasonLabel = (code: string | null): string =>
    (code && (R.reasonLabels as Record<string, string>)[code]) || code || '—';

  const renderGateBanner = () => {
    if (gateOk === null) return null;
    return (
      <div
        className={`flex items-start gap-3 p-4 rounded-xl border text-sm ${
          gateOk
            ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-200'
            : 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800/60 text-rose-800 dark:text-rose-200'
        }`}
      >
        {gateOk ? <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" /> : <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />}
        <div>
          <p className="font-semibold">{gateOk ? R.gateOk : R.gateBlocked}</p>
          {!gateOk && gateRefusal && <p className="mt-1 text-xs leading-relaxed">{gateRefusal}</p>}
        </div>
      </div>
    );
  };

  const renderL1 = (p: ReportPayload) => (
    <div className="space-y-4">
      <p className="text-xs text-slate-500 dark:text-slate-400">{R.levelDescL1}</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">{R.headlineScore}</div>
          <div className="text-3xl font-extrabold text-slate-900 dark:text-white">{fmtScore(p.aggregate.aggregateScore)}</div>
          <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
            {R.coverage}: {p.aggregate.coveragePercentage}% ({p.aggregate.evaluatedCount} / {p.aggregate.applicableCount})
          </div>
        </div>
        <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">{R.coverage}</div>
          <div className="text-3xl font-extrabold text-slate-900 dark:text-white">{p.aggregate.coveragePercentage}%</div>
          <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
            {R.items}: {p.aggregate.evaluatedCount} / {p.aggregate.applicableCount}
          </div>
        </div>
        <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">{R.omissionsSummary}</div>
          <div className="text-3xl font-extrabold text-slate-900 dark:text-white">{p.meta.omittedCount}</div>
          <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
            {R.disclosure}: {p.meta.disclosureCount}
          </div>
        </div>
      </div>
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 p-5">
        <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-3">{R.topGaps}</h4>
        {p.topGaps.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">{R.noOmissions}</p>
        ) : (
          <ul className="space-y-2">
            {p.topGaps.map((g) => (
                <li key={g.disclosureCode} className="flex items-center justify-between gap-3 text-sm p-2 rounded-lg bg-slate-50 dark:bg-slate-700/40">
                  <span className="font-medium text-slate-800 dark:text-slate-100">
                    <span dir="ltr">{g.standardCode} · {g.disclosureCode}</span> — {g.disclosureTitle}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0" dir="ltr">
                    {fmtScore(g.score)} · {R.coverage} {g.coveragePercentage}%
                  </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  const renderL2 = (p: ReportPayload) => (
    <div className="space-y-4">
      <p className="text-xs text-slate-500 dark:text-slate-400">{R.levelDescL2}</p>
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 p-5">
        <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-3">{R.byDepartment}</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-start text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                <th className="py-2 pe-3 text-start font-medium">{R.departments}</th>
                <th className="py-2 pe-3 text-start font-medium">{R.score}</th>
                <th className="py-2 text-start font-medium">{R.coverage}</th>
              </tr>
            </thead>
            <tbody>
              {p.departments.map((d) => (
                <tr key={d.departmentId} className="border-b border-slate-100 dark:border-slate-700/50 text-slate-800 dark:text-slate-100">
                  <td className="py-2 pe-3">{d.departmentName}</td>
                  <td className="py-2 pe-3 font-semibold">{fmtScore(d.score)}</td>
                  <td className="py-2 text-xs text-slate-500 dark:text-slate-400">
                    {d.coveragePercentage}% ({d.evaluatedItems} / {d.applicableItems})
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {p.visibility.showCorrective && (
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 p-5">
          <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-3">{R.actionsSummary}</h4>
          <div className="flex flex-wrap gap-2">
            {Object.keys(p.actions.byStatus).length === 0 && (
              <p className="text-xs text-slate-500 dark:text-slate-400">—</p>
            )}
            {Object.entries(p.actions.byStatus).map(([st, n]) => (
              <span key={st} className="px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200">
                {st}: {n}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 p-5">
        <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-3">{R.omissionsSummary}</h4>
        {p.omissions.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">{R.noOmissions}</p>
        ) : (
          <ul className="space-y-2">
            {p.omissions.map((o) => (
                <li key={o.disclosureCode} className="text-sm p-3 rounded-lg bg-slate-50 dark:bg-slate-700/40">
                  <div className="font-medium text-slate-800 dark:text-slate-100">
                    <span dir="ltr">{o.disclosureCode}</span> — {o.disclosureTitle}
                  </div>
                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {R.reason}: {reasonLabel(o.reason)} · {R.explanation}: {o.explanation ?? '—'}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );

  const renderL3 = (p: ReportPayload) => (
    <div className="space-y-4">
      <p className="text-xs text-slate-500 dark:text-slate-400">{R.levelDescL3}</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 p-5">
          <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-3">{R.statementTitle}</h4>
          <dl className="space-y-2 text-sm">
            <div className="flex gap-2">
              <dt className="text-slate-500 dark:text-slate-400 shrink-0">{R.statementName}:</dt>
              <dd className="font-medium text-slate-800 dark:text-slate-100">{p.settings.statementName}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-slate-500 dark:text-slate-400 shrink-0">{R.statementPeriod}:</dt>
              <dd className="font-medium text-slate-800 dark:text-slate-100">{p.settings.statementPeriod}</dd>
            </div>
          </dl>
        </div>
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 p-5">
          <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-3">{R.notificationTitle}</h4>
          <dl className="space-y-2 text-sm">
            <div className="flex gap-2">
              <dt className="text-slate-500 dark:text-slate-400 shrink-0">{R.notificationTitle}:</dt>
              <dd className="font-medium text-slate-800 dark:text-slate-100">
                {p.settings.notified === 'done' ? R.notifiedDone : R.notifiedNotDone}
              </dd>
            </div>
            {p.settings.notifiedDate && (
              <div className="flex gap-2">
                <dt className="text-slate-500 dark:text-slate-400 shrink-0">{R.notifiedDate}:</dt>
                <dd className="font-medium text-slate-800 dark:text-slate-100">{p.settings.notifiedDate.slice(0, 10)}</dd>
              </div>
            )}
            {p.settings.notifyRef && (
              <div className="flex gap-2">
                <dt className="text-slate-500 dark:text-slate-400 shrink-0">{R.notifyRef}:</dt>
                <dd className="font-medium text-slate-800 dark:text-slate-100">{p.settings.notifyRef}</dd>
              </div>
            )}
          </dl>
          <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">{R.notificationRecordNote}</p>
        </div>
      </div>
      <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 p-5">
        <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-3">
          {R.disclosure} ({p.meta.disclosureCount})
        </h4>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-start text-xs text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                <th className="py-2 pe-3 text-start font-medium">{R.standard}</th>
                <th className="py-2 pe-3 text-start font-medium">{R.disclosure}</th>
                <th className="py-2 pe-3 text-start font-medium">{R.location}</th>
                <th className="py-2 pe-3 text-start font-medium">{R.omission}</th>
                <th className="py-2 pe-3 text-start font-medium">{R.score}</th>
                <th className="py-2 text-start font-medium">{R.coverage}</th>
              </tr>
            </thead>
            <tbody>
              {p.index.map((row) => (
                <tr key={row.disclosureCode} className="border-b border-slate-100 dark:border-slate-700/50 align-top">
                  <td className="py-2 pe-3 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap" dir="ltr">
                    {row.standardCode}
                    <div className="max-w-40 truncate" title={row.standardTitle}>{row.standardTitle}</div>
                  </td>
                  <td className="py-2 pe-3">
                    <div className="font-medium text-slate-800 dark:text-slate-100" dir="ltr">{row.disclosureCode}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">{row.disclosureTitle}</div>
                    <div className="text-[11px] text-slate-400 dark:text-slate-500">{row.departments.join(' · ')}</div>
                  </td>
                  <td className="py-2 pe-3 text-xs text-slate-600 dark:text-slate-300 max-w-xs">
                    {row.location ?? <span className="italic text-slate-400">{R.locationMissing}</span>}
                  </td>
                  <td className="py-2 pe-3 text-xs">
                    {row.omitted ? (
                      <span>
                        <span className="font-semibold text-amber-700 dark:text-amber-300">{R.omittedYes}</span>
                        <div className="text-slate-500 dark:text-slate-400">
                          {R.reason}: {reasonLabel(row.omissionReason)}
                        </div>
                        <div className="text-slate-500 dark:text-slate-400">
                          {R.explanation}: {row.omissionExplanation ?? '—'}
                        </div>
                      </span>
                    ) : (
                      <span className="text-slate-400">{R.omittedNo}</span>
                    )}
                  </td>
                  <td className="py-2 pe-3 font-semibold whitespace-nowrap" dir="ltr">{fmtScore(row.score)}</td>
                  <td className="py-2 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap" dir="ltr">
                    {row.coveragePercentage}% ({row.evaluatedItems}/{row.applicableItems})
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  /** Print-optimized rendering: plain tables, no chrome, inherits dir (RTL-safe). */
  const renderPrint = (p: ReportPayload) => (
    <div className="hidden print:block text-black text-xs">
      <h1 className="text-lg font-bold">{R.title} — {level}</h1>
      <p>{p.settings.statementName} · {p.settings.statementPeriod}</p>
      <p>
        {R.headlineScore}: {fmtScore(p.aggregate.aggregateScore)} · {R.coverage}: {p.aggregate.coveragePercentage}% (
        {p.aggregate.evaluatedCount}/{p.aggregate.applicableCount})
      </p>
      <h2 className="mt-3 font-bold">{R.notificationTitle}: {p.settings.notified === 'done' ? R.notifiedDone : R.notifiedNotDone}</h2>
      {p.settings.notifiedDate && <p>{R.notifiedDate}: {p.settings.notifiedDate.slice(0, 10)}</p>}
      {p.settings.notifyRef && <p>{R.notifyRef}: {p.settings.notifyRef}</p>}
      <h2 className="mt-3 font-bold">{R.disclosure} ({p.meta.disclosureCount})</h2>
      <table className="w-full mt-1 border-collapse">
        <thead>
          <tr>
            {[R.standard, R.disclosure, R.location, R.omission, R.score, R.coverage].map((h) => (
              <th key={h} className="border border-slate-400 px-1 py-0.5 text-start">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {p.index.map((row) => (
            <tr key={row.disclosureCode}>
              <td className="border border-slate-300 px-1 py-0.5" dir="ltr">{row.standardCode}</td>
              <td className="border border-slate-300 px-1 py-0.5"><span dir="ltr">{row.disclosureCode}</span> — {row.disclosureTitle}</td>
              <td className="border border-slate-300 px-1 py-0.5">{row.location ?? R.locationMissing}</td>
              <td className="border border-slate-300 px-1 py-0.5">
                {row.omitted ? `${R.omittedYes} (${reasonLabel(row.omissionReason)}: ${row.omissionExplanation ?? '—'})` : R.omittedNo}
              </td>
              <td className="border border-slate-300 px-1 py-0.5" dir="ltr">{fmtScore(row.score)}</td>
              <td className="border border-slate-300 px-1 py-0.5" dir="ltr">{row.coveragePercentage}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-6">
      {payload && renderPrint(payload)}

      <div className="print:hidden space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60">
          <div>
            <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <FileText className="w-5 h-5 text-emerald-600" />
              {R.title}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{R.subtitle}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => downloadExport('json')}
              disabled={!payload}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 disabled:opacity-40"
            >
              <Download className="w-3.5 h-3.5" />
              {R.exportJson}
            </button>
            <button
              onClick={() => downloadExport('csv')}
              disabled={!payload}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50 disabled:opacity-40"
            >
              <Download className="w-3.5 h-3.5" />
              {R.exportCsv}
            </button>
            <button
              onClick={() => window.print()}
              disabled={!payload}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 hover:opacity-90 disabled:opacity-40"
            >
              <Printer className="w-3.5 h-3.5" />
              {R.printBtn}
            </button>
          </div>
        </div>

        {renderGateBanner()}

        {/* Settings (admins only) */}
        {isAdmin && (
          <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700/60 p-5">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white mb-1 flex items-center gap-2">
              <Settings2 className="w-4 h-4 text-emerald-600" />
              {R.settingsTitle}
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">{R.settingsDesc}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{R.disclosureLevel}</span>
                <select
                  value={settings.disclosureLevel}
                  onChange={(e) => setSettings((s) => ({ ...s, disclosureLevel: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                >
                  <option value="">—</option>
                  <option value="in-accordance">{R.inAccordance}</option>
                  <option value="with-reference">{R.withReference}</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{R.reportLevel}</span>
                <select
                  value={settings.reportLevel}
                  onChange={(e) => setSettings((s) => ({ ...s, reportLevel: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                >
                  <option value="">—</option>
                  <option value="L1">{R.levelTabL1}</option>
                  <option value="L2">{R.levelTabL2}</option>
                  <option value="L3">{R.levelTabL3}</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{R.statementName}</span>
                <input
                  value={settings.statementName}
                  onChange={(e) => setSettings((s) => ({ ...s, statementName: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{R.statementPeriod}</span>
                <input
                  value={settings.statementPeriod}
                  onChange={(e) => setSettings((s) => ({ ...s, statementPeriod: e.target.value }))}
                  placeholder="2026"
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{R.notificationTitle}</span>
                <select
                  value={settings.notified}
                  onChange={(e) => setSettings((s) => ({ ...s, notified: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                >
                  <option value="">—</option>
                  <option value="done">{R.notifiedDone}</option>
                  <option value="not-done">{R.notifiedNotDone}</option>
                </select>
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{R.notifiedDate}</span>
                <input
                  type="date"
                  value={settings.notifiedDate}
                  onChange={(e) => setSettings((s) => ({ ...s, notifiedDate: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{R.notifyRef}</span>
                <input
                  value={settings.notifyRef}
                  onChange={(e) => setSettings((s) => ({ ...s, notifyRef: e.target.value }))}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />
              </label>
            </div>
            <p className="mt-3 text-[11px] text-slate-500 dark:text-slate-400">{R.notificationRecordNote}</p>
            <div className="mt-3 flex items-center gap-3">
              <button
                onClick={saveSettings}
                disabled={saving}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? R.saving : R.saveSettings}
              </button>
              {saveMsg && <span className="text-xs text-emerald-700 dark:text-emerald-300">{saveMsg}</span>}
            </div>
          </div>
        )}

        {/* Level tabs */}
        <div className="flex items-center gap-2">
          {(['L1', 'L2', 'L3'] as ReportLevel[]).map((lv) => (
            <button
              key={lv}
              onClick={() => setLevel(lv)}
              className={`px-4 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                level === lv
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'
              }`}
            >
              {lv === 'L1' ? R.levelTabL1 : lv === 'L2' ? R.levelTabL2 : R.levelTabL3}
            </button>
          ))}
          <button
            onClick={loadReport}
            className="ms-auto p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700"
            title={R.loading}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Body */}
        {loading && <p className="text-sm text-slate-500 dark:text-slate-400">{R.loading}</p>}
        {error && (
          <div className="p-4 rounded-xl border border-rose-200 dark:border-rose-800/60 bg-rose-50 dark:bg-rose-950/30 text-sm text-rose-800 dark:text-rose-200">
            <p className="font-semibold">{R.incompleteTitle}</p>
            <p className="mt-1 text-xs leading-relaxed">{error}</p>
            {incompleteCodes.length > 0 && (
              <p className="mt-2 text-xs font-mono">{incompleteCodes.join(', ')}</p>
            )}
          </div>
        )}
        {!loading && !error && !payload && gateOk === false && (
          <p className="text-sm text-slate-500 dark:text-slate-400">{R.selectLevelHint}</p>
        )}
        {!loading && !error && payload && (
          <>{level === 'L1' ? renderL1(payload) : level === 'L2' ? renderL2(payload) : renderL3(payload)}</>
        )}
      </div>
    </div>
  );
};
