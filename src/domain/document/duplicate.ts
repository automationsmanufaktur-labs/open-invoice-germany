/**
 * Dupliziert ein Geschaeftsdokument, einen Lieferschein oder eine Rechnung als neuen
 * Entwurf: Positionen und Texte kopiert, kein Snapshot, keine Nummer. Die Quelle darf
 * archiviert oder storniert sein. Relation DUPLICATED_FROM (from = Kopie, to = Quelle).
 */
import { dbInternal } from "@/lib/db";
import { computeTaxBreakdown } from "@/lib/tax";
import { appendChangeLog } from "@/domain/audit";
import { linkDocuments } from "@/domain/relations";
import { createDraftInvoiceWithinTx } from "@/domain/invoice/create";
import { NotFoundError } from "@/domain/errors";
import type { CreateInvoiceInput } from "@/schemas";

export type DuplicatableType = "QUOTE" | "DELIVERY_NOTE" | "INVOICE";

async function duplicateQuote(orgId: string, id: string, actor: string, now: Date) {
  return dbInternal.$transaction(async (tx) => {
    const src = await tx.quote.findFirst({ where: { id, orgId }, include: { lines: { orderBy: { position: "asc" } } } });
    if (!src) throw new NotFoundError(`Dokument ${id} nicht gefunden.`);

    // Fix-Runde 1, Befund 2: Nicht-ITEM-Zeilen (HEADING/TEXT/SUBTOTAL) gehen nie in die
    // Summen ein (§8) — wie in createBusinessDocumentWithinTx/updateDraftDocument.
    const itemLines = src.lines.filter((l) => l.lineType === "ITEM");
    const totals = computeTaxBreakdown(
      itemLines.map((l) => ({ lineNetCents: l.lineNetCents, taxRate: l.taxRate, taxCategory: l.taxCategory })),
      {
        discountPermille: src.documentDiscountPermille,
        discountCents: src.documentDiscountCents,
        chargePermille: src.documentChargePermille,
        chargeCents: src.documentChargeCents,
      },
    );

    const copy = await tx.quote.create({
      data: {
        orgId,
        customerId: src.customerId,
        kind: src.kind,
        number: null,
        status: "DRAFT",
        issueDate: now,
        validUntil: src.validUntil,
        currency: src.currency,
        taxScheme: src.taxScheme,
        subject: src.subject,
        notes: src.notes,
        internalNotes: src.internalNotes,
        headerText: src.headerText,
        footerText: src.footerText,
        deliveryTerms: src.deliveryTerms,
        paymentTerms: src.paymentTerms,
        customerReference: src.customerReference,
        contactPersonId: src.contactPersonId,
        billingAddressId: src.billingAddressId,
        documentDiscountPermille: src.documentDiscountPermille,
        documentDiscountCents: src.documentDiscountCents,
        documentChargePermille: src.documentChargePermille,
        documentChargeCents: src.documentChargeCents,
        documentChargeReason: src.documentChargeReason,
        netTotalCents: totals.netTotalCents,
        taxTotalCents: totals.taxTotalCents,
        grossTotalCents: totals.grossTotalCents,
        lines: {
          create: src.lines.map((l, i) => ({
            position: i + 1,
            lineType: l.lineType,
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
          })),
        },
      },
    });

    await linkDocuments(tx, { orgId, fromType: "QUOTE", fromId: copy.id, toType: "QUOTE", toId: id, relationType: "DUPLICATED_FROM" });
    await appendChangeLog(tx, { orgId, entity: "QUOTE", entityId: copy.id, action: "CREATE", actor, at: now, diff: { duplicatedFrom: id } });

    return { type: "QUOTE" as const, id: copy.id };
  });
}

async function duplicateDeliveryNote(orgId: string, id: string, actor: string, now: Date) {
  return dbInternal.$transaction(async (tx) => {
    const src = await tx.deliveryNote.findFirst({ where: { id, orgId }, include: { lines: { orderBy: { position: "asc" } } } });
    if (!src) throw new NotFoundError(`Lieferschein ${id} nicht gefunden.`);

    const copy = await tx.deliveryNote.create({
      data: {
        orgId,
        customerId: src.customerId,
        number: null,
        status: "DRAFT",
        issueDate: now,
        deliveryDate: src.deliveryDate,
        shippingDate: src.shippingDate,
        showPrices: src.showPrices,
        showTax: src.showTax,
        showArticleNumber: src.showArticleNumber,
        showDescription: src.showDescription,
        notes: src.notes,
        internalNotes: src.internalNotes,
        headerText: src.headerText,
        footerText: src.footerText,
        // Bezugsbeleg des Kopfes mitkopieren, sonst geht der Bezug im Duplikat verloren
        // (die Zeilen-Ebene sourceLineId war bereits kopiert, der Kopf nicht — Fix-Runde 1,
        // Befund 3).
        sourceType: src.sourceType,
        sourceId: src.sourceId,
        lines: {
          create: src.lines.map((l, i) => ({
            position: i + 1,
            description: l.description,
            articleNumber: l.articleNumber,
            quantityMilli: l.quantityMilli,
            unit: l.unit,
            sourceType: l.sourceType,
            sourceId: l.sourceId,
            sourceLineId: l.sourceLineId,
            unitNetPriceCents: l.unitNetPriceCents,
            taxRate: l.taxRate,
          })),
        },
      },
    });

    await linkDocuments(tx, { orgId, fromType: "DELIVERY_NOTE", fromId: copy.id, toType: "DELIVERY_NOTE", toId: id, relationType: "DUPLICATED_FROM" });
    await appendChangeLog(tx, { orgId, entity: "DELIVERY_NOTE", entityId: copy.id, action: "CREATE", actor, at: now, diff: { duplicatedFrom: id } });

    return { type: "DELIVERY_NOTE" as const, id: copy.id };
  });
}

/**
 * INVOICE-Duplikat ueber createDraftInvoiceWithinTx (bereits ohne Snapshot/Nummer) — Ruling
 * des Koordinators. `dueDate` wird bewusst NICHT uebernommen — sie wird beim Festschreiben
 * neu berechnet. Erstellung, Relation und ChangeLog laufen in EINER Transaktion (Lastenheft 50).
 */
async function duplicateInvoice(orgId: string, id: string, actor: string, now: Date) {
  return dbInternal.$transaction(async (tx) => {
    const src = await tx.invoice.findFirst({ where: { id, orgId }, include: { lines: { orderBy: { position: "asc" } } } });
    if (!src) throw new NotFoundError(`Rechnung ${id} nicht gefunden.`);

    const input: CreateInvoiceInput = {
      customerId: src.customerId,
      type: src.type as CreateInvoiceInput["type"],
      taxScheme: src.taxScheme as CreateInvoiceInput["taxScheme"],
      currency: src.currency,
      issueDate: now,
      deliveryDate: src.deliveryDate ?? undefined,
      deliveryStart: src.deliveryStart ?? undefined,
      deliveryEnd: src.deliveryEnd ?? undefined,
      buyerReference: src.buyerReference ?? undefined,
      notes: src.notes ?? undefined,
      paymentTerms: src.paymentTerms ?? undefined,
      headerText: src.headerText ?? undefined,
      footerText: src.footerText ?? undefined,
      internalNotes: src.internalNotes ?? undefined,
      documentDiscountPermille: src.documentDiscountPermille,
      documentDiscountCents: src.documentDiscountCents,
      documentChargePermille: src.documentChargePermille,
      documentChargeCents: src.documentChargeCents,
      documentChargeReason: src.documentChargeReason ?? undefined,
      skonto1Permille: src.skonto1Permille ?? undefined,
      skonto1Days: src.skonto1Days ?? undefined,
      skonto2Permille: src.skonto2Permille ?? undefined,
      skonto2Days: src.skonto2Days ?? undefined,
      paymentMethodId: src.paymentMethodId ?? undefined,
      lines: src.lines.map((l) => ({
        lineType: l.lineType as CreateInvoiceInput["lines"][number]["lineType"],
        description: l.description,
        descriptionLong: l.descriptionLong ?? undefined,
        articleNumber: l.articleNumber ?? undefined,
        quantityMilli: l.quantityMilli,
        unit: l.unit,
        unitNetPriceCents: l.unitNetPriceCents,
        taxRate: l.taxRate as CreateInvoiceInput["lines"][number]["taxRate"],
        taxCategory: l.taxCategory as CreateInvoiceInput["lines"][number]["taxCategory"],
        discountPermille: l.discountPermille,
        discountCents: l.discountCents,
      })),
    };

    const copy = await createDraftInvoiceWithinTx(tx, orgId, input, { actor, now });

    await linkDocuments(tx, { orgId, fromType: "INVOICE", fromId: copy.id, toType: "INVOICE", toId: id, relationType: "DUPLICATED_FROM" });

    return { type: "INVOICE" as const, id: copy.id };
  });
}

export async function duplicateDocument(
  orgId: string,
  type: DuplicatableType,
  id: string,
  actor: string,
  now: Date = new Date(),
): Promise<{ type: DuplicatableType; id: string }> {
  if (type === "QUOTE") return duplicateQuote(orgId, id, actor, now);
  if (type === "DELIVERY_NOTE") return duplicateDeliveryNote(orgId, id, actor, now);
  return duplicateInvoice(orgId, id, actor, now);
}
