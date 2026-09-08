import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrg } from "@/lib/org";
import { getCurrentUserId } from "@/lib/auth/server";
import { listWebhookEndpoints, createWebhookEndpoint } from "@/domain/webhook/endpoints";
import { SsrfBlockedError } from "@/domain/webhook/ssrf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const org = await getActiveOrg();
  const { rows: endpoints } = await listWebhookEndpoints(org.id);
  return NextResponse.json({ endpoints });
}

export async function POST(req: Request) {
  try {
    const org = await getActiveOrg();
    const userId = await getCurrentUserId();
    const body = await req.json();
    const created = await createWebhookEndpoint(org.id, body, { actor: userId ?? "system" });
    // Das Klartext-Secret ist NUR hier sichtbar (analog ApiKey-Token, Task 1).
    return NextResponse.json({ endpoint: created }, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Validierung fehlgeschlagen", issues: e.issues }, { status: 400 });
    }
    if (e instanceof SsrfBlockedError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("POST /api/webhooks:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
