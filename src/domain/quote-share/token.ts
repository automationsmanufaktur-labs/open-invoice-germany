/**
 * Token-Erzeugung und -Hashing fuer Angebotsannahme-Links (Phase 3b).
 * Das Klartext-Token verlaesst nur den Link (URL) und wird nie gespeichert —
 * in der Datenbank liegt ausschliesslich der SHA-256-Hash (QuoteShareLink.tokenHash).
 */
import { randomBytes, createHash } from "node:crypto";

/** Erzeugt ein kryptographisch zufaelliges, URL-sicheres Token (256 Bit Entropie). */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Bildet den SHA-256-Hex-Hash eines Tokens fuer den Datenbankvergleich. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
