import { dbInternal } from "@/lib/db";
import { renderDunningPdf } from "@/lib/pdf/dunning-pdf";
import { buildDunningPdfData } from "@/lib/pdf/dunning-data";
import { loadPdfTheme } from "@/domain/settings/theme";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const d = await dbInternal.dunning.findUnique({
    where: { id },
    include: { invoice: { include: { org: true, customer: true } }, stage: true },
  });
  if (!d) return new Response("Mahnung nicht gefunden", { status: 404 });

  const theme = await loadPdfTheme(d.invoice.orgId);
  const pdf = await renderDunningPdf(buildDunningPdfData(d, d.invoice), theme);

  const safe = (d.number ?? "mahnung").replace(/[^A-Za-z0-9._-]/g, "_");
  return new Response(new Uint8Array(pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${safe}.pdf"` },
  });
}
