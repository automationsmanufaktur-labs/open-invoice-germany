/**
 * Zeichnet einen EPC-QR-Code ("GiroCode") in ein pdfkit-Dokument (Phase 7, Task 3, §37).
 */
import QRCode from "qrcode";
import { mm } from "./marks";

export interface RenderGiroCodeOptions {
  x: number;
  y: number;
  /** Kantenlänge des Codes in Millimeter. */
  sizeMm: number;
}

/** Rendert die EPC-Payload als PNG-QR-Code an Position (x, y) mit Kantenlänge `sizeMm`. */
export async function renderGiroCode(doc: PDFKit.PDFDocument, payload: string, opts: RenderGiroCodeOptions): Promise<void> {
  const png = await QRCode.toBuffer(payload, { type: "png", errorCorrectionLevel: "M", margin: 0, width: 300 });
  const size = mm(opts.sizeMm);
  doc.image(png, opts.x, opts.y, { width: size, height: size });
}
