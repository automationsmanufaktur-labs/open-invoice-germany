/**
 * CLI-Lauf des Scheduler-Runners — für Self-Hosting per Cron/systemd-Timer ohne laufenden
 * Webserver (Phase 6, Task 3), analog `scripts/run-recurring.ts`.
 *
 *   npm run dunning:run      -- nur Job "dunning"
 *   npm run scheduler:run    -- beide Jobs (recurring -> dunning), entspricht dem Loop-Lauf
 *
 * Beispiel-Crontab (täglich 07:00, nur Mahnwesen):
 *   0 7 * * *  cd /pfad/zur/app && /usr/bin/npm run dunning:run >> dunning.log 2>&1
 */
import { runScheduledJobs, type SchedulerJob } from "../src/domain/scheduler/runner";
import { dbInternal } from "../src/lib/db";

const all = process.argv.includes("--all");
const jobs: SchedulerJob[] | undefined = all ? undefined : ["dunning"];

async function main() {
  // Nit (Fix-Welle): ANLEITUNG.md dokumentiert dieses Skript als den Cron-Weg
  // (Crontab-Beispiel `npm run scheduler:run`) — trigger war bisher "MANUAL", im
  // SchedulerRun-Protokoll damit nicht mehr von einem UI-Klick zu unterscheiden.
  const results = await runScheduledJobs({ jobs, trigger: "CRON" });
  for (const r of results) {
    if (!r.ok) {
      console.error(`Job "${r.job}" fehlgeschlagen: ${r.error}`);
      continue;
    }
    console.log(`Job "${r.job}": ${JSON.stringify(r.summary)}`);
  }
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("Scheduler-Lauf fehlgeschlagen:", e);
    process.exitCode = 1;
  })
  .finally(() => dbInternal.$disconnect());
