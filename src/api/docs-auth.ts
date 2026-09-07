/**
 * Session-ODER-Bearer-Pruefung fuer `/api/docs` (Swagger-UI) und `GET
 * /api/v1/openapi.json` (Phase 10, Task 4, plan-header.md: "Swagger-UI /api/docs
 * (Session ODER Key)") — beide sollen sowohl aus dem Browser (Session-Cookie, Swagger
 * UI selbst laedt die Spec per `fetch`) als auch von einem externen Werkzeug mit
 * API-Schluessel (Bearer) erreichbar sein. Bewusst KEIN `withApi` (src/api/auth.ts) —
 * das erzwingt ausschliesslich Bearer, kein Session-Fallback.
 *
 * Fix-Welle (Nit 15): vorher akzeptierte diese Pruefung JEDEN gueltigen Bearer-Schluessel
 * unabhaengig von seinen Scopes — ein reiner `write`- oder `send`-Schluessel (ohne
 * `read`) konnte damit trotzdem die vollstaendige API-Dokumentation (Swagger UI, das
 * OpenAPI-Dokument) einsehen, obwohl er selbst keinen einzigen GET-Endpunkt aufrufen
 * darf. Ruling: `read`-Scope reicht (kein eigener, staerkerer "docs"-Scope), aber ein
 * Schluessel OHNE `read` wird abgelehnt (faellt wie ein ungueltiger Token auf die
 * Session-Pruefung zurueck, siehe Kommentar bei `requireSessionOrApiKey`).
 */
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth/session";
import { verifyApiToken } from "@/domain/api-key/verify";

function readSessionCookie(req: Request): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === SESSION_COOKIE) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** `true`, wenn entweder ein gueltiger Bearer-API-Schluessel MIT `read`-Scope ODER eine
 *  gueltige Session vorliegt. Ein ungueltiger Bearer-Token ODER ein gueltiger Token OHNE
 *  `read`-Scope fuehrt NICHT sofort zu `false` — es wird zusaetzlich noch die Session
 *  geprueft (z. B. ein im Browser gespeicherter, abgelaufener/scope-loser Testtoken soll
 *  eine gueltige Session nicht verdecken). */
export async function requireSessionOrApiKey(req: Request): Promise<boolean> {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    try {
      const apiKey = await verifyApiToken(auth.slice("Bearer ".length).trim());
      if (apiKey.scopes.includes("read")) return true;
      // Gueltiger Schluessel, aber ohne read-Scope (Nit 15) — faellt durch auf die
      // Session-Pruefung, siehe Kommentar oben.
    } catch {
      // faellt durch auf die Session-Pruefung, siehe Kommentar oben.
    }
  }
  const userId = await verifySessionToken(readSessionCookie(req));
  return !!userId;
}
