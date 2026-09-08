import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrg } from "@/lib/org";
import { updateAddress, deleteAddress } from "@/domain/customer/addresses";
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

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; addressId: string }> }) {
  const { id, addressId } = await ctx.params;
  try {
    const org = await getActiveOrg();
    const body = await req.json();
    const address = await updateAddress(org.id, id, addressId, body);
    return NextResponse.json({ address });
  } catch (e) {
    return mapError(e, "PATCH /api/customers/[id]/addresses/[addressId]:");
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; addressId: string }> }) {
  const { id, addressId } = await ctx.params;
  try {
    const org = await getActiveOrg();
    await deleteAddress(org.id, id, addressId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return mapError(e, "DELETE /api/customers/[id]/addresses/[addressId]:");
  }
}
