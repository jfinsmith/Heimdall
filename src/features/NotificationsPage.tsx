/**
 * All Notifications — the full Gjallarhorn feed for the signed-in user (the bell
 * shows only the latest few). Every alert that can go out as an email also lands
 * here, and in-app notifications are free, so this is the complete record.
 * Structured by day, filterable by category and unread state, with a deep link
 * on each item back to where it came from and a one-click "mark all read".
 */
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { doc, limit, orderBy, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useCollection } from '../lib/firestore';
import { useAuth } from '../auth/AuthContext';
import type { NotificationDoc, NotificationType } from '../types';
import { CATEGORY, CATEGORY_GROUPS, TYPE_LABEL } from '../lib/notificationMeta';
import { Badge, Button, EmptyState, PageHeader, Select } from '../components/ui';

const BUCKET_ORDER = ['Today', 'Yesterday', 'Earlier this week', 'Earlier this month', 'Older'];

/** Which day-bucket a date falls into, relative to now. */
function bucketOf(d: Date): string {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((startOfToday.getTime() - startOfDate.getTime()) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'Earlier this week';
  if (days < 30) return 'Earlier this month';
  return 'Older';
}

const fmtWhen = (d: Date) =>
  d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function NotificationsPage() {
  const { firebaseUser } = useAuth();
  const { data: notifications, loading, error } = useCollection<NotificationDoc>(
    firebaseUser ? 'notifications' : null,
    firebaseUser ? [where('uid', '==', firebaseUser.uid), orderBy('createdAt', 'desc'), limit(300)] : [],
    [firebaseUser?.uid]
  );

  const [categoryFilter, setCategoryFilter] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const filtered = useMemo(
    () =>
      notifications.filter(
        (n) =>
          (!categoryFilter || CATEGORY[n.type as NotificationType]?.group === categoryFilter) &&
          (!unreadOnly || !n.read)
      ),
    [notifications, categoryFilter, unreadOnly]
  );

  // Group into day buckets, preserving the desc order within each.
  const grouped = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const n of filtered) {
      const when = n.createdAt?.toDate?.() ?? new Date();
      const b = bucketOf(when);
      if (!map.has(b)) map.set(b, []);
      map.get(b)!.push(n);
    }
    return BUCKET_ORDER.filter((b) => map.has(b)).map((b) => ({ bucket: b, items: map.get(b)! }));
  }, [filtered]);

  async function markRead(id: string) {
    await updateDoc(doc(db, 'notifications', id), { read: true });
  }

  async function markAllRead() {
    const unread = notifications.filter((n) => !n.read);
    for (let i = 0; i < unread.length; i += 400) {
      const batch = writeBatch(db);
      unread.slice(i, i + 400).forEach((n) => batch.update(doc(db, 'notifications', n.id), { read: true }));
      await batch.commit();
    }
  }

  return (
    <div>
      <PageHeader
        kicker="Gjallarhorn"
        title="Notifications"
        actions={
          <Button variant="primary" onClick={markAllRead} disabled={unreadCount === 0}>
            Mark all read{unreadCount ? ` (${unreadCount})` : ''}
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          aria-label="Filter by category"
          className="w-auto"
        >
          <option value="">All categories</option>
          {CATEGORY_GROUPS.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
          Unread only
        </label>
        <span className="text-sm text-slate-400">
          {filtered.length} shown · {unreadCount} unread
        </span>
      </div>

      {error ? (
        <div className="rounded-md bg-red-50 px-3 py-3 text-sm text-red-800">
          Couldn’t load your notifications. Check your connection and reload.
        </div>
      ) : !loading && filtered.length === 0 ? (
        <EmptyState
          title="The horn is silent"
          body={
            unreadOnly || categoryFilter
              ? 'No notifications match these filters.'
              : 'Sign-ups, schedule changes, approvals, and reminders will appear here.'
          }
        />
      ) : (
        <div className="space-y-6">
          {grouped.map(({ bucket, items }) => (
            <section key={bucket}>
              <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-watch-500">{bucket}</h2>
              <ul className="overflow-hidden rounded-lg border border-watch-100 bg-white shadow-sm">
                {items.map((n) => {
                  const cat = CATEGORY[n.type as NotificationType];
                  const when = n.createdAt?.toDate?.();
                  return (
                    <li
                      key={n.id}
                      className={`flex items-start gap-3 border-b border-watch-50 px-4 py-3 last:border-b-0 ${
                        n.read ? '' : 'bg-bifrost-50/40'
                      }`}
                    >
                      {/* Unread dot */}
                      <span
                        aria-hidden
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-transparent' : 'bg-bifrost-500'}`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={cat?.tone ?? 'slate'}>{TYPE_LABEL[n.type] ?? n.type}</Badge>
                          <span className="font-medium text-watch-900">{n.title}</span>
                          {when && <span className="text-xs text-slate-400">{fmtWhen(when)}</span>}
                        </div>
                        <div className="mt-0.5 whitespace-pre-line text-sm text-slate-600">{n.body}</div>
                        <div className="mt-1.5 flex gap-4 text-xs">
                          {n.link && (
                            <Link
                              to={n.link}
                              className="font-medium text-bifrost-700 hover:underline"
                              onClick={() => !n.read && markRead(n.id)}
                            >
                              Go to where this came from →
                            </Link>
                          )}
                          {!n.read && (
                            <button className="text-watch-500 hover:underline" onClick={() => markRead(n.id)}>
                              Mark read
                            </button>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
