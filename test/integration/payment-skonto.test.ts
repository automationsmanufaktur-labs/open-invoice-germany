/**
 * Skonto-Erkennung und -Buchung bei Zahlungseingang (Phase 4a).
 *
 * Eigenes Jahr (2034) fuer die Nummernvergabe — "Invoice.number" ist global
 * @unique und test.db wird ueber die gesamte Testlaufzeit geteilt (siehe
 * Kommentar in phase1.test.ts).
 */
import { beforeAll, describe, it, expect } from "vitest";
import { dbInternal, prisma } from "@/lib/db";
import { createDraftInvoice } from "@/domain/invoice/create";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import { recordPayment, PaymentError } from "@/domain/invoice/payment";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { verifyChain, type ChainEntry } from "@/domain/changelog";
import { recordPaymentSchema, type CreateInvoiceInput } from "@/schemas";

let orgId: string;
let customerId: string;
const FIX_DATE = new Date("2034-06-09T10:00:00.000Z");

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: {
      legalName: "Skonto Test GmbH",
      addressLine1: "Hauptstr. 1",
      postalCode: "21339",
      city: "Lüneburg",
      vatId: "DE123456789",
      taxNumber: "33/123/45678",
    },
  });
  orgId = org.id;
  const customer = await dbInternal.customer.create({
    data: { orgId, name: "Kunde AG", addressLine1: "Marktplatz 2", postalCode: "20095", city: "Hamburg", type: "BUSINESS" },
  });
  customerId = customer.id;
  await ensureOrgMasterdata(dbInternal, orgId);
});

// Rechnung: 1 Stk. * 1.000,00 € = 1.000,00 € netto, 19 % USt -> 1.190,00 € brutto.
// Skonto: 2 % bei Zahlung bis 10 Tage nach Rechnungsdatum -> Skontobetrag 23,80 €,
// Zahlbetrag 1.166,20 €.
async function finalizedInvoiceWithSkonto(): Promise<{ id: string; grossTotalCents: number }> {
  const input: CreateInvoiceInput = {
    customerId,
    type: "INVOICE",
    taxScheme: "REGULAR",
    currency: "EUR",
    documentDiscountPermille: 0,
    documentDiscountCents: 0,
    documentChargePermille: 0,
    documentChargeCents: 0,
    skonto1Permille: 20,
    skonto1Days: 10,
    issueDate: FIX_DATE,
    deliveryDate: new Date("2034-06-05"),
    lines: [
      { description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 100000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 },
    ],
  } as CreateInvoiceInput;
  const draft = await createDraftInvoice(orgId, input, { now: FIX_DATE });
  const fin = await finalizeInvoice(draft.id, { now: FIX_DATE });
  return { id: fin.id, grossTotalCents: fin.grossTotalCents };
}

describe("Skonto: Erkennung und Buchung bei Zahlungseingang", () => {
  it("Zahlung des Skonto-Zahlbetrags innerhalb der Frist ohne applySkonto: nur Vorschlag, Rest bleibt offen", async () => {
    const inv = await finalizedInvoiceWithSkonto();
    const payableCents = inv.grossTotalCents - 2380; // 1.190,00 € - 2 % = 1.166,20 €
    const paidAt = new Date("2034-06-15T00:00:00.000Z"); // 6 Tage nach Rechnungsdatum, innerhalb 10-Tage-Frist

    const result = await recordPayment(
      inv.id,
      recordPaymentSchema.parse({ amountCents: payableCents, method: "TRANSFER", paidAt, applySkonto: false }),
    );

    expect(result.payment.status).toBe("PARTIALLY_PAID");
    expect(result.payment.paidAmountCents).toBe(payableCents);
    expect(result.skontoSuggestion).toBeDefined();
    expect(result.skontoSuggestion!.permille).toBe(20);
    expect(result.skontoSuggestion!.restCents).toBe(2380);
    expect(result.skontoPayment).toBeUndefined();

    const payments = await prisma.payment.findMany({ where: { invoiceId: inv.id } });
    expect(payments).toHaveLength(1); // keine automatische zweite Zahlung ohne applySkonto
  });

  it("Zahlung mit applySkonto=true innerhalb der Frist: zweite Zahlung bucht den Rest, Rechnung wird PAID", async () => {
    const inv = await finalizedInvoiceWithSkonto();
    const payableCents = inv.grossTotalCents - 2380;
    const paidAt = new Date("2034-06-15T00:00:00.000Z");

    const result = await recordPayment(
      inv.id,
      recordPaymentSchema.parse({ amountCents: payableCents, method: "TRANSFER", paidAt, applySkonto: true }),
    );

    expect(result.payment.status).toBe("PAID");
    expect(result.payment.paidAmountCents).toBe(inv.grossTotalCents);
    expect(result.skontoSuggestion).toBeDefined();
    expect(result.skontoPayment).toBeDefined();
    expect(result.skontoPayment!.method).toBe("SKONTO");
    expect(result.skontoPayment!.isSkonto).toBe(true);
    expect(result.skontoPayment!.amountCents).toBe(2380);

    const payments = await prisma.payment.findMany({ where: { invoiceId: inv.id }, orderBy: { createdAt: "asc" } });
    expect(payments).toHaveLength(2);
    expect(payments[1].skontoForPaymentId).toBe(payments[0].id);

    // ChangeLog-Kette der GESAMTEN Organisation bleibt gueltig (die Hash-Chain ist
    // orgId-weit verkettet, nicht je Beleg) — und enthaelt fuer diese Rechnung je einen
    // PAYMENT- und einen SKONTO-Eintrag.
    const rows = await prisma.changeLog.findMany({
      where: { orgId },
      orderBy: { id: "asc" },
      select: { prevHash: true, hash: true, entity: true, entityId: true, action: true, actor: true, at: true, diffJson: true },
    });
    const entries: ChainEntry[] = rows.map((r) => ({
      prevHash: r.prevHash,
      hash: r.hash,
      payload: { entity: r.entity, entityId: r.entityId, action: r.action, actor: r.actor, at: r.at.toISOString(), diff: JSON.parse(r.diffJson) },
    }));
    expect(entries.some((e) => e.payload.entityId === inv.id && e.payload.action === "PAYMENT")).toBe(true);
    expect(entries.some((e) => e.payload.entityId === inv.id && e.payload.action === "SKONTO")).toBe(true);
    expect(verifyChain(entries).valid).toBe(true);
  });

  it("Zahlung ausserhalb der Skontofrist: kein Vorschlag, kein automatischer Abzug", async () => {
    const inv = await finalizedInvoiceWithSkonto();
    const payableCents = inv.grossTotalCents - 2380;
    const paidAt = new Date("2034-06-25T00:00:00.000Z"); // 16 Tage nach Rechnungsdatum, ausserhalb 10-Tage-Frist

    const result = await recordPayment(
      inv.id,
      recordPaymentSchema.parse({ amountCents: payableCents, method: "TRANSFER", paidAt, applySkonto: true }),
    );

    expect(result.skontoSuggestion).toBeUndefined();
    expect(result.skontoPayment).toBeUndefined();
    expect(result.payment.status).toBe("PARTIALLY_PAID");
    expect(result.payment.paidAmountCents).toBe(payableCents);
  });

  it("Vollzahlung (voller Bruttobetrag) loest keinen Skonto-Vorschlag aus", async () => {
    const inv = await finalizedInvoiceWithSkonto();
    const paidAt = new Date("2034-06-15T00:00:00.000Z");

    const result = await recordPayment(
      inv.id,
      recordPaymentSchema.parse({ amountCents: inv.grossTotalCents, method: "TRANSFER", paidAt, applySkonto: true }),
    );

    expect(result.payment.status).toBe("PAID");
    expect(result.skontoSuggestion).toBeUndefined();
    expect(result.skontoPayment).toBeUndefined();
  });

  it("unbekannte Zahlungsmethode wird abgelehnt", async () => {
    const inv = await finalizedInvoiceWithSkonto();
    await expect(
      recordPayment(inv.id, recordPaymentSchema.parse({ amountCents: 100, method: "UNBEKANNT" })),
    ).rejects.toBeInstanceOf(PaymentError);
  });

  it("Ueberzahlung: eine bereits vollstaendig bezahlte Rechnung nimmt keine weitere Zahlung an", async () => {
    const inv = await finalizedInvoiceWithSkonto();
    const paidAt = new Date("2034-06-15T00:00:00.000Z");

    const full = await recordPayment(
      inv.id,
      recordPaymentSchema.parse({ amountCents: inv.grossTotalCents, method: "TRANSFER", paidAt, applySkonto: true }),
    );
    expect(full.payment.status).toBe("PAID");

    await expect(
      recordPayment(inv.id, recordPaymentSchema.parse({ amountCents: 100, method: "TRANSFER", paidAt, applySkonto: true })),
    ).rejects.toBeInstanceOf(PaymentError);

    const payments = await prisma.payment.findMany({ where: { invoiceId: inv.id } });
    expect(payments).toHaveLength(1); // keine zusaetzliche (Ueberzahlungs-)Zahlung angelegt
  });

  it("Ueberzahlung: eine einzelne Zahlung darf den offenen Rest nicht uebersteigen", async () => {
    const inv = await finalizedInvoiceWithSkonto();
    const paidAt = new Date("2034-06-15T00:00:00.000Z");

    await expect(
      recordPayment(inv.id, recordPaymentSchema.parse({ amountCents: inv.grossTotalCents + 100, method: "TRANSFER", paidAt })),
    ).rejects.toBeInstanceOf(PaymentError);

    const payments = await prisma.payment.findMany({ where: { invoiceId: inv.id } });
    expect(payments).toHaveLength(0);
  });
});
