/**
 * Gemeinsamer Kern fuer Beleg-Dateien (PDF/XRechnung/ZUGFeRD) — Phase 10, Task 3
 * (task-3-facts.md: "Dateien ... wie MCP get_document_file aus Phase 9 — wiederverwenden").
 * Extrahiert aus dem MCP-Tool `get_document_file` (src/mcp/tools/documents.ts, Phase 9),
 * damit MCP und `/api/v1` dieselbe Aufloesungs-/Renderlogik nutzen (Lastenheft §55, keine
 * Bypass-Pfade). Bewusst OHNE die MCP-spezifische 10-MB-Base64-Pruefung (die betrifft nur
 * die MCP-JSON-Antwort, nicht einen HTTP-Byte-Stream).
 *
 * Fix-Runde 1 (Koordinator-Ruling c, Task 3): xrechnung/zugferd laufen jetzt durch
 * DIESELBE EN-16931-Kernvalidierung wie die beiden Session-HTTP-Routen
 * (`/api/invoices/[id]/xrechnung`, `.../zugferd` — `validateXRechnung()` wird von dort
 * wiederverwendet, nicht die Regellogik kopiert) — bei einem Regelverstoss wirft diese
 * Funktion `EInvoiceInvalidError` (409) UND benachrichtigt ueber `onEInvoiceInvalid`,
 * bevor ueberhaupt eine Datei zurueckgegeben wird. Gilt fuer BEIDE Aufrufer (v1-Routen
 * UND das MCP-Tool `get_document_file`) — Paritaet, kein optionaler "validate"-Schalter
 * (Lastenheft §55, "keine nur optisch korrekte E-Rechnung").
 */
import { dbInternal } from "@/lib/db";
import { loadEInvoiceData } from "@/lib/einvoice/load";
import { buildXRechnungUBL } from "@/lib/einvoice/xrechnung";
import { renderZugferdPdf } from "@/lib/einvoice/zugferd";
import { validateXRechnung } from "@/lib/einvoice/en16931-core";
import { renderInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { buildDocEInvoiceData } from "@/domain/document/pdf-data";
import { buildDeliveryNotePdfData } from "@/lib/pdf/delivery-note-data";
import { renderDeliveryNotePdf } from "@/lib/pdf/delivery-note-pdf";
import { buildDunningPdfData } from "@/lib/pdf/dunning-data";
import { renderDunningPdf } from "@/lib/pdf/dunning-pdf";
import { loadPdfTheme } from "@/domain/settings/theme";
import { onEInvoiceInvalid } from "@/domain/notifications/hooks";
import { NotFoundError, InvalidOperationError, EInvoiceInvalidError } from "@/domain/errors";
import type { EInvoiceData } from "@/lib/einvoice/types";

export type DocumentFileKind = "INVOICE" | "QUOTE" | "DELIVERY_NOTE" | "DUNNING";
export type DocumentFileFormat = "pdf" | "xrechnung" | "zugferd";

export interface DocumentFile {
  buffer: Buffer;
  mimeType: string;
  /** Dateiname ohne Endung, bereits Header-sicher (nur [A-Za-z0-9._-]). */
  filenameBase: string;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "_");
}

/**
 * EN-16931-Kernvalidierung vor xrechnung/zugferd (Fix-Runde 1, Koordinator-Ruling c) —
 * wirft `EInvoiceInvalidError` UND benachrichtigt (`onEInvoiceInvalid`), BEVOR die Datei
 * zurueckgegeben wird. Dieselbe `validateXRechnung()` wie die beiden Session-Routen.
 */
async function assertXRechnungValid(orgId: string, invoiceId: string, data: EInvoiceData): Promise<void> {
  const report = validateXRechnung(data, buildXRechnungUBL(data));
  if (report.valid) return;
  await onEInvoiceInvalid(orgId, { invoiceId, errors: report.errors });
  throw new EInvoiceInvalidError(report.errors);
}

/**
 * Loest `kind`+`document` (Nummer ODER ID, org-gescoped) auf und liefert die Datei als
 * Buffer + MIME-Typ + Dateiname-Basis. Wirft `NotFoundError` (404), wenn der Beleg nicht
 * existiert bzw. nicht zur Organisation gehoert, `InvalidOperationError` (409, GoBD-Regel
 * "kein E-Rechnung-Export fuer Entwuerfe" bzw. "xrechnung/zugferd nur fuer kind=INVOICE"),
 * `EInvoiceInvalidError` (409, EN-16931-Kernvalidierung fehlgeschlagen — xrechnung/zugferd).
 */
export async function getDocumentFile(orgId: string, kind: DocumentFileKind, document: string, format: DocumentFileFormat = "pdf"): Promise<DocumentFile> {
  if (format !== "pdf" && kind !== "INVOICE") {
    throw new InvalidOperationError(`${format} ist nur fuer kind=INVOICE verfuegbar.`);
  }

  if (kind === "INVOICE") {
    const ref = await dbInternal.invoice.findFirst({ where: { orgId, OR: [{ id: document }, { number: document }] }, select: { id: true } });
    if (!ref) throw new NotFoundError("Rechnung nicht gefunden.");
    const loaded = await loadEInvoiceData(ref.id);
    if (!loaded) throw new NotFoundError("Rechnung nicht gefunden.");
    const { invoice: inv, data } = loaded;
    const filenameBase = sanitizeFilename(inv.number ?? `entwurf-${inv.id.slice(0, 8)}`);
    const theme = await loadPdfTheme(orgId, inv.printOptionsJson);
    if (format === "pdf") {
      return { buffer: await renderInvoicePdf(data, theme), mimeType: "application/pdf", filenameBase };
    }
    if (format === "xrechnung") {
      if (inv.status === "DRAFT") throw new InvalidOperationError("XRechnung nur fuer festgeschriebene Rechnungen. Zuerst finalisieren.");
      await assertXRechnungValid(orgId, inv.id, data);
      return { buffer: Buffer.from(buildXRechnungUBL(data), "utf8"), mimeType: "application/xml", filenameBase };
    }
    if (inv.status === "DRAFT") throw new InvalidOperationError("ZUGFeRD nur fuer festgeschriebene Rechnungen. Zuerst finalisieren.");
    await assertXRechnungValid(orgId, inv.id, data);
    return { buffer: await renderZugferdPdf(data, theme), mimeType: "application/pdf", filenameBase };
  }

  if (kind === "QUOTE") {
    const q = await dbInternal.quote.findFirst({
      where: { orgId, OR: [{ id: document }, { number: document }] },
      include: { lines: { orderBy: { position: "asc" } }, org: true, customer: true },
    });
    if (!q) throw new NotFoundError("Dokument nicht gefunden.");
    const theme = await loadPdfTheme(orgId, q.printOptionsJson);
    const buffer = await renderInvoicePdf(buildDocEInvoiceData(q), theme);
    return { buffer, mimeType: "application/pdf", filenameBase: sanitizeFilename(q.number ?? "dokument") };
  }

  if (kind === "DELIVERY_NOTE") {
    const dn = await dbInternal.deliveryNote.findFirst({
      where: { orgId, OR: [{ id: document }, { number: document }] },
      include: { lines: { orderBy: { position: "asc" } }, org: true, customer: true },
    });
    if (!dn) throw new NotFoundError("Lieferschein nicht gefunden.");
    let sourceNumber: string | null = null;
    if (dn.sourceType === "QUOTE" && dn.sourceId) {
      const q = await dbInternal.quote.findFirst({ where: { id: dn.sourceId, orgId }, select: { number: true } });
      sourceNumber = q?.number ?? null;
    } else if (dn.sourceType === "INVOICE" && dn.sourceId) {
      const src = await dbInternal.invoice.findFirst({ where: { id: dn.sourceId, orgId }, select: { number: true } });
      sourceNumber = src?.number ?? null;
    }
    const shippingAddress = dn.showDeliveryAddress
      ? await dbInternal.customerAddress.findFirst({
          where: { orgId, customerId: dn.customerId, type: "SHIPPING", isDefault: true },
          select: { addressLine1: true, addressLine2: true, postalCode: true, city: true },
        })
      : null;
    const theme = await loadPdfTheme(orgId, dn.printOptionsJson);
    const buffer = await renderDeliveryNotePdf(buildDeliveryNotePdfData(dn, dn.org, dn.customer, sourceNumber, shippingAddress), theme);
    return { buffer, mimeType: "application/pdf", filenameBase: sanitizeFilename(dn.number ?? "lieferschein") };
  }

  // DUNNING
  const d = await dbInternal.dunning.findFirst({
    where: { invoice: { orgId }, OR: [{ id: document }, { number: document }] },
    include: { invoice: { include: { org: true, customer: true } }, stage: true },
  });
  if (!d) throw new NotFoundError(`Mahnung "${document}" nicht gefunden.`);
  const theme = await loadPdfTheme(orgId);
  const buffer = await renderDunningPdf(buildDunningPdfData(d, d.invoice), theme);
  return { buffer, mimeType: "application/pdf", filenameBase: sanitizeFilename(d.number ?? "mahnung") };
}
