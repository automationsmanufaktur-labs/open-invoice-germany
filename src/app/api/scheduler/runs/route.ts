/**
 * Letzte 50 Scheduler-Laeufe (Phase 6, Task 3, "Einstellungen -> Automatisierung") —
 * session-geschuetzt wie `/api/scheduler/run`.
 */
import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/auth/server";
import { dbInternal } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });

  const runs = await dbInternal.schedulerRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ runs });
}
