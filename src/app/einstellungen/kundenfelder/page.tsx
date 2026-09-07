import { getActiveOrg } from "@/lib/org";
import { SettingsTabs } from "@/components/SettingsTabs";
import { listCustomFieldDefinitions } from "@/domain/customer/custom-fields";
import { CustomFieldsEditor } from "@/components/customers/CustomFieldsEditor";

export const dynamic = "force-dynamic";

export default async function KundenfelderSettingsPage() {
  const org = await getActiveOrg();
  const definitions = await listCustomFieldDefinitions(org.id);

  return (
    <div className="space-y-6">
      <SettingsTabs active="kundenfelder" />
      <h1 className="text-2xl font-bold tracking-tight">Kundenfelder</h1>
      <p className="text-sm text-slate-600">
        Benutzerdefinierte Felder je Kunde (§31) — als Platzhalter <code>customField.&lt;Schlüssel&gt;</code> in Vorlagen verfügbar.
      </p>
      <CustomFieldsEditor
        initialDefinitions={definitions.map((d) => ({ ...d, type: d.type as "TEXT" | "NUMBER" | "DATE" | "BOOLEAN" | "SELECT" }))}
      />
    </div>
  );
}
