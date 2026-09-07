import { NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org";
import { dbInternal } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const org = await getActiveOrg();
    const log = await dbInternal.emailLog.findFirst({ where: { id, orgId: org.id } });
    if (!log) return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });

    return NextResponse.json({
      ...log,
      to: JSON.parse(log.toJson) as string[],
      cc: JSON.parse(log.ccJson) as string[],
      bcc: JSON.parse(log.bccJson) as string[],
      attachments: JSON.parse(log.attachmentsJson) as { filename: string; size: number; sha256: string }[],
      warnings: JSON.parse(log.warningsJson) as string[],
    });
  } catch (e) {
    console.error("GET /api/emails/[id]:", e);
    return NextResponse.json({ error: "Laden fehlgeschlagen." }, { status: 500 });
  }
}
