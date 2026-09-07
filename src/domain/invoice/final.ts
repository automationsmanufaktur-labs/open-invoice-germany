/**
 * Schlussrechnung (§ 14 Abs. 5 UStG): Rechnung ueber die GESAMTE Leistung eines
 * Angebots/einer Auftragsbestaetigung, gegen die anschliessend beim Festschreiben die
 * bereits vereinnahmten Abschlaege als `FinalInvoiceDeduction`-Snapshot abgesetzt werden
 * (siehe `finalizeWithinTx`, src/domain/invoice/finalize.ts). Voraussetzung fuer die
 * ANLAGE: mindestens eine festgeschriebene, nicht stornierte Abschlagsrechnung UND keine
 * bereits bestehende, nicht stornierte Schlussrechnung auf derselben Quelle.
 */
import { dbInternal } from "@/lib/db";
import { appendChangeLog } from "@/domain/audit";
import { linkDocuments, listRelations } from "@/domain/relations";
import { createDraftInvoiceWithinTx } from "@/domain/invoice/create";
import { NotFoundError } from "@/domain/errors";
import { createFinalInvoiceSchema, type CreateFinalInvoiceInput, type CreateInvoiceInput } from "@/schemas";

export class FinalInvoiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinalInvoiceError";
  }
}

const QUOTE_KINDS_ALLOWED = new Set(["ANGEBOT", "AUFTRAGSBESTAETIGUNG"]);
const FINALIZED_STATUSES = new Set(["FINALIZED", "SENT", "PARTIALLY_PAID", "PAID"]);

export interface CreateFinalInvoiceOptions {
  actor?: string;
  now?: Date;
}

export async function createFinalInvoice(orgId: string, rawInput: unknown, opts: CreateFinalInvoiceOptions = {}) {
  const input: CreateFinalInvoiceInput = createFinalInvoiceSchema.parse(rawInput);
  const now = opts.now ?? new Date();
  const actor = opts.actor ?? "system";

  return dbInternal.$transaction(async (tx) => {
    const quote = await tx.quote.findFirst({ where: { id: input.sourceId, orgId }, include: { lines: { orderBy: { position: "asc" } } } });
    if (!quote) throw new NotFoundError(`Angebot/Auftragsbestaetigung ${input.sourceId} nicht gefunden.`);
    if (!QUOTE_KINDS_ALLOWED.has(quote.kind)) {
      throw new FinalInvoiceError(`Nur ein Angebot/eine Auftragsbestaetigung kann Quelle einer Schlussrechnung sein (kind: ${quote.kind}).`);
    }

    // B13 (Fix-Welle): tx statt dbInternal — die "keine zweite Schlussrechnung"-Pruefung
    // liest damit innerhalb derselben Transaktion, in der auch geschrieben wird.
    const relations = await listRelations(orgId, "QUOTE", input.sourceId, tx);
    const downpaymentIds = relations
      .filter((r) => r.fromType === "INVOICE" && r.toType === "QUOTE" && r.toId === input.sourceId && r.relationType === "DOWNPAYMENT_OF")
      .map((r) => r.fromId);
    const finalizedDownpayments = downpaymentIds.length
      ? await tx.invoice.findMany({ where: { id: { in: downpaymentIds }, orgId, status: { in: [...FINALIZED_STATUSES] } }, select: { id: true } })
      : [];
    if (finalizedDownpayments.length === 0) {
      throw new FinalInvoiceError("Es liegt keine festgeschriebene, nicht stornierte Abschlagsrechnung fuer diese Quelle vor.");
    }

    const finalIds = relations
      .filter((r) => r.fromType === "INVOICE" && r.toType === "QUOTE" && r.toId === input.sourceId && r.relationType === "FINAL_FOR")
      .map((r) => r.fromId);
    const existingActiveFinal = finalIds.length
      ? await tx.invoice.findMany({ where: { id: { in: finalIds }, orgId, status: { not: "CANCELLED" } }, select: { id: true } })
      : [];
    if (existingActiveFinal.length > 0) {
      throw new FinalInvoiceError("Fuer diese Quelle besteht bereits eine nicht stornierte Schlussrechnung.");
    }

    // Positionen = Gesamtleistung: ALLE Zeilen (auch HEADING/TEXT/SUBTOTAL) 1:1 kopiert,
    // damit die Gliederung des Angebots erhalten bleibt (analog cancelInvoice-Spiegelung).
    // Beleg-Rabatt/-Aufschlag der Quelle werden mituebernommen, damit die Gesamtleistung
    // exakt dem Angebotsbetrag entspricht (Summen berechnet createDraftInvoiceWithinTx).
    const createInput: CreateInvoiceInput = {
      customerId: quote.customerId,
      type: "FINAL",
      taxScheme: quote.taxScheme as CreateInvoiceInput["taxScheme"],
      currency: quote.currency,
      // Leistungszeitpunkt (§14 Abs.4 Nr.6): Quote fuehrt kein eigenes Lieferdatum —
      // Ersatzweise das Anlagedatum (analog createPartialInvoice/createDownpaymentInvoice).
      deliveryDate: now,
      headerText: quote.headerText ?? undefined,
      footerText: quote.footerText ?? undefined,
      paymentTerms: quote.paymentTerms ?? undefined,
      documentDiscountPermille: quote.documentDiscountPermille,
      documentDiscountCents: quote.documentDiscountCents,
      documentChargePermille: quote.documentChargePermille,
      documentChargeCents: quote.documentChargeCents,
      documentChargeReason: quote.documentChargeReason ?? undefined,
      lines: quote.lines.map((l) => ({
        lineType: l.lineType as CreateInvoiceInput["lines"][number]["lineType"],
        description: l.description,
        descriptionLong: l.descriptionLong ?? undefined,
        articleNumber: l.articleNumber ?? undefined,
        quantityMilli: l.quantityMilli,
        unit: l.unit,
        unitNetPriceCents: l.unitNetPriceCents,
        taxRate: l.taxRate as CreateInvoiceInput["lines"][number]["taxRate"],
        taxCategory: l.taxCategory as CreateInvoiceInput["lines"][number]["taxCategory"],
        discountPermille: l.discountPermille,
        discountCents: l.discountCents,
      })),
    };

    const invoice = await createDraftInvoiceWithinTx(tx, orgId, createInput, { actor, now });

    await tx.invoice.update({ where: { id: invoice.id }, data: { sourceType: "QUOTE", sourceId: input.sourceId } });

    await linkDocuments(tx, { orgId, fromType: "INVOICE", fromId: invoice.id, toType: "QUOTE", toId: input.sourceId, relationType: "FINAL_FOR" });

    await appendChangeLog(tx, {
      orgId,
      entity: "INVOICE",
      entityId: invoice.id,
      action: "FINAL_INVOICE_CREATE",
      actor,
      at: now,
      diff: { sourceId: input.sourceId },
    });

    return tx.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { lines: { orderBy: { position: "asc" } } } });
  });
}
