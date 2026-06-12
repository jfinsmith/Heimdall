/**
 * Gjallarhorn notification bell — in-app feed of `notifications/{id}` docs
 * for the signed-in user, with unread badge and mark-as-read.
 */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { doc, limit, orderBy, updateDoc, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useCollection } from '../lib/firestore';
import { useAuth } from '../auth/AuthContext';
import type { NotificationDoc } from '../types';
import { GjallarhornGlyph } from '../brand/Logo';

export function NotificationBell() {
  const { firebaseUser } = useAuth();
  const [open, setOpen] = useState(false);
  const { data: notifications } = useCollection<NotificationDoc>(
    firebaseUser ? 'notifications' : null,
    firebaseUser ? [where('uid', '==', firebaseUser.uid), orderBy('createdAt', 'desc'), limit(20)] : [],
    [firebaseUser?.uid]
  );
  const unread = notifications.filter((n) => !n.read).length;

  async function markRead(id: string) {
    await updateDoc(doc(db, 'notifications', id), { read: true });
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
        aria-expanded={open}
        className="relative rounded-md p-2 text-watch-200 hover:bg-watch-800 hover:text-bifrost-300"
      >
        <GjallarhornGlyph size={22} title="Gjallarhorn notifications" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-bifrost-500 px-1 text-[10px] font-bold text-watch-950">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div
          className="absolute right-0 z-40 mt-2 w-80 rounded-lg border border-watch-100 bg-white shadow-xl"
          role="dialog"
          aria-label="Notifications"
        >
          <div className="border-b border-watch-100 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-watch-500">
            Gjallarhorn
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {notifications.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-slate-400">The horn is silent. No notifications.</li>
            )}
            {notifications.map((n) => (
              <li key={n.id} className={`border-b border-watch-50 px-4 py-3 text-sm ${n.read ? 'opacity-60' : ''}`}>
                <div className="font-medium text-watch-900">{n.title}</div>
                <div className="text-slate-600">{n.body}</div>
                <div className="mt-1 flex gap-3 text-xs">
                  {n.link && (
                    <Link to={n.link} className="text-bifrost-700 hover:underline" onClick={() => setOpen(false)}>
                      View
                    </Link>
                  )}
                  {!n.read && (
                    <button className="text-watch-500 hover:underline" onClick={() => markRead(n.id)}>
                      Mark read
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
