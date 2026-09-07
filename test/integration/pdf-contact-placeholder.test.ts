/**
 * Fix-Runde 1 (Koordinator, Phase 8a Task 2) — {{contact.*}}-Platzhalter muessen auch
 * in PDF-Kopf-/Fusstexten rendern (nicht nur in E-Mail-Vorlagen): buildDocumentTextContext
 * bekommt den Ansprechpartner-Snapshot jetzt von mapper.ts/pdf-data.ts/delivery-note-data.ts
 * uebergeben.
 *
 * Testjahr laut Plan-Header: 2060 (consumption/take-over).
 */
import { describe, it, expect } from "vitest";
import { dbInternal } from "@/lib/db";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { updateNumberRange } from "@/domain/numbering/ranges";
import { createDraftInvoice } from "@/domain/invoice/create";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import { loadEInvoiceData } from "@/lib/einvoice/load";
import { renderInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { createBusinessDocument } from "@/domain/document/create";
import { buildDocEInvoiceData } from "@/domain/document/pdf-data";
import { createAddress } from "@/domain/customer/addresses";
import { createContact } from "@/domain/customer/contacts";
import { testPdfTheme, parsePdf } from "../helpers/pdf-theme";
import type { CreateInvoiceInput } from "@/schemas";

const ISSUE = new Date("2060-06-01T10:00:00.000Z");

describe("PDF-Kopf-/Fusstext: {{contact.*}} rendert aus dem Ansprechpartner-Snapshot", () => {
  it("Rechnung: {{contact.lastName}} im Kopftext erscheint im gerenderten PDF-Text", async () => {
    const org = await dbInternal.organization.create({
      data: { legalName: "PDF-Kontakt Test GmbH", addressLine1: "Testweg 1", postalCode: "13399", city: "Berlin", vatId: "DE444555666" },
    });
    await ensureOrgMasterdata(dbInternal, org.id);
    // Invoice.number ist global eindeutig — eigener Praefix (siehe customer-consumption.test.ts/take-over.test.ts).
    await updateNumberRange(org.id, "INVOICE", { pattern: "{PREFIX}{YYYY}-{SEQ}", prefix: "PDFV-", seqPadding: 4, yearlyReset: true, nextValue: 1 }, "test", ISSUE);

    const customer = await dbInternal.customer.create({
      data: { orgId: org.id, name: "PDF-Kontakt-Kunde AG", addressLine1: "Kundenweg 1", postalCode: "54321", city: "Hamburg", type: "BUSINESS" },
    });
    await createAddress(org.id, customer.id, { type: "BILLING", addressLine1: "Rechnungsweg 1", postalCode: "11111", city: "Bremen", isDefault: true });
    const contact = await createContact(org.id, customer.id, { firstName: "Petra", lastName: "Kontaktperson", isDefault: true });

    const draft = await createDraftInvoice(org.id, {
      customerId: customer.id,
      type: "INVOICE",
      taxScheme: "REGULAR",
      issueDate: ISSUE,
      deliveryDate: ISSUE,
      headerText: "Ansprechpartner: {{contact.firstName}} {{contact.lastName}}",
      lines: [{ lineType: "ITEM", description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
    } as CreateInvoiceInput);
    expect(draft.contactPersonId).toBe(contact.id);

    const finalized = await finalizeInvoice(draft.id, { now: ISSUE });
    expect(finalized.contactSnapshotJson).toBeTruthy();

    const loaded = await loadEInvoiceData(finalized.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.data.headerText).toBe("Ansprechpartner: Petra Kontaktperson");

    const pdf = await renderInvoicePdf(loaded!.data, testPdfTheme());
    const parsed = await parsePdf(pdf);
    expect(parsed.text).toContain("Kontaktperson");
  });

  it("Geschaeftsdokument (Angebot): {{contact.lastName}} im Kopftext erscheint im gerenderten PDF-Text", async () => {
    const org = await dbInternal.organization.create({
      data: { legalName: "PDF-Kontakt Quote Test GmbH", addressLine1: "Testweg 2", postalCode: "13400", city: "Berlin", vatId: "DE777888999" },
    });
    await ensureOrgMasterdata(dbInternal, org.id);

    const customer = await dbInternal.customer.create({
      data: { orgId: org.id, name: "PDF-Kontakt-Angebotskunde AG", addressLine1: "Kundenweg 1", postalCode: "54321", city: "Hamburg", type: "BUSINESS" },
    });
    const contact = await createContact(org.id, customer.id, { firstName: "Max", lastName: "Angebotskontakt", isDefault: true });

    const quote = await createBusinessDocument(org.id, {
      kind: "ANGEBOT",
      customerId: customer.id,
      taxScheme: "REGULAR",
      headerText: "Ihr Ansprechpartner: {{contact.lastName}}",
      lines: [{ lineType: "ITEM", description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
    });
    expect(quote.contactPersonId).toBe(contact.id);
    expect(quote.contactSnapshotJson).toBeTruthy();

    const fullQuote = await dbInternal.quote.findUniqueOrThrow({ where: { id: quote.id }, include: { lines: { orderBy: { position: "asc" } }, org: true, customer: true } });
    const data = buildDocEInvoiceData(fullQuote);
    expect(data.headerText).toBe("Ihr Ansprechpartner: Angebotskontakt");

    const pdf = await renderInvoicePdf(data, testPdfTheme());
    const parsed = await parsePdf(pdf);
    expect(parsed.text).toContain("Angebotskontakt");
  });
});
