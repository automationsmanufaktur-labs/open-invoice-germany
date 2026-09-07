/**
 * Erstellt ein Geschäftsdokument (Angebot / Auftragsbestätigung / Proforma).
 * KEIN GoBD-Beleg — bekommt eine Nummer aus dem kind-spezifischen Nummernkreis,
 * bleibt aber editierbar (keine Festschreibung/Unveränderbarkeit).
 */
import { dbInternal } from "@/lib/db";
import { computeLineNetCents } from "@/lib/money";
import { computeTaxBreakdown } from "@/lib/tax";
import { defaultPrefix, formatDocumentNumber } from "@/domain/numbering";
import { buildSellerSnapshot, buildBuyerSnapshot } from "@/domain/snapshot";
import type { CreateDocumentInput, SnapshotSource } from "@/schemas";

export async function createBusinessDocument(orgId: string, input: CreateDocumentInput, opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();

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
  const totals = computeTaxBreakdown(
    lines.map((l) => ({ lineNetCents: l.lineNetCents, taxRate: l.taxRate, taxCategory: l.taxCategory })),
  );

  return dbInternal.$transaction(async (tx) => {
    const customer = await tx.customer.findFirst({ where: { id: input.customerId, orgId } });
    if (!customer) throw new Error("Kunde nicht gefunden.");
    const org = await tx.organization.findUniqueOrThrow({ where: { id: orgId } });

    const year = now.getFullYear();
    const docType = input.kind;
    const range = await tx.numberRange.upsert({
      where: { orgId_docType_year: { orgId, docType, year } },
      create: { orgId, docType, year, currentValue: 1, prefix: defaultPrefix(docType) },
      update: { currentValue: { increment: 1 } },
    });
    const number = formatDocumentNumber(range.pattern, {
      prefix: range.prefix || defaultPrefix(docType),
      seq: range.currentValue,
      padding: range.seqPadding,
      year,
      month: now.getMonth() + 1,
    });

    const snapshotSource: SnapshotSource = "CREATE";
    return tx.quote.create({
      data: {
        orgId,
        customerId: input.customerId,
        kind: input.kind,
        number,
        status: "DRAFT",
        issueDate: now,
        validUntil: input.validUntil,
        currency: input.currency,
        taxScheme: input.taxScheme,
        notes: input.notes,
        internalNotes: input.internalNotes,
        sellerSnapshotJson: JSON.stringify(buildSellerSnapshot(org)),
        buyerSnapshotJson: JSON.stringify(buildBuyerSnapshot(customer)),
        snapshotSource,
        snapshotAt: now,
        netTotalCents: totals.netTotalCents,
        taxTotalCents: totals.taxTotalCents,
        grossTotalCents: totals.grossTotalCents,
        lines: { create: lines },
      },
      include: { lines: { orderBy: { position: "asc" } } },
    });
  });
}
