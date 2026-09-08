/** Phase 12d, Task 5 — lesende REST-Ressource. Eigenes Jahr 2084 (Testjahr-Konvention). */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { dbInternal } from "@/lib/db";
import { createApiKey } from "@/domain/api-key/create";
import { resetRateLimits } from "@/lib/rate-limit";
import { saveApiSettings } from "@/domain/api-log/settings";
import { GET as listGet } from "@/app/api/v1/ApiRequestLog/route";
import { GET as oneGet } from "@/app/api/v1/ApiRequestLog/[id]/route";

let orgId: string;
let token: string;
let rowId: string;
let okRowId: string;
let otherOrgId: string;
let otherToken: string;
let otherRowId: string;

function req(url: string, withToken = true, useToken = token) {
  const headers = new Headers();
  if (withToken) headers.set("authorization", `Bearer ${useToken}`);
  return new Request(url, { headers });
}

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "Protokoll-API GmbH", addressLine1: "Apiweg 1", postalCode: "10115", city: "Berlin", vatId: "DE844444444", taxNumber: "84/444/44444" },
  });
  orgId = org.id;
  token = (await createApiKey(orgId, { name: "Leser", scopes: ["read"], expiresAt: null })).token;
  await saveApiSettings(orgId, { logRequests: true, logBodies: false, retentionDays: 7, maxRows: 2000 });
  const row = await dbInternal.apiRequestLog.create({
    data: { orgId, apiKeyId: null, requestId: "req-2084-1", method: "GET", path: "/api/v1/Invoice", status: 500, durationMs: 12 },
  });
  rowId = row.id;
  const okRow = await dbInternal.apiRequestLog.create({
    data: { orgId, apiKeyId: null, requestId: "req-2084-2", method: "GET", path: "/api/v1/Invoice", status: 200, durationMs: 8 },
  });
  okRowId = okRow.id;

  // Fremd-Organisation fuer den Mandantentrennungs-Test (m12).
  const otherOrg = await dbInternal.organization.create({
    data: { legalName: "Protokoll-API Fremd GmbH", addressLine1: "Fremdweg 1", postalCode: "10115", city: "Berlin", vatId: "DE855555555", taxNumber: "85/555/55555" },
  });
  otherOrgId = otherOrg.id;
  otherToken = (await createApiKey(otherOrgId, { name: "Leser Fremd", scopes: ["read"], expiresAt: null })).token;
  await saveApiSettings(otherOrgId, { logRequests: true, logBodies: false, retentionDays: 7, maxRows: 2000 });
  const otherRow = await dbInternal.apiRequestLog.create({
    data: { orgId: otherOrgId, apiKeyId: null, requestId: "req-2084-other-1", method: "GET", path: "/api/v1/Invoice", status: 500, durationMs: 9 },
  });
  otherRowId = otherRow.id;
});

beforeEach(() => resetRateLimits());

describe("GET /api/v1/ApiRequestLog", () => {
  it("liefert die Zeilen der eigenen Organisation im Listen-Umschlag und filtert auf Fehler", async () => {
    const res = await listGet(req("http://x/api/v1/ApiRequestLog?limit=10"));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.total).toBeGreaterThanOrEqual(1);
    expect(j.data[0].objectName).toBe("ApiRequestLog");
    expect(j.limit).toBe(10);
    const err = await (await listGet(req("http://x/api/v1/ApiRequestLog?errorsOnly=true"))).json();
    expect(err.data.every((r: { status: number }) => r.status >= 400)).toBe(true);
  });

  it("errorsOnly=false liefert auch NICHT-Fehler-Zeilen (Fix-Welle I3 — vorher faelschlich nur Fehler)", async () => {
    const j = await (await listGet(req("http://x/api/v1/ApiRequestLog?errorsOnly=false"))).json();
    expect(j.data.some((r: { status: number }) => r.status < 400)).toBe(true);
    const ids: string[] = j.data.map((r: { id: string }) => r.id);
    expect(ids).toContain(okRowId);
  });

  it("erzeugt selbst KEINE Protokollzeile (Rekursionsschutz)", async () => {
    const before = await dbInternal.apiRequestLog.count({ where: { orgId } });
    await listGet(req("http://x/api/v1/ApiRequestLog"));
    await new Promise((r) => setTimeout(r, 100));
    expect(await dbInternal.apiRequestLog.count({ where: { orgId } })).toBe(before);
  });

  it("ohne Token -> 401", async () => {
    expect((await listGet(req("http://x/api/v1/ApiRequestLog", false))).status).toBe(401);
  });

  it("listet NIE Zeilen einer fremden Organisation (m12)", async () => {
    const j = await (await listGet(req("http://x/api/v1/ApiRequestLog?limit=200"))).json();
    const ids: string[] = j.data.map((r: { id: string }) => r.id);
    expect(ids).not.toContain(otherRowId);
    const foreign = await (await listGet(req("http://x/api/v1/ApiRequestLog?limit=200", true, otherToken))).json();
    expect(foreign.data.map((r: { id: string }) => r.id)).not.toContain(rowId);
  });
});

describe("GET /api/v1/ApiRequestLog/[id]", () => {
  it("liefert eine Zeile, unbekannte Id -> 404", async () => {
    const ok = await oneGet(req(`http://x/api/v1/ApiRequestLog/${rowId}`), { params: Promise.resolve({ id: rowId }) });
    expect(ok.status).toBe(200);
    expect((await ok.json()).data.requestId).toBe("req-2084-1");
    expect((await oneGet(req("http://x/api/v1/ApiRequestLog/gibtsnicht"), { params: Promise.resolve({ id: "gibtsnicht" }) })).status).toBe(404);
  });

  it("eine Zeile einer FREMDEN Organisation ist unerreichbar -> 404, kein Datenleck (m12)", async () => {
    const res = await oneGet(req(`http://x/api/v1/ApiRequestLog/${otherRowId}`), { params: Promise.resolve({ id: otherRowId }) });
    expect(res.status).toBe(404);
    const reverse = await oneGet(req(`http://x/api/v1/ApiRequestLog/${rowId}`, true, otherToken), { params: Promise.resolve({ id: rowId }) });
    expect(reverse.status).toBe(404);
  });
});
