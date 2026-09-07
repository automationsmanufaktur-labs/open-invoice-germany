/**
 * Abgeleiteter Abrechnungsstand eines Angebots/einer Auftragsbestaetigung: Er wird
 * nicht gespeichert, sondern aus den Dokumentrelationen (src/domain/relations.ts)
 * berechnet — FULL/PARTIAL/NONE ergeben sich rein aus CONVERTED_TO/PARTIAL_OF/
 * DOWNPAYMENT_OF/FINAL_FOR-Verknuepfungen zu Rechnungen.
 */
import { dbInternal } from "@/lib/db";
import { listRelations } from "@/domain/relations";
import { BillingState, DocRefType } from "@/schemas";

export interface BillingStateResult {
  state: BillingState;
  invoiceIds: string[];
}

/**
 * FULL: mindestens eine CONVERTED_TO-Relation auf eine Rechnung, die nicht CANCELLED ist.
 * PARTIAL (Phase 5): PARTIAL_OF/DOWNPAYMENT_OF-Relationen vorhanden, aber (noch) keine
 * FINAL_FOR-Relation — also Anzahlungen/Teilrechnungen ohne Schlussrechnung.
 * NONE: sonst (auch wenn nur stornierte Rechnungen verknuepft sind).
 */
export async function billingStateFor(orgId: string, type: "QUOTE", id: string): Promise<BillingStateResult> {
  DocRefType.parse(type);
  const relations = await listRelations(orgId, type, id);
  const outgoing = relations.filter((r) => r.fromType === type && r.fromId === id && r.toType === "INVOICE");

  const convertedInvoiceIds = outgoing.filter((r) => r.relationType === "CONVERTED_TO").map((r) => r.toId);
  const partialInvoiceIds = outgoing.filter((r) => r.relationType === "PARTIAL_OF" || r.relationType === "DOWNPAYMENT_OF").map((r) => r.toId);
  const finalInvoiceIds = outgoing.filter((r) => r.relationType === "FINAL_FOR").map((r) => r.toId);

  if (convertedInvoiceIds.length > 0) {
    const active = await dbInternal.invoice.findMany({
      where: { id: { in: convertedInvoiceIds }, orgId, status: { not: "CANCELLED" } },
      select: { id: true },
    });
    if (active.length > 0) {
      return { state: "FULL", invoiceIds: active.map((i) => i.id) };
    }
  }

  if (partialInvoiceIds.length > 0 && finalInvoiceIds.length === 0) {
    const active = await dbInternal.invoice.findMany({
      where: { id: { in: partialInvoiceIds }, orgId, status: { not: "CANCELLED" } },
      select: { id: true },
    });
    if (active.length > 0) {
      return { state: "PARTIAL", invoiceIds: active.map((i) => i.id) };
    }
  }

  return { state: "NONE", invoiceIds: [] };
}
