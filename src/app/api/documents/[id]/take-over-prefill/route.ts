import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrg } from "@/lib/org";
import { buildTakeOverPrefill } from "@/domain/document/take-over";
import { NotFoundError, InvalidOperationError } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const optsSchema = z.object({
  lines: z.boolean().default(true),
  texts: z.boolean().default(true),
  terms: z.boolean().default(true),
  prices: z.boolean().default(true),
});

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

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const org = await getActiveOrg();
    const body = await req.json().catch(() => ({}));
    const opts = optsSchema.parse(body);
    const prefill = await buildTakeOverPrefill(org.id, id, opts);
    return NextResponse.json({ prefill });
  } catch (e) {
    return mapError(e, "POST /api/documents/[id]/take-over-prefill:");
  }
}
