/**
 * Task 3 (Phase 3b) + Adjudikation Task-1-Fix-Runde: {{offer.link}}-Platzhalter in
 * buildTemplateContext/prefillEmail. APP_BASE_URL wird testweise gesetzt/zurueckgesetzt
 * — ohne Env bleibt der Platzhalter leer (Ruling). Seit der Fix-Runde wird beim
 * Vorbelegen NIE mehr automatisch ein Link erzeugt (das war W3): existiert ein
 * gueltiger Link, wird dessen Token entschluesselt (`revealShareLinkToken`) und
 * verlinkt; existiert keiner, wird die komplette Platzhalter-Zeile aus dem Body
 * entfernt, ohne einen neuen Link zu minten.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { dbInternal } from "@/lib/db";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { createBusinessDocument } from "@/domain/document/create";
import { setQuoteStatus } from "@/domain/document/status";
import { saveMailSettings } from "@/domain/email/settings";
import { prefillEmail } from "@/domain/email/compose";
import { createShareLink } from "@/domain/quote-share/link";

const FIX_DATE = new Date("2032-04-01T10:00:00.000Z");
const line = { description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19 as const, taxCategory: "S" as const, discountPermille: 0 };

let orgId: string;
let customerId: string;
const originalBaseUrl = process.env.APP_BASE_URL;

async function makeQuote() {
  return createBusinessDocument(orgId, { kind: "ANGEBOT", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [line] }, { now: FIX_DATE });
}

beforeAll(async () => {
  process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "test-auth-secret-mindestens-16-zeichen";

  const org = await dbInternal.organization.create({
    data: {
      legalName: "Linkplatzhalter GmbH",
      addressLine1: "Weg 3",
      postalCode: "10115",
      city: "Berlin",
      email: "org@example.org",
    },
  });
  orgId = org.id;

  const customer = await dbInternal.customer.create({
    data: { orgId, name: "Kunde Link AG", addressLine1: "Platz 1", postalCode: "20095", city: "Hamburg", type: "BUSINESS", email: "kunde-link@example.org" },
  });
  customerId = customer.id;

  await ensureOrgMasterdata(dbInternal, orgId);
  await saveMailSettings(orgId, {
    host: "localhost", port: 2525, security: "NONE",
    fromName: "Linkplatzhalter GmbH", fromEmail: "rechnung@example.org",
    defaultBcc: "", defaultCc: "", copyToSelf: false,
  });
});

afterAll(() => {
  if (originalBaseUrl === undefined) delete process.env.APP_BASE_URL;
  else process.env.APP_BASE_URL = originalBaseUrl;
});

describe("{{offer.link}} in prefillEmail (ANGEBOT)", () => {
  it("ohne APP_BASE_URL bleibt der Platzhalter leer", async () => {
    delete process.env.APP_BASE_URL;
    const q = await makeQuote();
    const pre = await prefillEmail(orgId, { docType: "ANGEBOT", docId: q.id });
    expect(pre.body).not.toContain("/angebot/");
  });

  it("mit APP_BASE_URL, aber OHNE gueltigen Link: kein neuer Link wird erzeugt, die Platzhalter-Zeile wird komplett entfernt", async () => {
    process.env.APP_BASE_URL = "https://instanz.example.org/";
    const q = await makeQuote();
    const pre = await prefillEmail(orgId, { docType: "ANGEBOT", docId: q.id });
    expect(pre.body).not.toContain("/angebot/");
    expect(pre.body).not.toContain("Sie können das Angebot auch online ansehen und annehmen");

    const links = await dbInternal.quoteShareLink.findMany({ where: { orgId, quoteId: q.id } });
    expect(links.length).toBe(0);
  });

  it("existiert bereits ein gueltiger Link, wird dessen Token entschluesselt und verlinkt (kein zweiter Link entsteht)", async () => {
    process.env.APP_BASE_URL = "https://instanz.example.org";
    const q = await makeQuote();
    const { token } = await createShareLink(orgId, q.id, {}, { now: FIX_DATE });

    const pre = await prefillEmail(orgId, { docType: "ANGEBOT", docId: q.id });
    expect(pre.body).toContain(`https://instanz.example.org/angebot/${token}`);

    const links = await dbInternal.quoteShareLink.findMany({ where: { orgId, quoteId: q.id } });
    expect(links.length).toBe(1);
  });

  it("Angebot in einem fuer Links unzulaessigen Status -> kein Fehler, Platzhalter bleibt leer", async () => {
    process.env.APP_BASE_URL = "https://instanz.example.org";
    const q = await makeQuote();
    await setQuoteStatus(orgId, q.id, "REJECTED", { actor: "system" });

    const pre = await prefillEmail(orgId, { docType: "ANGEBOT", docId: q.id });
    expect(pre.body).not.toContain("/angebot/");
  });

  it("andere Dokumenttypen (AUFTRAGSBESTAETIGUNG) erzeugen nie einen Angebotslink", async () => {
    process.env.APP_BASE_URL = "https://instanz.example.org";
    const ab = await createBusinessDocument(orgId, { kind: "AUFTRAGSBESTAETIGUNG", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [line] }, { now: FIX_DATE });
    await prefillEmail(orgId, { docType: "AUFTRAGSBESTAETIGUNG", docId: ab.id });
    const links = await dbInternal.quoteShareLink.findMany({ where: { orgId, quoteId: ab.id } });
    expect(links.length).toBe(0);
  });
});
