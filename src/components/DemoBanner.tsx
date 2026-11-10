import React from 'react';
import { useLanguage } from '../i18n/LanguageContext.tsx';

/**
 * FIX BATCH 2 (MP-32): small, non-intrusive, always-visible demo honesty
 * notice. Rendered on every screen — login, setup, and inside the sticky
 * app header (so it stays visible while scrolling) — so the demo nature
 * of this build is never hidden. Text comes from translations (EN + AR).
 */
export const DemoBanner: React.FC = () => {
  const { t } = useLanguage();

  return (
    <div
      role="note"
      aria-live="polite"
      className="w-full border-b border-amber-500/30 bg-amber-50 px-4 py-1.5 text-center dark:border-amber-400/20 dark:bg-amber-950/40"
    >
      <span className="text-[11px] font-semibold tracking-wide text-amber-700 dark:text-amber-300">
        {t.common.demoBanner}
      </span>
    </div>
  );
};
