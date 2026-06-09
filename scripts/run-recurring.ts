/**
 * CLI-Lauf der fälligen Abo-Rechnungen — für Self-Hosting per Cron/systemd-Timer
 * ohne laufenden Webserver:
 *
 *   npm run recurring:run
 *
 * Beispiel-Crontab (täglich 06:00):
 *   0 6 * * *  cd /pfad/zur/app && /usr/bin/npm run recurring:run >> recurring.log 2>&1
 */
import { runDueRecurring } from "../src/domain/recurring/run";
import { dbInternal } from "../src/lib/db";

async function main() {
  const summaries = await runDueRecurring();
  const total = summaries.reduce((n, s) => n + s.emitted.length, 0);
  if (total === 0) {
    console.log("Keine fälligen Abos.");
    return;
  }
  for (const s of summaries) {
    for (const e of s.emitted) {
      console.log(`${s.title}: Rechnung ${e.number ?? "(Entwurf " + e.invoiceId.slice(0, 8) + ")"} — Periode ${e.periodDate.toISOString().slice(0, 10)}`);
    }
  }
  console.log(`Fertig: ${total} Rechnung(en) aus ${summaries.length} Abo(s) erzeugt.`);
}

main()
  .catch((e) => {
    console.error("Abo-Lauf fehlgeschlagen:", e);
    process.exitCode = 1;
  })
  .finally(() => dbInternal.$disconnect());
