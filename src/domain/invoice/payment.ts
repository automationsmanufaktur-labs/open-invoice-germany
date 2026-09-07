/**
 * Zahlungseingang erfassen. Aktualisiert paidAmount + Status (PAID /
 * PARTIALLY_PAID). Voraussetzung u. a. fürs Mahnwesen (offener Betrag).
 *
 * Skonto (§ 17-Fall, Phase 4a): nach Anlage der Zahlung wird geprueft, ob sie
 * innerhalb einer Skontofrist der Rechnung liegt (detectSkonto). Trifft das zu
 * UND wurde `applySkonto: true` angefordert, wird der verbleibende offene Rest
 * automatisch als zweite Zahlung mit `method: "SKONTO"` gebucht — die Rechnung
 * gilt dann als vollstaendig beglichen, ohne dass die festgeschriebene Rechnung
 * selbst geaendert wird (GoBD). Ohne `applySkonto` bleibt der Rest offen; der
 * Aufrufer bekommt nur einen Vorschlag (`skontoSuggestion`) zurueck.
 */
import type { Prisma, Payment, Invoice } from "@/generated/prisma/client";
import { dbInternal } from "@/lib/db";
import { appendChangeLog } from "@/domain/audit";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { skontoTerms, detectSkonto, type SkontoTerm } from "@/lib/pricing/skonto";
import { payableBaseCents } from "@/domain/invoice/amounts";
import type { RecordPaymentInput } from "@/schemas";

export class PaymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentError";
  }
}

export interface RecordPaymentResult {
  /** Die Rechnung NACH der Zahlung (inkl. automatischer Skontobuchung, falls erfolgt). */
  payment: Invoice;
  /** Erkannte, aber (noch) nicht gebuchte Skontofrist — nur ohne `applySkonto`. */
  skontoSuggestion?: SkontoTerm & { restCents: number };
  /** Die zweite Zahlung (method "SKONTO"), falls der Skontoabzug gebucht wurde. */
  skontoPayment?: Payment;
}

async function resolvePaymentMethodId(tx: Prisma.TransactionClient, orgId: string, code: string): Promise<string> {
  let method = await tx.paymentMethod.findFirst({ where: { orgId, code, isActive: true }, select: { id: true } });
  if (!method) {
    // Selbstheilung: Organisationen ohne Backfill (z. B. Testfixtures) bekommen
    // die Systemstammdaten hier einmalig nachgezogen, bevor endgueltig geprueft wird.
    await ensureOrgMasterdata(tx, orgId);
    method = await tx.paymentMethod.findFirst({ where: { orgId, code, isActive: true }, select: { id: true } });
  }
  if (!method) throw new PaymentError(`Zahlungsmethode "${code}" ist nicht bekannt oder inaktiv.`);
  return method.id;
}

export async function recordPayment(
  invoiceId: string,
  input: RecordPaymentInput,
  opts: { actor?: string; now?: Date } = {},
): Promise<RecordPaymentResult> {
  const now = opts.now ?? new Date();
  const actor = opts.actor ?? "system";

  return dbInternal.$transaction(async (tx) => {
    const inv = await tx.invoice.findUnique({
      where: { id: invoiceId },
      select: {
        id: true, status: true, type: true, orgId: true, number: true,
        issueDate: true, grossTotalCents: true, paidAmountCents: true, payableCents: true,
        skonto1Permille: true, skonto1Days: true, skonto2Permille: true, skonto2Days: true,
      },
    });
    if (!inv) throw new PaymentError("Rechnung nicht gefunden.");
    if (inv.status === "DRAFT") throw new PaymentError("Zahlung erst nach dem Festschreiben erfassbar.");
    if (inv.status === "CANCELLED") throw new PaymentError("Die Rechnung ist storniert.");
    if (inv.type === "CREDIT_NOTE") throw new PaymentError("Zahlungen werden nur auf Rechnungen erfasst, nicht auf Gutschriften.");

    await resolvePaymentMethodId(tx, inv.orgId, input.method);

    const paidAt = input.paidAt ?? now;
    // Phase 5: bei einer Schlussrechnung (type FINAL) ist payableCents gesetzt
    // (grossTotalCents - prepaidCents) und ist die Bemessungsgrundlage fuer Zahlung/
    // PAID-Grenze/Skonto — sonst COALESCE auf grossTotalCents (src/domain/invoice/amounts.ts).
    const baseCents = payableBaseCents(inv);
    const openBeforeCents = baseCents - inv.paidAmountCents;

    // Ueberzahlung verhindern (Fix-Runde 1, Low-Befund): eine bereits vollstaendig
    // bezahlte Rechnung (offener Rest <= 0) nimmt keine weitere Zahlung mehr an, und eine
    // einzelne Zahlung darf den noch offenen Rest nicht uebersteigen — es entsteht kein
    // Ueberzahlungs-Datensatz.
    if (openBeforeCents <= 0) {
      throw new PaymentError("Rechnung ist bereits vollstaendig bezahlt");
    }
    if (input.amountCents > openBeforeCents) {
      throw new PaymentError(
        `Zahlung (${input.amountCents} Cent) uebersteigt den offenen Betrag (${openBeforeCents} Cent).`,
      );
    }

    const payment = await tx.payment.create({
      data: {
        invoiceId,
        amountCents: input.amountCents,
        paidAt,
        method: input.method,
        reference: input.reference ?? null,
        isSkonto: input.isSkonto,
      },
    });

    const newPaid = inv.paidAmountCents + input.amountCents;
    const status = newPaid >= baseCents ? "PAID" : "PARTIALLY_PAID";
    let updated = await tx.invoice.update({
      where: { id: invoiceId },
      data: { paidAmountCents: newPaid, status },
    });

    await appendChangeLog(tx, {
      orgId: inv.orgId,
      entity: "INVOICE",
      entityId: invoiceId,
      action: "PAYMENT",
      actor,
      at: now,
      diff: { paymentCents: input.amountCents, paidAmountCents: newPaid, status },
    });

    // Skonto-Erkennung: greift nur, solange nach dieser Zahlung noch ein Rest offen ist —
    // ein exakt/vollstaendig bezahlter Betrag hat keinen Skontoabzug mehr zu buchen.
    const result: RecordPaymentResult = { payment: updated };
    const restCents = baseCents - newPaid;

    if (restCents > 0) {
      const terms = skontoTerms({
        issueDate: inv.issueDate,
        grossTotalCents: baseCents,
        skonto1Permille: inv.skonto1Permille,
        skonto1Days: inv.skonto1Days,
        skonto2Permille: inv.skonto2Permille,
        skonto2Days: inv.skonto2Days,
      });
      const match = detectSkonto(terms, paidAt, input.amountCents, openBeforeCents);

      if (match) {
        result.skontoSuggestion = { ...match, restCents };

        if (input.applySkonto) {
          // Existenzpruefung/Selbstheilung des Systemcodes SKONTO, bevor die Zahlung mit
          // method="SKONTO" gebucht wird (gleiches Muster wie fuer die Primaerzahlung).
          await resolvePaymentMethodId(tx, inv.orgId, "SKONTO");

          const skontoPayment = await tx.payment.create({
            data: {
              invoiceId,
              amountCents: restCents,
              paidAt,
              method: "SKONTO",
              isSkonto: true,
              skontoForPaymentId: payment.id,
            },
          });

          updated = await tx.invoice.update({
            where: { id: invoiceId },
            data: { paidAmountCents: baseCents, status: "PAID" },
          });

          await appendChangeLog(tx, {
            orgId: inv.orgId,
            entity: "INVOICE",
            entityId: invoiceId,
            action: "SKONTO",
            actor,
            at: now,
            diff: { skontoCents: restCents, skontoForPaymentId: payment.id, paidAmountCents: baseCents, status: "PAID" },
          });

          result.payment = updated;
          result.skontoPayment = skontoPayment;
        }
      }
    }

    return result;
  });
}
