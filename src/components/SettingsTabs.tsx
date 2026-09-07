import Link from "next/link";

const TABS = [
  { href: "/einstellungen", key: "stammdaten", label: "Stammdaten" },
  { href: "/einstellungen/email", key: "email", label: "E-Mail-Versand" },
  { href: "/einstellungen/vorlagen", key: "vorlagen", label: "Textvorlagen" },
  { href: "/einstellungen/textvorlagen", key: "textvorlagen", label: "Dokumenttexte" },
  { href: "/einstellungen/dokumente", key: "dokumente", label: "Dokumente" },
  { href: "/einstellungen/zahlungsmethoden", key: "zahlungsmethoden", label: "Zahlungsmethoden" },
  { href: "/einstellungen/mahnwesen", key: "mahnwesen", label: "Mahnwesen" },
  { href: "/einstellungen/automatisierung", key: "automatisierung", label: "Automatisierung" },
] as const;

export function SettingsTabs({ active }: { active: "stammdaten" | "email" | "vorlagen" | "textvorlagen" | "dokumente" | "zahlungsmethoden" | "mahnwesen" | "automatisierung" }) {
  return (
    <nav className="flex gap-4 border-b border-slate-200 text-sm">
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
