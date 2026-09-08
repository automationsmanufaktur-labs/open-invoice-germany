// src/components/shell/SlimShell.tsx
import type { ReactNode } from "react";
import type { Brand } from "@/domain/settings/brand";
import { SOURCE_URL } from "@/domain/settings/brand";
import { DEFAULT_APP_NAME } from "@/lib/brand-defaults";

const WIDTH = {
  "3xl": "max-w-3xl",
  "5xl": "max-w-5xl",
} as const;

/**
 * Schlanke Huelle ohne Sidebar/Navigation (Abschluss-Review M7): Logo-Kopfzeile und
 * AGPL-/Rechtshinweis-Fusszeile um `<main>`. Genutzt vom Root-Layout fuer die oeffentliche
 * Angebotsseite (`isPublic`, `maxWidth="3xl"`) UND den unauthentifizierten Zweig
 * (Login/Setup, `maxWidth="5xl"`, wie vor der Sidebar-Einfuehrung in Phase 11a) — vorher
 * gab es diese Huelle nur fuer die oeffentliche Seite, der unauthentifizierte Zweig hatte
 * gar keinen Header/Footer mehr (Regression, siehe Abschluss-Review Minor M7).
 *
 * Phase 12c: die Kopfzeile zeigt die Marke (`brand.appShortName`/`brand.appName`, oder das
 * hochgeladene App-Logo) statt der festen "OpenInvoice DE"-Beschriftung. Die AGPL-Zeile in
 * der Fusszeile ist davon UNBERUEHRT — sie nennt immer "OpenInvoice Germany" (§13 AGPL,
 * COMPLIANCE.md) und ist durch keine Einstellung abschaltbar.
 */
export function SlimShell({ brand, children, maxWidth = "5xl" }: { brand: Brand; children: ReactNode; maxWidth?: keyof typeof WIDTH }) {
  const width = WIDTH[maxWidth];
  return (
    <>
      <header className="border-b border-slate-200 bg-white">
        <div className={`mx-auto flex ${width} items-center px-6 py-4`}>
          <span className="flex items-center gap-2 font-semibold tracking-tight">
            {brand.hasAppLogo ? (
              // eslint-disable-next-line @next/next/no-img-element -- kein optimierbares statisches Asset (Route liefert dynamisch aus der DB)
              <img src="/api/branding/appLogo" alt={brand.appName} className="h-7 w-auto" />
            ) : (
              <span className="grid h-7 w-7 place-items-center rounded-md bg-indigo-600 text-sm font-bold text-white">{brand.appShortName}</span>
            )}
            {/* M6 (Fix-Welle 12c): mit Logo zeigte diese Huelle bisher NUR das Bild — die
                Sidebar zeigt Logo UND Namen (Sidebar.tsx), hier fehlte er dann auf der
                Login-Seite komplett (nur noch im AuthForm-Fliesstext). */}
            {brand.appName}
          </span>
        </div>
      </header>
      <main className={`mx-auto ${width} px-6 py-10`}>{children}</main>
      <footer className={`mx-auto ${width} px-6 py-10 text-xs text-slate-400`}>
        {/* M1 (Fix-Welle 12c): siehe AppShell.tsx — ohne eigenen Instanznamen doppelte
            Produktnennung vermeiden. */}
        {brand.appName !== DEFAULT_APP_NAME && `${brand.appName} · `}powered by OpenInvoice Germany · AGPL-3.0 ·{" "}
        <a href={SOURCE_URL} className="underline hover:text-slate-600">Quellcode</a> · Keine Steuer-/Rechtsberatung — siehe COMPLIANCE.md
      </footer>
    </>
  );
}
