import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrg } from "@/lib/org";
import { setDefaultContact } from "@/domain/customer/contacts";
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

export async function POST(_req: Request, ctx: { params: Promise<{ id: string; contactId: string }> }) {
  const { id, contactId } = await ctx.params;
  try {
    const org = await getActiveOrg();
    const contact = await setDefaultContact(org.id, id, contactId);
    return NextResponse.json({ contact });
  } catch (e) {
    return mapError(e, "POST /api/customers/[id]/contacts/[contactId]/default:");
  }
}
