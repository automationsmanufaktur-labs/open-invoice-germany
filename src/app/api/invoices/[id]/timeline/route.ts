import { NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org";
import { dbInternal } from "@/lib/db";
import { buildTimeline } from "@/domain/timeline/build";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Task 4: `GET /api/invoices/[id]/timeline` — fuer `DocumentTimeline.tsx` auf der Detailseite. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const org = await getActiveOrg();
    // Org-Zugehoerigkeit VOR buildTimeline pruefen — die Timeline-Bausteine
    // (Payment/Dunning) filtern nur auf die Beleg-ID, nicht zusaetzlich auf orgId.
    const exists = await dbInternal.invoice.findFirst({ where: { id, orgId: org.id }, select: { id: true } });
    if (!exists) return NextResponse.json({ error: "Rechnung nicht gefunden." }, { status: 404 });
    const entries = await buildTimeline(org.id, { kind: "INVOICE", id }, new Date());
    return NextResponse.json({ entries });
  } catch (e) {
    console.error("GET /api/invoices/[id]/timeline:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
