/** Phase 12d, Task 1 — Zod fuer ApiSettings und den Listenfilter. */
import { describe, it, expect } from "vitest";
import { apiSettingsInputSchema as S, apiRequestLogFilterSchema as F } from "@/schemas/api-log";

describe("apiSettingsInputSchema", () => {
  it("ist standardmaessig AUS (Datenminimierung)", () => {
    expect(S.parse({})).toMatchObject({ logRequests: false, logBodies: false, retentionDays: 7, maxRows: 2000 });
  });
  it("Grenzen: retentionDays 1..90, maxRows 100..20000, ganzzahlig", () => {
    for (const bad of [{ retentionDays: 0 }, { retentionDays: 91 }, { retentionDays: 7.5 }, { maxRows: 99 }, { maxRows: 20001 }]) {
      expect(S.safeParse(bad).success).toBe(false);
    }
    expect(S.parse({ retentionDays: 90, maxRows: 20000 })).toMatchObject({ retentionDays: 90, maxRows: 20000 });
  });
});

describe("apiRequestLogFilterSchema", () => {
  it("Defaults: 50 Zeilen, alle Status, kein Schluesselfilter", () => {
    expect(F.parse({})).toMatchObject({ errorsOnly: false, limit: 50, offset: 0 });
    expect(F.parse({}).apiKeyId).toBeUndefined();
  });
  it("nimmt Query-Strings entgegen (coerce) und deckelt limit bei 200", () => {
    const v = F.parse({ errorsOnly: "true", limit: "10", offset: "20", from: "2026-01-01" });
    expect(v).toMatchObject({ errorsOnly: true, limit: 10, offset: 20 });
    expect(v.from?.getUTCFullYear()).toBe(2026);
    expect(F.safeParse({ limit: 201 }).success).toBe(false);
  });

  it("errorsOnly=false (String, Query-Boundary) bleibt false — Fix-Welle I3 (vorher z.coerce.boolean() -> true)", () => {
    expect(F.parse({ errorsOnly: "false" })).toMatchObject({ errorsOnly: false });
    expect(F.parse({ errorsOnly: "0" })).toMatchObject({ errorsOnly: false });
  });

  it("errorsOnly akzeptiert auch echte Booleans (MCP-Boundary)", () => {
    expect(F.parse({ errorsOnly: true })).toMatchObject({ errorsOnly: true });
    expect(F.parse({ errorsOnly: false })).toMatchObject({ errorsOnly: false });
  });
});
