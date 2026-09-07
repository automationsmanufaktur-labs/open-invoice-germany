import { NextResponse } from "next/server";
import { z } from "zod";
import { createInvoiceSchema } from "@/schemas";
import { createDraftInvoice } from "@/domain/invoice/create";
import { listInvoices } from "@/domain/invoice/list";
import { getActiveOrg } from "@/lib/org";
import { parseListQuery } from "@/lib/list-query";

export const runtime = "nodejs";

/**
 * Phase 8b, Task 2 (§40): Rechnungsliste mit Filter/Suche/Paginierung — Zod-Validierung
 * ausschliesslich ueber `listInvoices` (invoiceListFilterSchema, Task 1), keine
 * Bypass-Pfade. `eInvoice` traegt bewusst kein `.coerce` (echter Boolean-Filter, siehe
 * Schema-Kommentar) und wird daher hier explizit uebersetzt.
 */
export async function GET(req: Request) {
  try {
    const org = await getActiveOrg();
    const { searchParams } = new URL(req.url);
    const raw = parseListQuery(searchParams, ["eInvoice"]);
    const result = await listInvoices(org.id, raw);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Ungültiger Filter.", issues: e.issues }, { status: 400 });
    }
    console.error("GET /api/invoices:", e);
    return NextResponse.json({ error: "Rechnungen konnten nicht geladen werden." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const org = await getActiveOrg();
    const body = await req.json();
    const input = createInvoiceSchema.parse(body);
    const invoice = await createDraftInvoice(org.id, input);
    return NextResponse.json({ id: invoice.id, status: invoice.status }, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Validierung fehlgeschlagen", issues: e.issues }, { status: 400 });
    }
    console.error("POST /api/invoices:", e);
    return NextResponse.json({ error: "Rechnung konnte nicht angelegt werden. Bitte Eingaben prüfen." }, { status: 400 });
  }
}
