/**
 * Signiertes, zustandsloses Session-Token (HMAC-SHA256 via Web Crypto).
 * Web Crypto läuft sowohl in der Node-Runtime als auch in der Edge-Middleware.
 */
export const SESSION_COOKIE = "oig_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 Tage (Sekunden)

function getSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 16) return s;
  // Dev-Fallback: funktioniert lokal, ist aber NICHT sicher. In Produktion AUTH_SECRET setzen.
  return "dev-insecure-secret-bitte-AUTH_SECRET-setzen";
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBytes(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

export async function createSessionToken(userId: string): Promise<string> {
  const payload = b64urlEncode(
    new TextEncoder().encode(JSON.stringify({ uid: userId, exp: Date.now() + SESSION_MAX_AGE * 1000 })),
  );
  const sig = b64urlEncode(await hmac(payload));
  return `${payload}.${sig}`;
}

export async function verifySessionToken(token: string | undefined | null): Promise<string | null> {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;

  const expected = b64urlEncode(await hmac(payload));
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;

  try {
    const data = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload))) as { uid?: string; exp?: number };
    if (!data.uid || typeof data.exp !== "number" || data.exp < Date.now()) return null;
    return data.uid;
  } catch {
    return null;
  }
}
