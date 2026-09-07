// ── Webhooks (Phase 10, Task 5) ────────────────────────────────────────────────
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { dbInternal } from "@/lib/db";
import { listWebhookEndpoints, createWebhookEndpoint, updateWebhookEndpoint } from "@/domain/webhook/endpoints";
import { sendTestDelivery, replayWebhookDelivery } from "@/domain/webhook/actions";
import { NotFoundError } from "@/domain/errors";
import { webhookEventSchema } from "@/schemas/webhook";
import type { McpToolsContext, Result } from "./context";

export function registerWebhookTools(server: McpServer, ctx: McpToolsContext): void {
  server.registerTool(
    "list_webhooks",
    {
      title: "Webhooks auflisten",
      description: "Listet alle Webhook-Endpunkte der Organisation (URL, abonnierte Ereignisse, aktiv) — NIE das Secret.",
      inputSchema: {},
    },
    async (): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const { rows: endpoints } = await listWebhookEndpoints(org.id);
        return ctx.ok(JSON.stringify(endpoints, null, 2));
      } catch (e) {
        return ctx.failUnknown(e);
      }
    },
  );

  server.registerTool(
    "upsert_webhook",
    {
      title: "Webhook anlegen oder aendern",
      description:
        "Legt einen Webhook-Endpunkt an oder aendert einen bestehenden. Mit 'id' wird genau dieser Endpunkt geaendert; ohne 'id' wird ein bestehender Endpunkt mit exakt derselben URL geaendert, sonst ein neuer angelegt. Das Klartext-Secret wird NUR bei Neuanlage oder rotateSecret:true in dieser Antwort angezeigt.",
      inputSchema: {
        id: z.string().min(1).optional(),
        url: z.string().url(),
        events: z.array(webhookEventSchema).min(1).describe("Abonnierte Ereignisse, z. B. invoice.finalized, payment.recorded"),
        active: z.boolean().optional(),
        rotateSecret: z.boolean().optional().describe("Nur bei Aenderung eines bestehenden Endpunkts wirksam — erzeugt ein neues Secret."),
      },
    },
    async ({ id, url, events, active, rotateSecret }): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        let targetId = id;
        if (!targetId) {
          const existing = await dbInternal.webhookEndpoint.findFirst({ where: { orgId: org.id, url }, select: { id: true } });
          targetId = existing?.id;
        }

        if (targetId) {
          const updated = await updateWebhookEndpoint(org.id, targetId, { url, events, active, rotateSecret }, { actor: "mcp" });
          const secretNote = updated.secret ? ` Neues Secret (nur jetzt sichtbar): ${updated.secret}` : "";
          return ctx.ok(`Webhook-Endpunkt "${updated.url}" aktualisiert (Events: ${updated.events.join(", ")}).${secretNote}`);
        }

        const created = await createWebhookEndpoint(org.id, { url, events, active }, { actor: "mcp" });
        return ctx.ok(`Webhook-Endpunkt "${created.url}" angelegt (Events: ${created.events.join(", ")}). Secret (nur jetzt sichtbar): ${created.secret}`);
      } catch (e) {
        if (e instanceof z.ZodError) return ctx.fail(`Validierung fehlgeschlagen: ${e.issues.map((i) => i.message).join("; ")}`);
        if (e instanceof NotFoundError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  server.registerTool(
    "test_webhook",
    {
      title: "Webhook testen",
      description: "Sendet eine synthetische Test-Zustellung an einen Webhook-Endpunkt (id aus list_webhooks) und meldet das Ergebnis (Status, HTTP-Antwortcode).",
      inputSchema: { id: z.string().min(1) },
    },
    async ({ id }): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const result = await sendTestDelivery(org.id, id);
        return ctx.ok(`Test-Zustellung: ${result.attempt.outcome} (HTTP ${result.attempt.status ?? "—"})${result.attempt.error ? ` — ${result.attempt.error}` : ""}`);
      } catch (e) {
        if (e instanceof NotFoundError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  server.registerTool(
    "replay_webhook_delivery",
    {
      title: "Webhook-Zustellung wiederholen",
      description: "Erzeugt eine NEUE Zustellung mit demselben Ereignis/derselben Nutzlast wie die angegebene (deliveryId) und versucht sie sofort erneut zuzustellen. Die urspruengliche Zustellung bleibt unveraendert.",
      inputSchema: { deliveryId: z.string().min(1) },
    },
    async ({ deliveryId }): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const result = await replayWebhookDelivery(org.id, deliveryId);
        return ctx.ok(`Replay (neue Zustellung ${result.delivery.id}): ${result.attempt.outcome} (HTTP ${result.attempt.status ?? "—"})${result.attempt.error ? ` — ${result.attempt.error}` : ""}`);
      } catch (e) {
        if (e instanceof NotFoundError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );
}
