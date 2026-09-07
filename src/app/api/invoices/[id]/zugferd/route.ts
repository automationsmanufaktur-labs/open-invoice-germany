import { loadEInvoiceData } from "@/lib/einvoice/load";
import { renderZugferdPdf } from "@/lib/einvoice/zugferd";
import { buildXRechnungUBL } from "@/lib/einvoice/xrechnung";
import { validateXRechnung } from "@/lib/einvoice/en16931-core";
import { loadPdfTheme } from "@/domain/settings/theme";
import { onEInvoiceInvalid } from "@/domain/notifications/hooks";

export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const loaded = await loadEInvoiceData(id);
  if (!loaded) return new Response("Rechnung nicht gefunden", { status: 404 });
  if (loaded.invoice.status === "DRAFT") {
    return new Response("Entwürfe können nicht als ZUGFeRD exportiert werden. Bitte zuerst festschreiben.", { status: 422 });
  }

  // Task 4 (Facts): Benachrichtigung bei EN-16931-Kernvalidierungsfehlern auch am
  // ZUGFeRD-Export-Pfad — analog dem XRechnung-Export. Blockiert den PDF-Export NICHT
  // (das eingebettete CII-XML nutzt einen eigenen Renderer, nicht die UBL-Validierung
  // hier — die Pruefung dient nur der Benachrichtigung, wie bei email/attachments.ts).
  const report = validateXRechnung(loaded.data, buildXRechnungUBL(loaded.data));
  if (!report.valid) {
    await onEInvoiceInvalid(loaded.invoice.orgId, { invoiceId: loaded.invoice.id, errors: report.errors });
  }

  const theme = await loadPdfTheme(loaded.invoice.orgId, loaded.invoice.printOptionsJson);
  const pdf = await renderZugferdPdf(loaded.data, theme);
  const safe = (loaded.invoice.number ?? "rechnung").replace(/[^A-Za-z0-9._-]/g, "_");
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${safe}-zugferd.pdf"`,
    },
  });
}
