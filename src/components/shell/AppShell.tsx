// src/components/shell/AppShell.tsx
import { Suspense, type ReactNode } from "react";
import type { Brand } from "@/domain/settings/brand";
import { SOURCE_URL } from "@/domain/settings/brand";
import { DEFAULT_APP_NAME } from "@/lib/brand-defaults";
import { CommandPalette } from "./CommandPalette";
import { ShellProvider } from "./ShellProvider";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

interface Props {
  orgName: string;
  unreadCount: number;
  appVersion: string;
  brand: Brand;
  children: ReactNode;
}

/**
 * App-Shell (Phase 11a): Sidebar links ab `lg`, darunter Topbar + Drawer. `Sidebar` nutzt
 * `useSearchParams` und braucht deshalb eine Suspense-Grenze (Next App Router). Die
 * Befehlspalette (Task 5 Fix 1) haengt am `ShellProvider`-Kontext: genau EINE
 * `CommandPalette`-Instanz hier, ausserhalb von Sidebar/Topbar; deren `SearchTrigger`-Buttons
 * (Sidebar, Topbar, Drawer-Sidebar) oeffnen sie ueber den geteilten Kontext, statt jeweils
 * eine eigene Instanz mit eigenem Zustand mitzubringen.
 */
export function AppShell({ orgName, unreadCount, appVersion, brand, children }: Props) {
  return (
    <ShellProvider>
      <div className="flex min-h-screen">
        <div className="sticky top-0 hidden h-screen lg:block">
          <Suspense fallback={<div className="h-full w-60 border-r border-slate-200 bg-white" />}>
            <Sidebar orgName={orgName} unreadCount={unreadCount} appVersion={appVersion} brand={brand} />
          </Suspense>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <Suspense fallback={null}>
            <Topbar orgName={orgName} unreadCount={unreadCount} appVersion={appVersion} brand={brand} />
          </Suspense>
          <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
          <footer className="mx-auto w-full max-w-6xl px-6 py-6 text-xs text-slate-400">
            {/* M1 (Fix-Welle 12c): ohne eigenen Instanznamen zeigte die Fusszeile den
                Produktnamen doppelt ("OpenInvoice Germany · powered by OpenInvoice
                Germany · AGPL-3.0") — der fuehrende Teil erscheint nur bei einer
                tatsaechlich abweichenden Marke. */}
            {brand.appName !== DEFAULT_APP_NAME && `${brand.appName} · `}powered by OpenInvoice Germany · AGPL-3.0 ·{" "}
            <a href={SOURCE_URL} className="underline hover:text-slate-600">Quellcode</a> · Keine Steuer-/Rechtsberatung — siehe COMPLIANCE.md
          </footer>
        </div>
      </div>
      <CommandPalette />
    </ShellProvider>
  );
}
