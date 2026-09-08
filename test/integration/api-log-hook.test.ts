/**
 * Phase 12d, Task 3 — der Log-Hook in withApi. Eigenes Jahr 2082 (Testjahr-Konvention),
 * kein Rechnungsbezug. `logApiRequest` laeuft als void-Promise: die Tests warten mit einer
 * kleinen Schleife auf die Zeile, statt eine feste Pause zu setzen.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { z } from "zod";
import { NextResponse } from "next/server";
import { dbInternal } from "@/lib/db";
import { createApiKey } from "@/domain/api-key/create";
import { resetRateLimits } from "@/lib/rate-limit";
import { withApi } from "@/api/auth";
import { apiData } from "@/api/response";
import { saveApiSettings } from "@/domain/api-log/settings";
import { GET as pingGet } from "@/app/api/v1/ping/route";

let orgId: string;

function req(url: string, opts: { method?: string; token?: string; body?: unknown } = {}) {
  const headers = new Headers();
  if (opts.token) headers.set("authorization", `Bearer ${opts.token}`);
  if (opts.body !== undefined) headers.set("content-type", "application/json");
  return new Request(url, { method: opts.method ?? "GET", headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
}

/** Wartet, bis mindestens `min` Zeilen fuer die Organisation vorliegen (void-Promise). */
async function waitForRows(min: number, tries = 50) {
  for (let i = 0; i < tries; i++) {
    const n = await dbInternal.apiRequestLog.count({ where: { orgId } });
    if (n >= min) return n;
    await new Promise((r) => setTimeout(r, 20));
  }
  return dbInternal.apiRequestLog.count({ where: { orgId } });
}

const echo = withApi(async (_req, ctx) => {
  const parsed = z.object({ note: z.string() }).safeParse(ctx.body);
  if (!parsed.success) throw parsed.error;
  return apiData({ note: parsed.data.note, requestId: ctx.requestId });
}, { scope: "write" });

/** Fix-Runde 1 (Important 1): Handler, der unerwartet (nicht als ZodError/Domain-
 *  Fehler) wirft — mapApiError faengt das im generischen Zweig als 500 INTERNAL ab. */
const boom = withApi(async () => {
  throw new Error("unerwartet kaputt");
}, { scope: "write" });

/** Abschluss-Review Fix-Welle (m12): Fehlerantwort OHNE JSON-Content-Type (Binaerroute,
 *  z. B. PDF/XRechnung-Export) — der Klon-Schutz in auth.ts darf hier weder werfen noch
 *  den Non-JSON-Body als responseBody speichern. */
const binaryError = withApi(async () => {
  return new NextResponse("%PDF-kaputt", { status: 500, headers: { "content-type": "application/pdf" } });
}, { scope: "write" });

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "Protokoll Test GmbH", addressLine1: "Logweg 1", postalCode: "10115", city: "Berlin", vatId: "DE822222222", taxNumber: "82/222/22222" },
  });
  orgId = org.id;
});

beforeEach(async () => {
  resetRateLimits();
  await dbInternal.apiRequestLog.deleteMany({ where: { orgId } });
});

describe("X-Request-Id", () => {
  it("steht auf Erfolg UND auf Fehler auf der Antwort", async () => {
    const key = await createApiKey(orgId, { name: `k${Math.random()}`, scopes: ["read"], expiresAt: null });
    const ok = await pingGet(req("http://x/api/v1/ping", { token: key.token }));
    expect(ok.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
    const bad = await pingGet(req("http://x/api/v1/ping"));
    expect(bad.status).toBe(401);
    expect(bad.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("Protokollierung", () => {
  it("logRequests=false -> keine Zeile", async () => {
    await saveApiSettings(orgId, { logRequests: false, logBodies: false });
    const key = await createApiKey(orgId, { name: `k${Math.random()}`, scopes: ["read"], expiresAt: null });
    await pingGet(req("http://x/api/v1/ping", { token: key.token }));
    await new Promise((r) => setTimeout(r, 100));
    expect(await dbInternal.apiRequestLog.count({ where: { orgId } })).toBe(0);
  });

  it("logRequests=true ohne logBodies -> Kopfdaten, keine Bodies; requestId == X-Request-Id", async () => {
    await saveApiSettings(orgId, { logRequests: true, logBodies: false });
    const key = await createApiKey(orgId, { name: `k${Math.random()}`, scopes: ["write"], expiresAt: null });
    const res = await echo(req("http://x/api/v1/Echo?a=1", { method: "POST", token: key.token, body: { note: "hallo" } }));
    expect(res.status).toBe(200);
    await waitForRows(1);
    const row = await dbInternal.apiRequestLog.findFirstOrThrow({ where: { orgId }, orderBy: { createdAt: "desc" } });
    expect(row.requestId).toBe(res.headers.get("X-Request-Id"));
    expect(row).toMatchObject({ method: "POST", path: "/api/v1/Echo", query: "a=1", status: 200, apiKeyId: key.id, requestBody: null, responseBody: null });
    expect(row.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("logBodies bei 200 -> Request-Body (geschwaerzt), KEIN Response-Body", async () => {
    await saveApiSettings(orgId, { logRequests: true, logBodies: true });
    const key = await createApiKey(orgId, { name: `k${Math.random()}`, scopes: ["write"], expiresAt: null });
    await echo(req("http://x/api/v1/Echo", { method: "POST", token: key.token, body: { note: "hallo", token: "geheim" } }));
    await waitForRows(1);
    const row = await dbInternal.apiRequestLog.findFirstOrThrow({ where: { orgId }, orderBy: { createdAt: "desc" } });
    expect(row.requestBody).toContain("hallo");
    expect(row.requestBody).toContain("[redaktiert]");
    expect(row.requestBody).not.toContain("geheim");
    expect(row.responseBody).toBeNull();
  });

  it("logBodies bei 400 -> beide Bodies, errorCode gesetzt", async () => {
    await saveApiSettings(orgId, { logRequests: true, logBodies: true });
    const key = await createApiKey(orgId, { name: `k${Math.random()}`, scopes: ["write"], expiresAt: null });
    expect((await echo(req("http://x/api/v1/Echo", { method: "POST", token: key.token, body: { falsch: 1 } }))).status).toBe(400);
    await waitForRows(1);
    const row = await dbInternal.apiRequestLog.findFirstOrThrow({ where: { orgId }, orderBy: { createdAt: "desc" } });
    expect(row).toMatchObject({ status: 400, errorCode: "VALIDATION" });
    expect(row.requestBody).toContain("falsch");
    expect(row.responseBody).toContain("VALIDATION");
  });

  it("errorCode wird auch OHNE logBodies ermittelt — nur der Body-TEXT ist an logBodies gebunden", async () => {
    await saveApiSettings(orgId, { logRequests: true, logBodies: false });
    const key = await createApiKey(orgId, { name: `k${Math.random()}`, scopes: ["write"], expiresAt: null });
    expect((await echo(req("http://x/api/v1/Echo", { method: "POST", token: key.token, body: { falsch: 1 } }))).status).toBe(400);
    await waitForRows(1);
    const row = await dbInternal.apiRequestLog.findFirstOrThrow({ where: { orgId }, orderBy: { createdAt: "desc" } });
    expect(row.errorCode).toBe("VALIDATION");
    expect(row.responseBody).toBeNull();
    expect(row.requestBody).toBeNull();
  });

  it("laedt die API-Einstellungen fuer den Log-Hook nur EINMAL je Anfrage (kein doppelter loadApiSettings-Aufruf)", async () => {
    await saveApiSettings(orgId, { logRequests: true, logBodies: true });
    const key = await createApiKey(orgId, { name: `k${Math.random()}`, scopes: ["write"], expiresAt: null });
    const settingsModule = await import("@/domain/api-log/settings");
    const spy = vi.spyOn(settingsModule, "loadApiSettings");
    spy.mockClear();
    // Fehlerantwort (400) durchlaeuft den teuersten Zweig (Fehler-Body lesen +
    // errorCode ermitteln UND die Zeile schreiben) — genau hier waere ein zweiter,
    // ueberfluessiger loadApiSettings-Aufruf am ehesten zu erwarten.
    expect((await echo(req("http://x/api/v1/Echo", { method: "POST", token: key.token, body: { falsch: 1 } }))).status).toBe(400);
    await waitForRows(1);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("schwaerzt verdaechtige Query-Parameter, laesst harmlose unveraendert (I1)", async () => {
    await saveApiSettings(orgId, { logRequests: true, logBodies: false });
    const key = await createApiKey(orgId, { name: `k${Math.random()}`, scopes: ["write"], expiresAt: null });
    await echo(req("http://x/api/v1/Echo?api_key=geheim&limit=5", { method: "POST", token: key.token, body: { note: "hallo" } }));
    await waitForRows(1);
    const row = await dbInternal.apiRequestLog.findFirstOrThrow({ where: { orgId }, orderBy: { createdAt: "desc" } });
    expect(row.query).toContain("limit=5");
    expect(row.query).not.toContain("geheim");
    expect(row.query).toContain(encodeURIComponent("[redaktiert]"));
  });

  it("Fehlerantwort OHNE JSON-Content-Type wird protokolliert, aber ohne responseBody/errorCode (m12)", async () => {
    await saveApiSettings(orgId, { logRequests: true, logBodies: true });
    const key = await createApiKey(orgId, { name: `k${Math.random()}`, scopes: ["write"], expiresAt: null });
    const res = await binaryError(req("http://x/api/v1/Binary", { method: "POST", token: key.token, body: { note: "x" } }));
    expect(res.status).toBe(500);
    await waitForRows(1);
    const row = await dbInternal.apiRequestLog.findFirstOrThrow({ where: { orgId }, orderBy: { createdAt: "desc" } });
    expect(row).toMatchObject({ status: 500, responseBody: null, errorCode: null });
  });

  it("Handler wirft unerwartet -> 500 traegt X-Request-Id, Zeile mit status 500", async () => {
    await saveApiSettings(orgId, { logRequests: true, logBodies: false });
    const key = await createApiKey(orgId, { name: `k${Math.random()}`, scopes: ["write"], expiresAt: null });
    const res = await boom(req("http://x/api/v1/Boom", { method: "POST", token: key.token, body: { note: "x" } }));
    expect(res.status).toBe(500);
    expect(res.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/);
    await waitForRows(1);
    const row = await dbInternal.apiRequestLog.findFirstOrThrow({ where: { orgId }, orderBy: { createdAt: "desc" } });
    expect(row).toMatchObject({ status: 500, requestId: res.headers.get("X-Request-Id") });
  });

  it("Vor-Auth-401 und /api/v1/ping erzeugen keine Zeile", async () => {
    await saveApiSettings(orgId, { logRequests: true, logBodies: true });
    const before = await dbInternal.apiRequestLog.count();
    await pingGet(req("http://x/api/v1/ping", { token: `oig_${"a".repeat(40)}` }));   // unbekanntes Token
    const key = await createApiKey(orgId, { name: `k${Math.random()}`, scopes: ["read"], expiresAt: null });
    await pingGet(req("http://x/api/v1/ping", { token: key.token }));                 // Rauschfilter
    await new Promise((r) => setTimeout(r, 100));
    expect(await dbInternal.apiRequestLog.count()).toBe(before);
  });

  it("ein Fehler beim Protokollieren veraendert die Antwort nicht", async () => {
    await saveApiSettings(orgId, { logRequests: true, logBodies: false });
    const key = await createApiKey(orgId, { name: `k${Math.random()}`, scopes: ["write"], expiresAt: null });
    // Schreibfehler erzwingen: Spalte `path` mit einem Wert, den die DB annimmt, ist nicht
    // provozierbar — stattdessen die Settings-Abfrage brechen lassen.
    const spy = vi.spyOn(await import("@/domain/api-log/settings"), "loadApiSettings").mockRejectedValue(new Error("DB weg"));
    const res = await echo(req("http://x/api/v1/Echo", { method: "POST", token: key.token, body: { note: "trotzdem" } }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.note).toBe("trotzdem");
    spy.mockRestore();
  });
});
