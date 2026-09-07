import { prisma } from "@/lib/db";
import { buildDocEInvoiceData } from "@/domain/document/pdf-data";
import { renderInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { getActiveOrg } from "@/lib/org";
import { loadPdfTheme } from "@/domain/settings/theme";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const org = await getActiveOrg();
  // G7 (Fix-Runde 2): findUnique(id) ohne orgId erlaubte fremden Organisationen den Zugriff
  // auf ein Dokument-PDF ueber die reine ID — jetzt mandantengeprueft wie alle anderen
  // Belegzugriffe.
  const q = await prisma.quote.findFirst({
    where: { id, orgId: org.id },
    include: { lines: { orderBy: { position: "asc" } }, org: true, customer: true },
  });
  if (!q) return new Response("Dokument nicht gefunden", { status: 404 });

  const theme = await loadPdfTheme(org.id, q.printOptionsJson);
  const pdf = await renderInvoicePdf(buildDocEInvoiceData(q), theme);
  const safe = (q.number ?? "dokument").replace(/[^A-Za-z0-9._-]/g, "_");
  return new Response(new Uint8Array(pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${safe}.pdf"` },
  });
}
