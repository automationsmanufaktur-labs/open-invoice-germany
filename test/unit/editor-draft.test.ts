import { describe, it, expect } from "vitest";
import { draftReducer, emptyDraft, toInvoicePayload, toDocumentPayload, toDeliveryNotePayload, draftFromInvoice, validateDraft } from "@/lib/editor/draft";
import { createInvoiceSchema, updateInvoiceSchema, createDocumentSchema, createDeliveryNoteSchema } from "@/schemas";

function invoiceDraft() {
  let s = emptyDraft("INVOICE");
  s = draftReducer(s, { type: "set", field: "customerId", value: "c1" });
  s = draftReducer(s, { type: "setLine", key: s.lines[0]!.key, patch: { description: "Beratung", quantity: "2", price: "95,00", unit: "HUR" } });
  s = draftReducer(s, { type: "addLine", lineType: "HEADING" });
  s = draftReducer(s, { type: "setLine", key: s.lines[1]!.key, patch: { description: "Abschnitt" } });
  return s;
}

describe("editor/draft", () => {
  it("emptyDraft startet mit einer leeren ITEM-Zeile und ist nicht dirty", () => {
    const s = emptyDraft("INVOICE");
    expect(s.lines).toHaveLength(1); expect(s.lines[0]!.lineType).toBe("ITEM"); expect(s.lines[0]!.unit).toBe("C62"); expect(s.dirty).toBe(false);
  });
  it("set/setLine markieren dirty; markSaved setzt zurueck", () => {
    let s = draftReducer(emptyDraft("INVOICE"), { type: "set", field: "subject", value: "Test" });
    expect(s.dirty).toBe(true); s = draftReducer(s, { type: "markSaved" }); expect(s.dirty).toBe(false);
  });
  it("addLine/duplicateLine/moveLine/removeLine", () => {
    let s = emptyDraft("DOCUMENT");
    const k0 = s.lines[0]!.key;
    s = draftReducer(s, { type: "addLine", lineType: "TEXT", after: k0 });
    expect(s.lines.map((l) => l.lineType)).toEqual(["ITEM", "TEXT"]);
    s = draftReducer(s, { type: "duplicateLine", key: k0 });
    expect(s.lines.map((l) => l.lineType)).toEqual(["ITEM", "ITEM", "TEXT"]);
    expect(s.lines[1]!.key).not.toBe(k0);
    s = draftReducer(s, { type: "moveLine", key: s.lines[2]!.key, to: 0 });
    expect(s.lines[0]!.lineType).toBe("TEXT");
    s = draftReducer(s, { type: "removeLine", key: s.lines[0]!.key });
    expect(s.lines).toHaveLength(2);
    s = draftReducer(s, { type: "removeLine", key: s.lines[0]!.key }); s = draftReducer(s, { type: "removeLine", key: s.lines[0]!.key });
    expect(s.lines).toHaveLength(1); // nie leer: letzte Zeile wird durch eine leere ITEM-Zeile ersetzt
  });
  it("applyProduct uebernimmt Preis/Einheit/Steuer/Artikelnummer als Anzeige-Strings", () => {
    let s = emptyDraft("INVOICE");
    s = draftReducer(s, { type: "applyProduct", key: s.lines[0]!.key, product: { id: "p1", name: "Lizenz", unit: "C62", netPriceCents: 24000, taxRate: 19, articleNumber: "LZ-1" } });
    expect(s.lines[0]).toMatchObject({ description: "Lizenz", price: "240,00", unit: "C62", taxRate: 19, articleNumber: "LZ-1", productId: "p1" });
  });
  it("toInvoicePayload ergibt ein gueltiges createInvoiceSchema-Objekt (Neuanlage) und updateInvoiceSchema (Bearbeiten)", () => {
    const s = invoiceDraft();
    const create = createInvoiceSchema.safeParse(toInvoicePayload(s, false));
    expect(create.success, JSON.stringify(create.error?.issues)).toBe(true);
    if (create.success) {
      expect(create.data.lines[0]).toMatchObject({ quantityMilli: 2000, unitNetPriceCents: 9500, unit: "HUR", taxRate: 19, lineType: "ITEM" });
      expect(create.data.lines[1]).toMatchObject({ lineType: "HEADING", quantityMilli: 0, unitNetPriceCents: 0 });
      expect(create.data.type).toBe("INVOICE"); expect(create.data.currency).toBe("EUR");
    }
    const update = updateInvoiceSchema.safeParse(toInvoicePayload(s, true));
    expect(update.success).toBe(true);
    expect("type" in toInvoicePayload(s, true)).toBe(false);
  });
  it("Kleinunternehmer: Steuersatz 0/Kategorie E und Hinweis in notes", () => {
    let s = invoiceDraft(); s = draftReducer(s, { type: "set", field: "taxScheme", value: "KLEINUNTERNEHMER" });
    const p = createInvoiceSchema.parse(toInvoicePayload(s, false));
    expect(p.lines[0]).toMatchObject({ taxRate: 0, taxCategory: "E" }); expect(p.notes ?? "").toContain("§ 19");
  });
  // Fix 1 (Koordinator, Task 5): toInvoicePayload stellte den Pflichthinweis bisher
  // UNBEDINGT voran — ein zweiter Speicher-Durchlauf (z. B. Bearbeiten eines bereits
  // gespeicherten Entwurfs, oder erneutes Klicken auf "Pflichthinweis einfuegen") liess
  // `notes` bei jedem Aufruf erneut wachsen. Jetzt nur voranstellen, wenn `notes` noch
  // KEINE fuer das Schema akzeptierte Formulierung enthaelt (SCHEME_NOTICE_ACCEPTED).
  it("Pflichthinweis wird nicht verdoppelt, wenn notes ihn bereits enthaelt (zwei toInvoicePayload-Durchlaeufe)", () => {
    let s = invoiceDraft();
    s = draftReducer(s, { type: "set", field: "taxScheme", value: "KLEINUNTERNEHMER" });
    s = draftReducer(s, { type: "set", field: "notes", value: "Kleinunternehmer gemäß § 19 UStG, kein Ausweis von Umsatzsteuer" });
    const first = toInvoicePayload(s, true) as { notes?: string };
    expect(first.notes).toBe("Kleinunternehmer gemäß § 19 UStG, kein Ausweis von Umsatzsteuer");
    const second = toInvoicePayload(s, true) as { notes?: string };
    expect(second.notes).toBe(first.notes);
  });
  it("Pflichthinweis wird bei leerem notes genau einmal ergaenzt", () => {
    let s = invoiceDraft();
    s = draftReducer(s, { type: "set", field: "taxScheme", value: "REVERSE_CHARGE" });
    const p = toInvoicePayload(s, false) as { notes?: string };
    expect(p.notes).toBe("Steuerschuldnerschaft des Leistungsempfängers");
  });
  it("Pflichthinweis bleibt unveraendert bei einer anderen zulaessigen § 25a-Formulierung", () => {
    let s = invoiceDraft();
    s = draftReducer(s, { type: "set", field: "taxScheme", value: "DIFFERENZ" });
    s = draftReducer(s, { type: "set", field: "notes", value: "Kunstgegenstände/Sonderregelung (§ 25a UStG)" });
    const p = toInvoicePayload(s, true) as { notes?: string };
    expect(p.notes).toBe("Kunstgegenstände/Sonderregelung (§ 25a UStG)");
  });
  // Fix 1 (Koordinator, Task 5): consumerRetentionHint (§ 14b) muss unveraendert durch
  // draftFromInvoice -> toInvoicePayload durchgereicht werden — auch wenn initial es
  // (Alt-Aufrufer/Test-Fixture) gar nicht mitliefert (draftFromInvoice faellt auf false
  // zurueck, siehe InvoiceInitialLike.consumerRetentionHint).
  it("consumerRetentionHint: Rundtrip draftFromInvoice -> toInvoicePayload (true/false/undefined)", () => {
    const withTrue = draftFromInvoice({ id: "i1", customerId: "c1", taxScheme: "REGULAR", consumerRetentionHint: true, lines: [] } as never);
    expect(withTrue.consumerRetentionHint).toBe(true);
    expect((toInvoicePayload(withTrue, true) as { consumerRetentionHint?: boolean }).consumerRetentionHint).toBe(true);

    const withFalse = draftFromInvoice({ id: "i2", customerId: "c1", taxScheme: "REGULAR", consumerRetentionHint: false, lines: [] } as never);
    expect(withFalse.consumerRetentionHint).toBe(false);
    expect((toInvoicePayload(withFalse, true) as { consumerRetentionHint?: boolean }).consumerRetentionHint).toBe(false);

    const withUndefined = draftFromInvoice({ id: "i3", customerId: "c1", taxScheme: "REGULAR", lines: [] } as never);
    expect(withUndefined.consumerRetentionHint).toBe(false);
    expect((toInvoicePayload(withUndefined, true) as { consumerRetentionHint?: boolean }).consumerRetentionHint).toBe(false);
  });
  it("toDocumentPayload/toDeliveryNotePayload sind schema-gueltig", () => {
    let d = emptyDraft("DOCUMENT"); d = draftReducer(d, { type: "set", field: "customerId", value: "c1" });
    d = draftReducer(d, { type: "setLine", key: d.lines[0]!.key, patch: { description: "Pos", quantity: "1", price: "10" } });
    expect(createDocumentSchema.safeParse(toDocumentPayload(d, false)).success).toBe(true);
    let n = emptyDraft("DELIVERY_NOTE"); n = draftReducer(n, { type: "set", field: "customerId", value: "c1" });
    n = draftReducer(n, { type: "setLine", key: n.lines[0]!.key, patch: { description: "Ware", quantity: "3" } });
    expect(createDeliveryNoteSchema.safeParse(toDeliveryNotePayload(n)).success).toBe(true);
  });
  // Fix 2 (Task-1-Review, Ruling nach Task 4): shippingDate/internalNotes sind in
  // createDeliveryNoteSchema vorhanden — der Editor sendet sie mit.
  it("toDeliveryNotePayload sendet shippingDate und internalNotes", () => {
    let n = emptyDraft("DELIVERY_NOTE"); n = draftReducer(n, { type: "set", field: "customerId", value: "c1" });
    n = draftReducer(n, { type: "setLine", key: n.lines[0]!.key, patch: { description: "Ware", quantity: "3" } });
    n = draftReducer(n, { type: "set", field: "shippingDate", value: "2026-09-10" });
    n = draftReducer(n, { type: "set", field: "internalNotes", value: "Nur intern" });
    const payload = toDeliveryNotePayload(n) as { shippingDate?: string; internalNotes?: string };
    expect(payload.shippingDate).toBe("2026-09-10");
    expect(payload.internalNotes).toBe("Nur intern");
    expect(createDeliveryNoteSchema.safeParse(payload).success).toBe(true);
  });
  // Fix 2 (Task-1-Review, Ruling nach Task 4): createDraftInvoice waehlt die
  // INVOICE-HEAD/FOOT-Textvorlage nur, wenn headerText/footerText UNDEFINED ist
  // (`input.headerText ?? pickTextTemplate(...)`) — bei Neuanlage darf ein leeres Feld
  // also nicht als "" gesendet werden. updateDraftInvoice liest dagegen jeden Wert
  // !== undefined (auch ""), beim Bearbeiten wird der String daher immer gesendet.
  it("headerText/footerText: bei Neuanlage nur wenn gesetzt (sonst greift die Textvorlagen-Auswahl), beim Bearbeiten immer", () => {
    const s = invoiceDraft();
    const createEmpty = toInvoicePayload(s, false) as { headerText?: string; footerText?: string };
    expect(createEmpty.headerText).toBeUndefined();
    expect(createEmpty.footerText).toBeUndefined();
    expect(createInvoiceSchema.safeParse(createEmpty).success).toBe(true);

    let withText = draftReducer(s, { type: "set", field: "headerText", value: "Kopftext" });
    withText = draftReducer(withText, { type: "set", field: "footerText", value: "Fusstext" });
    const createWithText = createInvoiceSchema.parse(toInvoicePayload(withText, false));
    expect(createWithText.headerText).toBe("Kopftext");
    expect(createWithText.footerText).toBe("Fusstext");

    const edit = updateInvoiceSchema.parse(toInvoicePayload(s, true));
    expect(edit.headerText).toBe("");
    expect(edit.footerText).toBe("");
  });
  it("draftFromInvoice rundet Cent/Milli/Permille in Anzeige-Strings und zurueck", () => {
    const s = draftFromInvoice({
      id: "i1",
      customerId: "c1",
      taxScheme: "REGULAR",
      subject: "S",
      headerText: "Kopftext",
      lines: [{ lineType: "ITEM", description: "A", descriptionLong: "", articleNumber: "", quantity: "1,5", unit: "C62", price: "12,34", taxRate: 19, discountPercent: "10", discountAmount: "" }],
    } as never);
    expect(s.id).toBe("i1"); expect(s.lines[0]!.price).toBe("12,34"); expect(s.dirty).toBe(false);
    expect(s.headerText).toBe("Kopftext");
    const p = updateInvoiceSchema.parse(toInvoicePayload(s, true));
    expect(p.lines?.[0]).toMatchObject({ quantityMilli: 1500, unitNetPriceCents: 1234, discountPermille: 100 });
  });
  // Task-5-Fix (Minor): toggleExpanded ist eine eigene Aktion statt `setLine`, damit das
  // Ein-/Ausblenden des Langtexts (reine Anzeige) kein `dirty: true` ausloest.
  it("toggleExpanded schaltet expanded um, ohne dirty zu setzen", () => {
    let s = emptyDraft("INVOICE");
    const key = s.lines[0]!.key;
    expect(s.lines[0]!.expanded).toBe(false);
    s = draftReducer(s, { type: "toggleExpanded", key });
    expect(s.lines[0]!.expanded).toBe(true);
    expect(s.dirty).toBe(false);
    s = draftReducer(s, { type: "toggleExpanded", key });
    expect(s.lines[0]!.expanded).toBe(false);
    expect(s.dirty).toBe(false);
  });
  // Ruling (Task-5-Fix): "Typ ändern" im LineRowMenu nutzt die bestehende `setLine`-
  // Aktion (kein dediziertes `setLineType` noetig, da `lineType` ein normales
  // `DraftLine`-Feld ist) — bleibt dabei (anders als toggleExpanded) `dirty`, da es
  // eine inhaltliche Aenderung am Beleg ist.
  it("setLine mit patch.lineType aendert den Zeilentyp und bleibt dirty", () => {
    let s = emptyDraft("DOCUMENT");
    const key = s.lines[0]!.key;
    expect(s.lines[0]!.lineType).toBe("ITEM");
    s = draftReducer(s, { type: "setLine", key, patch: { lineType: "HEADING" } });
    expect(s.lines[0]!.lineType).toBe("HEADING");
    expect(s.dirty).toBe(true);
  });
  it("validateDraft nennt fehlenden Kunden, fehlende Position und ungueltigen Preis", () => {
    let s = emptyDraft("INVOICE");
    expect(validateDraft(s)).toEqual(expect.arrayContaining([expect.stringContaining("Kunde")]));
    s = draftReducer(s, { type: "set", field: "customerId", value: "c1" });
    s = draftReducer(s, { type: "setLine", key: s.lines[0]!.key, patch: { description: "x", quantity: "1", price: "abc" } });
    expect(validateDraft(s).join(" ")).toContain("Preis");
  });
  // I4 (Abschluss-Review): serverseitig verlangt invoiceLineInputSchema/
  // deliveryNoteLineInputSchema description: z.string().min(1) fuer JEDE Zeile —
  // validateDraft prueft das jetzt vorab fuer ITEM/HEADING/TEXT, damit z. B. eine durch
  // "Enter" versehentlich angelegte leere ITEM-Zeile nicht erst als feldloses
  // "Validierung fehlgeschlagen"-Banner vom Server zurueckkommt.
  it("validateDraft nennt fehlende Beschreibung bei ITEM/HEADING/TEXT", () => {
    let s = emptyDraft("INVOICE");
    s = draftReducer(s, { type: "set", field: "customerId", value: "c1" });
    // ITEM-Zeile ohne Beschreibung, aber mit gueltiger Menge/Preis (damit nur die
    // Beschreibungspruefung anschlaegt).
    s = draftReducer(s, { type: "setLine", key: s.lines[0]!.key, patch: { quantity: "1", price: "10" } });
    expect(validateDraft(s).join(" ")).toContain("Beschreibung");

    let h = emptyDraft("INVOICE");
    h = draftReducer(h, { type: "set", field: "customerId", value: "c1" });
    h = draftReducer(h, { type: "setLine", key: h.lines[0]!.key, patch: { description: "x", quantity: "1", price: "10" } });
    h = draftReducer(h, { type: "addLine", lineType: "HEADING" });
    expect(validateDraft(h).join(" ")).toContain("Beschreibung");

    let t = emptyDraft("INVOICE");
    t = draftReducer(t, { type: "set", field: "customerId", value: "c1" });
    t = draftReducer(t, { type: "setLine", key: t.lines[0]!.key, patch: { description: "x", quantity: "1", price: "10" } });
    t = draftReducer(t, { type: "addLine", lineType: "TEXT" });
    expect(validateDraft(t).join(" ")).toContain("Beschreibung");
  });
  it("validateDraft lehnt eine SUBTOTAL-Zeile ohne Beschreibung NICHT ab (Koordinator-Ruling)", () => {
    let s = emptyDraft("INVOICE");
    s = draftReducer(s, { type: "set", field: "customerId", value: "c1" });
    s = draftReducer(s, { type: "setLine", key: s.lines[0]!.key, patch: { description: "x", quantity: "1", price: "10" } });
    s = draftReducer(s, { type: "addLine", lineType: "SUBTOTAL" });
    expect(validateDraft(s)).toEqual([]);
  });
  // I1/I2 (Abschluss-Review): der Editor zeigt Kopf-/Fusstext und den
  // "Lieferadresse anzeigen"-Schalter auch fuer Lieferscheine (HeadTextBlock/
  // FootTextBlock/MoreOptions rendern sie fuer ALLE drei Modi) — toDeliveryNotePayload
  // sendete sie vorher nicht, obwohl createDeliveryNoteSchema beide Felder kennt.
  it("toDeliveryNotePayload sendet headerText/footerText/showDeliveryAddress", () => {
    let n = emptyDraft("DELIVERY_NOTE");
    n = draftReducer(n, { type: "set", field: "customerId", value: "c1" });
    n = draftReducer(n, { type: "setLine", key: n.lines[0]!.key, patch: { description: "Ware", quantity: "3" } });
    n = draftReducer(n, { type: "set", field: "headerText", value: "Kopftext" });
    n = draftReducer(n, { type: "set", field: "footerText", value: "Fusstext" });
    n = draftReducer(n, { type: "set", field: "showDeliveryAddress", value: false });
    const payload = toDeliveryNotePayload(n) as { headerText?: string; footerText?: string; showDeliveryAddress?: boolean };
    expect(payload.headerText).toBe("Kopftext");
    expect(payload.footerText).toBe("Fusstext");
    expect(payload.showDeliveryAddress).toBe(false);
    expect(createDeliveryNoteSchema.safeParse(payload).success).toBe(true);
  });
});
