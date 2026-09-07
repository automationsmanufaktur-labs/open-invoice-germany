import { NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org";
import { sendTestDelivery } from "@/domain/webhook/actions";
import { NotFoundError } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const org = await getActiveOrg();
    const result = await sendTestDelivery(org.id, id);
    return NextResponse.json({ delivery: result.delivery, attempt: result.attempt });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    console.error("POST /api/webhooks/[id]/test:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
