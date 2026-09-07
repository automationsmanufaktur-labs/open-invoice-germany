import { describe, it, expect, beforeAll } from "vitest";
import { dbInternal } from "@/lib/db";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { createBusinessDocument } from "@/domain/document/create";
import { createDeliveryNote } from "@/domain/delivery-note/create";
import { createDraftInvoice } from "@/domain/invoice/create";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import { recordPayment } from "@/domain/invoice/payment";
import { createDunning } from "@/domain/dunning/create";
import { createRecurring } from "@/domain/recurring/create";
import { linkDocuments } from "@/domain/relations";
import { duplicateDocument } from "@/domain/document/duplicate";
import { billingStateFor } from "@/domain/document/billing-state";
import { buildDocumentChain } from "@/domain/document/chain";
import type { CreateInvoiceInput } from "@/schemas";

let orgId: string;
let customerId: string;
const FIX_DATE = new Date("2031-07-01T10:00:00.000Z");

const line = { description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19 as const, taxCategory: "S" as const, discountPermille: 0, discountCents: 0 };

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: {
      legalName: "Kette Test GmbH",
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

async function invoiceInput(extra: Partial<CreateInvoiceInput> = {}): Promise<CreateInvoiceInput> {
  return {
    customerId,
    type: "INVOICE",
    taxScheme: "REGULAR",
    currency: "EUR",
    deliveryDate: FIX_DATE,
    lines: [line],
    ...extra,
  } as CreateInvoiceInput;
}

describe("billingStateFor", () => {
  it("liefert NONE ohne Relation", async () => {
    const quote = await createBusinessDocument(orgId, { kind: "ANGEBOT", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [line] } as Parameters<typeof createBusinessDocument>[1], { now: FIX_DATE });
    const result = await billingStateFor(orgId, "QUOTE", quote.id);
    expect(result.state).toBe("NONE");
    expect(result.invoiceIds).toHaveLength(0);
  });

  it("liefert FULL, wenn eine nicht-stornierte CONVERTED_TO-Rechnung existiert", async () => {
    const quote = await createBusinessDocument(orgId, { kind: "ANGEBOT", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [line] } as Parameters<typeof createBusinessDocument>[1], { now: FIX_DATE });
    const invoice = await createDraftInvoice(orgId, await invoiceInput(), { now: FIX_DATE });
    await dbInternal.$transaction((tx) =>
      linkDocuments(tx, { orgId, fromType: "QUOTE", fromId: quote.id, toType: "INVOICE", toId: invoice.id, relationType: "CONVERTED_TO" }),
    );
    const result = await billingStateFor(orgId, "QUOTE", quote.id);
    expect(result.state).toBe("FULL");
    expect(result.invoiceIds).toEqual([invoice.id]);
  });

  it("ignoriert eine stornierte Zielrechnung (bleibt NONE)", async () => {
    const quote = await createBusinessDocument(orgId, { kind: "ANGEBOT", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [line] } as Parameters<typeof createBusinessDocument>[1], { now: FIX_DATE });
    const invoice = await createDraftInvoice(orgId, await invoiceInput(), { now: FIX_DATE });
    await finalizeInvoice(invoice.id, { now: FIX_DATE });
    await dbInternal.invoice.update({ where: { id: invoice.id }, data: { status: "CANCELLED" } });
    await dbInternal.$transaction((tx) =>
      linkDocuments(tx, { orgId, fromType: "QUOTE", fromId: quote.id, toType: "INVOICE", toId: invoice.id, relationType: "CONVERTED_TO" }),
    );
    const result = await billingStateFor(orgId, "QUOTE", quote.id);
    expect(result.state).toBe("NONE");
  });
});

describe("buildDocumentChain", () => {
  it("baut den Baum Angebot -> AB -> Lieferschein -> Rechnung -> Zahlung und liefert currentId", async () => {
    const quote = await createBusinessDocument(orgId, { kind: "ANGEBOT", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [line] } as Parameters<typeof createBusinessDocument>[1], { now: FIX_DATE });
    const ab = await createBusinessDocument(orgId, { kind: "AUFTRAGSBESTAETIGUNG", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [line] } as Parameters<typeof createBusinessDocument>[1], { now: FIX_DATE });
    const note = await createDeliveryNote(orgId, { customerId, showPrices: false, showTax: false, showArticleNumber: true, showDescription: true, lines: [{ description: "Paket", quantityMilli: 1000, unit: "C62" }] } as Parameters<typeof createDeliveryNote>[1], { now: FIX_DATE });
    const invoice = await createDraftInvoice(orgId, await invoiceInput(), { now: FIX_DATE });
    const finalized = await finalizeInvoice(invoice.id, { now: FIX_DATE });
    await recordPayment(finalized.id, { amountCents: Math.floor(finalized.grossTotalCents / 2), method: "TRANSFER", isSkonto: false, applySkonto: false }, { now: FIX_DATE });
    const { dunning } = await createDunning(finalized.id, { now: new Date("2031-08-15T00:00:00.000Z") });

    await dbInternal.$transaction(async (tx) => {
      await linkDocuments(tx, { orgId, fromType: "QUOTE", fromId: quote.id, toType: "QUOTE", toId: ab.id, relationType: "CONVERTED_TO" });
      await linkDocuments(tx, { orgId, fromType: "QUOTE", fromId: ab.id, toType: "DELIVERY_NOTE", toId: note.id, relationType: "GENERATED_BY" });
      await linkDocuments(tx, { orgId, fromType: "QUOTE", fromId: ab.id, toType: "INVOICE", toId: finalized.id, relationType: "CONVERTED_TO" });
    });

    const { root, currentId } = await buildDocumentChain(orgId, "INVOICE", finalized.id);
    expect(currentId).toBe(finalized.id);
    expect(root.type).toBe("QUOTE");
    expect(root.id).toBe(quote.id);

    const abNode = root.children.find((c) => c.id === ab.id);
    expect(abNode).toBeDefined();
    expect(abNode!.type).toBe("QUOTE");

    const noteNode = abNode!.children.find((c) => c.type === "DELIVERY_NOTE");
    expect(noteNode?.id).toBe(note.id);

    const invoiceNode = abNode!.children.find((c) => c.type === "INVOICE");
    expect(invoiceNode?.id).toBe(finalized.id);
    expect(invoiceNode?.href).toBe(`/rechnungen/${finalized.id}`);

    const paymentNode = invoiceNode!.children.find((c) => c.type === "PAYMENT");
    expect(paymentNode).toBeDefined();
    expect(paymentNode!.href).toBeNull();

    const dunningNode = invoiceNode!.children.find((c) => c.type === "DUNNING");
    expect(dunningNode?.id).toBe(dunning.id);
    expect(dunningNode?.href).toBe(`/rechnungen/${finalized.id}`);
  });

  it("liefert leere/geworfene Kette bei fremder Org", async () => {
    const quote = await createBusinessDocument(orgId, { kind: "ANGEBOT", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [line] } as Parameters<typeof createBusinessDocument>[1], { now: FIX_DATE });
    const otherOrg = await dbInternal.organization.create({ data: { legalName: "Fremde GmbH", addressLine1: "X", postalCode: "1", city: "Y" } });
    await expect(buildDocumentChain(otherOrg.id, "QUOTE", quote.id)).rejects.toThrow();
  });

  it("terminiert bei einem Zyklus (A -> B, B -> A)", async () => {
    const a = await createBusinessDocument(orgId, { kind: "ANGEBOT", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [line] } as Parameters<typeof createBusinessDocument>[1], { now: FIX_DATE });
    const b = await createBusinessDocument(orgId, { kind: "AUFTRAGSBESTAETIGUNG", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [line] } as Parameters<typeof createBusinessDocument>[1], { now: FIX_DATE });

    await dbInternal.$transaction(async (tx) => {
      await linkDocuments(tx, { orgId, fromType: "QUOTE", fromId: a.id, toType: "QUOTE", toId: b.id, relationType: "CONVERTED_TO" });
      await linkDocuments(tx, { orgId, fromType: "QUOTE", fromId: b.id, toType: "QUOTE", toId: a.id, relationType: "DUPLICATED_FROM" });
    });

    const { root } = await buildDocumentChain(orgId, "QUOTE", a.id);
    expect(root).toBeDefined();
  });

  it("G6 (Fix-Runde 2): Original oeffnen -> Wurzel ist das Original, Kopie erscheint als Blatt 'Kopie'", async () => {
    const quote = await createBusinessDocument(orgId, { kind: "ANGEBOT", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [line] } as Parameters<typeof createBusinessDocument>[1], { now: FIX_DATE });
    const copy = await duplicateDocument(orgId, "QUOTE", quote.id, "tester", FIX_DATE);

    const { root, currentId } = await buildDocumentChain(orgId, "QUOTE", quote.id);
    expect(currentId).toBe(quote.id);
    expect(root.type).toBe("QUOTE");
    expect(root.id).toBe(quote.id); // NICHT die Kopie

    const copyNode = root.children.find((c) => c.id === copy.id);
    expect(copyNode).toBeDefined();
    expect(copyNode!.relation).toBe("Kopie");
    expect(copyNode!.children).toHaveLength(0); // kein Abstieg in die Kopie
  });

  it("G6 (Fix-Runde 2): Kopie oeffnen -> die Quelle erscheint als Blatt 'Kopie von', kein Abstieg", async () => {
    const quote = await createBusinessDocument(orgId, { kind: "ANGEBOT", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [line] } as Parameters<typeof createBusinessDocument>[1], { now: FIX_DATE });
    const copy = await duplicateDocument(orgId, "QUOTE", quote.id, "tester", FIX_DATE);

    const { root, currentId } = await buildDocumentChain(orgId, "QUOTE", copy.id);
    expect(currentId).toBe(copy.id);
    expect(root.id).toBe(copy.id); // Kopie hat selbst keinen Vorgaenger (DUPLICATED_FROM zaehlt nicht)

    const sourceNode = root.children.find((c) => c.id === quote.id);
    expect(sourceNode).toBeDefined();
    expect(sourceNode!.relation).toBe("Kopie von");
    expect(sourceNode!.children).toHaveLength(0);
  });

  it("zeigt ein Abo als Wurzelknoten mit Label 'Abo' und href /abos/<id>", async () => {
    const rec = await createRecurring(orgId, {
      customerId,
      title: "Wartungsvertrag Kette",
      interval: "MONTHLY",
      intervalCount: 1,
      startDate: FIX_DATE,
      taxScheme: "REGULAR",
      currency: "EUR",
      paymentTermsDays: 14,
      autoFinalize: false,
      lines: [line],
    });
    const invoice = await createDraftInvoice(orgId, await invoiceInput(), { now: FIX_DATE });

    await dbInternal.$transaction((tx) =>
      linkDocuments(tx, { orgId, fromType: "RECURRING", fromId: rec.id, toType: "INVOICE", toId: invoice.id, relationType: "GENERATED_BY" }),
    );

    const { root } = await buildDocumentChain(orgId, "RECURRING", rec.id);
    expect(root.type).toBe("RECURRING");
    expect(root.id).toBe(rec.id);
    expect(root.label).toBe("Abo");
    expect(root.href).toBe(`/abos/${rec.id}`);

    const invoiceNode = root.children.find((c) => c.type === "INVOICE");
    expect(invoiceNode?.id).toBe(invoice.id);
  });
});
