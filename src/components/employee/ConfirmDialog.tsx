import React, { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useLanguage } from '../../i18n/LanguageContext.tsx';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * TASK-PROTO-U4-3 unit (a) — dirty-draft guard dialog.
 * Real dialog semantics: focus trap + Escape + focus return to the invoker.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
}) => {
  const { t } = useLanguage();
  const dialogRef = useRef<HTMLDivElement>(null);
  const invokerRef = useRef<Element | null>(null);

  useEffect(() => {
    invokerRef.current = document.activeElement;
    const first = dialogRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    first?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusables = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )].filter((el) => !el.hasAttribute('disabled'));
      if (focusables.length === 0) return;
      const firstEl = focusables[0];
      const lastEl = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === firstEl) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && document.activeElement === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      (invokerRef.current as HTMLElement | null)?.focus?.();
    };
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" role="presentation" onClick={onCancel}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-sm p-5 bg-surface-2 border border-border rounded-2xl shadow-[var(--shadow)] space-y-3"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-warning-text shrink-0" />
          <h3 className="text-sm font-bold text-text">{title}</h3>
        </div>
        <p className="text-xs text-muted leading-relaxed">{message}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-surface-2 border border-border-strong text-text hover:bg-surface-3 focus:outline-none focus:ring-2 focus:ring-focus-ring/30"
          >
            {t.common.cancel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-brand text-brand-ink hover:bg-brand-strong focus:outline-none focus:ring-2 focus:ring-focus-ring/40"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
