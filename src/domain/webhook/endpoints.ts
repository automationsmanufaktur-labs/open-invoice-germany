/**
 * Webhook-Endpunkt-Verwaltung (Phase 10, Task 5, task-5-brief.md "UI /einstellungen/webhooks
 * (Endpunkte CRUD)"): Anlegen/Auflisten/Lesen/Aendern. KEIN Hard-Delete — ein Endpunkt wird
 * per `active:false` deaktiviert (analog ApiKey-Widerruf), damit `WebhookDelivery`-Historie
 * (FK `endpointId`) referenzierbar bleibt, statt per Cascade zu verschwinden. Das
 * Klartext-Secret existiert NUR in der Rueckgabe von `createWebhookEndpoint` und
 * `updateWebhookEndpoint({rotateSecret:true})` — analog `createApiKey` (Task 1).
 */
import { randomBytes } from "node:crypto";
import { dbInternal } from "@/lib/db";
import { appendChangeLog } from "@/domain/audit";
import { NotFoundError } from "@/domain/errors";
import { encryptSecret, WEBHOOK_SECRET_PURPOSE } from "@/lib/crypto/secrets";
import { assertPublicHttpsUrl } from "./ssrf";
import {
  createWebhookEndpointInputSchema,
  updateWebhookEndpointInputSchema,
  type WebhookEvent,
} from "@/schemas/webhook";
import type { WebhookEndpoint } from "@/generated/prisma/client";

export interface WebhookEndpointView {
  id: string;
  orgId: string;
  url: string;
  events: WebhookEvent[];
  active: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toView(row: WebhookEndpoint): WebhookEndpointView {
  return {
    id: row.id,
    orgId: row.orgId,
    url: row.url,
    events: JSON.parse(row.eventsJson) as WebhookEvent[],
    active: row.active,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** 32 zufaellige Bytes, base64url — dasselbe Muster wie API-Key-Token (Task 1), aber ein
 *  eigenstaendiges Secret ohne Praefix (dient nur als HMAC-Schluessel, nie als Bearer-Token). */
export function generateWebhookSecret(): string {
  return randomBytes(32).toString("base64url");
}

export async function createWebhookEndpoint(
  orgId: string,
  rawInput: unknown,
  opts: { actor?: string; now?: Date } = {},
): Promise<WebhookEndpointView & { secret: string }> {
  const input = createWebhookEndpointInputSchema.parse(rawInput);
  await assertPublicHttpsUrl(input.url);

  const now = opts.now ?? new Date();
  const actor = opts.actor ?? "system";
  const secret = generateWebhookSecret();
  const secretEnc = encryptSecret(secret, WEBHOOK_SECRET_PURPOSE);

  const created = await dbInternal.$transaction(async (tx) => {
    const row = await tx.webhookEndpoint.create({
      data: {
        orgId,
        url: input.url,
        secretEnc,
        eventsJson: JSON.stringify(input.events),
        active: input.active ?? true,
        createdBy: actor,
      },
    });
    await appendChangeLog(tx, {
      orgId,
      entity: "WEBHOOK_ENDPOINT",
      entityId: row.id,
      action: "CREATE",
      actor,
      at: now,
      diff: { url: row.url, events: input.events, active: row.active },
    });
    return row;
  });

  return { ...toView(created), secret };
}

export interface ListWebhookEndpointsResult {
  rows: WebhookEndpointView[];
  total: number;
}

/**
 * Fix-Welle (Nit 14): optionales `opts` fuer DB-seitige Pagination (take/skip/count) —
 * ohne Angabe (Session-Route, MCP-Tool) werden weiterhin ALLE Zeilen geladen wie zuvor
 * (kein Verhaltensbruch fuer diese beiden Aufrufer, die keine Paginierungs-UI haben).
 */
export async function listWebhookEndpoints(orgId: string, opts?: { limit: number; offset: number }): Promise<ListWebhookEndpointsResult> {
  const where = { orgId };
  const [total, rows] = await Promise.all([
    dbInternal.webhookEndpoint.count({ where }),
    dbInternal.webhookEndpoint.findMany({ where, orderBy: { createdAt: "desc" }, ...(opts ? { skip: opts.offset, take: opts.limit } : {}) }),
  ]);
  return { rows: rows.map(toView), total };
}

export async function getWebhookEndpoint(orgId: string, id: string): Promise<WebhookEndpointView> {
  const row = await dbInternal.webhookEndpoint.findFirst({ where: { id, orgId } });
  if (!row) throw new NotFoundError(`Webhook-Endpunkt ${id} nicht gefunden.`);
  return toView(row);
}

/** Nur fuer die Zustellung (deliver.ts/replay/test) — liefert die Zeile MIT secretEnc. Nie
 *  ausserhalb der Domain exportieren/an Routen/MCP zurueckgeben. */
export async function getWebhookEndpointRaw(orgId: string, id: string): Promise<WebhookEndpoint> {
  const row = await dbInternal.webhookEndpoint.findFirst({ where: { id, orgId } });
  if (!row) throw new NotFoundError(`Webhook-Endpunkt ${id} nicht gefunden.`);
  return row;
}

export async function updateWebhookEndpoint(
  orgId: string,
  id: string,
  rawInput: unknown,
  opts: { actor?: string; now?: Date } = {},
): Promise<WebhookEndpointView & { secret?: string }> {
  const raw = rawInput && typeof rawInput === "object" ? (rawInput as Record<string, unknown>) : {};
  const input = updateWebhookEndpointInputSchema.parse(raw);
  if (input.url) await assertPublicHttpsUrl(input.url);

  const now = opts.now ?? new Date();
  const actor = opts.actor ?? "system";

  const existing = await dbInternal.webhookEndpoint.findFirst({ where: { id, orgId } });
  if (!existing) throw new NotFoundError(`Webhook-Endpunkt ${id} nicht gefunden.`);

  const patch: Record<string, unknown> = {};
  if ("url" in raw && input.url) patch.url = input.url;
  if ("events" in raw && input.events) patch.eventsJson = JSON.stringify(input.events);
  if ("active" in raw && input.active !== undefined) patch.active = input.active;

  let plainSecret: string | undefined;
  if (input.rotateSecret) {
    plainSecret = generateWebhookSecret();
    patch.secretEnc = encryptSecret(plainSecret, WEBHOOK_SECRET_PURPOSE);
  }

  const updated = await dbInternal.$transaction(async (tx) => {
    const row = Object.keys(patch).length > 0 ? await tx.webhookEndpoint.update({ where: { id }, data: patch }) : existing;
    await appendChangeLog(tx, {
      orgId,
      entity: "WEBHOOK_ENDPOINT",
      entityId: id,
      action: "UPDATE",
      actor,
      at: now,
      diff: {
        ...("url" in patch ? { url: patch.url } : {}),
        ...("eventsJson" in patch ? { events: input.events } : {}),
        ...("active" in patch ? { active: patch.active } : {}),
        secretRotated: !!plainSecret,
      },
    });
    return row;
  });

  return { ...toView(updated), ...(plainSecret ? { secret: plainSecret } : {}) };
}
