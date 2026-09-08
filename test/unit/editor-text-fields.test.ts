import { describe, it, expect } from "vitest";
import { LONG_TEXT_MAX, charCountLabel, charCountTone, previewPanelClass, PREVIEW_WIDE_KEY } from "@/lib/editor/constants";

describe("Zeichenzaehler und Vorschau-Breite (Phase 12a)", () => {
  it("Grenze entspricht dem Zod-Maximum von headerText/footerText", () => {
    expect(LONG_TEXT_MAX).toBe(5000); // src/schemas/index.ts:352/353 z.string().max(5000)
  });
  it("Label zeigt Laenge und Grenze", () => {
    expect(charCountLabel("abc")).toBe("3 / 5000");
    expect(charCountLabel("abcde", 10)).toBe("5 / 10");
  });
  it("Ton wechselt ab 90 % und ueber der Grenze", () => {
    expect(charCountTone("a".repeat(10), 100)).toBe("ok");
    expect(charCountTone("a".repeat(90), 100)).toBe("warn");
    expect(charCountTone("a".repeat(101), 100)).toBe("over");
  });
  it("Panelbreite: schmal 1100 px, breit volle Overlay-Breite, beide w-full", () => {
    expect(previewPanelClass(false)).toBe("w-full max-w-[1100px]");
    expect(previewPanelClass(true)).toBe("w-full max-w-none");
    expect(PREVIEW_WIDE_KEY).toBe("oig.preview.wide");
  });
});
