/**
 * Phase 10, Task 1 — Domain- und Session-Routen-Tests fuer API-Schluessel
 * (Erzeugen/Widerrufen/Auflisten, ausserhalb des withApi-Wrappers — siehe
 * test/integration/api-auth.test.ts fuer den Bearer-Auth-Pfad). Eigenes Jahr 2073
 * (Testjahr-Konvention) — kein Rechnungsbezug in diesem File.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";

const orgStore: { id: string | null } = vi.hoisted(() => ({ id: null }));

vi.mock("@/lib/org", () => ({
  getActiveOrg: async () => {
    if (!orgStore.id) throw new Error("Test-Org noch nicht gesetzt.");
    return { id: orgStore.id };
  },
}));
vi.mock("@/lib/auth/server", () => ({
  getCurrentUserId: async () => "tester",
}));

import { dbInternal } from "@/lib/db";
import { createApiKey, slugifyKeyName, hashApiToken } from "@/domain/api-key/create";
import { revokeApiKey } from "@/domain/api-key/revoke";
import { verifyApiToken } from "@/domain/api-key/verify";
import { listApiKeys } from "@/domain/api-key/list";
import { NotFoundError } from "@/domain/errors";
import { GET as keysGet, POST as keysPost } from "@/app/api/api-keys/route";
import { DELETE as keyDelete } from "@/app/api/api-keys/[id]/route";

let orgId: string;

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "API-Keys Domain Test GmbH", addressLine1: "Teststr. 2", postalCode: "10117", city: "Berlin", vatId: "DE222222222", taxNumber: "22/222/22222" },
  });
  orgId = org.id;
  orgStore.id = orgId;
});

describe("createApiKey", () => {
  it("erzeugt ein Token mit oig_-Praefix, speichert nur den Hash, Praefix = erste 8 Zeichen nach oig_", async () => {
    const key = await createApiKey(orgId, { name: "Buchhaltung", scopes: ["read", "write"] });
    expect(key.token.startsWith("oig_")).toBe(true);
    expect(key.prefix).toBe(key.token.slice(4, 12));

    const row = await dbInternal.apiKey.findUnique({ where: { id: key.id } });
    expect(row?.keyHash).toBe(hashApiToken(key.token));
    expect(row?.keyHash).not.toBe(key.token);
    expect(row?.scopesJson).toBe("read,write");
  });

  it("lehnt leere Scopes ab (Zod)", async () => {
    await expect(createApiKey(orgId, { name: "Leer", scopes: [] })).rejects.toThrow();
  });

  it("speichert expiresAt, wenn angegeben", async () => {
    const iso = new Date(Date.now() + 86_400_000).toISOString();
    const key = await createApiKey(orgId, { name: "Befristet", scopes: ["read"], expiresAt: iso });
    expect(key.expiresAt?.toISOString()).toBe(iso);
  });
});

describe("slugifyKeyName", () => {
  it("transliteriert Umlaute/Sonderzeichen zu einem lesbaren Slug", () => {
    expect(slugifyKeyName("Buchhaltung Süd & Co.")).toBe("buchhaltung-sud-co");
  });

  it("faellt auf 'key' zurueck, wenn nichts Transliterierbares uebrig bleibt", () => {
    expect(slugifyKeyName("!!!")).toBe("key");
  });
});

describe("revokeApiKey", () => {
  it("setzt revokedAt und ist beim zweiten Aufruf idempotent (kein Fehler)", async () => {
    const key = await createApiKey(orgId, { name: "Zu widerrufen", scopes: ["read"] });
    await revokeApiKey(orgId, key.id);
    const row1 = await dbInternal.apiKey.findUnique({ where: { id: key.id } });
    expect(row1?.revokedAt).not.toBeNull();

    await revokeApiKey(orgId, key.id); // zweiter Aufruf: kein Fehler
    const row2 = await dbInternal.apiKey.findUnique({ where: { id: key.id } });
    expect(row2?.revokedAt?.getTime()).toBe(row1?.revokedAt?.getTime());
  });

  it("wirft NotFoundError fuer unbekannte ID oder falsche Org", async () => {
    await expect(revokeApiKey(orgId, "unbekannt")).rejects.toThrow(NotFoundError);
    const otherOrg = await dbInternal.organization.create({
      data: { legalName: "Andere Org GmbH", addressLine1: "X 1", postalCode: "10119", city: "Berlin" },
    });
    const key = await createApiKey(otherOrg.id, { name: "Fremd", scopes: ["read"] });
    await expect(revokeApiKey(orgId, key.id)).rejects.toThrow(NotFoundError);
  });
});

// Fix-Welle (Should-fix 6): Anlage/Widerruf eines API-Schluessels schrieb bisher KEINEN
// Audit-Eintrag (weder ChangeLog noch ActivityLog) — Minten/Widerrufen eines Credentials,
// das lesend UND schreibend auf alle GoBD-Daten zugreifen kann, war damit spurlos.
describe("ActivityLog fuer API-Schluessel (Should-fix 6)", () => {
  it("createApiKey schreibt einen ActivityLog-Eintrag (CREATED, ohne Token/Hash)", async () => {
    const key = await createApiKey(orgId, { name: "Protokolliert-Create", scopes: ["read", "write"] }, "tester");
    const entries = await dbInternal.activityLog.findMany({ where: { orgId, entityType: "API_KEY", entityId: key.id } });
    expect(entries.length).toBe(1);
    expect(entries[0].type).toBe("CREATED");
    expect(entries[0].actor).toBe("tester");
    const data = JSON.parse(entries[0].dataJson!);
    expect(data.name).toBe("Protokolliert-Create");
    expect(data.prefix).toBe(key.prefix);
    expect(data.scopes).toEqual(["read", "write"]);
    expect(JSON.stringify(data)).not.toMatch(/oig_/);
    expect(data.token).toBeUndefined();
    expect(data.hash).toBeUndefined();
  });

  it("revokeApiKey schreibt einen ActivityLog-Eintrag (REVOKED, ohne Token/Hash)", async () => {
    const key = await createApiKey(orgId, { name: "Protokolliert-Revoke", scopes: ["admin"] });
    await revokeApiKey(orgId, key.id, "tester");
    const entries = await dbInternal.activityLog.findMany({ where: { orgId, entityType: "API_KEY", entityId: key.id, type: "REVOKED" } });
    expect(entries.length).toBe(1);
    expect(entries[0].actor).toBe("tester");
    const data = JSON.parse(entries[0].dataJson!);
    expect(data.name).toBe("Protokolliert-Revoke");
    expect(data.scopes).toEqual(["admin"]);
    expect(JSON.stringify(data)).not.toMatch(/oig_/);
  });
});

describe("listApiKeys", () => {
  it("liefert nie das Klartext-Token, nur Metadaten", async () => {
    await createApiKey(orgId, { name: "Sichtbarkeitstest", scopes: ["send"] });
    const { rows: keys, total } = await listApiKeys(orgId, { limit: 1000, offset: 0 });
    expect(keys.length).toBeGreaterThan(0);
    expect(total).toBeGreaterThanOrEqual(keys.length);
    for (const k of keys) {
      expect(k).not.toHaveProperty("token");
      expect(k).not.toHaveProperty("keyHash");
    }
  });

  // Fix-Welle (Nit 14): DB-seitige Pagination (take/skip) statt alles zu laden und
  // in-memory zu slicen.
  it("paginiert per limit/offset auf DB-Ebene", async () => {
    const before = await listApiKeys(orgId, { limit: 1000, offset: 0 });
    for (let i = 0; i < 3; i++) await createApiKey(orgId, { name: `Pagination-${i}`, scopes: ["read"] });
    const page1 = await listApiKeys(orgId, { limit: 1, offset: 0 });
    expect(page1.rows.length).toBe(1);
    expect(page1.total).toBe(before.total + 3);
    const page2 = await listApiKeys(orgId, { limit: 1, offset: 1 });
    expect(page2.rows.length).toBe(1);
    expect(page2.rows[0].id).not.toBe(page1.rows[0].id);
  });
});

describe("verifyApiToken — lastUsedAt-Drosselung (Fix-Runde 1 S2)", () => {
  // Bewusst KEINE vi.useFakeTimers() — faelscht globale Timer, die Prisma/die SQLite-
  // Engine fuer echte Async-I/O nutzen (Risiko haengender Queries). Stattdessen wird
  // die Ausgangslage direkt in der DB praepariert (lastUsedAt in der Vergangenheit).

  it("schreibt lastUsedAt beim ERSTEN Aufruf (vorher NULL)", async () => {
    const key = await createApiKey(orgId, { name: "Drossel-Test Erstaufruf", scopes: ["read"] });
    const before = await dbInternal.apiKey.findUnique({ where: { id: key.id } });
    expect(before?.lastUsedAt).toBeNull();

    await verifyApiToken(key.token);
    const after = await dbInternal.apiKey.findUnique({ where: { id: key.id } });
    expect(after?.lastUsedAt).not.toBeNull();
  });

  it("schreibt lastUsedAt NICHT erneut, wenn der letzte Wert < 60s alt ist", async () => {
    const key = await createApiKey(orgId, { name: "Drossel-Test Innerhalb", scopes: ["read"] });
    const recent = new Date(Date.now() - 5_000); // 5s "alt" — deutlich innerhalb des 60s-Fensters
    await dbInternal.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: recent } });

    await verifyApiToken(key.token);
    const after = await dbInternal.apiKey.findUnique({ where: { id: key.id } });
    expect(after?.lastUsedAt?.getTime()).toBe(recent.getTime()); // unveraendert -> kein Write
  });

  it("schreibt lastUsedAt NEU, wenn der letzte Wert > 60s alt ist", async () => {
    const key = await createApiKey(orgId, { name: "Drossel-Test Ausserhalb", scopes: ["read"] });
    const stale = new Date(Date.now() - 61_000); // 61s "alt" — ausserhalb des 60s-Fensters
    await dbInternal.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: stale } });

    await verifyApiToken(key.token);
    const after = await dbInternal.apiKey.findUnique({ where: { id: key.id } });
    expect(after?.lastUsedAt?.getTime()).toBeGreaterThan(stale.getTime()); // wurde aktualisiert
  });
});

describe("Session-Routen /api/api-keys", () => {
  it("POST legt an (mit Token in der Antwort), GET listet ohne Token, DELETE widerruft", async () => {
    const postRes = await keysPost(new Request("http://x/api/api-keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Session-Route", scopes: ["read"] }) }));
    expect(postRes.status).toBe(201);
    const created = (await postRes.json()) as { key: { id: string; token: string } };
    expect(created.key.token).toMatch(/^oig_/);

    const listRes = await keysGet();
    const listed = (await listRes.json()) as { keys: { id: string }[] };
    expect(listed.keys.some((k) => k.id === created.key.id)).toBe(true);
    expect(JSON.stringify(listed.keys)).not.toContain("token");

    const delRes = await keyDelete(new Request("http://x", { method: "DELETE" }), { params: Promise.resolve({ id: created.key.id }) });
    expect(delRes.status).toBe(200);
    const row = await dbInternal.apiKey.findUnique({ where: { id: created.key.id } });
    expect(row?.revokedAt).not.toBeNull();
  });

  it("POST mit ungueltigem Body -> 400", async () => {
    const res = await keysPost(new Request("http://x/api/api-keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "", scopes: [] }) }));
    expect(res.status).toBe(400);
  });

  it("DELETE auf unbekannte ID -> 404", async () => {
    const res = await keyDelete(new Request("http://x", { method: "DELETE" }), { params: Promise.resolve({ id: "unbekannt" }) });
    expect(res.status).toBe(404);
  });
});
