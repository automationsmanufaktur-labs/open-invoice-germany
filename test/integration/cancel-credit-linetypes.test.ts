/**
 * Fix-Welle (K1): Storno und Teilgutschrift muessen Positionstypen (lineType,
 * descriptionLong, articleNumber) uebernehmen und duerfen Nicht-ITEM-Zeilen
 * (HEADING/TEXT/SUBTOTAL) nie mit Betraegen versehen — nur ITEM-Positionen
 * gehen in die XML/Summen ein (§8).
 *
 * Eigenes Testjahr (2039): payment-methods.test.ts finalisiert ebenfalls Rechnungen in
 * 2035 — Invoice.number ist global @unique (nicht je Org), zwei Dateien mit derselben
 * ersten Festschreibung im selben Jahr kollidieren sonst auf "RE-<Jahr>-0001".
 */
import { beforeAll, describe, it, expect } from "vitest";
import { dbInternal } from "@/lib/db";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { createDraftInvoice } from "@/domain/invoice/create";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import { cancelInvoice } from "@/domain/invoice/cancel";
import { createInvoiceSchema } from "@/schemas";
import { buildEInvoiceData, type MapInput } from "@/lib/einvoice/mapper";
import { buildXRechnungUBL } from "@/lib/einvoice/xrechnung";

const FIX_DATE = new Date("2039-05-01T10:00:00.000Z");

let orgId: string;
let customerId: string;

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "Storno Bloecke GmbH", addressLine1: "Hauptstr. 1", postalCode: "21339", city: "Lüneburg", vatId: "DE123456789", taxNumber: "33/123/45678" },
  });
  orgId = org.id;
  await ensureOrgMasterdata(dbInternal, orgId);
  const customer = await dbInternal.customer.create({
    data: { orgId, name: "Kunde AG", addressLine1: "Marktplatz 2", postalCode: "20095", city: "Hamburg", type: "BUSINESS" },
  });
  customerId = customer.id;
});

const linesWithBlocks = [
  { lineType: "HEADING" as const, description: "Hosting", quantityMilli: 0, unit: "C62", unitNetPriceCents: 0, taxRate: 0 as const, taxCategory: "S" as const, discountPermille: 0, discountCents: 0 },
  { lineType: "ITEM" as const, description: "Setup", unit: "C62", quantityMilli: 1000, unitNetPriceCents: 50000, taxRate: 19 as const, taxCategory: "S" as const, discountPermille: 0, discountCents: 0 },
  { lineType: "ITEM" as const, description: "12 Monate Hosting", unit: "C62", quantityMilli: 1000, unitNetPriceCents: 24000, taxRate: 19 as const, taxCategory: "S" as const, discountPermille: 0, discountCents: 0 },
  { lineType: "SUBTOTAL" as const, description: "Zwischensumme", quantityMilli: 0, unit: "C62", unitNetPriceCents: 0, taxRate: 0 as const, taxCategory: "S" as const, discountPermille: 0, discountCents: 0 },
];

describe("cancelInvoice — Positionstypen bei Storno (K1)", () => {
  it("uebernimmt lineType je Zeile, negiert nur ITEM-Betraege, XML enthaelt nur die 2 ITEM-Zeilen", async () => {
    const draft = await createDraftInvoice(
      orgId,
      createInvoiceSchema.parse({ customerId, type: "INVOICE", taxScheme: "REGULAR", currency: "EUR", deliveryDate: FIX_DATE, lines: linesWithBlocks }),
      { now: FIX_DATE },
    );
    const fin = await finalizeInvoice(draft.id, { now: FIX_DATE });
    const res = await cancelInvoice(fin.id, { now: FIX_DATE });

    const creditLines = await dbInternal.invoiceLine.findMany({ where: { invoiceId: res.creditNote.id }, orderBy: { position: "asc" } });
    expect(creditLines.map((l) => l.lineType)).toEqual(["HEADING", "ITEM", "ITEM", "SUBTOTAL"]);
    // Nicht-ITEM-Zeilen bleiben Betrag 0.
    expect(creditLines[0].lineNetCents).toBe(0);
    expect(creditLines[0].unitNetPriceCents).toBe(0);
    expect(creditLines[3].lineNetCents).toBe(0);
    // ITEM-Zeilen sind das negierte Spiegelbild.
    expect(creditLines[1].lineNetCents).toBe(-50000);
    expect(creditLines[2].lineNetCents).toBe(-24000);

    const mapInput: MapInput = {
      number: res.creditNote.number,
      type: res.creditNote.type,
      issueDate: res.creditNote.issueDate!,
      dueDate: null,
      deliveryDate: null,
      currency: res.creditNote.currency,
      buyerReference: null,
      paymentTerms: null,
      notes: res.creditNote.notes,
      netTotalCents: res.creditNote.netTotalCents,
      taxTotalCents: res.creditNote.taxTotalCents,
      grossTotalCents: res.creditNote.grossTotalCents,
      paidAmountCents: 0,
      taxBreakdownJson: res.creditNote.taxBreakdownJson!,
      sellerSnapshotJson: res.creditNote.sellerSnapshotJson,
      buyerSnapshotJson: res.creditNote.buyerSnapshotJson,
      org: {
        legalName: "Storno Bloecke GmbH", addressLine1: "Hauptstr. 1", addressLine2: null, postalCode: "21339", city: "Lüneburg",
        country: "DE", vatId: "DE123456789", taxNumber: "33/123/45678", email: null, phone: null, electronicAddress: null,
        iban: null, bic: null, bankName: null,
      },
      customer: {
        name: "Kunde AG", contactName: null, addressLine1: "Marktplatz 2", addressLine2: null, postalCode: "20095", city: "Hamburg",
        countryCode: "DE", vatId: null, email: null, leitwegId: null,
      },
      lines: creditLines.map((l, i) => ({
        id: String(i + 1),
        description: l.description,
        quantityMilli: l.quantityMilli,
        unit: l.unit,
        unitNetPriceCents: l.unitNetPriceCents,
        lineNetCents: l.lineNetCents,
        taxRate: l.taxRate,
        taxCategory: l.taxCategory,
        lineType: l.lineType as "ITEM" | "HEADING" | "TEXT" | "SUBTOTAL",
        descriptionLong: l.descriptionLong,
        articleNumber: l.articleNumber,
      })),
    };
    const data = buildEInvoiceData(mapInput);
    const xml = buildXRechnungUBL(data);
    const itemLineCount = (xml.match(/<cac:CreditNoteLine>/g) ?? []).length;
    expect(itemLineCount).toBe(2);
  });
});
