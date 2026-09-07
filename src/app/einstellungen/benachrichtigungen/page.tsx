import { getActiveOrg } from "@/lib/org";
import { SettingsTabs } from "@/components/SettingsTabs";
import { NotificationSettingsForm } from "@/components/settings/NotificationSettingsForm";
import { loadNotificationSettings, NOTIFICATION_TYPES } from "@/domain/notifications/settings";

export const dynamic = "force-dynamic";

export default async function BenachrichtigungenEinstellungenPage() {
  const org = await getActiveOrg();
  const settings = await loadNotificationSettings(org.id);

  return (
    <div className="space-y-6">
      <SettingsTabs active="benachrichtigungen" />
      <h1 className="text-2xl font-bold tracking-tight">Benachrichtigungen</h1>
      <p className="text-sm text-slate-600">
        Steuert, welche Ereignisse In-App-Benachrichtigungen erzeugen (Glocke oben rechts, „/benachrichtigungen“). Der Scheduler-Job „notifications“ prüft dies bei jedem Lauf (siehe Einstellungen →
        Automatisierung).
      </p>
      <NotificationSettingsForm allTypes={Object.entries(NOTIFICATION_TYPES)} initial={{ enabledTypes: settings.enabledTypes, emailDigest: settings.emailDigest }} />
    </div>
  );
}
