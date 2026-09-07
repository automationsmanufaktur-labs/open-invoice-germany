/**
 * Abschlagsrechnung (§ 13/§ 14 Abs. 5 UStG): Vorauszahlung auf ein Angebot/eine
 * Auftragsbestaetigung, ausgewiesen je Steuersatz-Bucket der Gesamtleistung
 * (`splitByTaxRate`). Quelle ist ausschliesslich ein Quote (kind ANGEBOT/
 * AUFTRAGSBESTAETIGUNG) — anders als die Teilrechnung, die auch aus einem
 * Lieferschein abgerechnet werden kann.
 *
 * Ruling (Task-2-Facts, Koordinator): Abschlags- und Teilrechnungen werden nie auf
 * derselben Quelle gemischt (Fehler, sobald die jeweils andere Art bereits existiert).
 * Fuer die 100-%-Grenze zaehlen nur bereits FESTGESCHRIEBENE, nicht stornierte
 * Abschlaege — Entwuerfe werden erst beim eigenen Festschreiben erneut geprueft
 * (Race zwischen zwei gleichzeitig offenen Abschlags-Entwuerfen ist damit nicht
 * ausgeschlossen, wird aber beim Festschreiben des zweiten sichtbar, weil
 * `finalizeWithinTx` fuer FINAL-Rechnungen ohnehin die Summe der Abschlaege prueft —
 * fuer DOWNPAYMENT selbst gibt es keine analoge Nachpruefung, siehe Task-2-Report).
 */
import type { Prisma } from "@/generated/prisma/client";
import { dbInternal } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { computeTaxBreakdown } from "@/lib/tax";
import { splitByTaxRate, formatPermilleDE, type TaxRateSplit } from "@/lib/pricing/partial";
import { PricingError } from "@/lib/pricing/errors";
import type { RateBucket } from "@/lib/pricing/allocate";
import { appendChangeLog } from "@/domain/audit";
import { linkDocuments, listRelations } from "@/domain/relations";
import { createDraftInvoiceWithinTx } from "@/domain/invoice/create";
import { setQuoteStatusWithinTx } from "@/domain/document/status";
import { NotFoundError } from "@/domain/errors";
import { createDownpaymentInvoiceSchema, type CreateDownpaymentInvoiceInput, type CreateInvoiceInput } from "@/schemas";

export class DownpaymentInvoiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DownpaymentInvoiceError";
  }
}

const QUOTE_KINDS_ALLOWED = new Set(["ANGEBOT", "AUFTRAGSBESTAETIGUNG"]);
const QUOTE_STATUS_ALLOWED = new Set(["DRAFT", "SENT", "ACCEPTED"]);
const FINALIZED_STATUSES = new Set(["FINALIZED", "SENT", "PARTIALLY_PAID", "PAID"]);

export interface CreateDownpaymentInvoiceOptions {
  actor?: string;
  now?: Date;
}

export async function createDownpaymentInvoice(orgId: string, rawInput: unknown, opts: CreateDownpaymentInvoiceOptions = {}) {
  const input: CreateDownpaymentInvoiceInput = createDownpaymentInvoiceSchema.parse(rawInput);
  const now = opts.now ?? new Date();
  const actor = opts.actor ?? "system";

  return dbInternal.$transaction(async (tx: Prisma.TransactionClient) => {
    const quote = await tx.quote.findFirst({ where: { id: input.sourceId, orgId }, include: { lines: { orderBy: { position: "asc" } } } });
    if (!quote) throw new NotFoundError(`Angebot/Auftragsbestaetigung ${input.sourceId} nicht gefunden.`);
    if (!QUOTE_KINDS_ALLOWED.has(quote.kind)) {
      throw new DownpaymentInvoiceError(`Nur ein Angebot/eine Auftragsbestaetigung kann Quelle einer Abschlagsrechnung sein (kind: ${quote.kind}).`);
    }
    if (!QUOTE_STATUS_ALLOWED.has(quote.status)) {
      throw new DownpaymentInvoiceError(`Angebot/Auftragsbestaetigung im Status "${quote.status}" kann nicht angezahlt werden.`);
    }

    // Kein Mischen von Teil- und Abschlagsrechnungen auf derselben Quelle (Ruling).
    // B13 (Fix-Welle): tx statt dbInternal — die Mischverbots-/100-%-Guards lesen
    // damit innerhalb derselben Transaktion, in der auch geschrieben wird.
    const relations = await listRelations(orgId, "QUOTE", input.sourceId, tx);
    const hasPartial = relations.some((r) => r.fromType === "INVOICE" && r.toType === "QUOTE" && r.toId === input.sourceId && r.relationType === "PARTIAL_OF");
    if (hasPartial) {
      throw new DownpaymentInvoiceError("Auf dieser Quelle bestehen bereits Teilrechnungen — Teil- und Abschlagsrechnungen koennen nicht gemischt werden.");
    }

    // Fix-Runde 2 (Ruling Koordinator): Anteilsbasis ist die Gesamtleistung NACH
    // Beleg-Rabatt/-Aufschlag der Quelle, nicht die rohen Positionsbetraege — sonst
    // wuerde z. B. eine 30 %-Abschlagsrechnung bei einer Quelle mit Beleg-Rabatt einen
    // zu hohen Betrag ausweisen (die 100-%-Grenze verglich ohnehin bereits
    // quote.grossTotalCents, war also inkonsistent zur Bucket-Basis).
    const itemLines = quote.lines.filter((l) => l.lineType === "ITEM");
    const adjustedTotals = computeTaxBreakdown(
      itemLines.map((l) => ({ lineNetCents: l.lineNetCents, taxRate: l.taxRate, taxCategory: l.taxCategory })),
      {
        discountPermille: quote.documentDiscountPermille,
        discountCents: quote.documentDiscountCents,
        chargePermille: quote.documentChargePermille,
        chargeCents: quote.documentChargeCents,
      },
    );
    if (adjustedTotals.breakdown.length === 0) throw new DownpaymentInvoiceError("Die Quelle enthaelt keine abrechenbaren Positionen.");
    const buckets: RateBucket[] = adjustedTotals.breakdown.map((b) => ({
      key: `${b.taxCategory}:${b.taxRate}`,
      taxCategory: b.taxCategory,
      taxRate: b.taxRate,
      netCents: b.netCents,
    }));

    const share = input.mode === "PERCENT" ? { permille: input.permille! } : { amountCents: input.amountCents!, isGross: input.amountIsGross };
    let splits: TaxRateSplit[];
    try {
      splits = splitByTaxRate(buckets, share);
    } catch (e) {
      if (e instanceof PricingError) throw new DownpaymentInvoiceError(e.message);
      throw e;
    }

    const newGrossCents = splits.reduce((s, sp) => s + sp.grossCents, 0);

    // Nur festgeschriebene, nicht stornierte Abschlaege zaehlen fuer die 100-%-Grenze
    // (Ruling Task-2-Facts) — Entwuerfe werden erst beim Festschreiben erneut geprueft.
    const downpaymentIds = relations
      .filter((r) => r.fromType === "INVOICE" && r.toType === "QUOTE" && r.toId === input.sourceId && r.relationType === "DOWNPAYMENT_OF")
      .map((r) => r.fromId);
    const existingFinalized = downpaymentIds.length
      ? await tx.invoice.findMany({ where: { id: { in: downpaymentIds }, orgId, status: { in: [...FINALIZED_STATUSES] } }, select: { grossTotalCents: true } })
      : [];
    const existingGrossCents = existingFinalized.reduce((s, i) => s + i.grossTotalCents, 0);

    // B14 (Fix-Welle): dieselbe Basis wie die Bucket-Aufteilung selbst
    // (`adjustedTotals.grossTotalCents`, oben) statt der separat gelesenen
    // `quote.grossTotalCents`-Spalte — beide sollten im Normalfall identisch sein, aber
    // `partial.ts` wurde in Fix-Runde 2 bewusst auf die berechnete Basis umgestellt, um
    // genau diese Inkonsistenzquelle auszuschliessen (Ruling Koordinator: Konsistenz).
    const sourceGrossCents = adjustedTotals.grossTotalCents;
    if (existingGrossCents + newGrossCents > sourceGrossCents) {
      throw new DownpaymentInvoiceError(
        `Die Summe der Abschlaege (${existingGrossCents + newGrossCents} Cent) wuerde die Gesamtleistung (${sourceGrossCents} Cent) uebersteigen.`,
      );
    }

    const label =
      input.mode === "PERCENT"
        ? `Abschlag ${formatPermilleDE(input.permille!)} % auf ${quote.number}`
        : `Abschlag ${formatCents(input.amountCents!)} ${input.amountIsGross ? "brutto" : "netto"} auf ${quote.number}`;

    const lines = splits.filter((s) => s.netCents > 0 || s.taxCents > 0);
    if (lines.length === 0) throw new DownpaymentInvoiceError("Der berechnete Abschlag ergibt keine abrechenbare Position (Betrag 0).");

    const createInput: CreateInvoiceInput = {
      customerId: quote.customerId,
      type: "DOWNPAYMENT",
      taxScheme: quote.taxScheme as CreateInvoiceInput["taxScheme"],
      currency: quote.currency,
      // Leistungszeitpunkt (§14 Abs.4 Nr.6): Quote fuehrt kein eigenes Lieferdatum —
      // Ersatzweise das Anlagedatum (analog createPartialInvoice).
      deliveryDate: now,
      headerText: quote.headerText ?? undefined,
      footerText: quote.footerText ?? undefined,
      paymentTerms: quote.paymentTerms ?? undefined,
      documentDiscountPermille: 0,
      documentDiscountCents: 0,
      documentChargePermille: 0,
      documentChargeCents: 0,
      lines: lines.map((s) => ({
        lineType: "ITEM",
        description: label,
        quantityMilli: 1000,
        unit: "C62",
        unitNetPriceCents: s.netCents,
        taxRate: s.taxRate as CreateInvoiceInput["lines"][number]["taxRate"],
        taxCategory: s.taxCategory as CreateInvoiceInput["lines"][number]["taxCategory"],
        discountPermille: 0,
        discountCents: 0,
      })),
    };

    const invoice = await createDraftInvoiceWithinTx(tx, orgId, createInput, { actor, now });

    await tx.invoice.update({
      where: { id: invoice.id },
      data: { sourceType: "QUOTE", sourceId: input.sourceId, partialPermille: input.mode === "PERCENT" ? input.permille! : null },
    });

    await linkDocuments(tx, { orgId, fromType: "INVOICE", fromId: invoice.id, toType: "QUOTE", toId: input.sourceId, relationType: "DOWNPAYMENT_OF" });

    if (quote.status === "DRAFT" || quote.status === "SENT") {
      await setQuoteStatusWithinTx(tx, orgId, input.sourceId, "ACCEPTED", { actor, now });
    }

    await appendChangeLog(tx, {
      orgId,
      entity: "INVOICE",
      entityId: invoice.id,
      action: "DOWNPAYMENT_INVOICE_CREATE",
      actor,
      at: now,
      diff: { sourceId: input.sourceId, mode: input.mode },
    });

    return tx.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { lines: { orderBy: { position: "asc" } } } });
  });
}
