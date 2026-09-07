import { describe, it, expect } from "vitest";
import { renderTemplate } from "@/lib/template/render";
import { formatDateDe, formatMoneyDe } from "@/lib/template/format";

describe("renderTemplate", () => {
  const ctx = { customer: { name: "Kunde AG" }, document: { number: "RE-2026-0001", total: "1.234,56 €" }, company: { name: "Test GmbH" } };
  it("ersetzt Pfade", () => {
    expect(renderTemplate("Rechnung {{document.number}} von {{company.name}}", ctx).text).toBe("Rechnung RE-2026-0001 von Test GmbH");
  });
  it("fehlende Pfade -> leer + Warnung, kein Throw", () => {
    const r = renderTemplate("Hallo {{customer.firstName}}!", ctx);
    expect(r.text).toBe("Hallo !");
    expect(r.warnings).toEqual(["Unbekannter Platzhalter {{customer.firstName}}"]);
  });
  it("Leerzeichen in Klammern toleriert, Nicht-Platzhalter bleiben", () => {
    expect(renderTemplate("{{ customer.name }} {not} {{}}", ctx).text).toBe("Kunde AG {not} {{}}");
  });
  it("Zahlen und Booleans werden als Text ausgegeben, Objekte nicht", () => {
    const r = renderTemplate("{{a}} {{b}} {{c}}", { a: 5, b: true, c: { x: 1 } });
    expect(r.text).toBe("5 true ");
    expect(r.warnings).toHaveLength(1);
  });
});

describe("format", () => {
  it("Datum", () => expect(formatDateDe(new Date("2026-06-09T10:00:00Z"))).toBe("09.06.2026"));
  it("Datum leer", () => expect(formatDateDe(null)).toBe(""));
  it("Geld", () => expect(formatMoneyDe(123456)).toBe("1.234,56 €"));
  it("Geld negativ + Waehrung", () => expect(formatMoneyDe(-5, "CHF")).toBe("-0,05 CHF"));
});
