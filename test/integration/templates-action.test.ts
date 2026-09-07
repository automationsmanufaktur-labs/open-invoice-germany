import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { dbInternal } from "@/lib/db";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { saveEmailTemplate } from "@/domain/email/templates";

let orgId: string;

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: {
      legalName: "Vorlagen-Test GmbH",
      addressLine1: "Teststr. 1",
      postalCode: "10115",
      city: "Berlin",
    },
  });
  orgId = org.id;
  await ensureOrgMasterdata(dbInternal, orgId);
});

afterAll(async () => {
  await dbInternal.$disconnect();
});

describe("saveEmailTemplate — docType-Schreibschutz", () => {
  it("uebernimmt bei Neuanlage den angegebenen docType", async () => {
    const created = await saveEmailTemplate(orgId, {
      name: "Neue Vorlage",
      docType: "INVOICE",
      subject: "Ihre Rechnung {{document.number}}",
      body: "Hallo,\n\nanbei Ihre Rechnung.",
      isDefault: false,
    });
    expect(created.docType).toBe("INVOICE");
  });

  it("ignoriert einen abweichenden docType aus der Eingabe bei einer Bestandsvorlage", async () => {
    const existing = await dbInternal.emailTemplate.create({
      data: {
        orgId,
        docType: "ANGEBOT",
        name: "Bestandsvorlage",
        subject: "Ihr Angebot {{document.number}}",
        body: "Hallo,\n\nanbei Ihr Angebot.",
        isDefault: false,
      },
    });

    const result = await saveEmailTemplate(orgId, {
      id: existing.id,
      name: "Bestandsvorlage (bearbeitet)",
      // Manipulationsversuch: docType weicht vom gespeicherten Wert ab.
      docType: "INVOICE",
      subject: "Ihr Angebot {{document.number}}",
      body: "Hallo,\n\nanbei Ihr aktualisiertes Angebot.",
      isDefault: false,
    });

    expect(result.docType).toBe("ANGEBOT");
    expect(result.name).toBe("Bestandsvorlage (bearbeitet)");

    const reloaded = await dbInternal.emailTemplate.findUniqueOrThrow({ where: { id: existing.id } });
    expect(reloaded.docType).toBe("ANGEBOT");
  });

  it("wirft bei unbekannter id (Fremd-Org oder erfunden)", async () => {
    await expect(
      saveEmailTemplate(orgId, {
        id: "does-not-exist",
        name: "x",
        docType: "INVOICE",
        subject: "x",
        body: "x",
        isDefault: false,
      }),
    ).rejects.toThrow("Vorlage nicht gefunden.");
  });
});
