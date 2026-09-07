import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { dbInternal } from "@/lib/db";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { DEFAULT_EMAIL_TEMPLATES } from "@/domain/masterdata/defaults";

let orgId: string;

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: {
      legalName: "Vorlagen-Test GmbH",
      addressLine1: "Teststr. 1",
      postalCode: "12345",
      city: "Berlin",
    },
  });
  orgId = org.id;
  await ensureOrgMasterdata(dbInternal, orgId);
});

afterAll(async () => {
  await dbInternal.$disconnect();
});

describe("Selbstheilung: Standard-E-Mail-Vorlagen", () => {
  it("legt alle Standardvorlagen an", async () => {
    const templates = await dbInternal.emailTemplate.findMany({ where: { orgId } });
    expect(templates).toHaveLength(DEFAULT_EMAIL_TEMPLATES.length);
    expect(templates).toHaveLength(10);
  });

  it("je Nicht-DUNNING-Typ genau eine Vorlage mit isDefault", async () => {
    const nonDunningTypes = [...new Set(DEFAULT_EMAIL_TEMPLATES.filter((t) => t.docType !== "DUNNING").map((t) => t.docType))];
    for (const docType of nonDunningTypes) {
      const defaults = await dbInternal.emailTemplate.findMany({ where: { orgId, docType, isDefault: true } });
      expect(defaults).toHaveLength(1);
    }
  });

  it("alle vier Mahnstufen sind mit der passenden Vorlage verknuepft", async () => {
    const stages = await dbInternal.dunningStage.findMany({ where: { orgId }, orderBy: { order: "asc" }, include: { emailTemplate: true } });
    expect(stages).toHaveLength(4);
    for (const stage of stages) {
      expect(stage.emailTemplateId).not.toBeNull();
      expect(stage.emailTemplate?.name).toBe(stage.name);
      expect(stage.emailTemplate?.docType).toBe("DUNNING");
    }
  });

  it("zweiter Aufruf aendert die Anzahl nicht", async () => {
    await ensureOrgMasterdata(dbInternal, orgId);
    const templates = await dbInternal.emailTemplate.findMany({ where: { orgId } });
    expect(templates).toHaveLength(10);
  });

  it("vom Nutzer geaenderte Vorlage wird bei erneuter Selbstheilung nicht ueberschrieben", async () => {
    const tpl = await dbInternal.emailTemplate.findFirstOrThrow({ where: { orgId, docType: "INVOICE", name: "Standard" } });
    await dbInternal.emailTemplate.update({ where: { id: tpl.id }, data: { subject: "Benutzerdefinierter Betreff" } });

    await ensureOrgMasterdata(dbInternal, orgId);

    const unchanged = await dbInternal.emailTemplate.findUniqueOrThrow({ where: { id: tpl.id } });
    expect(unchanged.subject).toBe("Benutzerdefinierter Betreff");
  });
});
