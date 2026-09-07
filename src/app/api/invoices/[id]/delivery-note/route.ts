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
    // toKind ist an dieser Route immer DELIVERY_NOTE — der Aufrufer schickt es nicht mit.
    const withDefault = { toKind: "DELIVERY_NOTE", ...(typeof raw === "object" && raw !== null ? raw : {}) };
    const body = convertDocumentBodySchema.parse(withDefault);

    const result = await convertDocument(
      org.id,
      { fromType: "INVOICE", fromId: id, toKind: "DELIVERY_NOTE", quantities: body.quantities, deliveryDate: body.deliveryDate },
      { actor },
    );
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Validierung fehlgeschlagen", issues: e.issues }, { status: 400 });
    }
    if (e instanceof ConvertError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    console.error("POST /api/invoices/[id]/delivery-note:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
