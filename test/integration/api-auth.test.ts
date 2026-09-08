/**
 * Phase 10, Task 1 — Integrationstests fuer den withApi-Wrapper (Auth/Scope/Rate-
 * Limit/Idempotenz/Fehlerformat). Eigenes Jahr 2073 (Testjahr-Konvention,
 * plan-header.md). Kein Bezug zu Invoice.number (keine Rechnungen in diesem File) —
 * die "eigener NumberRange-Praefix je Testdatei"-Regel betrifft nur Dateien, die
 * Rechnungen festschreiben.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { z } from "zod";

import { dbInternal } from "@/lib/db";
import { createApiKey } from "@/domain/api-key/create";
import { rateLimit, resetRateLimits } from "@/lib/rate-limit";
import { withApi } from "@/api/auth";
import { apiData } from "@/api/response";
import { GET as pingGet } from "@/app/api/v1/ping/route";

let orgId: string;

async function issueKey(opts: { scopes?: ("read" | "write" | "send" | "admin")[]; expiresAt?: Date | null } = {}) {
  return createApiKey(orgId, { name: `Test-Key ${Math.random().toString(36).slice(2)}`, scopes: opts.scopes ?? ["read"], expiresAt: opts.expiresAt ? opts.expiresAt.toISOString() : null });
}

function req(url: string, opts: { method?: string; token?: string; body?: unknown; idemKey?: string } = {}) {
  const headers = new Headers();
  if (opts.token) headers.set("authorization", `Bearer ${opts.token}`);
  if (opts.idemKey) headers.set("idempotency-key", opts.idemKey);
  if (opts.body !== undefined) headers.set("content-type", "application/json");
  return new Request(url, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "API-Auth Test GmbH", addressLine1: "Teststr. 1", postalCode: "10115", city: "Berlin", vatId: "DE111111111", taxNumber: "11/111/11111" },
  });
  orgId = org.id;
});

beforeEach(() => {
  resetRateLimits();
});

describe("withApi — Bearer-Auth", () => {
  it("gueltiger Schluessel mit passendem Scope -> 200 + X-RateLimit-Remaining", async () => {
    const key = await issueKey({ scopes: ["read"] });
    const res = await pingGet(req("http://x/api/v1/ping", { token: key.token }));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-RateLimit-Remaining")).not.toBeNull();
    const j = await res.json();
    expect(j.data.pong).toBe(true);
    expect(j.data.orgId).toBe(orgId);
  });

  it("fehlender Authorization-Header -> 401 UNAUTHORIZED", async () => {
    const res = await pingGet(req("http://x/api/v1/ping"));
    expect(res.status).toBe(401);
    const j = await res.json();
    expect(j.error.code).toBe("UNAUTHORIZED");
  });

  it("unbekanntes Token -> 401", async () => {
    const res = await pingGet(req("http://x/api/v1/ping", { token: "oig_" + "a".repeat(40) }));
    expect(res.status).toBe(401);
  });

  it("widerrufener Schluessel -> 401", async () => {
    const key = await issueKey({ scopes: ["read"] });
    await dbInternal.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
    const res = await pingGet(req("http://x/api/v1/ping", { token: key.token }));
    expect(res.status).toBe(401);
    const j = await res.json();
    expect(j.error.code).toBe("UNAUTHORIZED");
  });

  it("abgelaufener Schluessel -> 401", async () => {
    const key = await issueKey({ scopes: ["read"], expiresAt: new Date(Date.now() - 60_000) });
    const res = await pingGet(req("http://x/api/v1/ping", { token: key.token }));
    expect(res.status).toBe(401);
    const j = await res.json();
    expect(j.error.code).toBe("UNAUTHORIZED");
  });

  it("falscher Scope -> 403 FORBIDDEN", async () => {
    const key = await issueKey({ scopes: ["write"] }); // ping braucht "read"
    const res = await pingGet(req("http://x/api/v1/ping", { token: key.token }));
    expect(res.status).toBe(403);
    const j = await res.json();
    expect(j.error.code).toBe("FORBIDDEN");
  });

  it("aktualisiert lastUsedAt bei erfolgreicher Pruefung", async () => {
    const key = await issueKey({ scopes: ["read"] });
    const before = await dbInternal.apiKey.findUnique({ where: { id: key.id } });
    expect(before?.lastUsedAt).toBeNull();
    await pingGet(req("http://x/api/v1/ping", { token: key.token }));
    const after = await dbInternal.apiKey.findUnique({ where: { id: key.id } });
    expect(after?.lastUsedAt).not.toBeNull();
  });
});

describe("withApi — Rate-Limit", () => {
  it("429 RATE_LIMITED + Retry-After nach Erschoepfung des Kontingents", async () => {
    const key = await issueKey({ scopes: ["read"] });
    // Kontingent (600/min) direkt fuellen statt 600x die Route aufzurufen — schnellerer Test,
    // gleicher Bucket-Schluessel wie src/api/rate-limit.ts (`apikey:<id>`).
    for (let i = 0; i < 600; i++) rateLimit(`apikey:${key.id}`, { limit: 600, windowMs: 60_000 });

    const res = await pingGet(req("http://x/api/v1/ping", { token: key.token }));
    expect(res.status).toBe(429);
    const j = await res.json();
    expect(j.error.code).toBe("RATE_LIMITED");
    expect(res.headers.get("Retry-After")).not.toBeNull();
  });

  // Fix-Welle (Should-fix 4): OHNE gueltigen Bearer-Token wurde bisher ueberhaupt kein
  // Kontingent verbraucht (`checkApiRateLimit` lief erst NACH `verifyApiToken`, das aber
  // bei einem unbekannten Token bereits mit 401 wirft) — ein Angreifer konnte beliebig
  // viele DB-Lookups (`apiKey.findUnique`) ungebremst ausloesen. Der neue IP-gekeytete
  // Pre-Auth-Bucket (`preauth:<ip>`, 120/min) muss GREIFEN, BEVOR der Token ueberhaupt
  // geprueft wird — auch bei komplett fehlendem Authorization-Header.
  it("pre-auth Rate-Limit (IP-gekeytet) greift VOR der Token-Pruefung — auch ohne Token", async () => {
    const ip = "203.0.113.77";
    for (let i = 0; i < 120; i++) rateLimit(`preauth:${ip}`, { limit: 120, windowMs: 60_000 });

    const request = req("http://x/api/v1/ping");
    request.headers.set("cf-connecting-ip", ip);
    const res = await pingGet(request);
    expect(res.status).toBe(429);
    const j = await res.json();
    expect(j.error.code).toBe("RATE_LIMITED");
    expect(res.headers.get("Retry-After")).not.toBeNull();
  });
});

describe("withApi — Body-Limit (Should-fix 5)", () => {
  // Kleines Limit (statt der echten 2 MB) haelt den Test schnell — die Mechanik
  // (Content-Length-Vorabpruefung + tatsaechliche Laenge) ist identisch.
  const smallLimitPost = withApi<Record<string, never>>(async (_req, ctx) => {
    return apiData({ received: ctx.body });
  }, { scope: "write", maxBodyBytes: 32 });

  it("Body ueber dem Limit -> 413 PAYLOAD_TOO_LARGE", async () => {
    const key = await issueKey({ scopes: ["write"] });
    const oversized = { text: "x".repeat(100) };
    const res = await smallLimitPost(req("http://x/api/v1/echo", { method: "POST", token: key.token, body: oversized }));
    expect(res.status).toBe(413);
    const j = await res.json();
    expect(j.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("Body unter dem Limit -> normale Verarbeitung", async () => {
    const key = await issueKey({ scopes: ["write"] });
    const res = await smallLimitPost(req("http://x/api/v1/echo", { method: "POST", token: key.token, body: { a: 1 } }));
    expect(res.status).toBe(200);
  });
});

describe("withApi — Idempotenz (POST)", () => {
  // Eigene, minimale Demo-Route inline (kein Produktionscode) — testet den
  // withApi-POST-Pfad end-to-end, ohne dass Task 1 bereits eine echte Schreib-Ressource
  // ausliefert (die kommt erst mit Task 2+).
  const echoPost = withApi<Record<string, never>>(async (_req, ctx) => {
    const parsed = z.object({ amountCents: z.number().int() }).parse(ctx.body);
    return apiData({ echoedCents: parsed.amountCents, createdAt: new Date().toISOString() }, 201);
  }, { scope: "write" });

  it("gleicher Idempotency-Key + gleicher Body -> identische Antwort (kein zweiter Effekt)", async () => {
    const key = await issueKey({ scopes: ["write"] });
    const idemKey = `idem-${Math.random().toString(36).slice(2)}`;

    const res1 = await echoPost(req("http://x/api/v1/echo", { method: "POST", token: key.token, body: { amountCents: 1234 }, idemKey }));
    expect(res1.status).toBe(201);
    const j1 = await res1.json();

    const res2 = await echoPost(req("http://x/api/v1/echo", { method: "POST", token: key.token, body: { amountCents: 1234 }, idemKey }));
    expect(res2.status).toBe(201);
    const j2 = await res2.json();

    // Identische Antwort (inkl. createdAt aus dem GESPEICHERTEN ersten Aufruf, nicht neu berechnet).
    expect(j2).toEqual(j1);
  });

  it("gleicher Idempotency-Key + abweichender Body -> 409 IDEMPOTENCY_MISMATCH", async () => {
    const key = await issueKey({ scopes: ["write"] });
    const idemKey = `idem-${Math.random().toString(36).slice(2)}`;

    const res1 = await echoPost(req("http://x/api/v1/echo", { method: "POST", token: key.token, body: { amountCents: 1234 }, idemKey }));
    expect(res1.status).toBe(201);

    const res2 = await echoPost(req("http://x/api/v1/echo", { method: "POST", token: key.token, body: { amountCents: 9999 }, idemKey }));
    expect(res2.status).toBe(409);
    const j2 = await res2.json();
    expect(j2.error.code).toBe("IDEMPOTENCY_MISMATCH");
  });

  it("ohne Idempotency-Key laeuft jeder Aufruf normal durch (kein Replay)", async () => {
    const key = await issueKey({ scopes: ["write"] });
    const res1 = await echoPost(req("http://x/api/v1/echo", { method: "POST", token: key.token, body: { amountCents: 1 } }));
    const res2 = await echoPost(req("http://x/api/v1/echo", { method: "POST", token: key.token, body: { amountCents: 1 } }));
    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
  });

  // Fix-Runde 1 S1: Reserve-First gegen den urspruenglichen Wettlauf (zwei gleich-
  // zeitige, identische Requests konnten beide den Handler ausfuehren).
  it("zwei gleichzeitige identische POSTs (Promise.all) -> Handler laeuft genau EINMAL, der andere bekommt Replay oder IN_PROGRESS", async () => {
    const key = await issueKey({ scopes: ["write"] });
    const idemKey = `idem-race-${Math.random().toString(36).slice(2)}`;
    let executions = 0;
    const slowEcho = withApi<Record<string, never>>(async (_req, ctx) => {
      executions += 1;
      // Kuenstliche Verzoegerung, damit der zweite Request seine Pruefung sicher
      // trifft, WAEHREND der erste noch IN_PROGRESS ist (deterministischer Test).
      await new Promise((resolve) => setTimeout(resolve, 50));
      const parsed = z.object({ amountCents: z.number().int() }).parse(ctx.body);
      return apiData({ echoedCents: parsed.amountCents }, 201);
    }, { scope: "write" });

    const [res1, res2] = await Promise.all([
      slowEcho(req("http://x/api/v1/echo", { method: "POST", token: key.token, body: { amountCents: 42 }, idemKey })),
      slowEcho(req("http://x/api/v1/echo", { method: "POST", token: key.token, body: { amountCents: 42 }, idemKey })),
    ]);

    expect(executions).toBe(1); // genau EIN Handler-Lauf, egal welcher Request "gewinnt"
    const statuses = [res1.status, res2.status];
    // GENAU EINER der beiden liefert 201 (der Handler-Lauf, direkt oder als Replay
    // danach); der andere entweder ebenfalls 201 (Replay) oder 409 IN_PROGRESS.
    expect(statuses).toContain(201);
    for (const status of statuses) {
      expect([201, 409]).toContain(status);
    }
    const loser = statuses[0] === 409 ? res1 : statuses[1] === 409 ? res2 : null;
    if (loser) {
      const loserBody = await loser.json();
      expect(loserBody.error.code).toBe("IDEMPOTENCY_IN_PROGRESS");
    }
  });

  it("Handler wirft -> Reservierung wird entfernt, Retry mit demselben Key laeuft normal durch", async () => {
    const key = await issueKey({ scopes: ["write"] });
    const idemKey = `idem-fail-${Math.random().toString(36).slice(2)}`;
    let attempt = 0;
    const flaky = withApi<Record<string, never>>(async (_req, ctx) => {
      attempt += 1;
      if (attempt === 1) throw new Error("simulierter transienter Fehler");
      const parsed = z.object({ amountCents: z.number().int() }).parse(ctx.body);
      return apiData({ echoedCents: parsed.amountCents }, 201);
    }, { scope: "write" });

    const res1 = await flaky(req("http://x/api/v1/echo", { method: "POST", token: key.token, body: { amountCents: 7 }, idemKey }));
    expect(res1.status).toBe(500);

    const res2 = await flaky(req("http://x/api/v1/echo", { method: "POST", token: key.token, body: { amountCents: 7 }, idemKey }));
    expect(res2.status).toBe(201);
    expect(attempt).toBe(2); // zweiter Aufruf hat den Handler TATSAECHLICH erneut ausgefuehrt
  });

  it("Handler liefert 5xx (ohne zu werfen) -> Reservierung wird ebenfalls entfernt (kein repliziertes 5xx)", async () => {
    const key = await issueKey({ scopes: ["write"] });
    const idemKey = `idem-5xx-${Math.random().toString(36).slice(2)}`;
    let attempt = 0;
    const flaky5xx = withApi<Record<string, never>>(async () => {
      attempt += 1;
      if (attempt === 1) return NextResponse.json({ error: { code: "INTERNAL", message: "boom" } }, { status: 503 });
      return apiData({ ok: true }, 201);
    }, { scope: "write" });

    const res1 = await flaky5xx(req("http://x/api/v1/echo", { method: "POST", token: key.token, body: {}, idemKey }));
    expect(res1.status).toBe(503);

    const res2 = await flaky5xx(req("http://x/api/v1/echo", { method: "POST", token: key.token, body: {}, idemKey }));
    expect(res2.status).toBe(201);
    expect(attempt).toBe(2);
  });
});

describe("withApi — Fehlerformat", () => {
  it("ZodError im Handler -> 400 VALIDATION mit details.issues", async () => {
    const badHandler = withApi(async () => {
      z.object({ x: z.string() }).parse({});
      return NextResponse.json({ data: {} });
    }, { scope: "read" });
    const key = await issueKey({ scopes: ["read"] });
    const res = await badHandler(req("http://x/api/v1/bad", { token: key.token }));
    expect(res.status).toBe(400);
    const j = await res.json();
    expect(j.error.code).toBe("VALIDATION");
    expect(j.error.details.issues.length).toBeGreaterThan(0);
  });
});
