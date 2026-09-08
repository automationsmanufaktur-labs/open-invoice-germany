import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { getCurrentUserId } from "@/lib/auth/server";
import { AppShell } from "@/components/shell/AppShell";
import { SlimShell } from "@/components/shell/SlimShell";
import { unreadCount } from "@/domain/notifications/create";
import { PUBLIC_NO_NAV_HEADER } from "@/proxy";
import { dbInternal } from "@/lib/db";
import { DEFAULT_APP_NAME, DEFAULT_BRAND, getOrgAndBrand, safeBrand } from "@/domain/settings/brand";
// `resolveJsonModule` ist in tsconfig.json aktiv — der JSON-Import wird beim Build inline
// gebundelt (kein Laufzeit-Dateizugriff im Docker-Runner noetig). `layout.tsx` ist eine
// Server-Komponente; die Version wird als Prop an die Client-Komponente `Sidebar` gereicht
// statt dort erneut importiert zu werden (Abschluss-Review M6).
import pkg from "@/../package.json";

// M7 (Fix-Welle 12c): `getOrgAndBrand`/`safeBrand` lebten vorher hier und wurden von
// `login/page.tsx` als Nicht-Next-Export aus einem Layout-Modul importiert (zerbrechlicher
// Kopplungspunkt, zog `package.json` + die halbe Huellenkette in die Login-Seite). Jetzt in
// `src/domain/settings/brand.ts` (dort steht bereits `loadBrand`); hier nur re-importiert,
// damit `generateMetadata`/`RootLayout` unveraendert bleiben.

export async function generateMetadata(): Promise<Metadata> {
  // Phase 12c: der Produktname ist ueberschreibbar (Einstellungen -> Marke). Ohne
  // Organisation (Setup-Zustand) gelten die Produktvorgaben — generateMetadata darf die
  // Seite nie reissen.
  let brand = DEFAULT_BRAND;
  let iconUrl = "/api/branding/icon";
  const result = await getOrgAndBrand();
  if (result) {
    brand = result.brand;
    try {
      // Cache-Busting fuers Favicon: die Route selbst cacht 5 Minuten (Task 2); ein neuer
      // Upload soll trotzdem sofort sichtbar sein. `updatedAt` ist billig (indizierter
      // Unique-Key, eine Spalte) und steht nicht auf `Brand` (siehe test/unit/brand-schemas.test.ts).
      const row = await dbInternal.brandingSettings.findUnique({ where: { orgId: result.org.id }, select: { updatedAt: true } });
      if (row) iconUrl = `/api/branding/icon?v=${row.updatedAt.getTime()}`;
    } catch {
      // Icon-Cache-Busting ist best effort — ohne Treffer bleibt die ungebustete URL.
    }
  }
  const isDefault = brand.appName === DEFAULT_APP_NAME;
  return {
    title: isDefault ? `${DEFAULT_APP_NAME} — kostenlose, rechtssichere Rechnungssoftware` : brand.appName,
    applicationName: brand.appName,
    description:
      "Kostenlose, self-hostbare Open-Source-Rechnungssoftware für Deutschland: E-Rechnung (XRechnung/ZUGFeRD), GoBD, § 14 UStG, Kleinunternehmer § 19.",
    icons: { icon: iconUrl },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Öffentliche Seiten ohne Login (Angebotsannahme, Phase 3b): der Proxy markiert die
  // Anfrage per Request-Header, das Root-Layout rendert dann nur eine schlanke Hülle
  // ohne Navigation/Logout — kein Route-Group-Umbau nötig (Task-3-Addendum).
  const isPublic = (await headers()).get(PUBLIC_NO_NAV_HEADER) === "1";

  if (isPublic) {
    const brand = await safeBrand();
    return (
      <html lang="de">
        <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
          <SlimShell brand={brand} maxWidth="3xl">{children}</SlimShell>
        </body>
      </html>
    );
  }

  const userId = await getCurrentUserId();
  const authed = Boolean(userId);

  if (!authed) {
    // Login/Setup: schlanke Huelle ohne Sidebar (Abschluss-Review M7: Header/Footer wieder
    // wie vor der Sidebar-Einfuehrung — dieselbe SlimShell wie die oeffentliche Huelle oben).
    const brand = await safeBrand();
    return (
      <html lang="de">
        <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
          <SlimShell brand={brand}>{children}</SlimShell>
        </body>
      </html>
    );
  }

  // Org-Name + Ungelesen-Zaehler + Marke fuer die Sidebar; alle Aufrufe duerfen nicht die
  // Seite reissen (Setup-Zustand ohne Organisation): still auf Defaults. Der Org-Name
  // (nicht der Produktname) traegt die Sidebar-Zeile — ein leerer Wert blendet sie aus.
  let orgName = "";
  let unread = 0;
  let brand = DEFAULT_BRAND;
  const result = await getOrgAndBrand();
  if (result) {
    orgName = result.org.legalName;
    brand = result.brand;
    try {
      unread = await unreadCount(result.org.id);
    } catch {
      // Benachrichtigungszaehler ist best effort — Shell trotzdem rendern
    }
  }

  return (
    <html lang="de">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">
        <AppShell orgName={orgName} unreadCount={unread} appVersion={pkg.version} brand={brand}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
