/** Phase 12c, Task 1 — Marken-Felder in brandingSettingsInputSchema + resolveBrand. */
import { describe, it, expect } from "vitest";
import { brandingSettingsInputSchema as S } from "@/schemas/settings";
import { resolveBrand, DEFAULT_APP_NAME, DEFAULT_APP_SHORT_NAME, DEFAULT_BRAND } from "@/domain/settings/brand";

describe("Marken-Felder (Phase 12c)", () => {
  it("Default ist ueberall null — ohne Eintrag gilt der Produktname", () => {
    expect(S.parse({})).toMatchObject({ appName: null, appShortName: null, faviconPath: null, appLogoPath: null });
  });

  it("appName getrimmt 1..40, appShortName 1..12", () => {
    expect(S.parse({ appName: "  Muster Rechnungen  " }).appName).toBe("Muster Rechnungen");
    expect(S.parse({ appShortName: "MR" }).appShortName).toBe("MR");
    for (const bad of [{ appName: "a".repeat(41) }, { appName: "   " }, { appShortName: "a".repeat(13) }]) {
      expect(S.safeParse(bad).success).toBe(false);
    }
  });

  it("resolveBrand faellt auf die Produktnamen zurueck", () => {
    expect(resolveBrand({ appName: null, appShortName: null, appLogoPath: null })).toEqual({
      appName: DEFAULT_APP_NAME, appShortName: DEFAULT_APP_SHORT_NAME, hasAppLogo: false,
    });
    expect(DEFAULT_BRAND.appName).toBe(DEFAULT_APP_NAME);
    expect(resolveBrand({ appName: "Muster", appShortName: "MU", appLogoPath: "org/ab/cd" })).toEqual({
      appName: "Muster", appShortName: "MU", hasAppLogo: true,
    });
  });
});
