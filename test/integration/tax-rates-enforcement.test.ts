/**
 * Phase 12c, Task 5 — assertAllowedTaxRates in den Domain-Kernen. Eigenes Jahr 2081
 * (Testjahr-Konvention) und eigener Nummernkreis-Praefix, weil hier festgeschrieben wird.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { dbInternal } from "@/lib/db";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { saveDocumentSettings, loadDocumentSettings } from "@/domain/document/settings";
import { createDraftInvoice } from "@/domain/invoice/create";
import { updateDraftInvoice } from "@/domain/invoice/update";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import { createProduct } from "@/domain/product/save";
import { createPartialCreditNote } from "@/domain/invoice/credit";
import { assertAllowedTaxRates, TaxRateNotAllowedError } from "@/domain/settings/tax-rates";
import type { CreateInvoiceInput } from "@/schemas";

let orgId: string;
let customerId: string;
const NOW = new Date(2081, 2, 10, 10, 0, 0);

function line(taxRate: number) {
  return { description: `Position ${taxRate}%`, quantityMilli: 1000, unit: "C62", unitNetPriceCents: 10000, taxRate, taxCategory: "S" as const, discountPermille: 0 };
}

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "Steuersatz Test GmbH", addressLine1: "Satzweg 1", postalCode: "10115", city: "Berlin", vatId: "DE811111111", taxNumber: "81/111/11111" },
  });
  orgId = org.id;
  await ensureOrgMasterdata(dbInternal, orgId);
  const customer = await dbInternal.customer.create({
    data: { orgId, name: "Satzkunde AG", addressLine1: "Kundenweg 2", postalCode: "10117", city: "Berlin", type: "BUSINESS" },
  });
  customerId = customer.id;
});

describe("assertAllowedTaxRates", () => {
  it("Satz aus der Liste ist erlaubt, unbekannter nicht, 0 immer", async () => {
    await expect(assertAllowedTaxRates(dbInternal, orgId, [19, 7])).resolves.toBeUndefined();
    await expect(assertAllowedTaxRates(dbInternal, orgId, [0])).resolves.toBeUndefined();
    await expect(assertAllowedTaxRates(dbInternal, orgId, [10])).rejects.toBeInstanceOf(TaxRateNotAllowedError);
  });

  it("ein bereits auf dem Beleg gespeicherter Satz bleibt erlaubt (GoBD)", async () => {
    await expect(assertAllowedTaxRates(dbInternal, orgId, [10], { existing: [10] })).resolves.toBeUndefined();
  });

  it("die Fehlermeldung nennt Satz und Ort der Einstellung", async () => {
    await expect(assertAllowedTaxRates(dbInternal, orgId, [10])).rejects.toThrow(
      "Steuersatz 10 % ist für diese Organisation nicht freigegeben (Einstellungen → Belege).",
    );
  });
});

describe("Durchsetzung in den Domain-Kernen", () => {
  const inv10 = () =>
    createDraftInvoice(orgId, { customerId, type: "INVOICE", taxScheme: "REGULAR", currency: "EUR", issueDate: NOW, lines: [line(10)] } as CreateInvoiceInput, { now: NOW });
  const setRates = async (taxRates: number[]) => saveDocumentSettings(orgId, { ...(await loadDocumentSettings(orgId)), taxRates });

  it("Rechnung mit nicht freigegebenem Satz wird abgelehnt", async () => {
    await expect(inv10()).rejects.toBeInstanceOf(TaxRateNotAllowedError);
  });

  it("nach Freigabe anlegbar und festschreibbar; das spaetere Entfernen aendert den Beleg nicht", async () => {
    await setRates([19, 7, 0, 10]);
    const inv = await inv10();
    await finalizeInvoice(inv.id, { now: NOW });

    await setRates([19, 7, 0]);
    const after = await dbInternal.invoice.findUniqueOrThrow({ where: { id: inv.id }, include: { lines: true } });
    expect(after.lines[0].taxRate).toBe(10);
    expect(after.status).toBe("FINALIZED");
    // Ein NEUER Beleg mit 10 % ist jetzt nicht mehr speicherbar.
    await expect(inv10()).rejects.toBeInstanceOf(TaxRateNotAllowedError);
  });

  it("ein Entwurf mit 10 % bleibt aenderbar, solange sein Satz unveraendert bleibt", async () => {
    await setRates([19, 7, 0, 10]);
    const draft = await inv10();
    await setRates([19, 7, 0]);
    const updated = await updateDraftInvoice(orgId, draft.id, { subject: "Betreff neu" }, "test");
    expect(updated.lines[0].taxRate).toBe(10);
  });

  it("Produkt mit nicht freigegebenem Satz wird abgelehnt", async () => {
    await expect(createProduct(orgId, { name: "Sonderware", unit: "C62", netPriceCents: 1000, taxRate: 10, taxCategory: "S" })).rejects.toBeInstanceOf(
      TaxRateNotAllowedError,
    );
  });
});

// Fix 1 (Koordinator): Teilgutschrift erbt die Saetze des Originals — eine Gutschrift
// gegen eine alte, inzwischen aus der Org-Liste entfernte Rechnung (z. B. historisch
// 16 %) muss weiterhin moeglich bleiben, waehrend ein voellig fremder Satz weiterhin
// abgelehnt wird.
describe("Teilgutschrift erbt die Saetze des Originals (Fix 1)", () => {
  const setRates = async (taxRates: number[]) => saveDocumentSettings(orgId, { ...(await loadDocumentSettings(orgId)), taxRates });

  it("gelisteter Original-Satz nach Delisting: Teilgutschrift mit fremdem Satz abgelehnt, mit geerbtem Satz erfolgreich", async () => {
    await setRates([19, 7, 0, 16]);
    const original = await createDraftInvoice(
      orgId,
      { customerId, type: "INVOICE", taxScheme: "REGULAR", currency: "EUR", issueDate: NOW, lines: [line(16)] } as CreateInvoiceInput,
      { now: NOW },
    );
    await finalizeInvoice(original.id, { now: NOW });
    await setRates([19, 7, 0]);

    // (a) Weder in der Org-Liste noch auf dem Original vorhanden -> abgelehnt.
    await expect(
      createPartialCreditNote(original.id, { lines: [{ description: "Teilrueckgabe", quantityMilli: 500, unitNetPriceCents: 10000, taxRate: 5, taxCategory: "S" }] }, { now: NOW }),
    ).rejects.toBeInstanceOf(TaxRateNotAllowedError);

    // (b) Der (inzwischen delistete) Satz des Originals bleibt erlaubt (GoBD, geerbt).
    const credited = await createPartialCreditNote(
      original.id,
      { lines: [{ description: "Teilrueckgabe", quantityMilli: 500, unitNetPriceCents: 10000, taxRate: 16, taxCategory: "S" }] },
      { now: NOW },
    );
    expect(credited.creditNote.status).toBe("FINALIZED");
  });
});
