import { getActiveOrg } from "@/lib/org";
import { SettingsTabs } from "@/components/SettingsTabs";
import { listApiKeys } from "@/domain/api-key/list";
import { loadApiSettings } from "@/domain/api-log/settings";
import { ApiKeysManager } from "@/components/api-keys/ApiKeysManager";
import { ApiRequestLogPanel } from "@/components/api-keys/ApiRequestLogPanel";

export const dynamic = "force-dynamic";

export default async function ApiSettingsPage() {
  const org = await getActiveOrg();
  const [{ rows: keys }, apiSettings] = await Promise.all([listApiKeys(org.id, { limit: 1000, offset: 0 }), loadApiSettings(org.id)]);

  return (
    <div className="space-y-6">
      <SettingsTabs active="api" />
      <h1 className="text-2xl font-bold tracking-tight">API</h1>
      <p className="text-sm text-slate-600">
        API-Schluessel fuer den Zugriff auf <code className="rounded bg-slate-100 px-1">/api/v1</code>. Jeder Schluessel traegt eigene Scopes
        (read/write/send/admin) und kann jederzeit widerrufen werden. Das Token wird nur beim Erzeugen einmalig angezeigt — danach ist es nicht
        mehr abrufbar.
      </p>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">API-Schluessel</h2>
        <ApiKeysManager
          initialKeys={keys.map((k) => ({
            id: k.id,
            name: k.name,
            prefix: k.prefix,
            scopes: k.scopes,
            lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
            expiresAt: k.expiresAt ? k.expiresAt.toISOString() : null,
            revokedAt: k.revokedAt ? k.revokedAt.toISOString() : null,
            createdAt: k.createdAt.toISOString(),
          }))}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">Anfrageprotokoll</h2>
        <ApiRequestLogPanel initialSettings={apiSettings} initialKeys={keys.map((k) => ({ id: k.id, name: k.name }))} />
      </section>
    </div>
  );
}
