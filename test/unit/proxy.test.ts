/**
 * W2/G1 (Phase 3b, Fix-Runde): Verhalten des `proxy` selbst (nicht nur die Praefix-Liste
 * wie in test/unit/proxy-public.test.ts). `verifySessionToken` wird gemockt, damit die
 * Tests ohne echte Session-Tokens/DB laufen.
 */
import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/session", () => ({
  SESSION_COOKIE: "oig_session",
  verifySessionToken: vi.fn(async (token: string | undefined | null) => (token === "valid-token" ? "user-1" : null)),
}));

import { proxy, PUBLIC_NO_NAV_HEADER } from "@/proxy";

describe("proxy", () => {
  it("geschuetzter Pfad ohne Cookie -> Redirect auf /login", async () => {
    const req = new NextRequest("http://localhost/rechnungen");
    const res = await proxy(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("geschuetzte /api/-Route ohne Cookie -> 401", async () => {
    const req = new NextRequest("http://localhost/api/x");
    const res = await proxy(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Nicht angemeldet");
  });

  it("/angebot/abc -> next(), Request-Header x-oig-public wird auf 1 gesetzt", async () => {
    const req = new NextRequest("http://localhost/angebot/abc");
    const res = await proxy(req);
    expect(res.headers.get("x-middleware-request-" + PUBLIC_NO_NAV_HEADER)).toBe("1");
  });

  // Fix-Welle (Nit): "/" rendert fuer angemeldete Nutzer das Dashboard (Umsatz,
  // Kundennamen) — cache-control muss explizit gesetzt sein, nicht nur implizit ueber
  // Next.js' `force-dynamic` (Cloudflare sitzt vor der Produktivinstanz).
  it("/ setzt cache-control: private, no-store explizit", async () => {
    const req = new NextRequest("http://localhost/");
    const res = await proxy(req);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("G1: /rechnungen mit vom Client gesetztem x-oig-public: 1 -> Header wird entfernt (kein Bypass)", async () => {
    const req = new NextRequest("http://localhost/rechnungen", {
      headers: { cookie: "oig_session=valid-token", [PUBLIC_NO_NAV_HEADER]: "1" },
    });
    const res = await proxy(req);
    // Fuer einen angemeldeten Zugriff auf einen geschuetzten Pfad wird next() mit
    // ueberschriebenen Request-Headern zurueckgegeben — der Client-Header darf NICHT
    // durchgereicht werden.
    expect(res.headers.get("x-middleware-request-" + PUBLIC_NO_NAV_HEADER)).toBeNull();
  });
});
