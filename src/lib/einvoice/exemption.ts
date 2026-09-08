/**
 * BT-120 (TaxExemptionReason, Klartext) und BT-121 (TaxExemptionReasonCode, VATEX)
 * je UNTDID-5305-Steuerkategorie — EINZIGE Quelle fuer beide E-Rechnungs-Builder
 * (Phase 12b; vorher stand `exemptionReason` wortgleich in xrechnung.ts und cii.ts).
 *
 * BT-121 nur, wo die amtliche VATEX-Codeliste einen passenden Code kennt. Fuer § 19
 * (Kleinunternehmer, Kategorie E) und den Nullsatz (Z) gibt es keinen; dort erfuellt
 * BT-120 allein BR-E-10/BR-Z-10. Fuer § 25a (Differenzbesteuerung, ebenfalls E)
 * existiert kein EU-Code fuer die Margenbesteuerung von VERKAEUFEN — die VATEX-Codes
 * D/F/I/J betreffen innergemeinschaftliche ERWERBE und passen hier nicht.
 */
const REASON_TEXT: Record<string, string> = {
  // M11 (Fix-Welle Final-Review): wortgleich mit SCHEME_NOTICE.REVERSE_CHARGE
  // (src/domain/invoice/mandatory.ts) — hier BT-120 (TaxExemptionReason, EN 16931), dort der
  // Pflichthinweis nach § 14a Abs. 5 UStG. Zwei verschiedene Felder mit zufaellig identischem
  // Wortlaut, keine gemeinsame Quelle noetig — nicht verwechseln.
  AE: "Steuerschuldnerschaft des Leistungsempfängers",
  K: "Innergemeinschaftliche Lieferung",
  G: "Ausfuhrlieferung",
  E: "Steuerbefreit",
  Z: "Nullsatz",
  O: "Nicht steuerbar",
};

const REASON_CODE: Record<string, string> = {
  AE: "VATEX-EU-AE",
  K: "VATEX-EU-IC",
  G: "VATEX-EU-G",
  O: "VATEX-EU-O",
};

export function exemptionReasonText(category: string): string | null {
  return REASON_TEXT[category] ?? null;
}

export function exemptionReasonCode(category: string): string | null {
  return REASON_CODE[category] ?? null;
}
