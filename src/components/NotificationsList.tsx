"use client";

import { useState } from "react";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  createdAt: string;
  readAt: string | null;
}

function deDateTime(iso: string) {
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

/** Volle Benachrichtigungsliste (`/benachrichtigungen`, Task 4) — einzeln oder alle als
 *  gelesen markieren. */
export function NotificationsList({ initial }: { initial: Notification[] }) {
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function markRead(ids?: string[]) {
    setBusy(true);
    await fetch("/api/notifications/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ids ? { ids } : { all: true }),
    });
    const now = new Date().toISOString();
    setItems((prev) => prev.map((n) => (ids ? (ids.includes(n.id) ? { ...n, readAt: n.readAt ?? now } : n) : { ...n, readAt: n.readAt ?? now })));
    setBusy(false);
  }

  const unreadCount = items.filter((n) => !n.readAt).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-500">{unreadCount} ungelesen</span>
        <button
          type="button"
          onClick={() => void markRead()}
          disabled={busy || unreadCount === 0}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Alle als gelesen markieren
        </button>
      </div>

      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {items.map((n) => (
          <li key={n.id} className={`flex items-start justify-between gap-3 px-4 py-3 text-sm ${n.readAt ? "" : "bg-indigo-50/50"}`}>
            <div>
              {n.link ? (
                <a href={n.link} className="font-medium text-slate-800 hover:underline">
                  {n.title}
                </a>
              ) : (
                <div className="font-medium text-slate-800">{n.title}</div>
              )}
              {n.body && <div className="text-slate-500">{n.body}</div>}
              <div className="text-xs text-slate-400">{deDateTime(n.createdAt)}</div>
            </div>
            {!n.readAt && (
              <button type="button" onClick={() => void markRead([n.id])} className="shrink-0 text-xs text-indigo-600 hover:underline">
                gelesen
              </button>
            )}
          </li>
        ))}
        {items.length === 0 && <li className="px-4 py-8 text-center text-slate-400">Keine Benachrichtigungen.</li>}
      </ul>
    </div>
  );
}
