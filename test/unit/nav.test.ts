// test/unit/nav.test.ts
import { describe, it, expect } from "vitest";
import { NAV_GROUPS, SETTINGS_ITEMS, activeGroupKey, itemMatches } from "@/lib/nav";

describe("nav — aktive Gruppe/Item aus Pfad", () => {
  it("Übersicht nur bei exakt '/'", () => {
    expect(activeGroupKey("/", "")).toBe("home");
    expect(activeGroupKey("/rechnungen", "")).not.toBe("home");
  });
  it("Rechnungen-Detail gehört zu Verkauf", () => {
    expect(activeGroupKey("/rechnungen/abc123", "")).toBe("verkauf");
  });
  it("Gutschriften-Item matcht nur mit type=CREDIT_NOTE, Rechnungen-Item nur ohne", () => {
    const verkauf = NAV_GROUPS.find((g) => g.key === "verkauf")!;
    const rechnungen = verkauf.items.find((i) => i.label === "Rechnungen")!;
    const gutschriften = verkauf.items.find((i) => i.label === "Gutschriften")!;
    expect(itemMatches(gutschriften, "/rechnungen", "?type=CREDIT_NOTE")).toBe(true);
    expect(itemMatches(rechnungen, "/rechnungen", "?type=CREDIT_NOTE")).toBe(false);
    expect(itemMatches(rechnungen, "/rechnungen", "")).toBe(true);
    expect(itemMatches(rechnungen, "/rechnungen/neu", "")).toBe(true);
  });
  it("Dokumente-Items unterscheiden nach kind", () => {
    const verkauf = NAV_GROUPS.find((g) => g.key === "verkauf")!;
    const angebote = verkauf.items.find((i) => i.label === "Angebote")!;
    const ab = verkauf.items.find((i) => i.label === "Auftragsbestätigungen")!;
    expect(itemMatches(angebote, "/dokumente", "?kind=ANGEBOT")).toBe(true);
    expect(itemMatches(ab, "/dokumente", "?kind=ANGEBOT")).toBe(false);
    expect(itemMatches(angebote, "/dokumente", "")).toBe(true); // ohne kind: Angebote als Default aktiv
  });
  it("Einstellungen-Unterseiten gehören zu verwaltung", () => {
    expect(activeGroupKey("/einstellungen/briefpapier", "")).toBe("verwaltung");
    expect(activeGroupKey("/kunden/xyz", "")).toBe("verwaltung");
  });
  it("jede Gruppe hat eindeutige hrefs", () => {
    const hrefs = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
  it("SETTINGS_ITEMS[0] (Stammdaten) ist exact — matcht nicht auf Unterseiten", () => {
    expect(itemMatches(SETTINGS_ITEMS[0], "/einstellungen", "")).toBe(true);
    expect(itemMatches(SETTINGS_ITEMS[0], "/einstellungen/briefpapier", "")).toBe(false);
  });
  it("SETTINGS_ITEMS enthält kein /einstellungen/druckoptionen mehr (Phase 11b, Task 7: Reiter der Briefpapier-Seite, Route leitet um) und keine Duplikate/leeren Keys", () => {
    expect(SETTINGS_ITEMS.some((i) => i.href === "/einstellungen/druckoptionen")).toBe(false);
    const keys = SETTINGS_ITEMS.map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((k) => k.length > 0)).toBe(true);
  });
  it("Hint einer Detailseite ueberstimmt Pfad/Query (11a-M12: /dokumente/<id> als AB)", () => {
    const verkauf = NAV_GROUPS.find((g) => g.key === "verkauf")!;
    const ab = verkauf.items.find((i) => i.label === "Auftragsbestätigungen")!;
    const angebote = verkauf.items.find((i) => i.label === "Angebote")!;
    expect(itemMatches(ab, "/dokumente", "?kind=AUFTRAGSBESTAETIGUNG")).toBe(true);
    expect(itemMatches(angebote, "/dokumente", "?kind=AUFTRAGSBESTAETIGUNG")).toBe(false);
  });
});
