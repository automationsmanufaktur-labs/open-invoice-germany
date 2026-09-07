/**
 * Storno einer festgeschriebenen Rechnung.
 *
 * GoBD-konform: Das Original bleibt UNVERÄNDERT erhalten. Es wird eine
 * betragsspiegelbildliche Storno-Gutschrift (type=CREDIT_NOTE) mit eigener
 * Nummer aus dem Kreis angelegt und festgeschrieben; das Original erhält den
 * Status CANCELLED und einen Verweis auf die Gutschrift (§ 31 Abs. 5 UStDV).
 */
import { dbInternal } from "@/lib/db";
import type { TaxBreakdownEntry } from "@/lib/tax";
import { reconcileNetsForGross } from "@/lib/pricing/partial";
import { appendChangeLog } from "@/domain/audit";
import { logActivity } from "@/domain/activity/log";
import { linkDocuments } from "@/domain/relations";
import { finalizeWithinTx } from "./finalize";

/** Zeilentypen, die keinen Betrag tragen (§8: HEADING/TEXT/SUBTOTAL nie in Summen/XML). */
const NON_ITEM_LINE_TYPES = new Set(["HEADING", "TEXT", "SUBTOTAL"]);

interface StornoCreateLine {
  position: number;
  lineType: string;
  productId: string | null;
  description: string;
  descriptionLong: string | null;
  articleNumber: string | null;
  quantityMilli: number;
  unit: string;
  unitNetPriceCents: number;
  taxRate: number;
  taxCategory: string;
  discountPermille: number;
  discountCents: number;
  lineNetCents: number;
}

/**
 * Storno-Zeilen fuer eine normale (nicht FINAL) Rechnung: betragsspiegelbildliches
 * 1:1-Abbild aller Original-Zeilen (Zeilentyp/Langtext/Artikelnummer erhalten, damit die
 * Struktur der Rechnung im Storno erkennbar bleibt — §8).
 */
function mirrorLines(original: { lines: readonly { position: number; lineType: string; productId: string | null; description: string; descriptionLong: string | null; articleNumber: string | null; quantityMilli: number; unit: string; unitNetPriceCents: number; taxRate: number; taxCategory: string; discountPermille: number; discountCents: number; lineNetCents: number }[] }): StornoCreateLine[] {
  return original.lines.map((l) => {
    const isItem = !NON_ITEM_LINE_TYPES.has(l.lineType);
    return {
      position: l.position,
      lineType: l.lineType,
      productId: l.productId,
      description: l.description,
      descriptionLong: l.descriptionLong,
      articleNumber: l.articleNumber,
      quantityMilli: l.quantityMilli,
      unit: l.unit,
      unitNetPriceCents: isItem ? -l.unitNetPriceCents : 0,
      taxRate: l.taxRate,
      taxCategory: l.taxCategory,
      discountPermille: l.discountPermille,
      discountCents: l.discountCents,
      lineNetCents: isItem ? -l.lineNetCents : 0,
    };
  });
}

/**
 * Storno-Zeilen fuer eine FINAL-Rechnung (Fix-Runde 1, MEDIUM — Ruling Koordinator):
 * GENAU EINE Summenzeile je Steuersatz/-kategorie, nicht die gespiegelten
 * Gesamtleistungs-Zeilen zzgl. Ausgleichszeilen (das fuehrte bei einem Beleg-Rabatt/
 * -Aufschlag mit mehreren Steuersaetzen zu gemischten Vorzeichen je Bucket und liess
 * `applyDocumentAdjustments` mit einem PricingError abbrechen). Je Satz:
 *   net = -(rateNetAfterAdjustments - deductedNetForRate)
 *   tax = -(rateTaxAfterAdjustments - deductedTaxForRate)
 * `rateNetAfterAdjustments`/`rateTaxAfterAdjustments` kommen direkt aus dem beim
 * Festschreiben der Schlussrechnung gespeicherten `taxBreakdownJson` (bereits NACH
 * Beleg-Rabatt/-Aufschlag) — `deductedNetForRate`/`deductedTaxForRate` aus den
 * `FinalInvoiceDeduction`-Zeilen (Snapshot, wird NICHT kopiert/dupliziert, nur deren
 * Betraege fliessen als Abzug ein). Summe ueber alle Zeilen ergibt exakt
 * `-payableCents`; das Storno-Dokument selbst traegt documentDiscount/Charge = 0, weil
 * die Beleganpassung bereits in den Bucket-Betraegen steckt.
 */
function finalStornoLines(original: {
  number: string | null;
  taxBreakdownJson: string;
  payableCents: number | null;
  finalDeductions: readonly { taxRate: number; taxCategory: string; netCents: number; taxCents: number }[];
}): StornoCreateLine[] {
  const breakdown = JSON.parse(original.taxBreakdownJson) as TaxBreakdownEntry[];

  const deductedByRate = new Map<string, { netCents: number; taxCents: number }>();
  for (const d of original.finalDeductions) {
    const key = `${d.taxCategory}:${d.taxRate}`;
    const acc = deductedByRate.get(key) ?? { netCents: 0, taxCents: 0 };
    acc.netCents += d.netCents;
    acc.taxCents += d.taxCents;
    deductedByRate.set(key, acc);
  }

  const description = `Storno Schlussrechnung ${original.number} – Restbetrag nach Abzug der Abschlagsrechnungen`;

  // B6 (Fix-Welle): `entry.netCents - deducted.netCents` allein garantiert NICHT, dass
  // die Summe der Storno-Zeilen nach der erneuten Steuerberechnung beim Festschreiben
  // des Stornos (`finalizeWithinTx` -> `computeTaxBreakdown`) exakt `-payableCents`
  // ergibt — zwei unabhaengig gerundete Steuerbetraege (Schlussrechnung je Satz,
  // Abschlaege je Satz) muessen sich nicht zur selben Rundung addieren (Rechenbeispiel:
  // Ruling-Findung B6). `reconcileNetsForGross` (siehe src/lib/pricing/partial.ts,
  // gemeinsamer Helper mit B5/GROSS_AMOUNT) verschiebt bei Bedarf EIN Steuersatz-Bucket
  // um ±1 Cent Netto, damit die Summe wieder exakt `payableCents` trifft. Bei GENAU
  // EINEM Steuersatz ist das rechnerisch nicht immer moeglich (kein zweiter Bucket zum
  // Ausgleich) — die kleinstmoegliche Abweichung (i. d. R. ±1 Cent) bleibt dann bestehen
  // (dokumentierte Ausnahme, docs/LIMITATIONEN.md, ARCHITEKTUR.md).
  const naiveNets = breakdown.map((entry) => {
    const key = `${entry.taxCategory}:${entry.taxRate}`;
    const deducted = deductedByRate.get(key) ?? { netCents: 0, taxCents: 0 };
    return entry.netCents - deducted.netCents;
  });
  const targetGrossCents = original.payableCents ?? 0;
  const reconciledNets = reconcileNetsForGross(
    breakdown.map((entry, i) => ({ netCents: naiveNets[i], taxRate: entry.taxRate })),
    targetGrossCents,
  );

  return breakdown.map((entry, i) => {
    const remainingNetCents = reconciledNets[i];
    return {
      position: i + 1,
      lineType: "ITEM",
      productId: null,
      description,
      descriptionLong: null,
      articleNumber: null,
      quantityMilli: 1000,
      unit: "C62",
      unitNetPriceCents: -remainingNetCents,
      taxRate: entry.taxRate,
      taxCategory: entry.taxCategory,
      discountPermille: 0,
      discountCents: 0,
      lineNetCents: -remainingNetCents,
    };
  });
}

export class CancelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CancelError";
  }
}

export interface CancelOptions {
  actor?: string;
  now?: Date;
}

export async function cancelInvoice(invoiceId: string, opts: CancelOptions = {}) {
  const now = opts.now ?? new Date();
  const actor = opts.actor ?? "system";

  return dbInternal.$transaction(async (tx) => {
    const original = await tx.invoice.findUnique({
      where: { id: invoiceId },
      include: { lines: { orderBy: { position: "asc" } }, finalDeductions: true },
    });
    if (!original) throw new CancelError("Rechnung nicht gefunden.");
    if (original.status === "DRAFT") throw new CancelError("Entwürfe werden gelöscht, nicht storniert.");
    if (original.status === "CANCELLED") throw new CancelError("Rechnung ist bereits storniert.");
    if (original.type === "CREDIT_NOTE") throw new CancelError("Eine Gutschrift/Storno kann nicht erneut storniert werden.");

    // Phase 5 (Fix-Runde 1, MEDIUM — Ruling Koordinator): Storno einer Schlussrechnung
    // erstattet nur den tatsaechlich offenen Rest (payableCents), nicht die volle
    // Gesamtleistung — als GENAU EINE Summenzeile je Steuersatz (finalStornoLines), NICHT
    // als gespiegelte Gesamtleistungs-Zeilen zzgl. separater Ausgleichszeilen (das ergab
    // bei Beleg-Rabatt/-Aufschlag mit mehreren Steuersaetzen gemischte Vorzeichen je Bucket
    // und liess applyDocumentAdjustments abbrechen). documentDiscount/Charge = 0 auf dem
    // Storno-Dokument, weil die Beleganpassung bereits im taxBreakdownJson eingepreist ist.
    const isFinalStorno = original.type === "FINAL";
    const stornoLines = isFinalStorno ? finalStornoLines(original) : mirrorLines(original);

    const credit = await tx.invoice.create({
      data: {
        orgId: original.orgId,
        customerId: original.customerId,
        type: "CREDIT_NOTE",
        status: "DRAFT",
        taxScheme: original.taxScheme,
        currency: original.currency,
        issueDate: now,
        deliveryDate: original.deliveryDate,
        deliveryStart: original.deliveryStart,
        deliveryEnd: original.deliveryEnd,
        buyerReference: original.buyerReference,
        notes: `Storno zu Rechnung ${original.number}.${original.notes ? " " + original.notes : ""}`,
        paymentTerms: original.paymentTerms,
        correctsInvoiceId: original.id,
        // Phase 5: Verweis auf dieselbe Quelle wie das Original (PARTIAL/DOWNPAYMENT/FINAL) —
        // rein informativ (denormalisierter Schnellzugriff, keine eigene Relation).
        sourceType: original.sourceType,
        sourceId: original.sourceId,
        // Beleg-Rabatt/-Aufschlag: bei FINAL-Storno bewusst 0 (bereits in finalStornoLines
        // eingepreist, siehe dort); sonst unveraendert (positiv) uebernommen —
        // applyDocumentAdjustments ist vorzeichen-invariant und rechnet bei ausschliesslich
        // negativen Zeilen-Buckets auf den negierten (positiven) Betraegen wie im Original
        // (Ruling Task-1-Review).
        documentDiscountPermille: isFinalStorno ? 0 : original.documentDiscountPermille,
        documentDiscountCents: isFinalStorno ? 0 : original.documentDiscountCents,
        documentChargePermille: isFinalStorno ? 0 : original.documentChargePermille,
        documentChargeCents: isFinalStorno ? 0 : original.documentChargeCents,
        documentChargeReason: isFinalStorno ? null : original.documentChargeReason,
        // Betragsspiegelbild: negierte Betraege, damit Original + Storno = 0 ergibt
        // (bei FINAL: Summe = -payableCents, siehe finalStornoLines). Zeilentyp/Langtext/
        // Artikelnummer bei einer normalen Rechnung 1:1 uebernommen (§8: die Struktur bleibt
        // im Storno erkennbar); bei FINAL eine Summenzeile je Steuersatz (siehe oben).
        lines: {
          create: stornoLines,
        },
      },
    });

    const finalizedCredit = await finalizeWithinTx(tx, credit.id, {
      actor,
      now,
      // Storno berichtigt genau das Original: gleicher Empfaenger/Verkaeufer wie dort.
      inheritSnapshotFrom: { sellerSnapshotJson: original.sellerSnapshotJson, buyerSnapshotJson: original.buyerSnapshotJson, contactSnapshotJson: original.contactSnapshotJson },
    });

    await tx.invoice.update({
      where: { id: original.id },
      data: { status: "CANCELLED", reversedByInvoiceId: finalizedCredit.id },
    });

    await linkDocuments(tx, { orgId: original.orgId, fromType: "INVOICE", fromId: finalizedCredit.id, toType: "INVOICE", toId: original.id, relationType: "REVERSES" });
    await linkDocuments(tx, { orgId: original.orgId, fromType: "INVOICE", fromId: finalizedCredit.id, toType: "INVOICE", toId: original.id, relationType: "CORRECTS" });

    await appendChangeLog(tx, {
      orgId: original.orgId,
      entity: "INVOICE",
      entityId: original.id,
      action: "CANCEL",
      actor,
      at: now,
      diff: { status: "CANCELLED", reversedBy: finalizedCredit.number },
    });
    await logActivity(tx, {
      orgId: original.orgId,
      entityType: "INVOICE",
      entityId: original.id,
      type: "CANCELLED",
      actor,
      at: now,
      data: { reversedBy: finalizedCredit.number },
    });

    return { originalId: original.id, originalNumber: original.number, creditNote: finalizedCredit };
  });
}
