/**
 * Bearbeitet einen Angebots-/AB-/Proforma-Entwurf (DRAFT): Kopfdaten und Positionen
 * werden vollstaendig ersetzt, Summen neu berechnet. Nur Entwuerfe sind editierbar —
 * versendete/entschiedene Dokumente aendern sich nur ueber Status-Uebergaenge
 * (src/domain/document/status.ts) oder eine neue Version (Duplizieren).
 */
import { dbInternal } from "@/lib/db";
import { computeLineNetCents } from "@/lib/money";
import { computeTaxBreakdown } from "@/lib/tax";
import { appendChangeLog } from "@/domain/audit";
import { StatusTransitionError } from "@/domain/document/status";
import { resolveBuyerSnapshot } from "@/domain/document/snapshot-input";
import { NotFoundError } from "@/domain/errors";
import { updateDocumentSchema } from "@/schemas";
import type { Quote, Prisma } from "@/generated/prisma/client";

export async function updateDraftDocument(orgId: string, id: string, rawInput: unknown, actor: string): Promise<Quote> {
  const input = updateDocumentSchema.parse(rawInput);
  const now = new Date();

  return dbInternal.$transaction(async (tx) => {
    const quote = await tx.quote.findFirst({ where: { id, orgId } });
    if (!quote) throw new NotFoundError(`Dokument ${id} nicht gefunden.`);
    if (quote.status !== "DRAFT") {
      throw new StatusTransitionError(`Nur Entwuerfe (DRAFT) koennen bearbeitet werden (aktueller Status "${quote.status}").`);
    }

    if (input.customerId && input.customerId !== quote.customerId) {
      const customer = await tx.customer.findFirst({ where: { id: input.customerId, orgId } });
      if (!customer) throw new NotFoundError("Kunde nicht gefunden.");
    }
    if (input.contactPersonId) {
      const contact = await tx.contactPerson.findFirst({ where: { id: input.contactPersonId, orgId } });
      if (!contact) throw new NotFoundError("Ansprechpartner nicht gefunden.");
    }
    if (input.billingAddressId) {
      const address = await tx.customerAddress.findFirst({ where: { id: input.billingAddressId, orgId } });
      if (!address) throw new NotFoundError("Rechnungsadresse nicht gefunden.");
    }

    const changedFields: string[] = [];
    const data: Prisma.QuoteUncheckedUpdateInput = {};

    if (input.customerId !== undefined) { data.customerId = input.customerId; changedFields.push("customerId"); }
    if (input.subject !== undefined) { data.subject = input.subject; changedFields.push("subject"); }
    if (input.headerText !== undefined) { data.headerText = input.headerText; changedFields.push("headerText"); }
    if (input.footerText !== undefined) { data.footerText = input.footerText; changedFields.push("footerText"); }
    if (input.deliveryTerms !== undefined) { data.deliveryTerms = input.deliveryTerms; changedFields.push("deliveryTerms"); }
    if (input.paymentTerms !== undefined) { data.paymentTerms = input.paymentTerms; changedFields.push("paymentTerms"); }
    if (input.customerReference !== undefined) { data.customerReference = input.customerReference; changedFields.push("customerReference"); }
    if (input.contactPersonId !== undefined) { data.contactPersonId = input.contactPersonId; changedFields.push("contactPersonId"); }
    if (input.billingAddressId !== undefined) { data.billingAddressId = input.billingAddressId; changedFields.push("billingAddressId"); }
    if (input.notes !== undefined) { data.notes = input.notes; changedFields.push("notes"); }
    if (input.internalNotes !== undefined) { data.internalNotes = input.internalNotes; changedFields.push("internalNotes"); }
    if (input.validUntil !== undefined) { data.validUntil = input.validUntil; changedFields.push("validUntil"); }
    if (input.taxScheme !== undefined) { data.taxScheme = input.taxScheme; changedFields.push("taxScheme"); }
    if (input.currency !== undefined) { data.currency = input.currency; changedFields.push("currency"); }

    if (input.lines) {
      const lines = input.lines.map((l, i) => ({
        position: i + 1,
        description: l.description,
        quantityMilli: l.quantityMilli,
        unit: l.unit,
        unitNetPriceCents: l.unitNetPriceCents,
        taxRate: l.taxRate,
        taxCategory: l.taxCategory,
        discountPermille: l.discountPermille,
        lineNetCents: computeLineNetCents(l.quantityMilli, l.unitNetPriceCents, l.discountPermille),
      }));
      const totals = computeTaxBreakdown(lines.map((l) => ({ lineNetCents: l.lineNetCents, taxRate: l.taxRate, taxCategory: l.taxCategory })));

      await tx.quoteLine.deleteMany({ where: { quoteId: id } });
      data.lines = { create: lines };
      data.netTotalCents = totals.netTotalCents;
      data.taxTotalCents = totals.taxTotalCents;
      data.grossTotalCents = totals.grossTotalCents;
      changedFields.push("lines");
    }

    // W3 (Fix-Runde 2): aendert sich Kunde/Ansprechpartner/Rechnungsadresse eines Entwurfs,
    // dessen Kaeufer-Snapshot noch aus CREATE stammt (oder — Altfall — gar nicht gesetzt
    // ist), wird der Snapshot mit den NEUEN Daten neu gebaut. FINALIZE/SENT/MIGRATION/
    // INHERITED-Snapshots werden von updateDraftDocument nie erreicht (nur DRAFT editierbar),
    // sind hier also nicht relevant. Der Seller-Snapshot bleibt unveraendert.
    const buyerRelevantChanged =
      (input.customerId !== undefined && input.customerId !== quote.customerId) ||
      (input.contactPersonId !== undefined && input.contactPersonId !== quote.contactPersonId) ||
      (input.billingAddressId !== undefined && input.billingAddressId !== quote.billingAddressId);

    if (buyerRelevantChanged && (quote.snapshotSource === "CREATE" || quote.snapshotSource === null)) {
      const effectiveCustomerId = input.customerId ?? quote.customerId;
      const effectiveContactPersonId = input.contactPersonId !== undefined ? input.contactPersonId : quote.contactPersonId;
      const effectiveBillingAddressId = input.billingAddressId !== undefined ? input.billingAddressId : quote.billingAddressId;

      const customer = await tx.customer.findFirstOrThrow({ where: { id: effectiveCustomerId, orgId } });
      const buyer = await resolveBuyerSnapshot(tx, orgId, customer, effectiveContactPersonId, effectiveBillingAddressId);

      data.buyerSnapshotJson = JSON.stringify(buyer);
      data.snapshotSource = "CREATE";
      data.snapshotAt = now;
      changedFields.push("buyerSnapshotJson");
    }

    const updated = await tx.quote.update({ where: { id }, data, include: { lines: { orderBy: { position: "asc" } } } });

    await appendChangeLog(tx, {
      orgId,
      entity: "QUOTE",
      entityId: id,
      action: "UPDATE",
      actor,
      at: now,
      diff: { changedFields, lineCount: input.lines?.length ?? null },
    });

    return updated;
  });
}
