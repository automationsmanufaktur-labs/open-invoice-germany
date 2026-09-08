import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrg } from "@/lib/org";
import { getCurrentUserId } from "@/lib/auth/server";
import { listApiKeys } from "@/domain/api-key/list";
import { createApiKey } from "@/domain/api-key/create";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const org = await getActiveOrg();
  const { rows: keys } = await listApiKeys(org.id, { limit: 1000, offset: 0 });
  return NextResponse.json({ keys });
}

export async function POST(req: Request) {
  try {
    const org = await getActiveOrg();
    const userId = await getCurrentUserId();
    const body = await req.json();
    const key = await createApiKey(org.id, body, userId);
    // Token nur hier, einmalig — die Liste (GET) liefert es nie wieder.
    return NextResponse.json({ key }, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Validierung fehlgeschlagen", issues: e.issues }, { status: 400 });
    }
    console.error("POST /api/api-keys:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
