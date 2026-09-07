/**
 * Legt einen Lieferschein an (Phase 1). Kein GoBD-Beleg, aber Nachweis des
 * Leistungszeitpunkts (§ 14 Abs. 4 Nr. 6) — daher Nummernkreis, Parteien-Snapshot
 * (Phase 0-Muster) und ChangeLog-Eintrag. Konvertierung aus Angebot/AB folgt in Phase 3.
 */
import { dbInternal } from "@/lib/db";
import { defaultPrefix, formatDocumentNumber } from "@/domain/numbering";
import { buildSellerSnapshot, buildBuyerSnapshot } from "@/domain/snapshot";
import { appendChangeLog } from "@/domain/audit";
import type { CreateDeliveryNoteInput, SnapshotSource } from "@/schemas";

export class DeliveryNoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeliveryNoteError";
  }
}

export async function createDeliveryNote(
  orgId: string,
  input: CreateDeliveryNoteInput,
  opts: { actor?: string; now?: Date } = {},
) {
  const now = opts.now ?? new Date();
  const actor = opts.actor ?? "system";

  return dbInternal.$transaction(async (tx) => {
    const customer = await tx.customer.findFirst({ where: { id: input.customerId, orgId } });
    if (!customer) throw new DeliveryNoteError("Kunde nicht gefunden.");
    const org = await tx.organization.findUniqueOrThrow({ where: { id: orgId } });

    const docType = "DELIVERY_NOTE";
    const year = now.getFullYear();
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
      day: now.getDate(),
    });

    const source: SnapshotSource = "CREATE";
    const note = await tx.deliveryNote.create({
      data: {
        orgId,
        customerId: input.customerId,
        number,
        status: "CREATED",
        issueDate: now,
        deliveryDate: input.deliveryDate,
        shippingDate: input.shippingDate,
        showPrices: input.showPrices,
        showTax: input.showTax,
        notes: input.notes,
        internalNotes: input.internalNotes,
        sellerSnapshotJson: JSON.stringify(buildSellerSnapshot(org)),
        buyerSnapshotJson: JSON.stringify(buildBuyerSnapshot(customer)),
        snapshotSource: source,
        snapshotAt: now,
        lines: {
          create: input.lines.map((l, i) => ({
            position: i + 1,
            description: l.description,
            articleNumber: l.articleNumber,
            quantityMilli: l.quantityMilli,
            unit: l.unit,
            sourceType: l.sourceType,
            sourceId: l.sourceId,
          })),
        },
      },
      include: { lines: { orderBy: { position: "asc" } } },
    });

    await appendChangeLog(tx, {
      orgId,
      entity: "DELIVERY_NOTE",
      entityId: note.id,
      action: "CREATE",
      actor,
      at: now,
      diff: { number, status: "CREATED", lines: note.lines.length },
    });

    return note;
  });
}
