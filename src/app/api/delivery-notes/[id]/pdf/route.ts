import { dbInternal } from "@/lib/db";
import { getActiveOrg } from "@/lib/org";
import { buildDeliveryNotePdfData } from "@/lib/pdf/delivery-note-data";
import { renderDeliveryNotePdf } from "@/lib/pdf/delivery-note-pdf";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const org = await getActiveOrg();

  const dn = await dbInternal.deliveryNote.findFirst({
    where: { id, orgId: org.id },
    include: { lines: { orderBy: { position: "asc" } }, org: true, customer: true },
  });
  if (!dn) return new Response("Lieferschein nicht gefunden", { status: 404 });

  let sourceNumber: string | null = null;
  if (dn.sourceType === "QUOTE" && dn.sourceId) {
    const q = await dbInternal.quote.findFirst({ where: { id: dn.sourceId, orgId: org.id }, select: { number: true } });
    sourceNumber = q?.number ?? null;
  } else if (dn.sourceType === "INVOICE" && dn.sourceId) {
    const inv = await dbInternal.invoice.findFirst({ where: { id: dn.sourceId, orgId: org.id }, select: { number: true } });
    sourceNumber = inv?.number ?? null;
  }

  const pdf = await renderDeliveryNotePdf(buildDeliveryNotePdfData(dn, dn.org, dn.customer, sourceNumber));
  const safe = (dn.number ?? "lieferschein").replace(/[^A-Za-z0-9._-]/g, "_");
  return new Response(new Uint8Array(pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${safe}.pdf"` },
  });
}
