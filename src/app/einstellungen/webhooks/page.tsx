import { getActiveOrg } from "@/lib/org";
import { SettingsTabs } from "@/components/SettingsTabs";
import { listWebhookEndpoints } from "@/domain/webhook/endpoints";
import { WEBHOOK_EVENTS } from "@/schemas/webhook";
import { WebhooksManager } from "@/components/webhooks/WebhooksManager";

export const dynamic = "force-dynamic";

export default async function WebhooksSettingsPage() {
  const org = await getActiveOrg();
  const { rows: endpoints } = await listWebhookEndpoints(org.id);

  return (
    <div className="space-y-6">
      <SettingsTabs active="webhooks" />
      <h1 className="text-2xl font-bold tracking-tight">Webhooks</h1>
      <p className="max-w-2xl text-sm text-slate-600">
        Webhooks liefern Ereignisse (Rechnung festgeschrieben, Zahlung erfasst, Angebot
        angenommen, …) automatisch an eine eigene URL — signiert per HMAC-SHA256, mit
        Wiederholung bei Fehlschlag.
      </p>
      <WebhooksManager
        initialEndpoints={endpoints.map((e) => ({ ...e, createdAt: e.createdAt.toISOString(), updatedAt: e.updatedAt.toISOString() }))}
        availableEvents={[...WEBHOOK_EVENTS]}
      />
    </div>
  );
}
