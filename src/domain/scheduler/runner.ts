/**
 * Scheduler-Runner (Phase 6, Task 3) — fuehrt die registrierten Jobs (`jobs.ts`) seriell in
 * fester Reihenfolge (`recurring` -> `dunning` -> `notifications`) aus und protokolliert jeden Lauf in
 * `SchedulerRun`. Wird sowohl vom Intervall-Loop (`loop.ts`/`instrumentation.ts`) als auch
 * von den Cron-Routen, der manuellen API-Route und den CLI-Skripten aufgerufen — EINE
 * Implementierung, kein zweiter Ausfuehrungspfad.
 *
 * Lock (Fix Runde 1): ausschliesslich ueber den Unique-Constraint von `SchedulerLock.job`
 * (Primaerschluessel). Die vorherige Praxis — `SchedulerRun.findFirst({status:"RUNNING"})`
 * gefolgt von `create` — war unter Postgres READ COMMITTED NICHT atomar: zwei gleichzeitige
 * Laeufe konnten beide die Lesepruefung passieren, bevor einer schrieb. `schedulerLock.create`
 * schlaegt bei bereits bestehendem Lock stattdessen mit einer Unique-Constraint-Verletzung
 * (Prisma P2002) fehl — DAS ist die tatsaechliche, atomare Entscheidung, nicht die
 * vorgelagerte Pruefung. Ein `RUNNING`-Eintrag desselben Jobs, dessen Lock aelter als 30
 * Minuten ist ("stale"), wird VOR dem Erwerbsversuch entfernt (Lock geloescht, zugehoeriger
 * `SchedulerRun` auf FAILED("stale") gesetzt); danach laeuft der Job normal. Der Lock wird
 * im `finally` freigegeben (geloescht ueber `job` + `runId`, damit ein inzwischen neu
 * erworbener Lock desselben Jobs nicht versehentlich mitgeloescht wird). Ein Fehler in einem
 * Job bricht die anderen Jobs NICHT ab (try/catch je Job in der Schleife).
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { dbInternal } from "@/lib/db";
import { jobs } from "./jobs";

export type SchedulerJob = "dunning" | "recurring" | "notifications";

export interface JobResult {
  job: SchedulerJob;
  ok: boolean;
  summary: Record<string, unknown>;
  error?: string;
  /** Id des `SchedulerRun`-Eintrags (fehlt nur bei `summary.skipped === "locked"`). */
  runId?: string;
}

// Reihenfolge (Task-3-Facts): recurring -> dunning -> notifications — Benachrichtigungen
// (faellig/ueberfaellig/Mahnstufe) sollen den Stand NACH den beiden vorgelagerten Jobs
// desselben Laufs widerspiegeln (frisch erzeugte Abo-Rechnungen/Mahnungen).
const JOB_ORDER: SchedulerJob[] = ["recurring", "dunning", "notifications"];
const STALE_MS = 30 * 60 * 1000;

export interface RunScheduledJobsOptions {
  jobs?: SchedulerJob[];
  trigger: "SCHEDULER" | "CRON" | "MANUAL";
  now?: Date;
}

function isUniqueConstraintError(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/** Entfernt einen "stale" Lock (aelter als 30 Min) VOR dem Erwerbsversuch und markiert den
 *  zugehoerigen SchedulerRun-Eintrag als FAILED("stale") — wie zuvor, nur jetzt am Lock statt
 *  am SchedulerRun-Status festgemacht. */
async function clearStaleLock(job: SchedulerJob, now: Date): Promise<void> {
  const threshold = new Date(now.getTime() - STALE_MS);
  const stale = await dbInternal.schedulerLock.findFirst({ where: { job, lockedAt: { lt: threshold } } });
  if (!stale) return;
  await dbInternal.schedulerRun.updateMany({
    where: { id: stale.runId, status: "RUNNING" },
    data: { status: "FAILED", error: "stale", finishedAt: now },
  });
  await dbInternal.schedulerLock.deleteMany({ where: { job, runId: stale.runId } });
}

export async function runScheduledJobs(opts: RunScheduledJobsOptions): Promise<JobResult[]> {
  const now = opts.now ?? new Date();
  const wanted = opts.jobs ? new Set(opts.jobs) : null;
  const order = JOB_ORDER.filter((j) => !wanted || wanted.has(j));

  const results: JobResult[] = [];
  for (const job of order) {
    await clearStaleLock(job, now);

    const runId = randomUUID();
    try {
      await dbInternal.schedulerLock.create({ data: { job, runId, lockedAt: now } });
    } catch (e) {
      if (isUniqueConstraintError(e)) {
        results.push({ job, ok: true, summary: { skipped: "locked" } });
        continue;
      }
      throw e;
    }

    try {
      const entry = await dbInternal.schedulerRun.create({
        data: { id: runId, job, trigger: opts.trigger, status: "RUNNING", startedAt: now },
      });

      try {
        const summary = await jobs[job](now);
        // Nit (Fix-Welle): finishedAt war bisher `now` (= startedAt) — die Spalte
        // "Beendet" in SchedulerRunsTable zeigte damit immer die Startzeit, eine
        // Laufzeit war nicht ablesbar. `new Date()` = tatsaechlicher Abschlusszeitpunkt.
        await dbInternal.schedulerRun.update({
          where: { id: entry.id },
          data: { status: "OK", finishedAt: new Date(), summaryJson: JSON.stringify(summary) },
        });
        results.push({ job, ok: true, summary, runId: entry.id });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await dbInternal.schedulerRun.update({
          where: { id: entry.id },
          data: { status: "FAILED", finishedAt: new Date(), error: message },
        });
        results.push({ job, ok: false, summary: {}, error: message, runId: entry.id });
      }
    } finally {
      await dbInternal.schedulerLock.deleteMany({ where: { job, runId } });
    }
  }
  return results;
}
