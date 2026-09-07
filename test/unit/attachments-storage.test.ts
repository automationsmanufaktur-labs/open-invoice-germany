/**
 * Storage-Tests mit temporaerem Verzeichnis (fs.mkdtemp) — ATTACHMENTS_DIR wird je
 * Testlauf per env auf ein frisches Verzeichnis gesetzt (Auftrag Task 3).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { storeFile, readFile, deleteFileIfUnreferenced, relativeStoragePath, AttachmentValidationError } from "@/lib/attachments/storage";

const PDF_BYTES = Buffer.from("%PDF-1.7\nInhalt\n");
const EXE_BYTES = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

let tmpDir: string;
let prevEnv: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "oig-attachments-"));
  prevEnv = process.env.ATTACHMENTS_DIR;
  process.env.ATTACHMENTS_DIR = tmpDir;
});

afterEach(async () => {
  if (prevEnv === undefined) delete process.env.ATTACHMENTS_DIR;
  else process.env.ATTACHMENTS_DIR = prevEnv;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("storeFile — Ablage <ATTACHMENTS_DIR>/<orgId>/<sha256[0:2]>/<sha256>", () => {
  it("speichert eine gueltige PDF unter dem Hash-Pfad", async () => {
    const result = await storeFile("org1", PDF_BYTES, "application/pdf", "rechnung.pdf");
    expect(result.storagePath).toBe(relativeStoragePath("org1", result.sha256));
    expect(result.storagePath.startsWith("org1/")).toBe(true);
    const abs = path.join(tmpDir, ...result.storagePath.split("/"));
    const onDisk = await fs.readFile(abs);
    expect(onDisk.equals(PDF_BYTES)).toBe(true);
  });

  it("lehnt eine EXE mit .pdf-Endung ab (Magic-Bytes stimmen nicht)", async () => {
    await expect(storeFile("org1", EXE_BYTES, "application/pdf", "rechnung.pdf")).rejects.toThrow(AttachmentValidationError);
  });

  it("lehnt eine echte PDF mit .exe-Endung ab (Endung nicht in der Whitelist)", async () => {
    await expect(storeFile("org1", PDF_BYTES, "application/pdf", "rechnung.exe")).rejects.toThrow(AttachmentValidationError);
  });

  it("lehnt eine Datei ueber dem 10-MB-Limit ab", async () => {
    const big = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(11 * 1024 * 1024, 0x41)]);
    await expect(storeFile("org1", big, "application/pdf", "gross.pdf")).rejects.toThrow(AttachmentValidationError);
  });

  it("Dedup: identischer Inhalt landet unter demselben Pfad und wird nicht zweimal geschrieben", async () => {
    const first = await storeFile("org1", PDF_BYTES, "application/pdf", "a.pdf");
    const abs = path.join(tmpDir, ...first.storagePath.split("/"));
    const statBefore = await fs.stat(abs);

    const second = await storeFile("org1", PDF_BYTES, "application/pdf", "b.pdf");
    expect(second.storagePath).toBe(first.storagePath);
    expect(second.sha256).toBe(first.sha256);

    const statAfter = await fs.stat(abs);
    // mtime unveraendert -> zweiter Aufruf hat NICHT erneut geschrieben.
    expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
  });

  it("derselbe Inhalt in unterschiedlichen Organisationen landet unter unterschiedlichen Pfaden", async () => {
    const a = await storeFile("org1", PDF_BYTES, "application/pdf", "a.pdf");
    const b = await storeFile("org2", PDF_BYTES, "application/pdf", "a.pdf");
    expect(a.storagePath).not.toBe(b.storagePath);
  });

  it("zehn gleichzeitige Uploads desselben Inhalts liefern alle denselben Pfad, ohne Temp-Reste", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => storeFile("org1", PDF_BYTES, "application/pdf", `race-${i}.pdf`)));
    const paths = new Set(results.map((r) => r.storagePath));
    expect(paths.size).toBe(1);
    const abs = path.join(tmpDir, ...results[0].storagePath.split("/"));
    expect((await fs.readFile(abs)).equals(PDF_BYTES)).toBe(true);
    const leftovers = (await fs.readdir(path.dirname(abs))).filter((f) => f.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });
});

describe("readFile / deleteFileIfUnreferenced", () => {
  it("readFile liest den zuvor gespeicherten Inhalt", async () => {
    const stored = await storeFile("org1", PDF_BYTES, "application/pdf", "a.pdf");
    const content = await readFile(stored.storagePath);
    expect(content.equals(PDF_BYTES)).toBe(true);
  });

  it("loescht die Datei, wenn keine andere Zeile mehr referenziert", async () => {
    const stored = await storeFile("org1", PDF_BYTES, "application/pdf", "a.pdf");
    await deleteFileIfUnreferenced(stored.storagePath, async () => false);
    await expect(readFile(stored.storagePath)).rejects.toThrow();
  });

  it("loescht NICHT, wenn eine andere Zeile noch referenziert", async () => {
    const stored = await storeFile("org1", PDF_BYTES, "application/pdf", "a.pdf");
    await deleteFileIfUnreferenced(stored.storagePath, async () => true);
    const content = await readFile(stored.storagePath);
    expect(content.equals(PDF_BYTES)).toBe(true);
  });
});
