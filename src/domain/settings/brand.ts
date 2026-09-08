/**
 * Aufgeloeste Markenangaben fuer die App-Huellen (Phase 12c). NULL-Felder in
 * BrandingSettings bedeuten "Produktvorgabe" — die Vorgabewerte selbst stehen in
 * `@/lib/brand-defaults` (die EINZIGE Stelle mit den Literalen; hier nur re-exportiert,
 * damit bestehende Importe von hier weiter funktionieren). Die AGPL-Herkunftszeile ist
 * bewusst NICHT Teil von `Brand`: sie ist in AppShell/SlimShell fest verdrahtet und durch
 * keine Einstellung abschaltbar (§13 AGPL, COMPLIANCE.md).
 */
import { cache } from "react";
import { loadBrandingSettings } from "@/domain/settings/branding";
import type { BrandingSettingsInput } from "@/schemas/settings";
import { DEFAULT_APP_NAME, DEFAULT_APP_SHORT_NAME } from "@/lib/brand-defaults";
import { getActiveOrg } from "@/lib/org";

export { DEFAULT_APP_NAME, DEFAULT_APP_SHORT_NAME };

/** Quellcode-Link der AGPL-Zeile. Ein Fork darf hier seine eigene Quelle eintragen — die
 *  Herkunftsangabe selbst bleibt (AGPL §13: Zugang zum Quellcode, nicht Namensverzicht). */
export const SOURCE_URL = process.env.SOURCE_URL ?? "https://github.com/automationsmanufaktur-labs/open-invoice-germany";

export interface Brand {
  appName: string;
  appShortName: string;
  hasAppLogo: boolean;
}

export const DEFAULT_BRAND: Brand = { appName: DEFAULT_APP_NAME, appShortName: DEFAULT_APP_SHORT_NAME, hasAppLogo: false };

export function resolveBrand(b: Pick<BrandingSettingsInput, "appName" | "appShortName" | "appLogoPath">): Brand {
  return {
    appName: b.appName ?? DEFAULT_APP_NAME,
    appShortName: b.appShortName ?? DEFAULT_APP_SHORT_NAME,
    hasAppLogo: Boolean(b.appLogoPath),
  };
}

/** Laedt die Marke einer Organisation; ohne gespeicherte Zeile gelten die Produktvorgaben. */
export async function loadBrand(orgId: string): Promise<Brand> {
  return resolveBrand(await loadBrandingSettings(orgId));
}

/**
 * M7 (Abschluss-Review Phase 12c, Fix-Welle): vorher in `src/app/layout.tsx` definiert —
 * `login/page.tsx` importierte `safeBrand` von dort, ein Nicht-Next-Export auf einem
 * Layout-Modul ist ein zerbrechlicher Kopplungspunkt (zieht `package.json` + die halbe
 * Huellenkette in jede Seite, die nur die Marke braucht). Hier liegen beide jetzt an
 * ihrem eigentlichen Platz (Domain-Modul, das schon `loadBrand` traegt).
 *
 * `generateMetadata` und der Layout-Rumpf laufen beide serverseitig fuer JEDE Anfrage —
 * ohne Dedupe laedt `getActiveOrg()` + `loadBrand()` (zwei Prisma-Queries) doppelt.
 * `cache()` dedupliziert pro Request-Renderdurchlauf (React-Doku: "Data Fetching with
 * cache und Server Components") — beide Aufrufer erhalten dasselbe Promise/Ergebnis.
 * `null` statt Wurf im Setup-Zustand (keine Organisation), damit beide Aufrufer denselben
 * try/catch-freien Pfad nutzen koennen.
 */
export const getOrgAndBrand = cache(async (): Promise<{ org: Awaited<ReturnType<typeof getActiveOrg>>; brand: Brand } | null> => {
  try {
    const org = await getActiveOrg();
    const brand = await loadBrand(org.id);
    return { org, brand };
  } catch {
    return null;
  }
});

/** Fuer AuthForm (Login-Seite) — dieselbe Selbstheilung wie im Layout-Rumpf: ohne
 *  Organisation (Setup-Zustand) gelten die Produktvorgaben. */
export async function safeBrand(): Promise<Brand> {
  const result = await getOrgAndBrand();
  return result?.brand ?? DEFAULT_BRAND;
}
