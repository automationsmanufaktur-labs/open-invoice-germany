/**
 * Fusszeile (Phase 11b, Task 3, Spec "Fusszeile"): AUTO = vier Spalten aus den
 * Stammdaten (Firma/Adresse | Kontakt | Steuer/Inhaber | Bank), CUSTOM = die drei
 * Freitextfelder aus Phase 7 (footerLeft/-Center/-Right). Reine Funktion, die Layouts
 * zeichnen nur noch die fertigen Spalten (`PdfLayout#drawFooter`).
 *
 * Fix-Runde 1 (Koordinator-Ruling): striktes Gate auf `footerMode` — CUSTOM zeigt die
 * Freitextspalten (fallen alle drei leer aus, AUTO als Fallback), AUTO zeigt IMMER die
 * Stammdaten-Fusszeile, auch wenn footerLeft/-Center/-Right noch (Alt-)Text tragen.
 * `saveBrandingSettings` schaltet den Modus NICHT automatisch um (das macht erst die
 * Einstellungen-UI aus Task 7, ein Radio-Feld) — Bestandsorganisationen, die vor Phase
 * 11b bereits eine Freitext-Fusszeile gepflegt hatten, werden per Backfill-Migration
 * (`prisma/migrations/20260907090303_phase11b_footermode_backfill`,
 * `prisma/migrations-postgres/20260907090333_phase11b_footermode_backfill`) einmalig auf
 * footerMode = 'CUSTOM' gesetzt, damit ihre Fusszeile beim Umstieg unveraendert bleibt.
 */
import type { BrandingSettingsInput } from "@/schemas/settings";
import type { FooterColumn } from "./layouts/types";

export interface FooterFacts {
  seller: {
    name: string;
    addressLine1: string;
    addressLine2?: string | null;
    postalCode: string;
    city: string;
    vatId?: string | null;
    taxNumber?: string | null;
    email?: string | null;
    phone?: string | null;
  };
  iban?: string | null;
  bic?: string | null;
  bankName?: string | null;
  website?: string | null;
  ownerName?: string | null;
}

/** Gruppiert eine IBAN in 4er-Bloecke ("DE02120300000000202051" -> "DE02 1203 0000 0000 2020 51"). */
function groupIban(iban: string): string {
  return iban.replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim();
}

function compact(lines: (string | null | undefined | false)[]): string[] {
  return lines.filter((l): l is string => typeof l === "string" && l.trim().length > 0);
}

export function buildFooterColumns(facts: FooterFacts, brand: BrandingSettingsInput): FooterColumn[] {
  if (brand.footerMode === "CUSTOM") {
    const custom = compact([brand.footerLeft, brand.footerCenter, brand.footerRight]).map((t) => ({ lines: [t] }));
    if (custom.length > 0) return custom;
  }

  const s = facts.seller;
  const columns: FooterColumn[] = [
    { lines: compact([s.name, s.addressLine1, s.addressLine2, `${s.postalCode} ${s.city}`]) },
    { lines: compact([s.phone && `Tel. ${s.phone}`, s.email && `E-Mail ${s.email}`, facts.website && `Web ${facts.website}`]) },
    { lines: compact([s.vatId && `USt-IdNr. ${s.vatId}`, s.taxNumber && `Steuer-Nr. ${s.taxNumber}`, facts.ownerName && `Inhaber/-in ${facts.ownerName}`]) },
    { lines: compact([facts.bankName && `Bank ${facts.bankName}`, facts.iban && `IBAN ${groupIban(facts.iban)}`, facts.bic && `BIC ${facts.bic}`]) },
  ];
  return columns.filter((c) => c.lines.length > 0);
}
