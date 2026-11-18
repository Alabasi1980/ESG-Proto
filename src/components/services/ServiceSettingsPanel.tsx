import React from 'react';
import { Save } from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext.tsx';
import { ANSWER_TYPES, FIELD_CLS } from './ServiceContentPanel.tsx';
/**
 * TASK-PROTO-U4-2-FIX P5 §UI-1 — the settings tab (identity + named fields).
 *
 * Pure presentational split from ServicesView (W-P5-01 file hygiene): the view
 * keeps ALL state, fetches and writes (identity/named-settings PATCH); this
 * panel owns only the two cards' JSX. Props are pass-through data/callbacks.
 * The raw JSON settings editor stays deleted — only the closed named-key set
 * below is ever written (DG-03/C3).
 */
// --- P5 named settings (DG-03/C3): the closed key set the UI may write.
// The server keeps its plain-object ≤ 8 KB contract (no whitelist — see the
// P2 pin); the CLOSEDNESS lives here, owner-visible, with labels/hints in i18n.
// (Moved verbatim from ServicesView.tsx — W-P5-01 pure move, zero behavior change.)
export const NAMED_SETTINGS_KEYS = [
  'default_answer_type', 'default_priority', 'default_esg_class',
  'attachment_required_default', 'report_visible_default',
] as const;
export type NamedSettingsKey = (typeof NAMED_SETTINGS_KEYS)[number];
export interface ServiceNamedSettings {
  default_answer_type: string; default_priority: string; default_esg_class: string;
  attachment_required_default: boolean; report_visible_default: boolean;
}
export const DEFAULT_NAMED_SETTINGS: ServiceNamedSettings = {
  default_answer_type: 'text', default_priority: 'mid', default_esg_class: 'general',
  attachment_required_default: false, report_visible_default: true,
};
/** Field look without a width (same per-file pattern as the view and rail). */
const inputCls = `w-full ${FIELD_CLS}`;
const cardCls = 'bg-surface-2 border border-border rounded-2xl p-4 space-y-3';
const primaryBtn = 'inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-brand text-brand-ink hover:bg-brand-strong disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-focus-ring/40';
const secondaryBtn = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold bg-surface-2 border border-border-strong text-text hover:bg-surface-3 focus:outline-none focus:ring-2 focus:ring-focus-ring/30';

interface ServiceSettingsPanelProps {
  serviceCode: string;
  identity: { name: string; description: string };
  onIdentity: (next: { name: string; description: string }) => void;
  namedSettings: ServiceNamedSettings;
  onNamedSettings: (next: ServiceNamedSettings) => void;
  settingsEcho: string | null;
  busy: boolean;
  frozen: boolean;
  frozenBanner: React.ReactNode;
  onSaveIdentity: () => void;
  onSaveNamedSettings: () => void;
}
export const ServiceSettingsPanel: React.FC<ServiceSettingsPanelProps> = ({
  serviceCode, identity, onIdentity, namedSettings, onNamedSettings,
  settingsEcho, busy, frozen, frozenBanner, onSaveIdentity, onSaveNamedSettings,
}) => {
  const { t } = useLanguage();
  const s = t.servicesWorkspace;
  return (
    <div className="space-y-3">
      {frozenBanner}
      <div className={cardCls}>
        <h2 className="text-xs font-bold text-text">{s.identityTitle}</h2>
        <label className="block text-[10px] font-semibold text-text">{t.services.codeLabel}
          <input value={serviceCode} readOnly dir="ltr" className={`${inputCls} mt-1 opacity-70`} /></label>
        <label className="block text-[10px] font-semibold text-text">{t.services.nameLabel}
          <input value={identity.name} onChange={(e) => onIdentity({ ...identity, name: e.target.value })} className={`${inputCls} mt-1`} /></label>
        <label className="block text-[10px] font-semibold text-text">{t.services.descLabel}
          <textarea value={identity.description} onChange={(e) => onIdentity({ ...identity, description: e.target.value })} rows={2} dir="auto" className={`${inputCls} mt-1`} /></label>
        <button type="button" disabled={busy || frozen} title={frozen ? s.frozenScopeBanner : undefined} onClick={() => void onSaveIdentity()} className={primaryBtn}>
          <Save className="w-3.5 h-3.5" /><span>{s.identitySave}</span></button>
      </div>
      <div className={cardCls}>
        <h2 className="text-xs font-bold text-text">{s.namedSettingsTitle}</h2>
        <p className="text-[11px] text-muted">{s.namedSettingsHint}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="block text-[10px] font-semibold text-text">{s.settingDefaultAnswerType}
            <select value={namedSettings.default_answer_type}
              onChange={(e) => onNamedSettings({ ...namedSettings, default_answer_type: e.target.value })}
              className={`${inputCls} mt-1`}>
              {ANSWER_TYPES.map((value) => <option key={value} value={value}>{t.common[value]}</option>)}
            </select>
            <span className="block font-normal text-muted mt-0.5">{s.settingDefaultAnswerTypeHint}</span></label>
          <label className="block text-[10px] font-semibold text-text">{s.settingDefaultPriority}
            <select value={namedSettings.default_priority}
              onChange={(e) => onNamedSettings({ ...namedSettings, default_priority: e.target.value })}
              className={`${inputCls} mt-1`}>
              <option value="high">{t.common.high}</option>
              <option value="mid">{t.common.mid}</option>
              <option value="low">{t.common.low}</option>
            </select>
            <span className="block font-normal text-muted mt-0.5">{s.settingDefaultPriorityHint}</span></label>
          <label className="block text-[10px] font-semibold text-text">{s.settingDefaultEsgClass}
            <select value={namedSettings.default_esg_class}
              onChange={(e) => onNamedSettings({ ...namedSettings, default_esg_class: e.target.value })}
              className={`${inputCls} mt-1`}>
              {['environmental', 'social', 'governance', 'general'].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <span className="block font-normal text-muted mt-0.5">{s.settingDefaultEsgClassHint}</span></label>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-[10px] font-semibold text-text">
              <input type="checkbox" checked={namedSettings.attachment_required_default}
                onChange={(e) => onNamedSettings({ ...namedSettings, attachment_required_default: e.target.checked })}
                className="w-3.5 h-3.5 accent-brand focus:outline-none focus:ring-2 focus:ring-focus-ring/40" />
              <span>{s.settingAttachmentDefault}<span className="block font-normal text-muted">{s.settingAttachmentDefaultHint}</span></span></label>
            <label className="flex items-center gap-2 text-[10px] font-semibold text-text">
              <input type="checkbox" checked={namedSettings.report_visible_default}
                onChange={(e) => onNamedSettings({ ...namedSettings, report_visible_default: e.target.checked })}
                className="w-3.5 h-3.5 accent-brand focus:outline-none focus:ring-2 focus:ring-focus-ring/40" />
              <span>{s.settingVisibleDefault}<span className="block font-normal text-muted">{s.settingVisibleDefaultHint}</span></span></label>
          </div>
        </div>
        {settingsEcho && <pre dir="ltr" className="p-2 rounded-xl bg-surface-3 border border-border text-[10px] text-text overflow-x-auto">{s.settingsEcho}{'\n'}{settingsEcho}</pre>}
        <div className="flex items-center gap-2">
          <button type="button" disabled={busy || frozen} title={frozen ? s.frozenScopeBanner : undefined} onClick={() => void onSaveNamedSettings()} className={secondaryBtn}>
            <Save className="w-3.5 h-3.5" /><span>{s.settingsSave}</span></button>
          <p className="text-[10px] text-muted">{s.namedSettingsReplace}</p>
        </div>
      </div>
    </div>
  );
};
