import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrg } from "@/lib/org";
import { updateContact, deleteContact } from "@/domain/customer/contacts";
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

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; contactId: string }> }) {
  const { id, contactId } = await ctx.params;
  try {
    const org = await getActiveOrg();
    const body = await req.json();
    const contact = await updateContact(org.id, id, contactId, body);
    return NextResponse.json({ contact });
  } catch (e) {
    return mapError(e, "PATCH /api/customers/[id]/contacts/[contactId]:");
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; contactId: string }> }) {
  const { id, contactId } = await ctx.params;
  try {
    const org = await getActiveOrg();
    await deleteContact(org.id, id, contactId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return mapError(e, "DELETE /api/customers/[id]/contacts/[contactId]:");
  }
}
