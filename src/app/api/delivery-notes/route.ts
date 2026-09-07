import { NextResponse } from "next/server";
import { z } from "zod";
import { createDeliveryNoteSchema } from "@/schemas";
import { createDeliveryNote, DeliveryNoteError } from "@/domain/delivery-note/create";
import { getActiveOrg } from "@/lib/org";
import { getCurrentUserId } from "@/lib/auth/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const org = await getActiveOrg();
    const actor = (await getCurrentUserId()) ?? "system";
    const input = createDeliveryNoteSchema.parse(await req.json());
    const note = await createDeliveryNote(org.id, input, { actor });
    return NextResponse.json({ id: note.id, number: note.number, status: note.status }, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Validierung fehlgeschlagen", issues: e.issues }, { status: 400 });
    }
    if (e instanceof DeliveryNoteError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    console.error("POST /api/delivery-notes:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
