import { loadEInvoiceData } from "@/lib/einvoice/load";
import { renderInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { loadPdfTheme } from "@/domain/settings/theme";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const loaded = await loadEInvoiceData(id);
  if (!loaded) return new Response("Rechnung nicht gefunden", { status: 404 });

  const theme = await loadPdfTheme(loaded.invoice.orgId, loaded.invoice.printOptionsJson);
  const pdf = await renderInvoicePdf(loaded.data, theme);
  const name = loaded.invoice.number ?? `entwurf-${loaded.invoice.id.slice(0, 8)}`;
  const safe = name.replace(/[^A-Za-z0-9._-]/g, "_"); // Header-Injection vermeiden
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${safe}.pdf"`,
    },
  });
}
