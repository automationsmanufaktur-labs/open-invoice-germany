import { getActiveOrg } from "@/lib/org";
import { loadPrintSettings } from "@/domain/settings/print";
import { SettingsTabs } from "@/components/SettingsTabs";
import { PrintSettingsForm } from "@/components/settings/PrintSettingsForm";

export const dynamic = "force-dynamic";

export default async function PrintSettingsPage() {
  const org = await getActiveOrg();
  const settings = await loadPrintSettings(org.id);

  return (
    <div className="space-y-6">
      <SettingsTabs active="druckoptionen" />
      <h1 className="text-2xl font-bold tracking-tight">Druckoptionen</h1>
      <p className="text-sm text-slate-600">
        Globale Vorgaben fürs PDF-Layout. Einzelne Entwürfe können abweichende Werte setzen (siehe „Druckoptionen“-Panel im Beleg-Editor).
      </p>
      <PrintSettingsForm initial={settings} />
    </div>
  );
}
