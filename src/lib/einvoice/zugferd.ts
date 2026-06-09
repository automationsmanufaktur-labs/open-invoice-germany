/**
 * Bettet die CII/Factur-X-XML als Anhang in ein PDF ein → ZUGFeRD/Factur-X-Hybrid.
 *
 * Der eingebettete XML-Teil (factur-x.xml) ist EN-16931-CII-konform (offiziell
 * Schematron-validiert). Hinweis: pdf-lib erzeugt KEIN strenges PDF/A-3 (Farb-
 * profile/XMP-Konformität). Für strenge PDF/A-3-Validierung den Mustang-Sidecar
 * (docker-compose) bzw. veraPDF nutzen. Der eingebettete XML-Teil ist führend.
 */
import { PDFDocument, AFRelationship } from "pdf-lib";
import { renderInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { buildFacturXCII } from "./cii";
import type { EInvoiceData } from "./types";

export async function embedFacturX(pdfBytes: Uint8Array, ciiXml: string): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBytes);
  await pdfDoc.attach(new TextEncoder().encode(ciiXml), "factur-x.xml", {
    mimeType: "application/xml",
    description: "Factur-X / ZUGFeRD — strukturierte Rechnung (EN 16931)",
    afRelationship: AFRelationship.Alternative,
  });
  return pdfDoc.save();
}

export async function renderZugferdPdf(data: EInvoiceData): Promise<Buffer> {
  const pdf = await renderInvoicePdf(data);
  const cii = buildFacturXCII(data);
  const hybrid = await embedFacturX(new Uint8Array(pdf), cii);
  return Buffer.from(hybrid);
}
