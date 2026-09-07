/**
 * Erstellt eine Rechnung als Entwurf (DRAFT). Berechnet Positions-Netto und
 * Steueraufschlüsselung, schreibt einen CREATE-Audit-Eintrag.
 *
 * `createDraftInvoiceWithinTx` laeuft in einer vom Aufrufer uebergebenen Transaktion
 * (Muster: finalizeWithinTx in ./finalize.ts) — genutzt vom Rechnungs-Duplikat
 * (src/domain/document/duplicate.ts), damit Erstellung, Relation und ChangeLog
 * atomar bleiben (Lastenheft 50).
 */
import type { Prisma } from "@/generated/prisma/client";
import { dbInternal } from "@/lib/db";
import { computeLineNet } from "@/lib/pricing/line";
import { computeTaxBreakdown } from "@/lib/tax";
import { appendChangeLog } from "@/domain/audit";
import type { CreateInvoiceInput } from "@/schemas";

export interface CreateOptions {
  actor?: string;
  now?: Date;
}

export async function createDraftInvoiceWithinTx(
  tx: Prisma.TransactionClient,
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
    discountCents: line.discountCents,
    lineNetCents: computeLineNet(line).lineNetCents,
  }));

  const totals = computeTaxBreakdown(
    lines.map((l) => ({ lineNetCents: l.lineNetCents, taxRate: l.taxRate, taxCategory: l.taxCategory })),
    {
      discountPermille: input.documentDiscountPermille,
      discountCents: input.documentDiscountCents,
      chargePermille: input.documentChargePermille,
      chargeCents: input.documentChargeCents,
    },
  );

  // Kunde muss zur Organisation gehören (kein Cross-Tenant-Bezug).
  const customer = await tx.customer.findFirst({ where: { id: input.customerId, orgId }, select: { id: true, defaultPaymentMethodId: true } });
  if (!customer) throw new Error("Kunde nicht gefunden.");

  // Fehlt die Zahlungsmethode, greift die Standard-Zahlungsmethode des Kunden (Selbstheilung).
  const paymentMethodId = input.paymentMethodId ?? customer.defaultPaymentMethodId ?? undefined;
  if (paymentMethodId) {
    const method = await tx.paymentMethod.findFirst({ where: { id: paymentMethodId, orgId }, select: { id: true } });
    if (!method) throw new Error("Zahlungsmethode nicht gefunden.");
  }

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
      headerText: input.headerText,
      footerText: input.footerText,
      documentDiscountPermille: input.documentDiscountPermille,
      documentDiscountCents: input.documentDiscountCents,
      documentChargePermille: input.documentChargePermille,
      documentChargeCents: input.documentChargeCents,
      documentChargeReason: input.documentChargeReason,
      skonto1Permille: input.skonto1Permille,
      skonto1Days: input.skonto1Days,
      skonto2Permille: input.skonto2Permille,
      skonto2Days: input.skonto2Days,
      paymentMethodId,
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
}

export async function createDraftInvoice(
  orgId: string,
  input: CreateInvoiceInput,
  opts: CreateOptions = {},
) {
  return dbInternal.$transaction((tx) => createDraftInvoiceWithinTx(tx, orgId, input, opts));
}
