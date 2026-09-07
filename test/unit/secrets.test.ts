import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encryptSecret, decryptSecret, SecretsUnavailableError, WEBHOOK_SECRET_PURPOSE } from "@/lib/crypto/secrets";

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

  // Fix-Welle (Should-fix 10): eigener HKDF-Info-String je Zweck (purpose) — SMTP-
  // Passwort/Angebotslink-Tokens (Default) und Webhook-Secrets teilen sich nicht mehr
  // denselben abgeleiteten Schluessel.
  describe("purpose-Trennung (WEBHOOK_SECRET_PURPOSE)", () => {
    it("roundtrip mit demselben purpose funktioniert", () => {
      const enc = encryptSecret("webhook-geheimnis", WEBHOOK_SECRET_PURPOSE);
      expect(decryptSecret(enc, WEBHOOK_SECRET_PURPOSE)).toBe("webhook-geheimnis");
    });

    it("mit Default-purpose verschluesselt, mit WEBHOOK_SECRET_PURPOSE entschluesselt -> scheitert", () => {
      const enc = encryptSecret("mail-passwort");
      expect(() => decryptSecret(enc, WEBHOOK_SECRET_PURPOSE)).toThrow();
    });

    it("mit WEBHOOK_SECRET_PURPOSE verschluesselt, mit Default-purpose entschluesselt -> scheitert", () => {
      const enc = encryptSecret("webhook-geheimnis", WEBHOOK_SECRET_PURPOSE);
      expect(() => decryptSecret(enc)).toThrow();
    });
  });
});
