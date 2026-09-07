/**
 * Zustellung von Webhook-Deliveries (Phase 10, Task 5, task-5-facts.md "Zustellung"):
 * signiert (sign.ts), sendet per injizierbarem `fetch` (Tests mocken ihn — kein echter
 * Netzwerkzugriff), Timeout 10s (AbortController), Backoff bei Fehlschlag, DEAD nach dem
 * 6. Versuch. `runWebhookDeliveries` ist der Scheduler-Job-Koerper (Reihenfolge nach
 * "notifications", siehe src/domain/scheduler/jobs.ts) — laeuft seriell (einfache
 * for-Schleife, kein Promise.all), wie von den Token-Sparregeln/Batchjob-Ruling verlangt.
 *
 * Backoff-Design (Praezisierung aus Task 6, task-6-facts.md, Ruling aus dem Task-5-Review):
 * Erstversuch + 5 Wiederholungen mit Backoff 1/5/30/120/600 Minuten, DEAD nach dem 6.
 * fehlgeschlagenen Versuch — `MAX_ATTEMPTS = 6`, `BACKOFF_MINUTES[attempts-1]` deckt
 * ALLE 5 Eintraege ab (Versuch 1 scheitert -> 1 Min. Backoff vor Versuch 2, ..., Versuch 5
 * scheitert -> 600 Min. Backoff vor Versuch 6, Versuch 6 scheitert -> sofort DEAD, kein
 * weiterer Backoff-Wert noetig). Ersetzt die fruehere (Task-5-)Lesart "DEAD nach 5
 * Versuchen, nur die ersten 4 Backoff-Werte genutzt" — siehe task-6-facts.md.
 */
import { dbInternal } from "@/lib/db";
import { decryptSecret, WEBHOOK_SECRET_PURPOSE } from "@/lib/crypto/secrets";
import { assertPublicHttpsUrl, SsrfBlockedError } from "./ssrf";
import { buildSignatureHeader } from "./sign";
import type { WebhookDelivery, WebhookEndpoint } from "@/generated/prisma/client";

export const BACKOFF_MINUTES = [1, 5, 30, 120, 600] as const;
export const MAX_ATTEMPTS = 6;
export const DELIVERY_TIMEOUT_MS = 10_000;
const RESPONSE_BODY_MAX_CHARS = 2000;
const ERROR_MAX_CHARS = 500;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface AttemptResult {
  outcome: "delivered" | "retry" | "dead";
  status: number | null;
  error?: string;
}

type DeliveryWithEndpoint = WebhookDelivery & { endpoint: WebhookEndpoint };

/** Baut die tatsaechlich gesendete Nutzlast: `{ id, type, createdAt, data }` (task-5-facts.md,
 *  woertlich) — `data` ist der zum Emit-Zeitpunkt gespeicherte Serializer-Schnappschuss. */
export function buildDeliveryBody(delivery: Pick<WebhookDelivery, "id" | "event" | "createdAt" | "dataJson">): string {
  return JSON.stringify({
    id: delivery.id,
    type: delivery.event,
    createdAt: delivery.createdAt.toISOString(),
    data: JSON.parse(delivery.dataJson),
  });
}

/** Fuehrt GENAU EINEN Zustellversuch fuer `delivery` aus und verbucht das Ergebnis
 *  (Status/attempts/nextAttemptAt/lastError) in der DB. Wiederverwendet von
 *  `runWebhookDeliveries` (Scheduler), `sendTestDelivery` und `replayWebhookDelivery`. */
export async function attemptDelivery(
  delivery: DeliveryWithEndpoint,
  fetchImpl: FetchLike,
  now: Date,
): Promise<AttemptResult> {
  if (!delivery.endpoint.active) {
    await dbInternal.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: "DEAD", lastAttemptAt: now, lastError: "Endpunkt ist deaktiviert." },
    });
    return { outcome: "dead", status: null, error: "Endpunkt ist deaktiviert." };
  }

  // SSRF-Schutz auch bei Zustellung (nicht nur bei Anlage) — ein zum Anlagezeitpunkt
  // oeffentlicher Host kann inzwischen (neuer DNS-Eintrag) privat aufloesen. Re-Validierung
  // des DNS-Eintrags, KEIN Schutz vor DNS-Rebinding waehrend der eigentlichen Verbindung
  // weiter unten (siehe Praezisierung in ssrf.ts, Fix-Welle Should-fix 8).
  try {
    await assertPublicHttpsUrl(delivery.endpoint.url);
  } catch (e) {
    const message = e instanceof SsrfBlockedError ? e.message : "SSRF-Pruefung fehlgeschlagen.";
    await dbInternal.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: "DEAD", lastAttemptAt: now, lastError: message },
    });
    return { outcome: "dead", status: null, error: message };
  }

  let secret: string;
  try {
    secret = decryptSecret(delivery.endpoint.secretEnc, WEBHOOK_SECRET_PURPOSE);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Secret konnte nicht entschluesselt werden.";
    await dbInternal.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: "DEAD", lastAttemptAt: now, lastError: message.slice(0, ERROR_MAX_CHARS) },
    });
    return { outcome: "dead", status: null, error: message };
  }

  const body = buildDeliveryBody(delivery);
  const unixSeconds = Math.floor(now.getTime() / 1000);
  const signature = buildSignatureHeader(secret, unixSeconds, body);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  let status: number | null = null;
  let responseBody = "";
  let errorMessage: string | undefined;
  try {
    const res = await fetchImpl(delivery.endpoint.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-OIG-Signature": signature,
        "X-OIG-Event": delivery.event,
        "X-OIG-Delivery": delivery.id,
      },
      body,
      signal: controller.signal,
      // Fix-Welle (Blocking 2): OHNE dies folgt undici 3xx-Antworten automatisch — die
      // SSRF-Pruefung oben (assertPublicHttpsUrl) prueft aber NUR die urspruengliche URL.
      // Ein oeffentlich erreichbarer Endpunkt koennte mit einem 307 auf eine private
      // Adresse (Cloud-Metadata, localhost, ...) antworten; der signierte POST wuerde dann
      // dorthin repliziert und die Antwort (bis zu RESPONSE_BODY_MAX_CHARS) im Zustellprotokoll
      // gespeichert/angezeigt — ein Lese-Primitive gegen das interne Netz. `redirect: "manual"`
      // liefert die 3xx-Antwort selbst zurueck statt ihr zu folgen; jeder 3xx-Status wird unten
      // als Fehlschlag behandelt (kein zweiter Request).
      redirect: "manual",
    });
    status = res.status;
    if (status >= 300 && status < 400) {
      // Kein zweiter Request: die Redirect-Antwort selbst (nicht das Redirect-Ziel)
      // wird NICHT gelesen/gespeichert — nur der Grund als Fehlertext.
      errorMessage = "Redirect nicht erlaubt.";
    } else {
      responseBody = (await res.text().catch(() => "")).slice(0, RESPONSE_BODY_MAX_CHARS);
    }
  } catch (e) {
    errorMessage = (e instanceof Error ? e.message : String(e)).slice(0, ERROR_MAX_CHARS);
  } finally {
    clearTimeout(timer);
  }

  const ok = status !== null && status >= 200 && status < 300;
  const attempts = delivery.attempts + 1;

  if (ok) {
    await dbInternal.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: "DELIVERED", attempts, responseCode: status, responseBody, lastAttemptAt: now, deliveredAt: now, lastError: null },
    });
    return { outcome: "delivered", status };
  }

  const lastError = errorMessage ?? `HTTP ${status}`;
  if (attempts >= MAX_ATTEMPTS) {
    await dbInternal.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: "DEAD", attempts, responseCode: status, responseBody, lastAttemptAt: now, lastError },
    });
    return { outcome: "dead", status, error: lastError };
  }

  const backoffMinutes = BACKOFF_MINUTES[attempts - 1] ?? BACKOFF_MINUTES[BACKOFF_MINUTES.length - 1];
  const nextAttemptAt = new Date(now.getTime() + backoffMinutes * 60_000);
  await dbInternal.webhookDelivery.update({
    where: { id: delivery.id },
    data: { status: "FAILED", attempts, responseCode: status, responseBody, lastAttemptAt: now, nextAttemptAt, lastError },
  });
  return { outcome: "retry", status, error: lastError };
}

export interface RunWebhookDeliveriesResult {
  checked: number;
  delivered: number;
  retried: number;
  dead: number;
}

export interface RunWebhookDeliveriesOptions {
  fetchImpl?: FetchLike;
  now?: Date;
}

/** Scheduler-Job-Koerper "webhooks" (nach "notifications", task-5-facts.md). Holt ALLE
 *  faelligen Deliveries (PENDING/FAILED mit nextAttemptAt <= now) und arbeitet sie SERIELL
 *  ab (eine nach der anderen, kein Promise.all — Batchjob-Ruling). */
export async function runWebhookDeliveries(opts: RunWebhookDeliveriesOptions = {}): Promise<RunWebhookDeliveriesResult> {
  const now = opts.now ?? new Date();
  const fetchImpl = opts.fetchImpl ?? ((input: string, init: RequestInit) => fetch(input, init));

  const due = (await dbInternal.webhookDelivery.findMany({
    where: { status: { in: ["PENDING", "FAILED"] }, nextAttemptAt: { lte: now } },
    orderBy: { createdAt: "asc" },
    include: { endpoint: true },
  })) as DeliveryWithEndpoint[];

  const result: RunWebhookDeliveriesResult = { checked: due.length, delivered: 0, retried: 0, dead: 0 };
  for (const delivery of due) {
    const attempt = await attemptDelivery(delivery, fetchImpl, now);
    if (attempt.outcome === "delivered") result.delivered += 1;
    else if (attempt.outcome === "dead") result.dead += 1;
    else result.retried += 1;
  }
  return result;
}
