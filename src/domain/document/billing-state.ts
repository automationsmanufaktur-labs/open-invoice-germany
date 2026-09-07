/**
 * Abgeleiteter Abrechnungsstand eines Angebots/einer Auftragsbestaetigung: Er wird
 * nicht gespeichert, sondern aus den Dokumentrelationen (src/domain/relations.ts)
 * berechnet — FULL/PARTIAL/NONE ergeben sich rein aus CONVERTED_TO/PARTIAL_OF/
 * DOWNPAYMENT_OF/FINAL_FOR-Verknuepfungen zu Rechnungen.
 */
import { dbInternal } from "@/lib/db";
import { listRelations } from "@/domain/relations";
import { billedQuantities } from "@/domain/invoice/billed-quantities";
import { BillingState, DocRefType } from "@/schemas";

export interface BillingStateResult {
  state: BillingState;
  invoiceIds: string[];
  /** Phase 5: Anteil bereits abgerechneter Teil-/Abschlagsrechnungen an der Gesamtleistung
   * (0..1000), auf Basis der Bruttosumme aktiver (nicht stornierter) Teil-/Abschlags-
   * rechnungen im Verhaeltnis zur Bruttosumme des Angebots. 1000 bei FULL. */
  billedPermille: number;
  /** Phase 5: Summe der Bruttobetraege aktiver (nicht stornierter) Abschlagsrechnungen. */
  downpaymentGrossCents: number;
  /** Fix-Welle (B8): true, wenn bereits eine festgeschriebene, nicht stornierte
   * Schlussrechnung (FINAL_FOR) existiert — unabhaengig vom Gesamtstatus FULL/PARTIAL
   * (der auch durch 100 % Abschlag-/Teilrechnungsdeckung OHNE Schlussrechnung erreicht
   * wird). Steuert, ob „Schlussrechnung erzeugen" noch angeboten werden darf. */
  hasActiveFinal: boolean;
}

const FINALIZED_STATUSES = new Set(["FINALIZED", "SENT", "PARTIALLY_PAID", "PAID"]);

/**
 * FULL: mindestens eine CONVERTED_TO-Relation auf eine Rechnung, die nicht CANCELLED ist,
 * ODER eine festgeschriebene, nicht stornierte FINAL_FOR-Rechnung, ODER die Summe der
 * Teil-/Abschlagsrechnungen deckt bereits 100 % der Gesamtleistung (Betrag oder Menge).
 * PARTIAL (Phase 5): PARTIAL_OF/DOWNPAYMENT_OF-Relationen vorhanden, aber (noch) keine
 * vollstaendige Deckung — Anzahlungen/Teilrechnungen ohne (festgeschriebene) Schlussrechnung.
 * NONE: sonst (auch wenn nur stornierte Rechnungen verknuepft sind).
 */
export async function billingStateFor(orgId: string, type: "QUOTE", id: string): Promise<BillingStateResult> {
  DocRefType.parse(type);
  const relations = await listRelations(orgId, type, id);
  // CONVERTED_TO zeigt VON der Quelle AUF die Rechnung (src/domain/document/convert.ts:
  // linkDocuments({fromType:"QUOTE", toType:"INVOICE", ...})). PARTIAL_OF/DOWNPAYMENT_OF/
  // FINAL_FOR zeigen umgekehrt VON der Rechnung AUF die Quelle (Task-2-Facts: "Relation
  // ... (from Rechnung, to Quelle)") — deshalb zwei getrennte Filter.
  const outgoing = relations.filter((r) => r.fromType === type && r.fromId === id && r.toType === "INVOICE");
  const incoming = relations.filter((r) => r.toType === type && r.toId === id && r.fromType === "INVOICE");

  const convertedInvoiceIds = outgoing.filter((r) => r.relationType === "CONVERTED_TO").map((r) => r.toId);
  const partialInvoiceIds = incoming.filter((r) => r.relationType === "PARTIAL_OF").map((r) => r.fromId);
  const downpaymentInvoiceIds = incoming.filter((r) => r.relationType === "DOWNPAYMENT_OF").map((r) => r.fromId);
  const finalInvoiceIds = incoming.filter((r) => r.relationType === "FINAL_FOR").map((r) => r.fromId);

  if (convertedInvoiceIds.length > 0) {
    const active = await dbInternal.invoice.findMany({
      where: { id: { in: convertedInvoiceIds }, orgId, status: { not: "CANCELLED" } },
      select: { id: true },
    });
    if (active.length > 0) {
      return { state: "FULL", invoiceIds: active.map((i) => i.id), billedPermille: 1000, downpaymentGrossCents: 0, hasActiveFinal: false };
    }
  }

  const downpaymentGrossCents = downpaymentInvoiceIds.length
    ? (
        await dbInternal.invoice.findMany({
          where: { id: { in: downpaymentInvoiceIds }, orgId, status: { not: "CANCELLED" } },
          select: { grossTotalCents: true },
        })
      ).reduce((s, i) => s + i.grossTotalCents, 0)
    : 0;

  if (finalInvoiceIds.length > 0) {
    const finalized = await dbInternal.invoice.findMany({
      where: { id: { in: finalInvoiceIds }, orgId, status: { in: [...FINALIZED_STATUSES] } },
      select: { id: true },
    });
    if (finalized.length > 0) {
      return { state: "FULL", invoiceIds: finalized.map((i) => i.id), billedPermille: 1000, downpaymentGrossCents, hasActiveFinal: true };
    }
  }

  const partialAndDownpaymentIds = [...partialInvoiceIds, ...downpaymentInvoiceIds];
  if (partialAndDownpaymentIds.length > 0) {
    const active = await dbInternal.invoice.findMany({
      where: { id: { in: partialAndDownpaymentIds }, orgId, status: { not: "CANCELLED" } },
      select: { id: true, grossTotalCents: true },
    });
    if (active.length > 0) {
      const quote = await dbInternal.quote.findFirst({ where: { id, orgId }, select: { grossTotalCents: true } });
      const sumGrossCents = active.reduce((s, i) => s + i.grossTotalCents, 0);
      const quoteGrossCents = quote?.grossTotalCents ?? 0;
      const billedPermille = quoteGrossCents > 0 ? Math.min(1000, Math.round((sumGrossCents * 1000) / quoteGrossCents)) : 0;

      let allQuantitiesBilled = false;
      if (partialInvoiceIds.length > 0) {
        const orderedLines = await dbInternal.quoteLine.findMany({
          where: { quoteId: id, lineType: "ITEM" },
          select: { id: true, quantityMilli: true },
        });
        if (orderedLines.length > 0) {
          const billed = await billedQuantities(orgId, "QUOTE", id);
          allQuantitiesBilled = orderedLines.every((l) => (billed.get(l.id) ?? 0) >= l.quantityMilli);
        }
      }

      if (billedPermille >= 1000 || allQuantitiesBilled) {
        return { state: "FULL", invoiceIds: active.map((i) => i.id), billedPermille: 1000, downpaymentGrossCents, hasActiveFinal: false };
      }

      return { state: "PARTIAL", invoiceIds: active.map((i) => i.id), billedPermille, downpaymentGrossCents, hasActiveFinal: false };
    }
  }

  return { state: "NONE", invoiceIds: [], billedPermille: 0, downpaymentGrossCents: 0, hasActiveFinal: false };
}
