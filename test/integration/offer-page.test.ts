/**
 * W4 (Phase 3b, Fix-Runde): Rate-Limit je Client-IP fuer die oeffentlichen Leserouten
 * der Angebotsannahme. Die Seite selbst ist eine React-Server-Component (kein direkter
 * Test ohne Renderer) — die PDF-Route ist ein regulaerer Route-Handler und deckt
 * denselben Rate-Limit-Schluessel (`public:ip:<ip>`) ab.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { dbInternal } from "@/lib/db";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { createBusinessDocument } from "@/domain/document/create";
import { createShareLink } from "@/domain/quote-share/link";
import { resetRateLimits } from "@/lib/rate-limit";
import { GET as pdfGet } from "@/app/api/public/angebot/[token]/pdf/route";

const FIX_DATE = new Date("2032-05-01T10:00:00.000Z");
const line = { description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19 as const, taxCategory: "S" as const, discountPermille: 0 };

let orgId: string;
let customerId: string;

beforeAll(async () => {
  process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "test-auth-secret-mindestens-16-zeichen";

  const org = await dbInternal.organization.create({
    data: { legalName: "Angebotsseite GmbH", addressLine1: "Weg 4", postalCode: "10115", city: "Berlin", email: "org@example.org" },
  });
  orgId = org.id;

  const customer = await dbInternal.customer.create({
    data: { orgId, name: "Kunde Seite AG", addressLine1: "Platz 2", postalCode: "20095", city: "Hamburg", type: "BUSINESS", email: "kunde-seite@example.org" },
  });
  customerId = customer.id;

  await ensureOrgMasterdata(dbInternal, orgId);
});

function pdfRequest(token: string, ip: string): Request {
  return new Request(`http://localhost/api/public/angebot/${token}/pdf`, { headers: { "x-forwarded-for": ip } });
}

describe("GET /api/public/angebot/[token]/pdf: Rate-Limit je IP (W4)", () => {
  it("61. Aufruf derselben IP innerhalb einer Minute -> 429 mit Retry-After", async () => {
    resetRateLimits();
    // Drei verschiedene Links/Tokens im Wechsel: das bestehende Token-Rate-Limit
    // (30/Minute je Token-Hash) darf hier NICHT zuerst greifen — es soll ausschliesslich
    // das neue IP-Rate-Limit (60/Minute) getestet werden.
    const tokens: string[] = [];
    for (let t = 0; t < 3; t++) {
      const quote = await createBusinessDocument(orgId, { kind: "ANGEBOT", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [line] }, { now: FIX_DATE });
      const { token } = await createShareLink(orgId, quote.id, {}, { now: FIX_DATE });
      tokens.push(token);
    }
    const ip = "203.0.113.42";
    const ctxFor = (token: string) => ({ params: Promise.resolve({ token }) });

    for (let i = 0; i < 60; i++) {
      const token = tokens[i % tokens.length]!;
      const res = await pdfGet(pdfRequest(token, ip), ctxFor(token));
      expect(res.status).toBe(200);
    }

    const lastToken = tokens[0]!;
    const res61 = await pdfGet(pdfRequest(lastToken, ip), ctxFor(lastToken));
    expect(res61.status).toBe(429);
    expect(res61.headers.get("Retry-After")).toBeTruthy();
  });

  it("cache-control: private, no-store auf jeder Antwort (G3)", async () => {
    resetRateLimits();
    const quote = await createBusinessDocument(orgId, { kind: "ANGEBOT", customerId, taxScheme: "REGULAR", currency: "EUR", lines: [line] }, { now: FIX_DATE });
    const { token } = await createShareLink(orgId, quote.id, {}, { now: FIX_DATE });
    const ctx = { params: Promise.resolve({ token }) };

    const res = await pdfGet(pdfRequest(token, "198.51.100.99"), ctx);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});
