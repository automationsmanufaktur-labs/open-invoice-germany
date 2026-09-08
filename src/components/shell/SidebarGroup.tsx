// src/components/shell/SidebarGroup.tsx
"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { NavGroup, NavItem } from "@/lib/nav";
import { activeGroupKey, itemMatches, SETTINGS_ITEMS } from "@/lib/nav";
import { NavIcon } from "./NavIcons";
import { UnreadBadge } from "./UnreadBadge";

interface Props {
  group: NavGroup;
  pathname: string;
  search: string;
  collapsed: boolean;
  unreadCount: number;
  onNavigate?: () => void;
}

function ItemLink({ item, active, collapsed, badge, onNavigate, indent }: { item: NavItem; active: boolean; collapsed: boolean; badge: number; onNavigate?: () => void; indent?: boolean }) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      aria-current={active ? "page" : undefined}
      className={`relative flex items-center gap-2.5 rounded-md py-1.5 text-sm ${indent ? "pl-9 pr-2" : "px-2"} ${
        active ? "bg-indigo-50 font-medium text-indigo-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
      }`}
    >
      {item.icon && <NavIcon name={item.icon} className="h-4 w-4 shrink-0" />}
      {!collapsed && <span className="truncate">{item.label}</span>}
      {item.badge === "notifications" && <UnreadBadge collapsed={collapsed} initialCount={badge} />}
    </Link>
  );
}

export function SidebarGroup({ group, pathname, search, collapsed, unreadCount, onNavigate }: Props) {
  const storageKey = `oig.nav.open.${group.key}`;
  const [open, setOpen] = useState(true);

  useEffect(() => {
    // localStorage nur im Effekt (SSR-sicher); setState per setTimeout(0) wie Sidebar.tsx
    // (COLLAPSED_KEY) — Default offen, wenn nichts (oder ein privater Modus ohne Storage)
    // gespeichert ist.
    const t = setTimeout(() => {
      try {
        setOpen(localStorage.getItem(storageKey) !== "0");
      } catch {
        // kein Storage (privater Modus) — offen bleiben
      }
    }, 0);
    return () => clearTimeout(t);
  }, [storageKey]);

  function toggleOpen() {
    setOpen((v) => {
      try {
        localStorage.setItem(storageKey, v ? "0" : "1");
      } catch {
        // ignorieren
      }
      return !v;
    });
  }

  // Fix 1 (Task 5, kritisch): die aktive Gruppe oeffnet sich nur EINMALIG beim UEBERGANG in
  // den aktiven Zustand (z.B. Navigieren hinein) — nicht dauerhaft gepinnt, sonst waere das
  // Chevron auf der eigenen aktiven Gruppe wirkungslos. `prevActiveKeyRef` startet mit dem
  // beim ersten Rendern bereits aktiven Schluessel, damit ein einfaches Neuladen der Seite
  // (Gruppe war schon vorher aktiv) NICHT als Uebergang zaehlt und die gespeicherte
  // Zuklapp-Praeferenz respektiert; nur ein tatsaechlicher Wechsel (andere Gruppe -> diese)
  // loest das einmalige `setOpen(true)` aus. Danach bestimmt wieder `open`/das Toggle.
  const activeKey = activeGroupKey(pathname, search);
  const prevActiveKeyRef = useRef<string | null>(activeKey);
  useEffect(() => {
    const becameActive = activeKey === group.key && prevActiveKeyRef.current !== group.key;
    prevActiveKeyRef.current = activeKey;
    if (!becameActive) return;
    const t = setTimeout(() => setOpen(true), 0);
    return () => clearTimeout(t);
  }, [activeKey, group.key]);

  if (group.href !== undefined && group.items.length === 0) {
    return (
      <ItemLink
        item={{ href: group.href, label: group.label, icon: group.icon, exact: true }}
        active={pathname === group.href}
        collapsed={collapsed}
        badge={0}
        onNavigate={onNavigate}
      />
    );
  }

  // Eingeklappte (nur-Icons-)Sidebar zeigt Gruppen immer offen (kein Header/Chevron);
  // `aria-expanded` spiegelt den tatsaechlich sichtbaren Zustand.
  const effectiveOpen = collapsed || open;
  const itemsId = `nav-group-${group.key}-items`;

  return (
    <div className="space-y-0.5">
      {!collapsed && (
        <button
          type="button"
          onClick={toggleOpen}
          aria-expanded={effectiveOpen}
          aria-controls={itemsId}
          className="flex w-full items-center justify-between rounded-md px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-600"
        >
          <span>{group.label}</span>
          <NavIcon name="chevron-right" className={`h-3 w-3 shrink-0 transition-transform ${effectiveOpen ? "rotate-90" : ""}`} />
        </button>
      )}
      {collapsed && <div className="my-2 border-t border-slate-200" />}
      {effectiveOpen && (
        <div id={itemsId} className="space-y-0.5">
          {group.items.map((item) => {
            const isActive = itemMatches(item, pathname, search);
            const showSettings = item.href === "/einstellungen" && isActive && !collapsed;
            return (
              <div key={item.href}>
                <ItemLink item={item} active={isActive} collapsed={collapsed} badge={unreadCount} onNavigate={onNavigate} />
                {showSettings && (
                  <div className="mt-0.5 space-y-0.5">
                    {SETTINGS_ITEMS.map((s) => (
                      <ItemLink key={s.href} item={s} active={itemMatches(s, pathname, search)} collapsed={false} badge={0} onNavigate={onNavigate} indent />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
