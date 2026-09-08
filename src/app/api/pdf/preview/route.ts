import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrg } from "@/lib/org";
import { NotFoundError } from "@/domain/errors";
import { buildDraftPreview, PREVIEW_KINDS, type PreviewBody } from "@/domain/settings/preview-draft";
import { layoutIdSchema } from "@/schemas/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// M8 (Abschluss-Review): `payload.lines` war bisher unbegrenzt (`createInvoiceSchema.lines`
// kennt selbst kein `.max()`) — anders als die echte Anlage schreibt eine Vorschau nichts,
// was auffiele, ist also beliebig oft mit einem sehr grossen `lines`-Array wiederholbar
// (ein pdfkit-Render pro Request). `.max(500)` bewusst NUR hier auf der Vorschau-Route,
// nicht an `invoiceLineInputSchema`/`deliveryNoteLineInputSchema` selbst — diese teilen
// sich viele Aufrufer (Rechnung/Dokument/Lieferschein/Abo-Anlage), eine globale Grenze
// waere eine groessere, hier nicht beauftragte Verhaltensaenderung. `.passthrough()` laesst
// alle uebrigen `payload`-Felder unberuehrt durch — die eigentliche, kind-spezifische
// Validierung bleibt in `buildDraftPreview`/`preview-draft.ts` (`createInvoiceSchema` u. a.).
const previewBodySchema = z.object({
  kind: z.enum(PREVIEW_KINDS),
  payload: z.object({ lines: z.array(z.unknown()).max(500).optional() }).passthrough(),
  layoutId: layoutIdSchema.optional(),
});

/**
 * Phase 11c, Task 2 — Live-Vorschau eines UNGESPEICHERTEN Editor-Entwurfs (Task 1):
 * rendert Rechnung/Geschaeftsdokument/Lieferschein aus dem rohen Formular-Payload, OHNE
 * einen DB-Beleg anzulegen (kein Nummernkreis, kein ChangeLog-Eintrag). Session-
 * geschuetzt ueber `src/proxy.ts` — `/api/pdf/` steht NICHT in `PUBLIC_PREFIXES`, ein
 * fehlendes Session-Cookie liefert bereits dort 401, bevor diese Route erreicht wird.
 * Nummer "ENTWURF", Wasserzeichen "VORSCHAU" auf jeder Seite (`PdfTheme.watermark`,
 * `drawWatermark` in `marks.ts`) — verhindert, dass eine Vorschau versehentlich als
 * echter Beleg verschickt/abgelegt wird. `cache-control: no-store`, da dieselbe URL je
 * nach Payload voellig unterschiedliche PDFs liefert.
 *
 * `?compress=0` schaltet die PDF-Content-Stream-Kompression ab — NUR wenn
 * `NODE_ENV === "test"` (siehe `PdfTheme.compress`): `pdf-parse` (buendelt eine sehr alte
 * pdf.js-Version) wirft bei manchen strukturell validen, komprimierten pdfkit-PDFs eine
 * "bad XRef entry"-Ausnahme. Der Produktionspfad ignoriert den Parameter (immer
 * komprimiert).
 */
export async function POST(req: Request) {
  let orgId: string;
  try {
    const org = await getActiveOrg();
    orgId = org.id;
  } catch (e) {
    console.error("POST /api/pdf/preview:", e);
    return NextResponse.json({ error: "Kein Unternehmen eingerichtet." }, { status: 404 });
  }

  try {
    const raw: unknown = await req.json();
    const body: PreviewBody = previewBodySchema.parse(raw);
    const url = new URL(req.url);
    const compress = process.env.NODE_ENV === "test" && url.searchParams.get("compress") === "0" ? false : undefined;

    const pdf = await buildDraftPreview(orgId, body, compress);
    return new Response(new Uint8Array(pdf), {
      headers: { "content-type": "application/pdf", "content-disposition": 'inline; filename="vorschau.pdf"', "cache-control": "no-store" },
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Validierung fehlgeschlagen", details: e.flatten() }, { status: 400 });
    }
    if (e instanceof NotFoundError) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    // Fix Round 1, Minor — nur Zod-/NotFoundError sind "der Client hat etwas falsch
    // gemacht" (400/404); alles andere (Renderer-Absturz, DB-Fehler etc.) ist ein
    // interner Fehler und gehoert auf 500 (analog `/api/search`, `mapError` in
    // customers/[id]/last-document/route.ts).
    console.error("POST /api/pdf/preview:", e);
    return NextResponse.json({ error: "Interner Fehler" }, { status: 500 });
  }
}
