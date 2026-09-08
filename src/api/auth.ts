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
 *
 * Phase 12d, Task 3: `ctx.requestId` — dieselbe Kennung wie der `X-Request-Id`-Header
 * auf der Antwort und (falls protokolliert) `ApiRequestLog.requestId`. Nach dem
 * eigentlichen Handler-Aufruf laeuft ein nicht blockierender Log-Hook (`logApiRequest`,
 * src/domain/api-log/write.ts) — er haengt NIE an der Antwort (immer `void`-Promise mit
 * eigenem `catch`) und wird fuer Pfade ohne Protokollwert (Doku, OpenAPI, ping, das
 * Protokoll selbst) uebersprungen (`shouldLogPath`, src/domain/api-log/redact.ts).
 */
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import type { ApiKeyScope } from "@/schemas";
import { verifyApiToken, requireScope, type VerifiedApiKey } from "@/domain/api-key/verify";
import { slugifyKeyName } from "@/domain/api-key/create";
import { checkApiRateLimit, checkPreAuthRateLimit, attachRateLimitHeader } from "./rate-limit";
import { clientIpFromHeaders } from "@/lib/http/client-ip";
import { beginIdempotency, completeIdempotency, abandonIdempotency } from "./idempotency";
import { apiError, PayloadTooLargeError } from "./errors";
import { logApiRequest } from "@/domain/api-log/write";
import { loadApiSettings } from "@/domain/api-log/settings";
import { shouldLogPath, redactQuery } from "@/domain/api-log/redact";

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
  /** Phase 12d — auch als X-Request-Id auf der Antwort und in ApiRequestLog.requestId. */
  requestId: string;
}

export const REQUEST_ID_HEADER = "X-Request-Id";

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
    const startedAt = Date.now();
    const requestId = randomUUID();
    const url = new URL(req.url);
    // Was `run()` fuer das Protokoll zurueckmeldet — nur gesetzt, wenn die Anfrage
    // verifyApiToken passiert hat (vorher gibt es keine Organisation).
    const trace: { apiKey?: VerifiedApiKey; rawBody: string } = { rawBody: "" };

    async function run(): Promise<NextResponse> {
      // Fix-Welle (Should-fix 4): IP-gekeytes Kontingent VOR jedem Token-Lookup — sonst
      // verbraucht ein fehlender/ungueltiger Bearer-Token gar kein Kontingent und loest
      // trotzdem einen DB-Round-Trip aus (verifyApiToken -> apiKey.findUnique).
      checkPreAuthRateLimit(clientIpFromHeaders(req.headers));
      const apiKey = await verifyApiToken(bearerToken(req));
      trace.apiKey = apiKey;
      requireScope(apiKey, opts.scope);
      const remaining = checkApiRateLimit(apiKey.id);

      const method = req.method.toUpperCase();
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
        trace.rawBody = rawBody;
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
      const ctx: ApiContext<TParams> = { orgId: apiKey.orgId, apiKey, actor, params, body, requestId };

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
    }

    let res: NextResponse;
    try {
      res = await run();
    } catch (e) {
      res = apiError(e);
    }
    // Fix-Runde 1 (Minor 2): Dauer wird SOFORT nach dem fertigen `res` erfasst — vor
    // jeder Body-Extraktion weiter unten, die sonst faelschlich in die gemessene Zeit
    // einfliesse.
    const durationMs = Date.now() - startedAt;
    res.headers.set(REQUEST_ID_HEADER, requestId);

    if (trace.apiKey && shouldLogPath(url.pathname)) {
      // Fix-Runde 1 (Minor 3): der Klon selbst ist eine reine Stream-Referenz (kein
      // Lesen) und muss SYNCHRON vor der Rueckgabe entstehen — der Laufzeit-Body kann
      // sonst schon konsumiert sein, wenn der Hintergrund-Task laeuft. Nur bei
      // Fehlerantworten (status >= 400) MIT JSON-Content-Type lohnt sich das ueberhaupt
      // (eine PDF/XML-Route wuerde sonst Binaerdaten sinnlos in einen String lesen).
      const contentType = res.headers.get("content-type") ?? "";
      const errorClone = res.status >= 400 && contentType.includes("json") ? res.clone() : null;
      const key = trace.apiKey;
      void (async () => {
        // Task-5-Review-Nachtrag: EINE `loadApiSettings`-Ladung fuer den gesamten Hook —
        // `logApiRequest` (src/domain/api-log/write.ts) laedt die Einstellungen nicht
        // mehr selbst (vorher zwei DB-Roundtrips je protokollierter Anfrage).
        const settings = await loadApiSettings(key.orgId);
        let responseBody: string | null = null;
        let errorCode: string | null = null;
        if (errorClone) {
          // Der Fehler-Code wird UNABHAENGIG von `logBodies` ermittelt — er ist kein
          // Body-Inhalt im Sinne der Datenminimierung, sondern ein kurzer, stets
          // ungefaehrlicher technischer Code (z. B. "VALIDATION", "NOT_FOUND") und
          // gehoert in jede Protokollzeile. Nur der VOLLE Body-Text ist an `logBodies`
          // gebunden (Task-5-Review-Nachtrag).
          const bodyText = await errorClone.text().catch(() => null);
          if (bodyText) {
            try {
              const parsed = JSON.parse(bodyText) as { error?: { code?: unknown } };
              if (typeof parsed.error?.code === "string") errorCode = parsed.error.code;
            } catch {
              // Content-Type sagte JSON, war aber keins -> kein Code ableitbar
            }
            if (settings.logBodies) responseBody = bodyText;
          }
        }
        await logApiRequest(
          {
            orgId: key.orgId,
            apiKeyId: key.id,
            requestId,
            method: req.method.toUpperCase(),
            path: url.pathname,
            // Fix-Welle (I1, final-review.md): Query-Parameter mit verdaechtigem Namen
            // (Geheimnis-Muster + E-Mail) werden VOR dem Speichern geschwaerzt — das galt
            // vorher nur fuer JSON-Bodies, obwohl Clients Geheimnisse/PII auch in die URL
            // haengen (?api_key=..., ?email=...). Scheitert die Redaktion, wird der Pfad
            // OHNE Query gespeichert statt eines moeglicherweise ungeschwaerzten Strings.
            query: redactQuery(url.search ? url.search.slice(1) : null),
            status: res.status,
            durationMs,
            errorCode,
            ip: clientIpFromHeaders(req.headers),
            userAgent: req.headers.get("user-agent"),
            requestBody: trace.rawBody || null,
            responseBody,
          },
          settings,
        );
      })().catch(() => {
        // Protokollieren darf die Anfrage nie kippen (Global Constraint).
      });
    }
    return res;
  };
  Object.defineProperty(wrapped, WITH_API_MARKER, { value: true, enumerable: false });
  return wrapped;
}
