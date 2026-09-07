import { getActiveOrg } from "@/lib/org";
import { loadDocumentSettings } from "@/domain/document/settings";
import { SettingsTabs } from "@/components/SettingsTabs";
import { DocumentSettingsForm } from "@/components/forms/DocumentSettingsForm";

export const dynamic = "force-dynamic";

export default async function DocumentSettingsPage() {
  const org = await getActiveOrg();
  const settings = await loadDocumentSettings(org.id);

  return (
    <div className="space-y-6">
      <SettingsTabs active="dokumente" />
      <h1 className="text-2xl font-bold tracking-tight">Dokumente</h1>
      <p className="text-sm text-slate-600">Einstellungen zur Online-Annahme von Angeboten (Angebotslinks ohne Login).</p>

      <DocumentSettingsForm settings={settings} />
    </div>
  );
}
