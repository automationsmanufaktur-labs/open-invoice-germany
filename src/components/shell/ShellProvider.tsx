// src/components/shell/ShellProvider.tsx
"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

interface ShellContextValue {
  searchOpen: boolean;
  openSearch: () => void;
  closeSearch: () => void;
  /** Von `NavHint` gesetzter Listen-Link (Phase 11d, 11a-M12): Detailseiten ohne eigenen
   *  Listen-Pfad (z. B. `/dokumente/<id>` einer Auftragsbestaetigung) ueberstimmen damit
   *  den echten `pathname`/`search` in der `Sidebar`, damit dort der passende Listen-Link
   *  aktiv markiert wird. `null` = kein Hint, `Sidebar` nutzt den echten Pfad. */
  navHint: string | null;
  setNavHint: (href: string | null) => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);

/**
 * Shell-weiter Zustand (Phase 11a, Task 5 Fix 1). Ersetzt das fruehere `searchSlot`-Prop-
 * Durchreichen: `AppShell` rendert genau EINE `CommandPalette` (siehe dort), `Sidebar`/
 * `Topbar`/die Drawer-Sidebar rendern jeweils nur einen `SearchTrigger`-Button. Beide teilen
 * sich diesen Kontext, statt dass jede Stelle ihre eigene `CommandPalette`-Instanz (und damit
 * eigenen Overlay-/Tastatur-Zustand) mitbringt.
 */
export function ShellProvider({ children }: { children: ReactNode }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const [navHint, setNavHint] = useState<string | null>(null);
  const value = useMemo<ShellContextValue>(
    () => ({ searchOpen, openSearch, closeSearch, navHint, setNavHint }),
    [searchOpen, openSearch, closeSearch, navHint],
  );
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellContextValue {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell() muss innerhalb von <ShellProvider> aufgerufen werden.");
  return ctx;
}
