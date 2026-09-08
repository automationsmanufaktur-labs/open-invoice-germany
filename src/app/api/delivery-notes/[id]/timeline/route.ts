import { NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org";
import { dbInternal } from "@/lib/db";
import { buildTimeline } from "@/domain/timeline/build";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Task 4: `GET /api/delivery-notes/[id]/timeline`. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const org = await getActiveOrg();
    const exists = await dbInternal.deliveryNote.findFirst({ where: { id, orgId: org.id }, select: { id: true } });
    if (!exists) return NextResponse.json({ error: "Lieferschein nicht gefunden." }, { status: 404 });
    const entries = await buildTimeline(org.id, { kind: "DELIVERY_NOTE", id }, new Date());
    return NextResponse.json({ entries });
  } catch (e) {
    console.error("GET /api/delivery-notes/[id]/timeline:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
