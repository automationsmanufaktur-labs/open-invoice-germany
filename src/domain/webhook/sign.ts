/**
 * HMAC-SHA256-Signatur fuer Webhook-Zustellungen (Phase 10, Task 5, task-5-facts.md
 * "Signatur"): `X-OIG-Signature: t=<unix_seconds>,v1=<hex hmac_sha256(secret, t + "." + body)>`.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_HEADER_RE = /^t=(\d+),v1=([0-9a-f]+)$/;

/** Berechnet den Hex-HMAC ueber `<unixSeconds>.<body>` mit dem Klartext-Secret. */
export function computeSignature(secret: string, unixSeconds: number, body: string): string {
  return createHmac("sha256", secret).update(`${unixSeconds}.${body}`).digest("hex");
}

/** Baut den vollstaendigen `X-OIG-Signature`-Headerwert. */
export function buildSignatureHeader(secret: string, unixSeconds: number, body: string): string {
  return `t=${unixSeconds},v1=${computeSignature(secret, unixSeconds, body)}`;
}

/**
 * Prueft einen empfangenen `X-OIG-Signature`-Header gegen das (Klartext-)Secret und den
 * rohen Body-String. Zeitkonstanter Vergleich (timingSafeEqual) — nur bei exakt gleicher
 * Laenge sinnvoll vergleichbar, sonst `false` (kein Wurf bei Laengen-Mismatch).
 */
export function verifySignatureHeader(header: string, secret: string, body: string): boolean {
  const match = SIGNATURE_HEADER_RE.exec(header.trim());
  if (!match) return false;
  const unixSeconds = Number(match[1]);
  if (!Number.isFinite(unixSeconds)) return false;
  const expected = computeSignature(secret, unixSeconds, body);
  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(match[2], "hex");
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
