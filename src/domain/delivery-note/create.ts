/**
 * Legt einen Lieferschein an (Phase 1, erweitert in Phase 3a um Quelle/Texte/Restmengen-
 * Positionen). Kein GoBD-Beleg, aber Nachweis des Leistungszeitpunkts (§ 14 Abs. 4 Nr. 6)
 * — daher Nummernkreis, Parteien-Snapshot (Phase 0-Muster) und ChangeLog-Eintrag. Status
 * bei Anlage immer CREATED (Nummer wird sofort vergeben) — DRAFT bleibt fuer das
 * Formular-Zwischenspeichern (Task 5) reserviert.
 *
 * `createDeliveryNoteWithinTx` laeuft in einer vom Aufrufer uebergebenen Transaktion
 * (Muster: finalizeWithinTx) — genutzt von der Konvertierung (src/domain/document/convert.ts),
 * damit Erstellung, Relation und ChangeLog atomar bleiben (Lastenheft 50).
 */
import type { Prisma } from "@/generated/prisma/client";
import { dbInternal } from "@/lib/db";
import { defaultPrefix, formatDocumentNumber } from "@/domain/numbering";
import { buildSellerSnapshot, buildBuyerSnapshot } from "@/domain/snapshot";
import { appendChangeLog } from "@/domain/audit";
import { assertDocExists } from "@/domain/relations";
import { pickTextTemplate } from "@/domain/text-template/pick";
import { createDeliveryNoteSchema, type SnapshotSource } from "@/schemas";

export class DeliveryNoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeliveryNoteError";
  }
}

export async function createDeliveryNoteWithinTx(
  tx: Prisma.TransactionClient,
  orgId: string,
  rawInput: unknown,
  opts: { actor?: string; now?: Date } = {},
) {
  const input = createDeliveryNoteSchema.parse(rawInput);
  const now = opts.now ?? new Date();
  const actor = opts.actor ?? "system";

  const customer = await tx.customer.findFirst({ where: { id: input.customerId, orgId } });
  if (!customer) throw new DeliveryNoteError("Kunde nicht gefunden.");
  const org = await tx.organization.findUniqueOrThrow({ where: { id: orgId } });

  if (input.sourceType && input.sourceId) {
    try {
      await assertDocExists(tx, orgId, input.sourceType, input.sourceId);
    } catch {
      throw new DeliveryNoteError(`Quelldokument ${input.sourceId} nicht gefunden.`);
    }
  }

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

  const headerText = input.headerText ?? (await pickTextTemplate(tx, orgId, docType, "HEAD"));
  const footerText = input.footerText ?? (await pickTextTemplate(tx, orgId, docType, "FOOT"));

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
      showArticleNumber: input.showArticleNumber,
      showDescription: input.showDescription,
      notes: input.notes,
      internalNotes: input.internalNotes,
      headerText,
      footerText,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
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
          sourceLineId: l.sourceLineId,
          unitNetPriceCents: l.unitNetPriceCents,
          taxRate: l.taxRate,
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
    diff: { number, status: "CREATED", lines: note.lines.length, sourceType: input.sourceType ?? null, sourceId: input.sourceId ?? null },
  });

  return note;
}

export async function createDeliveryNote(
  orgId: string,
  rawInput: unknown,
  opts: { actor?: string; now?: Date } = {},
) {
  return dbInternal.$transaction((tx) => createDeliveryNoteWithinTx(tx, orgId, rawInput, opts));
}
