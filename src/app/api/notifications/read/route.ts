import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrg } from "@/lib/org";
import { markRead } from "@/domain/notifications/create";

export const runtime = "nodejs";

const bodySchema = z.object({
  ids: z.array(z.string().min(1)).optional(),
  all: z.boolean().optional(),
});

/** Task 4: `POST /api/notifications/read` — `{ ids: [...] }` oder `{ all: true }`. */
export async function POST(req: Request) {
  try {
    const org = await getActiveOrg();
    const input = bodySchema.parse(await req.json());
    const count = await markRead(org.id, input);
    return NextResponse.json({ count });
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: "Validierung fehlgeschlagen", issues: e.issues }, { status: 400 });
    console.error("POST /api/notifications/read:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
