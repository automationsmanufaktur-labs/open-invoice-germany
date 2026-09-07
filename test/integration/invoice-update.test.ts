/**
 * updateDraftInvoice (Task 3): nur DRAFT editierbar, Kopffelder + Positionen (Typen) +
 * Rabatte/Skonto/Zahlungsmethode (Phase 4a), Snapshot-Regel wie updateDraftDocument,
 * ChangeLog UPDATE. Testjahr 2035.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { dbInternal } from "@/lib/db";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { createDraftInvoice } from "@/domain/invoice/create";
import { createInvoiceSchema } from "@/schemas";
import { updateDraftInvoice, InvoiceUpdateError } from "@/domain/invoice/update";
import { NotFoundError } from "@/domain/errors";
import { verifyChain, type ChainEntry } from "@/domain/changelog";

const FIX_DATE = new Date("2035-05-01T10:00:00.000Z");

let orgId: string;
let otherOrgId: string;
let customerId: string;
let contactPersonId: string;
let billingAddressId: string;
let paymentMethodId: string;

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "Editor GmbH", addressLine1: "Hauptstr. 1", postalCode: "21339", city: "Lüneburg", vatId: "DE123456789", taxNumber: "33/123/45678" },
  });
  orgId = org.id;
  await ensureOrgMasterdata(dbInternal, orgId);
  const other = await dbInternal.organization.create({ data: { legalName: "Fremde GmbH", addressLine1: "X", postalCode: "1", city: "X" } });
  otherOrgId = other.id;

  const customer = await dbInternal.customer.create({
    data: { orgId, name: "Kunde AG", addressLine1: "Marktplatz 2", postalCode: "20095", city: "Hamburg", type: "BUSINESS" },
  });
  customerId = customer.id;
  const contact = await dbInternal.contactPerson.create({ data: { orgId, customerId, firstName: "Anna", lastName: "Muster" } });
  contactPersonId = contact.id;
  const billing = await dbInternal.customerAddress.create({ data: { orgId, customerId, type: "BILLING", addressLine1: "Rechnungsweg 1", postalCode: "20095", city: "Hamburg" } });
  billingAddressId = billing.id;
  const method = await dbInternal.paymentMethod.create({ data: { orgId, code: "UEBERWEISUNG_TEST", name: "Ueberweisung (Test)", untdidCode: "58" } });
  paymentMethodId = method.id;
});

async function draftInvoice() {
  return createDraftInvoice(
    orgId,
    createInvoiceSchema.parse({
      customerId,
      lines: [{ description: "Beratung", quantityMilli: 1000, unitNetPriceCents: 10000, taxRate: 19 }],
    }),
    { now: FIX_DATE },
  );
}

describe("updateDraftInvoice — Kopffelder, Positionen, Rabatt/Skonto/Zahlungsmethode", () => {
  it("aktualisiert Kopffelder und schreibt ChangeLog UPDATE", async () => {
    const invoice = await draftInvoice();
    const before = await dbInternal.changeLog.count({ where: { orgId } });

    const updated = await updateDraftInvoice(
      orgId,
      invoice.id,
      { subject: "Neuer Betreff", orderNumber: "BEST-1", internalReference: "KST-1", contactPersonId, billingAddressId },
      "tester",
    );
    expect(updated.subject).toBe("Neuer Betreff");
    expect(updated.orderNumber).toBe("BEST-1");
    expect(updated.internalReference).toBe("KST-1");
    expect(updated.contactPersonId).toBe(contactPersonId);
    expect(updated.billingAddressId).toBe(billingAddressId);

    const after = await dbInternal.changeLog.count({ where: { orgId } });
    expect(after).toBe(before + 1);
    const log = await dbInternal.changeLog.findFirst({ where: { orgId, entity: "INVOICE", entityId: invoice.id, action: "UPDATE" } });
    expect(log).not.toBeNull();
  });

  it("ersetzt Positionen inkl. lineType/descriptionLong/articleNumber, Summen nur aus ITEMs", async () => {
    const invoice = await draftInvoice();

    const updated = await updateDraftInvoice(
      orgId,
      invoice.id,
      {
        lines: [
          { lineType: "HEADING", description: "Block A", quantityMilli: 0, unitNetPriceCents: 0, taxRate: 0 },
          { lineType: "ITEM", description: "Setup", articleNumber: "ART-9", descriptionLong: "Details zur Einrichtung", quantityMilli: 1000, unitNetPriceCents: 20000, taxRate: 19 },
          { lineType: "SUBTOTAL", description: "Zwischensumme", quantityMilli: 0, unitNetPriceCents: 0, taxRate: 0 },
        ],
      },
      "tester",
    );

    expect(updated.lines.map((l) => l.lineType)).toEqual(["HEADING", "ITEM", "SUBTOTAL"]);
    expect(updated.lines[1].articleNumber).toBe("ART-9");
    expect(updated.lines[1].descriptionLong).toBe("Details zur Einrichtung");
    expect(updated.netTotalCents).toBe(20000);
  });

  it("uebernimmt Rabatt/Skonto/Zahlungsmethode (Phase 4a) und berechnet Summen neu, auch ohne neue Positionen", async () => {
    const invoice = await draftInvoice();

    const updated = await updateDraftInvoice(
      orgId,
      invoice.id,
      {
        documentDiscountPermille: 100,
        skonto1Permille: 20,
        skonto1Days: 10,
        paymentMethodId,
      },
      "tester",
    );

    expect(updated.skonto1Permille).toBe(20);
    expect(updated.skonto1Days).toBe(10);
    expect(updated.paymentMethodId).toBe(paymentMethodId);
    // 100,00 € Netto - 10% Beleg-Rabatt = 90,00 €.
    expect(updated.netTotalCents).toBe(9000);
  });

  it("lehnt eine fremde Zahlungsmethode ab", async () => {
    const invoice = await draftInvoice();
    const foreignMethod = await dbInternal.paymentMethod.create({ data: { orgId: otherOrgId, code: "FREMD", name: "Fremd", untdidCode: "58" } });
    await expect(updateDraftInvoice(orgId, invoice.id, { paymentMethodId: foreignMethod.id }, "tester")).rejects.toThrow();
  });

  it("lehnt einen fremden Ansprechpartner ab", async () => {
    const invoice = await draftInvoice();
    const foreignContact = await dbInternal.contactPerson.create({ data: { orgId: otherOrgId, customerId, firstName: "F", lastName: "F" } });
    await expect(updateDraftInvoice(orgId, invoice.id, { contactPersonId: foreignContact.id }, "tester")).rejects.toThrow();
  });
});

describe("updateDraftInvoice — Fix-Runde 1: Ansprechpartner/Adressen kundengeprueft", () => {
  it("lehnt einen Ansprechpartner eines ANDEREN Kunden derselben Org ab", async () => {
    const invoice = await draftInvoice();
    const otherCustomer = await dbInternal.customer.create({
      data: { orgId, name: "Kunde B GmbH", addressLine1: "Nebenstr. 1", postalCode: "20095", city: "Hamburg", type: "BUSINESS" },
    });
    const contactOfOtherCustomer = await dbInternal.contactPerson.create({
      data: { orgId, customerId: otherCustomer.id, firstName: "Bea", lastName: "Fremdkunde" },
    });
    await expect(updateDraftInvoice(orgId, invoice.id, { contactPersonId: contactOfOtherCustomer.id }, "tester")).rejects.toThrow(NotFoundError);
  });

  it("lehnt eine Rechnungsadresse eines ANDEREN Kunden derselben Org ab", async () => {
    const invoice = await draftInvoice();
    const otherCustomer = await dbInternal.customer.create({
      data: { orgId, name: "Kunde C GmbH", addressLine1: "Nebenstr. 2", postalCode: "20095", city: "Hamburg", type: "BUSINESS" },
    });
    const addressOfOtherCustomer = await dbInternal.customerAddress.create({
      data: { orgId, customerId: otherCustomer.id, type: "BILLING", addressLine1: "Fremdweg 1", postalCode: "20095", city: "Hamburg" },
    });
    await expect(updateDraftInvoice(orgId, invoice.id, { billingAddressId: addressOfOtherCustomer.id }, "tester")).rejects.toThrow(NotFoundError);
  });

  it("akzeptiert Ansprechpartner/Adresse des NEUEN Kunden, wenn customerId im selben Aufruf gewechselt wird", async () => {
    const invoice = await draftInvoice();
    const otherCustomer = await dbInternal.customer.create({
      data: { orgId, name: "Kunde D GmbH", addressLine1: "Nebenstr. 3", postalCode: "20095", city: "Hamburg", type: "BUSINESS" },
    });
    const contactOfOtherCustomer = await dbInternal.contactPerson.create({
      data: { orgId, customerId: otherCustomer.id, firstName: "Dora", lastName: "Neukunde" },
    });
    const updated = await updateDraftInvoice(
      orgId,
      invoice.id,
      { customerId: otherCustomer.id, contactPersonId: contactOfOtherCustomer.id },
      "tester",
    );
    expect(updated.customerId).toBe(otherCustomer.id);
    expect(updated.contactPersonId).toBe(contactOfOtherCustomer.id);
  });
});

describe("updateDraftInvoice — Fix-Welle (K2): Referenzen bei Kundenwechsel", () => {
  it("setzt Ansprechpartner/Rechnungs-/Lieferadresse serverseitig auf null, wenn der Kunde gewechselt wird und die Felder nicht mitgesendet werden", async () => {
    const invoice = await draftInvoice();
    const withRefs = await updateDraftInvoice(orgId, invoice.id, { contactPersonId, billingAddressId }, "tester");
    expect(withRefs.contactPersonId).toBe(contactPersonId);
    expect(withRefs.billingAddressId).toBe(billingAddressId);

    const otherCustomer = await dbInternal.customer.create({
      data: { orgId, name: "Kunde K2 GmbH", addressLine1: "Nebenstr. 9", postalCode: "20095", city: "Hamburg", type: "BUSINESS" },
    });
    // Kundenwechsel OHNE contactPersonId/billingAddressId/shippingAddressId im Aufruf ->
    // die alten Referenzen (gehoerten zum vorherigen Kunden) werden serverseitig genullt.
    const updated = await updateDraftInvoice(orgId, invoice.id, { customerId: otherCustomer.id }, "tester");
    expect(updated.customerId).toBe(otherCustomer.id);
    expect(updated.contactPersonId).toBeNull();
    expect(updated.billingAddressId).toBeNull();
    expect(updated.shippingAddressId).toBeNull();
  });

  it("lehnt eine fremde Referenz beim Kundenwechsel ab (gehoert nicht zum neuen Kunden)", async () => {
    const invoice = await draftInvoice();
    const otherCustomer = await dbInternal.customer.create({
      data: { orgId, name: "Kunde K2b GmbH", addressLine1: "Nebenstr. 10", postalCode: "20095", city: "Hamburg", type: "BUSINESS" },
    });
    // contactPersonId gehoert zum ALTEN Kunden, nicht zum neuen -> Fehler.
    await expect(
      updateDraftInvoice(orgId, invoice.id, { customerId: otherCustomer.id, contactPersonId }, "tester"),
    ).rejects.toThrow(NotFoundError);
  });

  it("setzt ein Feld explizit auf null, wenn null gesendet wird (ohne Kundenwechsel)", async () => {
    const invoice = await draftInvoice();
    const withRefs = await updateDraftInvoice(orgId, invoice.id, { contactPersonId, billingAddressId }, "tester");
    expect(withRefs.contactPersonId).toBe(contactPersonId);

    const cleared = await updateDraftInvoice(orgId, invoice.id, { contactPersonId: null, billingAddressId: null }, "tester");
    expect(cleared.contactPersonId).toBeNull();
    expect(cleared.billingAddressId).toBeNull();
  });
});

describe("updateDraftInvoice — Fix-Runde 1: type unveraenderbar", () => {
  it("ignoriert ein mitgesendetes type-Feld (Zod streift unbekannte Felder, kein Fehler) und laesst die Rechnungsart unveraendert", async () => {
    const invoice = await draftInvoice();
    expect(invoice.type).toBe("INVOICE");

    const updated = await updateDraftInvoice(orgId, invoice.id, { type: "CREDIT_NOTE", subject: "Trotzdem aktualisiert" } as never, "tester");
    expect(updated.type).toBe("INVOICE");
    expect(updated.subject).toBe("Trotzdem aktualisiert");

    const reloaded = await dbInternal.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(reloaded.type).toBe("INVOICE");
  });
});

describe("updateDraftInvoice — GoBD: nur DRAFT", () => {
  it("verweigert die Bearbeitung einer FINALIZED-Rechnung", async () => {
    const invoice = await draftInvoice();
    await dbInternal.invoice.update({ where: { id: invoice.id }, data: { status: "FINALIZED", number: `TEST-${invoice.id}` } });

    await expect(updateDraftInvoice(orgId, invoice.id, { subject: "Sollte scheitern" }, "tester")).rejects.toThrow(InvoiceUpdateError);
  });

  it("wirft NotFoundError fuer eine unbekannte oder fremde Rechnung", async () => {
    const invoice = await draftInvoice();
    await expect(updateDraftInvoice(otherOrgId, invoice.id, { subject: "x" }, "tester")).rejects.toThrow(NotFoundError);
    await expect(updateDraftInvoice(orgId, "unbekannt", { subject: "x" }, "tester")).rejects.toThrow(NotFoundError);
  });
});

describe("updateDraftInvoice — Snapshot-Regel (MIGRATION-Altbeleg)", () => {
  it("aktualisiert einen MIGRATION-Snapshot, wenn sich der Kunde/Ansprechpartner aendert", async () => {
    const invoice = await draftInvoice();
    const migratedBuyerSnapshot = JSON.stringify({ name: "Alter Name GmbH", addressLine1: "Alte Str. 1", postalCode: "00000", city: "Altstadt", countryCode: "DE" });
    await dbInternal.invoice.update({
      where: { id: invoice.id },
      data: { snapshotSource: "MIGRATION", buyerSnapshotJson: migratedBuyerSnapshot },
    });

    const updated = await updateDraftInvoice(orgId, invoice.id, { contactPersonId }, "tester");
    const snapshot = JSON.parse(updated.buyerSnapshotJson!);
    expect(snapshot.name).toBe("Kunde AG");
  });
});

describe("ChangeLog-Kette bleibt gueltig", () => {
  it("verifyChain bestaetigt die Kette", async () => {
    const entries = (await dbInternal.changeLog.findMany({ where: { orgId }, orderBy: { id: "asc" } })).map(
      (e): ChainEntry => ({ prevHash: e.prevHash, hash: e.hash, payload: { entity: e.entity, entityId: e.entityId, action: e.action, actor: e.actor, at: e.at.toISOString(), diff: JSON.parse(e.diffJson) } }),
    );
    expect(verifyChain(entries).valid).toBe(true);
  });
});
