import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrg } from "@/lib/org";
import { loadPdfTheme } from "@/domain/settings/theme";
import { renderInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { renderDeliveryNotePdf } from "@/lib/pdf/delivery-note-pdf";
import { renderDunningPdf } from "@/lib/pdf/dunning-pdf";
import {
  buildSampleInvoiceData,
  buildSampleDeliveryNoteData,
  buildSampleDunningData,
  PREVIEW_DOC_TYPES,
  PREVIEW_DOC_TYPE_TO_LAYOUT_DOC_TYPE,
} from "@/domain/settings/preview";
import { layoutIdSchema } from "@/schemas/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Phase 11b, Task 6: `docType` deckt jetzt alle fuenf Layout-Belegtypen ab (INVOICE,
// CREDIT_NOTE, ANGEBOT, DELIVERY_NOTE, DUNNING); `layoutId` ist ein optionaler expliziter
// Layout-Override fuer die Vorschau (unabhaengig vom gespeicherten Organisations-/Typ-
// Layout) — ein unbekannter Wert wird von `layoutIdSchema` abgelehnt (400).
const previewQuerySchema = z.object({
  docType: z.enum(PREVIEW_DOC_TYPES).default("INVOICE"),
  layoutId: layoutIdSchema.optional(),
});

/**
 * Live-Vorschau des Briefpapiers/der Druckoptionen (§35/§36, Task-4-Facts) — rendert
 * eine feste Musterrechnung/-lieferschein/-mahnung mit dem aktuell GESPEICHERTEN Theme
 * der Organisation, optional mit einem explizit gewaehlten Layout (`layoutId`, Phase 11b,
 * Task 6 — zum Durchklicken der sieben Layouts, OHNE sie zu speichern). Session-
 * authentifiziert (Einstellungen sind kein oeffentlicher Angebotslink), kein DB-Beleg.
 * `cache-control: no-store`, da dieselbe URL je nach `layoutId`/gespeichertem Theme
 * unterschiedliche PDFs liefert.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = previewQuerySchema.safeParse({
    docType: url.searchParams.get("docType") ?? undefined,
    layoutId: url.searchParams.get("layoutId") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Validierung fehlgeschlagen", issues: parsed.error.issues }, { status: 400 });
  }
  const { docType, layoutId } = parsed.data;

  let org: Awaited<ReturnType<typeof getActiveOrg>>;
  try {
    org = await getActiveOrg();
  } catch (e) {
    console.error("GET /api/settings/branding/preview:", e);
    return NextResponse.json({ error: "Kein Unternehmen eingerichtet." }, { status: 404 });
  }

  // Kein Beleg-Override vorhanden (reine Musterdaten) — die organisationsweite Aufloesung
  // (Typ-Map > Organisationsstandard > "standard") liefert das gespeicherte Layout;
  // ein explizit uebergebener `layoutId`-Query-Parameter ueberschreibt ihn danach, OHNE
  // etwas zu speichern (reine Vorschau).
  const theme = await loadPdfTheme(org.id, null, PREVIEW_DOC_TYPE_TO_LAYOUT_DOC_TYPE[docType]);
  if (layoutId) theme.layoutId = layoutId;

  let pdf: Buffer;
  if (docType === "DELIVERY_NOTE") {
    pdf = await renderDeliveryNotePdf(buildSampleDeliveryNoteData(org), theme);
  } else if (docType === "DUNNING") {
    pdf = await renderDunningPdf(buildSampleDunningData(org), theme);
  } else {
    pdf = await renderInvoicePdf(buildSampleInvoiceData(org, docType), theme);
  }

  return new Response(new Uint8Array(pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": 'inline; filename="vorschau.pdf"', "cache-control": "no-store" },
  });
}
