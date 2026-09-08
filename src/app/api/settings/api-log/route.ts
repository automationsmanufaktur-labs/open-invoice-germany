import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrg } from "@/lib/org";
import { listApiRequestLogs } from "@/domain/api-log/list";
import { clearApiRequestLogs } from "@/domain/api-log/purge";
import { loadApiSettings, saveApiSettings } from "@/domain/api-log/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const org = await getActiveOrg();
    const { searchParams } = new URL(req.url);
    const [{ rows, total, limit, offset }, settings] = await Promise.all([
      listApiRequestLogs(org.id, Object.fromEntries(searchParams)),
      loadApiSettings(org.id),
    ]);
    return NextResponse.json({ rows, total, limit, offset, settings });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Validierung fehlgeschlagen", issues: e.issues }, { status: 400 });
    }
    console.error("GET /api/settings/api-log:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const org = await getActiveOrg();
    const body: unknown = await req.json();
    const settings = await saveApiSettings(org.id, body);
    return NextResponse.json({ settings });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Validierung fehlgeschlagen", issues: e.issues }, { status: 400 });
    }
    console.error("PUT /api/settings/api-log:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const org = await getActiveOrg();
    const deleted = await clearApiRequestLogs(org.id);
    return NextResponse.json({ deleted });
  } catch (e) {
    console.error("DELETE /api/settings/api-log:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
