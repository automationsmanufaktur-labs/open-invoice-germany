import { NextResponse } from "next/server";
import { z } from "zod";
import { convertDocumentBodySchema } from "@/schemas";
import { convertDocument, ConvertError } from "@/domain/document/convert";
import { getActiveOrg } from "@/lib/org";
import { getCurrentUserId } from "@/lib/auth/server";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const org = await getActiveOrg();
    const actor = (await getCurrentUserId()) ?? "system";

    let raw: unknown = {};
    const text = await req.text();
    if (text.trim() !== "") raw = JSON.parse(text);
    // Body optional: fehlt er oder ist er leer ({}), bleibt der alte ConvertButton-Aufruf
    // (In-Rechnung-Umwandeln ohne Body) kompatibel — toKind defaultet auf INVOICE, sofern
    // der Aufrufer keinen eigenen Wert mitschickt. fromType/fromId kommen aus der URL
    // (fromType immer QUOTE), nicht aus dem Body.
    const withDefault = { toKind: "INVOICE", ...(typeof raw === "object" && raw !== null ? raw : {}) };
    const body = convertDocumentBodySchema.parse(withDefault);

    const result = await convertDocument(
      org.id,
      { fromType: "QUOTE", fromId: id, toKind: body.toKind, quantities: body.quantities, deliveryDate: body.deliveryDate },
      { actor },
    );

    // invoiceId bleibt fuer Rueckwaertskompatibilitaet des alten ConvertButton-Aufrufs erhalten.
    return NextResponse.json({ type: result.type, id: result.id, invoiceId: result.type === "INVOICE" ? result.id : undefined });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Validierung fehlgeschlagen", issues: e.issues }, { status: 400 });
    }
    if (e instanceof ConvertError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    console.error("POST /api/documents/[id]/convert:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
