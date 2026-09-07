import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { dbInternal } from "@/lib/db";
import { createDraftInvoice } from "@/domain/invoice/create";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import { createBusinessDocument } from "@/domain/document/create";
import { createDeliveryNote } from "@/domain/delivery-note/create";
import { setQuoteStatus } from "@/domain/document/status";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { verifyChain, type ChainEntry } from "@/domain/changelog";
import type { CreateInvoiceInput } from "@/schemas";
import { saveMailSettings, loadMailSettings, describeMailSettings, sendTestMail, MailNotConfiguredError } from "@/domain/email/settings";
import { prefillEmail } from "@/domain/email/compose";
import { DocumentNotFoundError } from "@/domain/email/context";
import { sendDocumentEmail } from "@/domain/email/send";
import { saveEmailTemplate, deleteEmailTemplate, TemplateNotFoundError, TemplateNameConflictError } from "@/domain/email/templates";
import { createMemoryProvider } from "@/lib/mail/memory";
import type { SendEmailRawInput } from "@/schemas/email";

let orgId: string;
let customerId: string;
let invoiceId: string;
let invoiceNumber: string;
const FIX_DATE = new Date("2030-06-09T10:00:00.000Z");

function baseInput(extra: Partial<CreateInvoiceInput> = {}): CreateInvoiceInput {
  return {
    customerId,
    type: "INVOICE",
    taxScheme: "REGULAR",
    currency: "EUR",
    deliveryDate: new Date("2030-06-01"),
    lines: [
      { description: "Beratung", quantityMilli: 2000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S", discountPermille: 0 },
    ],
    ...extra,
  } as CreateInvoiceInput;
}

beforeAll(async () => {
  process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "test-auth-secret-mindestens-16-zeichen";

  const org = await dbInternal.organization.create({
    data: {
      legalName: "Test GmbH",
      addressLine1: "Hauptstr. 1",
      postalCode: "21339",
      city: "Lüneburg",
      vatId: "DE123456789",
      taxNumber: "33/123/45678",
      email: "org@example.org",
    },
  });
  orgId = org.id;

  const customer = await dbInternal.customer.create({
    data: {
      orgId,
      name: "Kunde AG",
      addressLine1: "Marktplatz 2",
      postalCode: "20095",
      city: "Hamburg",
      type: "BUSINESS",
      email: "kunde@example.org",
    },
  });
  customerId = customer.id;

  await ensureOrgMasterdata(dbInternal, orgId);

  await saveMailSettings(orgId, {
    host: "localhost",
    port: 2525,
    security: "NONE",
    fromName: "Test GmbH",
    fromEmail: "rechnung@example.org",
    defaultBcc: "archiv@example.org",
    copyToSelf: false,
    defaultCc: "",
  });

  const draft = await createDraftInvoice(orgId, baseInput());
  const finalized = await finalizeInvoice(draft.id, { now: FIX_DATE });
  invoiceId = finalized.id;
  invoiceNumber = finalized.number!;
});

afterAll(async () => {
  await dbInternal.$disconnect();
});

async function chainValid(): Promise<boolean> {
  const rows = await dbInternal.changeLog.findMany({
    where: { orgId },
    orderBy: { id: "asc" },
    select: { prevHash: true, hash: true, entity: true, entityId: true, action: true, actor: true, at: true, diffJson: true },
  });
  const entries: ChainEntry[] = rows.map((r) => ({
    prevHash: r.prevHash,
    hash: r.hash,
    payload: { entity: r.entity, entityId: r.entityId, action: r.action, actor: r.actor, at: r.at.toISOString(), diff: JSON.parse(r.diffJson) },
  }));
  return verifyChain(entries).valid;
}

function toSendInput(pre: Awaited<ReturnType<typeof prefillEmail>>, overrides: Partial<SendEmailRawInput> = {}): SendEmailRawInput {
  return {
    docType: pre.docType,
    docId: pre.docId,
    // sendDocumentEmail parst jetzt selbst (G5) — addressListSchema erwartet die rohe,
    // kommagetrennte Form, nicht das bereits aufgeloeste Array.
    to: pre.to.join(", "),
    cc: pre.cc.join(", "),
    bcc: pre.bcc.join(", "),
    subject: pre.subject,
    body: pre.body,
    signature: pre.signature,
    copyToSelf: pre.copyToSelf,
    standardAttachments: pre.attachments.map((a) => a.filename),
    templateId: pre.templateId,
    warnings: pre.warnings,
    ...overrides,
  };
}

describe("Mailversand: Einstellungen, Vorbelegung, Versand", () => {
  it("1) prefillEmail liefert Empfaenger, Betreff, Anhang, keine Warnungen", async () => {
    const pre = await prefillEmail(orgId, { docType: "INVOICE", docId: invoiceId });
    expect(pre.to).toEqual(["kunde@example.org"]);
    expect(pre.bcc).toEqual(["archiv@example.org"]);
    expect(pre.subject).toContain(invoiceNumber);
    expect(pre.attachments.map((a) => a.filename)).toContain(`${invoiceNumber}.pdf`);
    expect(pre.warnings).toEqual([]);
  });

  let firstLogId: string;

  it("2) sendDocumentEmail: Log SENT, Anhaenge mit sha256, ChangeLog SENT, Kette gueltig", async () => {
    const pre = await prefillEmail(orgId, { docType: "INVOICE", docId: invoiceId });
    const memProvider = createMemoryProvider();
    const res = await sendDocumentEmail(orgId, "system", toSendInput(pre), [], memProvider);
    expect(res.status).toBe("SENT");
    firstLogId = res.logId;

    const log = await dbInternal.emailLog.findUniqueOrThrow({ where: { id: res.logId } });
    expect(log.status).toBe("SENT");
    expect(log.providerId).toBeTruthy();
    expect(JSON.parse(log.toJson)).toEqual(["kunde@example.org"]);
    const attachmentsMeta = JSON.parse(log.attachmentsJson) as { filename: string; size: number; sha256: string }[];
    expect(attachmentsMeta.length).toBeGreaterThan(0);
    for (const a of attachmentsMeta) expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(log.bodySnapshot).toBe(pre.signature.trim() ? `${pre.body}\n\n${pre.signature}` : pre.body);

    const cl = await dbInternal.changeLog.findFirst({ where: { orgId, entity: "EMAIL", entityId: res.logId, action: "SENT" } });
    expect(cl).not.toBeNull();
    expect(await chainValid()).toBe(true);
  });

  it("2b) Korrekturrechnung (Invoice.type = CORRECTION) wird unter docType INVOICE gefunden", async () => {
    const draft = await createDraftInvoice(orgId, baseInput({ type: "CORRECTION" }));
    const finalized = await finalizeInvoice(draft.id, { now: FIX_DATE });
    const pre = await prefillEmail(orgId, { docType: "INVOICE", docId: finalized.id });
    expect(pre.to).toEqual(["kunde@example.org"]);
    expect(pre.attachments.map((a) => a.filename)).toContain(`${finalized.number}.pdf`);

    const memProvider = createMemoryProvider();
    const res = await sendDocumentEmail(orgId, "system", toSendInput(pre), [], memProvider);
    expect(res.status).toBe("SENT");
  });

  it("3) Provider-Fehler: Log FAILED, Fehlertext enthaelt 550, ChangeLog FAILED", async () => {
    const pre = await prefillEmail(orgId, { docType: "INVOICE", docId: invoiceId });
    const memProvider = createMemoryProvider();
    memProvider.failNext("550 Mailbox unavailable");
    const res = await sendDocumentEmail(orgId, "system", toSendInput(pre), [], memProvider);
    expect(res.status).toBe("FAILED");
    expect(res.error).toContain("550");

    const log = await dbInternal.emailLog.findUniqueOrThrow({ where: { id: res.logId } });
    expect(log.status).toBe("FAILED");
    const cl = await dbInternal.changeLog.findFirst({ where: { orgId, entity: "EMAIL", entityId: res.logId, action: "FAILED" } });
    expect(cl).not.toBeNull();
    expect(await chainValid()).toBe(true);
  });

  it("4) copyToSelf: true -> bcc des gesendeten Objekts enthaelt fromEmail", async () => {
    const pre = await prefillEmail(orgId, { docType: "INVOICE", docId: invoiceId });
    const memProvider = createMemoryProvider();
    const input = toSendInput(pre, { copyToSelf: true });
    const res = await sendDocumentEmail(orgId, "system", input, [], memProvider);
    expect(res.status).toBe("SENT");
    expect(memProvider.sent[0]!.bcc).toContain("rechnung@example.org");
  });

  it("5) prefillEmail({logId}) liefert dieselben Felder und resendOfId; Wiederversand erzeugt zweites Log", async () => {
    const pre = await prefillEmail(orgId, { logId: firstLogId });
    expect(pre.docType).toBe("INVOICE");
    expect(pre.docId).toBe(invoiceId);
    expect(pre.to).toEqual(["kunde@example.org"]);
    expect(pre.bcc).toEqual(["archiv@example.org"]);
    expect(pre.resendOfId).toBe(firstLogId);

    const memProvider = createMemoryProvider();
    const res = await sendDocumentEmail(orgId, "system", toSendInput(pre, { resendOfId: firstLogId }), [], memProvider);
    expect(res.status).toBe("SENT");
    expect(res.logId).not.toBe(firstLogId);
    const log = await dbInternal.emailLog.findUniqueOrThrow({ where: { id: res.logId } });
    expect(log.resendOfId).toBe(firstLogId);
  });

  it("6) fehlende Vorlage heilt sich per ensureOrgEmailTemplates", async () => {
    await dbInternal.emailTemplate.deleteMany({ where: { orgId, docType: "INVOICE" } });
    const pre = await prefillEmail(orgId, { docType: "INVOICE", docId: invoiceId });
    expect(pre.subject).toContain(invoiceNumber);
  });

  it("6b) PrefillSource.templateId waehlt eine bestimmte Vorlage statt des Defaults", async () => {
    const alt = await dbInternal.emailTemplate.create({
      data: {
        orgId,
        docType: "INVOICE",
        name: "Alternative Vorlage",
        subject: "Alternativer Betreff {{document.number}}",
        body: "Alternativer Text",
        isDefault: false,
      },
    });
    const pre = await prefillEmail(orgId, { docType: "INVOICE", docId: invoiceId, templateId: alt.id });
    expect(pre.subject).toBe(`Alternativer Betreff ${invoiceNumber}`);
    expect(pre.templateId).toBe(alt.id);
  });

  it("6c) eigene Vorlage als Default loeschen -> Systemvorlage wird wieder Default (W1)", async () => {
    const own = await dbInternal.emailTemplate.create({
      data: {
        orgId,
        docType: "INVOICE",
        name: "Eigene Standardvorlage",
        subject: "Eigener Betreff {{document.number}}",
        body: "Eigener Text",
        isDefault: false,
      },
    });
    // Als Standard setzen -> alle anderen INVOICE-Vorlagen (inkl. Systemvorlage) verlieren isDefault.
    await dbInternal.$transaction([
      dbInternal.emailTemplate.updateMany({ where: { orgId, docType: "INVOICE" }, data: { isDefault: false } }),
      dbInternal.emailTemplate.update({ where: { id: own.id }, data: { isDefault: true } }),
    ]);

    await deleteEmailTemplate(orgId, own.id);

    const system = await dbInternal.emailTemplate.findFirstOrThrow({ where: { orgId, docType: "INVOICE", isSystem: true } });
    expect(system.isDefault).toBe(true);

    const pre = await prefillEmail(orgId, { docType: "INVOICE", docId: invoiceId });
    expect(pre.subject).not.toBe("");
    expect(pre.templateId).toBe(system.id);
  });

  it("6d) deleteEmailTemplate: unbekannte id -> TemplateNotFoundError", async () => {
    await expect(deleteEmailTemplate(orgId, "does-not-exist")).rejects.toBeInstanceOf(TemplateNotFoundError);
  });

  it("6e) saveEmailTemplate: doppelter Name/docType -> TemplateNameConflictError statt Prisma-Fehlertext (G6)", async () => {
    await saveEmailTemplate(orgId, { name: "Doppelt", docType: "PROFORMA", subject: "S1", body: "B1", isDefault: false });
    await expect(
      saveEmailTemplate(orgId, { name: "Doppelt", docType: "PROFORMA", subject: "S2", body: "B2", isDefault: false }),
    ).rejects.toBeInstanceOf(TemplateNameConflictError);
  });

  it("6f) templateId einer fremden/erfundenen Vorlage -> DocumentNotFoundError, kein Log (G4)", async () => {
    const pre = await prefillEmail(orgId, { docType: "INVOICE", docId: invoiceId });
    const logsBefore = await dbInternal.emailLog.count({ where: { orgId } });
    const memProvider = createMemoryProvider();
    await expect(
      sendDocumentEmail(orgId, "system", toSendInput(pre, { templateId: "does-not-exist" }), [], memProvider),
    ).rejects.toBeInstanceOf(DocumentNotFoundError);
    expect(await dbInternal.emailLog.count({ where: { orgId } })).toBe(logsBefore);
  });

  it("6g) resendOfId eines fremden/erfundenen Logs -> DocumentNotFoundError, kein Log (G4)", async () => {
    const pre = await prefillEmail(orgId, { docType: "INVOICE", docId: invoiceId });
    const logsBefore = await dbInternal.emailLog.count({ where: { orgId } });
    const memProvider = createMemoryProvider();
    await expect(
      sendDocumentEmail(orgId, "system", toSendInput(pre, { resendOfId: "does-not-exist" }), [], memProvider),
    ).rejects.toBeInstanceOf(DocumentNotFoundError);
    expect(await dbInternal.emailLog.count({ where: { orgId } })).toBe(logsBefore);
  });

  it("6h) Warnungen aus der Vorbelegung landen im EmailLog (G3)", async () => {
    const alt = await dbInternal.emailTemplate.create({
      data: {
        orgId,
        docType: "INVOICE",
        name: "Vorlage mit unbekanntem Platzhalter",
        subject: "Betreff {{unbekanntes.feld}}",
        body: "Text",
        isDefault: false,
      },
    });
    const pre = await prefillEmail(orgId, { docType: "INVOICE", docId: invoiceId, templateId: alt.id });
    expect(pre.warnings.length).toBeGreaterThan(0);

    const memProvider = createMemoryProvider();
    const res = await sendDocumentEmail(orgId, "system", toSendInput(pre), [], memProvider);
    const log = await dbInternal.emailLog.findUniqueOrThrow({ where: { id: res.logId } });
    const warnings = JSON.parse(log.warningsJson) as string[];
    expect(warnings.length).toBe(pre.warnings.length);
    expect(warnings).toEqual(pre.warnings);
  });

  it("7) ohne MailSettings wirft sendDocumentEmail MailNotConfiguredError, kein Log", async () => {
    const org2 = await dbInternal.organization.create({
      data: { legalName: "Ohne Mail GmbH", addressLine1: "Weg 1", postalCode: "10115", city: "Berlin", vatId: "DE999999999", taxNumber: "1/2/3" },
    });
    const before = await dbInternal.emailLog.count({ where: { orgId: org2.id } });
    const input: SendEmailRawInput = {
      docType: "INVOICE",
      docId: invoiceId,
      to: "kunde@example.org",
      cc: "",
      bcc: "",
      subject: "Test",
      body: "Text",
      signature: "",
      copyToSelf: false,
      standardAttachments: [],
    };
    await expect(sendDocumentEmail(org2.id, "system", input, [])).rejects.toBeInstanceOf(MailNotConfiguredError);
    const after = await dbInternal.emailLog.count({ where: { orgId: org2.id } });
    expect(after).toBe(before);
  });

  it("7b) Mandanten-Gate: docId einer Rechnung einer ZWEITEN Org -> DocumentNotFoundError, kein Log/ChangeLog", async () => {
    const org3 = await dbInternal.organization.create({
      data: { legalName: "Fremde Org GmbH", addressLine1: "Fremdweg 1", postalCode: "10117", city: "Berlin", vatId: "DE111111111", taxNumber: "9/8/7" },
    });
    await saveMailSettings(org3.id, {
      host: "localhost",
      port: 2525,
      security: "NONE",
      fromName: "Fremde Org GmbH",
      fromEmail: "fremd@example.org",
      defaultBcc: "",
      defaultCc: "",
      copyToSelf: false,
    });
    const logsBefore = await dbInternal.emailLog.count({ where: { orgId: org3.id } });
    const changeLogsBefore = await dbInternal.changeLog.count({ where: { orgId: org3.id } });
    const input: SendEmailRawInput = {
      docType: "INVOICE",
      docId: invoiceId, // gehoert zu orgId, nicht zu org3
      to: "kunde@example.org",
      cc: "",
      bcc: "",
      subject: "Test",
      body: "Text",
      signature: "",
      copyToSelf: false,
      standardAttachments: [],
    };
    await expect(sendDocumentEmail(org3.id, "system", input, [])).rejects.toBeInstanceOf(DocumentNotFoundError);
    expect(await dbInternal.emailLog.count({ where: { orgId: org3.id } })).toBe(logsBefore);
    expect(await dbInternal.changeLog.count({ where: { orgId: org3.id } })).toBe(changeLogsBefore);
  });

  it("7c) Mandanten-Gate: erfundene docId -> DocumentNotFoundError, kein Log/ChangeLog", async () => {
    const logsBefore = await dbInternal.emailLog.count({ where: { orgId } });
    const changeLogsBefore = await dbInternal.changeLog.count({ where: { orgId } });
    const input: SendEmailRawInput = {
      docType: "INVOICE",
      docId: "does-not-exist",
      to: "kunde@example.org",
      cc: "",
      bcc: "",
      subject: "Test",
      body: "Text",
      signature: "",
      copyToSelf: false,
      standardAttachments: [],
    };
    await expect(sendDocumentEmail(orgId, "system", input, [])).rejects.toBeInstanceOf(DocumentNotFoundError);
    expect(await dbInternal.emailLog.count({ where: { orgId } })).toBe(logsBefore);
    expect(await dbInternal.changeLog.count({ where: { orgId } })).toBe(changeLogsBefore);
  });

  it("8) describeMailSettings ohne password/passwordEnc, hasPassword; leeres Passwort laesst es unveraendert", async () => {
    await saveMailSettings(orgId, {
      host: "localhost",
      port: 2525,
      security: "NONE",
      fromName: "Test GmbH",
      fromEmail: "rechnung@example.org",
      defaultBcc: "archiv@example.org",
      defaultCc: "",
      copyToSelf: false,
      password: "geheim",
    });
    const described = await describeMailSettings(orgId);
    expect(described).not.toBeNull();
    expect(described).not.toHaveProperty("password");
    expect(described).not.toHaveProperty("passwordEnc");
    expect(described!.hasPassword).toBe(true);

    await saveMailSettings(orgId, {
      host: "localhost",
      port: 2525,
      security: "NONE",
      fromName: "Test GmbH",
      fromEmail: "rechnung@example.org",
      defaultBcc: "archiv@example.org",
      defaultCc: "",
      copyToSelf: false,
      password: "",
    });
    const loaded = await loadMailSettings(orgId);
    expect(loaded!.password).toBe("geheim");
  });

  it("9) sendTestMail sendet an org.email, legt kein EmailLog an, setzt lastTestOk", async () => {
    const before = await dbInternal.emailLog.count({ where: { orgId } });
    const memProvider = createMemoryProvider();
    const result = await sendTestMail(orgId, memProvider);
    expect(result.ok).toBe(true);
    expect(memProvider.sent[0]!.to).toEqual(["org@example.org"]);
    const after = await dbInternal.emailLog.count({ where: { orgId } });
    expect(after).toBe(before);
    const settings = await dbInternal.mailSettings.findUniqueOrThrow({ where: { orgId } });
    expect(settings.lastTestOk).toBe(true);
  });

  it("10) SENT-Hook: Angebot DRAFT -> nach erfolgreichem Versand Status SENT, sentAt gesetzt", async () => {
    const q = await createBusinessDocument(orgId, {
      kind: "ANGEBOT",
      customerId,
      lines: [{ description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S", discountPermille: 0 }],
    });
    expect(q.status).toBe("DRAFT");

    const pre = await prefillEmail(orgId, { docType: "ANGEBOT", docId: q.id });
    const memProvider = createMemoryProvider();
    const res = await sendDocumentEmail(orgId, "system", toSendInput(pre), [], memProvider);
    expect(res.status).toBe("SENT");

    const updated = await dbInternal.quote.findUniqueOrThrow({ where: { id: q.id } });
    expect(updated.status).toBe("SENT");
    expect(updated.sentAt).not.toBeNull();
  });

  it("10b) SENT-Hook: Angebot bereits ACCEPTED -> nach Versand bleibt Status ACCEPTED", async () => {
    const q = await createBusinessDocument(orgId, {
      kind: "ANGEBOT",
      customerId,
      lines: [{ description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S", discountPermille: 0 }],
    });
    await setQuoteStatus(orgId, q.id, "ACCEPTED", { actor: "system" });

    const pre = await prefillEmail(orgId, { docType: "ANGEBOT", docId: q.id });
    const memProvider = createMemoryProvider();
    const res = await sendDocumentEmail(orgId, "system", toSendInput(pre), [], memProvider);
    expect(res.status).toBe("SENT");

    const updated = await dbInternal.quote.findUniqueOrThrow({ where: { id: q.id } });
    expect(updated.status).toBe("ACCEPTED");
  });

  it("11) SENT-Hook: Provider-Fehler (FAILED) -> Quote-Status bleibt unveraendert", async () => {
    const q = await createBusinessDocument(orgId, {
      kind: "ANGEBOT",
      customerId,
      lines: [{ description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S", discountPermille: 0 }],
    });

    const pre = await prefillEmail(orgId, { docType: "ANGEBOT", docId: q.id });
    const memProvider = createMemoryProvider();
    memProvider.failNext("550 Mailbox unavailable");
    const res = await sendDocumentEmail(orgId, "system", toSendInput(pre), [], memProvider);
    expect(res.status).toBe("FAILED");

    const updated = await dbInternal.quote.findUniqueOrThrow({ where: { id: q.id } });
    expect(updated.status).toBe("DRAFT");
    expect(updated.sentAt).toBeNull();
  });

  it("12) SENT-Hook: Lieferschein CREATED -> nach Versand Status SENT, sentAt gesetzt; Anhang ist das PDF", async () => {
    const dn = await createDeliveryNote(orgId, {
      customerId,
      showPrices: true,
      showTax: true,
      lines: [{ description: "Warensendung", articleNumber: "ART-1", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 5000, taxRate: 19 }],
    });
    expect(dn.status).toBe("CREATED");

    const pre = await prefillEmail(orgId, { docType: "DELIVERY_NOTE", docId: dn.id });
    expect(pre.attachments.map((a) => a.filename)).toContain(`${dn.number}.pdf`);

    const memProvider = createMemoryProvider();
    const res = await sendDocumentEmail(orgId, "system", toSendInput(pre), [], memProvider);
    expect(res.status).toBe("SENT");

    const updated = await dbInternal.deliveryNote.findUniqueOrThrow({ where: { id: dn.id } });
    expect(updated.status).toBe("SENT");
    expect(updated.sentAt).not.toBeNull();

    const sentAttachment = memProvider.sent[0]!.attachments.find((a) => a.filename === `${dn.number}.pdf`);
    expect(sentAttachment).toBeDefined();
    expect(sentAttachment!.content.subarray(0, 4).toString()).toBe("%PDF");
  });
});
