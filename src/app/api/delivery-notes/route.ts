import { NextResponse } from "next/server";
import { z } from "zod";
import { createDeliveryNoteSchema } from "@/schemas";
import { createDeliveryNote, DeliveryNoteError, DeliveryNoteValidationError } from "@/domain/delivery-note/create";
import { listDeliveryNotes } from "@/domain/document/list";
import { getActiveOrg } from "@/lib/org";
import { getCurrentUserId } from "@/lib/auth/server";
import { parseListQuery } from "@/lib/list-query";

export const runtime = "nodejs";

/** Phase 8b, Task 2 (§40): Lieferscheinliste mit Filter/Suche/Paginierung (listDeliveryNotes, Task 1). */
export async function GET(req: Request) {
  try {
    const org = await getActiveOrg();
    const { searchParams } = new URL(req.url);
    const raw = parseListQuery(searchParams);
    const result = await listDeliveryNotes(org.id, raw);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Ungültiger Filter.", issues: e.issues }, { status: 400 });
    }
    console.error("GET /api/delivery-notes:", e);
    return NextResponse.json({ error: "Lieferscheine konnten nicht geladen werden." }, { status: 500 });
  }
}

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
    if (e instanceof DeliveryNoteValidationError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    if (e instanceof DeliveryNoteError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    console.error("POST /api/delivery-notes:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
