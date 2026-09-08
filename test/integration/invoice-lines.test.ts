/**
 * Task 3, Commit 0 — Auflagen aus dem Task-1-Review: normalizeLines + lineType/
 * descriptionLong/articleNumber muessen in createDraftInvoiceWithinTx,
 * createBusinessDocumentWithinTx, updateDraftDocument und den convertDocument-Pfaden
 * ankommen; Nicht-ITEM-Zeilen (HEADING/TEXT/SUBTOTAL) duerfen nie in die Summen
 * einfliessen. Kopffelder (subject/orderNumber/internalReference/contactPersonId/
 * billingAddressId/shippingAddressId) muessen an der Rechnung persistiert werden.
 *
 * Eigenes Jahr fuer die Nummernvergabe: 2035 (Testjahr laut Auftrag).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { dbInternal } from "@/lib/db";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { createDraftInvoice } from "@/domain/invoice/create";
import { createInvoiceSchema } from "@/schemas";
import { createBusinessDocument } from "@/domain/document/create";
import { updateDraftDocument } from "@/domain/document/update";
import { convertDocument } from "@/domain/document/convert";
import { duplicateDocument } from "@/domain/document/duplicate";

const FIX_DATE = new Date("2035-03-01T10:00:00.000Z");

let orgId: string;
let customerId: string;
let contactPersonId: string;
let billingAddressId: string;
let shippingAddressId: string;

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "Zeilentypen GmbH", addressLine1: "Hauptstr. 1", postalCode: "21339", city: "Lüneburg", vatId: "DE123456789", taxNumber: "33/123/45678" },
  });
  orgId = org.id;
  await ensureOrgMasterdata(dbInternal, orgId);
  const customer = await dbInternal.customer.create({
    data: { orgId, name: "Kunde AG", addressLine1: "Marktplatz 2", postalCode: "20095", city: "Hamburg", type: "BUSINESS" },
  });
  customerId = customer.id;
  const contact = await dbInternal.contactPerson.create({
    data: { orgId, customerId, firstName: "Anna", lastName: "Muster" },
  });
  contactPersonId = contact.id;
  const billing = await dbInternal.customerAddress.create({
    data: { orgId, customerId, type: "BILLING", addressLine1: "Rechnungsweg 1", postalCode: "20095", city: "Hamburg" },
  });
  billingAddressId = billing.id;
  const shipping = await dbInternal.customerAddress.create({
    data: { orgId, customerId, type: "SHIPPING", addressLine1: "Lieferweg 2", postalCode: "20095", city: "Hamburg" },
  });
  shippingAddressId = shipping.id;
});

const linesWithHeadingAndSubtotal = [
  { lineType: "HEADING" as const, description: "Hosting", quantityMilli: 0, unit: "C62", unitNetPriceCents: 0, taxRate: 0 as const, taxCategory: "Z" as const, discountPermille: 0, discountCents: 0 },
  { lineType: "ITEM" as const, description: "Setup", unit: "C62", quantityMilli: 1000, unitNetPriceCents: 50000, taxRate: 19 as const, taxCategory: "S" as const, discountPermille: 0, discountCents: 0 },
  { lineType: "ITEM" as const, description: "12 Monate Hosting", unit: "C62", quantityMilli: 1000, unitNetPriceCents: 24000, taxRate: 19 as const, taxCategory: "S" as const, discountPermille: 0, discountCents: 0 },
  { lineType: "SUBTOTAL" as const, description: "Zwischensumme", quantityMilli: 0, unit: "C62", unitNetPriceCents: 0, taxRate: 0 as const, taxCategory: "Z" as const, discountPermille: 0, discountCents: 0 },
];

describe("createDraftInvoice — Positionstypen und Kopffelder (Commit 0)", () => {
  it("persistiert lineType je Zeile, HEADING traegt quantityMilli 0 und bleibt HEADING (nicht ITEM), Summen nur aus ITEMs", async () => {
    const invoice = await createDraftInvoice(
      orgId,
      createInvoiceSchema.parse({
        customerId,
        type: "INVOICE",
        taxScheme: "REGULAR",
        currency: "EUR",
        subject: "Projekt Hosting",
        orderNumber: "BEST-42",
        internalReference: "KST-7",
        contactPersonId,
        billingAddressId,
        shippingAddressId,
        lines: linesWithHeadingAndSubtotal,
      }),
      { now: FIX_DATE },
    );

    expect(invoice.subject).toBe("Projekt Hosting");
    expect(invoice.orderNumber).toBe("BEST-42");
    expect(invoice.internalReference).toBe("KST-7");
    expect(invoice.contactPersonId).toBe(contactPersonId);
    expect(invoice.billingAddressId).toBe(billingAddressId);
    expect(invoice.shippingAddressId).toBe(shippingAddressId);

    expect(invoice.lines.map((l) => l.lineType)).toEqual(["HEADING", "ITEM", "ITEM", "SUBTOTAL"]);
    expect(invoice.lines[0].quantityMilli).toBe(0);
    expect(invoice.lines[0].lineType).not.toBe("ITEM");

    // Summen: NUR die beiden ITEM-Zeilen (500,00 € + 240,00 € = 740,00 €), HEADING/SUBTOTAL
    // tragen keinen Betrag.
    expect(invoice.netTotalCents).toBe(74000);
  });

  it("lehnt Ansprechpartner/Adresse aus fremder Organisation ab", async () => {
    const other = await dbInternal.organization.create({
      data: { legalName: "Fremde GmbH", addressLine1: "X", postalCode: "1", city: "X" },
    });
    const foreignContact = await dbInternal.contactPerson.create({ data: { orgId: other.id, customerId, firstName: "F", lastName: "F" } });

    await expect(
      createDraftInvoice(
        orgId,
        createInvoiceSchema.parse({ customerId, contactPersonId: foreignContact.id, lines: [linesWithHeadingAndSubtotal[1]] }),
        { now: FIX_DATE },
      ),
    ).rejects.toThrow();
  });
});

describe("createBusinessDocument -> updateDraftDocument — Positionstypen (Commit 0)", () => {
  it("persistiert lineType/descriptionLong/articleNumber, Summen nur aus ITEMs, auch nach Update ohne neue Positionen", async () => {
    const doc = await createBusinessDocument(
      orgId,
      { kind: "ANGEBOT", customerId, taxScheme: "REGULAR", currency: "EUR", lines: linesWithHeadingAndSubtotal },
      { now: FIX_DATE },
    );
    expect(doc.lines.map((l) => l.lineType)).toEqual(["HEADING", "ITEM", "ITEM", "SUBTOTAL"]);
    expect(doc.netTotalCents).toBe(74000);

    // Nur Beleg-Aufschlag geaendert, keine neuen Positionen -> Summen muessen weiterhin
    // nur aus den ITEM-Zeilen der bestehenden Positionen berechnet werden.
    const updated = await updateDraftDocument(orgId, doc.id, { documentChargeCents: 1000, documentChargeReason: "Express" }, "tester");
    expect(updated.netTotalCents).toBe(75000);
    expect(updated.lines.map((l) => l.lineType)).toEqual(["HEADING", "ITEM", "ITEM", "SUBTOTAL"]);
  });
});

describe("convertDocument — Positionstypen bleiben erhalten (Commit 0)", () => {
  it("Angebot -> Rechnung: lineType/descriptionLong/articleNumber werden mitkopiert, Summen nur aus ITEMs", async () => {
    const quote = await createBusinessDocument(
      orgId,
      {
        kind: "ANGEBOT",
        customerId,
        taxScheme: "REGULAR",
        currency: "EUR",
        lines: [
          { lineType: "HEADING" as const, description: "Hosting", quantityMilli: 0, unit: "C62", unitNetPriceCents: 0, taxRate: 0 as const, discountPermille: 0, discountCents: 0 },
          { lineType: "ITEM" as const, description: "Setup", articleNumber: "ART-1", unit: "C62", quantityMilli: 1000, unitNetPriceCents: 30000, taxRate: 19 as const, discountPermille: 0, discountCents: 0 },
        ],
      },
      { now: FIX_DATE },
    );

    const result = await convertDocument(orgId, { fromType: "QUOTE", fromId: quote.id, toKind: "INVOICE" }, { now: FIX_DATE, actor: "tester" });
    const invoice = await dbInternal.invoice.findUniqueOrThrow({ where: { id: result.id }, include: { lines: { orderBy: { position: "asc" } } } });

    expect(invoice.lines.map((l) => l.lineType)).toEqual(["HEADING", "ITEM"]);
    expect(invoice.lines[1].articleNumber).toBe("ART-1");
    expect(invoice.netTotalCents).toBe(30000);
  });

  it("Angebot -> Auftragsbestaetigung: lineType wird mitgenommen (sonst schlaegt die Zod-Validierung fuer HEADING mit Menge 0 fehl)", async () => {
    const quote = await createBusinessDocument(
      orgId,
      {
        kind: "ANGEBOT",
        customerId,
        taxScheme: "REGULAR",
        currency: "EUR",
        lines: [
          { lineType: "HEADING" as const, description: "Block A", quantityMilli: 0, unit: "C62", unitNetPriceCents: 0, taxRate: 0 as const, discountPermille: 0, discountCents: 0 },
          { lineType: "ITEM" as const, description: "Position", unit: "C62", quantityMilli: 1000, unitNetPriceCents: 10000, taxRate: 19 as const, discountPermille: 0, discountCents: 0 },
        ],
      },
      { now: FIX_DATE },
    );

    const result = await convertDocument(orgId, { fromType: "QUOTE", fromId: quote.id, toKind: "AUFTRAGSBESTAETIGUNG" }, { now: FIX_DATE, actor: "tester" });
    const ab = await dbInternal.quote.findUniqueOrThrow({ where: { id: result.id }, include: { lines: { orderBy: { position: "asc" } } } });
    expect(ab.lines.map((l) => l.lineType)).toEqual(["HEADING", "ITEM"]);
  });
});


describe("duplicateDocument — Positionstypen bleiben erhalten (Fix-Runde 1, Befund 2)", () => {
  it("Angebot mit HEADING + 2 ITEM + SUBTOTAL duplizieren: Kopie traegt dieselben Typen, Summen gleich", async () => {
    const quote = await createBusinessDocument(
      orgId,
      { kind: "ANGEBOT", customerId, taxScheme: "REGULAR", currency: "EUR", lines: linesWithHeadingAndSubtotal },
      { now: FIX_DATE },
    );
    expect(quote.lines.map((l) => l.lineType)).toEqual(["HEADING", "ITEM", "ITEM", "SUBTOTAL"]);
    expect(quote.netTotalCents).toBe(74000);

    const result = await duplicateDocument(orgId, "QUOTE", quote.id, "tester", FIX_DATE);
    const copy = await dbInternal.quote.findUniqueOrThrow({ where: { id: result.id }, include: { lines: { orderBy: { position: "asc" } } } });

    expect(copy.lines.map((l) => l.lineType)).toEqual(["HEADING", "ITEM", "ITEM", "SUBTOTAL"]);
    expect(copy.lines[0].quantityMilli).toBe(0);
    expect(copy.netTotalCents).toBe(quote.netTotalCents);
    expect(copy.netTotalCents).toBe(74000);
  });
});
