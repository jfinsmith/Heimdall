/**
 * Accessible modal dialog: focus trap via native <dialog>, Escape to close,
 * click-outside to dismiss.
 */
import React, { useEffect, useRef } from 'react';

export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        // Escape: don't let the native <dialog> close itself — route through
        // onClose so an owner passing a no-op while busy (e.g. mid bulk-import)
        // keeps the dialog visibly open instead of it vanishing while work runs.
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // Click on the backdrop (the dialog element itself) closes.
        if (e.target === ref.current) onClose();
      }}
      className={`w-[calc(100%-2rem)] rounded-lg p-0 shadow-xl backdrop:bg-watch-950/60 ${wide ? 'max-w-4xl' : 'max-w-xl'}`}
    >
      <div className="flex items-center justify-between border-b border-watch-100 px-5 py-3">
        <h2 className="text-base font-semibold text-watch-900">{title}</h2>
        <button
          onClick={onClose}
          aria-label="Close dialog"
          className="rounded p-1 text-slate-400 hover:bg-watch-50 hover:text-slate-600"
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      </div>
      <div className="max-h-[75vh] overflow-y-auto px-5 py-4">{children}</div>
    </dialog>
  );
}
