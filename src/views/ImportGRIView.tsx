import React, { useState, useRef } from 'react';
import {
  UploadCloud,
  FileSpreadsheet,
  Download,
  CheckCircle2,
  AlertTriangle,
  Layers,
  FileText,
  ListFilter,
  Trash2,
  ArrowRight,
  Database,
  RefreshCw,
} from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext.tsx';
import { useAuth } from '../context/AuthContext.tsx';
import { apiFetch } from '../lib/api.ts';
import { ActiveTab } from '../components/Sidebar.tsx';
import { GRIParseResult, ParsedGRIStandard } from '../lib/griParser.ts';

interface ImportGRIViewProps {
  setActiveTab: (tab: ActiveTab) => void;
  onDataImported?: () => void;
}

export const ImportGRIView: React.FC<ImportGRIViewProps> = ({
  setActiveTab,
  onDataImported,
}) => {
  const { t } = useLanguage();
  const { user, token } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [parseResult, setParseResult] = useState<GRIParseResult | null>(null);
  const [activeTab, setActivePreviewTab] = useState<'standards' | 'disclosures' | 'items' | 'warnings'>('standards');
  const [commitSuccess, setCommitSuccess] = useState<boolean>(false);
  const [committedDetails, setCommittedDetails] = useState<{
    standardsCount: number;
    disclosuresCount: number;
    itemsCount: number;
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // B1: platform admins target a tenant explicitly for the import.
  const [tenants, setTenants] = useState<{ id: string; code: string; name: string }[]>([]);
  const [targetTenantId, setTargetTenantId] = useState<string>('');
  const isGeAdmin = user?.role === 'ge_admin';

  // B16-B2: imports are GE-only. The nav hides this screen for client
  // roles; the guard below keeps a direct route from showing a dead form.
  if (!isGeAdmin) {
    return (
      <div className="p-6 bg-surface-2 rounded-2xl border border-border shadow-xs">
        <h3 className="text-xl font-bold text-text">{t.b16.importGeOnlyTitle}</h3>
        <p className="text-xs text-muted mt-2 leading-relaxed">{t.b16.importGeOnlyDesc}</p>
      </div>
    );
  }

  React.useEffect(() => {
    if (!isGeAdmin || !token) return;
    apiFetch('/api/clients', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setTenants(Array.isArray(data) ? data : []))
      .catch(() => setTenants([]));
  }, [isGeAdmin, token]);

  const handleFileSelect = async (selectedFile: File) => {
    setFile(selectedFile);
    setParsing(true);
    setErrorMessage(null);
    setCommitSuccess(false);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const res = await apiFetch('/api/gri/preview', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to parse spreadsheet');
      }

      const result: GRIParseResult = await res.json();
      if (result.errors && result.errors.length > 0) {
        setErrorMessage(result.errors.join('; '));
      }
      setParseResult(result);
    } catch (err: any) {
      setErrorMessage(err.message || 'Error parsing file.');
      setParseResult(null);
    } finally {
      setParsing(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDownloadTemplate = () => {
    window.location.href = '/api/gri/template';
  };

  const handleCommit = async () => {
    if (!parseResult || !parseResult.standards.length) return;

    setCommitting(true);
    setErrorMessage(null);

    try {
      const body: { standards: ParsedGRIStandard[]; clientId?: string } = {
        standards: parseResult.standards,
      };
      if (isGeAdmin && targetTenantId) {
        body.clientId = targetTenantId;
      }
      const res = await apiFetch('/api/gri/commit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token ? `Bearer ${token}` : '',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Commit to database failed');
      }

      const data = await res.json();
      setCommitSuccess(true);
      setCommittedDetails({
        standardsCount: data.standardsCount,
        disclosuresCount: data.disclosuresCount,
        itemsCount: data.itemsCount,
      });

      if (onDataImported) {
        onDataImported();
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to commit GRI disclosures to database.');
    } finally {
      setCommitting(false);
    }
  };

  const handleClear = () => {
    setFile(null);
    setParseResult(null);
    setCommitSuccess(false);
    setErrorMessage(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Flatten disclosures and items for preview tables
  const allDisclosures = parseResult?.standards.flatMap((s) =>
    s.disclosures.map((d) => ({
      ...d,
      standardCode: s.code,
      standardTitle: s.title,
    }))
  ) || [];

  const allItems = allDisclosures.flatMap((d) =>
    d.items.map((i) => ({
      ...i,
      standardCode: d.standardCode,
      disclosureCode: d.code,
      disclosureTitle: d.title,
    }))
  );

  return (
    <div className="space-y-6">
      {/* Header and Download Template Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-6 bg-surface-2 rounded-2xl border border-border shadow-xs">
        <div>
          <h3 className="text-xl font-bold text-text">
            {t.importGRI.title}
          </h3>
          <p className="text-xs text-muted mt-1">
            {t.importGRI.subtitle}
          </p>
        </div>

        <button
          onClick={handleDownloadTemplate}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border-strong text-text text-xs font-semibold hover:bg-surface-3 transition-colors shrink-0 shadow-xs"
        >
          <Download className="w-4 h-4 text-brand-text" />
          <span>{t.importGRI.downloadTemplate}</span>
        </button>
      </div>

      {/* Commit Success Banner */}
      {commitSuccess && committedDetails && (
        <div className="p-6 rounded-2xl bg-success-soft border border-success text-success-text shadow-xs">
          <div className="flex items-start gap-4">
            <div className="p-2 rounded-xl bg-brand text-brand-ink shrink-0 mt-0.5">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <h4 className="font-bold text-base text-success-text">
                {t.importGRI.committedSuccess}
              </h4>
              <p className="text-xs text-success-text mt-1 leading-relaxed">
                {t.importGRI.committedDescription}
              </p>
              <div className="flex flex-wrap gap-4 mt-3 text-xs font-semibold">
                <span className="px-3 py-1 rounded-full bg-surface-2 text-success-text">
                  {committedDetails.standardsCount} {t.importGRI.standardsFound}
                </span>
                <span className="px-3 py-1 rounded-full bg-surface-2 text-success-text">
                  {committedDetails.disclosuresCount} {t.importGRI.disclosuresFound}
                </span>
                <span className="px-3 py-1 rounded-full bg-surface-2 text-success-text">
                  {committedDetails.itemsCount} {t.importGRI.itemsFound}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={() => setActiveTab('dashboard')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand text-brand-ink text-xs font-semibold hover:bg-brand-strong transition-colors"
                >
                  <span>{t.nav.dashboard}</span>
                  <ArrowRight className="w-3.5 h-3.5 rtl:rotate-180" />
                </button>
                <button
                  onClick={() => setActiveTab('standards')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-success text-success-text text-xs font-medium hover:bg-surface-2 transition-colors"
                >
                  <span>{t.nav.standards}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error Message */}
      {errorMessage && (
        <div className="p-4 rounded-xl bg-danger-soft border border-danger text-danger text-xs flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0 text-danger" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* File Upload Zone */}
      {!parseResult && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          className="border-2 border-dashed border-border-strong hover:border-brand rounded-2xl p-10 text-center bg-surface-3 transition-colors cursor-pointer group"
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={(e) => e.target.files && e.target.files[0] && handleFileSelect(e.target.files[0])}
            accept=".xlsx,.xls,.csv"
            className="hidden"
          />

          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-brand-soft group-hover:scale-105 transition-transform flex items-center justify-center text-brand-text">
            {parsing ? (
              <RefreshCw className="w-8 h-8 animate-spin" />
            ) : (
              <UploadCloud className="w-8 h-8" />
            )}
          </div>

          <h4 className="text-base font-bold text-text mb-1">
            {t.importGRI.dragDropText}
          </h4>

          <p className="text-xs text-muted mb-6">
            {t.importGRI.acceptedFormats}
          </p>

          <button
            type="button"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand text-brand-ink font-medium text-xs hover:bg-brand-strong shadow-xs transition-colors"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>{t.importGRI.browseFiles}</span>
          </button>
        </div>
      )}

      {/* Extracted Preview Panel */}
      {parseResult && (
        <div className="space-y-4">
          {/* Summary KPI Badges & Commit Bar */}
          <div className="p-5 bg-surface-2 rounded-2xl border border-border flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xs">
            <div className="flex flex-wrap items-center gap-3">
              <div className="px-3.5 py-1.5 rounded-xl bg-surface-3 text-xs">
                <span className="text-muted block text-[10px] uppercase font-bold">
                  {t.importGRI.standardsFound}
                </span>
                <span className="font-extrabold text-base text-text">
                  {parseResult.summary.totalStandards}
                </span>
              </div>

              <div className="px-3.5 py-1.5 rounded-xl bg-surface-3 text-xs">
                <span className="text-muted block text-[10px] uppercase font-bold">
                  {t.importGRI.disclosuresFound}
                </span>
                <span className="font-extrabold text-base text-text">
                  {parseResult.summary.totalDisclosures}
                </span>
              </div>

              <div className="px-3.5 py-1.5 rounded-xl bg-surface-3 text-xs">
                <span className="text-muted block text-[10px] uppercase font-bold">
                  {t.importGRI.itemsFound}
                </span>
                <span className="font-extrabold text-base text-text">
                  {parseResult.summary.totalItems}
                </span>
              </div>

              {parseResult.warnings.length > 0 && (
                <div className="px-3.5 py-1.5 rounded-xl bg-warning-soft border border-warning text-xs">
                  <span className="text-warning-text block text-[10px] uppercase font-bold">
                    {t.importGRI.warningsTab}
                  </span>
                  <span className="font-extrabold text-base text-warning-text">
                    {parseResult.warnings.length}
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleClear}
                className="px-4 py-2.5 rounded-xl border border-border-strong text-text hover:bg-surface-3 text-xs font-semibold flex items-center gap-1.5 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{t.importGRI.clearFile}</span>
              </button>

              <button
                onClick={handleCommit}
                disabled={committing || commitSuccess}
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-brand hover:bg-brand-strong text-brand-ink text-xs font-bold shadow-md disabled:opacity-50 transition-colors"
              >
                {committing ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Database className="w-4 h-4" />
                )}
                <span>{committing ? t.importGRI.committing : t.importGRI.commitButton}</span>
              </button>
            </div>
          </div>

          {/* B1: explicit target tenant for platform admins */}
          {isGeAdmin && (
            <div className="px-5 pb-5 -mt-3 bg-surface-2 rounded-b-2xl border border-t-0 border-border shadow-xs">
              <label className="block text-[11px] font-bold text-muted mb-1.5">
                {t.importGRI.targetTenantLabel}
              </label>
              <select
                value={targetTenantId}
                onChange={(e) => setTargetTenantId(e.target.value)}
                className="w-full sm:max-w-sm px-3 py-2 rounded-xl text-xs bg-surface-3 border border-border-strong text-text focus:outline-none focus:ring-2 focus:ring-focus-ring/30"
              >
                <option value="">{t.importGRI.selectTenantPlaceholder}</option>
                {tenants.map((tn) => (
                  <option key={tn.id} value={tn.id}>
                    {tn.name} ({tn.code})
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted mt-1.5">
                {t.importGRI.targetTenantHint}
              </p>
            </div>
          )}

          {/* Tab Navigation */}
          <div className="flex items-center border-b border-border">
            <button
              onClick={() => setActivePreviewTab('standards')}
              className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-colors ${
                activeTab === 'standards'
                  ? 'border-brand text-brand-text'
                  : 'border-transparent text-muted hover:text-text'
              }`}
            >
              {t.importGRI.standardsTab} ({parseResult.standards.length})
            </button>
            <button
              onClick={() => setActivePreviewTab('disclosures')}
              className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-colors ${
                activeTab === 'disclosures'
                  ? 'border-brand text-brand-text'
                  : 'border-transparent text-muted hover:text-text'
              }`}
            >
              {t.importGRI.disclosuresTab} ({allDisclosures.length})
            </button>
            <button
              onClick={() => setActivePreviewTab('items')}
              className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-colors ${
                activeTab === 'items'
                  ? 'border-brand text-brand-text'
                  : 'border-transparent text-muted hover:text-text'
              }`}
            >
              {t.importGRI.itemsTab} ({allItems.length})
            </button>
            {parseResult.warnings.length > 0 && (
              <button
                onClick={() => setActivePreviewTab('warnings')}
                className={`px-4 py-2.5 text-xs font-bold border-b-2 transition-colors ${
                  activeTab === 'warnings'
                    ? 'border-warning text-warning-text'
                    : 'border-transparent text-muted hover:text-text'
                }`}
              >
                {t.importGRI.warningsTab} ({parseResult.warnings.length})
              </button>
            )}
          </div>

          {/* Table Container */}
          <div className="bg-surface-2 rounded-2xl border border-border overflow-hidden shadow-xs">
            {activeTab === 'standards' && (
              <div className="overflow-x-auto">
                <table className="w-full text-start text-xs">
                  <thead className="bg-surface-3 border-b border-border text-muted font-semibold uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="px-4 py-3 text-start">{t.importGRI.standardCode}</th>
                      <th className="px-4 py-3 text-start">{t.importGRI.standardTitle}</th>
                      <th className="px-4 py-3 text-start">{t.importGRI.category}</th>
                      <th className="px-4 py-3 text-start">{t.importGRI.version}</th>
                      <th className="px-4 py-3 text-end">{t.importGRI.disclosuresTab}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border text-text">
                    {parseResult.standards.map((std, idx) => (
                      <tr key={idx} className="hover:bg-surface-3">
                        <td className="px-4 py-3 font-bold text-brand-text" dir="ltr">
                          {std.code}
                        </td>
                        <td className="px-4 py-3 font-medium">{std.title}</td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-surface-3 text-muted">
                            {std.category}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted">{std.version || '2021'}</td>
                        <td className="px-4 py-3 text-end font-semibold">{std.disclosures.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === 'disclosures' && (
              <div className="overflow-x-auto">
                <table className="w-full text-start text-xs">
                  <thead className="bg-surface-3 border-b border-border text-muted font-semibold uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="px-4 py-3 text-start">{t.importGRI.standardCode}</th>
                      <th className="px-4 py-3 text-start">{t.importGRI.disclosureCode}</th>
                      <th className="px-4 py-3 text-start">{t.importGRI.disclosureTitle}</th>
                      <th className="px-4 py-3 text-end">{t.importGRI.itemsTab}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border text-text">
                    {allDisclosures.map((disc, idx) => (
                      <tr key={idx} className="hover:bg-surface-3">
                        <td className="px-4 py-3 text-muted font-medium" dir="ltr">{disc.standardCode}</td>
                        <td className="px-4 py-3 font-bold text-brand-text" dir="ltr">
                          {disc.code}
                        </td>
                        <td className="px-4 py-3 font-medium">{disc.title}</td>
                        <td className="px-4 py-3 text-end font-semibold">{disc.items.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === 'items' && (
              <div className="overflow-x-auto">
                <table className="w-full text-start text-xs">
                  <thead className="bg-surface-3 border-b border-border text-muted font-semibold uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="px-4 py-3 text-start">{t.importGRI.itemCode}</th>
                      <th className="px-4 py-3 text-start">{t.importGRI.priority}</th>
                      <th className="px-4 py-3 text-start">{t.importGRI.esgClass}</th>
                      <th className="px-4 py-3 text-start">{t.importGRI.weight}</th>
                      <th className="px-4 py-3 text-start">{t.importGRI.answerType}</th>
                      <th className="px-4 py-3 text-start">{t.importGRI.requirement}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border text-text">
                    {allItems.map((item, idx) => (
                      <tr key={idx} className="hover:bg-surface-3">
                        <td className="px-4 py-3 font-bold text-text" dir="ltr">
                          {item.code}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                              item.priority === 'high'
                                ? 'bg-danger-soft text-danger'
                                : item.priority === 'mid'
                                ? 'bg-warning-soft text-warning-text'
                                : 'bg-surface-3 text-muted'
                            }`}
                          >
                            {item.priority}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="capitalize text-muted font-medium">
                            {item.esgClass}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-semibold">{item.weight}</td>
                        <td className="px-4 py-3 text-muted font-mono text-[11px]">
                          {item.answerType}
                        </td>
                        <td className="px-4 py-3 max-w-md truncate" title={item.requirement}>
                          {item.requirement}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === 'warnings' && (
              <div className="p-6 space-y-2">
                {parseResult.warnings.map((w, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-lg bg-warning-soft text-warning-text text-xs flex items-center gap-2"
                  >
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};