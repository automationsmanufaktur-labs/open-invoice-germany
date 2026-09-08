import { getActiveOrg } from "@/lib/org";
import { SettingsTabs } from "@/components/SettingsTabs";
import { loadBrandingSettings } from "@/domain/settings/branding";
import { MarkeForm } from "@/components/settings/MarkeForm";
import { DEFAULT_APP_NAME, DEFAULT_APP_SHORT_NAME } from "@/domain/settings/brand";

export const dynamic = "force-dynamic";

/**
 * Marke-Einstellungen (Phase 12c, Task 4): App-Name/-Kurzname, Favicon und App-Logo der
 * Instanz — die AGPL-Herkunftszeile in der Fußzeile (§13 AGPL, COMPLIANCE.md) ist davon
 * unberührt und wird hier bewusst nicht als abschaltbar dargestellt.
 */
export default async function MarkeSettingsPage() {
  const org = await getActiveOrg();
  const branding = await loadBrandingSettings(org.id);

  return (
    <div className="space-y-6">
      <SettingsTabs active="marke" />
      <h1 className="text-2xl font-bold tracking-tight">Marke</h1>
      <p className="text-sm text-slate-600">
        Name, Kurzname, Favicon und Logo dieser Instanz. Ohne Eintrag gilt „{DEFAULT_APP_NAME}“ (Kurzname „{DEFAULT_APP_SHORT_NAME}“).
        Die Herkunftszeile „powered by OpenInvoice Germany · AGPL-3.0“ bleibt in der Fußzeile — sie ist Bedingung der AGPL-3.0-Lizenz
        und lässt sich nicht abschalten (siehe COMPLIANCE.md).
      </p>
      <MarkeForm initial={branding} />
    </div>
  );
}
