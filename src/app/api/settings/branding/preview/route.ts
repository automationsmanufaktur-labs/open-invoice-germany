import { NextResponse } from "next/server";
import { getActiveOrg } from "@/lib/org";
import { loadPdfTheme } from "@/domain/settings/theme";
import { renderInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { renderDeliveryNotePdf } from "@/lib/pdf/delivery-note-pdf";
import { buildSampleInvoiceData, buildSampleDeliveryNoteData, PREVIEW_DOC_TYPES, type PreviewDocType } from "@/domain/settings/preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Live-Vorschau des Briefpapiers/der Druckoptionen (§35/§36, Task-4-Facts) — rendert
 * eine feste Musterrechnung/-lieferschein mit dem aktuell GESPEICHERTEN Theme der
 * Organisation. Session-authentifiziert (Einstellungen sind kein oeffentlicher
 * Angebotslink), kein DB-Beleg.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const docTypeParam = url.searchParams.get("docType") ?? "INVOICE";
  if (!PREVIEW_DOC_TYPES.includes(docTypeParam as PreviewDocType)) {
    return NextResponse.json({ error: `docType muss einer von ${PREVIEW_DOC_TYPES.join(", ")} sein.` }, { status: 400 });
  }
  const docType = docTypeParam as PreviewDocType;

  let org: Awaited<ReturnType<typeof getActiveOrg>>;
  try {
    org = await getActiveOrg();
  } catch (e) {
    console.error("GET /api/settings/branding/preview:", e);
    return NextResponse.json({ error: "Kein Unternehmen eingerichtet." }, { status: 404 });
  }

  const theme = await loadPdfTheme(org.id);
  const pdf =
    docType === "DELIVERY_NOTE" ? await renderDeliveryNotePdf(buildSampleDeliveryNoteData(org), theme) : await renderInvoicePdf(buildSampleInvoiceData(org, docType), theme);

  return new Response(new Uint8Array(pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": 'inline; filename="vorschau.pdf"' },
  });
}
