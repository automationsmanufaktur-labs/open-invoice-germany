/**
 * Phase 8a, Task 1 — Kundendomain: Adressen (§29), Ansprechpartner (§30),
 * benutzerdefinierte Kundenfelder (§31), Kundenvorgaben (§28).
 *
 * Testjahr laut Plan-Header: 2059 (customer-domain).
 */
import { describe, it, expect } from "vitest";
import { dbInternal } from "@/lib/db";
import { NotFoundError, InvalidOperationError } from "@/domain/errors";
import {
  listAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
  defaultAddressFor,
} from "@/domain/customer/addresses";
import {
  listContacts,
  createContact,
  updateContact,
  deleteContact,
  setDefaultContact,
  defaultContactFor,
} from "@/domain/customer/contacts";
import {
  listCustomFieldDefinitions,
  upsertCustomFieldDefinition,
  deleteCustomFieldDefinition,
  reorderCustomFields,
  parseCustomerCustomFields,
  setCustomerCustomFields,
} from "@/domain/customer/custom-fields";
import { saveCustomerDefaults, customerDefaultsFor } from "@/domain/customer/defaults";

async function makeOrg() {
  return dbInternal.organization.create({
    data: {
      legalName: "Kundenkomfort Test GmbH",
      addressLine1: "Teststr. 1",
      postalCode: "12345",
      city: "Berlin",
      vatId: "DE999999998",
    },
  });
}

async function makeCustomer(orgId: string) {
  return dbInternal.customer.create({
    data: { orgId, name: "Testkunde " + Math.random(), addressLine1: "Kundenweg 1", postalCode: "54321", city: "Hamburg" },
  });
}

describe("Phase 8a — addresses.ts (§29)", () => {
  it("listAddresses wirft NotFoundError fuer unbekannten Kunden", async () => {
    const org = await makeOrg();
    await expect(listAddresses(org.id, "does-not-exist")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("createAddress: erste SHIPPING-Adresse mit isDefault=true wird Default", async () => {
    const org = await makeOrg();
    const customer = await makeCustomer(org.id);
    const addr = await createAddress(org.id, customer.id, {
      type: "SHIPPING",
      addressLine1: "Lagerstr. 1",
      postalCode: "11111",
      city: "Bremen",
      isDefault: true,
    });
    expect(addr.isDefault).toBe(true);
    expect(await defaultAddressFor(org.id, customer.id, "SHIPPING")).toMatchObject({ id: addr.id });
  });

  it("Default-Wechsel: eine neue Default-Adresse desselben Typs setzt die alte zurueck", async () => {
    const org = await makeOrg();
    const customer = await makeCustomer(org.id);
    const first = await createAddress(org.id, customer.id, {
      type: "BILLING",
      addressLine1: "Rechnungsweg 1",
      postalCode: "22222",
      city: "Kiel",
      isDefault: true,
    });
    const second = await createAddress(org.id, customer.id, {
      type: "BILLING",
      addressLine1: "Rechnungsweg 2",
      postalCode: "22223",
      city: "Kiel",
      isDefault: true,
    });
    const list = await listAddresses(org.id, customer.id);
    const reloadedFirst = list.find((a) => a.id === first.id)!;
    const reloadedSecond = list.find((a) => a.id === second.id)!;
    expect(reloadedFirst.isDefault).toBe(false);
    expect(reloadedSecond.isDefault).toBe(true);

    // setDefaultAddress verdraengt ebenfalls den bisherigen Default.
    const backToFirst = await setDefaultAddress(org.id, customer.id, first.id);
    expect(backToFirst.isDefault).toBe(true);
    expect((await dbInternal.customerAddress.findUniqueOrThrow({ where: { id: second.id } })).isDefault).toBe(false);
  });

  it("updateAddress mit isDefault=true auf einen anderen Typ laesst den Default des alten Typs unberuehrt", async () => {
    const org = await makeOrg();
    const customer = await makeCustomer(org.id);
    const billing = await createAddress(org.id, customer.id, {
      type: "BILLING",
      addressLine1: "B 1",
      postalCode: "1",
      city: "X",
      isDefault: true,
    });
    const other = await createAddress(org.id, customer.id, {
      type: "OTHER",
      addressLine1: "O 1",
      postalCode: "2",
      city: "Y",
    });
    const updated = await updateAddress(org.id, customer.id, other.id, {
      type: "OTHER",
      addressLine1: "O 1 aktualisiert",
      postalCode: "2",
      city: "Y",
      isDefault: true,
    });
    expect(updated.isDefault).toBe(true);
    expect((await dbInternal.customerAddress.findUniqueOrThrow({ where: { id: billing.id } })).isDefault).toBe(true);
  });

  it("deleteAddress: Beleg-FK wird SetNull, Snapshot des Belegs bleibt unveraendert", async () => {
    const org = await makeOrg();
    const customer = await makeCustomer(org.id);
    const addr = await createAddress(org.id, customer.id, {
      type: "BILLING",
      addressLine1: "Loeschadresse 1",
      postalCode: "3",
      city: "Z",
    });
    const snapshotJson = JSON.stringify({ addressLine1: "Loeschadresse 1 (Snapshot)" });
    const invoice = await dbInternal.invoice.create({
      data: {
        orgId: org.id,
        customerId: customer.id,
        status: "FINALIZED",
        billingAddressId: addr.id,
        buyerSnapshotJson: snapshotJson,
        snapshotSource: "FINALIZE",
      },
    });

    await deleteAddress(org.id, customer.id, addr.id);

    const reloadedInvoice = await dbInternal.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(reloadedInvoice.billingAddressId).toBeNull();
    expect(reloadedInvoice.buyerSnapshotJson).toBe(snapshotJson);
    await expect(dbInternal.customerAddress.findUniqueOrThrow({ where: { id: addr.id } })).rejects.toThrow();
  });

  it("deleteAddress auf unbekannte Id wirft NotFoundError", async () => {
    const org = await makeOrg();
    const customer = await makeCustomer(org.id);
    await expect(deleteAddress(org.id, customer.id, "does-not-exist")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("Phase 8a — contacts.ts (§30)", () => {
  it("Default-Wechsel setzt den alten Default zurueck (kundenweit, nicht typgebunden)", async () => {
    const org = await makeOrg();
    const customer = await makeCustomer(org.id);
    const first = await createContact(org.id, customer.id, { firstName: "Anna", lastName: "Erste", isDefault: true });
    const second = await createContact(org.id, customer.id, { firstName: "Bert", lastName: "Zweiter", isDefault: true });

    const list = await listContacts(org.id, customer.id);
    expect(list.map((c) => c.id).sort()).toEqual([first.id, second.id].sort());
    expect((await dbInternal.contactPerson.findUniqueOrThrow({ where: { id: first.id } })).isDefault).toBe(false);
    expect((await dbInternal.contactPerson.findUniqueOrThrow({ where: { id: second.id } })).isDefault).toBe(true);
    expect(await defaultContactFor(org.id, customer.id)).toMatchObject({ id: second.id });
  });

  it("listContacts wirft NotFoundError fuer unbekannten Kunden", async () => {
    const org = await makeOrg();
    await expect(listContacts(org.id, "does-not-exist")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("deleteContact: Beleg-FK wird SetNull", async () => {
    const org = await makeOrg();
    const customer = await makeCustomer(org.id);
    const contact = await createContact(org.id, customer.id, { firstName: "Carla", lastName: "Kontakt" });
    const quote = await dbInternal.quote.create({ data: { orgId: org.id, customerId: customer.id, contactPersonId: contact.id } });

    await deleteContact(org.id, customer.id, contact.id);

    expect((await dbInternal.quote.findUniqueOrThrow({ where: { id: quote.id } })).contactPersonId).toBeNull();
  });

  it("updateContact auf unbekannte Id wirft NotFoundError", async () => {
    const org = await makeOrg();
    const customer = await makeCustomer(org.id);
    await expect(
      updateContact(org.id, customer.id, "does-not-exist", { firstName: "X", lastName: "Y" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("setDefaultContact auf unbekannte Id wirft NotFoundError", async () => {
    const org = await makeOrg();
    const customer = await makeCustomer(org.id);
    await expect(setDefaultContact(org.id, customer.id, "does-not-exist")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("Phase 8a — custom-fields.ts (§31)", () => {
  it("upsertCustomFieldDefinition legt an, listCustomFieldDefinitions liefert sortiert", async () => {
    const org = await makeOrg();
    await upsertCustomFieldDefinition(org.id, { key: "b_feld", label: "B", type: "TEXT", sortOrder: 1 });
    await upsertCustomFieldDefinition(org.id, { key: "a_feld", label: "A", type: "TEXT", sortOrder: 0 });
    const list = await listCustomFieldDefinitions(org.id);
    expect(list.map((d) => d.key)).toEqual(["a_feld", "b_feld"]);
  });

  it("upsertCustomFieldDefinition lehnt doppelten key je Organisation ab (409)", async () => {
    const org = await makeOrg();
    await upsertCustomFieldDefinition(org.id, { key: "dup_feld", label: "Dup", type: "TEXT" });
    await expect(upsertCustomFieldDefinition(org.id, { key: "dup_feld", label: "Dup 2", type: "TEXT" })).rejects.toBeInstanceOf(
      InvalidOperationError,
    );
  });

  it("upsertCustomFieldDefinition mit id aktualisiert, ohne Konflikt gegen sich selbst", async () => {
    const org = await makeOrg();
    const created = await upsertCustomFieldDefinition(org.id, { key: "aendern", label: "Alt", type: "TEXT" });
    const updated = await upsertCustomFieldDefinition(org.id, { key: "aendern", label: "Neu", type: "TEXT" }, created.id);
    expect(updated.label).toBe("Neu");
  });

  it("upsertCustomFieldDefinition mit unbekannter id wirft NotFoundError", async () => {
    const org = await makeOrg();
    await expect(
      upsertCustomFieldDefinition(org.id, { key: "irrelevant", label: "X", type: "TEXT" }, "does-not-exist"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("listCustomFieldDefinitions activeOnly filtert inaktive Definitionen", async () => {
    const org = await makeOrg();
    await upsertCustomFieldDefinition(org.id, { key: "aktiv", label: "Aktiv", type: "TEXT", isActive: true });
    await upsertCustomFieldDefinition(org.id, { key: "inaktiv", label: "Inaktiv", type: "TEXT", isActive: false });
    const active = await listCustomFieldDefinitions(org.id, { activeOnly: true });
    expect(active.map((d) => d.key)).toEqual(["aktiv"]);
  });

  it("reorderCustomFields setzt sortOrder gemaess Reihenfolge", async () => {
    const org = await makeOrg();
    const a = await upsertCustomFieldDefinition(org.id, { key: "aa", label: "A", type: "TEXT" });
    const b = await upsertCustomFieldDefinition(org.id, { key: "bb", label: "B", type: "TEXT" });
    const c = await upsertCustomFieldDefinition(org.id, { key: "cc", label: "C", type: "TEXT" });
    await reorderCustomFields(org.id, { ids: [c.id, a.id, b.id] });
    const list = await listCustomFieldDefinitions(org.id);
    expect(list.map((d) => d.id)).toEqual([c.id, a.id, b.id]);
  });

  it("reorderCustomFields lehnt unvollstaendige/fremde Id-Liste ab", async () => {
    const org = await makeOrg();
    const a = await upsertCustomFieldDefinition(org.id, { key: "aa", label: "A", type: "TEXT" });
    await expect(reorderCustomFields(org.id, { ids: [a.id, "fremde-id"] })).rejects.toThrow();
  });

  it("setCustomerCustomFields validiert je Typ inkl. required und SELECT-Optionen, lehnt unbekannte Keys ab", async () => {
    const org = await makeOrg();
    const customer = await makeCustomer(org.id);
    await upsertCustomFieldDefinition(org.id, { key: "vip", label: "VIP", type: "BOOLEAN", required: true });
    await upsertCustomFieldDefinition(org.id, { key: "kategorie", label: "Kategorie", type: "SELECT", options: ["A", "B"] });

    await expect(setCustomerCustomFields(org.id, customer.id, {})).rejects.toThrow(); // required fehlt
    await expect(setCustomerCustomFields(org.id, customer.id, { vip: true, kategorie: "Z" })).rejects.toThrow(); // Option ungueltig
    await expect(setCustomerCustomFields(org.id, customer.id, { vip: true, unbekannt: "x" })).rejects.toThrow(); // unbekannter Key

    const saved = await setCustomerCustomFields(org.id, customer.id, { vip: true, kategorie: "A" });
    expect(JSON.parse(saved.customFieldsJson!)).toEqual({ vip: true, kategorie: "A" });
  });

  it("deleteCustomFieldDefinition: Werte bleiben, parseCustomerCustomFields ignoriert den verwaisten Key", async () => {
    const org = await makeOrg();
    const customer = await makeCustomer(org.id);
    const def = await upsertCustomFieldDefinition(org.id, { key: "temp_feld", label: "Temp", type: "TEXT" });
    await setCustomerCustomFields(org.id, customer.id, { temp_feld: "Wert bleibt" });

    await deleteCustomFieldDefinition(org.id, def.id);

    const reloaded = await dbInternal.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(JSON.parse(reloaded.customFieldsJson!)).toEqual({ temp_feld: "Wert bleibt" });
    expect(await parseCustomerCustomFields(org.id, reloaded.customFieldsJson)).toEqual({});
  });

  it("parseCustomerCustomFields liest gueltige Werte typisiert zurueck", async () => {
    const org = await makeOrg();
    const customer = await makeCustomer(org.id);
    await upsertCustomFieldDefinition(org.id, { key: "notiz", label: "Notiz", type: "TEXT" });
    await upsertCustomFieldDefinition(org.id, { key: "menge", label: "Menge", type: "NUMBER" });
    const saved = await setCustomerCustomFields(org.id, customer.id, { notiz: "Hallo", menge: "3.5" });
    const parsed = await parseCustomerCustomFields(org.id, saved.customFieldsJson);
    expect(parsed).toEqual({ notiz: "Hallo", menge: "3.5" });
  });
});

describe("Phase 8a — defaults.ts (§28)", () => {
  it("saveCustomerDefaults schreibt alle zehn Felder, customerDefaultsFor liest sie inkl. Default-Adressen/-Kontakt", async () => {
    const org = await makeOrg();
    const customer = await makeCustomer(org.id);
    const billing = await createAddress(org.id, customer.id, {
      type: "BILLING",
      addressLine1: "B 1",
      postalCode: "1",
      city: "X",
      isDefault: true,
    });
    const contact = await createContact(org.id, customer.id, { firstName: "D", lastName: "E", isDefault: true });

    await saveCustomerDefaults(org.id, customer.id, {
      defaultCurrency: "USD",
      defaultDiscountPermille: 50,
      invoiceEmail: "rechnung@example.com",
      invoiceCc: "cc1@example.com,cc2@example.com",
      quoteEmail: "angebot@example.com",
      eInvoicePreferred: true,
      orderReference: "PO-123",
      deliveryTermsText: "Frei Haus",
      paymentTermsText: "14 Tage netto",
      language: "en",
    });

    const view = await customerDefaultsFor(org.id, customer.id);
    expect(view).toMatchObject({
      defaultCurrency: "USD",
      defaultDiscountPermille: 50,
      invoiceEmail: "rechnung@example.com",
      invoiceCc: "cc1@example.com,cc2@example.com",
      quoteEmail: "angebot@example.com",
      eInvoicePreferred: true,
      orderReference: "PO-123",
      deliveryTermsText: "Frei Haus",
      paymentTermsText: "14 Tage netto",
      language: "en",
    });
    expect(view.defaultBillingAddress?.id).toBe(billing.id);
    expect(view.defaultShippingAddress).toBeNull();
    expect(view.defaultContact?.id).toBe(contact.id);
  });

  it("saveCustomerDefaults mit leerem Objekt setzt optionale Felder auf NULL (voller Ersatz, kein Merge)", async () => {
    const org = await makeOrg();
    const customer = await makeCustomer(org.id);
    await saveCustomerDefaults(org.id, customer.id, { defaultCurrency: "USD" });
    await saveCustomerDefaults(org.id, customer.id, {});
    const view = await customerDefaultsFor(org.id, customer.id);
    expect(view.defaultCurrency).toBeNull();
    expect(view.defaultDiscountPermille).toBe(0);
    expect(view.language).toBe("de");
  });

  it("customerDefaultsFor auf unbekannten Kunden wirft NotFoundError", async () => {
    const org = await makeOrg();
    await expect(customerDefaultsFor(org.id, "does-not-exist")).rejects.toBeInstanceOf(NotFoundError);
  });
});
