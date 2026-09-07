/**
 * Wandelt ein Geschäftsdokument (Angebot/Auftragsbestätigung/Proforma) in eine
 * Rechnung um — als Entwurf (DRAFT), den man anschließend festschreibt.
 */
import { dbInternal } from "@/lib/db";
import { computeTaxBreakdown } from "@/lib/tax";
import { appendChangeLog } from "@/domain/audit";

export class ConvertError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConvertError";
  }
}

export async function convertDocumentToInvoice(documentId: string, opts: { actor?: string; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const actor = opts.actor ?? "system";

  return dbInternal.$transaction(async (tx) => {
    const q = await tx.quote.findUnique({ where: { id: documentId }, include: { lines: { orderBy: { position: "asc" } } } });
    if (!q) throw new ConvertError("Dokument nicht gefunden.");
    if (q.convertedToInvoiceId) throw new ConvertError("Dokument wurde bereits in eine Rechnung umgewandelt.");

    const totals = computeTaxBreakdown(
      q.lines.map((l) => ({ lineNetCents: l.lineNetCents, taxRate: l.taxRate, taxCategory: l.taxCategory })),
    );

    const invoice = await tx.invoice.create({
      data: {
        orgId: q.orgId,
        customerId: q.customerId,
        type: "INVOICE",
        status: "DRAFT",
        taxScheme: q.taxScheme,
        currency: q.currency,
        issueDate: now,
        notes: q.notes,
        internalNotes: q.internalNotes,
        netTotalCents: totals.netTotalCents,
        taxTotalCents: totals.taxTotalCents,
        grossTotalCents: totals.grossTotalCents,
        taxBreakdownJson: JSON.stringify(totals.breakdown),
        lines: {
          create: q.lines.map((l) => ({
            position: l.position,
            description: l.description,
            quantityMilli: l.quantityMilli,
            unit: l.unit,
            unitNetPriceCents: l.unitNetPriceCents,
            taxRate: l.taxRate,
            taxCategory: l.taxCategory,
            discountPermille: l.discountPermille,
            lineNetCents: l.lineNetCents,
          })),
        },
      },
    });

    await tx.quote.update({ where: { id: documentId }, data: { status: "CONVERTED", convertedToInvoiceId: invoice.id } });
    await appendChangeLog(tx, {
      orgId: q.orgId,
      entity: "INVOICE",
      entityId: invoice.id,
      action: "CREATE",
      actor,
      at: now,
      diff: { fromDocument: q.number, kind: q.kind },
    });

    return invoice;
  });
}
