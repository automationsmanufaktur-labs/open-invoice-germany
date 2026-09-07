/**
 * Teilgutschrift / Teilerstattung: eine festgeschriebene Rechnung wird NICHT
 * komplett storniert, sondern es wird eine Gutschrift über die angegebenen
 * (Teil-)Positionen erzeugt. Das Original bleibt vollständig erhalten und
 * behält seinen Status (für Voll-Storno siehe cancelInvoice).
 */
import { dbInternal } from "@/lib/db";
import { roundHalfUp } from "@/lib/money";
import { computeLineNet } from "@/lib/pricing/line";
import { appendChangeLog } from "@/domain/audit";
import { linkDocuments } from "@/domain/relations";
import { finalizeWithinTx } from "./finalize";

export class CreditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreditError";
  }
}

export interface PartialCreditLine {
  description: string;
  quantityMilli: number;
  unit?: string;
  unitNetPriceCents: number; // positiv angegeben; intern negiert
  taxRate: number;
  taxCategory: string;
}

export interface PartialCreditInput {
  lines: PartialCreditLine[];
  notes?: string;
}

/**
 * Verteilt einen Beleg-Festbetrag (documentDiscountCents/documentChargeCents) proportional
 * zum Verhaeltnis von Teilgutschrift-Positionsnetto zu Original-Positionsnetto (Ruling
 * Fix-Runde 1, Koordinator): `round(amountCents * creditLineTotal / originalLineTotal)`.
 * Ist `originalLineTotal` 0 (z. B. reine 0%-Rechnung), ist das Ergebnis 0 — es gibt keine
 * sinnvolle Bezugsgroesse fuer die Aufteilung. Prozentwerte (…Permille) werden davon NICHT
 * beruehrt und bleiben unveraendert (sie wirken bereits proportional auf die neue Basis).
 */
function proportionalCents(amountCents: number, creditLineTotal: number, originalLineTotal: number): number {
  if (originalLineTotal === 0) return 0;
  return roundHalfUp((amountCents * creditLineTotal) / originalLineTotal);
}

export async function createPartialCreditNote(
  invoiceId: string,
  input: PartialCreditInput,
  opts: { actor?: string; now?: Date } = {},
) {
  const now = opts.now ?? new Date();
  const actor = opts.actor ?? "system";

  if (input.lines.length === 0) throw new CreditError("Mindestens eine Position erforderlich.");

  return dbInternal.$transaction(async (tx) => {
    const original = await tx.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true, orgId: true, customerId: true, number: true, taxScheme: true, currency: true, status: true, type: true,
        sellerSnapshotJson: true, buyerSnapshotJson: true,
        documentDiscountPermille: true, documentDiscountCents: true,
        documentChargePermille: true, documentChargeCents: true, documentChargeReason: true,
        lines: { select: { lineNetCents: true } },
      },
    });
    if (!original) throw new CreditError("Rechnung nicht gefunden.");
    if (original.status === "DRAFT") throw new CreditError("Nur festgeschriebene Rechnungen können (teil-)gutgeschrieben werden.");
    if (original.type === "CREDIT_NOTE") throw new CreditError("Eine Gutschrift kann nicht gutgeschrieben werden.");

    // Original-Positionsnetto VOR Beleganpassung (= taxBreakdown.lineTotalCents beim
    // Festschreiben) — Bezugsgroesse fuer die proportionale Aufteilung der Festbetraege.
    const originalLineTotal = original.lines.reduce((s, l) => s + l.lineNetCents, 0);

    const lineNetPosValues = input.lines.map((l) => computeLineNet({ quantityMilli: l.quantityMilli, unitNetPriceCents: Math.abs(l.unitNetPriceCents) }).lineNetCents);
    const creditLineTotal = lineNetPosValues.reduce((s, v) => s + v, 0);
    const creditLines = input.lines.map((l, i) => {
      const unitPos = Math.abs(l.unitNetPriceCents);
      const lineNetPos = lineNetPosValues[i];
      return {
        position: i + 1,
        description: l.description,
        quantityMilli: l.quantityMilli,
        unit: l.unit ?? "C62",
        unitNetPriceCents: -unitPos,
        taxRate: l.taxRate,
        taxCategory: l.taxCategory,
        discountPermille: 0,
        discountCents: 0,
        lineNetCents: -lineNetPos,
      };
    });

    const documentDiscountCents = proportionalCents(original.documentDiscountCents, creditLineTotal, originalLineTotal);
    const documentChargeCents = proportionalCents(original.documentChargeCents, creditLineTotal, originalLineTotal);

    const credit = await tx.invoice.create({
      data: {
        orgId: original.orgId,
        customerId: original.customerId,
        type: "CREDIT_NOTE",
        status: "DRAFT",
        taxScheme: original.taxScheme,
        currency: original.currency,
        issueDate: now,
        notes: `Teilgutschrift zu Rechnung ${original.number}.${input.notes ? " " + input.notes : ""}`,
        correctsInvoiceId: original.id,
        // Prozentwerte unveraendert uebernehmen (applyDocumentAdjustments ist vorzeichen-
        // invariant, siehe Ruling Task-1-Review); Festbetraege proportional zum Verhaeltnis
        // Teilgutschrift-/Original-Positionsnetto (Ruling Fix-Runde 1).
        documentDiscountPermille: original.documentDiscountPermille,
        documentDiscountCents,
        documentChargePermille: original.documentChargePermille,
        documentChargeCents,
        documentChargeReason: original.documentChargeReason,
        lines: {
          create: creditLines,
        },
      },
    });

    const finalized = await finalizeWithinTx(tx, credit.id, {
      actor,
      now,
      // Teilgutschrift berichtigt genau die Original-Rechnung: gleicher Empfaenger/Verkaeufer wie dort.
      inheritSnapshotFrom: { sellerSnapshotJson: original.sellerSnapshotJson, buyerSnapshotJson: original.buyerSnapshotJson },
    });

    await linkDocuments(tx, { orgId: original.orgId, fromType: "INVOICE", fromId: finalized.id, toType: "INVOICE", toId: original.id, relationType: "CORRECTS" });

    await appendChangeLog(tx, {
      orgId: original.orgId,
      entity: "INVOICE",
      entityId: original.id,
      action: "UPDATE",
      actor,
      at: now,
      diff: { partialCreditNote: finalized.number, grossTotalCents: finalized.grossTotalCents },
    });

    return { originalId: original.id, originalNumber: original.number, creditNote: finalized };
  });
}
