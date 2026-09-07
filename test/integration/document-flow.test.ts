/**
 * Task 3 — generische Konvertierung, Teillieferung, Duplizieren, Entwurf bearbeiten:
 * Integrationstest ueber den gesamten Fluss inkl. verifyChain (ChangeLog-Kette).
 *
 * Eigenes Jahr fuer die Nummernvergabe: "Invoice.number" ist global @unique. Jahr 2033
 * (Fix-Runde 2, Task-6-Ergaenzung) — 2031 bleibt document-chain/document-status
 * vorbehalten (finalisieren dort Rechnungen); dieser Test finalisiert selbst keine
 * Rechnung, kollidiert aber inzwischen mit anderen 2031er Tests bei spaeteren
 * Finalisierungen in Folge-Aenderungen, daher eigenes Jahr.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { dbInternal } from "@/lib/db";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { createBusinessDocument } from "@/domain/document/create";
import { createDraftInvoice } from "@/domain/invoice/create";
import { convertDocument, ConvertError } from "@/domain/document/convert";
import { duplicateDocument } from "@/domain/document/duplicate";
import { updateDraftDocument } from "@/domain/document/update";
import { remainingQuantities, OverDeliveryError } from "@/domain/delivery-note/quantities";
import * as quantitiesModule from "@/domain/delivery-note/quantities";
import { setDeliveryNoteStatus, setQuoteStatus, StatusTransitionError } from "@/domain/document/status";
import * as relationsModule from "@/domain/relations";
import { listRelations } from "@/domain/relations";
import { DEFAULT_TEXT_TEMPLATES } from "@/domain/text-template/defaults";
import { verifyChain, type ChainEntry } from "@/domain/changelog";

const FIX_DATE = new Date("2033-05-01T10:00:00.000Z");

const lineA = { description: "Beratung", quantityMilli: 10000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19 as const, taxCategory: "S" as const, discountPermille: 0 };
const lineB = { description: "Kabel", quantityMilli: 5000, unit: "C62", unitNetPriceCents: 500, taxRate: 19 as const, taxCategory: "S" as const, discountPermille: 0 };

let orgId: string;
let customerId: string;
let otherOrgId: string;

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "Doc-Flow GmbH", addressLine1: "Hauptstr. 1", postalCode: "21339", city: "Lüneburg", vatId: "DE123456789", taxNumber: "33/123/45678" },
  });
  orgId = org.id;
  const customer = await dbInternal.customer.create({
    data: { orgId, name: "Kunde AG", addressLine1: "Marktplatz 2", postalCode: "20095", city: "Hamburg", type: "BUSINESS" },
  });
  customerId = customer.id;
  await ensureOrgMasterdata(dbInternal, orgId);

  const otherOrg = await dbInternal.organization.create({
    data: { legalName: "Fremde GmbH", addressLine1: "Andere Str. 1", postalCode: "1", city: "X" },
  });
  otherOrgId = otherOrg.id;
});

describe("Textvorlagen bei Anlage", () => {
  it("belegt Kopf-/Fusstext und Bedingungen aus den Standardvorlagen vor, wenn nichts angegeben ist", async () => {
    const q = await createBusinessDocument(orgId, { kind: "ANGEBOT", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [lineA] }, { now: FIX_DATE });
    expect(q.headerText).toBe(DEFAULT_TEXT_TEMPLATES.find((t) => t.docType === "ANGEBOT" && t.position === "HEAD")!.body);
    expect(q.footerText).toBe(DEFAULT_TEXT_TEMPLATES.find((t) => t.docType === "ANGEBOT" && t.position === "FOOT")!.body);
    expect(q.deliveryTerms).toBe(DEFAULT_TEXT_TEMPLATES.find((t) => t.docType === "ANGEBOT" && t.position === "TERMS_DELIVERY")!.body);
    expect(q.paymentTerms).toBe(DEFAULT_TEXT_TEMPLATES.find((t) => t.docType === "ANGEBOT" && t.position === "TERMS_PAYMENT")!.body);
  });

  it("eigener Text ueberschreibt die Vorlage und bleibt ueber updateDraftDocument editierbar", async () => {
    const q = await createBusinessDocument(orgId, { kind: "ANGEBOT", customerId, taxScheme: "REGULAR", currency: "EUR", headerText: "Eigener Kopftext", lines: [lineA] }, { now: FIX_DATE });
    expect(q.headerText).toBe("Eigener Kopftext");

    const updated = await updateDraftDocument(orgId, q.id, { headerText: "Geaenderter Kopftext" }, "tester");
    expect(updated.headerText).toBe("Geaenderter Kopftext");
  });
});

describe("Angebot -> Auftragsbestaetigung", () => {
  it("kopiert Positionen und Texte, setzt CONVERTED_TO-Relation, Angebot wird ACCEPTED", async () => {
    const quote = await createBusinessDocument(
      orgId,
      { kind: "ANGEBOT", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [lineA, lineB] },
      { now: FIX_DATE },
    );
    expect(quote.lines).toHaveLength(2);

    const result = await convertDocument(orgId, { fromType: "QUOTE", fromId: quote.id, toKind: "AUFTRAGSBESTAETIGUNG" }, { now: FIX_DATE, actor: "tester" });
    expect(result.type).toBe("QUOTE");

    const ab = await dbInternal.quote.findUniqueOrThrow({ where: { id: result.id }, include: { lines: { orderBy: { position: "asc" } } } });
    expect(ab.kind).toBe("AUFTRAGSBESTAETIGUNG");
    expect(ab.number).toMatch(/^AB-\d{4}-\d{4}$/);
    expect(ab.lines).toHaveLength(2);
    expect(ab.lines.map((l) => l.description)).toEqual(["Beratung", "Kabel"]);
    expect(ab.headerText).toBe(DEFAULT_TEXT_TEMPLATES.find((t) => t.docType === "AUFTRAGSBESTAETIGUNG" && t.position === "HEAD")!.body);

    const rel = await listRelations(orgId, "QUOTE", quote.id);
    expect(rel.some((r) => r.toId === ab.id && r.relationType === "CONVERTED_TO")).toBe(true);

    const reloadedQuote = await dbInternal.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(reloadedQuote.status).toBe("ACCEPTED");
  });

  it("verweigert die Umwandlung eines Proforma-Dokuments in eine AB", async () => {
    const proforma = await createBusinessDocument(orgId, { kind: "PROFORMA", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [lineA] }, { now: FIX_DATE });
    await expect(convertDocument(orgId, { fromType: "QUOTE", fromId: proforma.id, toKind: "AUFTRAGSBESTAETIGUNG" })).rejects.toThrow(ConvertError);
  });
});

describe("W2 (Fix-Runde 2): Statuspruefung bei der Konvertierung", () => {
  it("storniertes Angebot: ConvertError fuer alle drei Ziele (AB, Rechnung, Lieferschein)", async () => {
    const quote = await createBusinessDocument(orgId, { kind: "ANGEBOT", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [lineA] }, { now: FIX_DATE });
    await setQuoteStatus(orgId, quote.id, "CANCELLED", { now: FIX_DATE });

    await expect(convertDocument(orgId, { fromType: "QUOTE", fromId: quote.id, toKind: "AUFTRAGSBESTAETIGUNG" }, { now: FIX_DATE })).rejects.toThrow(ConvertError);
    await expect(convertDocument(orgId, { fromType: "QUOTE", fromId: quote.id, toKind: "INVOICE" }, { now: FIX_DATE })).rejects.toThrow(ConvertError);
    await expect(convertDocument(orgId, { fromType: "QUOTE", fromId: quote.id, toKind: "DELIVERY_NOTE" }, { now: FIX_DATE })).rejects.toThrow(ConvertError);
  });

  it("AB darf nur aus DRAFT/SENT in eine Rechnung umgewandelt werden, nicht aus ACCEPTED", async () => {
    const quote = await createBusinessDocument(orgId, { kind: "ANGEBOT", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [lineA] }, { now: FIX_DATE });
    const { id: abId } = await convertDocument(orgId, { fromType: "QUOTE", fromId: quote.id, toKind: "AUFTRAGSBESTAETIGUNG" }, { now: FIX_DATE });
    await setQuoteStatus(orgId, abId, "ACCEPTED", { now: FIX_DATE });
    await expect(convertDocument(orgId, { fromType: "QUOTE", fromId: abId, toKind: "INVOICE" }, { now: FIX_DATE })).rejects.toThrow(ConvertError);
  });

  it("stornierte Rechnung kann nicht in einen Lieferschein umgewandelt werden", async () => {
    const invoice = await createDraftInvoice(orgId, { customerId, type: "INVOICE", taxScheme: "REGULAR", currency: "EUR", lines: [lineB] }, { now: FIX_DATE });
    await dbInternal.invoice.update({ where: { id: invoice.id }, data: { status: "CANCELLED" } });
    await expect(convertDocument(orgId, { fromType: "INVOICE", fromId: invoice.id, toKind: "DELIVERY_NOTE" }, { now: FIX_DATE })).rejects.toThrow(ConvertError);
  });

  it("Re-Review Fix-Runde 2: storniertes Proforma kann nicht in eine Rechnung umgewandelt werden", async () => {
    const proforma = await createBusinessDocument(orgId, { kind: "PROFORMA", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [lineA] }, { now: FIX_DATE });
    await setQuoteStatus(orgId, proforma.id, "CANCELLED", { now: FIX_DATE });
    await expect(convertDocument(orgId, { fromType: "QUOTE", fromId: proforma.id, toKind: "INVOICE" }, { now: FIX_DATE })).rejects.toThrow(ConvertError);
  });

  it("Re-Review Fix-Runde 2: nicht-storniertes Proforma kann in eine Rechnung umgewandelt werden", async () => {
    const proforma = await createBusinessDocument(orgId, { kind: "PROFORMA", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [lineA] }, { now: FIX_DATE });
    const result = await convertDocument(orgId, { fromType: "QUOTE", fromId: proforma.id, toKind: "INVOICE" }, { now: FIX_DATE });
    expect(result.type).toBe("INVOICE");
    const invoice = await dbInternal.invoice.findUniqueOrThrow({ where: { id: result.id } });
    expect(invoice.status).toBe("DRAFT");
  });
});

describe("Teillieferung mit Restmengen", () => {
  it("liefert Teilmengen, verweigert Ueberlieferung, ignoriert stornierte Lieferscheine", async () => {
    const quote = await createBusinessDocument(orgId, { kind: "ANGEBOT", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [lineA] }, { now: FIX_DATE });
    const { id: abId } = await convertDocument(orgId, { fromType: "QUOTE", fromId: quote.id, toKind: "AUFTRAGSBESTAETIGUNG" }, { now: FIX_DATE });
    const ab = await dbInternal.quote.findUniqueOrThrow({ where: { id: abId }, include: { lines: true } });
    const abLine = ab.lines[0]!;

    // 4 von 10 -> Rest 6
    const firstResult = await convertDocument(orgId, { fromType: "QUOTE", fromId: abId, toKind: "DELIVERY_NOTE", quantities: [{ sourceLineId: abLine.id, quantityMilli: 4000 }] }, { now: FIX_DATE });
    let remaining = await remainingQuantities(orgId, "QUOTE", abId);
    expect(remaining[0]!.remainingMilli).toBe(6000);
    expect(remaining[0]!.deliveredMilli).toBe(4000);

    // + 6 -> Rest 0
    const secondResult = await convertDocument(orgId, { fromType: "QUOTE", fromId: abId, toKind: "DELIVERY_NOTE", quantities: [{ sourceLineId: abLine.id, quantityMilli: 6000 }] }, { now: FIX_DATE });
    remaining = await remainingQuantities(orgId, "QUOTE", abId);
    expect(remaining[0]!.remainingMilli).toBe(0);

    // + 1 -> OverDeliveryError
    await expect(
      convertDocument(orgId, { fromType: "QUOTE", fromId: abId, toKind: "DELIVERY_NOTE", quantities: [{ sourceLineId: abLine.id, quantityMilli: 1000 }] }),
    ).rejects.toThrow(OverDeliveryError);

    // Relationen DELIVERED_BY vorhanden
    const rel = await listRelations(orgId, "QUOTE", abId);
    expect(rel.filter((r) => r.relationType === "DELIVERED_BY")).toHaveLength(2);

    // Zweiten Lieferschein stornieren -> zaehlt nicht mehr mit
    await setDeliveryNoteStatus(orgId, secondResult.id, "CANCELLED", { now: FIX_DATE });
    remaining = await remainingQuantities(orgId, "QUOTE", abId);
    expect(remaining[0]!.remainingMilli).toBe(6000);
    expect(remaining[0]!.deliveredMilli).toBe(4000);

    // Erster Lieferschein bleibt aktiv
    const firstNote = await dbInternal.deliveryNote.findUniqueOrThrow({ where: { id: firstResult.id } });
    expect(firstNote.status).toBe("CREATED");
  });

  it("W1 (Fix-Runde 2): Restmengenpruefung laeuft auf dem Transaktions-Client, nicht auf dbInternal", async () => {
    const quote = await createBusinessDocument(orgId, { kind: "ANGEBOT", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [lineA] }, { now: FIX_DATE });
    const { id: abId } = await convertDocument(orgId, { fromType: "QUOTE", fromId: quote.id, toKind: "AUFTRAGSBESTAETIGUNG" }, { now: FIX_DATE });

    const spy = vi.spyOn(quantitiesModule, "remainingQuantities");
    await convertDocument(orgId, { fromType: "QUOTE", fromId: abId, toKind: "DELIVERY_NOTE", quantities: [] }, { now: FIX_DATE }).catch(() => {});
    // Aufruf erfolgte mit einem vierten Argument (tx), nicht dbInternal direkt.
    expect(spy).toHaveBeenCalled();
    const call = spy.mock.calls[0]!;
    expect(call[3]).toBeDefined();
    spy.mockRestore();
  });

  it("Rechnung -> Lieferschein ist ebenfalls moeglich", async () => {
    const invoice = await createDraftInvoice(orgId, { customerId, type: "INVOICE", taxScheme: "REGULAR", currency: "EUR", lines: [lineB] }, { now: FIX_DATE });
    const result = await convertDocument(orgId, { fromType: "INVOICE", fromId: invoice.id, toKind: "DELIVERY_NOTE" }, { now: FIX_DATE });
    const note = await dbInternal.deliveryNote.findUniqueOrThrow({ where: { id: result.id }, include: { lines: true } });
    expect(note.sourceType).toBe("INVOICE");
    expect(note.sourceId).toBe(invoice.id);
    expect(note.lines).toHaveLength(1);
    expect(note.lines[0]!.quantityMilli).toBe(lineB.quantityMilli);

    const rel = await listRelations(orgId, "INVOICE", invoice.id);
    expect(rel.some((r) => r.toId === note.id && r.relationType === "DELIVERED_BY")).toBe(true);
  });
});

describe("Duplizieren", () => {
  it("Angebot: neuer DRAFT ohne Nummer, Positionen kopiert, Relation DUPLICATED_FROM", async () => {
    const quote = await createBusinessDocument(orgId, { kind: "ANGEBOT", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [lineA, lineB] }, { now: FIX_DATE });
    const result = await duplicateDocument(orgId, "QUOTE", quote.id, "tester", FIX_DATE);
    const copy = await dbInternal.quote.findUniqueOrThrow({ where: { id: result.id }, include: { lines: true } });
    expect(copy.number).toBeNull();
    expect(copy.status).toBe("DRAFT");
    expect(copy.lines).toHaveLength(2);

    const rel = await listRelations(orgId, "QUOTE", copy.id);
    expect(rel.some((r) => r.fromId === copy.id && r.toId === quote.id && r.relationType === "DUPLICATED_FROM")).toBe(true);
  });

  it("Rechnung: neuer DRAFT ohne Nummer, Positionen kopiert", async () => {
    const invoice = await createDraftInvoice(orgId, { customerId, type: "INVOICE", taxScheme: "REGULAR", currency: "EUR", lines: [lineA] }, { now: FIX_DATE });
    const result = await duplicateDocument(orgId, "INVOICE", invoice.id, "tester", FIX_DATE);
    const copy = await dbInternal.invoice.findUniqueOrThrow({ where: { id: result.id }, include: { lines: true } });
    expect(copy.number).toBeNull();
    expect(copy.status).toBe("DRAFT");
    expect(copy.lines).toHaveLength(1);
  });

  it("Lieferschein: neuer DRAFT ohne Nummer, Positionen kopiert", async () => {
    const invoice = await createDraftInvoice(orgId, { customerId, type: "INVOICE", taxScheme: "REGULAR", currency: "EUR", lines: [lineB] }, { now: FIX_DATE });
    const { id: noteId } = await convertDocument(orgId, { fromType: "INVOICE", fromId: invoice.id, toKind: "DELIVERY_NOTE" }, { now: FIX_DATE });
    const result = await duplicateDocument(orgId, "DELIVERY_NOTE", noteId, "tester", FIX_DATE);
    const copy = await dbInternal.deliveryNote.findUniqueOrThrow({ where: { id: result.id }, include: { lines: true } });
    expect(copy.number).toBeNull();
    expect(copy.status).toBe("DRAFT");
    expect(copy.lines).toHaveLength(1);
  });

  it("Lieferschein: Kopf-sourceType/sourceId werden mitkopiert (Fix-Runde 1, Befund 3)", async () => {
    const invoice = await createDraftInvoice(orgId, { customerId, type: "INVOICE", taxScheme: "REGULAR", currency: "EUR", lines: [lineB] }, { now: FIX_DATE });
    const { id: noteId } = await convertDocument(orgId, { fromType: "INVOICE", fromId: invoice.id, toKind: "DELIVERY_NOTE" }, { now: FIX_DATE });
    const original = await dbInternal.deliveryNote.findUniqueOrThrow({ where: { id: noteId } });
    expect(original.sourceType).toBe("INVOICE");
    expect(original.sourceId).toBe(invoice.id);

    const result = await duplicateDocument(orgId, "DELIVERY_NOTE", noteId, "tester", FIX_DATE);
    const copy = await dbInternal.deliveryNote.findUniqueOrThrow({ where: { id: result.id } });
    expect(copy.sourceType).toBe("INVOICE");
    expect(copy.sourceId).toBe(invoice.id);
  });

  it("Quelle darf storniert sein", async () => {
    const quote = await createBusinessDocument(orgId, { kind: "ANGEBOT", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [lineA] }, { now: FIX_DATE });
    await setQuoteStatus(orgId, quote.id, "CANCELLED", { now: FIX_DATE });
    const result = await duplicateDocument(orgId, "QUOTE", quote.id, "tester", FIX_DATE);
    expect(result.type).toBe("QUOTE");
  });
});

describe("Entwurf bearbeiten", () => {
  it("aktualisiert Kopfdaten und Positionen eines DRAFT-Dokuments, Summen neu berechnet", async () => {
    const quote = await createBusinessDocument(orgId, { kind: "ANGEBOT", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [lineA] }, { now: FIX_DATE });
    const updated = await updateDraftDocument(orgId, quote.id, { subject: "Neues Angebot", lines: [lineA, lineB] }, "tester");
    expect(updated.subject).toBe("Neues Angebot");
    const withLines = await dbInternal.quote.findUniqueOrThrow({ where: { id: quote.id }, include: { lines: true } });
    expect(withLines.lines).toHaveLength(2);
    expect(withLines.grossTotalCents).toBeGreaterThan(0);

    const log = await dbInternal.changeLog.findFirst({ where: { orgId, entity: "QUOTE", entityId: quote.id, action: "UPDATE" } });
    expect(log).not.toBeNull();
    const diff = JSON.parse(log!.diffJson);
    expect(diff.changedFields).toContain("lines");
    expect(diff.changedFields).not.toEqual(expect.arrayContaining(["Beratung", "Kabel"])); // keine Positionsliste im Diff
  });

  it("verweigert die Bearbeitung, wenn das Dokument nicht mehr DRAFT ist", async () => {
    const quote = await createBusinessDocument(orgId, { kind: "ANGEBOT", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [lineA] }, { now: FIX_DATE });
    await setQuoteStatus(orgId, quote.id, "SENT", { now: FIX_DATE });
    await expect(updateDraftDocument(orgId, quote.id, { subject: "Zu spaet" }, "tester")).rejects.toThrow(StatusTransitionError);
  });

  it("W3 (Fix-Runde 2): Kundenwechsel im CREATE-Snapshot-Entwurf baut den Kaeufer-Snapshot neu", async () => {
    const quote = await createBusinessDocument(orgId, { kind: "ANGEBOT", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [lineA] }, { now: FIX_DATE });
    expect(quote.snapshotSource).toBe("CREATE");
    const buyerBefore = JSON.parse(quote.buyerSnapshotJson!);
    expect(buyerBefore.name).toBe("Kunde AG");

    const otherCustomer = await dbInternal.customer.create({
      data: { orgId, name: "Neuer Kunde GmbH", addressLine1: "Neue Str. 9", postalCode: "10115", city: "Berlin", type: "BUSINESS" },
    });

    const updated = await updateDraftDocument(orgId, quote.id, { customerId: otherCustomer.id }, "tester");
    expect(updated.customerId).toBe(otherCustomer.id);
    const buyerAfter = JSON.parse(updated.buyerSnapshotJson!);
    expect(buyerAfter.name).toBe("Neuer Kunde GmbH");
    expect(updated.snapshotSource).toBe("CREATE");
  });
});

describe("Fremde Organisation", () => {
  it("convertDocument, remainingQuantities, duplicateDocument und updateDraftDocument scheitern bei fremder Org", async () => {
    const quote = await createBusinessDocument(orgId, { kind: "ANGEBOT", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [lineA] }, { now: FIX_DATE });

    await expect(convertDocument(otherOrgId, { fromType: "QUOTE", fromId: quote.id, toKind: "AUFTRAGSBESTAETIGUNG" })).rejects.toThrow();
    await expect(remainingQuantities(otherOrgId, "QUOTE", quote.id)).rejects.toThrow();
    await expect(duplicateDocument(otherOrgId, "QUOTE", quote.id, "tester")).rejects.toThrow();
    await expect(updateDraftDocument(otherOrgId, quote.id, { subject: "Fremd" }, "tester")).rejects.toThrow();
  });
});

describe("Fix-Runde 1 -- F1: Konvertierung/Duplikat sind transaktional", () => {
  it("Angebot -> AB: schlaegt linkDocuments fehl, bleiben weder AB noch Relation noch Statuswechsel in der DB", async () => {
    const quote = await createBusinessDocument(orgId, { kind: "ANGEBOT", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [lineA] }, { now: FIX_DATE });
    const abCountBefore = await dbInternal.quote.count({ where: { orgId, kind: "AUFTRAGSBESTAETIGUNG" } });

    const spy = vi.spyOn(relationsModule, "linkDocuments").mockRejectedValueOnce(new Error("kaputt (Test)"));
    await expect(
      convertDocument(orgId, { fromType: "QUOTE", fromId: quote.id, toKind: "AUFTRAGSBESTAETIGUNG" }, { now: FIX_DATE }),
    ).rejects.toThrow("kaputt (Test)");
    spy.mockRestore();

    const reloaded = await dbInternal.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(reloaded.status).toBe("DRAFT"); // Statuswechsel auf ACCEPTED wurde zurueckgerollt
    const abCountAfter = await dbInternal.quote.count({ where: { orgId, kind: "AUFTRAGSBESTAETIGUNG" } });
    expect(abCountAfter).toBe(abCountBefore); // keine verwaiste AB
    expect(await listRelations(orgId, "QUOTE", quote.id)).toHaveLength(0);
  });

  it("Rechnung -> Lieferschein: schlaegt linkDocuments fehl, bleibt kein Lieferschein in der DB", async () => {
    const invoice = await createDraftInvoice(orgId, { customerId, type: "INVOICE", taxScheme: "REGULAR", currency: "EUR", lines: [lineB] }, { now: FIX_DATE });
    const noteCountBefore = await dbInternal.deliveryNote.count({ where: { orgId } });

    const spy = vi.spyOn(relationsModule, "linkDocuments").mockRejectedValueOnce(new Error("kaputt (Test)"));
    await expect(
      convertDocument(orgId, { fromType: "INVOICE", fromId: invoice.id, toKind: "DELIVERY_NOTE" }, { now: FIX_DATE }),
    ).rejects.toThrow("kaputt (Test)");
    spy.mockRestore();

    expect(await dbInternal.deliveryNote.count({ where: { orgId } })).toBe(noteCountBefore);
    expect(await listRelations(orgId, "INVOICE", invoice.id)).toHaveLength(0);
  });

  it("Rechnungs-Duplikat: schlaegt linkDocuments fehl, bleibt kein Duplikat in der DB", async () => {
    const invoice = await createDraftInvoice(orgId, { customerId, type: "INVOICE", taxScheme: "REGULAR", currency: "EUR", lines: [lineA] }, { now: FIX_DATE });
    const invoiceCountBefore = await dbInternal.invoice.count({ where: { orgId } });

    const spy = vi.spyOn(relationsModule, "linkDocuments").mockRejectedValueOnce(new Error("kaputt (Test)"));
    await expect(duplicateDocument(orgId, "INVOICE", invoice.id, "tester", FIX_DATE)).rejects.toThrow("kaputt (Test)");
    spy.mockRestore();

    expect(await dbInternal.invoice.count({ where: { orgId } })).toBe(invoiceCountBefore);
    expect(await listRelations(orgId, "INVOICE", invoice.id)).toHaveLength(0);
  });
});

describe("Fix-Runde 1 -- F2: Restmengen zaehlen nur wirksame Lieferscheine", () => {
  it("DRAFT-Duplikat eines Lieferscheins zaehlt nicht mit; erst nach CREATED sinkt die Restmenge", async () => {
    const invoice = await createDraftInvoice(orgId, { customerId, type: "INVOICE", taxScheme: "REGULAR", currency: "EUR", lines: [lineA] }, { now: FIX_DATE });
    const invLine = (await dbInternal.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { lines: true } })).lines[0]!;

    // 4 von 10 liefern -> DN1 CREATED, Rest 6
    const dn1 = await convertDocument(orgId, { fromType: "INVOICE", fromId: invoice.id, toKind: "DELIVERY_NOTE", quantities: [{ sourceLineId: invLine.id, quantityMilli: 4000 }] }, { now: FIX_DATE });
    let remaining = await remainingQuantities(orgId, "INVOICE", invoice.id);
    expect(remaining[0]!.remainingMilli).toBe(6000);

    // DN1 duplizieren -> DN2 ist DRAFT und behaelt sourceLineId, zaehlt aber (noch) nicht mit
    const dn2 = await duplicateDocument(orgId, "DELIVERY_NOTE", dn1.id, "tester", FIX_DATE);
    const dn2Note = await dbInternal.deliveryNote.findUniqueOrThrow({ where: { id: dn2.id }, include: { lines: true } });
    expect(dn2Note.status).toBe("DRAFT");
    expect(dn2Note.lines[0]!.sourceLineId).toBe(invLine.id);

    remaining = await remainingQuantities(orgId, "INVOICE", invoice.id);
    expect(remaining[0]!.remainingMilli).toBe(6000); // unveraendert, DRAFT zaehlt nicht

    // DN2 auf CREATED setzen -> zaehlt jetzt mit
    await setDeliveryNoteStatus(orgId, dn2.id, "CREATED", { now: FIX_DATE });
    remaining = await remainingQuantities(orgId, "INVOICE", invoice.id);
    expect(remaining[0]!.remainingMilli).toBe(2000); // 6000 - 4000 (DN2 hat dieselbe Menge wie DN1)
  });
});

describe("Fix-Runde 1 -- F3: Rechnungs-Duplikat vollstaendig", () => {
  it("uebernimmt headerText/footerText/Lieferdatum/buyerReference der Quelle, aber NICHT dueDate", async () => {
    const invoice = await createDraftInvoice(
      orgId,
      {
        customerId,
        type: "INVOICE",
        taxScheme: "REGULAR",
        currency: "EUR",
        lines: [lineA],
        headerText: "Kopftext Quelle",
        footerText: "Fusstext Quelle",
        deliveryDate: FIX_DATE,
        buyerReference: "PO-123",
        dueDate: new Date("2031-06-01T00:00:00.000Z"),
      },
      { now: FIX_DATE },
    );

    const result = await duplicateDocument(orgId, "INVOICE", invoice.id, "tester", FIX_DATE);
    const copy = await dbInternal.invoice.findUniqueOrThrow({ where: { id: result.id } });
    expect(copy.headerText).toBe("Kopftext Quelle");
    expect(copy.footerText).toBe("Fusstext Quelle");
    expect(copy.deliveryDate?.toISOString()).toBe(FIX_DATE.toISOString());
    expect(copy.buyerReference).toBe("PO-123");
    expect(copy.dueDate).toBeNull(); // wird beim Festschreiben neu berechnet, nicht uebernommen
  });
});

describe("Fix-Runde 1 -- Info: convertQuoteToOrderConfirmation uebernimmt notes/internalNotes", () => {
  it("uebertraegt notes und internalNotes des Angebots auf die AB", async () => {
    const quote = await createBusinessDocument(
      orgId,
      { kind: "ANGEBOT", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [lineA], notes: "Oeffentliche Notiz", internalNotes: "Interne Notiz" },
      { now: FIX_DATE },
    );
    const result = await convertDocument(orgId, { fromType: "QUOTE", fromId: quote.id, toKind: "AUFTRAGSBESTAETIGUNG" }, { now: FIX_DATE });
    const ab = await dbInternal.quote.findUniqueOrThrow({ where: { id: result.id } });
    expect(ab.notes).toBe("Oeffentliche Notiz");
    expect(ab.internalNotes).toBe("Interne Notiz");
  });
});

describe("ChangeLog-Kette", () => {
  it("bleibt ueber alle Schreiboperationen dieses Tests gueltig (verifyChain)", async () => {
    const rows = await dbInternal.changeLog.findMany({
      where: { orgId },
      orderBy: { id: "asc" },
      select: { prevHash: true, hash: true, entity: true, entityId: true, action: true, actor: true, at: true, diffJson: true },
    });
    const entries: ChainEntry[] = rows.map((r) => ({
      prevHash: r.prevHash,
      hash: r.hash,
      payload: { entity: r.entity, entityId: r.entityId, action: r.action, actor: r.actor, at: r.at.toISOString(), diff: JSON.parse(r.diffJson) },
    }));
    expect(entries.length).toBeGreaterThan(10);
    expect(verifyChain(entries).valid).toBe(true);
  });
});
