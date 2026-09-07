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
import { buildSellerSnapshot, buildContactSnapshot } from "@/domain/snapshot";
import { resolveBuyerSnapshot } from "@/domain/document/snapshot-input";
import { appendChangeLog } from "@/domain/audit";
import { logActivity } from "@/domain/activity/log";
import { emitEvent } from "@/domain/webhook/emit";
import { serializeDeliveryNote } from "@/api/serializers/delivery-note";
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

/** Nit (Fix-Welle): Eingabevalidierung (z. B. BILLING-Adresse als Lieferadresse) — Route
 *  mappt dies auf 400, waehrend die generische DeliveryNoteError (nicht gefunden o. ae.)
 *  bei 409 bleibt. */
export class DeliveryNoteValidationError extends DeliveryNoteError {
  constructor(message: string) {
    super(message);
    this.name = "DeliveryNoteValidationError";
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

  // Phase 8a (§29/§30): fehlt die Angabe komplett (`undefined`), greift die
  // Default-Lieferadresse/der Default-Ansprechpartner des Kunden (analog
  // createDraftInvoiceWithinTx/createBusinessDocumentWithinTx). Explizites `null`
  // uebernimmt bewusst keinen Default.
  let contactPersonId = input.contactPersonId;
  if (contactPersonId) {
    const contact = await tx.contactPerson.findFirst({ where: { id: contactPersonId, orgId, customerId: input.customerId }, select: { id: true } });
    if (!contact) throw new DeliveryNoteError("Ansprechpartner nicht gefunden.");
  } else if (contactPersonId === undefined) {
    const defaultContact = await tx.contactPerson.findFirst({ where: { orgId, customerId: input.customerId, isDefault: true }, select: { id: true } });
    contactPersonId = defaultContact?.id ?? null;
  }
  let shippingAddressId = input.shippingAddressId;
  if (shippingAddressId) {
    const address = await tx.customerAddress.findFirst({ where: { id: shippingAddressId, orgId, customerId: input.customerId }, select: { id: true, type: true } });
    if (!address) throw new DeliveryNoteError("Lieferadresse nicht gefunden.");
    // Nit (Fix-Welle): eine Lieferadresse ist SHIPPING oder OTHER, keine BILLING-Adresse.
    if (address.type === "BILLING") throw new DeliveryNoteValidationError("Als Lieferadresse ist keine Rechnungsadresse (BILLING) zulaessig.");
  } else if (shippingAddressId === undefined) {
    const defaultAddress = await tx.customerAddress.findFirst({ where: { orgId, customerId: input.customerId, type: "SHIPPING", isDefault: true }, select: { id: true } });
    shippingAddressId = defaultAddress?.id ?? null;
  }

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

  // Fix-Welle B2: resolveBuyerSnapshot bekommt IMMER billingAddressId: null — die
  // flachen Buyer-Postfelder (BG-8, addressLine1 etc.) bleiben Kundenstamm/Default-BILLING,
  // NICHT die Lieferadresse (zuvor wurde shippingAddressId faelschlich als
  // billingAddressId hineingereicht, wodurch die Lieferadresse als Rechnungsadresse im
  // Snapshot landete und sich in eine daraus abgeleitete Teilrechnung vererbte).
  // Die gewaehlte Lieferadresse landet stattdessen strukturiert unter
  // buyerSnapshot.shippingAddress (eigener Schluessel, gleiche Adressform wie `address`).
  const buyerSnapshot = await resolveBuyerSnapshot(tx, orgId, customer, contactPersonId, null);
  if (shippingAddressId) {
    const shipAddr = await tx.customerAddress.findFirst({ where: { id: shippingAddressId, orgId } });
    if (shipAddr) {
      buyerSnapshot.shippingAddress = {
        type: shipAddr.type as "BILLING" | "SHIPPING" | "OTHER",
        label: shipAddr.label,
        addressLine1: shipAddr.addressLine1,
        addressLine2: shipAddr.addressLine2,
        postalCode: shipAddr.postalCode,
        city: shipAddr.city,
        countryCode: shipAddr.countryCode,
      };
    }
  }
  let contactSnapshotJson: string | null = null;
  if (contactPersonId) {
    const contact = await tx.contactPerson.findFirst({ where: { id: contactPersonId, orgId } });
    if (contact) {
      contactSnapshotJson = JSON.stringify(
        buildContactSnapshot({ firstName: contact.firstName, lastName: contact.lastName, role: contact.role, email: contact.email, phone: contact.phone }),
      );
    }
  }

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
      contactPersonId,
      shippingAddressId,
      sellerSnapshotJson: JSON.stringify(buildSellerSnapshot(org)),
      buyerSnapshotJson: JSON.stringify(buyerSnapshot),
      contactSnapshotJson,
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
  await logActivity(tx, { orgId, entityType: "DELIVERY_NOTE", entityId: note.id, type: "CREATED", actor, at: now, data: { number } });

  // Webhook-Outbox (Phase 10, Task 5): "delivery_note.created" — IN DERSELBEN Tx.
  await emitEvent(tx, {
    orgId,
    type: "delivery_note.created",
    objectName: "DeliveryNote",
    objectId: note.id,
    data: serializeDeliveryNote(note, new Set()),
    now,
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
