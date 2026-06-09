import { NextResponse } from "next/server";
import { z } from "zod";
import { createRecurringSchema } from "@/schemas";
import { createRecurring, RecurringError } from "@/domain/recurring/create";
import { getActiveOrg } from "@/lib/org";
import { dbInternal } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const org = await getActiveOrg();
    const input = createRecurringSchema.parse(await req.json());
    const rec = await createRecurring(org.id, input);
    return NextResponse.json({ id: rec.id, title: rec.title, nextRunDate: rec.nextRunDate }, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Validierung fehlgeschlagen", issues: e.issues }, { status: 400 });
    }
    if (e instanceof RecurringError) return NextResponse.json({ error: e.message }, { status: 422 });
    console.error("POST /api/recurring:", e);
    return NextResponse.json({ error: "Abo konnte nicht angelegt werden." }, { status: 400 });
  }
}

export async function GET() {
  const org = await dbInternal.organization.findFirst();
  if (!org) return NextResponse.json([]);
  const recs = await dbInternal.recurringInvoice.findMany({
    where: { orgId: org.id },
    include: { customer: { select: { name: true } }, _count: { select: { invoices: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(recs);
}
