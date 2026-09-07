/**
 * Festschreiben einer Rechnung (DRAFT → FINALIZED).
 *
 * Reihenfolge in EINER Transaktion:
 *   1. Pflichtangaben prüfen (§ 14 UStG)  → bei Fehlern Abbruch, Nummer wird NICHT vergeben
 *   2. Summen + Steueraufschlüsselung neu berechnen (Snapshot)
 *   3. Belegnummer transaktional aus dem Nummernkreis vergeben (lückenlos, kein "Loch" durch Entwürfe)
 *   4. Status auf FINALIZED, Nummer + finalizedAt setzen
 *   5. FINALIZE-Eintrag in die Hash-Chain
 *
 * Nach dem Festschreiben blockt der Guard in src/lib/db.ts jede direkte Änderung.
 */
import { Prisma } from "@/generated/prisma/client";
import { dbInternal } from "@/lib/db";
import { computeTaxBreakdown, type TaxBreakdownEntry } from "@/lib/tax";
import { defaultPrefix, formatDocumentNumber } from "@/domain/numbering";
import { appendChangeLog } from "@/domain/audit";
import { buildSellerSnapshot, buildBuyerSnapshot } from "@/domain/snapshot";
import { deductionsFor, type DeductionInput } from "@/lib/pricing/partial";
import { PricingError } from "@/lib/pricing/errors";
import type { RateBucket } from "@/lib/pricing/allocate";
import type { SnapshotSource } from "@/schemas";
import { validateMandatoryFields } from "./mandatory";

const FINALIZED_DOWNPAYMENT_STATUSES = new Set(["FINALIZED", "SENT", "PARTIALLY_PAID", "PAID"]);

export class FinalizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinalizeError";
  }
}

export interface FinalizeOptions {
  actor?: string;
  now?: Date;
  /** Kleinbetragsrechnung (§ 33 UStDV, ≤ 250 € brutto) — reduzierte Pflichtangaben. */
  isSmallAmount?: boolean;
  /**
   * Storno/Teilgutschrift: Snapshot des Originalbelegs unveraendert uebernehmen statt
   * aus dem aktuellen Stamm neu zu bauen. Ein Korrekturbeleg (Storno, Teilgutschrift)
   * berichtigt genau das Original — er muss denselben Empfaenger/Verkaeufer nennen wie
   * dieses, auch wenn sich die Stammdaten zwischenzeitlich geaendert haben. Nur wirksam,
   * wenn BEIDE Werte gesetzt sind; sonst greift der bisherige Live-Pfad (Herkunft FINALIZE).
   */
  inheritSnapshotFrom?: { sellerSnapshotJson: string | null; buyerSnapshotJson: string | null };
}

export async function finalizeWithinTx(
  tx: Prisma.TransactionClient,
  invoiceId: string,
  opts: FinalizeOptions = {},
) {
  const now = opts.now ?? new Date();
  const actor = opts.actor ?? "system";

  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    include: { lines: { orderBy: { position: "asc" } }, org: true, customer: true, paymentMethod: true },
  });
  if (!invoice) throw new FinalizeError("Rechnung nicht gefunden.");
  if (invoice.status !== "DRAFT")
    throw new FinalizeError(`Nur Entwürfe können festgeschrieben werden (Status: ${invoice.status}).`);

  // 1) Pflichtangaben
  const problems = validateMandatoryFields({
    type: invoice.type,
    taxScheme: invoice.taxScheme,
    issueDate: invoice.issueDate ?? now,
    deliveryDate: invoice.deliveryDate,
    deliveryStart: invoice.deliveryStart,
    deliveryEnd: invoice.deliveryEnd,
    notes: invoice.notes,
    isSmallAmount: opts.isSmallAmount,
    lines: invoice.lines.map((l) => ({
      description: l.description,
      quantityMilli: l.quantityMilli,
      taxRate: l.taxRate,
      taxCategory: l.taxCategory,
      lineType: l.lineType,
    })),
    org: invoice.org,
    customer: invoice.customer,
  });
  if (problems.length > 0) {
    throw new FinalizeError("Pflichtangaben unvollständig:\n- " + problems.join("\n- "));
  }

  // 2) Summen-Snapshot. Nicht-ITEM-Zeilen (HEADING/TEXT/SUBTOTAL) gehen nie in Summen/
  // Steuerberechnung ein (§8) — sie tragen zwar bereits lineNetCents=0/taxRate=0
  // (normalizeLines), koennten aber ohne Filter eine zusaetzliche 0-Betrags-Steuergruppe
  // fuer ihre (unveraenderte) taxCategory erzeugen (Fix-Welle, K1).
  const itemLinesForTotals = invoice.lines.filter((l) => l.lineType === "ITEM");
  const totals = computeTaxBreakdown(
    itemLinesForTotals.map((l) => ({ lineNetCents: l.lineNetCents, taxRate: l.taxRate, taxCategory: l.taxCategory })),
    {
      discountPermille: invoice.documentDiscountPermille,
      discountCents: invoice.documentDiscountCents,
      chargePermille: invoice.documentChargePermille,
      chargeCents: invoice.documentChargeCents,
    },
  );

  // Snapshot der Zahlungsmethode (Phase 4a): ab jetzt bleibt der zum Festschreibungs-
  // zeitpunkt gewaehlte Zahlungsweg unveraendert, auch wenn sich die Stammdaten der
  // Zahlungsmethode spaeter aendern (gleiches Prinzip wie Seller-/Buyer-Snapshot).
  const paymentMethodSnapshotJson = invoice.paymentMethod
    ? JSON.stringify({
        code: invoice.paymentMethod.code,
        name: invoice.paymentMethod.name,
        invoiceText: invoice.paymentMethod.invoiceText,
        untdidCode: invoice.paymentMethod.untdidCode,
        bankIban: invoice.paymentMethod.bankIban,
        bankBic: invoice.paymentMethod.bankBic,
        bankName: invoice.paymentMethod.bankName,
      })
    : null;

  // Parteien-Snapshot (Phase 0): ab jetzt rendern PDF/XML aus diesem Stand.
  // Storno/Teilgutschrift erben den Snapshot des Originals (siehe FinalizeOptions.inheritSnapshotFrom),
  // damit der Korrekturbeleg denselben Empfaenger/Verkaeufer nennt wie das Original.
  const inherited = opts.inheritSnapshotFrom;
  const canInherit = !!inherited?.sellerSnapshotJson && !!inherited?.buyerSnapshotJson;
  const sellerSnapshotJson = canInherit ? inherited!.sellerSnapshotJson : JSON.stringify(buildSellerSnapshot(invoice.org));
  const buyerSnapshotJson = canInherit ? inherited!.buyerSnapshotJson : JSON.stringify(buildBuyerSnapshot(invoice.customer));
  const snapshotSource: SnapshotSource = canInherit ? "INHERITED" : "FINALIZE";

  // 2b) Phase 5 (§14 Abs.5 S.2 UStG): Schlussrechnung -> Abzugs-Snapshot je Abschlagsrechnung/
  // Steuersatz. Laeuft VOR dem Claim, damit eine unzulaessige Ueberdeckung (Abschlaege >
  // Gesamtleistung je Satz) die Rechnung nicht festschreibt und keine Nummer verbraucht.
  let prepaidCents = 0;
  let payableCents: number | null = null;
  let finalDeductionRows: Array<{
    downpaymentInvoiceId: string;
    number: string;
    issueDate: Date;
    netCents: number;
    taxCents: number;
    grossCents: number;
    taxRate: number;
    taxCategory: string;
  }> = [];

  if (invoice.type === "FINAL") {
    if (!invoice.sourceId) throw new FinalizeError("Schlussrechnung ohne Quellangebot kann nicht festgeschrieben werden.");

    const downpaymentRelations = await tx.documentRelation.findMany({
      where: { orgId: invoice.orgId, relationType: "DOWNPAYMENT_OF", fromType: "INVOICE", toType: "QUOTE", toId: invoice.sourceId },
    });
    const downpaymentIds = downpaymentRelations.map((r) => r.fromId);
    const downpayments = downpaymentIds.length
      ? await tx.invoice.findMany({
          where: { id: { in: downpaymentIds }, orgId: invoice.orgId, status: { in: [...FINALIZED_DOWNPAYMENT_STATUSES] } },
        })
      : [];

    const deductionInputs: Array<DeductionInput & { downpaymentInvoiceId: string; number: string; issueDate: Date }> = [];
    for (const dp of downpayments) {
      const breakdown = JSON.parse(dp.taxBreakdownJson) as TaxBreakdownEntry[];
      for (const entry of breakdown) {
        deductionInputs.push({
          downpaymentInvoiceId: dp.id,
          number: dp.number!,
          issueDate: dp.issueDate,
          taxRate: entry.taxRate,
          taxCategory: entry.taxCategory,
          netCents: entry.netCents,
          taxCents: entry.taxCents,
          grossCents: entry.netCents + entry.taxCents,
        });
      }
    }

    const finalBuckets: RateBucket[] = totals.breakdown.map((b) => ({
      key: `${b.taxCategory}:${b.taxRate}`,
      taxCategory: b.taxCategory,
      taxRate: b.taxRate,
      netCents: b.netCents,
    }));

    try {
      const summary = deductionsFor(finalBuckets, deductionInputs);
      prepaidCents = summary.totalDeductedGrossCents;
    } catch (e) {
      if (e instanceof PricingError) throw new FinalizeError(`Abschlaege uebersteigen die Gesamtleistung: ${e.message}`);
      throw e;
    }

    payableCents = totals.grossTotalCents - prepaidCents;
    if (payableCents < 0) {
      throw new FinalizeError("Abschlaege uebersteigen die Gesamtleistung der Schlussrechnung.");
    }

    finalDeductionRows = deductionInputs.map((d) => ({
      downpaymentInvoiceId: d.downpaymentInvoiceId,
      number: d.number,
      issueDate: d.issueDate,
      netCents: d.netCents,
      taxCents: d.taxCents,
      grossCents: d.grossCents,
      taxRate: d.taxRate,
      taxCategory: d.taxCategory,
    }));
  }

  // 3) Atomarer Status-Claim: nur wenn noch DRAFT. Verhindert unter Nebenläufigkeit
  //    (Postgres READ COMMITTED) doppelte Festschreibung + doppelten Nummern-Verbrauch.
  const claim = await tx.invoice.updateMany({
    where: { id: invoiceId, status: "DRAFT" },
    data: {
      status: "FINALIZED",
      finalizedAt: now,
      issueDate: invoice.issueDate ?? now,
      netTotalCents: totals.netTotalCents,
      taxTotalCents: totals.taxTotalCents,
      grossTotalCents: totals.grossTotalCents,
      taxBreakdownJson: JSON.stringify(totals.breakdown),
      sellerSnapshotJson,
      buyerSnapshotJson,
      snapshotSource,
      snapshotAt: now,
      paymentMethodSnapshotJson,
      ...(invoice.type === "FINAL" ? { prepaidCents, payableCents } : {}),
    },
  });
  if (claim.count === 0) {
    throw new FinalizeError("Rechnung wurde zwischenzeitlich bereits festgeschrieben.");
  }

  if (finalDeductionRows.length > 0) {
    await tx.finalInvoiceDeduction.createMany({
      data: finalDeductionRows.map((r) => ({ finalInvoiceId: invoiceId, ...r })),
    });
  }

  // 4) Nummer ERST nach gewonnenem Claim vergeben -> der Verlierer verbraucht keine Nummer (kein Loch).
  const docType = invoice.type === "CREDIT_NOTE" ? "CREDIT_NOTE" : "INVOICE";
  const year = now.getFullYear();
  const range = await tx.numberRange.upsert({
    where: { orgId_docType_year: { orgId: invoice.orgId, docType, year } },
    create: { orgId: invoice.orgId, docType, year, currentValue: 1, prefix: defaultPrefix(docType) },
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
  await tx.invoice.update({ where: { id: invoiceId }, data: { number } });

  // 5) Audit
  await appendChangeLog(tx, {
    orgId: invoice.orgId,
    entity: "INVOICE",
    entityId: invoiceId,
    action: "FINALIZE",
    actor,
    at: now,
    diff: {
      number,
      status: "FINALIZED",
      grossTotalCents: totals.grossTotalCents,
      snapshotSource,
      // B9 (Fix-Welle): der Abzugs-Snapshot ist der rechtlich entscheidende Teil einer
      // Schlussrechnung (Abschn. 14.8 UStAE) — er gehoert in die Hash-Kette, nicht nur
      // in die (davon unabhaengige) `FinalInvoiceDeduction`-Tabelle. Nur bei type FINAL
      // nicht-leer; bei allen anderen Rechnungstypen bleiben es leere Defaults.
      ...(invoice.type === "FINAL"
        ? { prepaidCents, payableCents, deductedInvoiceNumbers: finalDeductionRows.map((r) => r.number) }
        : {}),
    },
  });

  const result = await tx.invoice.findUnique({
    where: { id: invoiceId },
    include: { lines: { orderBy: { position: "asc" } }, org: true, customer: true },
  });
  return result!;
}

export async function finalizeInvoice(invoiceId: string, opts: FinalizeOptions = {}) {
  return dbInternal.$transaction((tx) => finalizeWithinTx(tx, invoiceId, opts));
}
