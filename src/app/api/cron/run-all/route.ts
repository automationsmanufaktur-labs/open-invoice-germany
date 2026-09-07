/**
 * Cron-Endpunkt: fuehrt beide Scheduler-Jobs seriell aus (recurring -> dunning, Phase 6,
 * Task 3). Auth-Muster identisch zu `/api/cron/run-recurring`.
 */
import { NextResponse } from "next/server";
import { runScheduledJobs } from "@/domain/scheduler/runner";
import { checkCronAuth } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(req: Request) {
  const auth = checkCronAuth(req);
  if (auth === "unset") return NextResponse.json({ error: "CRON_SECRET nicht gesetzt" }, { status: 503 });
  if (auth === "unauthorized") return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  try {
    const results = await runScheduledJobs({ trigger: "CRON" });
    const ok = results.every((r) => r.ok);
    if (!ok) console.error("cron/run-all:", results.filter((r) => !r.ok).map((r) => r.error));
    // Fehlertext generisch nach aussen (Details nur im Log/SchedulerRun), Summary bleibt.
    const safeResults = results.map((r) => ({ job: r.job, ok: r.ok, runId: r.runId, summary: r.summary, ...(r.ok ? {} : { error: "Lauf fehlgeschlagen." }) }));
    return NextResponse.json({ ok, results: safeResults }, { status: ok ? 200 : 207 });
  } catch (e) {
    console.error("cron/run-all:", e);
    return NextResponse.json({ error: "Lauf fehlgeschlagen." }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
