"use client";

import { useEffect, useRef, useState } from "react";

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
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

/** Header-Glocke (Task 4): Ungelesen-Zaehler + Dropdown mit den letzten 10, "alle gelesen". */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<Notification[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  async function refreshCount() {
    try {
      const res = await fetch("/api/notifications/unread-count");
      if (res.ok) {
        const j = (await res.json()) as { count: number };
        setCount(j.count);
      }
    } catch {
      // still — Bell degradiert stumm auf 0, keine Fehleranzeige im Header noetig.
    }
  }

  useEffect(() => {
    // react-hooks/set-state-in-effect: kein synchroner setState-Aufruf im Effekt-Body
    // (Muster wie SendEmailDialog.autoOpen, Task-2 Fix-Runde 1) — per setTimeout(0)
    // entkoppelt, damit der erste Fetch NACH dem Mount-Render ausgeloest wird.
    const initial = setTimeout(() => void refreshCount(), 0);
    const interval = setInterval(() => void refreshCount(), 60000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  async function toggleOpen() {
    const next = !open;
    setOpen(next);
    if (next) {
      const res = await fetch("/api/notifications?limit=10");
      if (res.ok) {
        const j = (await res.json()) as { notifications: Notification[] };
        setItems(j.notifications);
      }
    }
  }

  async function markAllRead() {
    await fetch("/api/notifications/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    setItems((prev) => prev?.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? null);
    setCount(0);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => void toggleOpen()}
        aria-label="Benachrichtigungen"
        className="relative rounded-md p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
          <path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5m6 0v1a3 3 0 1 1-6 0v-1m6 0H9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {count > 0 && (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold text-white">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <span className="text-sm font-semibold text-slate-800">Benachrichtigungen</span>
            <button type="button" onClick={() => void markAllRead()} className="text-xs text-indigo-600 hover:underline">
              alle gelesen
            </button>
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {(items ?? []).map((n) => (
              <li key={n.id} className={`border-b border-slate-50 px-3 py-2 text-sm ${n.readAt ? "" : "bg-indigo-50/50"}`}>
                {n.link ? (
                  <a href={n.link} className="block font-medium text-slate-800 hover:underline">
                    {n.title}
                  </a>
                ) : (
                  <div className="font-medium text-slate-800">{n.title}</div>
                )}
                {n.body && <div className="text-xs text-slate-500">{n.body}</div>}
                <div className="text-[11px] text-slate-400">{deDateTime(n.createdAt)}</div>
              </li>
            ))}
            {items && items.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-400">Keine Benachrichtigungen.</li>}
          </ul>
          <a href="/benachrichtigungen" className="block border-t border-slate-100 px-3 py-2 text-center text-xs text-indigo-600 hover:underline">
            Alle anzeigen
          </a>
        </div>
      )}
    </div>
  );
}
