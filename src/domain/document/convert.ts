/**
 * Generische Dokumentkonvertierung: Angebot -> Auftragsbestaetigung, Angebot/AB/Proforma
 * -> Rechnung (Entwurf), Angebot/AB/Rechnung -> Lieferschein (mit Teilmengen). Jede
 * Konvertierung schreibt eine DocumentRelation (src/domain/relations.ts) und einen
 * ChangeLog-Eintrag in derselben Transaktion wie die jeweilige Schreiboperation.
 */
import { dbInternal } from "@/lib/db";
import { computeTaxBreakdown } from "@/lib/tax";
import { appendChangeLog } from "@/domain/audit";
import { linkDocuments } from "@/domain/relations";
import { createBusinessDocumentWithinTx } from "@/domain/document/create";
import { createDeliveryNoteWithinTx } from "@/domain/delivery-note/create";
import { remainingQuantities, assertNoOverDelivery, loadSourceLines, type DeliverySourceType } from "@/domain/delivery-note/quantities";
import { pickTextTemplate } from "@/domain/text-template/pick";
import { setQuoteStatusWithinTx, effectiveQuoteStatus } from "@/domain/document/status";
import { convertDocumentSchema, type ConvertDocumentInput } from "@/schemas";
import type { Invoice, Quote, DeliveryNote } from "@/generated/prisma/client";

export class ConvertError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConvertError";
  }
}

interface ConvertOptions {
  actor?: string;
  now?: Date;
}
type ResolvedConvertOptions = Required<ConvertOptions>;

// W2 (Fix-Runde 2): erlaubte Quellstatus je Zielkonvertierung, geprueft gegen den
// EFFEKTIVEN Status (effectiveQuoteStatus, EXPIRED eingeschlossen). AB (Auftrags-
// bestaetigung) ist bereits eine Zusage — nur DRAFT/SENT duerfen noch in eine Rechnung
// umgewandelt werden, waehrend ein Angebot zusaetzlich aus ACCEPTED/EXPIRED heraus darf.
const ANGEBOT_TO_AB_STATUSES = new Set(["DRAFT", "SENT", "ACCEPTED", "EXPIRED"]);
const QUOTE_TO_DELIVERY_NOTE_STATUSES = new Set(["DRAFT", "SENT", "ACCEPTED", "EXPIRED"]);

// Fix-Runde 2 (Re-Review): erlaubte Quellstatus fuer die Umwandlung in eine Rechnung, je
// Quote-Kind. PROFORMA fehlte bisher komplett (keine Pruefung) — jetzt wie ANGEBOT
// behandelt (DRAFT/SENT/ACCEPTED/EXPIRED); AUFTRAGSBESTAETIGUNG bleibt auf DRAFT/SENT
// eingeschraenkt (bereits eine Zusage).
const ALLOWED_SOURCE_STATUS_FOR_INVOICE: Record<string, Set<string>> = {
  ANGEBOT: new Set(["DRAFT", "SENT", "ACCEPTED", "EXPIRED"]),
  PROFORMA: new Set(["DRAFT", "SENT", "ACCEPTED", "EXPIRED"]),
  AUFTRAGSBESTAETIGUNG: new Set(["DRAFT", "SENT"]),
};

/** Wandelt ein Geschaeftsdokument (Angebot/AB/Proforma) in eine Rechnung um (DRAFT). */
export async function convertDocumentToInvoice(orgId: string, documentId: string, opts: ConvertOptions = {}): Promise<Invoice> {
  const now = opts.now ?? new Date();
  const actor = opts.actor ?? "system";

  return dbInternal.$transaction(async (tx) => {
    const q = await tx.quote.findFirst({ where: { id: documentId, orgId }, include: { lines: { orderBy: { position: "asc" } } } });
    if (!q) throw new ConvertError("Dokument nicht gefunden.");
    if (q.convertedToInvoiceId) throw new ConvertError("Dokument wurde bereits in eine Rechnung umgewandelt.");

    {
      const eff = effectiveQuoteStatus({ status: q.status, validUntil: q.validUntil }, now);
      const allowed = ALLOWED_SOURCE_STATUS_FOR_INVOICE[q.kind];
      if (allowed && !allowed.has(eff)) {
        throw new ConvertError(`Dokument im Status "${eff}" kann nicht in eine Rechnung umgewandelt werden.`);
      }
    }

    const totals = computeTaxBreakdown(
      q.lines.map((l) => ({ lineNetCents: l.lineNetCents, taxRate: l.taxRate, taxCategory: l.taxCategory })),
      {
        discountPermille: q.documentDiscountPermille,
        discountCents: q.documentDiscountCents,
        chargePermille: q.documentChargePermille,
        chargeCents: q.documentChargeCents,
      },
    );

    // Kopf-/Fusstext und Zahlungsbedingungen vom Dokument uebernehmen; fehlen sie, aus der
    // INVOICE-Textvorlage vorbelegen (Selbstheilung, wie bei createBusinessDocument).
    const headerText = q.headerText ?? (await pickTextTemplate(tx, orgId, "INVOICE", "HEAD"));
    const footerText = q.footerText ?? (await pickTextTemplate(tx, orgId, "INVOICE", "FOOT"));
    const paymentTerms = q.paymentTerms ?? (await pickTextTemplate(tx, orgId, "INVOICE", "TERMS_PAYMENT"));

    // Fehlt eine Zahlungsmethode am Dokument (Quote kennt keine eigene), greift die
    // Standard-Zahlungsmethode des Kunden (gleiches Muster wie createDraftInvoiceWithinTx).
    const customer = await tx.customer.findUnique({ where: { id: q.customerId }, select: { defaultPaymentMethodId: true } });
    const paymentMethodId = customer?.defaultPaymentMethodId ?? undefined;

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
        headerText,
        footerText,
        paymentTerms,
        documentDiscountPermille: q.documentDiscountPermille,
        documentDiscountCents: q.documentDiscountCents,
        documentChargePermille: q.documentChargePermille,
        documentChargeCents: q.documentChargeCents,
        documentChargeReason: q.documentChargeReason,
        paymentMethodId,
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
            discountCents: l.discountCents,
            lineNetCents: l.lineNetCents,
          })),
        },
      },
    });

    // Status bleibt unveraendert (der Abrechnungsstand ergibt sich aus der Relation, nicht
    // mehr aus einem eigenen CONVERTED-Status) — nur die Verknuepfung wird gesetzt.
    await tx.quote.update({ where: { id: documentId }, data: { convertedToInvoiceId: invoice.id } });
    await linkDocuments(tx, { orgId: q.orgId, fromType: "QUOTE", fromId: documentId, toType: "INVOICE", toId: invoice.id, relationType: "CONVERTED_TO" });
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

/**
 * Wandelt ein Angebot in eine Auftragsbestaetigung um: neues Dokument mit kopierten
 * Positionen (createBusinessDocument uebernimmt Nummernkreis, Snapshot und AB-Textvorlage),
 * Relation CONVERTED_TO. Das Angebot wird — sofern noch nicht entschieden — auf ACCEPTED
 * gesetzt (Ruling); PROFORMA kann NICHT in eine AB umgewandelt werden. Statuswechsel,
 * Erstellung, Relation und ChangeLog laufen in EINER Transaktion (Lastenheft 50) — schlaegt
 * ein Schritt fehl, bleibt weder der Statuswechsel noch die AB noch die Relation stehen.
 */
async function convertQuoteToOrderConfirmation(orgId: string, fromId: string, opts: ResolvedConvertOptions): Promise<Quote> {
  const { actor, now } = opts;

  return dbInternal.$transaction(async (tx) => {
    const src = await tx.quote.findFirst({ where: { id: fromId, orgId }, include: { lines: { orderBy: { position: "asc" } } } });
    if (!src) throw new ConvertError("Angebot nicht gefunden.");
    if (src.kind !== "ANGEBOT") throw new ConvertError("Nur ein Angebot kann in eine Auftragsbestaetigung umgewandelt werden.");

    const eff = effectiveQuoteStatus({ status: src.status, validUntil: src.validUntil }, now);
    if (!ANGEBOT_TO_AB_STATUSES.has(eff)) {
      throw new ConvertError(`Angebot im Status "${eff}" kann nicht in eine Auftragsbestaetigung umgewandelt werden.`);
    }
    if (eff === "DRAFT" || eff === "SENT" || eff === "EXPIRED") {
      await setQuoteStatusWithinTx(tx, orgId, fromId, "ACCEPTED", { actor, now });
    }

    const ab = await createBusinessDocumentWithinTx(
      tx,
      orgId,
      {
        kind: "AUFTRAGSBESTAETIGUNG",
        customerId: src.customerId,
        taxScheme: src.taxScheme,
        currency: src.currency,
        subject: src.subject ?? undefined,
        customerReference: src.customerReference ?? undefined,
        contactPersonId: src.contactPersonId ?? undefined,
        billingAddressId: src.billingAddressId ?? undefined,
        deliveryTerms: src.deliveryTerms ?? undefined,
        paymentTerms: src.paymentTerms ?? undefined,
        notes: src.notes ?? undefined,
        internalNotes: src.internalNotes ?? undefined,
        // headerText/footerText bewusst nicht uebernommen -> AB-Textvorlage greift.
        documentDiscountPermille: src.documentDiscountPermille,
        documentDiscountCents: src.documentDiscountCents,
        documentChargePermille: src.documentChargePermille,
        documentChargeCents: src.documentChargeCents,
        documentChargeReason: src.documentChargeReason ?? undefined,
        lines: src.lines.map((l) => ({
          description: l.description,
          quantityMilli: l.quantityMilli,
          unit: l.unit,
          unitNetPriceCents: l.unitNetPriceCents,
          taxRate: l.taxRate as 19 | 7 | 0,
          taxCategory: l.taxCategory as "S" | "AE" | "K" | "G" | "E" | "Z",
          discountPermille: l.discountPermille,
          discountCents: l.discountCents,
        })),
      },
      { actor, now },
    );

    await linkDocuments(tx, { orgId, fromType: "QUOTE", fromId, toType: "QUOTE", toId: ab.id, relationType: "CONVERTED_TO" });

    return ab;
  });
}

/**
 * Wandelt Angebot/AB/Rechnung in einen Lieferschein um — Mengen = Eingabe oder Restmengen.
 * W1 (Fix-Runde 2): Laden der Restmengen UND die Ueberlieferungspruefung laufen jetzt
 * INNERHALB derselben Transaktion wie das Anlegen des Lieferscheins (statt davor) — unter
 * SQLite serialisiert das ohnehin schon die Schreibtransaktion, unter Postgres (READ
 * COMMITTED) verkleinert es das Race-Fenster zwischen Lesen und Schreiben zweier
 * gleichzeitiger Anlagen auf dieselbe Restmenge (siehe LIMITATIONEN.md — vollstaendig
 * ausgeschlossen ist die Ueberlieferung unter Postgres damit weiterhin nicht). Erstellung,
 * Relation und ChangeLog laufen in EINER Transaktion (Lastenheft 50).
 */
async function convertToDeliveryNote(orgId: string, input: ConvertDocumentInput, opts: ResolvedConvertOptions): Promise<DeliveryNote> {
  const fromType = input.fromType as DeliverySourceType;
  const fromId = input.fromId;

  return dbInternal.$transaction(async (tx) => {
    if (fromType === "QUOTE") {
      const src = await tx.quote.findFirst({ where: { id: fromId, orgId }, select: { status: true, validUntil: true } });
      if (!src) throw new ConvertError("Dokument nicht gefunden.");
      const eff = effectiveQuoteStatus({ status: src.status, validUntil: src.validUntil }, opts.now);
      if (!QUOTE_TO_DELIVERY_NOTE_STATUSES.has(eff)) {
        throw new ConvertError(`Dokument im Status "${eff}" kann nicht in einen Lieferschein umgewandelt werden.`);
      }
    } else {
      const src = await tx.invoice.findFirst({ where: { id: fromId, orgId }, select: { status: true } });
      if (!src) throw new ConvertError("Rechnung nicht gefunden.");
      if (src.status === "CANCELLED") {
        throw new ConvertError("Stornierte Rechnung kann nicht in einen Lieferschein umgewandelt werden.");
      }
    }

    const { customerId, lines: sourceLines } = await loadSourceLines(orgId, fromType, fromId, tx);
    const remaining = await remainingQuantities(orgId, fromType, fromId, tx);
    const requested = input.quantities ?? remaining.filter((r) => r.remainingMilli > 0).map((r) => ({ sourceLineId: r.sourceLineId, quantityMilli: r.remainingMilli }));
    assertNoOverDelivery(remaining, requested);

    const sourceLineMap = new Map(sourceLines.map((l) => [l.id, l]));
    const lines = requested
      .filter((r) => r.quantityMilli > 0)
      .map((r) => {
        const src = sourceLineMap.get(r.sourceLineId);
        if (!src) throw new ConvertError(`Quellposition ${r.sourceLineId} unbekannt.`);
        return {
          description: src.description,
          quantityMilli: r.quantityMilli,
          unit: src.unit,
          sourceType: fromType,
          sourceId: fromId,
          sourceLineId: r.sourceLineId,
          unitNetPriceCents: src.unitNetPriceCents,
          taxRate: src.taxRate,
        };
      });
    if (lines.length === 0) throw new ConvertError("Keine Restmenge zum Liefern vorhanden.");

    const note = await createDeliveryNoteWithinTx(
      tx,
      orgId,
      {
        customerId,
        sourceType: fromType,
        sourceId: fromId,
        deliveryDate: input.deliveryDate,
        showPrices: false,
        showTax: false,
        showArticleNumber: true,
        showDescription: true,
        lines,
      },
      opts,
    );

    await linkDocuments(tx, { orgId, fromType, fromId, toType: "DELIVERY_NOTE", toId: note.id, relationType: "DELIVERED_BY" });

    return note;
  });
}

/** Generischer Einstieg: dispatcht nach `toKind`, parst die Eingabe selbst. */
export async function convertDocument(
  orgId: string,
  rawInput: unknown,
  opts: ConvertOptions = {},
): Promise<{ type: "QUOTE" | "INVOICE" | "DELIVERY_NOTE"; id: string }> {
  const input = convertDocumentSchema.parse(rawInput);
  const resolved: ResolvedConvertOptions = { actor: opts.actor ?? "system", now: opts.now ?? new Date() };

  if (input.toKind === "INVOICE") {
    if (input.fromType !== "QUOTE") throw new ConvertError("Nur ein Geschaeftsdokument kann in eine Rechnung umgewandelt werden.");
    const invoice = await convertDocumentToInvoice(orgId, input.fromId, resolved);
    return { type: "INVOICE", id: invoice.id };
  }

  if (input.toKind === "AUFTRAGSBESTAETIGUNG") {
    if (input.fromType !== "QUOTE") throw new ConvertError("Nur ein Angebot kann in eine Auftragsbestaetigung umgewandelt werden.");
    const ab = await convertQuoteToOrderConfirmation(orgId, input.fromId, resolved);
    return { type: "QUOTE", id: ab.id };
  }

  const note = await convertToDeliveryNote(orgId, input, resolved);
  return { type: "DELIVERY_NOTE", id: note.id };
}
