import { describe, it, expect } from "vitest";
import { draftReducer, emptyDraft, toInvoicePayload } from "@/lib/editor/draft";
import { computeDraftTotals } from "@/lib/editor/totals";
describe("editor/totals", () => {
  it("Netto, Rabatt, Steuer je Satz, Brutto, Zwischensumme", () => {
    let s = emptyDraft("INVOICE");
    s = draftReducer(s, { type: "setLine", key: s.lines[0]!.key, patch: { description: "A", quantity: "2", price: "100", taxRate: 19, discountPercent: "10" } });
    s = draftReducer(s, { type: "addLine", lineType: "ITEM" });
    s = draftReducer(s, { type: "setLine", key: s.lines[1]!.key, patch: { description: "B", quantity: "1", price: "50", taxRate: 7 } });
    s = draftReducer(s, { type: "addLine", lineType: "SUBTOTAL" });
    s = draftReducer(s, { type: "set", field: "documentDiscountPercent", value: "5" });
    const t = computeDraftTotals(s);
    expect(t.lineNetCents).toBe(18000 + 5000);
    expect(t.subtotals[2]).toBe(23000);
    expect(t.allowanceCents).toBe(1150);
    expect(t.netCents).toBe(21850);
    expect(t.taxRows.map((r) => r.rate)).toEqual([19, 7]);
    expect(t.grossCents).toBe(t.netCents + t.taxCents);
    expect(t.error).toBeNull();
  });
  it("Kleinunternehmer: keine Steuer", () => {
    let s = emptyDraft("INVOICE"); s = draftReducer(s, { type: "set", field: "taxScheme", value: "KLEINUNTERNEHMER" });
    s = draftReducer(s, { type: "setLine", key: s.lines[0]!.key, patch: { description: "A", quantity: "1", price: "100", taxRate: 19 } });
    const t = computeDraftTotals(s); expect(t.taxCents).toBe(0); expect(t.grossCents).toBe(10000);
  });
  it("ungueltige Eingabe liefert error statt zu werfen", () => {
    let s = emptyDraft("INVOICE"); s = draftReducer(s, { type: "setLine", key: s.lines[0]!.key, patch: { description: "A", quantity: "1", price: "x" } });
    expect(computeDraftTotals(s).error).not.toBeNull();
  });
  // Fix 1 (Task-1-Review): Positions- und Beleg-Rabatt > 100 % duerfen die Live-Summe
  // nicht in einen Fehler laufen lassen (computeLineNet wirft sonst bei discountPermille
  // > 1000) — sie werden wie im Payload-Mapper auf 1000 Promille geklemmt, mit exakt
  // demselben Ergebnis, das toInvoicePayload tatsaechlich sendet.
  it("Rabatt-Prozent > 100% (Position und Beleg) wird wie im Payload auf 1000 Promille geklemmt statt einen Fehler auszuloesen", () => {
    let s = emptyDraft("INVOICE");
    s = draftReducer(s, { type: "setLine", key: s.lines[0]!.key, patch: { description: "A", quantity: "1", price: "100", discountPercent: "150" } });
    s = draftReducer(s, { type: "addLine", lineType: "ITEM" });
    s = draftReducer(s, { type: "setLine", key: s.lines[1]!.key, patch: { description: "B", quantity: "1", price: "100" } });
    s = draftReducer(s, { type: "set", field: "documentDiscountPercent", value: "150" });

    const t = computeDraftTotals(s);
    expect(t.error).toBeNull();
    // Position A: 100,00 € abzueglich auf 100 % geklemmtem Rabatt -> 0. Position B ohne
    // Rabatt -> 100,00 €. Summe vor Beleganpassung 100,00 €.
    expect(t.lineNetCents).toBe(0 + 10000);
    // Belegrabatt ebenfalls auf 100 % geklemmt -> zieht die gesamte Nettosumme ab.
    expect(t.allowanceCents).toBe(10000);
    expect(t.netCents).toBe(0);
    expect(t.grossCents).toBe(0);

    const payload = toInvoicePayload(s, false) as { lines: { discountPermille: number }[]; documentDiscountPermille: number };
    expect(payload.lines[0]!.discountPermille).toBe(1000);
    expect(payload.documentDiscountPermille).toBe(1000);
  });
});
