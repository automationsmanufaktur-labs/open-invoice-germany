import { NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org";
import { listWebhookDeliveries } from "@/domain/webhook/actions";
import { NotFoundError } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const org = await getActiveOrg();
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") as "PENDING" | "DELIVERED" | "FAILED" | "DEAD" | null;
    const limitParam = searchParams.get("limit");
    const offsetParam = searchParams.get("offset");
    const result = await listWebhookDeliveries(org.id, id, {
      status: status ?? undefined,
      limit: limitParam ? Number(limitParam) : undefined,
      offset: offsetParam ? Number(offsetParam) : undefined,
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    console.error("GET /api/webhooks/[id]/deliveries:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
