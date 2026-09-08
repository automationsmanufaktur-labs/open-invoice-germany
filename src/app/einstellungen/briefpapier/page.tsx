import { redirect } from "next/navigation";
import { loadBrandingSettings } from "@/domain/settings/branding";
import { loadPrintSettings } from "@/domain/settings/print";
import { getActiveOrg } from "@/lib/org";
import { listLayouts } from "@/lib/pdf/layouts/registry";
import { SettingsTabs } from "@/components/SettingsTabs";
import { PageHeader } from "@/components/PageHeader";
import { BriefpapierTabs, type BriefpapierTab } from "@/components/settings/BriefpapierTabs";
import { BrandingForm } from "@/components/settings/BrandingForm";
import { LayoutGallery } from "@/components/settings/LayoutGallery";
import { PrintSettingsForm } from "@/components/settings/PrintSettingsForm";

export const dynamic = "force-dynamic";
const TABS: BriefpapierTab[] = ["briefpapier", "layouts", "druckoptionen"];

/**
 * Briefpapier-Seite (Phase 11b, Task 7): buendelt drei vormals getrennte Bereiche unter
 * einem SettingsTabs-Eintrag ("Briefpapier") mit eigenen Unter-Reitern (`BriefpapierTabs`,
 * `?tab=`): Briefpapier (Logo/Farbe/Fußzeile), Layouts (Galerie mit Live-Vorschau, Auswahl
 * je Belegtyp) und Druckoptionen (globale Schalter, vormals `/einstellungen/druckoptionen`
 * — diese Route leitet jetzt hierher um).
 */
export default async function BriefpapierPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  const active: BriefpapierTab = TABS.includes(tab as BriefpapierTab) ? (tab as BriefpapierTab) : "briefpapier";
  if (tab && tab !== active) redirect("/einstellungen/briefpapier");
  const org = await getActiveOrg();
  const [branding, print] = await Promise.all([loadBrandingSettings(org.id), loadPrintSettings(org.id)]);
  return (
    <div className="space-y-6">
      <SettingsTabs active="briefpapier" />
      <PageHeader title="Briefpapier" subtitle="Layout, Logo, Farben und Druckoptionen für alle Belege." />
      <BriefpapierTabs active={active} />
      {active === "briefpapier" && <BrandingForm initial={branding} />}
      {active === "layouts" && <LayoutGallery initial={branding} layouts={listLayouts()} />}
      {active === "druckoptionen" && <PrintSettingsForm initial={print} />}
    </div>
  );
}
