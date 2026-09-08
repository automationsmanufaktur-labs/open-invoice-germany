/**
 * Verschluesselung von Geheimnissen (SMTP-Passwort, Angebotslink-Tokens, Webhook-Secrets)
 * in der Datenbank. Schluessel: HKDF-SHA256 aus AUTH_SECRET, Info je nach `purpose`
 * (Default "oig-mail-settings-v1" — historischer Name, gilt weiterhin fuer Mail-Passwort
 * UND Angebotslink-Tokens, keine Bestandsdaten-Migration ohne Not).
 * Format: v1:<iv b64>:<tag b64>:<ciphertext b64>
 * Achtung: Wechsel von AUTH_SECRET macht gespeicherte Geheimnisse unlesbar (dokumentiert).
 *
 * Fix-Welle (Should-fix 10): vorher teilten sich SMTP-Passwort, Angebotslink-Tokens UND
 * Webhook-Secrets (drei fachlich unabhaengige Geheimnisklassen) denselben abgeleiteten
 * Schluessel (identischer HKDF-Info-String) — ein `purpose`-Parameter trennt sie jetzt:
 * derselbe `purpose`, mit dem verschluesselt wurde, MUSS beim Entschluesseln erneut
 * angegeben werden (sonst schlaegt die GCM-Auth-Tag-Pruefung fehl), sonst begrenzt ein
 * kompromittierter Schluessel einer Klasse nicht automatisch auch die anderen beiden.
 * Bestehende Aufrufer ohne `purpose` verhalten sich unveraendert (Default). Webhook-
 * Secrets sind die einzige Klasse, die den neuen Purpose nutzt (src/domain/webhook/
 * endpoints.ts, deliver.ts) — kein Migrationsbedarf, da keine Bestandssecrets existieren
 * (Webhooks sind neu in Phase 10).
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

export class SecretsUnavailableError extends Error {
  constructor() {
    super("AUTH_SECRET ist nicht gesetzt — Zugangsdaten koennen nicht verschluesselt gespeichert werden.");
    this.name = "SecretsUnavailableError";
  }
}

const DEFAULT_INFO = "oig-mail-settings-v1";
/** Eigener HKDF-Info-String fuer Webhook-Secrets (Fix-Welle, Should-fix 10). */
export const WEBHOOK_SECRET_PURPOSE = "oig-webhook-secret-v1";

function key(purpose: string): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) throw new SecretsUnavailableError();
  return Buffer.from(hkdfSync("sha256", Buffer.from(secret, "utf8"), "", purpose, 32));
}

export function encryptSecret(plain: string, purpose: string = DEFAULT_INFO): string {
  const k = key(purpose);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

export function decryptSecret(enc: string, purpose: string = DEFAULT_INFO): string {
  const [v, ivB, tagB, ctB] = enc.split(":");
  if (v !== "v1" || !ivB || !tagB || !ctB) throw new Error("Unbekanntes Geheimnisformat");
  const decipher = createDecipheriv("aes-256-gcm", key(purpose), Buffer.from(ivB, "base64"));
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB, "base64")), decipher.final()]).toString("utf8");
}
