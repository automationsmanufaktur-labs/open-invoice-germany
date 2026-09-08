/**
 * Phase 12c, Fix-Welle Fix 1 — Pfad-Containment und ETag der beiden oeffentlichen
 * Marken-Auslieferungsrouten (src/app/api/branding/asset.ts).
 */
import { describe, it, expect } from "vitest";
import { isWithinAttachmentsRoot, assetEtag } from "@/app/api/branding/asset";

describe("isWithinAttachmentsRoot", () => {
  it("akzeptiert normale storagePaths (orgId/hash-Praefix/hash)", () => {
    expect(isWithinAttachmentsRoot("org123/ab/abcdef0123456789")).toBe(true);
  });

  it("lehnt Pfad-Traversal ausserhalb von ATTACHMENTS_DIR ab", () => {
    expect(isWithinAttachmentsRoot("../../../../../../etc/passwd")).toBe(false);
    expect(isWithinAttachmentsRoot("org123/../../../../etc/passwd")).toBe(false);
  });
});

describe("assetEtag", () => {
  it("ist stabil fuer denselben updatedAt+Pfad, aendert sich bei Aenderung von einem der beiden", () => {
    const d = new Date("2079-01-01T00:00:00.000Z");
    const a = assetEtag(d, "org123/ab/hash1");
    const b = assetEtag(d, "org123/ab/hash1");
    const c = assetEtag(d, "org123/ab/hash2");
    const e = assetEtag(new Date("2079-02-01T00:00:00.000Z"), "org123/ab/hash1");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(e);
  });
});
