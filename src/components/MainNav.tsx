"use client";

import Link from "next/link";
import { useState } from "react";
import { NotificationBell } from "@/components/NotificationBell";
import { LogoutButton } from "@/components/LogoutButton";

interface NavItem {
  href: string;
  label: string;
}
interface NavGroup {
  label: string;
  items: NavItem[];
}

// Task 4 (Brief): Gruppen Dashboard · Verkauf · Stammdaten · Einstellungen.
// Gutschriften ist keine eigene Liste, sondern ein Filter auf /rechnungen (type=CREDIT_NOTE,
// Task 1/4 — invoiceListFilterSchema.type).
const GROUPS: NavGroup[] = [
  {
    label: "Verkauf",
    items: [
      { href: "/rechnungen", label: "Rechnungen" },
      { href: "/rechnungen?type=CREDIT_NOTE", label: "Gutschriften" },
      { href: "/dokumente", label: "Dokumente" },
      { href: "/lieferscheine", label: "Lieferscheine" },
      { href: "/abos", label: "Abos" },
      { href: "/mahnwesen", label: "Mahnwesen" },
    ],
  },
  {
    label: "Stammdaten",
    items: [
      { href: "/kunden", label: "Kunden" },
      { href: "/produkte", label: "Produkte" },
    ],
  },
  {
    label: "Einstellungen",
    items: [
      { href: "/einstellungen", label: "Übersicht" },
      { href: "/einstellungen/benachrichtigungen", label: "Benachrichtigungen" },
      { href: "/einstellungen/automatisierung", label: "Automatisierung" },
    ],
  },
];

function NavDropdown({ group }: { group: NavGroup }) {
  return (
    <div className="group relative">
      <button type="button" className="text-slate-600 hover:text-slate-900">
        {group.label}
      </button>
      <div className="invisible absolute left-0 top-full z-20 min-w-[10rem] rounded-md border border-slate-200 bg-white py-1 opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100">
        {group.items.map((item) => (
          <Link key={item.href} href={item.href} className="block px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

/**
 * Gruppierte Hauptnavigation (Task 4) — reines CSS-Hover-Dropdown (kein Dependency-
 * Zuwachs) fuer Desktop, Burger-Menue (natives `<details>`, keine neue Dependency) fuer
 * mobil.
 */
export function MainNav() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav className="relative flex items-center gap-5 text-sm">
      <Link href="/" className="text-slate-600 hover:text-slate-900">
        Dashboard
      </Link>
      <div className="hidden items-center gap-5 sm:flex">
        {GROUPS.map((g) => (
          <NavDropdown key={g.label} group={g} />
        ))}
      </div>
      <Link href="/rechnungen/neu" className="hidden rounded-md bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-700 sm:inline-block">
        Neue Rechnung
      </Link>
      <NotificationBell />
      <LogoutButton />

      <button
        type="button"
        aria-label="Menü"
        onClick={() => setMobileOpen((v) => !v)}
        className="grid h-8 w-8 place-items-center rounded-md border border-slate-300 text-slate-600 hover:bg-slate-50 sm:hidden"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
          <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
        </svg>
      </button>

      {mobileOpen && (
        <div className="absolute inset-x-0 top-full z-20 border-b border-slate-200 bg-white p-4 shadow-lg sm:hidden">
          <div className="space-y-4">
            <Link href="/rechnungen/neu" onClick={() => setMobileOpen(false)} className="block rounded-md bg-indigo-600 px-3 py-2 text-center font-medium text-white">
              Neue Rechnung
            </Link>
            {GROUPS.map((g) => (
              <div key={g.label}>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{g.label}</div>
                <div className="space-y-1">
                  {g.items.map((item) => (
                    <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)} className="block rounded px-2 py-1.5 text-slate-700 hover:bg-slate-50">
                      {item.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}
