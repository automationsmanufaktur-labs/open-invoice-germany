import { describe, it, expect } from "vitest";
import { PUBLIC_PREFIXES } from "@/proxy";

describe("PUBLIC_PREFIXES", () => {
  it("enthaelt genau die oeffentlichen Praefixe fuer die Angebotsannahme", () => {
    expect(PUBLIC_PREFIXES).toContain("/angebot/");
    expect(PUBLIC_PREFIXES).toContain("/api/public/");
  });

  it("enthaelt keine weiteren, ueberraschenden Praefixe (Sicherheitsregel — nur die dokumentierten)", () => {
    expect(PUBLIC_PREFIXES).toEqual(["/login", "/setup", "/api/auth", "/api/cron", "/angebot/", "/api/public/"]);
  });
});
