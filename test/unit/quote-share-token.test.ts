import { describe, it, expect } from "vitest";
import { generateToken, hashToken } from "@/domain/quote-share/token";

describe("generateToken / hashToken", () => {
  it("erzeugt bei zwei Aufrufen unterschiedliche Tokens", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
  });

  it("liefert einen 64-stelligen Hex-Hash", () => {
    const hash = hashToken(generateToken());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("liefert fuer dasselbe Token immer denselben Hash", () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
  });
});
