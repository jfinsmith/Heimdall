/**
 * Segmented Session | Lunch toggle shown at the top of the add-block modals
 * (SessionFormModal / LunchBlockModal) so a coordinator can switch what they're
 * adding without leaving the dialog. Only shown when CREATING — editing an
 * existing block keeps its type.
 */
import React from 'react';

export function BlockModeToggle({
  mode,
  onSession,
  onLunch,
}: {
  mode: 'session' | 'lunch';
  onSession?: () => void;
  onLunch?: () => void;
}) {
  const base = 'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors';
  const active = 'bg-white text-watch-900 shadow-sm';
  const idle = 'text-watch-600 hover:text-watch-900';
  return (
    <div className="mb-4 flex gap-1 rounded-lg bg-watch-100 p-1" role="tablist" aria-label="Block type">
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'session'}
        className={`${base} ${mode === 'session' ? active : idle}`}
        onClick={mode === 'session' ? undefined : onSession}
      >
        Session
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'lunch'}
        className={`${base} ${mode === 'lunch' ? active : idle}`}
        onClick={mode === 'lunch' ? undefined : onLunch}
      >
        Lunch / break
      </button>
    </div>
  );
}
