/**
 * W1 (Fix-Welle nach Abschluss-Review): Content-Disposition-Header muss einen ASCII-
 * Fallback UND die korrekte RFC-5987-Variante (filename*=UTF-8''...) enthalten, damit
 * Umlaute/Geviertstriche/Emoji im Dateinamen den Download nicht verstuemmeln oder den
 * Header brechen.
 */
import { describe, it, expect } from "vitest";
import { contentDispositionAttachment } from "@/lib/http/content-disposition";

describe("contentDispositionAttachment", () => {
  it("baut ASCII-Fallback + filename* fuer einen reinen ASCII-Namen", () => {
    const header = contentDispositionAttachment("rechnung.pdf");
    expect(header).toBe(`attachment; filename="rechnung.pdf"; filename*=UTF-8''rechnung.pdf`);
  });

  it("ersetzt Umlaute im ASCII-Fallback, codiert sie korrekt in filename*", () => {
    const header = contentDispositionAttachment("Übersicht Straße.pdf");
    expect(header).toContain(`filename="_bersicht Stra_e.pdf"`);
    expect(header).toContain(`filename*=UTF-8''%C3%9Cbersicht%20Stra%C3%9Fe.pdf`);
  });

  it("behandelt einen Geviertstrich (em dash) korrekt", () => {
    const header = contentDispositionAttachment("Rechnung — Kopie.pdf");
    expect(header).toContain(`filename="Rechnung _ Kopie.pdf"`);
    expect(header).toContain(`filename*=UTF-8''Rechnung%20%E2%80%94%20Kopie.pdf`);
  });

  it("behandelt Emoji korrekt (ausserhalb ASCII, mehrere UTF-8-Bytes)", () => {
    const header = contentDispositionAttachment("Anhang 📎.pdf");
    expect(header).toContain(`filename*=UTF-8''Anhang%20%F0%9F%93%8E.pdf`);
  });

  it("escaped Anfuehrungszeichen und Backslash im ASCII-Fallback", () => {
    const header = contentDispositionAttachment('a"b\\c.pdf');
    expect(header).toContain(`filename="a_b_c.pdf"`);
  });

  it("faellt bei leerem Namen auf 'download' zurueck", () => {
    const header = contentDispositionAttachment("");
    expect(header).toContain(`filename="download"`);
  });
});
