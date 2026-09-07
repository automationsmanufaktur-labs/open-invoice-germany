/**
 * Fix-Runde 1 zu Task 5: Routen-Tests fuer /api/attachments (POST, multipart) und
 * /api/attachments/[id] (GET Download, DELETE). Muster: test/integration/email-route.test.ts
 * (content-length-Vorpruefung, streamender Body) und document-route.test.ts (Org/Auth-Mock).
 * ATTACHMENTS_DIR je Testlauf auf ein fs.mkdtemp-Verzeichnis gesetzt (wie attachments.test.ts).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const orgStore: { id: string | null } = vi.hoisted(() => ({ id: null }));

vi.mock("@/lib/org", () => ({
  getActiveOrg: async () => {
    if (!orgStore.id) throw new Error("Test-Org noch nicht gesetzt.");
    return { id: orgStore.id };
  },
}));
vi.mock("@/lib/auth/server", () => ({
  getCurrentUserId: async () => "tester",
}));

import { dbInternal } from "@/lib/db";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { createDraftInvoice } from "@/domain/invoice/create";
import { createInvoiceSchema } from "@/schemas";
import { POST } from "@/app/api/attachments/route";
import { GET as downloadGet, DELETE as attachmentDelete } from "@/app/api/attachments/[id]/route";

const FIX_DATE = new Date("2037-06-01T10:00:00.000Z");
const PDF_BYTES = Buffer.from("%PDF-1.7\nInhalt der Rechnung\n");
// Dedup laeuft ueber SHA-256 des Inhalts (addAttachment) — je Test EIGENEN Inhalt
// erzeugen, sonst liefert ein zweiter Upload desselben Inhalts fuer denselben Beleg
// den bereits bestehenden (ersten) Anhang zurueck statt einen neuen anzulegen.
function pdfBytes(unique: string): Buffer {
  return Buffer.concat([PDF_BYTES, Buffer.from(`\n% ${unique}`)]);
}
const EXE_BYTES = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

let tmpDir: string;
let prevEnv: string | undefined;
let orgId: string;
let otherOrgId: string;
let customerId: string;
let invoiceId: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "oig-attachments-route-"));
  prevEnv = process.env.ATTACHMENTS_DIR;
  process.env.ATTACHMENTS_DIR = tmpDir;
});
afterEach(async () => {
  if (prevEnv === undefined) delete process.env.ATTACHMENTS_DIR;
  else process.env.ATTACHMENTS_DIR = prevEnv;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "Attachments-Route GmbH", addressLine1: "Hauptstr. 1", postalCode: "21339", city: "Lüneburg", vatId: "DE123456789", taxNumber: "33/123/45678" },
  });
  orgId = org.id;
  orgStore.id = orgId;
  await ensureOrgMasterdata(dbInternal, orgId);

  const other = await dbInternal.organization.create({ data: { legalName: "Fremde GmbH", addressLine1: "X", postalCode: "1", city: "X" } });
  otherOrgId = other.id;

  const customer = await dbInternal.customer.create({
    data: { orgId, name: "Kunde AG", addressLine1: "Marktplatz 2", postalCode: "20095", city: "Hamburg", type: "BUSINESS" },
  });
  customerId = customer.id;

  const invoice = await createDraftInvoice(
    orgId,
    createInvoiceSchema.parse({ customerId, lines: [{ description: "Beratung", quantityMilli: 1000, unitNetPriceCents: 10000, taxRate: 19 }] }),
    { now: FIX_DATE },
  );
  invoiceId = invoice.id;
});

/**
 * Ein ReadableStream ruft pull() intern selbststaendig auf — unabhaengig davon, ob ein
 * Consumer tatsaechlich liest. Ob der Body GELESEN wurde, zeigt nur `bodyUsed`.
 */
function streamingRequest(headers: Record<string, string> = {}): Request {
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new TextEncoder().encode("x"));
    },
  });
  return new Request("http://localhost/api/attachments", {
    method: "POST",
    headers,
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

function multipartRequest(fields: Record<string, string>, files: { field: string; filename: string; bytes: Buffer; mime: string }[]): Request {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  for (const f of files) fd.append(f.field, new File([new Uint8Array(f.bytes)], f.filename, { type: f.mime }));
  // FormData-Bodies liefern in dieser Umgebung keinen automatischen content-length-Header
  // (siehe undici) — die Route braucht ihn fuer die Vorpruefung, daher grosszuegig manuell
  // gesetzt (weit unter dem 50-MB-Limit, die tatsaechliche Groesse spielt fuer die
  // Vorpruefung selbst keine Rolle).
  return new Request("http://localhost/api/attachments", {
    method: "POST",
    headers: { "content-length": "100000" },
    body: fd,
  });
}

describe("POST /api/attachments: Content-Length-Pruefung", () => {
  it("content-length ueber dem Limit -> 413, Body wird nicht gelesen", async () => {
    const req = streamingRequest({ "content-length": String(60 * 1024 * 1024) });
    const res = await POST(req);
    expect(res.status).toBe(413);
    const json = await res.json();
    expect(json.error).toBe("Anfrage zu gross");
    expect(req.bodyUsed).toBe(false);
  });

  it("fehlende content-length -> 413, Body wird nicht gelesen", async () => {
    const req = streamingRequest();
    expect(req.headers.get("content-length")).toBeNull();
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(req.bodyUsed).toBe(false);
  });
});

describe("POST /api/attachments", () => {
  it("400 ohne docType", async () => {
    const req = multipartRequest({ docId: invoiceId }, [{ field: "files", filename: "a.pdf", bytes: pdfBytes("a"), mime: "application/pdf" }]);
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("201 mit gueltigen PDF-Bytes", async () => {
    const req = multipartRequest({ docType: "INVOICE", docId: invoiceId }, [{ field: "files", filename: "rechnung.pdf", bytes: pdfBytes("rechnung"), mime: "application/pdf" }]);
    const res = await POST(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.saved).toHaveLength(1);
    expect(json.saved[0].filename).toBe("rechnung.pdf");
    expect(json.failed).toEqual([]);
  });

  it("400 bei EXE-Bytes mit .pdf-Endung (Magic-Bytes-Pruefung schlaegt fehl)", async () => {
    const req = multipartRequest({ docType: "INVOICE", docId: invoiceId }, [{ field: "files", filename: "boese.pdf", bytes: EXE_BYTES, mime: "application/pdf" }]);
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBeTruthy();
  });

  it("207 bei gemischtem Mehrfach-Upload: gueltige Datei gespeichert, ungueltige in failed", async () => {
    const req = multipartRequest({ docType: "INVOICE", docId: invoiceId }, [
      { field: "files", filename: "gut.pdf", bytes: pdfBytes("gut"), mime: "application/pdf" },
      { field: "files", filename: "schlecht.pdf", bytes: EXE_BYTES, mime: "application/pdf" },
    ]);
    const res = await POST(req);
    expect(res.status).toBe(207);
    const json = await res.json();
    expect(json.saved).toHaveLength(1);
    expect(json.saved[0].filename).toBe("gut.pdf");
    expect(json.failed).toHaveLength(1);
    expect(json.failed[0].filename).toBe("schlecht.pdf");
  });

  it("G6: lehnt einen Dateinamen mit '..' ab", async () => {
    const req = multipartRequest({ docType: "INVOICE", docId: invoiceId }, [{ field: "files", filename: "../../etc/passwd.pdf", bytes: pdfBytes("traversal"), mime: "application/pdf" }]);
    const res = await POST(req);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain("unzulaessige Zeichen");
  });

  it("G6: lehnt einen Dateinamen mit Steuerzeichen (CR/LF, Header-Injection) ab", async () => {
    const req = multipartRequest({ docType: "INVOICE", docId: invoiceId }, [{ field: "files", filename: "gut.pdf\r\nX-Injected: evil", bytes: pdfBytes("injection"), mime: "application/pdf" }]);
    const res = await POST(req);
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toContain("unzulaessige Zeichen");
  });

  it("G4: gleichzeitige Uploads desselben Inhalts fuer denselben Beleg liefern idempotent nur EINEN Anhang", async () => {
    const bytes = pdfBytes("race");
    const [res1, res2] = await Promise.all([
      POST(multipartRequest({ docType: "INVOICE", docId: invoiceId }, [{ field: "files", filename: "race-a.pdf", bytes, mime: "application/pdf" }])),
      POST(multipartRequest({ docType: "INVOICE", docId: invoiceId }, [{ field: "files", filename: "race-b.pdf", bytes, mime: "application/pdf" }])),
    ]);
    const j1 = await res1.json();
    const j2 = await res2.json();
    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    // Beide Requests liefern DIESELBE Zeile zurueck (idempotent) statt eines Unique-
    // Constraint-Fehlers (P2002) auf dem Verlierer.
    expect(j1.saved[0].id).toBe(j2.saved[0].id);

    const matching = await dbInternal.documentAttachment.count({ where: { orgId, docId: invoiceId, id: j1.saved[0].id } });
    expect(matching).toBe(1);
  });
});

describe("GET /api/attachments/[id]", () => {
  it("liefert Content-Disposition: attachment und Cache-Control: no-store", async () => {
    const uploadRes = await POST(
      multipartRequest({ docType: "INVOICE", docId: invoiceId }, [{ field: "files", filename: "download.pdf", bytes: pdfBytes("download"), mime: "application/pdf" }]),
    );
    const uploaded = (await uploadRes.json()).saved[0] as { id: string };

    const res = await downloadGet(new Request(`http://localhost/api/attachments/${uploaded.id}`), { params: Promise.resolve({ id: uploaded.id }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(res.headers.get("content-disposition")).toContain("download.pdf");
    expect(res.headers.get("cache-control")).toBe("no-store");
    // W1: nosniff verhindert, dass der Browser den content-type ignoriert.
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("W1: Content-Disposition mit Geviertstrich/Emoji im Dateinamen enthaelt ASCII-Fallback UND filename*", async () => {
    const uploadRes = await POST(
      multipartRequest({ docType: "INVOICE", docId: invoiceId }, [{ field: "files", filename: "Rechnung — 📎.pdf", bytes: pdfBytes("emoji"), mime: "application/pdf" }]),
    );
    const uploaded = (await uploadRes.json()).saved[0] as { id: string };

    const res = await downloadGet(new Request(`http://localhost/api/attachments/${uploaded.id}`), { params: Promise.resolve({ id: uploaded.id }) });
    const disposition = res.headers.get("content-disposition") ?? "";
    expect(disposition).toContain(`filename="Rechnung _ __.pdf"`);
    expect(disposition).toContain(`filename*=UTF-8''Rechnung%20%E2%80%94%20%F0%9F%93%8E.pdf`);
  });

  it("404 bei fremdem Anhang (andere Org)", async () => {
    const uploadRes = await POST(
      multipartRequest({ docType: "INVOICE", docId: invoiceId }, [{ field: "files", filename: "geheim.pdf", bytes: pdfBytes("geheim"), mime: "application/pdf" }]),
    );
    const uploaded = (await uploadRes.json()).saved[0] as { id: string };

    orgStore.id = otherOrgId;
    const res = await downloadGet(new Request(`http://localhost/api/attachments/${uploaded.id}`), { params: Promise.resolve({ id: uploaded.id }) });
    expect(res.status).toBe(404);
    orgStore.id = orgId;
  });
});

describe("DELETE /api/attachments/[id]", () => {
  it("loescht einen Anhang", async () => {
    const uploadRes = await POST(
      multipartRequest({ docType: "INVOICE", docId: invoiceId }, [{ field: "files", filename: "loeschen.pdf", bytes: pdfBytes("loeschen"), mime: "application/pdf" }]),
    );
    const uploaded = (await uploadRes.json()).saved[0] as { id: string };

    const res = await attachmentDelete(new Request(`http://localhost/api/attachments/${uploaded.id}`, { method: "DELETE" }), { params: Promise.resolve({ id: uploaded.id }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);

    const reloaded = await dbInternal.documentAttachment.findUnique({ where: { id: uploaded.id } });
    expect(reloaded).toBeNull();
  });

  it("404 bei unbekanntem Anhang", async () => {
    const res = await attachmentDelete(new Request("http://localhost/api/attachments/unbekannt", { method: "DELETE" }), { params: Promise.resolve({ id: "unbekannt" }) });
    expect(res.status).toBe(404);
  });
});
