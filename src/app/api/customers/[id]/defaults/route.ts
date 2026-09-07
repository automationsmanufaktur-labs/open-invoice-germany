import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrg } from "@/lib/org";
import { saveCustomerDefaults, customerDefaultsFor } from "@/domain/customer/defaults";
import { NotFoundError, InvalidOperationError } from "@/domain/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const org = await getActiveOrg();
    const defaults = await customerDefaultsFor(org.id, id);
    return NextResponse.json({ defaults });
  } catch (e) {
    return mapError(e, "GET /api/customers/[id]/defaults:");
  }
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const org = await getActiveOrg();
    const body = await req.json();
    await saveCustomerDefaults(org.id, id, body);
    const defaults = await customerDefaultsFor(org.id, id);
    return NextResponse.json({ defaults });
  } catch (e) {
    return mapError(e, "PUT /api/customers/[id]/defaults:");
  }
}
