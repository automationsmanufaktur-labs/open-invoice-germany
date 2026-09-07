/**
 * Manueller Scheduler-Anstoss aus dem UI (Phase 6, Task 3, "Einstellungen -> Automatisierung").
 * Anders als die Cron-Routen (CRON_SECRET) session-geschuetzt: nur angemeldete Nutzer duerfen
 * einen Lauf manuell ausloesen. Optionaler Body `{ jobs?: ("dunning"|"recurring")[] }`
 * schraenkt auf einzelne Jobs ein (Default: beide, feste Reihenfolge recurring -> dunning).
 */
import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth/server";
import { runScheduledJobs, type SchedulerJob } from "@/domain/scheduler/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_JOBS: SchedulerJob[] = ["dunning", "recurring"];

function parseJobs(value: unknown): SchedulerJob[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const jobs = value.filter((j): j is SchedulerJob => VALID_JOBS.includes(j as SchedulerJob));
  return jobs.length > 0 ? jobs : undefined;
}

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });

  try {
    let jobs: SchedulerJob[] | undefined;
    const bodyText = await req.text();
    if (bodyText) {
      const body: unknown = JSON.parse(bodyText);
      if (body && typeof body === "object" && "jobs" in body) {
        jobs = parseJobs((body as { jobs?: unknown }).jobs);
      }
    }

    const results = await runScheduledJobs({ jobs, trigger: "MANUAL" });
    const ok = results.every((r) => r.ok);
    return NextResponse.json({ ok, results }, { status: ok ? 200 : 207 });
  } catch (e) {
    console.error("POST /api/scheduler/run:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
