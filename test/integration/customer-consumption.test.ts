/**
 * Phase 8a, Task 2 — Konsum der Kundenvorgaben (§28) bei Beleganlage, Snapshots
 * (Adresse/Ansprechpartner/Custom Fields, §29-§31), Platzhalter, Empfaenger-Prioritaet.
 *
 * Testjahr laut Plan-Header: 2060 (consumption/take-over).
 */
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { dbInternal } from "@/lib/db";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { updateNumberRange } from "@/domain/numbering/ranges";
import { createDraftInvoice } from "@/domain/invoice/create";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import { createBusinessDocument } from "@/domain/document/create";
import { createDeliveryNote, DeliveryNoteValidationError } from "@/domain/delivery-note/create";
import { createDownpaymentInvoice } from "@/domain/invoice/downpayment";
import { createPartialInvoice } from "@/domain/invoice/partial";
import { createFinalInvoice } from "@/domain/invoice/final";
import { buildTemplateContext } from "@/domain/email/context";
import { parseBuyerSnapshot, parseContactSnapshot, buildBuyerSnapshot } from "@/domain/snapshot";
import { createAddress } from "@/domain/customer/addresses";
import { createContact } from "@/domain/customer/contacts";
import { upsertCustomFieldDefinition, setCustomerCustomFields } from "@/domain/customer/custom-fields";
import { saveCustomerDefaults } from "@/domain/customer/defaults";
import type { CreateInvoiceInput } from "@/schemas";

let orgId: string;
const ISSUE = new Date("2060-03-01T10:00:00.000Z");

async function makeCustomer(overrides: Record<string, unknown> = {}) {
  return dbInternal.customer.create({
    data: {
      orgId,
      name: "Konsumtest AG " + Math.random(),
      addressLine1: "Kundenweg 1",
      postalCode: "54321",
      city: "Hamburg",
      type: "BUSINESS",
      ...overrides,
    },
  });
}

function baseInvoiceInput(customerId: string, extra: Partial<CreateInvoiceInput> = {}): CreateInvoiceInput {
  return {
    customerId,
    type: "INVOICE",
    taxScheme: "REGULAR",
    issueDate: ISSUE,
    deliveryDate: ISSUE,
    lines: [
      { lineType: "ITEM", description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 },
    ],
    ...extra,
  } as CreateInvoiceInput;
}

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "Konsumtest GmbH", addressLine1: "Hauptstr. 1", postalCode: "21339", city: "Lüneburg", vatId: "DE999888777" },
  });
  orgId = org.id;
  await ensureOrgMasterdata(dbInternal, orgId);
  // Invoice.number ist GLOBAL eindeutig (@unique, ueber alle Organisationen hinweg) —
  // mehrere Test-Dateien im selben Testjahr (2060, siehe Plan-Header) wuerden sonst beide
  // bei "RE-2060-0001" kollidieren (siehe test/unit/take-over.test.ts). Eigener Praefix.
  await updateNumberRange(orgId, "INVOICE", { pattern: "{PREFIX}{YYYY}-{SEQ}", prefix: "KTV-", seqPadding: 4, yearlyReset: true, nextValue: 1 }, "test", ISSUE);
});

afterAll(async () => {
  await dbInternal.$disconnect();
});

describe("Phase 8a — Konsum der Kundenvorgaben bei Rechnungsanlage (§28)", () => {
  it("Waehrung: Eingabe > Customer.defaultCurrency > Settings", async () => {
    const customer = await makeCustomer({ defaultCurrency: "CHF" });
    const draft = await createDraftInvoice(orgId, baseInvoiceInput(customer.id));
    expect(draft.currency).toBe("CHF");

    const explicit = await createDraftInvoice(orgId, baseInvoiceInput(customer.id, { currency: "USD" }));
    expect(explicit.currency).toBe("USD");
  });

  it("Rabatt: Customer.defaultDiscountPermille greift nur wenn BEIDE Rabattfelder fehlen", async () => {
    const customer = await makeCustomer({ defaultDiscountPermille: 100 });
    const draft = await createDraftInvoice(orgId, baseInvoiceInput(customer.id));
    expect(draft.documentDiscountPermille).toBe(100);

    // Explizit 0 gewinnt gegen die Kundenvorgabe (auch wenn 0 der "leere" Wert waere).
    const explicitZero = await createDraftInvoice(orgId, baseInvoiceInput(customer.id, { documentDiscountPermille: 0, documentDiscountCents: 0 }));
    expect(explicitZero.documentDiscountPermille).toBe(0);

    const explicitOverride = await createDraftInvoice(orgId, baseInvoiceInput(customer.id, { documentDiscountPermille: 50 }));
    expect(explicitOverride.documentDiscountPermille).toBe(50);
  });

  it("Bestellreferenz: Eingabe > Customer.orderReference (BT-13)", async () => {
    const customer = await makeCustomer({ orderReference: "PO-KUNDE-42" });
    const draft = await createDraftInvoice(orgId, baseInvoiceInput(customer.id));
    expect(draft.orderNumber).toBe("PO-KUNDE-42");

    const explicit = await createDraftInvoice(orgId, baseInvoiceInput(customer.id, { orderNumber: "PO-EXPLIZIT" }));
    expect(explicit.orderNumber).toBe("PO-EXPLIZIT");
  });

  it("Texte: Eingabe > Customer.paymentTermsText", async () => {
    const customer = await makeCustomer({ paymentTermsText: "Zahlbar sofort ohne Abzug." });
    const draft = await createDraftInvoice(orgId, baseInvoiceInput(customer.id));
    expect(draft.paymentTerms).toBe("Zahlbar sofort ohne Abzug.");

    const explicit = await createDraftInvoice(orgId, baseInvoiceInput(customer.id, { paymentTerms: "30 Tage netto." }));
    expect(explicit.paymentTerms).toBe("30 Tage netto.");
  });

  it("Adresse: Eingabe > Default BILLING/SHIPPING; explizites null uebernimmt keinen Default", async () => {
    const customer = await makeCustomer();
    const billing = await createAddress(orgId, customer.id, { type: "BILLING", addressLine1: "Rechnungsweg 1", postalCode: "11111", city: "Bremen", isDefault: true });
    const shipping = await createAddress(orgId, customer.id, { type: "SHIPPING", addressLine1: "Lagerweg 1", postalCode: "22222", city: "Kiel", isDefault: true });

    const draft = await createDraftInvoice(orgId, baseInvoiceInput(customer.id));
    expect(draft.billingAddressId).toBe(billing.id);
    expect(draft.shippingAddressId).toBe(shipping.id);

    const explicitNull = await createDraftInvoice(orgId, baseInvoiceInput(customer.id, { billingAddressId: null }));
    expect(explicitNull.billingAddressId).toBeNull();
  });

  it("Ansprechpartner: Eingabe > Default", async () => {
    const customer = await makeCustomer();
    const contact = await createContact(orgId, customer.id, { firstName: "Erika", lastName: "Musterfrau", isDefault: true });
    const draft = await createDraftInvoice(orgId, baseInvoiceInput(customer.id));
    expect(draft.contactPersonId).toBe(contact.id);
  });
});

describe("Phase 8a — Snapshot bei Festschreibung (§29-§31)", () => {
  it("Buyer-Snapshot enthaelt gewaehlte Adresse + Custom Fields; Kontakt-Snapshot gesetzt; Kundenaenderung wirkt nicht rueckwirkend", async () => {
    const customer = await makeCustomer();
    const billing = await createAddress(orgId, customer.id, { type: "BILLING", addressLine1: "Rechnungsweg 9", postalCode: "33333", city: "Rostock", isDefault: true });
    const contact = await createContact(orgId, customer.id, { firstName: "Max", lastName: "Beispiel", email: "max@beispiel.de", role: "Einkauf", isDefault: true });
    await upsertCustomFieldDefinition(orgId, { key: "vip", label: "VIP-Kunde", type: "BOOLEAN", required: false, sortOrder: 0, isActive: true });
    await setCustomerCustomFields(orgId, customer.id, { vip: true });

    const draft = await createDraftInvoice(orgId, baseInvoiceInput(customer.id));
    const finalized = await finalizeInvoice(draft.id, { now: ISSUE });

    expect(finalized.buyerSnapshotJson).toBeTruthy();
    const buyer = parseBuyerSnapshot(finalized.buyerSnapshotJson, buildBuyerSnapshot(customer), "test");
    expect(buyer.address).toMatchObject({ type: "BILLING", addressLine1: "Rechnungsweg 9", city: "Rostock" });
    expect(buyer.customFields).toMatchObject({ vip: true });

    expect(finalized.contactSnapshotJson).toBeTruthy();
    const contactSnapshot = parseContactSnapshot(finalized.contactSnapshotJson, null, "test");
    expect(contactSnapshot).toMatchObject({ firstName: "Max", lastName: "Beispiel", email: "max@beispiel.de", role: "Einkauf" });

    // Kundenstamm-Aenderung NACH Festschreibung darf den Snapshot nie veraendern (GoBD).
    await dbInternal.customer.update({ where: { id: customer.id }, data: { name: "Umbenannt GmbH" } });
    await dbInternal.customerAddress.update({ where: { id: billing.id }, data: { city: "Andere Stadt" } });
    await dbInternal.contactPerson.update({ where: { id: contact.id }, data: { firstName: "Geaendert" } });

    const refetched = await dbInternal.invoice.findUniqueOrThrow({ where: { id: finalized.id } });
    const buyerAfter = parseBuyerSnapshot(refetched.buyerSnapshotJson, buildBuyerSnapshot(customer), "test");
    expect(buyerAfter.name).not.toBe("Umbenannt GmbH");
    expect(buyerAfter.address?.city).toBe("Rostock");
    const contactAfter = parseContactSnapshot(refetched.contactSnapshotJson, null, "test");
    expect(contactAfter?.firstName).toBe("Max");
  });
});

describe("Phase 8a — Platzhalter aus Snapshot (§30/§31)", () => {
  it("contact.* und customField.<key> rendern aus dem Snapshot des Belegs", async () => {
    const customer = await makeCustomer();
    await createAddress(orgId, customer.id, { type: "BILLING", addressLine1: "Weg 1", postalCode: "10000", city: "Testort", isDefault: true });
    await createContact(orgId, customer.id, { firstName: "Petra", lastName: "Kontakt", email: "petra@kontakt.de", role: "Buchhaltung", phone: "030-1", isDefault: true });
    await upsertCustomFieldDefinition(orgId, { key: "branche", label: "Branche", type: "TEXT", required: false, sortOrder: 0, isActive: true });
    await setCustomerCustomFields(orgId, customer.id, { branche: "IT" });

    const draft = await createDraftInvoice(orgId, baseInvoiceInput(customer.id));
    const finalized = await finalizeInvoice(draft.id, { now: ISSUE });

    const { ctx } = await buildTemplateContext(orgId, "INVOICE", finalized.id);
    expect(ctx.contact).toMatchObject({ firstName: "Petra", lastName: "Kontakt", email: "petra@kontakt.de", role: "Buchhaltung", phone: "030-1" });
    expect((ctx.customer as { customField: Record<string, unknown> }).customField).toMatchObject({ branche: "IT" });
  });
});

describe("Phase 8a — Empfaenger-Prioritaet beim Mailversand (§28)", () => {
  it("Kontakt-E-Mail > Customer.invoiceEmail > Customer.email", async () => {
    const customer = await makeCustomer({ email: "stamm@kunde.de", invoiceEmail: "rechnung@kunde.de" });
    const draft = await createDraftInvoice(orgId, baseInvoiceInput(customer.id));
    const finalized = await finalizeInvoice(draft.id, { now: ISSUE });

    // Ohne Kontakt: invoiceEmail schlaegt customer.email.
    let result = await buildTemplateContext(orgId, "INVOICE", finalized.id);
    expect(result.customerEmail).toBe("rechnung@kunde.de");
    expect(result.customerCc).toBeNull();

    // Mit Kontakt (E-Mail gesetzt): Kontakt gewinnt gegen invoiceEmail.
    await dbInternal.customer.update({ where: { id: customer.id }, data: { invoiceCc: "cc@kunde.de" } });
    const contact = await createContact(orgId, customer.id, { firstName: "K", lastName: "Ontakt", email: "kontakt@kunde.de", isDefault: true });
    const draft2 = await createDraftInvoice(orgId, baseInvoiceInput(customer.id));
    expect(draft2.contactPersonId).toBe(contact.id);
    const finalized2 = await finalizeInvoice(draft2.id, { now: ISSUE });
    result = await buildTemplateContext(orgId, "INVOICE", finalized2.id);
    expect(result.customerEmail).toBe("kontakt@kunde.de");
    expect(result.customerCc).toBe("cc@kunde.de");
  });
});

describe("Phase 8a — Konsum bei Geschaeftsdokumenten (Angebot/AB/Proforma)", () => {
  it("Waehrung/Rabatt/Kundenreferenz/Lieferbedingungen: Eingabe > Kunde > Settings/TextTemplate", async () => {
    const customer = await makeCustomer({
      defaultCurrency: "CHF",
      defaultDiscountPermille: 75,
      orderReference: "KD-REF-1",
      deliveryTermsText: "Lieferung frei Haus.",
      paymentTermsText: "14 Tage netto.",
    });
    const doc = await createBusinessDocument(orgId, {
      kind: "ANGEBOT",
      customerId: customer.id,
      taxScheme: "REGULAR",
      lines: [{ lineType: "ITEM", description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
    });
    expect(doc.currency).toBe("CHF");
    expect(doc.documentDiscountPermille).toBe(75);
    expect(doc.customerReference).toBe("KD-REF-1");
    expect(doc.deliveryTerms).toBe("Lieferung frei Haus.");
    expect(doc.paymentTerms).toBe("14 Tage netto.");

    const explicit = await createBusinessDocument(orgId, {
      kind: "ANGEBOT",
      customerId: customer.id,
      taxScheme: "REGULAR",
      currency: "GBP",
      customerReference: "EXPLIZIT",
      lines: [{ lineType: "ITEM", description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
    });
    expect(explicit.currency).toBe("GBP");
    expect(explicit.customerReference).toBe("EXPLIZIT");
  });
});

describe("Phase 8a — Konsum bei Lieferscheinen (§29/§30)", () => {
  it("Default-Lieferadresse/-Ansprechpartner werden vorbelegt", async () => {
    const customer = await makeCustomer();
    const shipping = await createAddress(orgId, customer.id, { type: "SHIPPING", addressLine1: "Lagerhalle 3", postalCode: "44444", city: "Essen", isDefault: true });
    const contact = await createContact(orgId, customer.id, { firstName: "Lena", lastName: "Logistik", isDefault: true });

    const note = await createDeliveryNote(orgId, {
      customerId: customer.id,
      lines: [{ description: "Ware", quantityMilli: 1000, unit: "C62" }],
    });
    expect(note.shippingAddressId).toBe(shipping.id);
    expect(note.contactPersonId).toBe(contact.id);
    expect(note.contactSnapshotJson).toBeTruthy();
  });

  it("B2 (Fix-Welle): Buyer-Postfelder bleiben Firmensitz, Lieferadresse landet unter shippingAddress — vererbt sich korrekt in eine Teilrechnung", async () => {
    const customer = await makeCustomer({ addressLine1: "Firmensitz 1", postalCode: "10115", city: "Berlin" });
    const shipping = await createAddress(orgId, customer.id, { type: "SHIPPING", addressLine1: "Lagerhalle 7", postalCode: "99999", city: "Lagerstadt", isDefault: true });

    const note = await createDeliveryNote(orgId, {
      customerId: customer.id,
      lines: [{ description: "Ware", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 5000, taxRate: 19 }],
    });
    expect(note.shippingAddressId).toBe(shipping.id);
    const buyer = parseBuyerSnapshot(note.buyerSnapshotJson, buildBuyerSnapshot(customer), "test");
    expect(buyer.addressLine1).toBe("Firmensitz 1");
    expect(buyer.city).toBe("Berlin");
    expect(buyer.shippingAddress?.addressLine1).toBe("Lagerhalle 7");
    expect(buyer.shippingAddress?.city).toBe("Lagerstadt");

    const partial = await createPartialInvoice(
      orgId,
      { sourceType: "DELIVERY_NOTE", sourceId: note.id, mode: "PERCENT", permille: 1000 },
      { now: ISSUE },
    );
    const finalized = await finalizeInvoice(partial.id, { now: ISSUE });
    const partialBuyer = parseBuyerSnapshot(finalized.buyerSnapshotJson, buildBuyerSnapshot(customer), "test");
    // BG-8 (Rechnungsadresse des Kaeufers, aus den flachen Feldern) muss der Firmensitz
    // bleiben, NICHT die Lieferadresse — shippingAddress wird dafuer ignoriert.
    expect(partialBuyer.addressLine1).toBe("Firmensitz 1");
    expect(partialBuyer.city).toBe("Berlin");
  });
});

describe("Phase 8a — customerDefaultsFor gespeicherte Vorgaben wirken im Konsum", () => {
  it("saveCustomerDefaults + createDraftInvoice: Kunde ohne explizite Beleg-Eingabe erhaelt alle Vorgaben", async () => {
    const customer = await makeCustomer();
    await saveCustomerDefaults(orgId, customer.id, {
      defaultCurrency: "CHF",
      defaultDiscountPermille: 20,
      eInvoicePreferred: true,
      orderReference: "SAVED-REF",
      paymentTermsText: "Sofort faellig.",
      language: "de",
    });
    const draft = await createDraftInvoice(orgId, baseInvoiceInput(customer.id));
    expect(draft.currency).toBe("CHF");
    expect(draft.documentDiscountPermille).toBe(20);
    expect(draft.orderNumber).toBe("SAVED-REF");
    expect(draft.paymentTerms).toBe("Sofort faellig.");
  });
});

describe("Fix-Runde 1 (Koordinator) — Snapshot-Konsistenz Angebot -> Abschlag/Teil/Schluss", () => {
  it("Abschlags-, Teil- und Schlussrechnung erben Adresse/Ansprechpartner-Snapshot der Quelle, nicht die (spaeter geaenderten) Kunden-Defaults", async () => {
    const customer = await makeCustomer();
    const billing = await createAddress(orgId, customer.id, { type: "BILLING", addressLine1: "Quellenadresse 1", postalCode: "77777", city: "Quellstadt", isDefault: true });
    const contact = await createContact(orgId, customer.id, { firstName: "Original", lastName: "Ansprechpartner", email: "original@quelle.de", isDefault: true });

    const quote = await createBusinessDocument(orgId, {
      kind: "ANGEBOT",
      customerId: customer.id,
      taxScheme: "REGULAR",
      lines: [{ lineType: "ITEM", description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 100000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
    });
    expect(quote.billingAddressId).toBe(billing.id);
    expect(quote.contactPersonId).toBe(contact.id);

    // Zweite Quelle (fuer die Teilrechnung, s.u.) VOR der Kundenaenderung anlegen —
    // Teil- und Abschlagsrechnungen duerfen nicht auf derselben Quelle gemischt werden.
    const quote2 = await createBusinessDocument(orgId, {
      kind: "ANGEBOT",
      customerId: customer.id,
      taxScheme: "REGULAR",
      contactPersonId: contact.id,
      billingAddressId: billing.id,
      lines: [{ lineType: "ITEM", description: "Beratung 2", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 50000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
    });

    // Kundenstamm NACH Angebotserstellung aendern: Umbenennung + neuer Default-Kontakt.
    // Abschlag/Teil/Schluss duerfen davon NICHTS uebernehmen — sie muessen exakt den
    // Snapshot/die Adresse/den Kontakt des jeweiligen Angebots zeigen.
    await dbInternal.customer.update({ where: { id: customer.id }, data: { name: "Umbenannt nach Angebot GmbH" } });
    const newContact = await createContact(orgId, customer.id, { firstName: "Neu", lastName: "Kontakt", isDefault: true });
    expect(newContact.isDefault).toBe(true);

    const downpayment = await createDownpaymentInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "PERCENT", permille: 300 }, { now: ISSUE });
    expect(downpayment.billingAddressId).toBe(billing.id);
    expect(downpayment.contactPersonId).toBe(contact.id);
    expect(downpayment.snapshotSource).toBe("INHERITED");
    const dpBuyer = parseBuyerSnapshot(downpayment.buyerSnapshotJson, buildBuyerSnapshot(customer), "test");
    expect(dpBuyer.name).not.toBe("Umbenannt nach Angebot GmbH");
    const dpContact = parseContactSnapshot(downpayment.contactSnapshotJson, null, "test");
    expect(dpContact).toMatchObject({ firstName: "Original", lastName: "Ansprechpartner", email: "original@quelle.de" });

    const finalizedDownpayment = await finalizeInvoice(downpayment.id, { now: ISSUE });
    expect(finalizedDownpayment.status).toBe("FINALIZED");

    const finalInvoice = await createFinalInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id }, { now: ISSUE });
    expect(finalInvoice.billingAddressId).toBe(billing.id);
    expect(finalInvoice.contactPersonId).toBe(contact.id);
    expect(finalInvoice.snapshotSource).toBe("INHERITED");
    const finalContact = parseContactSnapshot(finalInvoice.contactSnapshotJson, null, "test");
    expect(finalContact).toMatchObject({ firstName: "Original", lastName: "Ansprechpartner" });

    // Teilrechnung auf der ZWEITEN Quelle (Teil-/Abschlagsrechnungen duerfen nicht auf
    // derselben Quelle gemischt werden, quote2 wurde oben VOR der Kundenaenderung angelegt)
    // — dieselbe Erbfolge.
    const partial = await createPartialInvoice(orgId, { sourceType: "QUOTE", sourceId: quote2.id, mode: "PERCENT", permille: 500 }, { now: ISSUE });
    expect(partial.billingAddressId).toBe(billing.id);
    expect(partial.contactPersonId).toBe(contact.id);
    expect(partial.snapshotSource).toBe("INHERITED");
    const partialBuyer = parseBuyerSnapshot(partial.buyerSnapshotJson, buildBuyerSnapshot(customer), "test");
    expect(partialBuyer.name).not.toBe("Umbenannt nach Angebot GmbH");
  });

  it("Nit (Fix-Welle): eine BILLING-Adresse als shippingAddressId wird abgelehnt (400/DeliveryNoteValidationError)", async () => {
    const customer = await makeCustomer();
    const billing = await createAddress(orgId, customer.id, { type: "BILLING", addressLine1: "Rechnungsadresse 1", postalCode: "11111", city: "Rechnungsstadt" });

    await expect(
      createDeliveryNote(orgId, {
        customerId: customer.id,
        shippingAddressId: billing.id,
        lines: [{ description: "Ware", quantityMilli: 1000, unit: "C62" }],
      }),
    ).rejects.toBeInstanceOf(DeliveryNoteValidationError);
  });

  it("B4 (Fix-Welle): finalizeInvoice behaelt den bei Anlage geerbten Snapshot einer Abschlagsrechnung bei (kein Live-Rebuild)", async () => {
    const customer = await makeCustomer({ name: "Vor-Umbenennung AG" });
    const quote = await createBusinessDocument(orgId, {
      kind: "ANGEBOT",
      customerId: customer.id,
      taxScheme: "REGULAR",
      lines: [{ lineType: "ITEM", description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 100000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
    });
    const downpayment = await createDownpaymentInvoice(orgId, { sourceType: "QUOTE", sourceId: quote.id, mode: "PERCENT", permille: 300 }, { now: ISSUE });
    expect(downpayment.snapshotSource).toBe("INHERITED");

    // Kunde NACH Angebots- und Abschlagsrechnungs-Anlage, aber VOR dem Festschreiben
    // umbenannt — die festgeschriebene Abschlagsrechnung muss trotzdem den alten Namen zeigen.
    await dbInternal.customer.update({ where: { id: customer.id }, data: { name: "Umbenannt nach Anlage GmbH" } });

    const finalized = await finalizeInvoice(downpayment.id, { now: ISSUE });
    expect(finalized.snapshotSource).toBe("INHERITED");
    const finalizedBuyer = parseBuyerSnapshot(finalized.buyerSnapshotJson, buildBuyerSnapshot(customer), "test");
    expect(finalizedBuyer.name).toBe("Vor-Umbenennung AG");
  });
});
