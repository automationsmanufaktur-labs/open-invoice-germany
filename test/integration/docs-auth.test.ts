/**
 * Fix-Welle Phase 10 (Nit 15, final-review-findings.md): `requireSessionOrApiKey`
 * (src/api/docs-auth.ts) akzeptierte bisher JEDEN gueltigen Bearer-Schluessel fuer
 * `/api/docs` und `GET /api/v1/openapi.json`, unabhaengig von seinen Scopes — ein
 * reiner `write`/`send`-Schluessel (ohne `read`) konnte damit die komplette API-
 * Dokumentation einsehen. Ruling: `read`-Scope reicht, aber ein Schluessel OHNE
 * `read` wird abgelehnt.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { dbInternal } from "@/lib/db";
import { createApiKey } from "@/domain/api-key/create";
import { requireSessionOrApiKey } from "@/api/docs-auth";

let orgId: string;

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "Docs-Auth Test GmbH", addressLine1: "Weg 1", postalCode: "10117", city: "Berlin", vatId: "DE444444444", taxNumber: "44/444/44444" },
  });
  orgId = org.id;
});

function bearerReq(token: string) {
  return new Request("http://x/api/docs", { headers: { authorization: `Bearer ${token}` } });
}

describe("requireSessionOrApiKey", () => {
  it("Schluessel MIT read-Scope -> true", async () => {
    const key = await createApiKey(orgId, { name: "Mit-Read", scopes: ["read"] });
    await expect(requireSessionOrApiKey(bearerReq(key.token))).resolves.toBe(true);
  });

  it("Schluessel MIT read unter mehreren Scopes -> true", async () => {
    const key = await createApiKey(orgId, { name: "Read-Plus-Write", scopes: ["read", "write"] });
    await expect(requireSessionOrApiKey(bearerReq(key.token))).resolves.toBe(true);
  });

  it("Schluessel OHNE read-Scope (nur write) -> false (kein Session-Cookie)", async () => {
    const key = await createApiKey(orgId, { name: "Nur-Write", scopes: ["write"] });
    await expect(requireSessionOrApiKey(bearerReq(key.token))).resolves.toBe(false);
  });

  it("Schluessel OHNE read-Scope (nur admin) -> false", async () => {
    const key = await createApiKey(orgId, { name: "Nur-Admin", scopes: ["admin"] });
    await expect(requireSessionOrApiKey(bearerReq(key.token))).resolves.toBe(false);
  });

  it("ungueltiger Token, kein Session-Cookie -> false", async () => {
    await expect(requireSessionOrApiKey(bearerReq("oig_ungueltig"))).resolves.toBe(false);
  });

  it("kein Authorization-Header, kein Session-Cookie -> false", async () => {
    await expect(requireSessionOrApiKey(new Request("http://x/api/docs"))).resolves.toBe(false);
  });
});
