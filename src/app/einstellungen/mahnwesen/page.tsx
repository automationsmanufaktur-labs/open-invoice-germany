import { getActiveOrg } from "@/lib/org";
import { SettingsTabs } from "@/components/SettingsTabs";
import { listDunningStages } from "@/domain/dunning/stages";
import { loadDunningSettings } from "@/domain/dunning/settings";
import { DunningStagesEditor } from "@/components/dunning/DunningStagesEditor";
import { DunningSettingsForm } from "@/components/dunning/DunningSettingsForm";

export const dynamic = "force-dynamic";

export default async function DunningSettingsPage() {
  const org = await getActiveOrg();
  const [stages, settings] = await Promise.all([listDunningStages(org.id), loadDunningSettings(org.id)]);

  return (
    <div className="space-y-6">
      <SettingsTabs active="mahnwesen" />
      <h1 className="text-2xl font-bold tracking-tight">Mahnwesen</h1>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">Einstellungen</h2>
        <DunningSettingsForm initial={settings} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">Mahnstufen</h2>
        <DunningStagesEditor initialStages={stages} />
      </section>
    </div>
  );
}
