import { getActiveOrg } from "@/lib/org";
import { loadDocumentSettings } from "@/domain/document/settings";
import { listPaymentMethods } from "@/domain/payment-method/manage";
import { SettingsTabs } from "@/components/SettingsTabs";
import { DocumentSettingsForm } from "@/components/forms/DocumentSettingsForm";

export const dynamic = "force-dynamic";

export default async function BelegSettingsPage() {
  const org = await getActiveOrg();
  const [settings, methods] = await Promise.all([loadDocumentSettings(org.id), listPaymentMethods(org.id)]);
  const paymentMethods = methods.filter((m) => m.isActive).map((m) => ({ id: m.id, name: m.name }));

  return (
    <div className="space-y-6">
      <SettingsTabs active="belege" />
      <h1 className="text-2xl font-bold tracking-tight">Belege</h1>
      <p className="text-sm text-slate-600">
        Org-weite Vorgaben für neue Angebote, Rechnungen, Lieferscheine und wiederkehrende Rechnungen sowie die Online-Annahme von Angeboten.
      </p>

      <DocumentSettingsForm settings={settings} paymentMethods={paymentMethods} />
    </div>
  );
}
