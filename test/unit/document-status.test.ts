import { describe, it, expect, beforeAll } from "vitest";
import { dbInternal } from "@/lib/db";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { createBusinessDocument } from "@/domain/document/create";
import { createDeliveryNote } from "@/domain/delivery-note/create";
import { duplicateDocument } from "@/domain/document/duplicate";
import {
  QUOTE_TRANSITIONS,
  DELIVERY_TRANSITIONS,
  StatusTransitionError,
  assertTransition,
  setQuoteStatus,
  setDeliveryNoteStatus,
  setArchived,
  effectiveQuoteStatus,
} from "@/domain/document/status";

let orgId: string;
let customerId: string;
const FIX_DATE = new Date("2031-06-09T10:00:00.000Z");

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: {
      legalName: "Status Test GmbH",
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

const line = { description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19 as const, taxCategory: "S" as const, discountPermille: 0 };

async function createQuote(extra: Partial<Parameters<typeof createBusinessDocument>[1]> = {}) {
  return createBusinessDocument(orgId, {
    kind: "ANGEBOT",
    customerId,
    taxScheme: "REGULAR",
    currency: "EUR",
    lines: [line],
    ...extra,
  } as Parameters<typeof createBusinessDocument>[1], { now: FIX_DATE });
}

async function createNote() {
  return createDeliveryNote(orgId, {
    customerId,
    showPrices: false,
    showTax: false,
    showArticleNumber: true,
    showDescription: true,
    lines: [{ description: "Paket", quantityMilli: 1000, unit: "C62" }],
  } as Parameters<typeof createDeliveryNote>[1], { now: FIX_DATE });
}

describe("Uebergangstabellen", () => {
  it("QUOTE_TRANSITIONS erlaubt DRAFT -> ACCEPTED (Annahme ohne Versand)", () => {
    expect(QUOTE_TRANSITIONS.DRAFT).toContain("ACCEPTED");
  });

  it("REJECTED ist terminal", () => {
    expect(QUOTE_TRANSITIONS.REJECTED).toHaveLength(0);
  });

  it("CANCELLED ist terminal (Quote und Lieferschein)", () => {
    expect(QUOTE_TRANSITIONS.CANCELLED).toHaveLength(0);
    expect(DELIVERY_TRANSITIONS.CANCELLED).toHaveLength(0);
  });

  it("assertTransition wirft StatusTransitionError bei verbotenem Uebergang (CREATED -> DRAFT)", () => {
    expect(() => assertTransition(DELIVERY_TRANSITIONS, "CREATED", "DRAFT")).toThrow(StatusTransitionError);
  });

  it("assertTransition erlaubt gueltigen Uebergang ohne zu werfen", () => {
    expect(() => assertTransition(QUOTE_TRANSITIONS, "DRAFT", "SENT")).not.toThrow();
  });
});

describe("effectiveQuoteStatus", () => {
  const now = new Date("2031-06-15T00:00:00.000Z");

  it("liefert EXPIRED, wenn DRAFT/SENT und validUntil in der Vergangenheit liegt", () => {
    expect(effectiveQuoteStatus({ status: "DRAFT", validUntil: new Date("2031-06-01T00:00:00.000Z") }, now)).toBe("EXPIRED");
    expect(effectiveQuoteStatus({ status: "SENT", validUntil: new Date("2031-06-01T00:00:00.000Z") }, now)).toBe("EXPIRED");
  });

  it("liefert den echten Status, wenn validUntil noch nicht erreicht ist", () => {
    expect(effectiveQuoteStatus({ status: "SENT", validUntil: new Date("2031-07-01T00:00:00.000Z") }, now)).toBe("SENT");
  });

  it("liefert den echten Status ohne validUntil", () => {
    expect(effectiveQuoteStatus({ status: "DRAFT", validUntil: null }, now)).toBe("DRAFT");
  });

  it("wirkt sich nicht auf terminale Status aus (ACCEPTED bleibt ACCEPTED)", () => {
    expect(effectiveQuoteStatus({ status: "ACCEPTED", validUntil: new Date("2031-01-01T00:00:00.000Z") }, now)).toBe("ACCEPTED");
  });
});

describe("setQuoteStatus", () => {
  it("friert bei SENT den Snapshot ein (inkl. contactName) und schreibt ChangeLog", async () => {
    const contact = await dbInternal.contactPerson.create({
      data: { orgId, customerId, firstName: "Erika", lastName: "Musterfrau" },
    });
    const quote = await createQuote();
    // Simuliert einen Altfall ohne Snapshot (z. B. Migration) mit nachtraeglich gesetzter
    // Kontaktperson — der reguläre Fall (Kontaktperson bereits bei CREATE gesetzt) wird
    // im folgenden Test abgedeckt.
    await dbInternal.quote.update({ where: { id: quote.id }, data: { contactPersonId: contact.id, buyerSnapshotJson: null, sellerSnapshotJson: null } });

    const updated = await setQuoteStatus(orgId, quote.id, "SENT", { now: FIX_DATE, actor: "tester" });
    expect(updated.status).toBe("SENT");
    expect(updated.sentAt?.toISOString()).toBe(FIX_DATE.toISOString());
    expect(updated.buyerSnapshotJson).not.toBeNull();
    const buyer = JSON.parse(updated.buyerSnapshotJson!);
    expect(buyer.contactName).toBe("Erika Musterfrau");
    expect(updated.snapshotSource).toBe("SENT");

    const logs = await dbInternal.changeLog.findMany({ where: { orgId, entity: "QUOTE", entityId: quote.id } });
    expect(logs.some((l) => l.action === "STATUS_SENT")).toBe(true);
  });

  it("setzt buyerSnapshotJson nicht erneut, wenn bereits ein SENT-Snapshot vorhanden ist", async () => {
    const quote = await createQuote();
    const sent = await setQuoteStatus(orgId, quote.id, "SENT", { now: FIX_DATE });
    const snapshotBefore = sent.buyerSnapshotJson;
    const cancelled = await setQuoteStatus(orgId, quote.id, "CANCELLED", { now: FIX_DATE });
    expect(cancelled.buyerSnapshotJson).toBe(snapshotBefore);
  });

  it("ersetzt den CREATE-Snapshot bei SENT (nachtraeglicher Ansprechpartner), zweiter SENT-Versuch aendert den SENT-Snapshot nicht mehr", async () => {
    const quote = await createQuote();
    expect(quote.snapshotSource).toBe("CREATE"); // createBusinessDocument friert bereits bei CREATE einen Snapshot ein

    const contact = await dbInternal.contactPerson.create({
      data: { orgId, customerId, firstName: "Erika", lastName: "Musterfrau" },
    });
    await dbInternal.quote.update({ where: { id: quote.id }, data: { contactPersonId: contact.id } }); // nachtraeglich gesetzt

    const sent = await setQuoteStatus(orgId, quote.id, "SENT", { now: FIX_DATE });
    expect(sent.snapshotSource).toBe("SENT");
    const buyer = JSON.parse(sent.buyerSnapshotJson!);
    expect(buyer.contactName).toBe("Erika Musterfrau"); // CREATE-Snapshot (ohne Kontakt) wurde ersetzt

    // EXPIRED ist kein aktiv setzbarer Status mehr (W4, Fix-Runde 2) — stattdessen wird ein
    // abgelaufenes validUntil simuliert (effectiveQuoteStatus liest SENT + verstrichenes
    // validUntil als EXPIRED); der real gespeicherte Status bleibt SENT, ein erneuter
    // SENT-Aufruf ist damit weiterhin ein Uebergang SENT -> SENT... — stattdessen wird
    // direkt geprueft, dass effectiveQuoteStatus EXPIRED liefert und der SENT-Snapshot bei
    // einem erneuten setQuoteStatus(..., "SENT") ueber EXPIRED->SENT unangetastet bleibt.
    await dbInternal.quote.update({ where: { id: sent.id }, data: { status: "EXPIRED", validUntil: new Date("2031-01-01T00:00:00.000Z") } });
    expect(effectiveQuoteStatus({ status: "EXPIRED", validUntil: new Date("2031-01-01T00:00:00.000Z") }, FIX_DATE)).toBe("EXPIRED");

    const sentAgain = await setQuoteStatus(orgId, sent.id, "SENT", { now: FIX_DATE });
    expect(sentAgain.buyerSnapshotJson).toBe(sent.buyerSnapshotJson); // SENT-Snapshot bleibt unangetastet
  });

  it("wirft StatusTransitionError, wenn EXPIRED aktiv als Ziel gesetzt werden soll", async () => {
    const quote = await createQuote();
    await expect(setQuoteStatus(orgId, quote.id, "EXPIRED", { now: FIX_DATE })).rejects.toThrow(StatusTransitionError);
  });

  it("setzt decidedAt/decisionNote bei ACCEPTED", async () => {
    const quote = await createQuote();
    const updated = await setQuoteStatus(orgId, quote.id, "ACCEPTED", { now: FIX_DATE, note: "Telefonisch zugesagt" });
    expect(updated.decidedAt?.toISOString()).toBe(FIX_DATE.toISOString());
    expect(updated.decisionNote).toBe("Telefonisch zugesagt");
  });

  it("wirft StatusTransitionError bei verbotenem Uebergang", async () => {
    const quote = await createQuote();
    await setQuoteStatus(orgId, quote.id, "REJECTED", { now: FIX_DATE });
    await expect(setQuoteStatus(orgId, quote.id, "SENT", { now: FIX_DATE })).rejects.toThrow(StatusTransitionError);
  });

  it("wirft bei fremder Org (kein Treffer)", async () => {
    const quote = await createQuote();
    const otherOrg = await dbInternal.organization.create({
      data: { legalName: "Andere GmbH", addressLine1: "X", postalCode: "1", city: "Y" },
    });
    await expect(setQuoteStatus(otherOrg.id, quote.id, "SENT", { now: FIX_DATE })).rejects.toThrow();
  });
});

describe("setDeliveryNoteStatus", () => {
  it("setzt sentAt/deliveredAt und schreibt ChangeLog", async () => {
    const note = await createNote();
    const sent = await setDeliveryNoteStatus(orgId, note.id, "SENT", { now: FIX_DATE });
    expect(sent.sentAt?.toISOString()).toBe(FIX_DATE.toISOString());
    const delivered = await setDeliveryNoteStatus(orgId, note.id, "DELIVERED", { now: FIX_DATE });
    expect(delivered.deliveredAt?.toISOString()).toBe(FIX_DATE.toISOString());

    const logs = await dbInternal.changeLog.findMany({ where: { orgId, entity: "DELIVERY_NOTE", entityId: note.id } });
    expect(logs.some((l) => l.action === "STATUS_DELIVERED")).toBe(true);
  });

  it("wirft bei verbotenem Uebergang CREATED -> DRAFT", async () => {
    const note = await createNote();
    await expect(setDeliveryNoteStatus(orgId, note.id, "DRAFT", { now: FIX_DATE })).rejects.toThrow(StatusTransitionError);
  });

  it("DRAFT -> CREATED vergibt eine Nummer, wenn noch keine vorhanden ist (Duplikat)", async () => {
    const note = await createNote();
    const copy = await duplicateDocument(orgId, "DELIVERY_NOTE", note.id, "system", FIX_DATE);
    const draft = await dbInternal.deliveryNote.findUniqueOrThrow({ where: { id: copy.id } });
    expect(draft.status).toBe("DRAFT");
    expect(draft.number).toBeNull();

    const created = await setDeliveryNoteStatus(orgId, copy.id, "CREATED", { now: FIX_DATE });
    expect(created.number).not.toBeNull();
    expect(created.number).not.toBe(note.number);
  });
});

describe("setArchived", () => {
  it("setzt/entfernt archivedAt und schreibt ChangeLog ARCHIVE/UNARCHIVE", async () => {
    const quote = await createQuote();
    await setArchived(orgId, "QUOTE", quote.id, true, "tester");
    const archived = await dbInternal.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(archived.archivedAt).not.toBeNull();

    await setArchived(orgId, "QUOTE", quote.id, false, "tester");
    const unarchived = await dbInternal.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(unarchived.archivedAt).toBeNull();

    const logs = await dbInternal.changeLog.findMany({ where: { orgId, entity: "QUOTE", entityId: quote.id } });
    expect(logs.some((l) => l.action === "ARCHIVE")).toBe(true);
    expect(logs.some((l) => l.action === "UNARCHIVE")).toBe(true);
  });
});
