import { getActiveOrg } from "@/lib/org";
import { loadBrandingSettings } from "@/domain/settings/branding";
import { SettingsTabs } from "@/components/SettingsTabs";
import { BrandingForm } from "@/components/settings/BrandingForm";

export const dynamic = "force-dynamic";

export default async function BrandingSettingsPage() {
  const org = await getActiveOrg();
  const settings = await loadBrandingSettings(org.id);

  return (
    <div className="space-y-6">
      <SettingsTabs active="briefpapier" />
      <h1 className="text-2xl font-bold tracking-tight">Briefpapier</h1>
      <p className="text-sm text-slate-600">Logo, Farbe, Ränder und Fußzeilen für PDF-Belege.</p>
      <BrandingForm initial={settings} />
    </div>
  );
}
