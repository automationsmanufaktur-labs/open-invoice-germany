/** Phase 12c, Task 2 — PNG-Kopf lesen (IHDR), ohne neue Abhaengigkeit. */
import { describe, it, expect } from "vitest";
import { pngSize } from "@/lib/images/png-size";
import { testPngBuffer } from "../helpers/pdf-theme";

describe("pngSize", () => {
  it("liest Breite und Hoehe aus dem IHDR", () => {
    expect(pngSize(testPngBuffer(64, 64))).toEqual({ width: 64, height: 64 });
    expect(pngSize(testPngBuffer(120, 40))).toEqual({ width: 120, height: 40 });
  });
  it("liefert null fuer Nicht-PNG oder zu kurze Puffer", () => {
    expect(pngSize(Buffer.from("nicht png"))).toBeNull();
    expect(pngSize(Buffer.alloc(8))).toBeNull();
  });
});
