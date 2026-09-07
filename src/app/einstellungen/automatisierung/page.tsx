import { getActiveOrg } from "@/lib/org";
import { SettingsTabs } from "@/components/SettingsTabs";
import { dbInternal } from "@/lib/db";
import { SchedulerRunsTable } from "@/components/scheduler/SchedulerRunsTable";

export const dynamic = "force-dynamic";

// SchedulerRun laeuft bewusst ohne orgId (Scheduler verarbeitet alle Organisationen
// seriell in einem Lauf, Task 1/3) — die Seite zeigt daher das globale Protokoll, nicht
// nur die Laeufe der aktiven Organisation.
export default async function AutomatisierungPage() {
  await getActiveOrg();
  const runs = await dbInternal.schedulerRun.findMany({ orderBy: { startedAt: "desc" }, take: 50 });

  return (
    <div className="space-y-6">
      <SettingsTabs active="automatisierung" />
      <h1 className="text-2xl font-bold tracking-tight">Automatisierung</h1>
      <p className="text-sm text-slate-600">
        Der Scheduler prüft automatisch fällige Mahnungen, wiederkehrende Rechnungen und erzeugt In-App-Benachrichtigungen (Job „notifications“ — fällige/überfällige Rechnungen, Mahnstufen, ablaufende Angebote
        usw., siehe Einstellungen → Benachrichtigungen; Standardintervall siehe Umgebungsvariablen). Hier lässt sich ein Lauf manuell anstoßen und das Protokoll der letzten Läufe einsehen.
      </p>
      <SchedulerRunsTable
        initialRuns={runs.map((r) => ({
          id: r.id,
          job: r.job,
          trigger: r.trigger,
          status: r.status,
          startedAt: r.startedAt.toISOString(),
          finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
          summaryJson: r.summaryJson,
          error: r.error,
        }))}
      />
    </div>
  );
}
