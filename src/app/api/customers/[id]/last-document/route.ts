import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrg } from "@/lib/org";
import { findLastDocumentForCustomer, type TakeOverDocumentKind } from "@/domain/document/take-over";
import { NotFoundError, InvalidOperationError } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const kindSchema = z.enum(["INVOICE", "QUOTE", "ORDER_CONFIRMATION"]);

function mapError(e: unknown, routeLabel: string) {
  if (e instanceof z.ZodError) {
    return NextResponse.json({ error: "Validierung fehlgeschlagen", issues: e.issues }, { status: 400 });
  }
  if (e instanceof NotFoundError) {
    return NextResponse.json({ error: e.message }, { status: 404 });
  }
  if (e instanceof InvalidOperationError) {
    return NextResponse.json({ error: e.message }, { status: 409 });
  }
  console.error(routeLabel, e);
  return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const org = await getActiveOrg();
    const url = new URL(req.url);
    const kind = kindSchema.parse(url.searchParams.get("kind"));
    const document = await findLastDocumentForCustomer(org.id, id, kind as TakeOverDocumentKind);
    return NextResponse.json({ document });
  } catch (e) {
    return mapError(e, "GET /api/customers/[id]/last-document:");
  }
}
