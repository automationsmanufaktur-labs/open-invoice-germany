/**
 * Phase 7, Task 1 — Nummernkreis-Domain (src/domain/numbering/ranges.ts).
 * Eigenes Jahr fuer die Nummernvergabe (test.db wird ueber die gesamte Testlaufzeit
 * geteilt): 2055 laut Plan-Header (Testjahre je Phase-7-Task).
 */
import { describe, it, expect } from "vitest";
import { dbInternal } from "@/lib/db";
import {
  listNumberRanges,
  updateNumberRange,
  previewNumber,
  assignCustomerNumber,
  assignArticleNumber,
  NUMBER_RANGE_DOC_TYPES,
} from "@/domain/numbering/ranges";
import { InvalidOperationError } from "@/domain/errors";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { createDraftInvoice } from "@/domain/invoice/create";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import type { CreateInvoiceInput } from "@/schemas";

const YEAR = 2055;
const NOW = new Date(`${YEAR}-06-15T10:00:00.000Z`);

async function makeOrg() {
  const org = await dbInternal.organization.create({
    data: { legalName: "Nummernkreis Test GmbH", addressLine1: "Teststr. 1", postalCode: "12345", city: "Berlin" },
  });
  return org.id;
}

describe("Phase 7 — previewNumber (rein)", () => {
  it("formatiert Vorschau `RE-{YYYY}-{SEQ:5}` -> `RE-2055-00007`", () => {
    const preview = previewNumber({ prefix: "RE-", pattern: "RE-{YYYY}-{SEQ:5}", seqPadding: 4 }, 7, new Date(`${YEAR}-01-01T00:00:00.000Z`));
    expect(preview).toBe("RE-2055-00007");
  });
});

describe("Phase 7 — listNumberRanges", () => {
  it("liefert alle neun Nummernkreis-Typen mit Default-Vorbelegung ohne gespeicherte Zeilen", async () => {
    const orgId = await makeOrg();
    const ranges = await listNumberRanges(orgId, YEAR);
    expect(ranges.map((r) => r.docType)).toEqual(NUMBER_RANGE_DOC_TYPES);

    const invoice = ranges.find((r) => r.docType === "INVOICE")!;
    expect(invoice.pattern).toBe("{PREFIX}{YYYY}-{SEQ}");
    expect(invoice.prefix).toBe("RE-");
    expect(invoice.yearlyReset).toBe(true);
    expect(invoice.currentValue).toBe(0);
    expect(invoice.nextNumberPreview).toBe(`RE-${YEAR}-0001`);

    const customer = ranges.find((r) => r.docType === "CUSTOMER")!;
    expect(customer.pattern).toBe("{PREFIX}{SEQ:5}");
    expect(customer.prefix).toBe("KD-");
    expect(customer.yearlyReset).toBe(false);
    expect(customer.nextNumberPreview).toBe("KD-00001");

    const product = ranges.find((r) => r.docType === "PRODUCT")!;
    expect(product.prefix).toBe("ART-");
    expect(product.nextNumberPreview).toBe("ART-00001");
  });

  it("Nit (Final-Review): {MM}/{DD} in der Vorschau zeigen den heutigen Tag, nicht immer 01.01", async () => {
    const orgId = await makeOrg();
    await updateNumberRange(orgId, "ANGEBOT", { pattern: "AN-{YYYY}-{MM}-{DD}-{SEQ}", prefix: "AN-", seqPadding: 3, yearlyReset: true, nextValue: 1 }, "tester", NOW);
    const today = new Date();
    const expectedMonth = String(today.getUTCMonth() + 1).padStart(2, "0");
    const expectedDay = String(today.getUTCDate()).padStart(2, "0");

    const ranges = await listNumberRanges(orgId, YEAR);
    const quote = ranges.find((r) => r.docType === "ANGEBOT")!;
    expect(quote.nextNumberPreview).toBe(`AN-${YEAR}-${expectedMonth}-${expectedDay}-001`);
  });
});

describe("Phase 7 — updateNumberRange", () => {
  it("aktualisiert Muster/Praefix und schreibt einen ChangeLog-Eintrag", async () => {
    const orgId = await makeOrg();
    const result = await updateNumberRange(
      orgId,
      "INVOICE",
      { pattern: "RE-{YYYY}-{SEQ:5}", prefix: "RE-", seqPadding: 5, yearlyReset: true, nextValue: 7 },
      "tester",
      NOW,
    );
    expect(result.currentValue).toBe(6);
    expect(result.nextNumberPreview).toBe(`RE-${YEAR}-00007`);

    const ranges = await listNumberRanges(orgId, YEAR);
    const invoice = ranges.find((r) => r.docType === "INVOICE")!;
    expect(invoice.currentValue).toBe(6);
    expect(invoice.pattern).toBe("RE-{YYYY}-{SEQ:5}");

    const log = await dbInternal.changeLog.findFirst({
      where: { orgId, entity: "SETTINGS", entityId: "NUMBER_RANGE:INVOICE", action: "UPDATE" },
    });
    expect(log).not.toBeNull();
    const diff = JSON.parse(log!.diffJson);
    expect(diff.after.currentValue).toBe(6);
  });

  it("lehnt ein Muster ohne {SEQ}-Platzhalter ab (Zod)", async () => {
    const orgId = await makeOrg();
    await expect(
      updateNumberRange(orgId, "INVOICE", { pattern: "RE-{YYYY}", nextValue: 1, yearlyReset: true }, "tester", NOW),
    ).rejects.toThrow();
  });

  it("lehnt das Zurueckdrehen der naechsten Nummer ab (409/InvalidOperationError)", async () => {
    const orgId = await makeOrg();
    await updateNumberRange(
      orgId,
      "DUNNING",
      { pattern: "MA-{YYYY}-{SEQ}", prefix: "MA-", seqPadding: 4, yearlyReset: true, nextValue: 10 },
      "tester",
      NOW,
    );
    await expect(
      updateNumberRange(
        orgId,
        "DUNNING",
        { pattern: "MA-{YYYY}-{SEQ}", prefix: "MA-", seqPadding: 4, yearlyReset: true, nextValue: 5 },
        "tester",
        NOW,
      ),
    ).rejects.toThrow(InvalidOperationError);
  });

  it("lehnt bei INVOICE eine Nummer unter der bereits vergebenen Nummer des Jahres ab", async () => {
    const orgId = await makeOrg();
    // Simuliert eine bereits per Festschreibung vergebene Nummer (upsert-increment wie finalize.ts).
    await dbInternal.numberRange.create({
      data: { orgId, docType: "INVOICE", year: YEAR, currentValue: 12, prefix: "RE-", pattern: "{PREFIX}{YYYY}-{SEQ}", seqPadding: 4 },
    });

    await expect(
      updateNumberRange(
        orgId,
        "INVOICE",
        { pattern: "RE-{YYYY}-{SEQ}", prefix: "RE-", seqPadding: 4, yearlyReset: true, nextValue: 10 },
        "tester",
        NOW,
      ),
    ).rejects.toThrow(InvalidOperationError);

    // 13 (>= 12) ist erlaubt.
    const ok = await updateNumberRange(
      orgId,
      "INVOICE",
      { pattern: "RE-{YYYY}-{SEQ}", prefix: "RE-", seqPadding: 4, yearlyReset: true, nextValue: 13 },
      "tester",
      NOW,
    );
    expect(ok.currentValue).toBe(12);
  });

  it("yearlyReset-Wechsel legt eine neue Zeile an, ohne die alte zu loeschen", async () => {
    const orgId = await makeOrg();
    await updateNumberRange(
      orgId,
      "CUSTOMER",
      { pattern: "{PREFIX}{SEQ:5}", prefix: "KD-", seqPadding: 5, yearlyReset: false, nextValue: 3 },
      "tester",
      NOW,
    );
    const beforeSwitch = await dbInternal.numberRange.findUnique({ where: { orgId_docType_year: { orgId, docType: "CUSTOMER", year: 0 } } });
    expect(beforeSwitch?.currentValue).toBe(2);

    await updateNumberRange(
      orgId,
      "CUSTOMER",
      { pattern: "{PREFIX}{YYYY}-{SEQ:3}", prefix: "KD-", seqPadding: 3, yearlyReset: true, nextValue: 1 },
      "tester",
      NOW,
    );
    const yearRow = await dbInternal.numberRange.findUnique({ where: { orgId_docType_year: { orgId, docType: "CUSTOMER", year: YEAR } } });
    expect(yearRow?.currentValue).toBe(0);
    // Die alte year=0-Zeile bleibt unveraendert erhalten (nicht geloescht).
    const oldRow = await dbInternal.numberRange.findUnique({ where: { orgId_docType_year: { orgId, docType: "CUSTOMER", year: 0 } } });
    expect(oldRow?.currentValue).toBe(2);
  });
});

describe("Phase 7 — assignCustomerNumber / assignArticleNumber", () => {
  it("vergibt fortlaufende Kundennummern (upsert-increment wie Belege)", async () => {
    const orgId = await makeOrg();
    const first = await dbInternal.$transaction((tx) => assignCustomerNumber(tx, orgId, NOW));
    const second = await dbInternal.$transaction((tx) => assignCustomerNumber(tx, orgId, NOW));
    expect(first).toBe("KD-00001");
    expect(second).toBe("KD-00002");
  });

  it("vergibt fortlaufende Artikelnummern unabhaengig von Kundennummern", async () => {
    const orgId = await makeOrg();
    const first = await dbInternal.$transaction((tx) => assignArticleNumber(tx, orgId, NOW));
    expect(first).toBe("ART-00001");
    const customer = await dbInternal.$transaction((tx) => assignCustomerNumber(tx, orgId, NOW));
    expect(customer).toBe("KD-00001");
  });
});

describe("Phase 7 — Fix-Welle B3: yearlyReset:false darf nicht stillschweigend ignoriert werden", () => {
  async function makeFinalizableOrg() {
    const org = await dbInternal.organization.create({
      data: { legalName: "B3-Finalize GmbH", addressLine1: "Weg 3", postalCode: "30000", city: "Hannover", vatId: "DE333222111", taxNumber: "3" },
    });
    return org.id;
  }

  async function makeCustomer(orgId: string) {
    const c = await dbInternal.customer.create({
      data: { orgId, name: "B3-Kunde GmbH", addressLine1: "Weg 3", postalCode: "30000", city: "Hannover", type: "BUSINESS" },
    });
    return c.id;
  }

  function invoiceInput(customerId: string): CreateInvoiceInput {
    return {
      customerId,
      type: "INVOICE",
      taxScheme: "REGULAR",
      currency: "EUR",
      documentDiscountPermille: 0,
      documentDiscountCents: 0,
      documentChargePermille: 0,
      documentChargeCents: 0,
      lines: [{ description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
    } as CreateInvoiceInput;
  }

  it("yearlyReset:false + naechste Nummer 5000 (Muster ohne Jahr): die naechste Rechnung wird RE-5000, nicht RE-{Jahr}-0001", async () => {
    const orgId = await makeFinalizableOrg();
    await ensureOrgMasterdata(dbInternal, orgId);
    const customerId = await makeCustomer(orgId);

    await updateNumberRange(
      orgId,
      "INVOICE",
      { pattern: "{PREFIX}{SEQ}", prefix: "RE-", seqPadding: 1, yearlyReset: false, nextValue: 5000 },
      "tester",
      NOW,
    );

    const draft = await createDraftInvoice(orgId, invoiceInput(customerId), { now: NOW });
    const finalized = await finalizeInvoice(draft.id, { now: NOW });
    expect(finalized.number).toBe("RE-5000");

    // Die jahresgebundene Zeile (year=NOW.getFullYear()) bleibt unberuehrt/inaktiv — kein
    // "RE-{Jahr}-0001", das mit einer echten Legacy-Nummer kollidieren koennte.
    const yearRow = await dbInternal.numberRange.findUnique({ where: { orgId_docType_year: { orgId, docType: "INVOICE", year: YEAR } } });
    expect(yearRow).toBeNull();
  });

  it("Wechsel zurueck auf jaehrlich: die naechste Rechnung nutzt die Jahres-Zeile", async () => {
    const orgId = await makeFinalizableOrg();
    await ensureOrgMasterdata(dbInternal, orgId);
    const customerId = await makeCustomer(orgId);

    await updateNumberRange(
      orgId,
      "INVOICE",
      { pattern: "{PREFIX}{SEQ}", prefix: "RE-", seqPadding: 1, yearlyReset: false, nextValue: 5000 },
      "tester",
      NOW,
    );
    // Guard (bestehend): darf nicht unter die bereits vergebene Nummer 4999 (year 0) fallen
    // — deshalb nextValue 5001 statt 1, um ausschliesslich den Zeilen-Wechsel zu pruefen.
    await updateNumberRange(
      orgId,
      "INVOICE",
      { pattern: "{PREFIX}{YYYY}-{SEQ:4}", prefix: "RE-", seqPadding: 4, yearlyReset: true, nextValue: 5001 },
      "tester",
      NOW,
    );

    const draft = await createDraftInvoice(orgId, invoiceInput(customerId), { now: NOW });
    const finalized = await finalizeInvoice(draft.id, { now: NOW });
    expect(finalized.number).toBe(`RE-${YEAR}-5001`);

    const yearlessRow = await dbInternal.numberRange.findUnique({ where: { orgId_docType_year: { orgId, docType: "INVOICE", year: 0 } } });
    expect(yearlessRow?.isActive).toBe(false);
  });

  it("yearlyReset:true ohne {YYYY}/{YY} im Muster wird abgelehnt (Zod)", async () => {
    const orgId = await makeOrg();
    await expect(
      updateNumberRange(orgId, "INVOICE", { pattern: "RE-{SEQ}", prefix: "RE-", seqPadding: 4, yearlyReset: true, nextValue: 1 }, "tester", NOW),
    ).rejects.toThrow();
  });
});
