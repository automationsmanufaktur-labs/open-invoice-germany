/** Phase 12e, Task 5 — GET /api/v1/Report. Eigenes Jahr 2087 (Testjahr-Konvention). */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { dbInternal } from "@/lib/db";
import { createApiKey } from "@/domain/api-key/create";
import { resetRateLimits } from "@/lib/rate-limit";
import { GET } from "@/app/api/v1/Report/route";
import { runReport, reportQuerySchema } from "@/domain/reporting/query";

let orgId: string;
let token: string;

function req(url: string, withToken = true) {
  const headers = new Headers();
  if (withToken) headers.set("authorization", `Bearer ${token}`);
  return new Request(url, { headers });
}

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "Report-API GmbH", addressLine1: "R 1", postalCode: "10115", city: "Berlin", vatId: "DE877777777", taxNumber: "87/777/77777" },
  });
  orgId = org.id;
  token = (await createApiKey(orgId, { name: "Report-Leser", scopes: ["read"], expiresAt: null })).token;
});

beforeEach(() => resetRateLimits());

describe("reportQuerySchema", () => {
  it("verlangt einen bekannten Typ", () => {
    expect(reportQuerySchema.safeParse({}).success).toBe(false);
    expect(reportQuerySchema.safeParse({ type: "unsinn" }).success).toBe(false);
  });

  // Fix M8 (Fix 2, Koordinator-Ruling): months/limit tragen bewusst kein Schema-Default
  // mehr (siehe Modulkommentar in query.ts) — die tatsaechlichen Defaults (12/5) wendet
  // runReport erst NACH der Validierung an, nur wenn der Parameter beim gewaehlten type
  // ueberhaupt zaehlt.
  it("months/limit bleiben ohne explizite Angabe undefined (Default wird erst in runReport angewendet)", () => {
    const parsed = reportQuerySchema.parse({ type: "revenue" });
    expect(parsed.type).toBe("revenue");
    expect(parsed.months).toBeUndefined();
    expect(parsed.limit).toBeUndefined();
  });

  it("lehnt einen beim gewaehlten type nicht anwendbaren Parameter ab und nennt ihn in der Meldung", () => {
    const limitOnRevenue = reportQuerySchema.safeParse({ type: "revenue", limit: 5 });
    expect(limitOnRevenue.success).toBe(false);
    expect(limitOnRevenue.success === false && limitOnRevenue.error.issues[0].message).toContain("limit");

    const customerIdOnTopCustomers = reportQuerySchema.safeParse({ type: "top-customers", customerId: "c1" });
    expect(customerIdOnTopCustomers.success).toBe(false);
    expect(customerIdOnTopCustomers.success === false && customerIdOnTopCustomers.error.issues[0].message).toContain("customerId");

    const monthsOnStatus = reportQuerySchema.safeParse({ type: "status", months: 6 });
    expect(monthsOnStatus.success).toBe(false);
    expect(monthsOnStatus.success === false && monthsOnStatus.error.issues[0].message).toContain("months");

    const monthsOnPaymentBehaviour = reportQuerySchema.safeParse({ type: "payment-behaviour", months: 6 });
    expect(monthsOnPaymentBehaviour.success).toBe(false);
    expect(monthsOnPaymentBehaviour.success === false && monthsOnPaymentBehaviour.error.issues[0].message).toContain("months");
  });

  it("akzeptiert nur die je type anwendbaren Parameter", () => {
    expect(reportQuerySchema.safeParse({ type: "revenue", months: 6, customerId: "c1" }).success).toBe(true);
    expect(reportQuerySchema.safeParse({ type: "top-customers", months: 6, limit: 5 }).success).toBe(true);
    expect(reportQuerySchema.safeParse({ type: "status" }).success).toBe(true);
    expect(reportQuerySchema.safeParse({ type: "payment-behaviour", customerId: "c1" }).success).toBe(true);
  });
});

describe("GET /api/v1/Report", () => {
  it("revenue liefert 12 Monatspunkte", async () => {
    const res = await GET(req("http://x/api/v1/Report?type=revenue"));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.data.type).toBe("revenue");
    expect(j.data.rows).toHaveLength(12);
  });
  it("unbekannter Typ -> 400 VALIDATION", async () => {
    const res = await GET(req("http://x/api/v1/Report?type=unsinn"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION");
  });
  it("ohne Token -> 401", async () => {
    expect((await GET(req("http://x/api/v1/Report?type=status", false))).status).toBe(401);
  });
  it("runReport ist der gemeinsame Kern von REST und MCP", async () => {
    const direct = (await runReport(orgId, { type: "status" })) as { type: string };
    expect(direct.type).toBe("status");
  });

  // Fix M11 (Abschluss-Review): Boundary-Luecken — months=99/limit=0 -> 400, Schluessel ohne
  // read-Scope -> 403, top-customers respektiert limit, Org-Trennung.
  it("months=99 (> 36) -> 400 VALIDATION", async () => {
    const res = await GET(req("http://x/api/v1/Report?type=revenue&months=99"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION");
  });

  it("limit=0 (< 1) -> 400 VALIDATION", async () => {
    const res = await GET(req("http://x/api/v1/Report?type=top-customers&limit=0"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION");
  });

  it("Schluessel ohne read-Scope -> 403 FORBIDDEN", async () => {
    const writeOnly = (await createApiKey(orgId, { name: "Nur-Write", scopes: ["write"], expiresAt: null })).token;
    const forbidden = await GET(new Request("http://x/api/v1/Report?type=status", { headers: { authorization: `Bearer ${writeOnly}` } }));
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()).error.code).toBe("FORBIDDEN");
  });

  it("top-customers respektiert limit", async () => {
    const res = await GET(req("http://x/api/v1/Report?type=top-customers&limit=1"));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.data.rows.length).toBeLessThanOrEqual(1);
  });

  // Fix M8 (Fix 2, Koordinator-Ruling): ein beim gewaehlten type nicht anwendbarer
  // Parameter wird jetzt per 400 VALIDATION abgelehnt statt still ignoriert.
  it("limit bei type=revenue -> 400 VALIDATION (limit ist nur bei top-customers anwendbar)", async () => {
    const res = await GET(req("http://x/api/v1/Report?type=revenue&limit=5"));
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.error.code).toBe("VALIDATION");
    expect(JSON.stringify(j.error.details.issues)).toContain("limit");
  });

  it("months bei type=status -> 400 VALIDATION (status kennt kein Zeitfenster)", async () => {
    const res = await GET(req("http://x/api/v1/Report?type=status&months=6"));
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.error.code).toBe("VALIDATION");
    expect(JSON.stringify(j.error.details.issues)).toContain("months");
  });

  it("customerId bei type=top-customers -> 400 VALIDATION (top-customers gruppiert ueber alle Kunden)", async () => {
    const res = await GET(req("http://x/api/v1/Report?type=top-customers&customerId=irgendwas"));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION");
  });

  it("Org-Trennung: ein Schluessel von Org A liefert keine Zeilen von Org B", async () => {
    const otherOrg = await dbInternal.organization.create({
      data: { legalName: "Report-API Fremdorg GmbH", addressLine1: "F 1", postalCode: "10119", city: "Berlin", vatId: "DE888888888", taxNumber: "88/888/88888" },
    });
    // Beleg in der fremden Org, damit sie ueberhaupt Daten haette, wenn die Org-Trennung
    // NICHT griffe.
    const otherToken = (await createApiKey(otherOrg.id, { name: "Fremd-Leser", scopes: ["read"], expiresAt: null })).token;
    const res = await GET(new Request("http://x/api/v1/Report?type=status", { headers: { authorization: `Bearer ${otherToken}` } }));
    expect(res.status).toBe(200);
    const j = await res.json();
    // status-Zeilen der ORIGINALEN Org (orgId) duerfen hier nicht auftauchen — da otherOrg
    // keine eigenen Rechnungen hat, ist die einzig korrekte Antwort eine leere Zeilenliste.
    expect(j.data.rows).toEqual([]);
  });
});
