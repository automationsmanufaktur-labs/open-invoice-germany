/**
 * Legt ein Abo / eine wiederkehrende Rechnung an. Die Vorlage selbst ist KEIN
 * Beleg (frei editierbar, kein Hash-Chain-Eintrag) — erst die daraus erzeugten
 * Rechnungen sind GoBD-relevant. `nextRunDate` startet auf `startDate`.
 */
import { dbInternal } from "@/lib/db";
import { normalizeToNoon } from "@/lib/recurring";
import type { CreateRecurringInput } from "@/schemas";

export class RecurringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecurringError";
  }
}

export async function createRecurring(orgId: string, input: CreateRecurringInput) {
  const customer = await dbInternal.customer.findFirst({ where: { id: input.customerId, orgId }, select: { id: true } });
  if (!customer) throw new RecurringError("Kunde nicht gefunden.");
  if (input.endDate && input.endDate < input.startDate) throw new RecurringError("Enddatum liegt vor dem Startdatum.");

  // Stichtage auf 12:00 lokal ankern (DST-/Zeitzonen-sichere Tagesanzeige).
  const startDate = normalizeToNoon(input.startDate);
  const endDate = input.endDate ? normalizeToNoon(input.endDate) : null;

  const lines = input.lines.map((l, i) => ({
    position: i + 1,
    description: l.description,
    quantityMilli: l.quantityMilli,
    unit: l.unit,
    unitNetPriceCents: l.unitNetPriceCents,
    taxRate: l.taxRate,
    taxCategory: l.taxCategory,
    discountPermille: l.discountPermille,
  }));

  return dbInternal.recurringInvoice.create({
    data: {
      orgId,
      customerId: input.customerId,
      title: input.title,
      status: "ACTIVE",
      interval: input.interval,
      intervalCount: input.intervalCount,
      anchorDay: input.anchorDay ?? null,
      startDate,
      nextRunDate: startDate,
      endDate,
      taxScheme: input.taxScheme,
      currency: input.currency,
      paymentTermsDays: input.paymentTermsDays,
      autoFinalize: input.autoFinalize,
      notes: input.notes ?? null,
      lines: { create: lines },
    },
    include: { lines: { orderBy: { position: "asc" } } },
  });
}
