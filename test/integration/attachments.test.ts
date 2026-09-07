/**
 * Beleganhaenge (Task 3): addAttachment/removeAttachment/listAttachments/
 * loadAttachmentForSend — org-/belegzugehoerigkeits-geprueft, Whitelist+Magic-Bytes,
 * 50-MB-Limit je Beleg, Dedup, ChangeLog ATTACHMENT ADD/REMOVE.
 *
 * ATTACHMENTS_DIR je Testlauf auf ein fs.mkdtemp-Verzeichnis gesetzt. Testjahr 2035.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { dbInternal } from "@/lib/db";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { createDraftInvoice } from "@/domain/invoice/create";
import { createInvoiceSchema } from "@/schemas";
import { addAttachment, removeAttachment, listAttachments, loadAttachmentForSend } from "@/domain/attachment/manage";
import { AttachmentValidationError } from "@/lib/attachments/storage";
import { verifyChain, type ChainEntry } from "@/domain/changelog";

const FIX_DATE = new Date("2035-04-01T10:00:00.000Z");
const PDF_BYTES = Buffer.from("%PDF-1.7\nInhalt der Rechnung\n");
const EXE_BYTES = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

let tmpDir: string;
let prevEnv: string | undefined;
let orgId: string;
let otherOrgId: string;
let customerId: string;
let invoiceId: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "oig-attachments-int-"));
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
    data: { legalName: "Anhang GmbH", addressLine1: "Hauptstr. 1", postalCode: "21339", city: "Lüneburg", vatId: "DE123456789", taxNumber: "33/123/45678" },
  });
  orgId = org.id;
  await ensureOrgMasterdata(dbInternal, orgId);
  const other = await dbInternal.organization.create({
    data: { legalName: "Fremde GmbH", addressLine1: "X", postalCode: "1", city: "X" },
  });
  otherOrgId = other.id;

  const customer = await dbInternal.customer.create({
    data: { orgId, name: "Kunde AG", addressLine1: "Marktplatz 2", postalCode: "20095", city: "Hamburg", type: "BUSINESS" },
  });
  customerId = customer.id;

  const invoice = await createDraftInvoice(
    orgId,
    createInvoiceSchema.parse({
      customerId,
      lines: [{ description: "Beratung", quantityMilli: 1000, unitNetPriceCents: 10000, taxRate: 19 }],
    }),
    { now: FIX_DATE },
  );
  invoiceId = invoice.id;
});

describe("addAttachment", () => {
  it("speichert einen gueltigen Anhang, schreibt ChangeLog ADD", async () => {
    const before = await dbInternal.changeLog.count({ where: { orgId } });
    const row = await addAttachment(orgId, "INVOICE", invoiceId, { filename: "rechnung.pdf", mime: "application/pdf", buffer: PDF_BYTES }, "tester");
    expect(row.docType).toBe("INVOICE");
    expect(row.docId).toBe(invoiceId);
    expect(row.sizeBytes).toBe(PDF_BYTES.length);

    const log = await dbInternal.changeLog.findFirst({ where: { orgId, entity: "ATTACHMENT", entityId: row.id, action: "ADD" } });
    expect(log).not.toBeNull();
    const diff = JSON.parse(log!.diffJson);
    expect(diff.filename).toBe("rechnung.pdf");
    expect(diff.sha256).toBe(row.sha256);

    const after = await dbInternal.changeLog.count({ where: { orgId } });
    expect(after).toBe(before + 1);
  });

  it("lehnt eine EXE mit .pdf-Endung ab (Magic-Bytes)", async () => {
    await expect(
      addAttachment(orgId, "INVOICE", invoiceId, { filename: "boese.pdf", mime: "application/pdf", buffer: EXE_BYTES }, "tester"),
    ).rejects.toThrow(AttachmentValidationError);
  });

  it("lehnt eine echte PDF mit .exe-Endung ab", async () => {
    await expect(
      addAttachment(orgId, "INVOICE", invoiceId, { filename: "gut.exe", mime: "application/pdf", buffer: PDF_BYTES }, "tester"),
    ).rejects.toThrow(AttachmentValidationError);
  });

  it("lehnt einen Anhang fuer eine Rechnung einer fremden Organisation ab", async () => {
    await expect(
      addAttachment(otherOrgId, "INVOICE", invoiceId, { filename: "rechnung.pdf", mime: "application/pdf", buffer: PDF_BYTES }, "tester"),
    ).rejects.toThrow();
  });

  it("lehnt einen Anhang fuer eine nicht existierende Rechnung ab", async () => {
    await expect(
      addAttachment(orgId, "INVOICE", "unbekannt", { filename: "rechnung.pdf", mime: "application/pdf", buffer: PDF_BYTES }, "tester"),
    ).rejects.toThrow();
  });

  it("Dedup: derselbe Inhalt zweimal am selben Beleg gibt dieselbe Zeile zurueck, kein zweiter ChangeLog-Eintrag", async () => {
    const invoice2 = await createDraftInvoice(
      orgId,
      createInvoiceSchema.parse({ customerId, lines: [{ description: "Beratung", quantityMilli: 1000, unitNetPriceCents: 5000, taxRate: 19 }] }),
      { now: FIX_DATE },
    );
    const first = await addAttachment(orgId, "INVOICE", invoice2.id, { filename: "a.pdf", mime: "application/pdf", buffer: PDF_BYTES }, "tester");
    const countAfterFirst = await dbInternal.changeLog.count({ where: { orgId, entity: "ATTACHMENT", entityId: first.id } });

    const second = await addAttachment(orgId, "INVOICE", invoice2.id, { filename: "b.pdf", mime: "application/pdf", buffer: PDF_BYTES }, "tester");
    expect(second.id).toBe(first.id);

    const countAfterSecond = await dbInternal.changeLog.count({ where: { orgId, entity: "ATTACHMENT", entityId: first.id } });
    expect(countAfterSecond).toBe(countAfterFirst);

    const rows = await dbInternal.documentAttachment.findMany({ where: { orgId, docType: "INVOICE", docId: invoice2.id } });
    expect(rows).toHaveLength(1);
  });

  it("lehnt einen Anhang ab, wenn die 50-MB-Grenze je Beleg ueberschritten wuerde", async () => {
    const invoice3 = await createDraftInvoice(
      orgId,
      createInvoiceSchema.parse({ customerId, lines: [{ description: "Beratung", quantityMilli: 1000, unitNetPriceCents: 5000, taxRate: 19 }] }),
      { now: FIX_DATE },
    );
    // 6 verschiedene ~9-MB-Dateien (je einzeln unter dem 10-MB-Limit) summieren sich auf > 50 MB.
    for (let i = 0; i < 5; i++) {
      const buf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(9 * 1024 * 1024, i)]);
      await addAttachment(orgId, "INVOICE", invoice3.id, { filename: `datei-${i}.pdf`, mime: "application/pdf", buffer: buf }, "tester");
    }
    const overflow = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(9 * 1024 * 1024, 99)]);
    await expect(
      addAttachment(orgId, "INVOICE", invoice3.id, { filename: "datei-6.pdf", mime: "application/pdf", buffer: overflow }, "tester"),
    ).rejects.toThrow();
  });
});

describe("listAttachments / removeAttachment", () => {
  it("listet nur Anhaenge des eigenen Belegs, entfernt mit ChangeLog REMOVE und loescht die Datei ohne weitere Referenz", async () => {
    const invoice4 = await createDraftInvoice(
      orgId,
      createInvoiceSchema.parse({ customerId, lines: [{ description: "Beratung", quantityMilli: 1000, unitNetPriceCents: 5000, taxRate: 19 }] }),
      { now: FIX_DATE },
    );
    // Eigener Inhalt (nicht PDF_BYTES) — sonst haette ein frueherer Testfall bereits eine
    // DocumentAttachment-Zeile mit demselben (orgId, sha256)-Pfad angelegt und
    // deleteFileIfUnreferenced wuerde die Datei zurecht NICHT loeschen.
    const uniquePdf = Buffer.concat([PDF_BYTES, Buffer.from("-list-remove-test")]);
    const row = await addAttachment(orgId, "INVOICE", invoice4.id, { filename: "a.pdf", mime: "application/pdf", buffer: uniquePdf }, "tester");
    const listed = await listAttachments(orgId, "INVOICE", invoice4.id);
    expect(listed.map((a) => a.id)).toEqual([row.id]);

    await removeAttachment(orgId, "INVOICE", invoice4.id, row.id, "tester");
    const afterRemove = await listAttachments(orgId, "INVOICE", invoice4.id);
    expect(afterRemove).toHaveLength(0);

    const log = await dbInternal.changeLog.findFirst({ where: { orgId, entity: "ATTACHMENT", entityId: row.id, action: "REMOVE" } });
    expect(log).not.toBeNull();

    const abs = path.join(tmpDir, ...row.storagePath.split("/"));
    await expect(fs.access(abs)).rejects.toThrow();
  });

  it("loescht die Datei NICHT, wenn ein anderer Beleg denselben Inhalt referenziert", async () => {
    const invoiceA = await createDraftInvoice(
      orgId,
      createInvoiceSchema.parse({ customerId, lines: [{ description: "Beratung", quantityMilli: 1000, unitNetPriceCents: 5000, taxRate: 19 }] }),
      { now: FIX_DATE },
    );
    const invoiceB = await createDraftInvoice(
      orgId,
      createInvoiceSchema.parse({ customerId, lines: [{ description: "Beratung", quantityMilli: 1000, unitNetPriceCents: 5000, taxRate: 19 }] }),
      { now: FIX_DATE },
    );
    const a = await addAttachment(orgId, "INVOICE", invoiceA.id, { filename: "a.pdf", mime: "application/pdf", buffer: PDF_BYTES }, "tester");
    const b = await addAttachment(orgId, "INVOICE", invoiceB.id, { filename: "a.pdf", mime: "application/pdf", buffer: PDF_BYTES }, "tester");
    expect(a.storagePath).toBe(b.storagePath);

    await removeAttachment(orgId, "INVOICE", invoiceA.id, a.id, "tester");
    const abs = path.join(tmpDir, ...a.storagePath.split("/"));
    const stillThere = await fs.access(abs).then(() => true).catch(() => false);
    expect(stillThere).toBe(true);
  });

  it("verweigert das Entfernen eines Anhangs ueber eine fremde Organisation", async () => {
    const invoice5 = await createDraftInvoice(
      orgId,
      createInvoiceSchema.parse({ customerId, lines: [{ description: "Beratung", quantityMilli: 1000, unitNetPriceCents: 5000, taxRate: 19 }] }),
      { now: FIX_DATE },
    );
    const row = await addAttachment(orgId, "INVOICE", invoice5.id, { filename: "a.pdf", mime: "application/pdf", buffer: PDF_BYTES }, "tester");
    await expect(removeAttachment(otherOrgId, "INVOICE", invoice5.id, row.id, "tester")).rejects.toThrow();
  });
});

describe("loadAttachmentForSend — org- und beleggeprueft", () => {
  it("laedt ausgewaehlte Anhaenge desselben Belegs", async () => {
    const invoice6 = await createDraftInvoice(
      orgId,
      createInvoiceSchema.parse({ customerId, lines: [{ description: "Beratung", quantityMilli: 1000, unitNetPriceCents: 5000, taxRate: 19 }] }),
      { now: FIX_DATE },
    );
    const row = await addAttachment(orgId, "INVOICE", invoice6.id, { filename: "a.pdf", mime: "application/pdf", buffer: PDF_BYTES }, "tester");
    const loaded = await loadAttachmentForSend(orgId, "INVOICE", invoice6.id, [row.id]);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].filename).toBe("a.pdf");
    expect(loaded[0].content.equals(PDF_BYTES)).toBe(true);
  });

  it("wirft, wenn eine id zu einem anderen Beleg oder einer fremden Organisation gehoert", async () => {
    const invoice7 = await createDraftInvoice(
      orgId,
      createInvoiceSchema.parse({ customerId, lines: [{ description: "Beratung", quantityMilli: 1000, unitNetPriceCents: 5000, taxRate: 19 }] }),
      { now: FIX_DATE },
    );
    const invoice8 = await createDraftInvoice(
      orgId,
      createInvoiceSchema.parse({ customerId, lines: [{ description: "Beratung", quantityMilli: 1000, unitNetPriceCents: 5000, taxRate: 19 }] }),
      { now: FIX_DATE },
    );
    const rowOnInvoice7 = await addAttachment(orgId, "INVOICE", invoice7.id, { filename: "a.pdf", mime: "application/pdf", buffer: PDF_BYTES }, "tester");
    await expect(loadAttachmentForSend(orgId, "INVOICE", invoice8.id, [rowOnInvoice7.id])).rejects.toThrow();
  });
});

describe("ChangeLog-Kette bleibt gueltig", () => {
  it("verifyChain bestaetigt die Kette nach ADD/REMOVE-Eintraegen", async () => {
    const entries = (await dbInternal.changeLog.findMany({ where: { orgId }, orderBy: { id: "asc" } })).map(
      (e): ChainEntry => ({ prevHash: e.prevHash, hash: e.hash, payload: { entity: e.entity, entityId: e.entityId, action: e.action, actor: e.actor, at: e.at.toISOString(), diff: JSON.parse(e.diffJson) } }),
    );
    expect(verifyChain(entries).valid).toBe(true);
  });
});
