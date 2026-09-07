/**
 * withApi — gemeinsamer Wrapper fuer jede /api/v1/*-Route (Phase 10, Task 1).
 *
 * Ablauf je Aufruf: Bearer-Token pruefen (src/domain/api-key/verify.ts) -> Scope
 * pruefen -> Rate-Limit verbrauchen (600/min je Schluessel) -> bei POST mit
 * `Idempotency-Key` eine bereits abgeschlossene Antwort ausliefern ODER die Zeile
 * reserve-first anlegen (Fix-Runde 1 S1, Wettlauf-Schutz ueber
 * @@unique([orgId,key]) — siehe src/api/idempotency.ts fuer die Zustandsmaschine)
 * -> Fehler einheitlich mappen (src/api/errors.ts). `/api/v1/*` akzeptiert
 * AUSSCHLIESSLICH Bearer — kein Cookie-Fallback (task-1-facts.md); der Proxy
 * (src/proxy.ts) laesst den Pfad ohne Session durch, die eigentliche Pruefung
 * passiert ausschliesslich hier.
 *
 * Handler-Vertrag fuer Tasks 2-5: `withApi(handler, { scope })` liefert einen
 * Next.js-Routen-Handler `(req, routeCtx?) => Promise<NextResponse>`. Der Handler
 * bekommt das ORIGINALE `req` (Header/URL nutzbar, Body-Stream bereits konsumiert —
 * NIE erneut `req.json()`/`req.text()` aufrufen) sowie `ctx`:
 *   - ctx.orgId       — Organisation des Schluessels (fuer jede Query/jeden Write)
 *   - ctx.apiKey       — { id, orgId, name, scopes }
 *   - ctx.actor        — "api:<slug>" fuer appendChangeLog/ActivityLog (Audit-Ruling)
 *   - ctx.params        — bereits aufgeloeste Routen-Parameter ([id] etc.)
 *   - ctx.body           — bei PATCH/POST/PUT das geparste JSON (oder `undefined`
 *                            ohne Body); die Route validiert es selbst mit dem
 *                            passenden Zod-Schema (kein Bypass, §50/§55)
 * Rueckgabe: der Handler liefert `apiData`/`apiList` (src/api/response.ts) oder wirft
 * — withApi mappt jeden Wurf einheitlich. `X-RateLimit-Remaining` wird auf JEDE
 * Antwort (Erfolg wie Fehler-Idempotenz-Replay) gesetzt.
 *
 * Fix-Welle (Should-fix 4+5): VOR jedem Token-Lookup laeuft ein IP-gekeytes Pre-Auth-
 * Kontingent (120/Min, src/api/rate-limit.ts#checkPreAuthRateLimit) — ohne dieses lief
 * ein ungueltiger/fehlender Bearer-Token unbegrenzt gegen die DB. Bei POST/PATCH/PUT wird
 * zusaetzlich die Body-Groesse begrenzt (`opts.maxBodyBytes`, Default 2 MB,
 * `DEFAULT_MAX_BODY_BYTES`) — erst per `Content-Length`-Header (schneller Abbruch ohne
 * den Body zu lesen), dann per tatsaechlich gelesener Laenge (Header ist faelschbar/
 * auslassbar). Ueberschreitung wirft `PayloadTooLargeError` -> 413 PAYLOAD_TOO_LARGE.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import type { ApiKeyScope } from "@/schemas";
import { verifyApiToken, requireScope, type VerifiedApiKey } from "@/domain/api-key/verify";
import { slugifyKeyName } from "@/domain/api-key/create";
import { checkApiRateLimit, checkPreAuthRateLimit, attachRateLimitHeader } from "./rate-limit";
import { clientIpFromHeaders } from "@/lib/http/client-ip";
import { beginIdempotency, completeIdempotency, abandonIdempotency } from "./idempotency";
import { apiError, PayloadTooLargeError } from "./errors";

const IDEMPOTENCY_HEADER = "idempotency-key";
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const BODY_METHODS = new Set(["POST", "PATCH", "PUT"]);

/** Fix-Welle (Should-fix 5): Default-Limit fuer den Request-Body — 2 MB deckt jede
 *  reguläre JSON-Nutzlast bequem ab (die groesste Ausnahme ist /Attachment, das per
 *  `maxBodyBytes` in seinem eigenen `withApi(...)`-Aufruf ueberschreibt). */
export const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;

export interface ApiContext<TParams = Record<string, string>> {
  orgId: string;
  apiKey: VerifiedApiKey;
  actor: string;
  params: TParams;
  body: unknown;
}

export type ApiRouteContext<TParams> = { params: Promise<TParams> };

export type ApiHandler<TParams = Record<string, string>> = (req: Request, ctx: ApiContext<TParams>) => Promise<NextResponse>;

function bearerToken(req: Request): string | undefined {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return undefined;
  const token = header.slice("Bearer ".length).trim();
  return token || undefined;
}

function invalidIdempotencyKeyError(): z.ZodError {
  return new z.ZodError([{ code: "custom", path: ["Idempotency-Key"], message: `Idempotency-Key muss 1..${MAX_IDEMPOTENCY_KEY_LENGTH} Zeichen lang sein.` }]);
}

/** Marker-Property (Fix-Welle, Nit 12): am Rueckgabewert von `withApi` gesetzt, damit ein
 *  Test jede exportierte GET/POST/PATCH/PUT/DELETE-Funktion unter src/app/api/v1 darauf
 *  pruefen kann, ob sie tatsaechlich ein withApi-Produkt ist — `discoverRouteSpecs`
 *  (src/api/openapi.ts) verlangt bisher nur einen `spec`-Export, nicht dass der Handler
 *  auch WIRKLICH per withApi laeuft. Da der gesamte /api/v1-Praefix proxy-oeffentlich ist
 *  (src/proxy.ts), waere eine vergessene withApi-Umhuellung ein Endpunkt ohne jede
 *  Auth-Pruefung. Siehe test/unit/withapi-coverage.test.ts. */
export const WITH_API_MARKER = Symbol.for("oig.withApi");

export function withApi<TParams = Record<string, string>>(
  handler: ApiHandler<TParams>,
  opts: { scope: ApiKeyScope; maxBodyBytes?: number },
) {
  const maxBodyBytes = opts.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const wrapped = async (req: Request, routeCtx?: ApiRouteContext<TParams>): Promise<NextResponse> => {
    try {
      // Fix-Welle (Should-fix 4): IP-gekeytes Kontingent VOR jedem Token-Lookup — sonst
      // verbraucht ein fehlender/ungueltiger Bearer-Token gar kein Kontingent und loest
      // trotzdem einen DB-Round-Trip aus (verifyApiToken -> apiKey.findUnique).
      checkPreAuthRateLimit(clientIpFromHeaders(req.headers));
      const apiKey = await verifyApiToken(bearerToken(req));
      requireScope(apiKey, opts.scope);
      const remaining = checkApiRateLimit(apiKey.id);

      const method = req.method.toUpperCase();
      const url = new URL(req.url);
      const params = routeCtx ? await routeCtx.params : ({} as TParams);

      let rawBody = "";
      let body: unknown;
      if (BODY_METHODS.has(method)) {
        // Fix-Welle (Should-fix 5): Content-Length VORAB pruefen (schneller Abbruch ohne
        // den Body ueberhaupt zu lesen) — der Header ist aber vom Client faelschbar/
        // auslassbar, deshalb zusaetzlich die tatsaechlich gelesene Laenge unten pruefen.
        const contentLength = req.headers.get("content-length");
        if (contentLength && Number(contentLength) > maxBodyBytes) {
          throw new PayloadTooLargeError(`Request-Body ueberschreitet das Limit von ${maxBodyBytes} Bytes.`);
        }
        rawBody = await req.text();
        if (Buffer.byteLength(rawBody, "utf8") > maxBodyBytes) {
          throw new PayloadTooLargeError(`Request-Body ueberschreitet das Limit von ${maxBodyBytes} Bytes.`);
        }
        if (rawBody) {
          try {
            body = JSON.parse(rawBody);
          } catch {
            throw new z.ZodError([{ code: "custom", path: [], message: "Ungueltiges JSON im Request-Body." }]);
          }
        }
      }

      const actor = `api:${slugifyKeyName(apiKey.name)}`;
      const ctx: ApiContext<TParams> = { orgId: apiKey.orgId, apiKey, actor, params, body };

      const idemKey = req.headers.get(IDEMPOTENCY_HEADER)?.trim() || undefined;
      const usesIdempotency = method === "POST" && idemKey !== undefined;
      if (usesIdempotency) {
        if (idemKey!.length < 1 || idemKey!.length > MAX_IDEMPOTENCY_KEY_LENGTH) throw invalidIdempotencyKeyError();
        // Reserve-First (Fix-Runde 1 S1): entweder eine bereits abgeschlossene Antwort
        // (Replay), oder die Reservierung fuer DIESEN Aufruf gelingt (null) — ein
        // gleichzeitiger zweiter Aufruf mit demselben Key wirft IdempotencyInProgressError
        // (409), bevor der Handler ueberhaupt startet. Siehe src/api/idempotency.ts.
        const replay = await beginIdempotency(ctx.orgId, idemKey!, method, url.pathname, rawBody);
        if (replay) {
          return attachRateLimitHeader(NextResponse.json(replay.body, { status: replay.status }), remaining);
        }
      }

      let res: NextResponse;
      try {
        res = await handler(req, ctx);
      } catch (e) {
        // Handler warf -> Reservierung wieder entfernen, damit ein Retry mit demselben
        // Idempotency-Key normal (nicht als IN_PROGRESS haengend) laeuft.
        if (usesIdempotency) await abandonIdempotency(ctx.orgId, idemKey!);
        throw e;
      }

      if (usesIdempotency) {
        if (res.status < 500) {
          const replayBody = await res.clone().json().catch(() => null);
          await completeIdempotency(ctx.orgId, idemKey!, res.status, replayBody);
        } else {
          // 5xx gilt als transient -> Reservierung entfernen statt den Serverfehler
          // dauerhaft zu replizieren (GoBD verlangt keine Replikation eines Serverfehlers).
          await abandonIdempotency(ctx.orgId, idemKey!);
        }
      }

      return attachRateLimitHeader(res, remaining);
    } catch (e) {
      return apiError(e);
    }
  };
  Object.defineProperty(wrapped, WITH_API_MARKER, { value: true, enumerable: false });
  return wrapped;
}
