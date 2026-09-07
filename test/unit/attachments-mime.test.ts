import { describe, it, expect } from "vitest";
import { sniffMime, extensionMatchesMime, validateFileContent } from "@/lib/attachments/mime";

const PDF_BYTES = Buffer.from("%PDF-1.7\n%âãÏÓ\n1 0 obj\n<< >>\nendobj\n");
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const EXE_BYTES = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]); // "MZ..." Windows-PE-Header
const ZIP_WITHOUT_CONTENT_TYPES = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("irgendein-zip-inhalt")]);
const OOXML_ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("...[Content_Types].xml...")]);

describe("sniffMime — Magic-Bytes-Erkennung (§38)", () => {
  it("erkennt PDF", () => expect(sniffMime(PDF_BYTES)).toBe("application/pdf"));
  it("erkennt PNG", () => expect(sniffMime(PNG_BYTES)).toBe("image/png"));
  it("erkennt JPG", () => expect(sniffMime(JPG_BYTES)).toBe("image/jpeg"));
  it("erkennt einen OOXML-ZIP (DOCX/XLSX-Container)", () => expect(sniffMime(OOXML_ZIP)).toBe("ooxml-zip"));
  it("lehnt ein ZIP OHNE [Content_Types].xml ab (kein erkennbares Format)", () => expect(sniffMime(ZIP_WITHOUT_CONTENT_TYPES)).toBeNull());
  it("lehnt eine EXE (MZ-Header) ab", () => expect(sniffMime(EXE_BYTES)).toBeNull());
  it("erkennt reinen Klartext (TXT/CSV-Kandidat)", () => expect(sniffMime(Buffer.from("a,b,c\n1,2,3\n", "utf8"))).toBe("text"));
  it("lehnt Binaerdaten mit NUL-Byte als Text ab", () => expect(sniffMime(Buffer.from([0x41, 0x00, 0x42]))).toBeNull());
});

describe("extensionMatchesMime — Whitelist-Endung", () => {
  it("PDF-Endung passt zu application/pdf", () => expect(extensionMatchesMime("rechnung.pdf", "application/pdf")).toBe(true));
  it("EXE-Endung passt zu keinem erlaubten Typ", () => expect(extensionMatchesMime("rechnung.exe", "application/pdf")).toBe(false));
});

describe("validateFileContent — Magic-Bytes MUSS zum behaupteten Typ passen", () => {
  it("PDF-Inhalt mit .exe-Endung wird abgelehnt (Endung nicht in der Whitelist fuer application/pdf)", () => {
    const result = validateFileContent(PDF_BYTES, "rechnung.exe", "application/pdf");
    expect(result.ok).toBe(false);
  });

  it("EXE-Bytes mit .pdf-Endung/behauptetem PDF-Typ werden abgelehnt (Magic-Bytes stimmen nicht)", () => {
    const result = validateFileContent(EXE_BYTES, "rechnung.pdf", "application/pdf");
    expect(result.ok).toBe(false);
  });

  it("echtes PDF mit .pdf-Endung wird akzeptiert", () => {
    const result = validateFileContent(PDF_BYTES, "rechnung.pdf", "application/pdf");
    expect(result.ok).toBe(true);
  });

  it("echtes PNG behauptet als JPEG wird abgelehnt", () => {
    const result = validateFileContent(PNG_BYTES, "bild.jpg", "image/jpeg");
    expect(result.ok).toBe(false);
  });

  it("DOCX-Container (OOXML-ZIP) mit passendem Typ wird akzeptiert", () => {
    const result = validateFileContent(
      OOXML_ZIP,
      "vertrag.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(result.ok).toBe(true);
  });
});
