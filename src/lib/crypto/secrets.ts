/**
 * Verschluesselung von Geheimnissen (SMTP-Passwort) in der Datenbank.
 * Schluessel: HKDF-SHA256 aus AUTH_SECRET, Info "oig-mail-settings-v1".
 * Format: v1:<iv b64>:<tag b64>:<ciphertext b64>
 * Achtung: Wechsel von AUTH_SECRET macht gespeicherte Geheimnisse unlesbar (dokumentiert).
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

export class SecretsUnavailableError extends Error {
  constructor() {
    super("AUTH_SECRET ist nicht gesetzt — Zugangsdaten koennen nicht verschluesselt gespeichert werden.");
    this.name = "SecretsUnavailableError";
  }
}

const INFO = "oig-mail-settings-v1";

function key(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) throw new SecretsUnavailableError();
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), "", INFO, 32));
}

export function encryptSecret(plain: string): string {
  const k = key();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

export function decryptSecret(enc: string): string {
  const [v, ivB, tagB, ctB] = enc.split(":");
  if (v !== "v1" || !ivB || !tagB || !ctB) throw new Error("Unbekanntes Geheimnisformat");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB, "base64"));
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB, "base64")), decipher.final()]).toString("utf8");
}
