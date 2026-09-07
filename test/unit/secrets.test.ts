import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encryptSecret, decryptSecret, SecretsUnavailableError } from "@/lib/crypto/secrets";

describe("secrets", () => {
  const prev = process.env.AUTH_SECRET;
  beforeEach(() => { process.env.AUTH_SECRET = "test-secret-please-change-0123456789"; });
  afterEach(() => { if (prev === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = prev; });

  it("roundtrip", () => {
    const enc = encryptSecret("Pa$$wort");
    expect(enc.startsWith("v1:")).toBe(true);
    expect(enc).not.toContain("Pa$$wort");
    expect(decryptSecret(enc)).toBe("Pa$$wort");
  });
  it("zwei Verschluesselungen unterscheiden sich (IV)", () => {
    expect(encryptSecret("x")).not.toBe(encryptSecret("x"));
  });
  it("falscher Schluessel scheitert", () => {
    const enc = encryptSecret("geheim");
    process.env.AUTH_SECRET = "anderes-secret";
    expect(() => decryptSecret(enc)).toThrow();
  });
  it("ohne AUTH_SECRET: SecretsUnavailableError", () => {
    delete process.env.AUTH_SECRET;
    expect(() => encryptSecret("x")).toThrow(SecretsUnavailableError);
  });
});
