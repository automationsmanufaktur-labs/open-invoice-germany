// src/components/shell/SearchTrigger.tsx
"use client";

import { useEffect, useState } from "react";
import { NavIcon } from "./NavIcons";
import { useShell } from "./ShellProvider";

/**
 * Trigger-Button fuer die Befehlspalette (Phase 11a, Task 5 Fix 1). Rendert nur den Button —
 * das Overlay lebt als Singleton in `CommandPalette` (einmal in `AppShell` gemountet). Kann
 * gleichzeitig an mehreren Stellen (Sidebar, Topbar, Drawer-Sidebar) gemountet sein: alle
 * Instanzen teilen sich denselben `ShellProvider`-Zustand, es entsteht kein zweites Overlay.
 *
 * `compact`: Icon-only-Variante fuer die schmale Topbar (mobil); die Sidebar nutzt die volle
 * Breite mit Label und Tastenkuerzel-Hinweis.
 */
/** `navigator.userAgentData` (User-Agent Client Hints) ist nicht in allen Browsern
 *  vorhanden — lokal getypt statt `any`, `navigator.platform` bleibt der Fallback
 *  (Abschluss-Review M15: `navigator.platform` ist deprecated). */
interface NavigatorWithUserAgentData extends Navigator {
  userAgentData?: { platform?: string };
}

export function SearchTrigger({ compact = false }: { compact?: boolean }) {
  const { openSearch } = useShell();
  // `navigator.*` ist am Server nicht verfuegbar und wuerde beim ersten Client-Render vor
  // der Hydration ohnehin nicht zum SSR-Markup passen (Hydration-Mismatch) — deshalb erst
  // nach dem Mount lesen; setState per `setTimeout(0)` wie in `Sidebar` (react-hooks/set-
  // state-in-effect vermeiden).
  const [isMac, setIsMac] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => {
      const nav = navigator as NavigatorWithUserAgentData;
      const platform = nav.userAgentData?.platform ?? nav.platform;
      setIsMac(/Mac/.test(platform));
    }, 0);
    return () => clearTimeout(t);
  }, []);

  if (compact) {
    return (
      <button type="button" onClick={openSearch} aria-label="Suchen" title="Suchen" className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100">
        <NavIcon name="search" className="h-5 w-5" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={openSearch}
      className="flex w-full items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-left text-sm text-slate-500 hover:bg-white"
      aria-label="Suchen"
    >
      <NavIcon name="search" className="h-4 w-4" />
      <span className="flex-1">Suchen</span>
      <kbd className="rounded border border-slate-200 bg-white px-1 text-[10px] text-slate-400">{isMac ? "⌘K" : "Strg K"}</kbd>
    </button>
  );
}
