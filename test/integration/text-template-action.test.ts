/**
 * Task-3-Ergaenzung (Fix-Runde 2, W5): saveTextTemplate/deleteTextTemplate/
 * setDefaultTextTemplate (src/domain/text-template/manage.ts). Muster:
 * test/integration/templates-action.test.ts (saveEmailTemplate), analog fuer
 * Dokumenttextvorlagen.
 */
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { dbInternal } from "@/lib/db";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import {
  saveTextTemplate,
  deleteTextTemplate,
  setDefaultTextTemplate,
  SystemTemplateProtectedError,
  TemplateNotFoundError,
  TemplateNameConflictError,
} from "@/domain/text-template/manage";

let orgId: string;

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: { legalName: "Textvorlagen-Test GmbH", addressLine1: "Teststr. 1", postalCode: "10115", city: "Berlin" },
  });
  orgId = org.id;
  await ensureOrgMasterdata(dbInternal, orgId);
});

afterAll(async () => {
  await dbInternal.$disconnect();
});

describe("saveTextTemplate", () => {
  it("legt eine neue Vorlage an", async () => {
    const created = await saveTextTemplate(orgId, { name: "Eigener Kopftext", docType: "ANGEBOT", position: "HEAD", body: "Sehr geehrte Damen und Herren,", isDefault: false });
    expect(created.name).toBe("Eigener Kopftext");
    expect(created.docType).toBe("ANGEBOT");
    expect(created.isDefault).toBe(false);
  });

  it("setzt isDefault=true und entfernt den Default bei allen anderen Vorlagen derselben (docType, position)-Kombination", async () => {
    const first = await saveTextTemplate(orgId, { name: "A", docType: "PROFORMA", position: "FOOT", body: "Text A", isDefault: true });
    const second = await saveTextTemplate(orgId, { name: "B", docType: "PROFORMA", position: "FOOT", body: "Text B", isDefault: true });

    const reloadedFirst = await dbInternal.textTemplate.findUniqueOrThrow({ where: { id: first.id } });
    expect(reloadedFirst.isDefault).toBe(false);
    expect(second.isDefault).toBe(true);

    const defaults = await dbInternal.textTemplate.findMany({ where: { orgId, docType: "PROFORMA", position: "FOOT", isDefault: true } });
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.id).toBe(second.id);
  });

  it("docType/position sind bei einer Bestandsvorlage unveraenderlich (Manipulationsversuch wird ignoriert)", async () => {
    const existing = await saveTextTemplate(orgId, { name: "Ursprung", docType: "ANGEBOT", position: "TERMS_DELIVERY", body: "Original", isDefault: false });

    const updated = await saveTextTemplate(orgId, {
      id: existing.id,
      name: "Ursprung (bearbeitet)",
      // Manipulationsversuch: docType/position weichen vom gespeicherten Wert ab.
      docType: "INVOICE",
      position: "HEAD",
      body: "Geaendert",
      isDefault: false,
    });

    expect(updated.docType).toBe("ANGEBOT");
    expect(updated.position).toBe("TERMS_DELIVERY");
    expect(updated.body).toBe("Geaendert");
  });

  it("wirft TemplateNotFoundError bei unbekannter id", async () => {
    await expect(
      saveTextTemplate(orgId, { id: "does-not-exist", name: "x", docType: "INVOICE", position: "HEAD", body: "x", isDefault: false }),
    ).rejects.toThrow(TemplateNotFoundError);
  });

  it("wirft TemplateNameConflictError bei doppeltem Namen fuer dieselbe (docType, position)-Kombination", async () => {
    await saveTextTemplate(orgId, { name: "Doppelt", docType: "DELIVERY_NOTE", position: "HEAD", body: "Erste", isDefault: false });
    await expect(
      saveTextTemplate(orgId, { name: "Doppelt", docType: "DELIVERY_NOTE", position: "HEAD", body: "Zweite", isDefault: false }),
    ).rejects.toThrow(TemplateNameConflictError);
  });
});

describe("setDefaultTextTemplate", () => {
  it("setzt genau eine Vorlage als Default, alle anderen derselben Kombination werden zurueckgesetzt", async () => {
    const a = await saveTextTemplate(orgId, { name: "SetDefault A", docType: "INVOICE", position: "TERMS_PAYMENT", body: "A", isDefault: true });
    const b = await saveTextTemplate(orgId, { name: "SetDefault B", docType: "INVOICE", position: "TERMS_PAYMENT", body: "B", isDefault: false });

    await setDefaultTextTemplate(orgId, b.id);

    const reloadedA = await dbInternal.textTemplate.findUniqueOrThrow({ where: { id: a.id } });
    const reloadedB = await dbInternal.textTemplate.findUniqueOrThrow({ where: { id: b.id } });
    expect(reloadedA.isDefault).toBe(false);
    expect(reloadedB.isDefault).toBe(true);
  });

  it("wirft TemplateNotFoundError bei unbekannter id", async () => {
    await expect(setDefaultTextTemplate(orgId, "does-not-exist")).rejects.toThrow(TemplateNotFoundError);
  });
});

describe("deleteTextTemplate", () => {
  it("loescht eine normale (Nicht-System-) Vorlage", async () => {
    const tpl = await saveTextTemplate(orgId, { name: "Zu loeschen", docType: "AUFTRAGSBESTAETIGUNG", position: "FOOT", body: "x", isDefault: false });
    await deleteTextTemplate(orgId, tpl.id);
    const reloaded = await dbInternal.textTemplate.findUnique({ where: { id: tpl.id } });
    expect(reloaded).toBeNull();
  });

  it("war die geloeschte Vorlage Default, wird die aelteste verbleibende Vorlage neuer Default", async () => {
    // AUFTRAGSBESTAETIGUNG/HEAD hat bereits eine Systemvorlage "Standard" aus beforeAll —
    // die ist damit die AELTESTE der Kombination und muss nach der Loeschung Default
    // werden (nicht die hier neu angelegte "Erste").
    const system = await dbInternal.textTemplate.findFirstOrThrow({ where: { orgId, docType: "AUFTRAGSBESTAETIGUNG", position: "HEAD", name: "Standard" } });
    const created = await saveTextTemplate(orgId, { name: "Neue", docType: "AUFTRAGSBESTAETIGUNG", position: "HEAD", body: "Neue", isDefault: true });

    await deleteTextTemplate(orgId, created.id);

    const reloadedSystem = await dbInternal.textTemplate.findUniqueOrThrow({ where: { id: system.id } });
    expect(reloadedSystem.isDefault).toBe(true);
  });

  it("verweigert das Loeschen der Systemvorlage ('Standard'), wenn keine andere Vorlage Default ist", async () => {
    const system = await dbInternal.textTemplate.findFirstOrThrow({ where: { orgId, docType: "ANGEBOT", position: "HEAD", name: "Standard" } });
    await expect(deleteTextTemplate(orgId, system.id)).rejects.toThrow(SystemTemplateProtectedError);
  });

  it("erlaubt das Loeschen der Systemvorlage, sobald eine andere Vorlage derselben Kombination Default ist", async () => {
    const system = await dbInternal.textTemplate.findFirstOrThrow({ where: { orgId, docType: "DELIVERY_NOTE", position: "FOOT", name: "Standard" } });
    const other = await saveTextTemplate(orgId, { name: "Andere", docType: "DELIVERY_NOTE", position: "FOOT", body: "Andere", isDefault: true });

    await deleteTextTemplate(orgId, system.id);

    const reloadedSystem = await dbInternal.textTemplate.findUnique({ where: { id: system.id } });
    expect(reloadedSystem).toBeNull();
    const reloadedOther = await dbInternal.textTemplate.findUniqueOrThrow({ where: { id: other.id } });
    expect(reloadedOther.isDefault).toBe(true);
  });

  it("wirft TemplateNotFoundError bei unbekannter id", async () => {
    await expect(deleteTextTemplate(orgId, "does-not-exist")).rejects.toThrow(TemplateNotFoundError);
  });
});
