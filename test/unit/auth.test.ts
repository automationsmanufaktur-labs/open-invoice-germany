import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSessionToken, verifySessionToken } from "@/lib/auth/session";

describe("password (scrypt)", () => {
  it("hash + verify (richtig/falsch)", () => {
    const stored = hashPassword("geheim123!");
    expect(verifyPassword("geheim123!", stored)).toBe(true);
    expect(verifyPassword("falsch", stored)).toBe(false);
  });

  it("zwei Hashes desselben Passworts unterscheiden sich (Salt)", () => {
    expect(hashPassword("x")).not.toBe(hashPassword("x"));
  });
});

describe("session token (HMAC)", () => {
  it("Round-Trip liefert die userId", async () => {
    const token = await createSessionToken("user-123");
    expect(await verifySessionToken(token)).toBe("user-123");
  });

  it("manipuliertes Token wird abgelehnt", async () => {
    const token = await createSessionToken("user-123");
    const tampered = token.slice(0, -2) + (token.endsWith("a") ? "bb" : "aa");
    expect(await verifySessionToken(tampered)).toBeNull();
  });

  it("Müll/leer wird abgelehnt", async () => {
    expect(await verifySessionToken("x.y")).toBeNull();
    expect(await verifySessionToken(undefined)).toBeNull();
    expect(await verifySessionToken("")).toBeNull();
  });
});
