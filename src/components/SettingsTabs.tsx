import Link from "next/link";

const TABS = [
  { href: "/einstellungen", key: "stammdaten", label: "Stammdaten" },
  { href: "/einstellungen/belege", key: "belege", label: "Belege" },
  { href: "/einstellungen/nummernkreise", key: "nummernkreise", label: "Nummernkreise" },
  { href: "/einstellungen/briefpapier", key: "briefpapier", label: "Briefpapier" },
  { href: "/einstellungen/druckoptionen", key: "druckoptionen", label: "Druckoptionen" },
  { href: "/einstellungen/email", key: "email", label: "E-Mail-Versand" },
  { href: "/einstellungen/vorlagen", key: "vorlagen", label: "Textvorlagen" },
  { href: "/einstellungen/textvorlagen", key: "textvorlagen", label: "Dokumenttexte" },
  { href: "/einstellungen/zahlungsmethoden", key: "zahlungsmethoden", label: "Zahlungsmethoden" },
  { href: "/einstellungen/mahnwesen", key: "mahnwesen", label: "Mahnwesen" },
  { href: "/einstellungen/kundenfelder", key: "kundenfelder", label: "Kundenfelder" },
  { href: "/einstellungen/benachrichtigungen", key: "benachrichtigungen", label: "Benachrichtigungen" },
  { href: "/einstellungen/automatisierung", key: "automatisierung", label: "Automatisierung" },
] as const;

export type SettingsTabKey =
  | "stammdaten"
  | "belege"
  | "nummernkreise"
  | "briefpapier"
  | "druckoptionen"
  | "email"
  | "vorlagen"
  | "textvorlagen"
  | "zahlungsmethoden"
  | "mahnwesen"
  | "kundenfelder"
  | "benachrichtigungen"
  | "automatisierung";

export function SettingsTabs({ active }: { active: SettingsTabKey }) {
  return (
    <nav className="flex flex-wrap gap-4 border-b border-slate-200 text-sm">
      {TABS.map((t) => (
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
