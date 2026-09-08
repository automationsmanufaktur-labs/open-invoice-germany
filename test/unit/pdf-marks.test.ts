/**
 * Phase 7, Task 3 (§36) — Falz-/Lochmarken + Seitenzahlen. Prüft die reine
 * mm→pt-Umrechnung sowie, dass die Zeichenfunktionen ohne Fehler auf ein echtes
 * pdfkit-Dokument zeichnen (Position wird über `doc.moveTo`/`lineTo` erzeugt — pdfkit
 * selbst bietet keinen einfachen Lesezugriff auf bereits gezeichnete Pfade, daher
 * primär ein "wirft nicht"-/Byte-Rauchtest plus Kontrolle der reinen mm-Funktion).
 */
import { describe, it, expect } from "vitest";
import PDFDocument from "pdfkit";
import { mm, MM_TO_PT, drawFoldMarks, drawPunchMark, drawPageNumbers } from "@/lib/pdf/marks";
import { testPdfTheme } from "../helpers/pdf-theme";

describe("mm — Millimeter nach PDF-Punkt", () => {
  it("rechnet mit dem exakten Faktor 2.834645 um (Task-3-Facts)", () => {
    expect(mm(1)).toBeCloseTo(2.834645, 6);
    expect(mm(105)).toBeCloseTo(105 * MM_TO_PT, 6);
    expect(mm(0)).toBe(0);
  });
});

function bufferDoc(): PDFKit.PDFDocument {
  return new PDFDocument({ size: "A4", margins: { top: 50, right: 50, bottom: 50, left: 50 }, bufferPages: true });
}

describe("drawFoldMarks / drawPunchMark", () => {
  it("zeichnen ohne Fehler auf ein pdfkit-Dokument", async () => {
    const doc = bufferDoc();
    const chunks: Buffer[] = [];
    const done = new Promise<Buffer>((resolve) => {
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
    });
    expect(() => drawFoldMarks(doc)).not.toThrow();
    expect(() => drawPunchMark(doc)).not.toThrow();
    doc.end();
    const pdf = await done;
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});

describe("drawPageNumbers", () => {
  it("trägt 'Seite x von y' auf jede gepufferte Seite ein", async () => {
    const doc = bufferDoc();
    const chunks: Buffer[] = [];
    const done = new Promise<Buffer>((resolve) => {
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
    });
    doc.text("Seite 1");
    doc.addPage();
    doc.text("Seite 2");
    const theme = testPdfTheme();
    expect(() => drawPageNumbers(doc, theme)).not.toThrow();
    doc.end();
    const pdf = await done;
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
