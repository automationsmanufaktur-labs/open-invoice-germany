// src/components/shell/Topbar.tsx
"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getFocusable } from "@/lib/focus";
import type { Brand } from "@/domain/settings/brand";
import { NavIcon } from "./NavIcons";
import { SearchTrigger } from "./SearchTrigger";
import { Sidebar } from "./Sidebar";
import { useShell } from "./ShellProvider";

interface Props {
  orgName: string;
  unreadCount: number;
  appVersion: string;
  brand: Brand;
}

/** Schmale Kopfleiste unterhalb `lg`: Burger oeffnet die Sidebar als Drawer. */
export function Topbar({ orgName, unreadCount, appVersion, brand }: Props) {
  const { searchOpen } = useShell();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  function close() {
    setOpen(false);
  }

  // M10 (Phase-11a-Nachtrag, Task 5): Fokus beim Oeffnen in den Drawer verschieben, beim
  // Schliessen zurueck auf das zuvor fokussierte Element (Muster `PreviewSheet.tsx`,
  // `CommandPalette.tsx`).
  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const t = setTimeout(() => {
      const first = panelRef.current ? getFocusable(panelRef.current)[0] : undefined;
      first?.focus();
    }, 0);
    return () => {
      clearTimeout(t);
      previouslyFocusedRef.current?.focus();
      previouslyFocusedRef.current = null;
    };
  }, [open]);

  // Scroll-Sperre waehrend der Drawer offen ist; vorherigen Wert im Cleanup wiederherstellen.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  // Escape schliesst den Drawer, Tab/Shift+Tab bleibt innerhalb des Panels (Fokusfalle,
  // Muster `PreviewSheet.tsx`) — ein document-Listener, unabhaengig vom aktuellen Fokusziel.
  // Fix 1 (Task 5, wichtig): die Palette kann ueber dem offenen Drawer geoeffnet werden
  // (eigener document-Escape-Handler dort, siehe `CommandPalette.tsx`); ohne Guard wuerde
  // ein Escape dort BEIDE Overlays schliessen. Der Drawer reagiert deshalb nur, wenn entweder
  // die Palette gerade NICHT offen ist, oder der Fokus (trotzdem) im Drawer-Panel liegt —
  // `CommandPalette.tsx` ruft zusaetzlich `stopPropagation()` auf (zweite Verteidigungslinie).
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        const focusInPanel = panelRef.current?.contains(document.activeElement) ?? false;
        if (searchOpen && !focusInPanel) return;
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = getFocusable(panel);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, searchOpen]);

  return (
    <>
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2 lg:hidden">
        <button type="button" aria-label="Menü" onClick={() => setOpen(true)} className="rounded-md p-1 text-slate-600 hover:bg-slate-100">
          <NavIcon name="menu" className="h-5 w-5" />
        </button>
        <Link href="/" className="font-semibold tracking-tight">
          {brand.appName}
        </Link>
        <div className="ml-auto">
          <SearchTrigger compact />
        </div>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <button type="button" aria-label="Menü schließen" onClick={close} className="absolute inset-0 bg-slate-900/40" />
          <div ref={panelRef} className="absolute inset-y-0 left-0 shadow-xl">
            <Sidebar orgName={orgName} unreadCount={unreadCount} appVersion={appVersion} brand={brand} drawer onClose={close} />
          </div>
        </div>
      )}
    </>
  );
}
