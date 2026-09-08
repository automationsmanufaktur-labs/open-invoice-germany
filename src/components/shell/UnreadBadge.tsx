// src/components/shell/UnreadBadge.tsx
"use client";

import { useEffect, useState } from "react";

const POLL_MS = 60_000;

/** Event, das nach erfolgreichem "als gelesen markieren" gefeuert wird (siehe
 *  `NotificationsList` und ggf. weitere Stellen, die `/api/notifications/read` aufrufen) —
 *  laesst `UnreadBadge` sofort statt erst beim naechsten Poll aktualisieren. */
export const NOTIFICATIONS_CHANGED_EVENT = "oig:notifications-changed";

interface UnreadCountResponse {
  count: number;
}

function isUnreadCountResponse(value: unknown): value is UnreadCountResponse {
  return typeof value === "object" && value !== null && typeof (value as { count?: unknown }).count === "number";
}

/**
 * Ungelesen-Badge der Sidebar (Abschluss-Review, Important: `layout.tsx` rendert den
 * Zaehler nur server-seitig — App-Router-Layouts rendern bei Client-Navigation nicht neu,
 * der alte serverseitige Zaehler in `SidebarGroup`/`ItemLink` wurde also nach "Alle als
 * gelesen markieren" nie aktuell). Eigene Client-Komponente: Startwert aus `initialCount`
 * (server-gerendert, verhindert einen Flash von 0), danach Poll alle 60s, bei `focus` und
 * beim Event `oig:notifications-changed`. Fehler beim Poll werden verschluckt — der letzte
 * bekannte Stand bleibt stehen, keine Fehleranzeige in der Sidebar. */
export function UnreadBadge({ collapsed, initialCount }: { collapsed: boolean; initialCount: number }) {
  const [count, setCount] = useState(initialCount);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const res = await fetch("/api/notifications/unread-count", { cache: "no-store" });
        if (!res.ok) return;
        const data: unknown = await res.json();
        if (!cancelled && isUnreadCountResponse(data)) setCount(data.count);
      } catch {
        // Netzfehler o.ae. — letzter bekannter Stand bleibt stehen.
      }
    }

    const interval = setInterval(() => void refresh(), POLL_MS);
    window.addEventListener("focus", refresh);
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, refresh);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, refresh);
    };
  }, []);

  if (count <= 0) return null;

  if (collapsed) {
    return <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-indigo-600" aria-label={`${count} ungelesen`} />;
  }
  return <span className="ml-auto rounded-full bg-indigo-600 px-1.5 text-[10px] font-semibold text-white">{count}</span>;
}
