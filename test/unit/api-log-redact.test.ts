/**
 * Phase 12d, Task 2 — Redaktion, Kuerzung, Pfad-Ausschluss (reine Funktionen, keine DB).
 * Abschluss-Review Fix-Welle (C1/I1/I2, final-review.md): O(n)-Kuerzung + 256-KB-Eingabe-
 * Deckel (C1), Query-Redaktion (I1), Marker statt Rohtext bei Redaktionsfehlern (I2).
 */
import { describe, it, expect } from "vitest";
import { redactJson, redactQuery, prepareBody, shouldLogPath, MAX_BODY_BYTES, MAX_INPUT_BYTES, REDACTED } from "@/domain/api-log/redact";

describe("redactJson", () => {
  it("schwaerzt verdaechtige Schluessel, gross wie klein, verschachtelt und in Arrays", () => {
    expect(redactJson({ token: "x", Secret: "y", passwort: "z", apiKey: "a", api_key: "b" })).toEqual({
      token: REDACTED, Secret: REDACTED, passwort: REDACTED, apiKey: REDACTED, api_key: REDACTED,
    });
    expect(redactJson({ a: { b: { iban: "DE02..." } }, list: [{ bic: "XX" }, { ok: 1 }] })).toEqual({
      a: { b: { iban: REDACTED } }, list: [{ bic: REDACTED }, { ok: 1 }],
    });
  });
  it("laesst harmlose Felder und Nicht-Objekte unveraendert", () => {
    expect(redactJson({ name: "Kunde AG", netTotalCents: 11900 })).toEqual({ name: "Kunde AG", netTotalCents: 11900 });
    expect(redactJson("text")).toBe("text");
    expect(redactJson(null)).toBeNull();
  });
});

describe("redactQuery (I1)", () => {
  it("schwaerzt Geheimnis- und E-Mail-Parameter, laesst harmlose unveraendert", () => {
    expect(redactQuery("api_key=geheim&limit=10")).toBe(`api_key=${encodeURIComponent(REDACTED)}&limit=10`);
    expect(redactQuery("email=kunde%40example.test&status=OPEN")).toBe(`email=${encodeURIComponent(REDACTED)}&status=OPEN`);
  });
  it("gibt den Originaltext unveraendert zurueck, wenn nichts zu schwaerzen ist", () => {
    expect(redactQuery("a=1&limit=10")).toBe("a=1&limit=10");
  });
  it("leer/fehlend -> null", () => {
    expect(redactQuery(null)).toBeNull();
    expect(redactQuery(undefined)).toBeNull();
    expect(redactQuery("")).toBeNull();
  });
});

describe("prepareBody", () => {
  it("schwaerzt vor dem Kuerzen und markiert das Kuerzen", () => {
    const r = prepareBody(JSON.stringify({ token: "geheim", note: "a".repeat(4000) }));
    expect(r.truncated).toBe(true);
    expect(Buffer.byteLength(r.text ?? "", "utf8")).toBeLessThanOrEqual(MAX_BODY_BYTES);
    expect(r.text).toContain(REDACTED);
    expect(r.text).not.toContain("geheim");
  });

  it("Nicht-JSON wird NIE roh gespeichert (I2) — Marker statt Rohtext; leerer/fehlender Body -> null", () => {
    const r = prepareBody("kein json");
    expect(r.text).toBe(JSON.stringify({ redacted: false, reason: "unparseable" }));
    expect(r.text).not.toContain("kein json");
    for (const empty of ["", null, undefined]) expect(prepareBody(empty).text).toBeNull();
  });

  it("form-encodeter Body (token=... im Klartext) landet NIE roh in der DB (I2)", () => {
    const r = prepareBody("token=geheim&user=admin");
    expect(r.text).not.toContain("geheim");
    expect(r.text).toBe(JSON.stringify({ redacted: false, reason: "unparseable" }));
  });

  it("kuerzt an einer Zeichengrenze, nicht mitten in einem Mehrbyte-Zeichen", () => {
    // Valides JSON (nicht "laesst Nicht-JSON durch" — das ist seit I2 nicht mehr der Fall).
    const r = prepareBody(JSON.stringify({ note: "ü".repeat(3000) }));
    expect(r.truncated).toBe(true);
    expect(r.text?.endsWith("�")).toBe(false);
    expect(Buffer.byteLength(r.text ?? "", "utf8")).toBeLessThanOrEqual(MAX_BODY_BYTES);
  });

  it("ueber MAX_INPUT_BYTES -> Marker OHNE JSON.parse-Versuch (C1)", () => {
    // Absichtlich KEIN valides JSON — waere JSON.parse versucht worden, gaebe es den
    // "unparseable"-Marker statt "too-large"; dieser Test belegt also, dass der
    // Eingabe-Deckel VOR jedem Parse-Versuch greift.
    const huge = "x".repeat(MAX_INPUT_BYTES + 1);
    const r = prepareBody(huge);
    expect(r.text).toBe(JSON.stringify({ truncated: true, reason: "too-large" }));
    expect(r.truncated).toBe(true);
  });

  it("Performance (C1): ein 2-MB-Body braucht < 50 ms und haelt den Byte-Deckel exakt ein", () => {
    const twoMb = JSON.stringify({ note: "a".repeat(2 * 1024 * 1024) });
    const started = performance.now();
    const r = prepareBody(twoMb);
    const elapsedMs = performance.now() - started;
    expect(elapsedMs).toBeLessThan(50);
    expect(Buffer.byteLength(r.text ?? "", "utf8")).toBeLessThanOrEqual(MAX_BODY_BYTES);
  });

  it("Performance (C1): ein valider ~200-KB-JSON-Body (unter dem Eingabe-Deckel, ueber der Ausgabegrenze) kuerzt in < 50 ms", () => {
    // Regressionstest fuer die vorherige O(n²)-Schleife: 200 KB brauchten dort ~764 ms.
    const body = JSON.stringify({ note: "a".repeat(200 * 1024) });
    const started = performance.now();
    const r = prepareBody(body);
    const elapsedMs = performance.now() - started;
    expect(elapsedMs).toBeLessThan(50);
    expect(r.truncated).toBe(true);
    expect(Buffer.byteLength(r.text ?? "", "utf8")).toBeLessThanOrEqual(MAX_BODY_BYTES);
  });
});

describe("shouldLogPath", () => {
  it("schliesst Doku, OpenAPI, ping und das Protokoll selbst aus", () => {
    for (const p of ["/api/docs", "/api/docs/assets/x.js", "/api/v1/openapi.json", "/api/v1/ping", "/api/v1/ApiRequestLog", "/api/v1/ApiRequestLog/abc"]) {
      expect(shouldLogPath(p)).toBe(false);
    }
    expect(shouldLogPath("/api/v1/Invoice")).toBe(true);
    expect(shouldLogPath("/api/v1/Invoice/abc/finalize")).toBe(true);
  });
});
