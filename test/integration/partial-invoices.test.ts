/**
 * Task 2 — Teil-, Abschlags- und Schlussrechnungen: Integrationstest ueber Anlage,
 * Festschreiben (Abzugs-Snapshot), Abrechnungsstand, Zahlungen und Storno.
 *
 * Eigenes Jahr fuer die Nummernvergabe (Invoice.number ist global @unique): 2040
 * (Testjahr-Konvention, siehe .superpowers/sdd/2026-09-04-phase-5-teilrechnungen/
 * task-2-facts.md).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { dbInternal } from "@/lib/db";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { createBusinessDocument } from "@/domain/document/create";
import { createPartialInvoice, PartialInvoiceError } from "@/domain/invoice/partial";
import { createDownpaymentInvoice, DownpaymentInvoiceError } from "@/domain/invoice/downpayment";
import { createFinalInvoice, FinalInvoiceError } from "@/domain/invoice/final";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import { cancelInvoice } from "@/domain/invoice/cancel";
import { recordPayment } from "@/domain/invoice/payment";
import { duplicateDocument } from "@/domain/document/duplicate";
import { InvalidOperationError } from "@/domain/errors";
import { billingStateFor } from "@/domain/document/billing-state";
import { verifyChain, type ChainEntry } from "@/domain/changelog";

const FIX_DATE = new Date("2040-05-01T10:00:00.000Z");

let orgId: string;
let customerId: string;

async function makeQuote(netCents: number, taxRate: 19 | 7 | 0 = 19) {
  return createBusinessDocument(
    orgId,
    {
      kind: "ANGEBOT",
      customerId,
      taxScheme: "REGULAR",
      currency: "EUR",
      lines: [
        {
          lineType: "ITEM",
          description: "Beratung",
          quantityMilli: 1000,
          unit: "C62",
          unitNetPriceCents: netCents,
          taxRate,
          taxCategory: "S",
          discountPermille: 0,
          discountCents: 0,
        },
      ],
    },
    { now: FIX_DATE },
  );
}

async function makeDiscountedMixedRateQuote() {
  // Reviewer-Fixture (Fix-Runde 2): 500.000@19 % + 500.000@7 %, 10 % Beleg-Rabatt.
  // Gesamtleistung: lineTotal 1.000.000, D = 100.000, je Bucket -50.000 -> 450.000/450.000
  // netto, Steuer 85.500/31.500, brutto gesamt 1.017.000.
  return createBusinessDocument(
    orgId,
    {
      kind: "ANGEBOT",
      customerId,
      taxScheme: "REGULAR",
      currency: "EUR",
      documentDiscountPermille: 100,
      lines: [
        { lineType: "ITEM", description: "Beratung", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 500_000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 },
        { lineType: "ITEM", description: "Literatur", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 500_000, taxRate: 7, taxCategory: "S", discountPermille: 0, discountCents: 0 },
      ],
    },
    { now: FIX_DATE },
  );
}

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "Teilrechnung GmbH", addressLine1: "Hauptstr. 1", postalCode: "21339", city: "Lüneburg", vatId: "DE123456789", taxNumber: "33/123/45678" },
  });
  orgId = org.id;
  const customer = await dbInternal.customer.create({
    data: { orgId, name: "Kunde AG", addressLine1: "Marktplatz 2", postalCode: "20095", city: "Hamburg", type: "BUSINESS" },
  });
  customerId = customer.id;
  await ensureOrgMasterdata(dbInternal, orgId);
});

describe("Lastenheft-Beispiel: 10.000,00 EUR netto, zwei Abschlaege a 30 %, Schlussrechnung", () => {
  it("berechnet 3.570,00 EUR je Abschlag und 4.760,00 EUR Rest auf der Schlussrechnung", async () => {
    const quote = await makeQuote(1_000_000); // 10.000,00 EUR netto / 19 %

    const dp1 = await createDownpaymentInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "PERCENT", permille: 300 }, { now: FIX_DATE });
    expect(dp1.grossTotalCents).toBe(357_000);
    const finalizedDp1 = await finalizeInvoice(dp1.id, { now: FIX_DATE });
    expect(finalizedDp1.grossTotalCents).toBe(357_000);

    const dp2 = await createDownpaymentInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "PERCENT", permille: 300 }, { now: FIX_DATE });
    expect(dp2.grossTotalCents).toBe(357_000);
    const finalizedDp2 = await finalizeInvoice(dp2.id, { now: FIX_DATE });
    expect(finalizedDp2.grossTotalCents).toBe(357_000);

    const final = await createFinalInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id }, { now: FIX_DATE });
    expect(final.grossTotalCents).toBe(1_190_000);

    const finalized = await finalizeInvoice(final.id, { now: FIX_DATE });
    expect(finalized.prepaidCents).toBe(714_000);
    expect(finalized.payableCents).toBe(476_000);

    const deductions = await dbInternal.finalInvoiceDeduction.findMany({ where: { finalInvoiceId: final.id } });
    expect(deductions).toHaveLength(2);
    expect(deductions.reduce((s, d) => s + d.grossCents, 0)).toBe(714_000);

    // Zahlung genau auf den offenen Rest (4.760,00 EUR) -> PAID (Bemessung = payableCents).
    const result = await recordPayment(final.id, { method: "TRANSFER", amountCents: 476_000, isSkonto: false, applySkonto: false }, { now: FIX_DATE });
    expect(result.payment.status).toBe("PAID");
    expect(result.payment.paidAmountCents).toBe(476_000);
  });
});

describe("Storno einer Abschlagsrechnung vor der Schlussrechnung", () => {
  it("setzt nur den stornierten Abschlag ab, der andere bleibt gueltig", async () => {
    const quote = await makeQuote(1_000_000);

    const dp1 = await finalizeInvoice((await createDownpaymentInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "PERCENT", permille: 300 }, { now: FIX_DATE })).id, { now: FIX_DATE });
    const dp2 = await finalizeInvoice((await createDownpaymentInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "PERCENT", permille: 300 }, { now: FIX_DATE })).id, { now: FIX_DATE });

    await cancelInvoice(dp1.id, { now: FIX_DATE });

    const final = await createFinalInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id }, { now: FIX_DATE });
    const finalized = await finalizeInvoice(final.id, { now: FIX_DATE });

    // Nur dp2 (357.000 Cent) wird abgesetzt, dp1 ist storniert und zaehlt nicht mehr.
    expect(finalized.prepaidCents).toBe(357_000);
    expect(finalized.payableCents).toBe(1_190_000 - 357_000);
    const deductions = await dbInternal.finalInvoiceDeduction.findMany({ where: { finalInvoiceId: final.id } });
    expect(deductions).toHaveLength(1);
    expect(deductions[0].downpaymentInvoiceId).toBe(dp2.id);
  });
});

describe("Zweite Schlussrechnung ist verboten", () => {
  it("wirft FinalInvoiceError, wenn bereits eine nicht stornierte Schlussrechnung existiert", async () => {
    const quote = await makeQuote(500_000);
    await finalizeInvoice((await createDownpaymentInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "PERCENT", permille: 500 }, { now: FIX_DATE })).id, { now: FIX_DATE });

    await createFinalInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id }, { now: FIX_DATE });

    await expect(createFinalInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id }, { now: FIX_DATE })).rejects.toThrow(FinalInvoiceError);
  });

  it("wirft FinalInvoiceError ohne jede festgeschriebene Abschlagsrechnung", async () => {
    const quote = await makeQuote(100_000);
    await expect(createFinalInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id }, { now: FIX_DATE })).rejects.toThrow(FinalInvoiceError);
  });
});

describe("Teilrechnung 40 % + 60 % -> Abrechnungsstand FULL", () => {
  it("billingStateFor liefert FULL, sobald die Anteile 100 % erreichen", async () => {
    const quote = await makeQuote(200_000, 7);

    let state = await billingStateFor(orgId, "QUOTE", quote.id);
    expect(state.state).toBe("NONE");

    await createPartialInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "PERCENT", permille: 400 }, { now: FIX_DATE });
    state = await billingStateFor(orgId, "QUOTE", quote.id);
    expect(state.state).toBe("PARTIAL");
    expect(state.billedPermille).toBe(400);

    await createPartialInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "PERCENT", permille: 600 }, { now: FIX_DATE });
    state = await billingStateFor(orgId, "QUOTE", quote.id);
    expect(state.state).toBe("FULL");
    expect(state.billedPermille).toBe(1000);
  });
});

describe("Fix-Runde 1 (HIGH): kumulativer Ueberbuchungs-Guard fuer PERCENT/NET_AMOUNT/GROSS_AMOUNT", () => {
  it("60 % + 60 % wird verweigert, 40 % + 60 % bleibt erlaubt", async () => {
    const quote = await makeQuote(200_000, 7);

    await createPartialInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "PERCENT", permille: 600 }, { now: FIX_DATE });

    await expect(
      createPartialInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "PERCENT", permille: 600 }, { now: FIX_DATE }),
    ).rejects.toThrow(PartialInvoiceError);

    // 40 % obendrauf (600 + 400 = 1000) bleibt erlaubt.
    const rest = await createPartialInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "PERCENT", permille: 400 }, { now: FIX_DATE });
    expect(rest.lines).toHaveLength(1);
  });

  it("NET_AMOUNT: eine Ueberschreitung der Gesamtleistung wird verweigert", async () => {
    const quote = await makeQuote(200_000, 7); // 200.000 Cent netto Gesamtleistung.

    await createPartialInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "NET_AMOUNT", amountCents: 150_000 }, { now: FIX_DATE });

    // Weitere 100.000 Cent netto wuerden brutto ueber die Gesamtleistung hinausgehen.
    await expect(
      createPartialInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "NET_AMOUNT", amountCents: 100_000 }, { now: FIX_DATE }),
    ).rejects.toThrow(PartialInvoiceError);
  });
});

describe("Fix-Runde 2: Anteilsbasis ist die Gesamtleistung NACH Beleg-Rabatt/-Aufschlag der Quelle", () => {
  it("PARTIAL (PERCENT) auf einer Quelle mit 10 % Beleg-Rabatt: 100 % Anteil == grossTotalCents, darueber wird verweigert", async () => {
    const quote = await makeDiscountedMixedRateQuote();
    expect(quote.grossTotalCents).toBe(1_017_000);

    const full = await createPartialInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "PERCENT", permille: 1000 }, { now: FIX_DATE });
    expect(full.grossTotalCents).toBe(1_017_000);

    await expect(
      createPartialInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "PERCENT", permille: 100 }, { now: FIX_DATE }),
    ).rejects.toThrow(PartialInvoiceError);
  });

  it("DOWNPAYMENT (30 %) auf einer Quelle mit 10 % Beleg-Rabatt liefert netto 135.000/135.000 je Satz; FINAL payable = 711.900; ueber 100 % wird verweigert", async () => {
    const quote = await makeDiscountedMixedRateQuote();
    expect(quote.grossTotalCents).toBe(1_017_000);

    const dp = await createDownpaymentInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "PERCENT", permille: 300 }, { now: FIX_DATE });
    const line19 = dp.lines.find((l) => l.taxRate === 19)!;
    const line7 = dp.lines.find((l) => l.taxRate === 7)!;
    expect(line19.unitNetPriceCents).toBe(135_000);
    expect(line7.unitNetPriceCents).toBe(135_000);
    expect(dp.grossTotalCents).toBe(305_100);

    const finalizedDp = await finalizeInvoice(dp.id, { now: FIX_DATE });
    expect(finalizedDp.grossTotalCents).toBe(305_100);

    // 30 % + 80 % > 100 % (Reviewer-Fixture, korrekte Bezugsgroesse) wird verweigert.
    await expect(
      createDownpaymentInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "PERCENT", permille: 800 }, { now: FIX_DATE }),
    ).rejects.toThrow(DownpaymentInvoiceError);

    const final = await createFinalInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id }, { now: FIX_DATE });
    const finalized = await finalizeInvoice(final.id, { now: FIX_DATE });
    expect(finalized.payableCents).toBe(711_900);
  });
});

describe("POSITIONS/QUANTITIES: Ueberberechnung wird verweigert", () => {
  it("QUANTITIES: eine zweite Teilrechnung ueber die Restmenge hinaus wirft PartialInvoiceError", async () => {
    const quote = await createBusinessDocument(
      orgId,
      {
        kind: "ANGEBOT",
        customerId,
        taxScheme: "REGULAR",
        currency: "EUR",
        lines: [{ lineType: "ITEM", description: "Stunden", quantityMilli: 10_000, unit: "HUR", unitNetPriceCents: 10_000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
      },
      { now: FIX_DATE },
    );
    const sourceLineId = quote.lines[0].id;

    await createPartialInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "QUANTITIES", quantities: [{ sourceLineId, quantityMilli: 7_000 }] }, { now: FIX_DATE });

    await expect(
      createPartialInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "QUANTITIES", quantities: [{ sourceLineId, quantityMilli: 4_000 }] }, { now: FIX_DATE }),
    ).rejects.toThrow(PartialInvoiceError);

    // Restmenge (3.000) darf noch abgerechnet werden.
    const rest = await createPartialInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "QUANTITIES", quantities: [{ sourceLineId, quantityMilli: 3_000 }] }, { now: FIX_DATE });
    expect(rest.lines).toHaveLength(1);

    const state = await billingStateFor(orgId, "QUOTE", quote.id);
    expect(state.state).toBe("FULL");
  });

  it("POSITIONS: eine bereits (teilweise) abgerechnete Position kann nicht erneut voll gewaehlt werden", async () => {
    const quote = await createBusinessDocument(
      orgId,
      {
        kind: "ANGEBOT",
        customerId,
        taxScheme: "REGULAR",
        currency: "EUR",
        lines: [{ lineType: "ITEM", description: "Material", quantityMilli: 1_000, unit: "C62", unitNetPriceCents: 20_000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
      },
      { now: FIX_DATE },
    );
    const sourceLineId = quote.lines[0].id;

    await createPartialInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "POSITIONS", lineIds: [sourceLineId] }, { now: FIX_DATE });

    await expect(
      createPartialInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "POSITIONS", lineIds: [sourceLineId] }, { now: FIX_DATE }),
    ).rejects.toThrow(PartialInvoiceError);
  });
});

describe("Kein Mischen von Teil- und Abschlagsrechnungen auf derselben Quelle", () => {
  it("verweigert eine Abschlagsrechnung, wenn bereits eine Teilrechnung existiert", async () => {
    const quote = await makeQuote(100_000);
    await createPartialInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "PERCENT", permille: 500 }, { now: FIX_DATE });

    await expect(
      createDownpaymentInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "PERCENT", permille: 200 }, { now: FIX_DATE }),
    ).rejects.toThrow(DownpaymentInvoiceError);
  });

  it("verweigert eine Teilrechnung, wenn bereits eine Abschlagsrechnung existiert", async () => {
    const quote = await makeQuote(100_000);
    await createDownpaymentInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "PERCENT", permille: 500 }, { now: FIX_DATE });

    await expect(
      createPartialInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "PERCENT", permille: 200 }, { now: FIX_DATE }),
    ).rejects.toThrow(PartialInvoiceError);
  });
});

describe("Abschlagssumme darf 100 % nicht uebersteigen", () => {
  it("wirft DownpaymentInvoiceError, wenn die Summe der festgeschriebenen Abschlaege die Gesamtleistung uebersteigen wuerde", async () => {
    const quote = await makeQuote(100_000);
    await finalizeInvoice((await createDownpaymentInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "PERCENT", permille: 700 }, { now: FIX_DATE })).id, { now: FIX_DATE });

    await expect(
      createDownpaymentInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "PERCENT", permille: 400 }, { now: FIX_DATE }),
    ).rejects.toThrow(DownpaymentInvoiceError);
  });
});

describe("Teil-/Abschlags-/Schlussrechnungen koennen nicht dupliziert werden", () => {
  it("wirft InvalidOperationError beim Duplizieren-Versuch (Fix-Runde 1, MEDIUM)", async () => {
    const quote = await makeQuote(100_000);
    const partial = await createPartialInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "PERCENT", permille: 500 }, { now: FIX_DATE });
    await expect(duplicateDocument(orgId, "INVOICE", partial.id, "tester", FIX_DATE)).rejects.toThrow(InvalidOperationError);
  });
});

describe("Storno der Schlussrechnung erstattet nur den Rest (nicht die Abschlaege)", () => {
  it("die Storno-Gutschrift betraegt genau -payableCents", async () => {
    const quote = await makeQuote(1_000_000);
    await finalizeInvoice((await createDownpaymentInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "PERCENT", permille: 300 }, { now: FIX_DATE })).id, { now: FIX_DATE });

    const final = await createFinalInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id }, { now: FIX_DATE });
    const finalized = await finalizeInvoice(final.id, { now: FIX_DATE });
    expect(finalized.payableCents).toBe(1_190_000 - 357_000);

    const { creditNote } = await cancelInvoice(final.id, { now: FIX_DATE });
    expect(creditNote.grossTotalCents).toBe(-(finalized.payableCents as number));
  });
});

describe("Fix-Runde 1 (MEDIUM): Storno einer Schlussrechnung mit Beleg-Rabatt + gemischten Steuersaetzen", () => {
  it("stoerniert eine FINAL-Rechnung mit 10 % Beleg-Rabatt und 19 %/7 %-Zeilen ohne Fehler und nettet zu -payableCents", async () => {
    const quote = await createBusinessDocument(
      orgId,
      {
        kind: "ANGEBOT",
        customerId,
        taxScheme: "REGULAR",
        currency: "EUR",
        documentDiscountPermille: 100, // 10 % Beleg-Rabatt
        lines: [
          { lineType: "ITEM", description: "Beratung", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 500_000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 },
          { lineType: "ITEM", description: "Literatur", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 500_000, taxRate: 7, taxCategory: "S", discountPermille: 0, discountCents: 0 },
        ],
      },
      { now: FIX_DATE },
    );

    await finalizeInvoice((await createDownpaymentInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "PERCENT", permille: 300 }, { now: FIX_DATE })).id, { now: FIX_DATE });

    const final = await createFinalInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id }, { now: FIX_DATE });
    const finalized = await finalizeInvoice(final.id, { now: FIX_DATE });
    expect(finalized.payableCents).not.toBeNull();

    const { creditNote } = await cancelInvoice(final.id, { now: FIX_DATE });
    expect(creditNote.grossTotalCents).toBe(-(finalized.payableCents as number));
    expect(creditNote.documentDiscountPermille).toBe(0);
  });
});

describe("§54: Abschlagsrechnung als Festbetrag (brutto) ueber gemischte Steuersaetze + Teilzahlung auf der Schlussrechnung", () => {
  it("verteilt den Festbetrag Largest-Remainder-proportional je Satz und erlaubt eine Teilzahlung auf den Restbetrag", async () => {
    // Dokumentiertes Rechenbeispiel aus src/lib/pricing/partial.ts (splitByTaxRate, Fall c):
    // Gesamtleistung 500,00 EUR netto/19 % + 500,00 EUR netto/7 %, Abschlag-Festbetrag brutto 1.000,00 EUR.
    const quote = await createBusinessDocument(
      orgId,
      {
        kind: "ANGEBOT",
        customerId,
        taxScheme: "REGULAR",
        currency: "EUR",
        lines: [
          { lineType: "ITEM", description: "Beratung", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 50_000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 },
          { lineType: "ITEM", description: "Literatur", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 50_000, taxRate: 7, taxCategory: "S", discountPermille: 0, discountCents: 0 },
        ],
      },
      { now: FIX_DATE },
    );
    expect(quote.grossTotalCents).toBe(113_000); // 59.500 + 53.500

    const dp = await createDownpaymentInvoice(
      orgId,
      { sourceType: "QUOTE", sourceId: quote.id, mode: "AMOUNT", amountCents: 100_000, amountIsGross: true },
      { now: FIX_DATE },
    );
    const line19 = dp.lines.find((l) => l.taxRate === 19)!;
    const line7 = dp.lines.find((l) => l.taxRate === 7)!;
    expect(line19.unitNetPriceCents).toBe(44_248);
    expect(line7.unitNetPriceCents).toBe(44_248);
    expect(dp.grossTotalCents).toBe(100_000);

    await finalizeInvoice(dp.id, { now: FIX_DATE });

    const final = await createFinalInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id }, { now: FIX_DATE });
    const finalized = await finalizeInvoice(final.id, { now: FIX_DATE });
    expect(finalized.prepaidCents).toBe(100_000);
    expect(finalized.payableCents).toBe(13_000); // 113.000 - 100.000

    // Teilzahlung: 5.000 von 13.000 offenem Restbetrag (Bemessungsgrundlage = payableCents,
    // nicht grossTotalCents) -> PARTIALLY_PAID, offener Betrag danach 8.000.
    const partial = await recordPayment(final.id, { method: "TRANSFER", amountCents: 5_000, isSkonto: false, applySkonto: false }, { now: FIX_DATE });
    expect(partial.payment.status).toBe("PARTIALLY_PAID");
    expect(partial.payment.paidAmountCents).toBe(5_000);

    // Restzahlung auf den verbleibenden offenen Betrag -> PAID.
    const rest = await recordPayment(final.id, { method: "TRANSFER", amountCents: 8_000, isSkonto: false, applySkonto: false }, { now: FIX_DATE });
    expect(rest.payment.status).toBe("PAID");
    expect(rest.payment.paidAmountCents).toBe(13_000);
  });
});

describe("ChangeLog-Kette (Phase 5)", () => {
  it("bleibt ueber alle Schreiboperationen dieses Tests gueltig (verifyChain)", async () => {
    const rows = await dbInternal.changeLog.findMany({
      where: { orgId },
      orderBy: { id: "asc" },
      select: { prevHash: true, hash: true, entity: true, entityId: true, action: true, actor: true, at: true, diffJson: true },
    });
    const entries: ChainEntry[] = rows.map((r) => ({
      prevHash: r.prevHash,
      hash: r.hash,
      payload: { entity: r.entity, entityId: r.entityId, action: r.action, actor: r.actor, at: r.at.toISOString(), diff: JSON.parse(r.diffJson) },
    }));
    expect(entries.length).toBeGreaterThan(10);
    expect(verifyChain(entries).valid).toBe(true);
  });
});
