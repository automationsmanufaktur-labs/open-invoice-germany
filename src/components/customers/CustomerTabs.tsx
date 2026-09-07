"use client";

import { useState, type ReactNode } from "react";

/**
 * Generische Tab-Komponente (Phase 8a, Task 3) — clientseitiger Tab-Wechsel ohne
 * Navigation/Reload. Bewusst content-agnostisch (nicht auf Kunden beschraenkt), damit
 * Phase 8b (Detailseite) sie ohne Anpassung wiederverwenden kann.
 */
export interface TabDef {
  key: string;
  label: string;
  content: ReactNode;
}

export function CustomerTabs({ tabs, initial }: { tabs: TabDef[]; initial?: string }) {
  const [active, setActive] = useState(initial ?? tabs[0]?.key ?? "");
  const activeTab = tabs.find((t) => t.key === active) ?? tabs[0];

  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-4 border-b border-slate-200 text-sm">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActive(t.key)}
            className={`-mb-px border-b-2 px-1 py-2 font-medium ${
              active === t.key ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div>{activeTab?.content}</div>
    </div>
  );
}
