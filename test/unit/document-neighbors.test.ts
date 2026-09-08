import { describe, it, expect } from "vitest";
import { neighborIds, parseListeQuery, buildListeParam } from "@/domain/document/neighbors";

describe("neighborIds", () => {
  it("liefert Vorgaenger/Nachfolger in Listenreihenfolge (neuester zuerst)", () => {
    expect(neighborIds(["c", "b", "a"], "b")).toEqual({ prevId: "c", nextId: "a" });
  });
  it("Randfaelle: erster/letzter/unbekannt/leer", () => {
    expect(neighborIds(["c", "b", "a"], "c")).toEqual({ prevId: null, nextId: "b" });
    expect(neighborIds(["c", "b", "a"], "a")).toEqual({ prevId: "b", nextId: null });
    expect(neighborIds(["c", "b", "a"], "x")).toEqual({ prevId: null, nextId: null });
    expect(neighborIds([], "x")).toEqual({ prevId: null, nextId: null });
  });
});

describe("parseListeQuery", () => {
  it("akzeptiert eine Listen-Query und verwirft unbekannte Schluessel", () => {
    const p = parseListeQuery("status=open&q=Meier&type=INVOICE&offset=50&evil=1")!;
    expect(p.get("status")).toBe("open");
    expect(p.get("q")).toBe("Meier");
    expect(p.get("offset")).toBe("50");
    expect(p.has("evil")).toBe(false);
  });
  it("lehnt Leerwert, Ueberlaenge und fremde Zeichen ab", () => {
    expect(parseListeQuery(undefined)).toBeNull();
    expect(parseListeQuery("")).toBeNull();
    expect(parseListeQuery("q=" + "a".repeat(600))).toBeNull();
    expect(parseListeQuery("q=<script>")).toBeNull();
  });
  it("erlaubt * (Task-1-Review-Nachtrag: URLSearchParams laesst es unescaped)", () => {
    const p = parseListeQuery("q=Foo*Bar&status=open")!;
    expect(p.get("q")).toBe("Foo*Bar");
  });
  it("buildListeParam laesst leere Werte weg und ist per parseListeQuery lesbar", () => {
    const s = buildListeParam({ q: "Meier", status: undefined, kind: "ANGEBOT", offset: "" });
    expect(s).toBe("q=Meier&kind=ANGEBOT");
    expect(parseListeQuery(s)!.get("kind")).toBe("ANGEBOT");
  });
});
