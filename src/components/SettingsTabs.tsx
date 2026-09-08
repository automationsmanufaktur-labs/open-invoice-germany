import Link from "next/link";
import { SETTINGS_ITEMS, type SettingsKey } from "@/lib/nav";

/** Phase 11b, Task 7: Reiter werden aus `SETTINGS_ITEMS` (src/lib/nav.ts) abgeleitet
 *  statt eine eigene, parallel gepflegte Liste zu fuehren — ein neuer Einstellungen-
 *  Unterpunkt braucht nur noch einen Eintrag dort. */
export type SettingsTabKey = SettingsKey;

export function SettingsTabs({ active }: { active: SettingsTabKey }) {
  return (
    <nav className="flex flex-wrap gap-4 border-b border-slate-200 text-sm">
      {SETTINGS_ITEMS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`-mb-px border-b-2 px-1 py-2 font-medium ${
            active === t.key ? "border-indigo-600 text-indigo-700" : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
