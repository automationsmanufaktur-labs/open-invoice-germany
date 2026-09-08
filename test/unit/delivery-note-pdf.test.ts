import { describe, it, expect } from "vitest";
import { buildDeliveryNotePdfData, type DeliveryNoteRow, type OrgRow, type CustomerRow } from "@/lib/pdf/delivery-note-data";
import { renderDeliveryNotePdf, type DeliveryNotePdfData } from "@/lib/pdf/delivery-note-pdf";
import { testPdfTheme, parsePdf } from "../helpers/pdf-theme";

const org: OrgRow = {
  id: "org-1",
  legalName: "Muster GmbH",
  addressLine1: "Weg 1",
  addressLine2: null,
  postalCode: "12345",
  city: "Ort",
  country: "DE",
  email: "a@b.de",
  phone: null,
  website: null,
  taxNumber: "33/123/45678",
  vatId: "DE123456789",
  kuIdNr: null,
  smallBusiness: false,
  defaultTaxScheme: "REGULAR",
  iban: "DE12500105170648489890",
  bic: "INGDDEFFXXX",
  bankName: "Testbank",
  electronicAddress: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as OrgRow;

const customer: CustomerRow = {
  id: "cust-1",
  orgId: "org-1",
  name: "Kunde AG",
  contactName: "Frau X",
  addressLine1: "Str. 2",
  addressLine2: null,
  postalCode: "54321",
  city: "Stadt",
  countryCode: "DE",
  type: "BUSINESS",
  vatId: null,
  email: "k@x.de",
  leitwegId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as CustomerRow;

function line(overrides: Partial<DeliveryNoteRow["lines"][number]> = {}): DeliveryNoteRow["lines"][number] {
  return {
    id: "l1",
    deliveryNoteId: "dn-1",
    position: 1,
    sourceType: null,
    sourceId: null,
    sourceLineId: null,
    description: "Testartikel",
    articleNumber: "ART-1",
    quantityMilli: 2000,
    unit: "C62",
    unitNetPriceCents: 1000,
    taxRate: 19,
    ...overrides,
  } as DeliveryNoteRow["lines"][number];
}

function deliveryNote(overrides: Partial<DeliveryNoteRow> = {}): DeliveryNoteRow {
  return {
    id: "dn-1",
    orgId: "org-1",
    customerId: "cust-1",
    number: "LS-2026-0001",
    status: "CREATED",
    issueDate: new Date("2026-06-01"),
    deliveryDate: new Date("2026-06-02"),
    shippingDate: null,
    showPrices: false,
    showTax: false,
    showArticleNumber: true,
    showDescription: true,
    showDeliveryAddress: true,
    printOptionsJson: null,
    notes: null,
    internalNotes: "GEHEIME INTERNE NOTIZ",
    headerText: null,
    footerText: null,
    sourceType: null,
    sourceId: null,
    sellerSnapshotJson: null,
    buyerSnapshotJson: null,
    snapshotSource: null,
    snapshotAt: null,
    sentAt: null,
    deliveredAt: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lines: [line()],
    ...overrides,
  } as unknown as DeliveryNoteRow;
}

describe("buildDeliveryNotePdfData", () => {
  it("ohne showPrices: Zeilen tragen keine Preise im Renderergebnis, aber Flags spiegeln Eingabe", () => {
    const data = buildDeliveryNotePdfData(deliveryNote({ showPrices: false, showTax: false }), org, customer);
    expect(data.showPrices).toBe(false);
    expect(data.showTax).toBe(false);
    expect(data.lines[0]!.unitNetPriceCents).toBe(1000); // Rohdaten bleiben erhalten, PDF blendet sie nur aus
  });

  it("Artikelnummer-Spalte nur bei showArticleNumber (Flag wird durchgereicht)", () => {
    const mitFlag = buildDeliveryNotePdfData(deliveryNote({ showArticleNumber: true }), org, customer);
    const ohneFlag = buildDeliveryNotePdfData(deliveryNote({ showArticleNumber: false }), org, customer);
    expect(mitFlag.showArticleNumber).toBe(true);
    expect(ohneFlag.showArticleNumber).toBe(false);
  });

  it("internalNotes erreicht die PDF-Daten strukturell nicht", () => {
    const data = buildDeliveryNotePdfData(deliveryNote(), org, customer);
    expect(JSON.stringify(data)).not.toContain("GEHEIME INTERNE NOTIZ");
  });

  it("Kopf-/Fusstext wird mit Platzhaltern gerendert (Nummer aufgeloest)", () => {
    const data = buildDeliveryNotePdfData(
      deliveryNote({ headerText: "Lieferschein {{document.number}}", footerText: "Danke, {{customer.name}}!" }),
      org,
      customer,
    );
    expect(data.headerText).toBe("Lieferschein LS-2026-0001");
    expect(data.footerText).toBe("Danke, Kunde AG!");
  });

  it("Snapshot bevorzugt: sellerSnapshotJson/buyerSnapshotJson ueberschreiben den Live-Stamm", () => {
    const sellerSnapshot = JSON.stringify({
      legalName: "Alt GmbH",
      addressLine1: "Alte Str. 1",
      addressLine2: null,
      postalCode: "00000",
      city: "Altstadt",
      country: "DE",
      vatId: null,
      taxNumber: null,
      email: null,
      phone: null,
      electronicAddress: null,
      iban: null,
      bic: null,
      bankName: null,
    });
    const data = buildDeliveryNotePdfData(deliveryNote({ sellerSnapshotJson: sellerSnapshot }), org, customer);
    expect(data.seller.name).toBe("Alt GmbH");
    expect(data.seller.city).toBe("Altstadt");
  });

  it("ohne Snapshot: Live-Stamm als Fallback", () => {
    const data = buildDeliveryNotePdfData(deliveryNote(), org, customer);
    expect(data.seller.name).toBe("Muster GmbH");
    expect(data.buyer.name).toBe("Kunde AG");
  });

  it("S7 (Fix-Welle): eine uebergebene Standard-SHIPPING-Adresse landet unveraendert in deliveryAddress; ohne sie ist es null", () => {
    const withAddress = buildDeliveryNotePdfData(deliveryNote(), org, customer, null, {
      addressLine1: "Lagerhalle 7",
      addressLine2: null,
      postalCode: "88888",
      city: "Werksstadt",
    });
    expect(withAddress.deliveryAddress).toEqual({ addressLine1: "Lagerhalle 7", addressLine2: null, postalCode: "88888", city: "Werksstadt" });

    const withoutAddress = buildDeliveryNotePdfData(deliveryNote(), org, customer);
    expect(withoutAddress.deliveryAddress).toBeNull();
  });

  it("B5 (Fix-Welle): Snapshot-Lieferadresse hat Vorrang vor der Live-Fallback-Adresse — ein spaeterer Default-Wechsel aendert den Nachdruck nicht", () => {
    const buyerSnapshotJson = JSON.stringify({
      name: "Kunde AG",
      contactName: null,
      addressLine1: "Str. 2",
      addressLine2: null,
      postalCode: "54321",
      city: "Stadt",
      countryCode: "DE",
      vatId: null,
      email: null,
      leitwegId: null,
      shippingAddress: {
        type: "SHIPPING",
        label: null,
        addressLine1: "Lagerhalle 7 (Snapshot)",
        addressLine2: null,
        postalCode: "88888",
        city: "Werksstadt",
        countryCode: "DE",
      },
    });
    const data = buildDeliveryNotePdfData(deliveryNote({ buyerSnapshotJson }), org, customer, null, {
      // Live-Fallback zeigt eine ANDERE (spaeter geaenderte) Standardadresse — muss ignoriert werden.
      addressLine1: "Neue Default-Adresse (Live)",
      addressLine2: null,
      postalCode: "77777",
      city: "Neustadt",
    });
    expect(data.deliveryAddress).toEqual({ addressLine1: "Lagerhalle 7 (Snapshot)", addressLine2: null, postalCode: "88888", city: "Werksstadt" });
  });
});

describe("renderDeliveryNotePdf", () => {
  it("liefert ein PDF (Buffer beginnt mit %PDF), auch ohne Preise/Artikelnummer/Beschreibung", async () => {
    const data = buildDeliveryNotePdfData(
      deliveryNote({ showPrices: false, showArticleNumber: false, showDescription: false, lines: [line(), line({ id: "l2", position: 2 })] }),
      org,
      customer,
    );
    const pdf = await renderDeliveryNotePdf(data, testPdfTheme());
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("liefert ein PDF mit Preisen, USt und Kopf-/Fusstext", async () => {
    const data = buildDeliveryNotePdfData(
      deliveryNote({ showPrices: true, showTax: true, headerText: "Kopf {{document.number}}", footerText: "Fuss" }),
      org,
      customer,
    );
    const pdf = await renderDeliveryNotePdf(data, testPdfTheme());
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("Fix-Runde 1 (Koordinator, Punkt 2): der Summenblock bricht bei 70 Positionen auf eine eigene Seite um, OHNE den Tabellenkopf zu wiederholen", async () => {
    // Empirisch ermittelt (Testkommentar statt Magiezahl-Erklaerung): bei den Default-
    // Raendern fuellen 70 Zeilen (16pt/Zeile) die ersten beiden Seiten bis knapp vor den
    // unteren Rand, sodass der Summenblock (Linie + bis zu drei Summenzeilen) auf eine
    // DRITTE, ansonsten leere Seite ausweicht. Vorher nutzte der Summenblock denselben
    // `ensureSpace`-Helfer wie die Positionszeilen — der zeichnet bei jedem Seitenumbruch
    // den Tabellenkopf ("Beschreibung" etc.) neu, auch wenn die neue Seite gar keine
    // Positionszeile mehr traegt. "Beschreibung" darf daher NUR auf den beiden
    // positionstragenden Seiten stehen (numpages - 1 bei einer summen-only letzten Seite),
    // nicht ein drittes Mal auf der reinen Summenseite.
    // Fix-Runde 2 (Koordinator, Critical): `pageBottom` reserviert jetzt zusaetzlich
    // `layout.footerHeight + 6pt` fuer die auf jeder Seite gezeichnete Fusszeile (Fix-
    // Runde 1, Punkt 6) — die Zeilenkapazitaet je Seite sank dadurch, der Schwellenwert
    // (Debug-Sweep n=55..75) verschob sich von 75 auf 70 Zeilen (bei n=72/75 tragen jetzt
    // bereits beide Positionsseiten VOLL, sodass "nur" numpages=3 UND beschCount=numpages-1
    // erst wieder bei sehr viel groesseren n gilt — 70 bleibt der naechste stabile Wert
    // mit derselben "zwei Positionsseiten + eine reine Summenseite"-Form).
    const lineCount = 70;
    const lines: DeliveryNotePdfData["lines"] = Array.from({ length: lineCount }, (_, i) => ({
      pos: i + 1,
      description: `Testartikel ${i + 1}`,
      quantityMilli: 1000,
      unit: "C62",
      unitNetPriceCents: 1000,
      taxRate: 19,
    }));
    const data: DeliveryNotePdfData = {
      number: "LS-2026-0099",
      issueDate: new Date("2026-06-01"),
      currency: "EUR",
      seller: { name: "Muster GmbH", addressLine1: "Hauptstr. 1", postalCode: "12345", city: "Berlin" },
      buyer: { name: "Kunde AG", addressLine1: "Kundenweg 2", postalCode: "54321", city: "Stadt" },
      lines,
      showPrices: true,
      showTax: true,
      showArticleNumber: false,
      showDescription: true,
      showDeliveryAddress: false,
    };
    const pdf = await renderDeliveryNotePdf(data, testPdfTheme());
    const { text, numpages } = await parsePdf(pdf);
    expect(numpages).toBe(3);
    expect(text).toContain(`Testartikel ${lineCount}`);
    expect(text).toContain("Gesamtbetrag");
    const beschreibungCount = (text.match(/Beschreibung/g) ?? []).length;
    expect(beschreibungCount).toBe(numpages - 1);
  });
});
