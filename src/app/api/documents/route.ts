import { NextResponse } from "next/server";
import { z } from "zod";
import { createDocumentSchema } from "@/schemas";
import { createBusinessDocument } from "@/domain/document/create";
import { listQuotes } from "@/domain/document/list";
import { getActiveOrg } from "@/lib/org";
import { parseListQuery } from "@/lib/list-query";

export const runtime = "nodejs";

/**
 * Phase 8b, Task 2 (§40): Liste der Angebote/Auftragsbestaetigungen/Proforma-Rechnungen
 * (listQuotes, Task 1) — `status=EXPIRED` uebersetzt die Domain-Funktion bereits in
 * "DRAFT/SENT mit verstrichenem validUntil" (kein eigener Rohstatus).
 */
export async function GET(req: Request) {
  try {
    const org = await getActiveOrg();
    const { searchParams } = new URL(req.url);
    const raw = parseListQuery(searchParams);
    const result = await listQuotes(org.id, raw);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Ungültiger Filter.", issues: e.issues }, { status: 400 });
    }
    console.error("GET /api/documents:", e);
    return NextResponse.json({ error: "Dokumente konnten nicht geladen werden." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const org = await getActiveOrg();
    const input = createDocumentSchema.parse(await req.json());
    const doc = await createBusinessDocument(org.id, input);
    return NextResponse.json({ id: doc.id, number: doc.number, kind: doc.kind }, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Validierung fehlgeschlagen", issues: e.issues }, { status: 400 });
    }
    console.error("POST /api/documents:", e);
    return NextResponse.json({ error: "Dokument konnte nicht angelegt werden. Bitte Eingaben prüfen." }, { status: 400 });
  }
}
