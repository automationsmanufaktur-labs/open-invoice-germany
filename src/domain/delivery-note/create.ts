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
import { assignDocumentNumber } from "@/domain/numbering/ranges";
import { buildSellerSnapshot, buildBuyerSnapshot } from "@/domain/snapshot";
import { appendChangeLog } from "@/domain/audit";
import { assertDocExists } from "@/domain/relations";
import { pickTextTemplate } from "@/domain/text-template/pick";
import { loadDocumentSettings } from "@/domain/document/settings";
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
  // B3 (Final-Review): ueber assignDocumentNumber() — siehe invoice/finalize.ts.
  const number = await assignDocumentNumber(tx, orgId, docType, now);

  const headerText = input.headerText ?? (await pickTextTemplate(tx, orgId, docType, "HEAD"));
  const footerText = input.footerText ?? (await pickTextTemplate(tx, orgId, docType, "FOOT"));

  // dnShow*-Defaults + showDeliveryAddress (Phase 7, §33): fehlt ein Anzeige-Flag am
  // Aufruf, greift die Org-Einstellung statt eines hart codierten Werts.
  const docSettings = await loadDocumentSettings(orgId);
  const showPrices = input.showPrices ?? docSettings.dnShowPrices;
  // showTax/showDescription kennen keine eigene Org-Einstellung (Brief nennt nur
  // dnShowPrices/dnShowArticleNumber/dnShowDeliveryAddress) — Defaults bleiben wie zuvor
  // im Zod-Schema (false/true).
  const showTax = input.showTax ?? false;
  const showArticleNumber = input.showArticleNumber ?? docSettings.dnShowArticleNumber;
  const showDescription = input.showDescription ?? true;
  const showDeliveryAddress = input.showDeliveryAddress ?? docSettings.dnShowDeliveryAddress;

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
      showPrices,
      showTax,
      showArticleNumber,
      showDescription,
      showDeliveryAddress,
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
