/**
 * HEIMDALL reusable UI primitives — calm, command-center styling.
 * Kept in one module: Button, Field, Badge, StatusPill, Spinner, EmptyState.
 */
import React from 'react';
import type { SessionStatus } from '../types';

// ── Button ─────────────────────────────────────────────────────────────────
type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

const buttonStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-bifrost-500 text-watch-950 hover:bg-bifrost-400 focus-visible:ring-bifrost-300 font-semibold',
  secondary:
    'bg-watch-800 text-watch-50 hover:bg-watch-700 focus-visible:ring-watch-400',
  danger: 'bg-red-700 text-white hover:bg-red-600 focus-visible:ring-red-400',
  ghost: 'bg-transparent text-watch-700 hover:bg-watch-100 focus-visible:ring-watch-300',
};

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${buttonStyles[variant]} ${className}`}
      {...props}
    />
  );
}

// ── Form field ─────────────────────────────────────────────────────────────
export function Field({
  label,
  children,
  hint,
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 block font-medium text-watch-800">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputClass =
  'w-full rounded-md border border-watch-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm placeholder:text-slate-400 focus:border-bifrost-400 focus:outline-none focus:ring-1 focus:ring-bifrost-400';

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={inputClass} {...props} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={inputClass} {...props} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={inputClass} rows={3} {...props} />;
}

// ── Badge / StatusPill ─────────────────────────────────────────────────────
export function Badge({
  tone = 'slate',
  children,
}: {
  tone?: 'slate' | 'amber' | 'green' | 'red' | 'navy';
  children: React.ReactNode;
}) {
  const tones = {
    slate: 'bg-slate-100 text-slate-700 ring-slate-300',
    amber: 'bg-amber-50 text-amber-800 ring-amber-300',
    green: 'bg-green-50 text-green-800 ring-green-300',
    red: 'bg-red-50 text-red-800 ring-red-300',
    navy: 'bg-watch-100 text-watch-800 ring-watch-300',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** Session staffing status → colored pill, consistent app-wide. */
export function StatusPill({ status }: { status: SessionStatus }) {
  const map: Record<SessionStatus, { tone: 'slate' | 'amber' | 'green' | 'red' | 'navy'; label: string }> = {
    draft: { tone: 'slate', label: 'Draft' },
    open: { tone: 'amber', label: 'Open' },
    fully_staffed: { tone: 'green', label: 'Fully staffed' },
    cancelled: { tone: 'red', label: 'Cancelled' },
    completed: { tone: 'navy', label: 'Completed' },
  };
  const { tone, label } = map[status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function HighLiabilityBadge() {
  return <Badge tone="red">High liability</Badge>;
}

// ── Spinner ────────────────────────────────────────────────────────────────
export function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg className={`h-6 w-6 animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-label="Loading">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

// ── EmptyState (with a faint rune-band flourish, per brand direction) ──────
export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-watch-200 px-6 py-12 text-center">
      <div aria-hidden className="select-none text-lg tracking-[0.5em] text-watch-200">
        ᚺᛖᛁᛗᛞᚨᛚᛚ
      </div>
      <h3 className="text-sm font-semibold text-watch-800">{title}</h3>
      {body && <p className="max-w-sm text-sm text-slate-500">{body}</p>}
    </div>
  );
}

// ── Page header ────────────────────────────────────────────────────────────
export function PageHeader({
  title,
  kicker,
  actions,
}: {
  title: string;
  kicker?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        {kicker && (
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-bifrost-600">{kicker}</div>
        )}
        <h1 className="text-2xl font-bold text-watch-900">{title}</h1>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
