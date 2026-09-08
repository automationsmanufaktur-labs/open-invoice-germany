/**
 * Cron-Endpunkt: fuehrt nur den Mahn-Job aus (Phase 6, Task 3). Auth-Muster identisch zu
 * `/api/cron/run-recurring` (CRON_SECRET als Bearer-Header oder `?secret=`).
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
    const [result] = await runScheduledJobs({ jobs: ["dunning"], trigger: "CRON" });
    if (!result) {
      console.error("cron/run-dunning: Job nicht ausgefuehrt");
      return NextResponse.json({ error: "Lauf fehlgeschlagen." }, { status: 500 });
    }
    if (!result.ok) {
      console.error("cron/run-dunning:", result.error);
      return NextResponse.json({ error: "Lauf fehlgeschlagen." }, { status: 500 });
    }
    return NextResponse.json({ ok: true, runId: result.runId, ...result.summary });
  } catch (e) {
    console.error("cron/run-dunning:", e);
    return NextResponse.json({ error: "Lauf fehlgeschlagen." }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
