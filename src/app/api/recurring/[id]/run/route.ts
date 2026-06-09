import { NextResponse } from "next/server";
import { emitRecurringNow } from "@/domain/recurring/run";
import { RecurringError } from "@/domain/recurring/create";
import { getActiveOrg } from "@/lib/org";
import { dbInternal } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const org = await getActiveOrg();
    const rec = await dbInternal.recurringInvoice.findFirst({ where: { id, orgId: org.id }, select: { id: true } });
    if (!rec) return NextResponse.json({ error: "Abo nicht gefunden." }, { status: 404 });
    const res = await emitRecurringNow(id);
    return NextResponse.json({ invoiceId: res.invoiceId, number: res.number, finalized: res.finalized });
  } catch (e) {
    if (e instanceof RecurringError) return NextResponse.json({ error: e.message }, { status: 422 });
    console.error("POST /api/recurring/[id]/run:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
