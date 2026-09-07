/**
 * EN-16931-Kernregel-Validierung (pure JS, ohne Java).
 *
 * Prüft die geschäftskritischen Regeln (Pflichtfelder BR-01..BR-10/16/23/25 +
 * Rechenregeln BR-CO-10/13/14/15/16, BR-S-08) gegen die erzeugte XRechnung.
 * Das ist KEIN Ersatz für die vollständige KoSIT-/Schematron-Validierung —
 * diese läuft autoritativ im CI (.github/workflows/ci.yml mit dem offiziellen
 * KoSIT-Validator). Lokal hält dieser Check die wichtigsten Fehler ab.
 */
import { create } from "xmlbuilder2";
import { roundHalfUp } from "@/lib/money";
import type { EInvoiceData } from "./types";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function money(cents: number): string {
  return (cents / 100).toFixed(2);
}

function extractAmount(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<cbc:${tag}[^>]*>([^<]+)</cbc:${tag}>`));
  return match ? match[1] : null;
}

export function validateXRechnung(data: EInvoiceData, xml: string): ValidationResult {
  const errors: string[] = [];

  // Wohlgeformtheit
  try {
    create(xml);
  } catch (e) {
    errors.push("XML ist nicht wohlgeformt: " + (e as Error).message);
  }

  // Pflichtfelder (EN 16931 BR-01..BR-10)
  if (!xml.includes("CustomizationID")) errors.push("BR-01: CustomizationID (Spezifikationskennung) fehlt.");
  if (!data.number) errors.push("BR-02: Rechnungsnummer fehlt.");
  if (!data.issueDate) errors.push("BR-03: Ausstellungsdatum fehlt.");
  if (!data.currency) errors.push("BR-05: Währungscode fehlt.");
  if (!data.seller.name) errors.push("BR-06: Name des Verkäufers fehlt.");
  if (!data.seller.addressLine1 || !data.seller.city || !data.seller.postalCode || !data.seller.countryCode)
    errors.push("BR-08: Postanschrift des Verkäufers unvollständig.");
  if (!data.seller.vatId && !data.seller.taxNumber)
    errors.push("BR-CO-26: Verkäufer benötigt USt-IdNr. (BT-31) oder Steuernummer (BT-32).");
  if (!(data.buyerReference || data.number))
    errors.push("BR-DE-15: Käuferreferenz (BT-10) erforderlich.");
  if (!data.buyer.name) errors.push("BR-07: Name des Käufers fehlt.");
  if (!data.buyer.addressLine1 || !data.buyer.city || !data.buyer.postalCode || !data.buyer.countryCode)
    errors.push("BR-10: Postanschrift des Käufers unvollständig.");
  // Phase-4b-Review (Commit 0): data.lines enthaelt auch HEADING/TEXT/SUBTOTAL-Zeilen
  // (§8, reine Gliederungszeilen ohne Betrag) — BR-16 verlangt mindestens eine echte
  // Rechnungsposition (ITEM), nicht irgendeine Zeile. Fehlt lineType (Alt-Fixtures vor
  // Phase 4b), gilt die Zeile als ITEM (siehe xrechnung.ts/cii.ts isItemLine).
  const itemLineCount = data.lines.filter((l) => (l.lineType ?? "ITEM") === "ITEM").length;
  if (itemLineCount === 0) errors.push("BR-16: Mindestens eine Rechnungsposition erforderlich.");
  if (data.taxSubtotals.length === 0) errors.push("BR-CO-18: Mindestens eine USt-Aufschlüsselungsgruppe erforderlich.");

  data.lines.forEach((line, i) => {
    if (!line.description) errors.push(`BR-25: Position ${i + 1} ohne Bezeichnung.`);
    if (!line.unit) errors.push(`BR-23: Position ${i + 1} ohne Mengeneinheit.`);
  });

  // Rechenregeln
  // BR-CO-10: Σ Positionsnetto (BT-131, nach Zeilenrabatt) = Summe Positionsbeträge (BT-106).
  // Ohne Beleganpassung ist lineTotalCents === netTotalCents (Alt-Verhalten unveraendert).
  const lineSum = data.lines.reduce((s, l) => s + l.lineNetCents, 0);
  const expectedLineTotal = data.lineTotalCents ?? data.netTotalCents;
  if (lineSum !== expectedLineTotal)
    errors.push(`BR-CO-10: Σ Positionsnetto (${lineSum}) ≠ Summe Positionsbeträge (${expectedLineTotal}).`);

  // BR-CO-11/12: Σ Beleg-Allowance/Charge je Gruppe = AllowanceTotalAmount/ChargeTotalAmount.
  const allowanceSum = data.taxSubtotals.reduce((s, t) => s + (t.allowanceCents ?? 0), 0);
  const chargeSum = data.taxSubtotals.reduce((s, t) => s + (t.chargeCents ?? 0), 0);
  const expectedAllowanceTotal = data.allowanceTotalCents ?? 0;
  const expectedChargeTotal = data.chargeTotalCents ?? 0;
  if (allowanceSum !== expectedAllowanceTotal)
    errors.push(`BR-CO-11: Σ Belegrabatt (${allowanceSum}) ≠ AllowanceTotalAmount (${expectedAllowanceTotal}).`);
  if (chargeSum !== expectedChargeTotal)
    errors.push(`BR-CO-12: Σ Belegaufschlag (${chargeSum}) ≠ ChargeTotalAmount (${expectedChargeTotal}).`);

  // BR-CO-13: TaxExclusiveAmount = Σ LineExtension − AllowanceTotal + ChargeTotal.
  const subNet = data.taxSubtotals.reduce((s, t) => s + t.netCents, 0);
  const subTax = data.taxSubtotals.reduce((s, t) => s + t.taxCents, 0);
  const expectedTaxExclusive = expectedLineTotal - expectedAllowanceTotal + expectedChargeTotal;
  if (subNet !== data.netTotalCents)
    errors.push(`BR-CO-13: Σ steuerbare Beträge (${subNet}) ≠ Nettogesamtbetrag (${data.netTotalCents}).`);
  if (expectedTaxExclusive !== data.netTotalCents)
    errors.push(
      `BR-CO-13: Positionssumme − Rabatt + Aufschlag (${expectedTaxExclusive}) ≠ Nettogesamtbetrag (${data.netTotalCents}).`,
    );
  if (subTax !== data.taxTotalCents)
    errors.push(`BR-CO-14: Σ Steuerbeträge (${subTax}) ≠ Gesamtsteuerbetrag (${data.taxTotalCents}).`);

  for (const t of data.taxSubtotals) {
    const expected = roundHalfUp((t.netCents * t.taxRate) / 100);
    if (expected !== t.taxCents)
      errors.push(`BR-S-08: Steuer für Kategorie ${t.taxCategory}/${t.taxRate}% erwartet ${expected}, ist ${t.taxCents}.`);
  }

  if (data.grossTotalCents !== data.netTotalCents + data.taxTotalCents)
    errors.push("BR-CO-15: Bruttobetrag ≠ Nettobetrag + Gesamtsteuer.");

  const expectedPayable = data.grossTotalCents - (data.paidCents ?? 0);
  if (data.payableCents !== expectedPayable)
    errors.push("BR-CO-16: Zahlbetrag ≠ Bruttobetrag − Anzahlung.");

  // XML-Querprüfung: bindet die Validierung an die tatsächliche Ausgabe.
  // Gutschriften (CreditNote) werden mit positiven Beträgen ausgegeben.
  const payableInXmlExpected = data.type === "CREDIT_NOTE" ? Math.abs(data.payableCents) : data.payableCents;
  const payableInXml = extractAmount(xml, "PayableAmount");
  if (payableInXml !== money(payableInXmlExpected))
    errors.push(`XML: PayableAmount (${payableInXml}) ≠ erwartet ${money(payableInXmlExpected)}.`);

  return { valid: errors.length === 0, errors };
}
