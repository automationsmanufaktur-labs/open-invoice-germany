import { loadEInvoiceData } from "@/lib/einvoice/load";
import { buildXRechnungUBL } from "@/lib/einvoice/xrechnung";
import { validateXRechnung } from "@/lib/einvoice/en16931-core";
import { onEInvoiceInvalid } from "@/domain/notifications/hooks";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const loaded = await loadEInvoiceData(id);
  if (!loaded) return new Response("Rechnung nicht gefunden", { status: 404 });
  if (loaded.invoice.status === "DRAFT")
    return new Response("Entwürfe können nicht als E-Rechnung exportiert werden. Bitte zuerst festschreiben.", { status: 422 });

  const { data } = loaded;
  const xml = buildXRechnungUBL(data);

  // Selbstkontrolle: Kernregeln vor Auslieferung prüfen (?validate=1 -> JSON-Report)
  const report = validateXRechnung(data, xml);
  const url = new URL(req.url);
  if (url.searchParams.get("validate") === "1") {
    return Response.json(report);
  }
  if (!report.valid) {
    // Task 4 (Facts): auch am manuellen Export-Pfad benachrichtigen, nicht nur beim
    // Versand (email/attachments.ts, Task 3) — blockiert den Export NICHT zusaetzlich
    // (er ist bereits durch den 422 blockiert), nur die Benachrichtigung.
    await onEInvoiceInvalid(loaded.invoice.orgId, { invoiceId: loaded.invoice.id, errors: report.errors });
    return Response.json({ error: "EN-16931-Kernvalidierung fehlgeschlagen", issues: report.errors }, { status: 422 });
  }

  const safe = (loaded.invoice.number ?? "rechnung").replace(/[^A-Za-z0-9._-]/g, "_"); // Header-Injection vermeiden
  return new Response(xml, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "content-disposition": `attachment; filename="${safe}.xml"`,
    },
  });
}
