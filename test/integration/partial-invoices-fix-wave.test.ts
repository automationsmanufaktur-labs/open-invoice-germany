/**
 * Fix-Welle nach dem Abschluss-Review von Phase 5 (Teil-/Abschlags-/Schlussrechnungen):
 * B1, B3, B5, B6, B7, B8, B9, B14 (siehe
 * .superpowers/sdd/2026-09-04-phase-5-teilrechnungen/final-review-findings.md und
 * fix-wave-brief.md).
 *
 * Eigenes Jahr fuer die Nummernvergabe (Invoice.number ist global @unique): 2045
 * (bislang unbenutzt, siehe task-4-report.md Abweichung 5).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { dbInternal } from "@/lib/db";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { createBusinessDocument } from "@/domain/document/create";
import { createPartialInvoice, PartialInvoiceError } from "@/domain/invoice/partial";
import { createDownpaymentInvoice } from "@/domain/invoice/downpayment";
import { createFinalInvoice } from "@/domain/invoice/final";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import { cancelInvoice } from "@/domain/invoice/cancel";
import { createDunning } from "@/domain/dunning/create";
import { createDeliveryNote } from "@/domain/delivery-note/create";
import { billingStateFor } from "@/domain/document/billing-state";

const FIX_DATE = new Date("2045-05-01T10:00:00.000Z");

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
        { lineType: "ITEM", description: "Beratung", quantityMilli: 1000, unit: "C62", unitNetPriceCents: netCents, taxRate, taxCategory: "S", discountPermille: 0, discountCents: 0 },
      ],
    },
    { now: FIX_DATE },
  );
}

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "Fix-Welle GmbH", addressLine1: "Ringstr. 9", postalCode: "10115", city: "Berlin", vatId: "DE987654321", taxNumber: "34/987/65432" },
  });
  orgId = org.id;
  const customer = await dbInternal.customer.create({
    data: { orgId, name: "Fix-Welle-Kunde AG", addressLine1: "Am Markt 3", postalCode: "10117", city: "Berlin", type: "BUSINESS" },
  });
  customerId = customer.id;
  await ensureOrgMasterdata(dbInternal, orgId);
});

describe("B1: Zeilen-/Belegrabatt bei POSITIONS/QUANTITIES", () => {
  it("Zeile 10x100,00 mit 10% Zeilenrabatt + 10% Belegrabatt -> Teilrechnung POSITIONS = 810,00 netto", async () => {
    const quote = await createBusinessDocument(
      orgId,
      {
        kind: "ANGEBOT",
        customerId,
        taxScheme: "REGULAR",
        currency: "EUR",
        documentDiscountPermille: 100,
        lines: [
          {
            lineType: "ITEM",
            description: "Consulting",
            quantityMilli: 10_000,
            unit: "C62",
            unitNetPriceCents: 10_000,
            taxRate: 19,
            taxCategory: "S",
            discountPermille: 100,
            discountCents: 0,
          },
        ],
      },
      { now: FIX_DATE },
    );
    // Zeilennetto nach 10% Zeilenrabatt: 1.000,00 * 0,9 = 900,00.
    expect(quote.lines[0].lineNetCents).toBe(90_000);

    const invoice = await createPartialInvoice(
      orgId,
      { sourceType: "QUOTE", sourceId: quote.id, mode: "POSITIONS", lineIds: [quote.lines[0].id] },
      { now: FIX_DATE },
    );

    expect(invoice.lines).toHaveLength(1);
    expect(invoice.lines[0].discountPermille).toBe(100);
    // 900,00 * 0,9 (10% Belegrabatt) = 810,00.
    expect(invoice.netTotalCents).toBe(81_000);
  });

  it("QUANTITIES: Festbetragsrabatt wird proportional zur abgerechneten Menge herunterskaliert", async () => {
    const quote = await createBusinessDocument(
      orgId,
      {
        kind: "ANGEBOT",
        customerId,
        taxScheme: "REGULAR",
        currency: "EUR",
        lines: [
          {
            lineType: "ITEM",
            description: "Material",
            quantityMilli: 10_000, // 10 Stueck
            unit: "C62",
            unitNetPriceCents: 10_000, // 100,00 EUR/Stueck
            taxRate: 19,
            taxCategory: "S",
            discountPermille: 0,
            discountCents: 2_000, // 20,00 EUR Festrabatt auf die GESAMTE Zeile (10 Stueck)
          },
        ],
      },
      { now: FIX_DATE },
    );
    // grossLine 1.000,00 - 20,00 = 980,00.
    expect(quote.lines[0].lineNetCents).toBe(98_000);

    // Halbe Menge (5 von 10) abgerechnet -> Rabatt wird auf 10,00 EUR skaliert.
    const invoice = await createPartialInvoice(
      orgId,
      { sourceType: "QUOTE", sourceId: quote.id, mode: "QUANTITIES", quantities: [{ sourceLineId: quote.lines[0].id, quantityMilli: 5_000 }] },
      { now: FIX_DATE },
    );

    expect(invoice.lines[0].discountCents).toBe(1_000); // 10,00 EUR
    // 500,00 - 10,00 = 490,00.
    expect(invoice.netTotalCents).toBe(49_000);
  });
});

describe("B3: Ueberbuchungs-Guard greift auch fuer POSITIONS/QUANTITIES", () => {
  it("PERCENT 100% gefolgt von QUANTITIES ueber dieselbe Menge wird verweigert", async () => {
    const quote = await createBusinessDocument(
      orgId,
      {
        kind: "ANGEBOT",
        customerId,
        taxScheme: "REGULAR",
        currency: "EUR",
        lines: [
          { lineType: "ITEM", description: "Beratung", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 100_000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 },
        ],
      },
      { now: FIX_DATE },
    );

    await createPartialInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "PERCENT", permille: 1000 }, { now: FIX_DATE });

    await expect(
      createPartialInvoice(
        orgId,
        { sourceType: "QUOTE", sourceId: quote.id, mode: "QUANTITIES", quantities: [{ sourceLineId: quote.lines[0].id, quantityMilli: 1000 }] },
        { now: FIX_DATE },
      ),
    ).rejects.toThrow(PartialInvoiceError);
  });
});

describe("B5: GROSS_AMOUNT trifft den angeforderten Bruttobetrag exakt, wo rechnerisch erreichbar", () => {
  it("gemischte Saetze (19%/7%): 1.000,03 EUR brutto wird durch Bucket-Reconciliation exakt getroffen", async () => {
    // Ohne Reconciliation (naive Rundung je Bucket) ergaebe dieser Zielbetrag 1.000,04 EUR
    // (siehe B5-Analyse) — die Bucket-Verschiebung (±1 Cent Netto im am besten geeigneten
    // Bucket) behebt das fuer Mehr-Satz-Faelle in der grossen Mehrheit der Werte.
    const quote = await createBusinessDocument(
      orgId,
      {
        kind: "ANGEBOT",
        customerId,
        taxScheme: "REGULAR",
        currency: "EUR",
        lines: [
          { lineType: "ITEM", description: "A", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 500_000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 },
          { lineType: "ITEM", description: "B", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 500_000, taxRate: 7, taxCategory: "S", discountPermille: 0, discountCents: 0 },
        ],
      },
      { now: FIX_DATE },
    );
    const invoice = await createPartialInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "GROSS_AMOUNT", amountCents: 100_003 }, { now: FIX_DATE });
    expect(invoice.grossTotalCents).toBe(100_003);
  });

  it("Einzelsatz (19%): 5.000,04 EUR ist rechnerisch nicht exakt erreichbar (dokumentierte Ausnahme, docs/LIMITATIONEN.md) — Abweichung bleibt auf ±1 Cent begrenzt", async () => {
    const quote = await makeQuote(10_000_000, 19); // 100.000,00 EUR netto, weit ueber dem Zielbetrag.
    const invoice = await createPartialInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "GROSS_AMOUNT", amountCents: 500_004 }, { now: FIX_DATE });
    expect(Math.abs(invoice.grossTotalCents - 500_004)).toBeLessThanOrEqual(1);
  });
});

describe("B6: FINAL-Storno trifft -payableCents exakt, wo rechnerisch erreichbar", () => {
  it("Einzelsatz (19%), 50% Abschlag auf 2.469,00 EUR netto: rechnerisch nicht exakt erreichbar (dokumentierte Ausnahme) — Abweichung bleibt auf ±1 Cent begrenzt", async () => {
    // Reviewer-Fixture aus dem Abschluss-Review (B6): payableCents=146.905, die naive
    // Differenz ergibt nach Steuer-Neuberechnung 146.906 — bei genau einem Steuersatz
    // gibt es keinen zweiten Bucket zum Ausgleich (siehe reconcileNetsForGross).
    const quote = await makeQuote(246_900, 19);
    const dp = await finalizeInvoice((await createDownpaymentInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "PERCENT", permille: 500 }, { now: FIX_DATE })).id, { now: FIX_DATE });
    expect(dp.grossTotalCents).toBe(146_906); // 123.450 netto + 23.456 USt (23.455,5 rundet auf).

    const final = await finalizeInvoice((await createFinalInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id }, { now: FIX_DATE })).id, { now: FIX_DATE });
    const payable = final.payableCents!;
    expect(payable).toBe(146_905);

    const { creditNote } = await cancelInvoice(final.id, { now: FIX_DATE });
    expect(Math.abs(creditNote.grossTotalCents - -payable)).toBeLessThanOrEqual(1);
  });

  it("gemischte Saetze (19%/7%): Storno trifft -payableCents exakt (Bucket-Reconciliation greift)", async () => {
    const quote = await createBusinessDocument(
      orgId,
      {
        kind: "ANGEBOT",
        customerId,
        taxScheme: "REGULAR",
        currency: "EUR",
        lines: [
          { lineType: "ITEM", description: "A", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 500_000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 },
          { lineType: "ITEM", description: "B", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 500_000, taxRate: 7, taxCategory: "S", discountPermille: 0, discountCents: 0 },
        ],
      },
      { now: FIX_DATE },
    );
    await finalizeInvoice((await createDownpaymentInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "PERCENT", permille: 333 }, { now: FIX_DATE })).id, { now: FIX_DATE });
    const final = await finalizeInvoice((await createFinalInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id }, { now: FIX_DATE })).id, { now: FIX_DATE });
    const payable = final.payableCents!;

    const { creditNote } = await cancelInvoice(final.id, { now: FIX_DATE });
    expect(creditNote.grossTotalCents).toBe(-payable);
  });
});

describe("B7: Mahnung ist fuer PARTIAL/DOWNPAYMENT/FINAL moeglich", () => {
  it("erstellt eine Mahnung fuer eine ueberfaellige Schlussrechnung, Bemessung ueber payableBaseCents", async () => {
    const quote = await makeQuote(1_000_000, 19);
    await finalizeInvoice((await createDownpaymentInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "PERCENT", permille: 300 }, { now: FIX_DATE })).id, { now: FIX_DATE });
    const final = await finalizeInvoice((await createFinalInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id }, { now: FIX_DATE })).id, { now: FIX_DATE });

    const overdueDate = new Date(FIX_DATE.getTime() + 60 * 24 * 60 * 60 * 1000);
    const result = await createDunning(final.id, { now: overdueDate });
    expect(result.openAmountCents).toBe(final.payableCents);
  });
});

describe("B8: Schlussrechnung bleibt erzeugbar, auch wenn Abrechnungsstand FULL wird", () => {
  it("zwei 50%-Abschlaege fuehren zu FULL, hasDownpayments bleibt wahr, keine aktive FINAL", async () => {
    const quote = await makeQuote(1_000_000, 19);
    await finalizeInvoice((await createDownpaymentInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "PERCENT", permille: 500 }, { now: FIX_DATE })).id, { now: FIX_DATE });
    await finalizeInvoice((await createDownpaymentInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "PERCENT", permille: 500 }, { now: FIX_DATE })).id, { now: FIX_DATE });

    const state = await billingStateFor(orgId, "QUOTE", quote.id);
    expect(state.state).toBe("FULL");
    expect(state.downpaymentGrossCents).toBeGreaterThan(0);
    expect(state.hasActiveFinal).toBe(false);

    // Die Schlussrechnung selbst bleibt trotz FULL erzeugbar (Backend war nie blockiert).
    const final = await createFinalInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id }, { now: FIX_DATE });
    const finalized = await finalizeInvoice(final.id, { now: FIX_DATE });
    expect(finalized.payableCents).toBe(0);

    const stateAfter = await billingStateFor(orgId, "QUOTE", quote.id);
    expect(stateAfter.hasActiveFinal).toBe(true);
  });
});

describe("B9: FINALIZE-ChangeLog traegt den Abzugs-Snapshot", () => {
  it("diff enthaelt prepaidCents/payableCents und die Nummern der abgezogenen Abschlaege", async () => {
    const quote = await makeQuote(1_000_000, 19);
    const dp = await finalizeInvoice((await createDownpaymentInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "PERCENT", permille: 300 }, { now: FIX_DATE })).id, { now: FIX_DATE });
    const final = await finalizeInvoice((await createFinalInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id }, { now: FIX_DATE })).id, { now: FIX_DATE });

    const entry = await dbInternal.changeLog.findFirst({
      where: { orgId, entity: "INVOICE", entityId: final.id, action: "FINALIZE" },
      orderBy: { at: "desc" },
    });
    expect(entry).not.toBeNull();
    const diff = JSON.parse(entry!.diffJson) as { prepaidCents?: number; payableCents?: number; deductedInvoiceNumbers?: string[] };
    expect(diff.prepaidCents).toBe(final.prepaidCents);
    expect(diff.payableCents).toBe(final.payableCents);
    expect(diff.deductedInvoiceNumbers).toContain(dp.number);
  });

  it("finalInvoiceDeduction kann ausserhalb von finalize nicht geaendert/geloescht werden (GoBD-Guard)", async () => {
    const quote = await makeQuote(500_000, 19);
    const dp = await finalizeInvoice((await createDownpaymentInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "PERCENT", permille: 500 }, { now: FIX_DATE })).id, { now: FIX_DATE });
    const final = await finalizeInvoice((await createFinalInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id }, { now: FIX_DATE })).id, { now: FIX_DATE });
    const row = await dbInternal.finalInvoiceDeduction.findFirstOrThrow({ where: { finalInvoiceId: final.id } });
    void dp;

    const { prisma } = await import("@/lib/db");
    await expect(prisma.finalInvoiceDeduction.update({ where: { id: row.id }, data: { netCents: 0 } })).rejects.toThrow();
    await expect(prisma.finalInvoiceDeduction.delete({ where: { id: row.id } })).rejects.toThrow();
  });
});

describe("B12: preisloser Lieferschein — lazy Preispruefung nur fuer gewaehlte Zeilen", () => {
  async function makeMixedDeliveryNote() {
    return createDeliveryNote(
      orgId,
      {
        customerId,
        showPrices: false,
        lines: [
          { description: "Bepreiste Position", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 10_000, taxRate: 19 },
          { description: "Preislose Position", quantityMilli: 1000, unit: "C62" },
        ],
      },
      { now: FIX_DATE },
    );
  }

  it("POSITIONS auf die bepreiste Zeile gelingt, obwohl eine andere Zeile keinen Preis hat", async () => {
    const dn = await makeMixedDeliveryNote();
    const pricedLine = dn.lines.find((l) => l.description === "Bepreiste Position")!;

    const invoice = await createPartialInvoice(
      orgId,
      { sourceType: "DELIVERY_NOTE", sourceId: dn.id, mode: "POSITIONS", lineIds: [pricedLine.id] },
      { now: FIX_DATE },
    );
    expect(invoice.netTotalCents).toBe(10_000);
  });

  it("POSITIONS auf die preislose Zeile wird mit klarem 409-Text verweigert", async () => {
    const dn = await makeMixedDeliveryNote();
    const unpricedLine = dn.lines.find((l) => l.description === "Preislose Position")!;

    await expect(
      createPartialInvoice(orgId, { sourceType: "DELIVERY_NOTE", sourceId: dn.id, mode: "POSITIONS", lineIds: [unpricedLine.id] }, { now: FIX_DATE }),
    ).rejects.toThrow(/Preis\/Steuersatz/);
  });

  it("PERCENT (Anteils-Modus) wird verweigert, solange nicht alle Zeilen der Quelle einen Preis tragen", async () => {
    const dn = await makeMixedDeliveryNote();
    await expect(
      createPartialInvoice(orgId, { sourceType: "DELIVERY_NOTE", sourceId: dn.id, mode: "PERCENT", permille: 500 }, { now: FIX_DATE }),
    ).rejects.toThrow(PartialInvoiceError);
  });
});

describe("B14: Downpayment-100%-Guard nutzt dieselbe Basis wie die Bucket-Aufteilung", () => {
  it("100% Abschlag auf einer Quelle mit 10% Beleg-Rabatt ist genau an der Grenze zulaessig", async () => {
    const quote = await createBusinessDocument(
      orgId,
      {
        kind: "ANGEBOT",
        customerId,
        taxScheme: "REGULAR",
        currency: "EUR",
        documentDiscountPermille: 100,
        lines: [
          { lineType: "ITEM", description: "Beratung", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 500_000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 },
        ],
      },
      { now: FIX_DATE },
    );

    const dp = await createDownpaymentInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "PERCENT", permille: 1000 }, { now: FIX_DATE });
    expect(dp.grossTotalCents).toBe(quote.grossTotalCents);
  });
});
