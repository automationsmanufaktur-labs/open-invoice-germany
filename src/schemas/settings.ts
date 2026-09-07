/**
 * Zod-Schemas fuer Phase 7 (Belegeinstellungen, Briefpapier, Druckoptionen,
 * Nummernkreise). Domain-Funktionen parsen ihre Eingabe selbst (Lastenheft 50/55)
 * — kein Bypass ueber Route, UI oder MCP.
 */
import { z } from "zod";

// ── Druckoptionen (§36) ─────────────────────────────────────────────────────

// Die zehn Druckoptionen-Schalter OHNE Default — Basis fuer printSettingsInputSchema
// (globale Einstellungen, jedes Feld bekommt unten einen Default) UND
// printOptionsOverrideSchema (Beleg-Ueberschreibung, jedes Feld bleibt optional OHNE
// Default — `.partial()` auf einem Schema mit `.default()` wuerde die Defaults beim
// Parsen weiterhin anwenden statt sie wegzulassen, siehe Zod-Verhalten von `.default()`).
const printOptionFields = {
  showFooter: z.boolean(),
  showPageNumbers: z.boolean(),
  foldMarks: z.boolean(),
  punchMarks: z.boolean(),
  showArticleNumber: z.boolean(),
  showDescription: z.boolean(),
  showTaxRatePerLine: z.boolean(),
  showLineTotals: z.boolean(),
  showSenderLine: z.boolean(),
  showGiroCode: z.boolean(),
};

const PRINT_OPTION_DEFAULTS = {
  showFooter: true,
  showPageNumbers: true,
  foldMarks: false,
  punchMarks: false,
  showArticleNumber: true,
  showDescription: true,
  showTaxRatePerLine: true,
  showLineTotals: true,
  showSenderLine: true,
  showGiroCode: true,
} as const;

/** Die zehn globalen Druckoptionen-Schalter, mit Defaults (PrintSettings-Modell). */
export const printSettingsInputSchema = z.object({
  showFooter: printOptionFields.showFooter.default(PRINT_OPTION_DEFAULTS.showFooter),
  showPageNumbers: printOptionFields.showPageNumbers.default(PRINT_OPTION_DEFAULTS.showPageNumbers),
  foldMarks: printOptionFields.foldMarks.default(PRINT_OPTION_DEFAULTS.foldMarks),
  punchMarks: printOptionFields.punchMarks.default(PRINT_OPTION_DEFAULTS.punchMarks),
  showArticleNumber: printOptionFields.showArticleNumber.default(PRINT_OPTION_DEFAULTS.showArticleNumber),
  showDescription: printOptionFields.showDescription.default(PRINT_OPTION_DEFAULTS.showDescription),
  showTaxRatePerLine: printOptionFields.showTaxRatePerLine.default(PRINT_OPTION_DEFAULTS.showTaxRatePerLine),
  showLineTotals: printOptionFields.showLineTotals.default(PRINT_OPTION_DEFAULTS.showLineTotals),
  showSenderLine: printOptionFields.showSenderLine.default(PRINT_OPTION_DEFAULTS.showSenderLine),
  showGiroCode: printOptionFields.showGiroCode.default(PRINT_OPTION_DEFAULTS.showGiroCode),
});
export type PrintSettingsInput = z.infer<typeof printSettingsInputSchema>;

/**
 * Beleg-individuelle Ueberschreibung der globalen PrintSettings (Invoice/Quote/
 * DeliveryNote.printOptionsJson) — dieselben zehn Schalter, aber alle optional und
 * OHNE Default (nur tatsaechlich gesetzte Felder ueberschreiben effectivePrintOptions).
 */
export const printOptionsOverrideSchema = z.object(printOptionFields).partial();
export type PrintOptionsOverride = z.infer<typeof printOptionsOverrideSchema>;

// ── Briefpapier / Branding (§35) ─────────────────────────────────────────────

const brandingText200 = z.string().trim().max(200);
const brandingText500 = z.string().trim().max(500);

export const brandingSettingsInputSchema = z.object({
  logoPath: z.string().nullable().default(null),
  logoWidthMm: z.coerce.number().int().min(10).max(100).default(40),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Farbe muss ein Hex-Code im Format #RRGGBB sein")
    .default("#111111"),
  senderLine: brandingText200.nullable().default(null),
  footerLeft: brandingText500.nullable().default(null),
  footerCenter: brandingText500.nullable().default(null),
  footerRight: brandingText500.nullable().default(null),
  marginTopMm: z.coerce.number().int().min(5).max(40).default(20),
  marginRightMm: z.coerce.number().int().min(5).max(40).default(18),
  marginBottomMm: z.coerce.number().int().min(5).max(40).default(20),
  marginLeftMm: z.coerce.number().int().min(5).max(40).default(18),
  fontSizePt: z.coerce.number().int().min(8).max(14).default(10),
  backgroundPath: z.string().nullable().default(null),
  showBackground: z.boolean().default(false),
});
export type BrandingSettingsInput = z.infer<typeof brandingSettingsInputSchema>;

// ── Nummernkreise (§34) ──────────────────────────────────────────────────────

export const NUMBER_RANGE_DOC_TYPES = [
  "CUSTOMER",
  "PRODUCT",
  "ANGEBOT",
  "AUFTRAGSBESTAETIGUNG",
  "PROFORMA",
  "DELIVERY_NOTE",
  "INVOICE",
  "CREDIT_NOTE",
  "DUNNING",
] as const;
export const NumberRangeDocType = z.enum(NUMBER_RANGE_DOC_TYPES);
export type NumberRangeDocType = z.infer<typeof NumberRangeDocType>;

// Das Pattern MUSS einen {SEQ}- oder {SEQ:n}-Platzhalter enthalten — ohne fortlaufende
// Zaehlung gaebe es keine eindeutige Nummer (§14 Abs.4 Nr.4 UStG fuer Belege; analog
// fuer Kunden-/Artikelnummern).
// Nit (Final-Review): `{SEQ:10}`+ (zweistellige Explizit-Stellenzahl) wurde vorher vom
// `\d` (genau eine Ziffer) abgelehnt, obwohl formatDocumentNumber() (numbering.ts) beliebig
// viele Stellen unterstuetzt — `\d+`.
const SEQ_PLACEHOLDER = /\{SEQ(:\d+)?\}/;
// B3 (Final-Review): bei yearlyReset:true MUSS das Muster einen Jahres-Platzhalter
// enthalten — sonst wiederholt sich z.B. "RE-{SEQ}" jedes Jahr ab 0001 und die
// Rechnungsnummer waere nicht mehr einmalig (§14 Abs.4 Nr.4 UStG).
const YEAR_PLACEHOLDER = /\{YYYY\}|\{YY\}/;

export const numberRangeInputSchema = z
  .object({
    pattern: z.string().trim().min(1).max(80).refine((v) => SEQ_PLACEHOLDER.test(v), {
      message: "Das Muster muss einen {SEQ}- oder {SEQ:n}-Platzhalter enthalten.",
    }),
    prefix: z.string().trim().max(10).default(""),
    seqPadding: z.coerce.number().int().min(1).max(8).default(4),
    yearlyReset: z.boolean().default(false),
    /** Naechste zu vergebende Nummer (1-basiert, wie NumberRange.currentValue + 1). */
    nextValue: z.coerce.number().int().min(1),
  })
  .refine((v) => !v.yearlyReset || YEAR_PLACEHOLDER.test(v.pattern), {
    message: "Bei jaehrlichem Zuruecksetzen muss das Muster einen {YYYY}- oder {YY}-Platzhalter enthalten.",
    path: ["pattern"],
  });
export type NumberRangeInput = z.infer<typeof numberRangeInputSchema>;
