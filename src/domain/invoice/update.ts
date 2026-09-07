/**
 * Bearbeitet einen Rechnungsentwurf (DRAFT): Kopfdaten und Positionen werden ersetzt,
 * Summen/Steueraufschluesselung neu berechnet. Nur Entwuerfe sind editierbar —
 * festgeschriebene Rechnungen aendern sich nur ueber Storno/Gutschrift/Korrekturrechnung
 * (Lastenheft 51, Guard in src/lib/db.ts). Muster: updateDraftDocument
 * (src/domain/document/update.ts).
 */
import { dbInternal } from "@/lib/db";
import { computeLineNet } from "@/lib/pricing/line";
import { computeTaxBreakdown } from "@/lib/tax";
import { appendChangeLog } from "@/domain/audit";
import { normalizeLines } from "@/domain/document/lines";
import { resolveBuyerSnapshot } from "@/domain/document/snapshot-input";
import { NotFoundError } from "@/domain/errors";
import { updateInvoiceSchema } from "@/schemas";
import type { Prisma } from "@/generated/prisma/client";

export class InvoiceUpdateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceUpdateError";
  }
}

type InvoiceWithLines = Prisma.InvoiceGetPayload<{ include: { lines: true } }>;

/**
 * Aktualisiert einen Rechnungsentwurf. Nur `status === "DRAFT"` darf bearbeitet werden —
 * festgeschriebene Rechnungen wirft InvoiceUpdateError (GoBD, Lastenheft 51). Positionen
 * werden bei Angabe VOLLSTAENDIG ersetzt (deleteMany + create, wie updateDraftDocument);
 * Nicht-ITEM-Zeilen (HEADING/TEXT/SUBTOTAL) gehen nie in die Summen ein (§8).
 */
export async function updateDraftInvoice(orgId: string, id: string, rawInput: unknown, actor: string): Promise<InvoiceWithLines> {
  const input = updateInvoiceSchema.parse(rawInput);
  const now = new Date();

  return dbInternal.$transaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({ where: { id, orgId }, include: { lines: { orderBy: { position: "asc" } } } });
    if (!invoice) throw new NotFoundError(`Rechnung ${id} nicht gefunden.`);
    if (invoice.status !== "DRAFT") {
      throw new InvoiceUpdateError(`Nur Entwuerfe (DRAFT) koennen bearbeitet werden (aktueller Status "${invoice.status}").`);
    }

    if (input.customerId && input.customerId !== invoice.customerId) {
      const customer = await tx.customer.findFirst({ where: { id: input.customerId, orgId } });
      if (!customer) throw new NotFoundError("Kunde nicht gefunden.");
    }
    // Fix-Runde 1: Ansprechpartner/Adressen gegen den EFFEKTIVEN Kunden pruefen (den neu
    // gesetzten, sonst den bestehenden) UND die Organisation — sonst koennte ein
    // Ansprechpartner/eine Adresse eines ANDEREN Kunden derselben Org unbemerkt uebernommen
    // werden (z. B. wenn nur contactPersonId geaendert wird, ohne customerId anzugeben).
    const effectiveCustomerIdForContacts = input.customerId ?? invoice.customerId;
    if (input.contactPersonId) {
      const contact = await tx.contactPerson.findFirst({ where: { id: input.contactPersonId, orgId, customerId: effectiveCustomerIdForContacts } });
      if (!contact) throw new NotFoundError("Ansprechpartner nicht gefunden.");
    }
    if (input.billingAddressId) {
      const address = await tx.customerAddress.findFirst({ where: { id: input.billingAddressId, orgId, customerId: effectiveCustomerIdForContacts } });
      if (!address) throw new NotFoundError("Rechnungsadresse nicht gefunden.");
    }
    if (input.shippingAddressId) {
      const address = await tx.customerAddress.findFirst({ where: { id: input.shippingAddressId, orgId, customerId: effectiveCustomerIdForContacts } });
      if (!address) throw new NotFoundError("Lieferadresse nicht gefunden.");
    }
    if (input.paymentMethodId) {
      const method = await tx.paymentMethod.findFirst({ where: { id: input.paymentMethodId, orgId } });
      if (!method) throw new NotFoundError("Zahlungsmethode nicht gefunden.");
    }

    const changedFields: string[] = [];
    const data: Prisma.InvoiceUncheckedUpdateInput = {};

    if (input.customerId !== undefined) { data.customerId = input.customerId; changedFields.push("customerId"); }
    // Fix-Runde 1: `type` ist bewusst NICHT im Schema (updateInvoiceSchema.omit({type:true}))
    // und wird hier deshalb nie gesetzt — die Rechnungsart aendert sich beim Bearbeiten nicht.
    if (input.taxScheme !== undefined) { data.taxScheme = input.taxScheme; changedFields.push("taxScheme"); }
    if (input.currency !== undefined) { data.currency = input.currency; changedFields.push("currency"); }
    if (input.issueDate !== undefined) { data.issueDate = input.issueDate; changedFields.push("issueDate"); }
    if (input.deliveryDate !== undefined) { data.deliveryDate = input.deliveryDate; changedFields.push("deliveryDate"); }
    if (input.deliveryStart !== undefined) { data.deliveryStart = input.deliveryStart; changedFields.push("deliveryStart"); }
    if (input.deliveryEnd !== undefined) { data.deliveryEnd = input.deliveryEnd; changedFields.push("deliveryEnd"); }
    if (input.dueDate !== undefined) { data.dueDate = input.dueDate; changedFields.push("dueDate"); }
    if (input.buyerReference !== undefined) { data.buyerReference = input.buyerReference; changedFields.push("buyerReference"); }
    if (input.subject !== undefined) { data.subject = input.subject; changedFields.push("subject"); }
    if (input.orderNumber !== undefined) { data.orderNumber = input.orderNumber; changedFields.push("orderNumber"); }
    if (input.internalReference !== undefined) { data.internalReference = input.internalReference; changedFields.push("internalReference"); }
    if (input.contactPersonId !== undefined) { data.contactPersonId = input.contactPersonId; changedFields.push("contactPersonId"); }
    if (input.billingAddressId !== undefined) { data.billingAddressId = input.billingAddressId; changedFields.push("billingAddressId"); }
    if (input.shippingAddressId !== undefined) { data.shippingAddressId = input.shippingAddressId; changedFields.push("shippingAddressId"); }

    // Fix-Welle (K2): bei Kundenwechsel duerfen NICHT mitgesendete Referenzen (Ansprechpartner/
    // Rechnungs-/Lieferadresse) nicht unveraendert am neuen Kunden haengen bleiben — sie
    // gehoerten zum ALTEN Kunden. Wurden sie explizit mitgesendet, greift die Pruefung oben
    // (fremde Referenz -> Fehler) bzw. der explizite Wert (auch null) oberhalb.
    const customerChanged = input.customerId !== undefined && input.customerId !== invoice.customerId;
    if (customerChanged) {
      if (input.contactPersonId === undefined && invoice.contactPersonId !== null) {
        data.contactPersonId = null;
        changedFields.push("contactPersonId");
      }
      if (input.billingAddressId === undefined && invoice.billingAddressId !== null) {
        data.billingAddressId = null;
        changedFields.push("billingAddressId");
      }
      if (input.shippingAddressId === undefined && invoice.shippingAddressId !== null) {
        data.shippingAddressId = null;
        changedFields.push("shippingAddressId");
      }
    }
    if (input.notes !== undefined) { data.notes = input.notes; changedFields.push("notes"); }
    if (input.paymentTerms !== undefined) { data.paymentTerms = input.paymentTerms; changedFields.push("paymentTerms"); }
    if (input.headerText !== undefined) { data.headerText = input.headerText; changedFields.push("headerText"); }
    if (input.footerText !== undefined) { data.footerText = input.footerText; changedFields.push("footerText"); }
    if (input.internalNotes !== undefined) { data.internalNotes = input.internalNotes; changedFields.push("internalNotes"); }

    if (input.skonto1Permille !== undefined) { data.skonto1Permille = input.skonto1Permille; changedFields.push("skonto1Permille"); }
    if (input.skonto1Days !== undefined) { data.skonto1Days = input.skonto1Days; changedFields.push("skonto1Days"); }
    if (input.skonto2Permille !== undefined) { data.skonto2Permille = input.skonto2Permille; changedFields.push("skonto2Permille"); }
    if (input.skonto2Days !== undefined) { data.skonto2Days = input.skonto2Days; changedFields.push("skonto2Days"); }
    if (input.paymentMethodId !== undefined) { data.paymentMethodId = input.paymentMethodId; changedFields.push("paymentMethodId"); }

    const adjustmentFieldChanged =
      input.documentDiscountPermille !== undefined ||
      input.documentDiscountCents !== undefined ||
      input.documentChargePermille !== undefined ||
      input.documentChargeCents !== undefined;
    if (input.documentDiscountPermille !== undefined) { data.documentDiscountPermille = input.documentDiscountPermille; changedFields.push("documentDiscountPermille"); }
    if (input.documentDiscountCents !== undefined) { data.documentDiscountCents = input.documentDiscountCents; changedFields.push("documentDiscountCents"); }
    if (input.documentChargePermille !== undefined) { data.documentChargePermille = input.documentChargePermille; changedFields.push("documentChargePermille"); }
    if (input.documentChargeCents !== undefined) { data.documentChargeCents = input.documentChargeCents; changedFields.push("documentChargeCents"); }
    if (input.documentChargeReason !== undefined) { data.documentChargeReason = input.documentChargeReason; changedFields.push("documentChargeReason"); }

    // Rabatt/Aufschlag wirken auf ALLE Positionen — Summen auch neu berechnen, wenn NUR
    // die Beleg-Anpassung geaendert wurde (ohne neue Positionen), analog updateDraftDocument.
    if (input.lines || adjustmentFieldChanged) {
      const lines = input.lines
        ? normalizeLines(input.lines).map((l) => ({
            position: l.position,
            lineType: l.lineType,
            productId: l.productId,
            description: l.description,
            descriptionLong: l.descriptionLong,
            articleNumber: l.articleNumber,
            quantityMilli: l.quantityMilli,
            unit: l.unit,
            unitNetPriceCents: l.unitNetPriceCents,
            taxRate: l.taxRate,
            taxCategory: l.taxCategory,
            discountPermille: l.discountPermille,
            discountCents: l.discountCents,
            lineNetCents: l.lineType === "ITEM" ? computeLineNet(l).lineNetCents : 0,
          }))
        : invoice.lines.map((l) => ({
            position: l.position,
            lineType: l.lineType as "ITEM" | "HEADING" | "TEXT" | "SUBTOTAL",
            productId: l.productId,
            description: l.description,
            descriptionLong: l.descriptionLong,
            articleNumber: l.articleNumber,
            quantityMilli: l.quantityMilli,
            unit: l.unit,
            unitNetPriceCents: l.unitNetPriceCents,
            taxRate: l.taxRate,
            taxCategory: l.taxCategory,
            discountPermille: l.discountPermille,
            discountCents: l.discountCents,
            lineNetCents: l.lineNetCents,
          }));
      // Nicht-ITEM-Zeilen gehen nie in Summen/Steuerberechnung ein (§8).
      const itemLines = lines.filter((l) => l.lineType === "ITEM");
      const totals = computeTaxBreakdown(
        itemLines.map((l) => ({ lineNetCents: l.lineNetCents, taxRate: l.taxRate, taxCategory: l.taxCategory })),
        {
          discountPermille: input.documentDiscountPermille ?? invoice.documentDiscountPermille,
          discountCents: input.documentDiscountCents ?? invoice.documentDiscountCents,
          chargePermille: input.documentChargePermille ?? invoice.documentChargePermille,
          chargeCents: input.documentChargeCents ?? invoice.documentChargeCents,
        },
      );

      if (input.lines) {
        await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
        data.lines = { create: lines };
        changedFields.push("lines");
      }
      data.netTotalCents = totals.netTotalCents;
      data.taxTotalCents = totals.taxTotalCents;
      data.grossTotalCents = totals.grossTotalCents;
      data.taxBreakdownJson = JSON.stringify(totals.breakdown);
    }

    // Snapshot-Regel wie updateDraftDocument: Rechnungen bekommen ihren Kaeufer-/
    // Verkaeufer-Snapshot regulaer erst bei FINALIZE (snapshotSource "FINALIZE"/
    // "INHERITED"), waehrend DRAFT bleibt er NULL — ausser bei einem per Phase-0-Backfill
    // migrierten Altbeleg (snapshotSource "MIGRATION", Betreiberentscheidung). Aendert sich
    // Kunde/Ansprechpartner/Rechnungsadresse eines solchen Entwurfs, muss auch dessen
    // Snapshot mit den NEUEN Daten aktualisiert werden — sonst zeigt finalize spaeter auf
    // veraltete Migrationsdaten statt die zwischenzeitliche Bearbeitung zu uebernehmen.
    // FINALIZE/SENT/INHERITED-Snapshots werden von updateDraftInvoice nie erreicht (nur
    // DRAFT editierbar), sind hier also nicht relevant.
    const buyerRelevantChanged =
      (input.customerId !== undefined && input.customerId !== invoice.customerId) ||
      (input.contactPersonId !== undefined && input.contactPersonId !== invoice.contactPersonId) ||
      (input.billingAddressId !== undefined && input.billingAddressId !== invoice.billingAddressId);

    if (buyerRelevantChanged && invoice.snapshotSource === "MIGRATION" && invoice.buyerSnapshotJson) {
      const effectiveCustomerId = input.customerId ?? invoice.customerId;
      const effectiveContactPersonId = input.contactPersonId !== undefined ? input.contactPersonId : invoice.contactPersonId;
      const effectiveBillingAddressId = input.billingAddressId !== undefined ? input.billingAddressId : invoice.billingAddressId;

      const customer = await tx.customer.findFirstOrThrow({ where: { id: effectiveCustomerId, orgId } });
      const buyer = await resolveBuyerSnapshot(tx, orgId, customer, effectiveContactPersonId, effectiveBillingAddressId);

      data.buyerSnapshotJson = JSON.stringify(buyer);
      changedFields.push("buyerSnapshotJson");
    }

    const updated = await tx.invoice.update({ where: { id }, data, include: { lines: { orderBy: { position: "asc" } } } });

    await appendChangeLog(tx, {
      orgId,
      entity: "INVOICE",
      entityId: id,
      action: "UPDATE",
      actor,
      at: now,
      diff: { changedFields, lineCount: input.lines?.length ?? null },
    });

    return updated;
  });
}
