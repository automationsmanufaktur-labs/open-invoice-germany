/**
 * Prüfung der Rechnungs-Pflichtangaben nach § 14 Abs. 4 / § 14a UStG sowie der
 * schema-spezifischen Pflichthinweise. Rein (keine DB) und damit voll testbar.
 *
 * Quelle: COMPLIANCE.md Abschnitt 1, 3, 8, 9. Diese Prüfung blockt das
 * Festschreiben (finalize), wenn Pflichtangaben fehlen.
 */

export interface MandatoryOrg {
  legalName: string;
  addressLine1: string;
  postalCode: string;
  city: string;
  taxNumber?: string | null;
  vatId?: string | null;
}

export interface MandatoryCustomer {
  name: string;
  addressLine1: string;
  postalCode: string;
  city: string;
  vatId?: string | null;
}

export interface MandatoryLine {
  description: string;
  quantityMilli: number;
  taxRate: number;
  taxCategory: string;
  // Phase 4b (§8) — Fix-Welle K1: HEADING/TEXT/SUBTOTAL sind reine Gliederungszeilen ohne
  // Betrag/Menge und duerfen die Pflichtangaben-Pruefung nicht mit einem
  // "Menge fehlt/0"-Befund blockieren. Fehlt lineType (Alt-Aufrufer), wird ITEM angenommen.
  lineType?: string;
}

export interface MandatoryInvoice {
  type: string; // INVOICE | CREDIT_NOTE | CORRECTION
  taxScheme: string;
  issueDate?: Date | string | null;
  deliveryDate?: Date | string | null;
  deliveryStart?: Date | string | null;
  deliveryEnd?: Date | string | null;
  notes?: string | null;
  isSmallAmount?: boolean; // Kleinbetragsrechnung § 33 UStDV (≤ 250 € brutto)
  lines: readonly MandatoryLine[];
  org: MandatoryOrg;
  customer: MandatoryCustomer;
}

/** Pflichthinweis-Texte je Steuerschema (§ 14a UStG). */
export const SCHEME_NOTICE: Record<string, string> = {
  REVERSE_CHARGE: "Steuerschuldnerschaft des Leistungsempfängers",
  KLEINUNTERNEHMER: "Kleinunternehmer gemäß § 19 UStG, kein Ausweis von Umsatzsteuer",
  DIFFERENZ: "Gebrauchtgegenstände/Sonderregelung (§ 25a UStG)",
  IG_LIEFERUNG: "Steuerfreie innergemeinschaftliche Lieferung",
  IG_LEISTUNG: "Steuerschuldnerschaft des Leistungsempfängers",
  DRITTLAND_LEISTUNG: "Nicht im Inland steuerbar",
};

function hasDeliveryInfo(inv: MandatoryInvoice): boolean {
  return Boolean(inv.deliveryDate || (inv.deliveryStart && inv.deliveryEnd) || inv.notes);
}

/**
 * Liefert eine Liste fehlender/fehlerhafter Pflichtangaben. Leer = ok.
 */
export function validateMandatoryFields(inv: MandatoryInvoice): string[] {
  const problems: string[] = [];
  const { org, customer } = inv;

  // § 14 Abs. 4 Nr. 1 — Aussteller
  if (!org.legalName?.trim()) problems.push("Name des leistenden Unternehmers fehlt (§ 14 Abs. 4 Nr. 1).");
  if (!org.addressLine1?.trim() || !org.postalCode?.trim() || !org.city?.trim())
    problems.push("Vollständige Anschrift des leistenden Unternehmers fehlt (§ 14 Abs. 4 Nr. 1).");

  // § 14 Abs. 4 Nr. 2 — Steuernummer ODER USt-IdNr.
  if (!org.taxNumber?.trim() && !org.vatId?.trim())
    problems.push("Steuernummer oder USt-IdNr. des Ausstellers fehlt (§ 14 Abs. 4 Nr. 2).");

  // Kleinbetragsrechnung (§ 33 UStDV) lässt Empfängerangaben + Leistungszeitpunkt weg.
  const smallAmount = Boolean(inv.isSmallAmount);

  // § 14 Abs. 4 Nr. 1 — Empfänger (nicht bei Kleinbetrag)
  if (!smallAmount) {
    if (!customer.name?.trim()) problems.push("Name des Leistungsempfängers fehlt (§ 14 Abs. 4 Nr. 1).");
    if (!customer.addressLine1?.trim() || !customer.postalCode?.trim() || !customer.city?.trim())
      problems.push("Vollständige Anschrift des Leistungsempfängers fehlt (§ 14 Abs. 4 Nr. 1).");
  }

  // § 14 Abs. 4 Nr. 3 — Ausstellungsdatum
  if (!inv.issueDate) problems.push("Ausstellungsdatum fehlt (§ 14 Abs. 4 Nr. 3).");

  // § 14 Abs. 4 Nr. 5 — Menge/Art der Leistung. Nur ITEM-Zeilen zaehlen als Positionen im
  // Sinne dieser Vorschrift — HEADING/TEXT/SUBTOTAL sind reine Gliederungszeilen ohne
  // Betrag/Menge (§8, kein Menge-0-Workaround) und werden hier uebersprungen.
  const itemLines = inv.lines.filter((l) => (l.lineType ?? "ITEM") === "ITEM");
  if (itemLines.length === 0) problems.push("Mindestens eine Position erforderlich (§ 14 Abs. 4 Nr. 5).");
  itemLines.forEach((line, idx) => {
    if (!line.description?.trim())
      problems.push(`Position ${idx + 1}: Leistungsbeschreibung fehlt (§ 14 Abs. 4 Nr. 5).`);
    if (!Number.isFinite(line.quantityMilli) || line.quantityMilli === 0)
      problems.push(`Position ${idx + 1}: Menge fehlt/0 (§ 14 Abs. 4 Nr. 5).`);
  });

  // § 14 Abs. 4 Nr. 6 — Leistungszeitpunkt (nicht bei Kleinbetrag)
  if (!smallAmount && !hasDeliveryInfo(inv))
    problems.push("Leistungs-/Lieferzeitpunkt fehlt (§ 14 Abs. 4 Nr. 6) — Datum oder Zeitraum oder Hinweis erforderlich.");

  // § 14 Abs. 4 Nr. 8 / § 14a — Steuerausweis oder Befreiungshinweis
  const scheme = inv.taxScheme;
  const noticeRequired = SCHEME_NOTICE[scheme];
  if (noticeRequired) {
    const notes = (inv.notes ?? "").toLowerCase();
    const ok = notes.includes(noticeRequired.toLowerCase().split(" ")[0]); // grobe Heuristik auf Kernbegriff
    if (!ok)
      problems.push(
        `Pflichthinweis für Schema ${scheme} fehlt im Hinweistext: "${noticeRequired}" (§ 14a UStG / § 14 Abs. 4 Nr. 8).`,
      );
    // Bei steuerbefreiten Schemata darf KEIN USt-Satz > 0 ausgewiesen sein.
    if (inv.lines.some((l) => l.taxRate > 0))
      problems.push(`Schema ${scheme}: Positionen dürfen keinen USt-Satz > 0 ausweisen (§ 14c-Risiko).`);
  }

  // ig. Lieferung/Leistung: USt-IdNr. beider Parteien (§ 14a Abs. 1/3)
  if (scheme === "IG_LIEFERUNG" || scheme === "IG_LEISTUNG") {
    if (!org.vatId?.trim()) problems.push("USt-IdNr. des Ausstellers erforderlich (§ 14a Abs. 1/3).");
    if (!customer.vatId?.trim()) problems.push("USt-IdNr. des Empfängers erforderlich (§ 14a Abs. 1/3).");
  }

  return problems;
}
