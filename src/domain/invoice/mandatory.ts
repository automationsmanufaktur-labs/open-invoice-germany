/**
 * Prüfung der Rechnungs-Pflichtangaben nach § 14 Abs. 4 / § 14a UStG sowie der
 * schema-spezifischen Pflichthinweise. Rein (keine DB) und damit voll testbar.
 *
 * Quelle: COMPLIANCE.md Abschnitt 1, 3, 8, 9. Diese Prüfung blockt das
 * Festschreiben (finalize), wenn Pflichtangaben fehlen.
 */

import { ZERO_TAX_SCHEMES, EU_COUNTRY_CODES, EU_VAT_PREFIXES } from "@/lib/tax";

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
  countryCode?: string | null;
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

/**
 * Pflichthinweis-Texte je Steuerschema (§ 14 Abs. 4 Nr. 8, § 14a UStG). EINZIGE Quelle
 * im Projekt — src/lib/editor/constants.ts und src/mcp/tools/invoices.ts importieren von
 * hier. Quellen: COMPLIANCE.md § 1 (§ 14a), § 3 (§ 34a UStDV), § 8 (§ 13b/§ 6a), § 9 (§ 25a).
 */
export const SCHEME_NOTICE: Record<string, string> = {
  // § 14a Abs. 5 UStG — wortgleich vorgeschrieben.
  REVERSE_CHARGE: "Steuerschuldnerschaft des Leistungsempfängers",
  // § 3a Abs. 2 UStG (Leistungsort beim Empfaenger) i. V. m. § 14a Abs. 1/5 UStG.
  IG_LEISTUNG: "Steuerschuldnerschaft des Leistungsempfängers",
  IG_LIEFERUNG: "Steuerfreie innergemeinschaftliche Lieferung (§ 4 Nr. 1 Buchst. b i. V. m. § 6a UStG)",
  AUSFUHR: "Steuerfreie Ausfuhrlieferung (§ 4 Nr. 1 Buchst. a i. V. m. § 6 UStG)",
  // § 34a UStDV (Fassung ab 1.1.2025).
  KLEINUNTERNEHMER: "Kleinunternehmer gemäß § 19 UStG, kein Ausweis von Umsatzsteuer",
  // § 14a Abs. 6 Satz 1 UStG — eine der drei zulaessigen Formulierungen.
  DIFFERENZ: "Gebrauchtgegenstände/Sonderregelung (§ 25a UStG)",
};

/** § 14b Abs. 1 Satz 5 UStG (§ 14 Abs. 4 Nr. 9) — Text fuer PDF UND beide XML-Formate. */
export const CONSUMER_RETENTION_HINT =
  "Sie sind verpflichtet, diese Rechnung zwei Jahre aufzubewahren (§ 14b Abs. 1 Satz 5 UStG).";

/** Vergleichsform: klein, Umlaute/ß gefaltet, Whitespace normalisiert. */
export function normalizeNotice(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Zulaessige Formulierungen je Schema (auf normalizeNotice-Text). Ersetzt die frühere
 * Heuristik "erstes Wort des Pflichttextes kommt irgendwo vor" — die liess z. B.
 * "Steuerfreie Lieferung nach Absprache" als ig. Lieferung durchgehen. § 14a Abs. 6 UStG
 * laesst fuer § 25a genau drei Wortlaute zu.
 */
export const SCHEME_NOTICE_ACCEPTED: Record<string, RegExp[]> = {
  REVERSE_CHARGE: [/steuerschuldnerschaft des leistungsempfaengers/],
  IG_LEISTUNG: [/steuerschuldnerschaft des leistungsempfaengers/],
  IG_LIEFERUNG: [/steuerfreie innergemeinschaftliche lieferung/],
  AUSFUHR: [/steuerfreie ausfuhrlieferung/],
  KLEINUNTERNEHMER: [/kleinunternehmer(?=[\s\S]*\b19\b)/],
  DIFFERENZ: [
    /gebrauchtgegenstaende\s*\/\s*sonderregelung/,
    /kunstgegenstaende\s*\/\s*sonderregelung/,
    /sammlungsstuecke und antiquitaeten\s*\/\s*sonderregelung/,
  ],
};

function hasDeliveryInfo(inv: MandatoryInvoice): boolean {
  return Boolean(inv.deliveryDate || (inv.deliveryStart && inv.deliveryEnd) || inv.notes);
}

/** BR-IC-11: bei ig. Lieferung genuegt der Freitext NICHT — es braucht BT-72 oder BG-14. */
function hasDeliveryDateOrPeriod(inv: MandatoryInvoice): boolean {
  return Boolean(inv.deliveryDate || (inv.deliveryStart && inv.deliveryEnd));
}
/** Zweistelliges USt-IdNr.-Praefix, gross, ohne Leerzeichen. */
function vatPrefix(vatId: string | null | undefined): string {
  return (vatId ?? "").replace(/\s/g, "").slice(0, 2).toUpperCase();
}

export interface ValidateMandatoryOptions {
  /**
   * C1 (Fix-Welle Phase 12b): true fuer einen Korrekturbeleg (Storno via cancel.ts,
   * Teilgutschrift via credit.ts — beide setzen Invoice.correctsInvoiceId, wovon
   * finalize.ts diese Option ableitet; kuenftige CORRECTION-Belege ebenso, sobald sie
   * dieselbe Verknuepfung setzen). Ein Korrekturbeleg berichtigt ein bereits
   * festgeschriebenes Original — seine Pflichtangaben (Hinweistext, Leistungszeitraum,
   * Empfaenger-Kennung, Empfaenger-Land) sind durch das Original determiniert und vom
   * Aufrufer nicht mehr korrigierbar. Die materiellen Phase-12b-Zusatzpruefungen (BR-IC-11-
   * Datum, EU-Praefix, REVERSE_CHARGE-USt-IdNr., AUSFUHR-Land/-Aussteller-USt-IdNr.) sowie
   * die verschaerfte Hinweis-Regexpruefung wuerden sonst genau den Korrekturweg blockieren,
   * den Lastenheft §51/GoBD als EINZIGEN zulaessigen Weg fuer eine festgeschriebene
   * Rechnung vorschreiben — u. a. fuer Bestandsbelege, die vor dieser Pruefung mit
   * Alt-Hinweistext/ohne Leistungsdatum/ohne Empfaenger-USt-IdNr. wirksam festgeschrieben
   * wurden. Die uebrigen § 14-Pflichtangaben (Nr. 1-3/5/6, USt-Satz-0-Pruefung fuer
   * steuerbefreite Schemata) bleiben UNVERAENDERT auch fuer Korrekturbelege scharf.
   */
  isCorrection?: boolean;
}

/**
 * Liefert eine Liste fehlender/fehlerhafter Pflichtangaben. Leer = ok.
 */
export function validateMandatoryFields(inv: MandatoryInvoice, opts: ValidateMandatoryOptions = {}): string[] {
  const problems: string[] = [];
  const { org, customer } = inv;
  const isCorrection = opts.isCorrection ?? false;

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

  // § 14 Abs. 4 Nr. 8 / § 14a — Steuerausweis oder Befreiungshinweis. C1 (Fix-Welle):
  // NICHT bei Korrekturbelegen — siehe ValidateMandatoryOptions.isCorrection. Ein
  // Bestandsbeleg, dessen Hinweistext vor der exakten Regexpruefung (Task 2) mit der
  // frueheren Erst-Wort-Heuristik wirksam festgeschrieben wurde, muss weiterhin
  // stornierbar/gutschreibbar bleiben.
  const scheme = inv.taxScheme;
  const noticeRequired = SCHEME_NOTICE[scheme];
  if (noticeRequired && !isCorrection) {
    const accepted = SCHEME_NOTICE_ACCEPTED[scheme] ?? [];
    const normalized = normalizeNotice(inv.notes ?? "");
    if (!accepted.some((re) => re.test(normalized))) {
      problems.push(`Pflichthinweis für Schema ${scheme} fehlt im Hinweistext: "${noticeRequired}" (§ 14a UStG / § 14 Abs. 4 Nr. 8).`);
    }
  }
  // Bei steuerbefreiten Schemata darf KEIN USt-Satz > 0 ausgewiesen sein (§ 14c-Risiko).
  // Bleibt auch bei Korrekturbelegen scharf — kein Task-2-Blocker, sondern eine schon
  // vor Phase 12b implizit geltende, hier nur benannte Bedingung (COMPLIANCE.md § 8).
  if (ZERO_TAX_SCHEMES.has(scheme) && inv.lines.some((l) => l.taxRate > 0)) {
    problems.push(`Schema ${scheme}: Positionen dürfen keinen USt-Satz > 0 ausweisen (§ 14c-Risiko).`);
  }

  // ig. Lieferung/Leistung: USt-IdNr. beider Parteien (§ 14a Abs. 1/3) — vor Phase 12b
  // bereits geltende Pruefung, bleibt auch bei Korrekturbelegen scharf.
  if (scheme === "IG_LIEFERUNG" || scheme === "IG_LEISTUNG") {
    if (!org.vatId?.trim()) problems.push("USt-IdNr. des Ausstellers erforderlich (§ 14a Abs. 1/3).");
    if (!customer.vatId?.trim()) problems.push("USt-IdNr. des Empfängers erforderlich (§ 14a Abs. 1/3).");
  }

  // Phase 12b — materielle Zusatzvoraussetzungen (C1, Fix-Welle: die VIER neuen Blocker
  // dieses Abschnitts gelten NICHT fuer Korrekturbelege — siehe ValidateMandatoryOptions.
  // isCorrection). Ein Storno/eine Teilgutschrift spiegelt ein bereits festgeschriebenes
  // Original; seine materiellen Tatbestandsvoraussetzungen (Leistungszeitraum, Empfaenger-/
  // Ausstellerkennung, Empfaengerland) sind zum Ursprungszeitpunkt determiniert und vom
  // Korrekturpfad nicht mehr nachtraeglich herstellbar (z. B. wenn sich Kunden-Stammdaten
  // seither geaendert haben oder der Beleg vor dieser Pruefung finalisiert wurde).
  if (!isCorrection) {
    if (scheme === "IG_LIEFERUNG") {
      if (!hasDeliveryDateOrPeriod(inv)) {
        problems.push("Innergemeinschaftliche Lieferung: Leistungsdatum oder Leistungszeitraum erforderlich (§ 14 Abs. 4 Nr. 6; EN 16931 BR-IC-11) — ein Hinweistext genügt hier nicht.");
      }
      const prefix = vatPrefix(customer.vatId);
      if (customer.vatId?.trim() && (prefix === "DE" || !EU_VAT_PREFIXES.has(prefix))) {
        problems.push("USt-IdNr. des Empfängers muss aus einem anderen EU-Mitgliedstaat stammen (§ 6a Abs. 1 Nr. 4 UStG).");
      }
    }
    if (scheme === "REVERSE_CHARGE" && !customer.vatId?.trim()) {
      // I1 (Fix-Welle): EN 16931 BR-AE-02 verlangt fuer die Rechnungszeile die
      // Empfaenger-USt-IdNr. (BT-48) UND/ODER die Empfaenger-Handelsregisternummer
      // (BT-47) — § 13b UStG selbst fordert KEINE Empfaenger-Kennung (nur den
      // Pflichthinweis nach § 14a Abs. 5 S. 1, s. o.). BT-47 bildet das Datenmodell
      // dieser Software nicht ab (kein eigenes Kundenfeld) — deshalb wird ausschliesslich
      // die USt-IdNr. geprueft; siehe COMPLIANCE.md § 8 / docs/LIMITATIONEN.md.
      problems.push("USt-IdNr. des Empfängers erforderlich, damit die E-Rechnung EN 16931 (BR-AE-02) erfüllt ist.");
    }
    if (scheme === "AUSFUHR") {
      const country = (customer.countryCode ?? "").toUpperCase();
      if (!country || EU_COUNTRY_CODES.has(country)) {
        problems.push("Ausfuhrlieferung setzt einen Empfänger außerhalb der EU voraus (§ 6 Abs. 1 UStG) — Länderkennzeichen des Kunden prüfen.");
      }
      // I3/M8 (Fix-Welle): ohne Aussteller-USt-IdNr. verletzt Kategorie G BR-G-02/BR-G-03
      // (Seller VAT Identifier BT-31 oder Vertreter-USt-IdNr. BT-63) — der BT-29-Zusatz
      // aus Task 6 (Steuernummer als generische Verkaeuferkennung) erfuellt diese Regel
      // NICHT, die verlangt ausdruecklich eine USt-IdNr.
      if (!org.vatId?.trim()) {
        problems.push("Ausfuhrlieferung: USt-IdNr. des Ausstellers erforderlich, damit die E-Rechnung EN 16931 (BR-G-02/BR-G-03) erfüllt ist.");
      }
    }
  }

  return problems;
}
