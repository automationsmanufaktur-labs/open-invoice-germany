import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrg } from "@/lib/org";
import { getCurrentUserId } from "@/lib/auth/server";
import { getWebhookEndpoint, updateWebhookEndpoint } from "@/domain/webhook/endpoints";
import { NotFoundError } from "@/domain/errors";
import { SsrfBlockedError } from "@/domain/webhook/ssrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const org = await getActiveOrg();
    const endpoint = await getWebhookEndpoint(org.id, id);
    return NextResponse.json({ endpoint });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    console.error("GET /api/webhooks/[id]:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const org = await getActiveOrg();
    const userId = await getCurrentUserId();
    const body = await req.json();
    const updated = await updateWebhookEndpoint(org.id, id, body, { actor: userId ?? "system" });
    return NextResponse.json({ endpoint: updated });
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: e.message }, { status: 404 });
    if (e instanceof z.ZodError) return NextResponse.json({ error: "Validierung fehlgeschlagen", issues: e.issues }, { status: 400 });
    if (e instanceof SsrfBlockedError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("PATCH /api/webhooks/[id]:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
