/**
 * Shared notification presentation metadata — one source for the bell panel and
 * the All Notifications page (category grouping, badge tones, type labels,
 * relative timestamps).
 */
import type { NotificationType } from '../types';
import { EMAIL_AUTOMATIONS } from '../types';

export type NotificationTone = 'slate' | 'amber' | 'green' | 'red' | 'navy';

/** Friendly label per type (keys match the email-automation keys). */
export const TYPE_LABEL: Record<string, string> = Object.fromEntries(EMAIL_AUTOMATIONS.map((a) => [a.key, a.label]));

/** Each notification type rolls up into a category (badge color + filter group). */
export const CATEGORY: Record<NotificationType, { group: string; tone: NotificationTone }> = {
  signup_confirmed: { group: 'Staffing', tone: 'green' },
  slot_reopened: { group: 'Staffing', tone: 'amber' },
  session_fully_staffed: { group: 'Staffing', tone: 'green' },
  understaffing_alert: { group: 'Staffing', tone: 'red' },
  lead_withdrawal_escalation: { group: 'Staffing', tone: 'red' },
  schedule_change: { group: 'Schedule', tone: 'amber' },
  course_published: { group: 'Schedule', tone: 'navy' },
  approval_request: { group: 'Approvals', tone: 'amber' },
  approval_update: { group: 'Approvals', tone: 'green' },
  qualification_approved: { group: 'Account', tone: 'green' },
  account_approved: { group: 'Account', tone: 'green' },
  new_account_pending: { group: 'Account', tone: 'navy' },
  account_suspended: { group: 'Account', tone: 'red' },
  account_reinstated: { group: 'Account', tone: 'green' },
  reminder: { group: 'Reminders', tone: 'navy' },
  digest: { group: 'Reminders', tone: 'slate' },
  message: { group: 'Messages', tone: 'navy' },
  feedback_submitted: { group: 'Messages', tone: 'amber' },
};
export const CATEGORY_GROUPS = [...new Set(Object.values(CATEGORY).map((c) => c.group))].sort();

/** Colored category dot for compact surfaces (the bell panel). */
export const TONE_DOT: Record<NotificationTone, string> = {
  green: 'bg-green-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
  navy: 'bg-watch-700',
  slate: 'bg-slate-400',
};

/** Compact relative timestamp: "just now", "8m ago", "3h ago", "2d ago", then a date. */
export function timeAgo(d: Date, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - d.getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
