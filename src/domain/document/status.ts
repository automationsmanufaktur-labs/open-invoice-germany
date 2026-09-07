/**
 * Zustandsmaschine fuer Angebot/Auftragsbestaetigung (Quote) und Lieferschein
 * (DeliveryNote). Jeder Statuswechsel prueft die Uebergangstabelle, laeuft in
 * einer Transaktion und schreibt einen ChangeLog-Eintrag (GoBD-Nachvollziehbarkeit,
 * auch wenn diese Belege selbst nicht GoBD-festgeschrieben werden).
 */
import { dbInternal } from "@/lib/db";
import { appendChangeLog } from "@/domain/audit";
import { buildSellerSnapshot } from "@/domain/snapshot";
import { resolveBuyerSnapshot } from "@/domain/document/snapshot-input";
import { assignDocumentNumber } from "@/domain/numbering/ranges";
import { NotFoundError } from "@/domain/errors";
import { QuoteStatus, DeliveryNoteStatus, type SnapshotSource } from "@/schemas";
import type { Quote, DeliveryNote, Prisma } from "@/generated/prisma/client";

export class StatusTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StatusTransitionError";
  }
}

// DRAFT->ACCEPTED/REJECTED erlaubt: Annahme/Ablehnung ohne vorherigen digitalen Versand
// (Postversand, telefonische Zusage) — Ruling des Betreibers.
// EXPIRED ist kein Ziel, das aktiv gesetzt werden kann — es ergibt sich rein abgeleitet
// aus validUntil (effectiveQuoteStatus). SENT->EXPIRED bleibt daher ausgeschlossen; EXPIRED
// bleibt aber als QUELLZUSTAND in der Tabelle (ein Angebot, dessen validUntil verstrichen
// ist, kann weiterhin erneut versendet oder angenommen werden — W4, Fix-Runde 2).
export const QUOTE_TRANSITIONS: Record<QuoteStatus, readonly QuoteStatus[]> = {
  DRAFT: ["SENT", "ACCEPTED", "REJECTED", "CANCELLED"],
  SENT: ["ACCEPTED", "REJECTED", "CANCELLED"],
  ACCEPTED: ["CANCELLED"],
  REJECTED: [],
  EXPIRED: ["SENT", "ACCEPTED"],
  CANCELLED: [],
};

export const DELIVERY_TRANSITIONS: Record<DeliveryNoteStatus, readonly DeliveryNoteStatus[]> = {
  DRAFT: ["CREATED", "CANCELLED"],
  CREATED: ["SENT", "DELIVERED", "CANCELLED"],
  SENT: ["DELIVERED", "CANCELLED"],
  DELIVERED: ["CANCELLED"],
  CANCELLED: [],
};

/** Prueft anhand einer Uebergangstabelle, ob von `from` nach `to` gewechselt werden darf. */
export function assertTransition<S extends string>(table: Record<S, readonly S[]>, from: S, to: S): void {
  if (!table[from].includes(to)) {
    throw new StatusTransitionError(`Uebergang von "${from}" nach "${to}" ist nicht erlaubt.`);
  }
}

interface StatusOptions {
  actor?: string;
  now?: Date;
  note?: string;
}

/**
 * Kern von setQuoteStatus, laeuft in einer vom Aufrufer uebergebenen Transaktion
 * (Muster: finalizeWithinTx) — genutzt von der Konvertierung Angebot -> AB
 * (src/domain/document/convert.ts), damit Statuswechsel, Erstellung, Relation und
 * ChangeLog atomar in EINER Transaktion laufen (Lastenheft 50).
 */
export async function setQuoteStatusWithinTx(
  tx: Prisma.TransactionClient,
  orgId: string,
  quoteId: string,
  to: QuoteStatus,
  opts: StatusOptions = {},
): Promise<Quote> {
  const target = QuoteStatus.parse(to);
  const now = opts.now ?? new Date();
  const actor = opts.actor ?? "system";

  // W4 (Fix-Runde 2): EXPIRED ist kein aktiv setzbares Ziel, sondern wird ausschliesslich
  // aus validUntil abgeleitet (effectiveQuoteStatus). Explizite Pruefung VOR der
  // Uebergangstabelle, damit die Fehlermeldung eindeutig auf die Ursache verweist.
  if (target === "EXPIRED") {
    throw new StatusTransitionError("EXPIRED wird nur abgeleitet (effectiveQuoteStatus) und kann nicht aktiv gesetzt werden.");
  }

  const quote = await tx.quote.findFirst({ where: { id: quoteId, orgId } });
  if (!quote) throw new NotFoundError(`Angebot ${quoteId} nicht gefunden.`);

  const from = QuoteStatus.parse(quote.status);
  assertTransition(QUOTE_TRANSITIONS, from, target);

  const data: Prisma.QuoteUpdateInput = { status: target };

  if (target === "SENT") {
    data.sentAt = now;
    // Der CREATE-Snapshot (Entwurf, noch kein ausgestellter Beleg) wird beim Versand
    // durch den SENT-Snapshot ersetzt — nur so landen z. B. nachtraeglich gesetzte
    // Ansprechpartner im versendeten Dokument. FINALIZE/SENT/MIGRATION/INHERITED
    // werden nie ueberschrieben (Task-2-Review-Auflage).
    if (!quote.buyerSnapshotJson || quote.snapshotSource === "CREATE") {
      const customer = await tx.customer.findFirstOrThrow({ where: { id: quote.customerId, orgId } });
      const org = await tx.organization.findUniqueOrThrow({ where: { id: orgId } });

      const buyer = await resolveBuyerSnapshot(tx, orgId, customer, quote.contactPersonId, quote.billingAddressId);
      const seller = buildSellerSnapshot(org);
      const source: SnapshotSource = "SENT";

      data.sellerSnapshotJson = JSON.stringify(seller);
      data.buyerSnapshotJson = JSON.stringify(buyer);
      data.snapshotSource = source;
      data.snapshotAt = now;
    }
  } else if (target === "ACCEPTED" || target === "REJECTED") {
    data.decidedAt = now;
    data.decisionNote = opts.note ?? null;
  }

  const updated = await tx.quote.update({ where: { id: quoteId }, data });

  await appendChangeLog(tx, {
    orgId,
    entity: "QUOTE",
    entityId: quoteId,
    action: `STATUS_${target}`,
    actor,
    at: now,
    diff: { from, to: target, note: opts.note ?? null },
  });

  return updated;
}

/**
 * Setzt den Status eines Angebots/einer Auftragsbestaetigung. Bei SENT wird — falls
 * noch kein Snapshot existiert — der Kaeufer-/Verkaeufer-Snapshot eingefroren
 * (Quelle "SENT"), damit spaetere Stammdatenaenderungen das versendete Dokument nicht
 * rueckwirkend veraendern. Bei ACCEPTED/REJECTED werden decidedAt/decisionNote gesetzt.
 */
export async function setQuoteStatus(
  orgId: string,
  quoteId: string,
  to: QuoteStatus,
  opts: StatusOptions = {},
): Promise<Quote> {
  return dbInternal.$transaction((tx) => setQuoteStatusWithinTx(tx, orgId, quoteId, to, opts));
}

/**
 * Setzt den Status eines Lieferscheins. Bei SENT/DELIVERED werden sentAt/deliveredAt
 * gesetzt. Beim Uebergang DRAFT->CREATED wird — falls noch keine Nummer vergeben ist
 * (z. B. ein per "Duplizieren" erzeugtes DRAFT-Duplikat, das noch nie eine Nummer
 * hatte) — jetzt eine Nummer aus dem Nummernkreis DELIVERY_NOTE gezogen (Nachtrag
 * Task 5: DRAFT->CREATED vergibt sonst keine Nummer, obwohl CREATED ein wirksamer,
 * zaehlender Beleg ist, remainingQuantities zaehlt CREATED mit).
 */
export async function setDeliveryNoteStatus(
  orgId: string,
  id: string,
  to: DeliveryNoteStatus,
  opts: StatusOptions = {},
): Promise<DeliveryNote> {
  const target = DeliveryNoteStatus.parse(to);
  const now = opts.now ?? new Date();
  const actor = opts.actor ?? "system";

  return dbInternal.$transaction(async (tx) => {
    const note = await tx.deliveryNote.findFirst({ where: { id, orgId } });
    if (!note) throw new NotFoundError(`Lieferschein ${id} nicht gefunden.`);

    const from = DeliveryNoteStatus.parse(note.status);
    assertTransition(DELIVERY_TRANSITIONS, from, target);

    const data: Prisma.DeliveryNoteUpdateInput = { status: target };
    if (target === "SENT") data.sentAt = now;
    if (target === "DELIVERED") data.deliveredAt = now;

    if (target === "CREATED" && !note.number) {
      // B3 (Final-Review): ueber assignDocumentNumber() — siehe invoice/finalize.ts.
      data.number = await assignDocumentNumber(tx, orgId, "DELIVERY_NOTE", now);
    }

    const updated = await tx.deliveryNote.update({ where: { id }, data });

    await appendChangeLog(tx, {
      orgId,
      entity: "DELIVERY_NOTE",
      entityId: id,
      action: `STATUS_${target}`,
      actor,
      at: now,
      diff: { from, to: target, note: opts.note ?? null },
    });

    return updated;
  });
}

/** Archiviert/entarchiviert ein Angebot oder einen Lieferschein (rein organisatorisch, kein Statuswechsel). */
export async function setArchived(
  orgId: string,
  type: "QUOTE" | "DELIVERY_NOTE",
  id: string,
  archived: boolean,
  actor: string,
  now: Date = new Date(),
): Promise<void> {
  const archivedAt = archived ? now : null;

  await dbInternal.$transaction(async (tx) => {
    if (type === "QUOTE") {
      const found = await tx.quote.findFirst({ where: { id, orgId }, select: { id: true } });
      if (!found) throw new NotFoundError(`Angebot ${id} nicht gefunden.`);
      await tx.quote.update({ where: { id }, data: { archivedAt } });
    } else {
      const found = await tx.deliveryNote.findFirst({ where: { id, orgId }, select: { id: true } });
      if (!found) throw new NotFoundError(`Lieferschein ${id} nicht gefunden.`);
      await tx.deliveryNote.update({ where: { id }, data: { archivedAt } });
    }

    await appendChangeLog(tx, {
      orgId,
      entity: type,
      entityId: id,
      action: archived ? "ARCHIVE" : "UNARCHIVE",
      actor,
      at: now,
      diff: { archived },
    });
  });
}

/**
 * Leitet den tatsaechlich wirksamen Status eines Angebots ab: EXPIRED ist kein
 * gespeicherter Status, sondern ergibt sich, wenn DRAFT/SENT noch aktiv ist und
 * `validUntil` verstrichen ist. Tagesgenauer Vergleich in UTC — Europe/Berlin-
 * Grenzfaelle (Mitternacht) sind fuer ein Gueltigkeitsdatum ohne Uhrzeit nicht relevant.
 */
export function effectiveQuoteStatus(q: { status: string; validUntil: Date | null }, now: Date = new Date()): QuoteStatus {
  const status = QuoteStatus.parse(q.status);
  if ((status === "DRAFT" || status === "SENT") && q.validUntil && q.validUntil.getTime() < now.getTime()) {
    return "EXPIRED";
  }
  return status;
}
