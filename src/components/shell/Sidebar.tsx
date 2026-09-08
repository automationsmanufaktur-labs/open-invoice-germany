// src/components/shell/Sidebar.tsx
"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { NAV_GROUPS } from "@/lib/nav";
import { LogoutButton } from "@/components/LogoutButton";
import type { Brand } from "@/domain/settings/brand";
import { NavIcon } from "./NavIcons";
import { SearchTrigger } from "./SearchTrigger";
import { SidebarGroup } from "./SidebarGroup";
import { useShell } from "./ShellProvider";

const COLLAPSED_KEY = "oig.sidebar.collapsed";

interface Props {
  orgName: string;
  unreadCount: number;
  appVersion: string;
  brand: Brand;
  /** Drawer-Modus (mobil): Sidebar liegt als Overlay, Klick auf Link schliesst. */
  drawer?: boolean;
  onClose?: () => void;
}

export function Sidebar({ orgName, unreadCount, appVersion, brand, drawer = false, onClose }: Props) {
  const { navHint } = useShell();
  const routePathname = usePathname();
  const routeSearch = useSearchParams().toString();
  // 11a-M12: eine Detailseite ohne eigenen Listen-Pfad (z. B. /dokumente/<id> einer AB)
  // meldet ueber `NavHint` den Listen-Link, der hier statt des echten Pfads/Query fuer
  // die Aktiv-Markierung gilt (siehe ShellProvider/NavHint).
  const [hintPath, hintQuery = ""] = (navHint ?? "").split("?");
  const pathname = navHint ? hintPath : routePathname;
  const searchStr = navHint ? (hintQuery ? `?${hintQuery}` : "") : routeSearch ? `?${routeSearch}` : "";
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    // localStorage nur im Effekt (SSR-sicher); setState per setTimeout(0) wie NotificationBell.
    const t = setTimeout(() => {
      try {
        setCollapsed(!drawer && localStorage.getItem(COLLAPSED_KEY) === "1");
      } catch {
        // kein Storage (privater Modus) — ausgeklappt bleiben
      }
    }, 0);
    return () => clearTimeout(t);
  }, [drawer]);

  function toggleCollapsed() {
    setCollapsed((v) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, v ? "0" : "1");
      } catch {
        // ignorieren
      }
      return !v;
    });
  }

  const width = collapsed ? "w-14" : "w-60";

  return (
    <aside className={`flex h-full ${width} shrink-0 flex-col border-r border-slate-200 bg-white transition-[width]`} aria-label="Hauptnavigation">
      <div className="flex items-center gap-2 px-3 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight" onClick={onClose}>
          {brand.hasAppLogo ? (
            // eslint-disable-next-line @next/next/no-img-element -- kein optimierbares statisches Asset (Route liefert dynamisch aus der DB)
            <img src="/api/branding/appLogo" alt={brand.appName} className="h-7 w-auto shrink-0" />
          ) : (
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-indigo-600 text-sm font-bold text-white">{brand.appShortName}</span>
          )}
          {!collapsed && <span>{brand.appName}</span>}
        </Link>
        {drawer && (
          <button type="button" aria-label="Menü schließen" onClick={onClose} className="ml-auto rounded-md p-1 text-slate-500 hover:bg-slate-100">
            <NavIcon name="close" />
          </button>
        )}
      </div>

      <div className="px-3 pb-2">{collapsed ? <SearchTrigger compact /> : <SearchTrigger />}</div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2 pb-4">
        {NAV_GROUPS.map((g) => (
          <SidebarGroup key={g.key} group={g} pathname={pathname} search={searchStr} collapsed={collapsed} unreadCount={unreadCount} onNavigate={onClose} />
        ))}
      </nav>

      <div className="border-t border-slate-200 px-3 py-3 text-xs text-slate-500">
        {!collapsed && orgName && (
          <div className="mb-2 truncate font-medium text-slate-700" title={orgName}>
            {orgName}
          </div>
        )}
        {!collapsed && <div className="mb-2 text-[11px] text-slate-400">v{appVersion}</div>}
        <div className="flex items-center justify-between">
          <LogoutButton iconOnly={collapsed} />
          {!drawer && (
            <button type="button" onClick={toggleCollapsed} aria-label={collapsed ? "Navigation ausklappen" : "Navigation einklappen"} title={collapsed ? "Navigation ausklappen" : "Navigation einklappen"} className="rounded-md p-1 text-slate-500 hover:bg-slate-100">
              <NavIcon name={collapsed ? "chevron-right" : "chevron-left"} />
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
