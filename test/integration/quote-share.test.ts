/**
 * Task 2 (Phase 3b): Angebotslinks, Online-Entscheidung, Automatik, Benachrichtigung.
 * In-Memory-Mailprovider, eigenes Jahr (2032) fuer die Nummernvergabe.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { dbInternal } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import * as audit from "@/domain/audit";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { createBusinessDocument } from "@/domain/document/create";
import { saveMailSettings } from "@/domain/email/settings";
import { saveDocumentSettings, loadDocumentSettings } from "@/domain/document/settings";
import {
  createShareLink,
  revokeShareLink,
  resolveShareToken,
  listShareLinks,
  revealShareLinkToken,
  ShareLinkError,
} from "@/domain/quote-share/link";
import { decideOffer, AlreadyDecidedError, InvalidShareLinkError } from "@/domain/quote-share/decide";
import { resetRateLimits, RateLimitError } from "@/lib/rate-limit";
import { verifyChain, type ChainEntry } from "@/domain/changelog";
import { createMemoryProvider } from "@/lib/mail/memory";

const FIX_DATE = new Date("2032-03-01T10:00:00.000Z");

let orgId: string;
let customerId: string;

const line = { description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19 as const, taxCategory: "S" as const, discountPermille: 0 };

async function makeQuote(overrides: Partial<Parameters<typeof createBusinessDocument>[1]> = {}) {
  return createBusinessDocument(orgId, { kind: "ANGEBOT", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [line], ...overrides }, { now: FIX_DATE });
}

async function chainValid(): Promise<boolean> {
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
  return verifyChain(entries).valid;
}

beforeAll(async () => {
  process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "test-auth-secret-mindestens-16-zeichen";

  const org = await dbInternal.organization.create({
    data: {
      legalName: "Angebots GmbH",
      addressLine1: "Hauptstr. 1",
      postalCode: "21339",
      city: "Lüneburg",
      vatId: "DE123456789",
      taxNumber: "33/123/45678",
      email: "org@example.org",
    },
  });
  orgId = org.id;

  const customer = await dbInternal.customer.create({
    data: { orgId, name: "Kunde AG", addressLine1: "Marktplatz 2", postalCode: "20095", city: "Hamburg", type: "BUSINESS", email: "kunde@example.org" },
  });
  customerId = customer.id;

  await ensureOrgMasterdata(dbInternal, orgId);

  await saveMailSettings(orgId, {
    host: "localhost",
    port: 2525,
    security: "NONE",
    fromName: "Angebots GmbH",
    fromEmail: "rechnung@example.org",
    defaultBcc: "",
    defaultCc: "",
    copyToSelf: false,
  });
});

describe("DocumentSettings", () => {
  it("liefert Defaults ohne gespeicherte Zeile; speichert und laedt danach die gesetzten Werte", async () => {
    const org2 = await dbInternal.organization.create({
      data: { legalName: "Ohne Einstellungen GmbH", addressLine1: "Weg 1", postalCode: "10115", city: "Berlin" },
    });
    const defaults = await loadDocumentSettings(org2.id);
    expect(defaults).toEqual({ onQuoteAccept: "NONE", shareLinkDays: 30, storeAcceptIp: false });

    await saveDocumentSettings(org2.id, { onQuoteAccept: "ORDER_CONFIRMATION", shareLinkDays: 14, storeAcceptIp: true });
    const loaded = await loadDocumentSettings(org2.id);
    expect(loaded).toEqual({ onQuoteAccept: "ORDER_CONFIRMATION", shareLinkDays: 14, storeAcceptIp: true });
  });
});

describe("createShareLink", () => {
  it("nur fuer Angebote (kind=ANGEBOT); AB lehnt ab", async () => {
    const ab = await createBusinessDocument(orgId, { kind: "AUFTRAGSBESTAETIGUNG", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [line] }, { now: FIX_DATE });
    await expect(createShareLink(orgId, ab.id, {}, { now: FIX_DATE })).rejects.toBeInstanceOf(ShareLinkError);
  });

  it("erzeugt einen Link fuer ein DRAFT-Angebot (Ruling: setzt NICHT auf SENT); Token nicht im Klartext in der DB", async () => {
    const quote = await makeQuote();
    expect(quote.status).toBe("DRAFT");

    const { link, token } = await createShareLink(orgId, quote.id, {}, { now: FIX_DATE, actor: "tester" });
    expect(token).toBeTruthy();
    expect(token.length).toBeGreaterThan(20);

    const stillDraft = await dbInternal.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(stillDraft.status).toBe("DRAFT");

    // Token nicht im Klartext gespeichert: die DB-Spalte ist ausschliesslich der Hash.
    const row = await dbInternal.quoteShareLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(row.tokenHash).not.toBe(token);
    const byPlaintext = await dbInternal.quoteShareLink.findFirst({ where: { tokenHash: token } });
    expect(byPlaintext).toBeNull();
    const byHash = await dbInternal.quoteShareLink.findFirst({ where: { tokenHash: row.tokenHash } });
    expect(byHash?.id).toBe(link.id);

    const cl = await dbInternal.changeLog.findFirst({ where: { orgId, entity: "QUOTE", entityId: quote.id, action: "SHARE_LINK_CREATED" } });
    expect(cl).not.toBeNull();
    const diff = JSON.parse(cl!.diffJson) as { linkId: string; expiresAt: string };
    expect(diff.linkId).toBe(link.id);
    expect(await chainValid()).toBe(true);
  });

  it("expiresAt = min(validUntil, now + expiresInDays/shareLinkDays)", async () => {
    const validUntil = new Date("2032-03-05T00:00:00.000Z"); // 4 Tage nach FIX_DATE
    const quote = await makeQuote({ validUntil });
    const { link } = await createShareLink(orgId, quote.id, { expiresInDays: 30 }, { now: FIX_DATE });
    expect(link.expiresAt.getTime()).toBe(validUntil.getTime());

    const quote2 = await makeQuote();
    const { link: link2 } = await createShareLink(orgId, quote2.id, { expiresInDays: 5 }, { now: FIX_DATE });
    expect(link2.expiresAt.getTime()).toBe(FIX_DATE.getTime() + 5 * 24 * 60 * 60 * 1000);
  });

  it("tokenEnc ist gesetzt; revealShareLinkToken liefert den Klartext zurueck (Adjudikation Task-1)", async () => {
    const quote = await makeQuote();
    const { link, token } = await createShareLink(orgId, quote.id, {}, { now: FIX_DATE });

    const row = await dbInternal.quoteShareLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(row.tokenEnc).toBeTruthy();
    expect(row.tokenEnc).not.toBe(token);

    const revealed = await revealShareLinkToken(orgId, link.id);
    expect(revealed).toBe(token);
  });

  it("revealShareLinkToken: fremde Organisation -> null", async () => {
    const quote = await makeQuote();
    const { link } = await createShareLink(orgId, quote.id, {}, { now: FIX_DATE });

    const foreignOrg = await dbInternal.organization.create({
      data: { legalName: "Fremdorg GmbH", addressLine1: "Fremdweg 1", postalCode: "10115", city: "Berlin" },
    });
    expect(await revealShareLinkToken(foreignOrg.id, link.id)).toBeNull();
  });

  it("revealShareLinkToken: unbekannte linkId -> null", async () => {
    expect(await revealShareLinkToken(orgId, "does-not-exist")).toBeNull();
  });

  it("listShareLinks: listet alle Links eines Angebots, neueste zuerst", async () => {
    const quote = await makeQuote();
    const first = await createShareLink(orgId, quote.id, {}, { now: FIX_DATE });
    const second = await createShareLink(orgId, quote.id, {}, { now: new Date(FIX_DATE.getTime() + 1000) });
    const list = await listShareLinks(orgId, quote.id);
    expect(list.map((l) => l.id)).toEqual([second.link.id, first.link.id]);
  });
});

describe("resolveShareToken", () => {
  it("unbekanntes Token -> null", async () => {
    expect(await resolveShareToken("does-not-exist", FIX_DATE)).toBeNull();
  });

  it("widerrufener Link -> null", async () => {
    const quote = await makeQuote();
    const { token } = await createShareLink(orgId, quote.id, {}, { now: FIX_DATE });
    const resolved = await resolveShareToken(token, FIX_DATE);
    await revokeShareLink(orgId, resolved!.link.id, { now: FIX_DATE });
    expect(await resolveShareToken(token, FIX_DATE)).toBeNull();
  });

  it("abgelaufener Link -> null", async () => {
    const quote = await makeQuote();
    const { token } = await createShareLink(orgId, quote.id, { expiresInDays: 1 }, { now: FIX_DATE });
    const later = new Date(FIX_DATE.getTime() + 2 * 24 * 60 * 60 * 1000);
    expect(await resolveShareToken(token, later)).toBeNull();
  });

  it("archiviertes/storniertes Angebot -> null", async () => {
    const quote = await makeQuote();
    const { token } = await createShareLink(orgId, quote.id, {}, { now: FIX_DATE });
    await dbInternal.quote.update({ where: { id: quote.id }, data: { archivedAt: FIX_DATE } });
    expect(await resolveShareToken(token, FIX_DATE)).toBeNull();
  });

  it("gueltiger Link -> Quote mit lines/org/customer; viewCount/lastViewedAt werden gezaehlt, kein ChangeLog", async () => {
    const quote = await makeQuote();
    const { token } = await createShareLink(orgId, quote.id, {}, { now: FIX_DATE });
    const changeLogsBefore = await dbInternal.changeLog.count({ where: { orgId } });

    const resolved = await resolveShareToken(token, FIX_DATE);
    expect(resolved).not.toBeNull();
    expect(resolved!.quote.lines.length).toBe(1);
    expect(resolved!.quote.org.legalName).toBe("Angebots GmbH");
    expect(resolved!.quote.customer.name).toBe("Kunde AG");
    expect(resolved!.link.viewCount).toBe(1);
    expect(resolved!.link.lastViewedAt?.getTime()).toBe(FIX_DATE.getTime());

    expect(await dbInternal.changeLog.count({ where: { orgId } })).toBe(changeLogsBefore);
  });
});

describe("decideOffer", () => {
  it("Annahme -> Quote ACCEPTED, Link-Felder gesetzt, ChangeLog ACCEPTED_ONLINE, Benachrichtigungs-EmailLog, IP nur mit Einstellung", async () => {
    resetRateLimits();
    await saveDocumentSettings(orgId, { onQuoteAccept: "NONE", shareLinkDays: 30, storeAcceptIp: false });

    const quote = await makeQuote();
    const { token, link } = await createShareLink(orgId, quote.id, {}, { now: FIX_DATE });

    const provider = createMemoryProvider();
    const decideNow = new Date(FIX_DATE.getTime() + 1000);
    const result = await decideOffer(
      token,
      { decision: "ACCEPTED", name: "Max Mustermann", email: "max@example.org", comment: "Passt so." },
      { ip: "203.0.113.1", now: decideNow, provider },
    );
    expect(result.decision).toBe("ACCEPTED");
    expect(result.automation).toBeUndefined();
    expect(result.automationError).toBeUndefined();

    const updatedQuote = await dbInternal.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(updatedQuote.status).toBe("ACCEPTED");

    const updatedLink = await dbInternal.quoteShareLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(updatedLink.decidedAt?.getTime()).toBe(decideNow.getTime());
    expect(updatedLink.decision).toBe("ACCEPTED");
    expect(updatedLink.deciderName).toBe("Max Mustermann");
    expect(updatedLink.deciderEmail).toBe("max@example.org");
    expect(updatedLink.deciderComment).toBe("Passt so.");
    // storeAcceptIp = false -> IP wird NICHT gespeichert.
    expect(updatedLink.deciderIp).toBeNull();

    const cl = await dbInternal.changeLog.findFirst({ where: { orgId, entity: "QUOTE", entityId: quote.id, action: "ACCEPTED_ONLINE" } });
    expect(cl).not.toBeNull();
    const diff = JSON.parse(cl!.diffJson) as Record<string, unknown>;
    expect(diff).not.toHaveProperty("ip");
    expect(diff).not.toHaveProperty("deciderIp");
    expect(JSON.stringify(diff)).not.toContain("203.0.113.1");

    expect(await chainValid()).toBe(true);

    // Benachrichtigung laeuft mit dem injizierten In-Memory-Provider (kein echter
    // SMTP-Connect im Test) — Status SENT statt FAILED.
    const notifyLog = await dbInternal.emailLog.findFirst({ where: { orgId, docType: "ANGEBOT", docId: quote.id }, orderBy: { createdAt: "desc" } });
    expect(notifyLog).not.toBeNull();
    expect(notifyLog!.status).toBe("SENT");
    expect(notifyLog!.toJson).toContain("org@example.org");
    expect(notifyLog!.bodySnapshot).toContain("Max Mustermann");
    expect(provider.sent.length).toBe(1);
  });

  it("zweite Entscheidung auf denselben Link -> AlreadyDecidedError", async () => {
    resetRateLimits();
    const quote = await makeQuote();
    const { token } = await createShareLink(orgId, quote.id, {}, { now: FIX_DATE });
    const decideNow = new Date(FIX_DATE.getTime() + 1000);
    await decideOffer(token, { decision: "ACCEPTED", name: "Erika", email: "erika@example.org" }, { now: decideNow });
    await expect(
      decideOffer(token, { decision: "ACCEPTED", name: "Erika", email: "erika@example.org" }, { now: new Date(decideNow.getTime() + 1000) }),
    ).rejects.toBeInstanceOf(AlreadyDecidedError);
  });

  it("Ablehnung -> Quote REJECTED", async () => {
    resetRateLimits();
    const quote = await makeQuote();
    const { token } = await createShareLink(orgId, quote.id, {}, { now: FIX_DATE });
    const decideNow = new Date(FIX_DATE.getTime() + 1000);
    const result = await decideOffer(token, { decision: "REJECTED", name: "Erika", email: "erika@example.org" }, { now: decideNow });
    expect(result.decision).toBe("REJECTED");

    const updatedQuote = await dbInternal.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(updatedQuote.status).toBe("REJECTED");
    const cl = await dbInternal.changeLog.findFirst({ where: { orgId, entity: "QUOTE", entityId: quote.id, action: "REJECTED_ONLINE" } });
    expect(cl).not.toBeNull();
  });

  it("ungueltiges/widerrufenes Token -> InvalidShareLinkError", async () => {
    resetRateLimits();
    await expect(decideOffer("does-not-exist", { decision: "ACCEPTED", name: "X", email: "x@example.org" }, { now: FIX_DATE })).rejects.toBeInstanceOf(
      InvalidShareLinkError,
    );
  });

  it("Rate-Limit: 11. Aufruf mit demselben Token wirft RateLimitError", async () => {
    resetRateLimits();
    const quote = await makeQuote();
    const { token } = await createShareLink(orgId, quote.id, {}, { now: FIX_DATE });
    const decideNow = new Date(FIX_DATE.getTime() + 1000);

    // 1. Aufruf entscheidet tatsaechlich (verbraucht Kontingent 1/10); Aufrufe 2-10
    // (Kontingent 2/10 .. 10/10) schlagen an der bereits getroffenen Entscheidung fehl,
    // nicht am Rate-Limit — erst der 11. Aufruf ueberschreitet das Kontingent.
    await decideOffer(token, { decision: "ACCEPTED", name: "X", email: "x@example.org" }, { ip: "198.51.100.7", now: decideNow });
    for (let i = 0; i < 9; i++) {
      await expect(
        decideOffer(token, { decision: "ACCEPTED", name: "X", email: "x@example.org" }, { ip: "198.51.100.7", now: decideNow }),
      ).rejects.toBeInstanceOf(AlreadyDecidedError);
    }
    await expect(
      decideOffer(token, { decision: "ACCEPTED", name: "X", email: "x@example.org" }, { ip: "198.51.100.7", now: decideNow }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it("Automatik ORDER_CONFIRMATION: Annahme erzeugt AB mit Relation", async () => {
    resetRateLimits();
    await saveDocumentSettings(orgId, { onQuoteAccept: "ORDER_CONFIRMATION", shareLinkDays: 30, storeAcceptIp: false });

    const quote = await makeQuote();
    const { token } = await createShareLink(orgId, quote.id, {}, { now: FIX_DATE });
    const decideNow = new Date(FIX_DATE.getTime() + 1000);
    const result = await decideOffer(token, { decision: "ACCEPTED", name: "Auto AB", email: "auto-ab@example.org" }, { now: decideNow });

    expect(result.automationError).toBeUndefined();
    expect(result.automation?.type).toBe("QUOTE");
    const ab = await dbInternal.quote.findUniqueOrThrow({ where: { id: result.automation!.id } });
    expect(ab.kind).toBe("AUFTRAGSBESTAETIGUNG");

    const relation = await dbInternal.documentRelation.findFirst({
      where: { orgId, fromType: "QUOTE", fromId: quote.id, toType: "QUOTE", toId: ab.id, relationType: "CONVERTED_TO" },
    });
    expect(relation).not.toBeNull();

    await saveDocumentSettings(orgId, { onQuoteAccept: "NONE", shareLinkDays: 30, storeAcceptIp: false });
  });

  it("Automatik INVOICE: Annahme erzeugt Rechnungsentwurf", async () => {
    resetRateLimits();
    await saveDocumentSettings(orgId, { onQuoteAccept: "INVOICE", shareLinkDays: 30, storeAcceptIp: false });

    const quote = await makeQuote();
    const { token } = await createShareLink(orgId, quote.id, {}, { now: FIX_DATE });
    const decideNow = new Date(FIX_DATE.getTime() + 1000);
    const result = await decideOffer(token, { decision: "ACCEPTED", name: "Auto Rechnung", email: "auto-inv@example.org" }, { now: decideNow });

    expect(result.automationError).toBeUndefined();
    expect(result.automation?.type).toBe("INVOICE");
    const invoice = await dbInternal.invoice.findUniqueOrThrow({ where: { id: result.automation!.id } });
    expect(invoice.status).toBe("DRAFT");

    await saveDocumentSettings(orgId, { onQuoteAccept: "NONE", shareLinkDays: 30, storeAcceptIp: false });
  });

  it("G4: P2002 auf ChangeLog (prevHash-Kollision) -> genau ein Retry, dann erfolgreich", async () => {
    resetRateLimits();
    const quote = await makeQuote();
    const { token } = await createShareLink(orgId, quote.id, {}, { now: FIX_DATE });
    const decideNow = new Date(FIX_DATE.getTime() + 1000);

    const spy = vi.spyOn(audit, "appendChangeLog");
    spy.mockImplementationOnce(async () => {
      throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`orgId`,`prevHash`)", {
        code: "P2002",
        clientVersion: "test",
      });
    });

    const result = await decideOffer(token, { decision: "ACCEPTED", name: "Retry Test", email: "retry@example.org" }, { now: decideNow });
    expect(result.decision).toBe("ACCEPTED");
    // Der erste appendChangeLog-Aufruf ueberhaupt (Statuswechsel-Eintrag aus
    // setQuoteStatusWithinTx, noch vor ACCEPTED_ONLINE) schlaegt mit P2002 fehl — das
    // rollt die gesamte Entscheidungs-Transaktion zurueck; decideOffer faengt genau
    // diesen Fall ab und wiederholt die Transaktion EIN weiteres Mal, was hier gelingt
    // (mind. ein weiterer appendChangeLog-Aufruf danach, plus die Versandprotokollierung
    // der internen Benachrichtigung).
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);

    const updatedQuote = await dbInternal.quote.findUniqueOrThrow({ where: { id: quote.id } });
    expect(updatedQuote.status).toBe("ACCEPTED");
    const cl = await dbInternal.changeLog.findMany({ where: { orgId, entity: "QUOTE", entityId: quote.id, action: "ACCEPTED_ONLINE" } });
    expect(cl.length).toBe(1);
    expect(await chainValid()).toBe(true);

    spy.mockRestore();
  });

  it("W2: exakter Formular-Rohinput (leere E-Mail/Kommentar als String) -> ACCEPTED, deciderEmail null", async () => {
    resetRateLimits();
    const quote = await makeQuote();
    const { token, link } = await createShareLink(orgId, quote.id, {}, { now: FIX_DATE });
    const decideNow = new Date(FIX_DATE.getTime() + 1000);

    // Exakt das Format, das DecisionForm/decideOfferAction aus einem FormData-Objekt
    // baut: leere Felder kommen als leerer String an, nicht als undefined.
    const result = await decideOffer(
      token,
      { decision: "ACCEPTED", name: "Max Muster", email: "", comment: "" },
      { now: decideNow },
    );
    expect(result.decision).toBe("ACCEPTED");

    const updatedLink = await dbInternal.quoteShareLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(updatedLink.deciderName).toBe("Max Muster");
    expect(updatedLink.deciderEmail).toBeNull();
  });

  it("W2: Formular-Rohinput mit tatsaechlicher E-Mail wird gespeichert", async () => {
    resetRateLimits();
    const quote = await makeQuote();
    const { token, link } = await createShareLink(orgId, quote.id, {}, { now: FIX_DATE });
    const decideNow = new Date(FIX_DATE.getTime() + 1000);

    const result = await decideOffer(
      token,
      { decision: "ACCEPTED", name: "Erika Musterfrau", email: "kunde@example.org", comment: "" },
      { now: decideNow },
    );
    expect(result.decision).toBe("ACCEPTED");

    const updatedLink = await dbInternal.quoteShareLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(updatedLink.deciderEmail).toBe("kunde@example.org");
  });

  it("IP wird nur mit storeAcceptIp=true gespeichert", async () => {
    resetRateLimits();
    await saveDocumentSettings(orgId, { onQuoteAccept: "NONE", shareLinkDays: 30, storeAcceptIp: true });

    const quote = await makeQuote();
    const { token, link } = await createShareLink(orgId, quote.id, {}, { now: FIX_DATE });
    const decideNow = new Date(FIX_DATE.getTime() + 1000);
    await decideOffer(token, { decision: "ACCEPTED", name: "Mit IP", email: "mit-ip@example.org" }, { ip: "192.0.2.55", now: decideNow });

    const updatedLink = await dbInternal.quoteShareLink.findUniqueOrThrow({ where: { id: link.id } });
    expect(updatedLink.deciderIp).toBe("192.0.2.55");

    // IP bleibt trotz storeAcceptIp=true NIE im ChangeLog.
    const cl = await dbInternal.changeLog.findFirst({ where: { orgId, entity: "QUOTE", entityId: quote.id, action: "ACCEPTED_ONLINE" }, orderBy: { id: "desc" } });
    expect(JSON.stringify(JSON.parse(cl!.diffJson))).not.toContain("192.0.2.55");

    await saveDocumentSettings(orgId, { onQuoteAccept: "NONE", shareLinkDays: 30, storeAcceptIp: false });
  });
});
