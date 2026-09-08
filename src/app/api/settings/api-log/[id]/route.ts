import { NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org";
import { findApiRequestLog } from "@/domain/api-log/list";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const org = await getActiveOrg();
    const row = await findApiRequestLog(org.id, id);
    if (!row) return NextResponse.json({ error: "Nicht gefunden" }, { status: 404 });
    return NextResponse.json({ row });
  } catch (e) {
    console.error("GET /api/settings/api-log/[id]:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
