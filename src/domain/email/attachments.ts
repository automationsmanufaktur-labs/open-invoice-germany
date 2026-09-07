/** Standardanhaenge je Belegtyp (Lastenheft 19, Abschnitt 2). */
import { loadEInvoiceData } from "@/lib/einvoice/load";
import { renderInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { renderZugferdPdf } from "@/lib/einvoice/zugferd";
import { buildXRechnungUBL } from "@/lib/einvoice/xrechnung";
import { buildDocEInvoiceData } from "@/domain/document/pdf-data";
import { renderDunningPdf } from "@/lib/pdf/dunning-pdf";
import { buildDunningPdfData } from "@/lib/pdf/dunning-data";
import { renderDeliveryNotePdf } from "@/lib/pdf/delivery-note-pdf";
import { buildDeliveryNotePdfData } from "@/lib/pdf/delivery-note-data";
import { dbInternal } from "@/lib/db";
import { parseBuyerSnapshot, buildBuyerSnapshot } from "@/domain/snapshot";
import type { EmailDocType } from "@/schemas/email";
import type { AttachmentDocType } from "@/domain/attachment/manage";

export interface Attachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

/** Uebersetzt den Mail-Belegtyp (EmailDocType, Quote.kind-Werte fuer Geschaeftsdokumente)
 *  in den Beleganhang-Belegtyp (AttachmentDocType, DocRefType-Werte) — DocumentAttachment
 *  kennt nur QUOTE/INVOICE/DELIVERY_NOTE/DUNNING/RECURRING, waehrend der Mailversand
 *  ANGEBOT/AUFTRAGSBESTAETIGUNG/PROFORMA/CREDIT_NOTE als eigene Typen unterscheidet. */
export function attachmentDocTypeFor(docType: EmailDocType): AttachmentDocType {
  if (docType === "INVOICE" || docType === "CREDIT_NOTE") return "INVOICE";
  if (docType === "DUNNING") return "DUNNING";
  if (docType === "DELIVERY_NOTE") return "DELIVERY_NOTE";
  return "QUOTE"; // ANGEBOT | AUFTRAGSBESTAETIGUNG | PROFORMA
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_");

/** Standardanhaenge je Belegtyp (Spec, Abschnitt 2). */
export async function buildStandardAttachments(orgId: string, docType: EmailDocType, docId: string): Promise<Attachment[]> {
  if (docType === "INVOICE" || docType === "CREDIT_NOTE") {
    // Invoice.type kennt INVOICE, CREDIT_NOTE und CORRECTION (Korrekturrechnung).
    // Fuer den E-Mail-Dokumenttyp INVOICE zaehlen sowohl INVOICE als auch CORRECTION.
    const okTypes = docType === "CREDIT_NOTE" ? ["CREDIT_NOTE"] : ["INVOICE", "CORRECTION"];
    const loaded = await loadEInvoiceData(docId);
    if (!loaded || loaded.invoice.orgId !== orgId || !okTypes.includes(loaded.invoice.type)) return [];
    const { invoice, data } = loaded;
    const base = safe(invoice.number ?? "Entwurf");
    // Festgeschrieben ODER storniert -> das rechtsverbindliche ZUGFeRD-PDF; nur echte
    // Entwuerfe bekommen den Entwurfs-Hinweis (Feldwert siehe finalize.ts/cancel.ts).
    const finalized = invoice.status === "FINALIZED" || invoice.status === "CANCELLED";
    if (!finalized) {
      return [{ filename: `${base}-ENTWURF.pdf`, contentType: "application/pdf", content: await renderInvoicePdf(data) }];
    }
    const out: Attachment[] = [{ filename: `${base}.pdf`, contentType: "application/pdf", content: await renderZugferdPdf(data) }];
    // Leitweg-ID aus dem Kaeufer-Snapshot (nicht aus dem Stamm) — festgeschriebene Belege
    // duerfen durch spaetere Stammdatenaenderungen nicht rueckwirkend die Anhaenge aendern.
    const buyer = parseBuyerSnapshot(invoice.buyerSnapshotJson, buildBuyerSnapshot(invoice.customer), `email:${docType}:${docId}`);
    if (buyer.leitwegId) {
      out.push({ filename: `${base}-xrechnung.xml`, contentType: "application/xml", content: Buffer.from(buildXRechnungUBL(data), "utf8") });
    }
    return out;
  }

  if (docType === "DUNNING") {
    const d = await dbInternal.dunning.findFirst({
      where: { id: docId, invoice: { orgId } },
      include: { invoice: { include: { org: true, customer: true } } },
    });
    if (!d) return [];
    const out: Attachment[] = [
      { filename: `${safe(d.number ?? "Mahnung")}.pdf`, contentType: "application/pdf", content: await renderDunningPdf(buildDunningPdfData(d, d.invoice)) },
    ];
    const inv = await loadEInvoiceData(d.invoiceId);
    if (inv) out.push({ filename: `${safe(inv.invoice.number ?? "Rechnung")}.pdf`, contentType: "application/pdf", content: await renderInvoicePdf(inv.data) });
    return out;
  }

  if (docType === "DELIVERY_NOTE") {
    // Mandanten-Gate ueber orgId direkt in der Query (analog Mahnung/Rechnung oben).
    const dn = await dbInternal.deliveryNote.findFirst({
      where: { id: docId, orgId },
      include: { org: true, customer: true, lines: { orderBy: { position: "asc" } } },
    });
    if (!dn) return [];
    const pdf = await renderDeliveryNotePdf(buildDeliveryNotePdfData(dn, dn.org, dn.customer));
    return [{ filename: `${safe(dn.number ?? "Lieferschein")}.pdf`, contentType: "application/pdf", content: pdf }];
  }

  const q = await dbInternal.quote.findFirst({
    where: { id: docId, orgId, kind: docType },
    include: { lines: { orderBy: { position: "asc" } }, org: true, customer: true },
  });
  if (!q) return [];
  return [{ filename: `${safe(q.number ?? "Dokument")}.pdf`, contentType: "application/pdf", content: await renderInvoicePdf(buildDocEInvoiceData(q)) }];
}
