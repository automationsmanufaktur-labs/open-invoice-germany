import { loadEInvoiceData } from "@/lib/einvoice/load";
import { renderZugferdPdf } from "@/lib/einvoice/zugferd";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const loaded = await loadEInvoiceData(id);
  if (!loaded) return new Response("Rechnung nicht gefunden", { status: 404 });
  if (loaded.invoice.status === "DRAFT") {
    return new Response("Entwürfe können nicht als ZUGFeRD exportiert werden. Bitte zuerst festschreiben.", { status: 422 });
  }

  const pdf = await renderZugferdPdf(loaded.data);
  const safe = (loaded.invoice.number ?? "rechnung").replace(/[^A-Za-z0-9._-]/g, "_");
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${safe}-zugferd.pdf"`,
    },
  });
}
