import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrg } from "@/lib/org";
import { listCustomFieldDefinitions, upsertCustomFieldDefinition } from "@/domain/customer/custom-fields";
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

export async function GET() {
  const org = await getActiveOrg();
  const definitions = await listCustomFieldDefinitions(org.id);
  return NextResponse.json({ definitions });
}

export async function POST(req: Request) {
  try {
    const org = await getActiveOrg();
    const body = await req.json();
    const definition = await upsertCustomFieldDefinition(org.id, body);
    return NextResponse.json({ definition }, { status: 201 });
  } catch (e) {
    return mapError(e, "POST /api/custom-fields:");
  }
}
