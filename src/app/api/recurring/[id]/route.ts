import { NextResponse } from "next/server";
import { z } from "zod";
import { updateRecurringStatusSchema } from "@/schemas";
import { getActiveOrg } from "@/lib/org";
import { dbInternal } from "@/lib/db";

export const runtime = "nodejs";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const org = await getActiveOrg();
    const { status } = updateRecurringStatusSchema.parse(await req.json());
    const updated = await dbInternal.recurringInvoice.updateMany({
      where: { id, orgId: org.id },
      data: { status },
    });
    if (updated.count === 0) return NextResponse.json({ error: "Abo nicht gefunden." }, { status: 404 });
    return NextResponse.json({ id, status });
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: "Ungültiger Status." }, { status: 400 });
    console.error("PATCH /api/recurring/[id]:", e);
    return NextResponse.json({ error: "Abo konnte nicht geändert werden." }, { status: 400 });
  }
}
