/**
 * Zahlungsmethoden-CRUD (Phase 4a): auflisten, anlegen/aendern, Systemschutz,
 * Loeschschutz bei Referenz, Snapshot beim Festschreiben, Default aus Kunde.
 *
 * Eigenes Jahr (2035) fuer die Nummernvergabe — "Invoice.number" ist global
 * @unique (nicht je Organisation) und test.db wird ueber die gesamte
 * Testlaufzeit geteilt; payment-skonto.test.ts nutzt 2034 (siehe auch der
 * Kommentar in phase1.test.ts).
 */
import { beforeAll, describe, it, expect } from "vitest";
import { dbInternal } from "@/lib/db";
import { createDraftInvoice } from "@/domain/invoice/create";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import {
  listPaymentMethods,
  savePaymentMethod,
  deletePaymentMethod,
  PaymentMethodNotFoundError,
  SystemPaymentMethodProtectedError,
  PaymentMethodCodeConflictError,
  PaymentMethodInUseError,
} from "@/domain/payment-method/manage";
import type { CreateInvoiceInput } from "@/schemas";

let orgId: string;
let customerId: string;
const FIX_DATE = new Date("2035-07-01T10:00:00.000Z");

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: {
      legalName: "PM Test GmbH",
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

const line = { description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19 as const, taxCategory: "S" as const, discountPermille: 0, discountCents: 0 };

function baseInvoiceInput(extra: Partial<CreateInvoiceInput> = {}): CreateInvoiceInput {
  return {
    customerId,
    type: "INVOICE",
    taxScheme: "REGULAR",
    currency: "EUR",
    documentDiscountPermille: 0,
    documentDiscountCents: 0,
    documentChargePermille: 0,
    documentChargeCents: 0,
    deliveryDate: new Date("2035-06-25"),
    lines: [line],
    ...extra,
  } as CreateInvoiceInput;
}

describe("Zahlungsmethoden-Verwaltung", () => {
  it("listPaymentMethods liefert die neun Systemmethoden nach Backfill/Selbstheilung", async () => {
    const methods = await listPaymentMethods(orgId);
    expect(methods.length).toBeGreaterThanOrEqual(9);
    expect(methods.some((m) => m.code === "SKONTO" && m.isSystem)).toBe(true);
    expect(methods.some((m) => m.code === "TRANSFER" && m.isSystem)).toBe(true);
  });

  it("legt eine neue (Nicht-System-)Zahlungsmethode mit Bankdaten an", async () => {
    const created = await savePaymentMethod(orgId, null, {
      code: "VORKASSE",
      name: "Vorkasse",
      bankIban: "DE02120300000000202051",
      bankBic: "BYLADEM1001",
      bankName: "Testbank",
      untdidCode: "ZZZ",
    });
    expect(created.isSystem).toBe(false);
    expect(created.bankIban).toBe("DE02120300000000202051");

    const updated = await savePaymentMethod(orgId, created.id, {
      code: "VORKASSE",
      name: "Vorkasse (geaendert)",
      untdidCode: "ZZZ",
    });
    expect(updated.name).toBe("Vorkasse (geaendert)");
  });

  it("verweigert einen doppelten Code innerhalb der Organisation", async () => {
    await expect(
      savePaymentMethod(orgId, null, { code: "TRANSFER", name: "Dup", untdidCode: "ZZZ" }),
    ).rejects.toBeInstanceOf(PaymentMethodCodeConflictError);
  });

  it("Systemschutz: bei einer Systemmethode werden code/untdidCode/sortOrder NICHT geaendert", async () => {
    const methods = await listPaymentMethods(orgId);
    const transfer = methods.find((m) => m.code === "TRANSFER")!;
    const originalSortOrder = transfer.sortOrder;

    const updated = await savePaymentMethod(orgId, transfer.id, {
      code: "SOLL_IGNORIERT_WERDEN",
      name: "Ueberweisung (Text angepasst)",
      // K2: untdidCode ist jetzt auf die Allowlist eingeschraenkt (Enum) — "48" statt
      // eines beliebigen Codes, um den Systemschutz weiterhin unabhaengig von der
      // Codepruefung zu testen (der Systemcode "58" bleibt trotzdem bestehen).
      untdidCode: "48",
      sortOrder: 999,
      isActive: true,
    });
    expect(updated.code).toBe("TRANSFER"); // unveraendert trotz abweichender Eingabe
    expect(updated.untdidCode).toBe("58");
    expect(updated.sortOrder).toBe(originalSortOrder);
    expect(updated.name).toBe("Ueberweisung (Text angepasst)"); // Name bleibt aenderbar
  });

  it("Systemschutz: eine Systemmethode kann nicht geloescht werden", async () => {
    const methods = await listPaymentMethods(orgId);
    const skonto = methods.find((m) => m.code === "SKONTO")!;
    await expect(deletePaymentMethod(orgId, skonto.id)).rejects.toBeInstanceOf(SystemPaymentMethodProtectedError);
  });

  it("eine referenzierte (Nicht-System-)Methode kann nicht geloescht werden", async () => {
    const method = await savePaymentMethod(orgId, null, { code: "REF_TEST", name: "Referenztest", untdidCode: "ZZZ" });
    const draft = await createDraftInvoice(orgId, baseInvoiceInput({ paymentMethodId: method.id }));
    expect(draft.paymentMethodId).toBe(method.id);

    await expect(deletePaymentMethod(orgId, method.id)).rejects.toBeInstanceOf(PaymentMethodInUseError);
  });

  it("eine unreferenzierte (Nicht-System-)Methode kann geloescht werden", async () => {
    const method = await savePaymentMethod(orgId, null, { code: "LOESCHBAR", name: "Loeschbar", untdidCode: "ZZZ" });
    await deletePaymentMethod(orgId, method.id);
    const methods = await listPaymentMethods(orgId);
    expect(methods.some((m) => m.id === method.id)).toBe(false);
  });

  it("wirft PaymentMethodNotFoundError fuer unbekannte IDs", async () => {
    await expect(savePaymentMethod(orgId, "unbekannt", { code: "X", name: "X", untdidCode: "ZZZ" })).rejects.toBeInstanceOf(
      PaymentMethodNotFoundError,
    );
    await expect(deletePaymentMethod(orgId, "unbekannt")).rejects.toBeInstanceOf(PaymentMethodNotFoundError);
  });

  it("Snapshot beim Festschreiben: die gewaehlte Zahlungsmethode wird eingefroren", async () => {
    const method = await savePaymentMethod(orgId, null, {
      code: "SNAPSHOT_TEST",
      name: "Snapshot-Test",
      invoiceText: "Bitte ueberweisen Sie auf folgendes Konto:",
      bankIban: "DE02120300000000202051",
      bankBic: "BYLADEM1001",
      bankName: "Testbank",
      untdidCode: "58",
    });
    const draft = await createDraftInvoice(orgId, baseInvoiceInput({ paymentMethodId: method.id }));
    const fin = await finalizeInvoice(draft.id, { now: FIX_DATE });

    expect(fin.paymentMethodSnapshotJson).not.toBeNull();
    const snapshot = JSON.parse(fin.paymentMethodSnapshotJson!) as {
      code: string; name: string; invoiceText: string | null; untdidCode: string;
      bankIban: string | null; bankBic: string | null; bankName: string | null;
    };
    expect(snapshot.code).toBe("SNAPSHOT_TEST");
    expect(snapshot.bankIban).toBe("DE02120300000000202051");

    // Aendert sich die Zahlungsmethode NACH dem Festschreiben, bleibt der Snapshot der
    // festgeschriebenen Rechnung unveraendert (GoBD-Snapshot-Prinzip).
    await savePaymentMethod(orgId, method.id, { code: "SNAPSHOT_TEST", name: "Snapshot-Test (spaeter geaendert)", untdidCode: "58" });
    const reloaded = await dbInternal.invoice.findUniqueOrThrow({ where: { id: fin.id } });
    const reloadedSnapshot = JSON.parse(reloaded.paymentMethodSnapshotJson!) as { name: string };
    expect(reloadedSnapshot.name).toBe("Snapshot-Test");
  });

  it("ohne Zahlungsmethode am Beleg bleibt der Snapshot NULL", async () => {
    const draft = await createDraftInvoice(orgId, baseInvoiceInput());
    const fin = await finalizeInvoice(draft.id, { now: FIX_DATE });
    expect(fin.paymentMethodId).toBeNull();
    expect(fin.paymentMethodSnapshotJson).toBeNull();
  });

  it("Default aus Kunde: fehlt paymentMethodId, greift Customer.defaultPaymentMethodId", async () => {
    const method = await savePaymentMethod(orgId, null, { code: "KUNDEN_DEFAULT", name: "Kunden-Default", untdidCode: "58" });
    const customerWithDefault = await dbInternal.customer.create({
      data: {
        orgId, name: "Kunde mit Default", addressLine1: "Weg 3", postalCode: "10115", city: "Berlin", type: "BUSINESS",
        defaultPaymentMethodId: method.id,
      },
    });

    const draft = await createDraftInvoice(orgId, baseInvoiceInput({ customerId: customerWithDefault.id }));
    expect(draft.paymentMethodId).toBe(method.id);
  });
});
