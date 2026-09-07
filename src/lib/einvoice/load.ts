/**
 * Lädt eine Rechnung samt Org/Kunde/Positionen und baut die E-Rechnungs-Daten.
 * Bei Gutschrift/Korrektur wird die Vorgänger-Referenz (BG-3) mit aufgelöst.
 * Phase 5: bei type FINAL zusätzlich der Abzugs-Snapshot (FinalInvoiceDeduction, je
 * Abschlagsrechnung über alle Steuersätze aggregiert); bei PARTIAL/DOWNPAYMENT/FINAL
 * zusätzlich die Nummer/Art der Quelle (Angebot/Auftragsbestätigung/Lieferschein) — NUR
 * fürs PDF ("Bezug zu ..."), nie ins XML.
 */
import { dbInternal } from "@/lib/db";
import { buildEInvoiceData } from "./mapper";

const INCLUDE = {
  lines: { orderBy: { position: "asc" as const } },
  org: true,
  customer: true,
  finalDeductions: { orderBy: { issueDate: "asc" as const } },
} as const;

const SOURCE_LABELS: Record<string, string> = {
  ANGEBOT: "Angebot",
  AUFTRAGSBESTAETIGUNG: "Auftrag",
  PROFORMA: "Proforma-Rechnung",
};

/** Aggregiert die (ggf. je Steuersatz mehrfachen) Abzugs-Snapshot-Zeilen einer
 * Abschlagsrechnung zu EINEM Eintrag über alle Steuersätze (netCents/taxCents/grossCents
 * summiert) — Reihenfolge/Werte für BG-3, BT-22-Aufstellung und PDF-Abzugsblock. */
function aggregateDeductions(
  rows: { downpaymentInvoiceId: string; number: string; issueDate: Date; netCents: number; taxCents: number; grossCents: number }[],
): { number: string; issueDate: Date; netCents: number; taxCents: number; grossCents: number }[] {
  const byDownpayment = new Map<string, { number: string; issueDate: Date; netCents: number; taxCents: number; grossCents: number }>();
  for (const row of rows) {
    const existing = byDownpayment.get(row.downpaymentInvoiceId);
    if (existing) {
      existing.netCents += row.netCents;
      existing.taxCents += row.taxCents;
      existing.grossCents += row.grossCents;
    } else {
      byDownpayment.set(row.downpaymentInvoiceId, {
        number: row.number,
        issueDate: row.issueDate,
        netCents: row.netCents,
        taxCents: row.taxCents,
        grossCents: row.grossCents,
      });
    }
  }
  return [...byDownpayment.values()].sort((a, b) => a.issueDate.getTime() - b.issueDate.getTime() || a.number.localeCompare(b.number));
}

export async function loadEInvoiceData(invoiceId: string) {
  const invoice = await dbInternal.invoice.findUnique({ where: { id: invoiceId }, include: INCLUDE });
  if (!invoice) return null;

  let sourceNumber: string | null = null;
  let sourceLabel: string | null = null;
  if (invoice.sourceType === "QUOTE" && invoice.sourceId) {
    const quote = await dbInternal.quote.findUnique({ where: { id: invoice.sourceId }, select: { number: true, kind: true } });
    if (quote) {
      sourceNumber = quote.number;
      sourceLabel = SOURCE_LABELS[quote.kind] ?? "Angebot";
    }
  } else if (invoice.sourceType === "DELIVERY_NOTE" && invoice.sourceId) {
    const deliveryNote = await dbInternal.deliveryNote.findUnique({ where: { id: invoice.sourceId }, select: { number: true } });
    if (deliveryNote) {
      sourceNumber = deliveryNote.number;
      sourceLabel = "Lieferschein";
    }
  }

  const data = buildEInvoiceData({
    ...invoice,
    deductions: invoice.type === "FINAL" ? aggregateDeductions(invoice.finalDeductions) : undefined,
    sourceNumber,
    sourceLabel,
  });

  if (invoice.correctsInvoiceId) {
    const original = await dbInternal.invoice.findUnique({
      where: { id: invoice.correctsInvoiceId },
      select: { number: true, issueDate: true },
    });
    if (original) {
      data.precedingInvoiceNumber = original.number;
      data.precedingInvoiceDate = original.issueDate;
    }
  }

  return { invoice, data };
}
