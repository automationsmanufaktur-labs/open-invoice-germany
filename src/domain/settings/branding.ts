/**
 * Briefpapier-Einstellungen einer Organisation (Phase 7, Task 1, §35) — Logo, Farbe,
 * Fusszeilen, Ränder, Hintergrundbild. Selbstheilung analog
 * src/domain/document/settings.ts: ohne gespeicherte Zeile gelten die Defaults, keine
 * Migration noetig vor dem ersten Speichern. Datei-Uploads (Logo/Hintergrund, Magic-
 * Byte-Pruefung, Groessenlimit) leben in den PDF-/Upload-Aufgaben (Task 3), diese Datei
 * verwaltet nur die Pfade als Strings.
 */
import { dbInternal } from "@/lib/db";
import { brandingSettingsInputSchema, type BrandingSettingsInput } from "@/schemas/settings";
import { parseLayoutByType } from "@/domain/settings/layout";

export const DEFAULT_BRANDING_SETTINGS: BrandingSettingsInput = brandingSettingsInputSchema.parse({});

/** Laedt die Briefpapier-Einstellungen einer Organisation; Defaults, wenn noch keine Zeile existiert. */
export async function loadBrandingSettings(orgId: string): Promise<BrandingSettingsInput> {
  const row = await dbInternal.brandingSettings.findUnique({ where: { orgId } });
  if (!row) return DEFAULT_BRANDING_SETTINGS;
  return brandingSettingsInputSchema.parse({
    logoPath: row.logoPath,
    logoWidthMm: row.logoWidthMm,
    primaryColor: row.primaryColor,
    senderLine: row.senderLine,
    footerLeft: row.footerLeft,
    footerCenter: row.footerCenter,
    footerRight: row.footerRight,
    marginTopMm: row.marginTopMm,
    marginRightMm: row.marginRightMm,
    marginBottomMm: row.marginBottomMm,
    marginLeftMm: row.marginLeftMm,
    fontSizePt: row.fontSizePt,
    backgroundPath: row.backgroundPath,
    showBackground: row.showBackground,
    layoutId: row.layoutId,
    layoutByType: parseLayoutByType(row.layoutByTypeJson),
    footerMode: row.footerMode,
    appName: row.appName,
    appShortName: row.appShortName,
    faviconPath: row.faviconPath,
    appLogoPath: row.appLogoPath,
  });
}

/** Speichert die Briefpapier-Einstellungen (Upsert, da anfangs keine Zeile existiert). */
export async function saveBrandingSettings(orgId: string, rawInput: unknown): Promise<BrandingSettingsInput> {
  const input = brandingSettingsInputSchema.parse(rawInput);
  const { layoutByType, ...rest } = input;
  const data = { ...rest, layoutByTypeJson: JSON.stringify(layoutByType) };
  await dbInternal.brandingSettings.upsert({
    where: { orgId },
    create: { orgId, ...data },
    update: { ...data },
  });
  return input;
}
