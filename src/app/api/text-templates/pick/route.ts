import { NextResponse } from "next/server";
import { z } from "zod";
import { textTemplatePickQuerySchema } from "@/schemas";
import { pickTextTemplate } from "@/domain/text-template/pick";
import { dbInternal } from "@/lib/db";
import { getActiveOrg } from "@/lib/org";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const org = await getActiveOrg();
    const { searchParams } = new URL(req.url);
    const query = textTemplatePickQuerySchema.parse({
      docType: searchParams.get("docType") ?? "",
      position: searchParams.get("position") ?? "",
    });
    const body = await pickTextTemplate(dbInternal, org.id, query.docType, query.position);
    return NextResponse.json({ body });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Validierung fehlgeschlagen", issues: e.issues }, { status: 400 });
    }
    console.error("GET /api/text-templates/pick:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
