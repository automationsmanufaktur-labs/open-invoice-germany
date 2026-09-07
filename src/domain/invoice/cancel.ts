/**
 * Storno einer festgeschriebenen Rechnung.
 *
 * GoBD-konform: Das Original bleibt UNVERÄNDERT erhalten. Es wird eine
 * betragsspiegelbildliche Storno-Gutschrift (type=CREDIT_NOTE) mit eigener
 * Nummer aus dem Kreis angelegt und festgeschrieben; das Original erhält den
 * Status CANCELLED und einen Verweis auf die Gutschrift (§ 31 Abs. 5 UStDV).
 */
import { dbInternal } from "@/lib/db";
import { appendChangeLog } from "@/domain/audit";
import { linkDocuments } from "@/domain/relations";
import { finalizeWithinTx } from "./finalize";

export class CancelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CancelError";
  }
}

export interface CancelOptions {
  actor?: string;
  now?: Date;
}

export async function cancelInvoice(invoiceId: string, opts: CancelOptions = {}) {
  const now = opts.now ?? new Date();
  const actor = opts.actor ?? "system";

  return dbInternal.$transaction(async (tx) => {
    const original = await tx.invoice.findUnique({
      where: { id: invoiceId },
      include: { lines: { orderBy: { position: "asc" } } },
    });
    if (!original) throw new CancelError("Rechnung nicht gefunden.");
    if (original.status === "DRAFT") throw new CancelError("Entwürfe werden gelöscht, nicht storniert.");
    if (original.status === "CANCELLED") throw new CancelError("Rechnung ist bereits storniert.");
    if (original.type === "CREDIT_NOTE") throw new CancelError("Eine Gutschrift/Storno kann nicht erneut storniert werden.");

    const credit = await tx.invoice.create({
      data: {
        orgId: original.orgId,
        customerId: original.customerId,
        type: "CREDIT_NOTE",
        status: "DRAFT",
        taxScheme: original.taxScheme,
        currency: original.currency,
        issueDate: now,
        deliveryDate: original.deliveryDate,
        deliveryStart: original.deliveryStart,
        deliveryEnd: original.deliveryEnd,
        buyerReference: original.buyerReference,
        notes: `Storno zu Rechnung ${original.number}.${original.notes ? " " + original.notes : ""}`,
        paymentTerms: original.paymentTerms,
        correctsInvoiceId: original.id,
        // Betragsspiegelbild: negierte Beträge, damit Original + Storno = 0 ergibt.
        lines: {
          create: original.lines.map((l) => ({
            position: l.position,
            productId: l.productId,
            description: l.description,
            quantityMilli: l.quantityMilli,
            unit: l.unit,
            unitNetPriceCents: -l.unitNetPriceCents,
            taxRate: l.taxRate,
            taxCategory: l.taxCategory,
            discountPermille: l.discountPermille,
            lineNetCents: -l.lineNetCents,
          })),
        },
      },
    });

    const finalizedCredit = await finalizeWithinTx(tx, credit.id, {
      actor,
      now,
      // Storno berichtigt genau das Original: gleicher Empfaenger/Verkaeufer wie dort.
      inheritSnapshotFrom: { sellerSnapshotJson: original.sellerSnapshotJson, buyerSnapshotJson: original.buyerSnapshotJson },
    });

    await tx.invoice.update({
      where: { id: original.id },
      data: { status: "CANCELLED", reversedByInvoiceId: finalizedCredit.id },
    });

    await linkDocuments(tx, { orgId: original.orgId, fromType: "INVOICE", fromId: finalizedCredit.id, toType: "INVOICE", toId: original.id, relationType: "REVERSES" });
    await linkDocuments(tx, { orgId: original.orgId, fromType: "INVOICE", fromId: finalizedCredit.id, toType: "INVOICE", toId: original.id, relationType: "CORRECTS" });

    await appendChangeLog(tx, {
      orgId: original.orgId,
      entity: "INVOICE",
      entityId: original.id,
      action: "CANCEL",
      actor,
      at: now,
      diff: { status: "CANCELLED", reversedBy: finalizedCredit.number },
    });

    return { originalId: original.id, originalNumber: original.number, creditNote: finalizedCredit };
  });
}
