import { describe, it, expect } from "vitest";
import { PUBLIC_PREFIXES } from "@/proxy";

describe("PUBLIC_PREFIXES", () => {
  it("enthaelt genau die oeffentlichen Praefixe fuer die Angebotsannahme", () => {
    expect(PUBLIC_PREFIXES).toContain("/angebot/");
    expect(PUBLIC_PREFIXES).toContain("/api/public/");
  });

  it("enthaelt keine weiteren, ueberraschenden Praefixe (Sicherheitsregel — nur die dokumentierten)", () => {
    expect(PUBLIC_PREFIXES).toEqual(["/login", "/setup", "/api/auth", "/api/cron", "/angebot/", "/api/public/", "/api/v1/", "/api/docs"]);
  });

  it("enthaelt /api/v1/ (Phase 10: Bearer-Auth im Wrapper, kein Cookie-Fallback)", () => {
    expect(PUBLIC_PREFIXES).toContain("/api/v1/");
  });

  it("enthaelt /api/docs (Phase 10, Task 4: Session-ODER-Bearer-Pruefung in der Route selbst)", () => {
    expect(PUBLIC_PREFIXES).toContain("/api/docs");
  });
});
