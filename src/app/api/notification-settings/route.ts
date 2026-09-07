import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrg } from "@/lib/org";
import { loadNotificationSettings, saveNotificationSettings, ALL_NOTIFICATION_TYPES } from "@/domain/notifications/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const org = await getActiveOrg();
  const settings = await loadNotificationSettings(org.id);
  return NextResponse.json({ settings });
}

const putSchema = z.object({
  enabledTypes: z.array(z.enum(ALL_NOTIFICATION_TYPES as [string, ...string[]])),
  emailDigest: z.boolean(),
});

export async function PUT(req: Request) {
  try {
    const org = await getActiveOrg();
    const body = putSchema.parse(await req.json());
    const settings = await saveNotificationSettings(org.id, body as { enabledTypes: typeof ALL_NOTIFICATION_TYPES; emailDigest: boolean });
    return NextResponse.json({ settings });
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: "Validierung fehlgeschlagen", issues: e.issues }, { status: 400 });
    console.error("PUT /api/notification-settings:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
