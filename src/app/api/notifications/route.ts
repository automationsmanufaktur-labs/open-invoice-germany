import { NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org";
import { listNotifications } from "@/domain/notifications/create";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Task 4: `GET /api/notifications?unreadOnly=1&limit=10` — letzte Benachrichtigungen. */
export async function GET(req: Request) {
  try {
    const org = await getActiveOrg();
    const { searchParams } = new URL(req.url);
    const unreadOnly = searchParams.get("unreadOnly") === "1" || searchParams.get("unreadOnly") === "true";
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 50, 1), 200) : undefined;
    const notifications = await listNotifications(org.id, { unreadOnly, limit });
    return NextResponse.json({ notifications });
  } catch (e) {
    console.error("GET /api/notifications:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
