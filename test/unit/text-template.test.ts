import { describe, it, expect } from "vitest";
import { dbInternal } from "@/lib/db";
import { DEFAULT_TEXT_TEMPLATES } from "@/domain/text-template/defaults";
import { ensureOrgTextTemplates } from "@/domain/text-template/ensure";
import { pickTextTemplate } from "@/domain/text-template/pick";
import { DocType, TextTemplatePosition } from "@/schemas";

async function makeOrg(legalName: string) {
  return dbInternal.organization.create({ data: { legalName, addressLine1: "Hauptstr. 1", postalCode: "1", city: "B" } });
}

describe("DEFAULT_TEXT_TEMPLATES", () => {
  it("alle Eintraege haben gueltige DocType-/Positions-Werte und nicht-leeren Text", () => {
    for (const t of DEFAULT_TEXT_TEMPLATES) {
      expect(DocType.safeParse(t.docType).success).toBe(true);
      expect(TextTemplatePosition.safeParse(t.position).success).toBe(true);
      expect(t.body.length).toBeGreaterThan(0);
    }
  });

  it("deckt HEAD/FOOT fuer ANGEBOT, AUFTRAGSBESTAETIGUNG, DELIVERY_NOTE, INVOICE ab", () => {
    for (const docType of ["ANGEBOT", "AUFTRAGSBESTAETIGUNG", "DELIVERY_NOTE", "INVOICE"]) {
      expect(DEFAULT_TEXT_TEMPLATES.some((t) => t.docType === docType && t.position === "HEAD")).toBe(true);
      expect(DEFAULT_TEXT_TEMPLATES.some((t) => t.docType === docType && t.position === "FOOT")).toBe(true);
    }
  });

  it("ANGEBOT bekommt zusaetzlich Lieferungs-/Zahlungsbedingungen", () => {
    expect(DEFAULT_TEXT_TEMPLATES.some((t) => t.docType === "ANGEBOT" && t.position === "TERMS_DELIVERY")).toBe(true);
    expect(DEFAULT_TEXT_TEMPLATES.some((t) => t.docType === "ANGEBOT" && t.position === "TERMS_PAYMENT")).toBe(true);
  });
});

describe("ensureOrgTextTemplates", () => {
  it("legt Standardvorlagen an (idempotent) und markiert genau eine als Default je (docType, position)", async () => {
    const org = await makeOrg("TextTpl GmbH");
    await ensureOrgTextTemplates(dbInternal, org.id);
    await ensureOrgTextTemplates(dbInternal, org.id); // zweiter Lauf: idempotent, kein Duplikat

    const all = await dbInternal.textTemplate.findMany({ where: { orgId: org.id } });
    expect(all).toHaveLength(DEFAULT_TEXT_TEMPLATES.length);

    for (const t of DEFAULT_TEXT_TEMPLATES) {
      const defaults = all.filter((row) => row.docType === t.docType && row.position === t.position && row.isDefault);
      expect(defaults).toHaveLength(1);
    }
  });

  it("bestehende Nutzer-Standardvorlage bleibt beim (Wieder-)Anlegen der Systemvorlage Default", async () => {
    const org = await makeOrg("Custom Default GmbH");
    await dbInternal.textTemplate.create({
      data: { orgId: org.id, docType: "ANGEBOT", position: "HEAD", name: "Eigene", body: "Eigener Text", isDefault: true },
    });
    await ensureOrgTextTemplates(dbInternal, org.id);

    const rows = await dbInternal.textTemplate.findMany({ where: { orgId: org.id, docType: "ANGEBOT", position: "HEAD" } });
    expect(rows.find((r) => r.name === "Eigene")!.isDefault).toBe(true);
    expect(rows.find((r) => r.name === "Standard")!.isDefault).toBe(false);
  });

  it("geloeschte Standardvorlage wird beim naechsten Lauf als Systemvorlage neu angelegt", async () => {
    const org = await makeOrg("Heal GmbH");
    await ensureOrgTextTemplates(dbInternal, org.id);

    const head = await dbInternal.textTemplate.findFirstOrThrow({ where: { orgId: org.id, docType: "ANGEBOT", position: "HEAD" } });
    await dbInternal.textTemplate.delete({ where: { id: head.id } }); // Standardvorlage geloescht -> kein Default mehr

    await ensureOrgTextTemplates(dbInternal, org.id); // Selbstheilung: Systemvorlage wird neu angelegt

    const remaining = await dbInternal.textTemplate.findMany({ where: { orgId: org.id, docType: "ANGEBOT", position: "HEAD" } });
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.isDefault).toBe(true);
  });

  it("Selbstheilung: eine vorhandene, aber nicht als Default markierte Vorlage wird nachgezogen", async () => {
    const org = await makeOrg("Heal2 GmbH");
    // Simuliert einen inkonsistenten Zustand (z. B. direkter DB-Zugriff): Vorlage existiert,
    // ist aber (noch) nicht als Default markiert -- der Upsert allein wuerde sie nicht anfassen.
    await dbInternal.textTemplate.create({
      data: { orgId: org.id, docType: "ANGEBOT", position: "HEAD", name: "Standard", body: "Alter Text", isDefault: false },
    });

    await ensureOrgTextTemplates(dbInternal, org.id);

    const rows = await dbInternal.textTemplate.findMany({ where: { orgId: org.id, docType: "ANGEBOT", position: "HEAD" } });
    expect(rows).toHaveLength(1); // Upsert legt nichts doppelt an
    expect(rows[0]!.isDefault).toBe(true); // Selbstheilung zieht den fehlenden Default nach
  });
});

describe("pickTextTemplate", () => {
  it("liefert den Default-Text", async () => {
    const org = await makeOrg("Pick GmbH");
    await ensureOrgTextTemplates(dbInternal, org.id);
    const body = await pickTextTemplate(dbInternal, org.id, "ANGEBOT", "HEAD");
    expect(body).toBe(DEFAULT_TEXT_TEMPLATES.find((t) => t.docType === "ANGEBOT" && t.position === "HEAD")!.body);
  });

  it("liefert die aelteste Vorlage, wenn keine als Default markiert ist", async () => {
    const org = await makeOrg("Pick2 GmbH");
    await dbInternal.textTemplate.create({
      data: { orgId: org.id, docType: "PROFORMA", position: "HEAD", name: "Erste", body: "Erster Text", isDefault: false, createdAt: new Date("2031-01-01T00:00:00.000Z") },
    });
    await dbInternal.textTemplate.create({
      data: { orgId: org.id, docType: "PROFORMA", position: "HEAD", name: "Zweite", body: "Zweiter Text", isDefault: false, createdAt: new Date("2031-01-02T00:00:00.000Z") },
    });
    const body = await pickTextTemplate(dbInternal, org.id, "PROFORMA", "HEAD");
    expect(body).toBe("Erster Text");
  });

  it("liefert null, wenn keine Vorlage existiert", async () => {
    const org = await makeOrg("Pick3 GmbH");
    const body = await pickTextTemplate(dbInternal, org.id, "PROFORMA", "TERMS_PAYMENT");
    expect(body).toBeNull();
  });
});
