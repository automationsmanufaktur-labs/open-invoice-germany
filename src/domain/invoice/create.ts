/**
 * Erstellt eine Rechnung als Entwurf (DRAFT). Berechnet Positions-Netto und
 * Steueraufschlüsselung, schreibt einen CREATE-Audit-Eintrag.
 */
import { dbInternal } from "@/lib/db";
import { computeLineNetCents } from "@/lib/money";
import { computeTaxBreakdown } from "@/lib/tax";
import { appendChangeLog } from "@/domain/audit";
import type { CreateInvoiceInput } from "@/schemas";

export interface CreateOptions {
  actor?: string;
  now?: Date;
}

export async function createDraftInvoice(
  orgId: string,
  input: CreateInvoiceInput,
  opts: CreateOptions = {},
) {
  const now = opts.now ?? new Date();
  const actor = opts.actor ?? "system";

  const lines = input.lines.map((line, index) => ({
    position: index + 1,
    productId: line.productId,
    description: line.description,
    quantityMilli: line.quantityMilli,
    unit: line.unit,
    unitNetPriceCents: line.unitNetPriceCents,
    taxRate: line.taxRate,
    taxCategory: line.taxCategory,
    discountPermille: line.discountPermille,
    lineNetCents: computeLineNetCents(line.quantityMilli, line.unitNetPriceCents, line.discountPermille),
  }));

  const totals = computeTaxBreakdown(
    lines.map((l) => ({ lineNetCents: l.lineNetCents, taxRate: l.taxRate, taxCategory: l.taxCategory })),
  );

  return dbInternal.$transaction(async (tx) => {
    // Kunde muss zur Organisation gehören (kein Cross-Tenant-Bezug).
    const customer = await tx.customer.findFirst({ where: { id: input.customerId, orgId }, select: { id: true } });
    if (!customer) throw new Error("Kunde nicht gefunden.");

    const invoice = await tx.invoice.create({
      data: {
        orgId,
        customerId: input.customerId,
        type: input.type,
        taxScheme: input.taxScheme,
        currency: input.currency,
        issueDate: input.issueDate ?? now,
        deliveryDate: input.deliveryDate,
        deliveryStart: input.deliveryStart,
        deliveryEnd: input.deliveryEnd,
        dueDate: input.dueDate,
        buyerReference: input.buyerReference,
        notes: input.notes,
        paymentTerms: input.paymentTerms,
        internalNotes: input.internalNotes,
        netTotalCents: totals.netTotalCents,
        taxTotalCents: totals.taxTotalCents,
        grossTotalCents: totals.grossTotalCents,
        taxBreakdownJson: JSON.stringify(totals.breakdown),
        lines: { create: lines },
      },
      include: { lines: { orderBy: { position: "asc" } } },
    });

    await appendChangeLog(tx, {
      orgId,
      entity: "INVOICE",
      entityId: invoice.id,
      action: "CREATE",
      actor,
      at: now,
      diff: { type: input.type, taxScheme: input.taxScheme, grossTotalCents: totals.grossTotalCents },
    });

    return invoice;
  });
}
