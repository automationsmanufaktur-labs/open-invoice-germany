/**
 * Phase 12a, Task 1 — Strukturtest (kein RTL, vitest environment "node"; Muster:
 * test/unit/dockerfile.test.ts). (1) Die Regel, die das Tailwind-v4-Preflight
 * (`*{margin:0}`) fuer `dialog:modal` zuruecknimmt, muss in globals.css stehen.
 * (2) Jedes native <dialog> traegt eine Breitenklasse.
 *
 * Fix-Welle 12a (C1): die Regel muss zusaetzlich INNERHALB von `@layer base` stehen —
 * ausserhalb jeder Layer schlaegt sie alle `max-w-*`-Utilities aus `@layer utilities`
 * (siehe Kommentar in globals.css). Test faengt einen Rueckfall auf einen ungelayerten
 * Block ab.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "../../src");
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = path.join(dir, e);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("Dialog-Zentrierung (Phase 12a)", () => {
  it("globals.css nimmt das Preflight fuer dialog:modal zurueck", () => {
    const css = readFileSync(path.join(SRC, "app/globals.css"), "utf8");
    expect(css).toMatch(/dialog:modal\s*\{[^}]*margin:\s*auto/);
    expect(css).toMatch(/dialog:modal\s*\{[^}]*max-height:\s*calc\(100dvh - 2rem\)/);
    expect(css).toMatch(/dialog:modal\s*\{[^}]*max-width:\s*calc\(100vw - 2rem\)/);
  });

  it("die dialog:modal-Regel liegt in @layer base (sonst schlaegt sie max-w-* aus @layer utilities)", () => {
    const css = readFileSync(path.join(SRC, "app/globals.css"), "utf8");
    // CSS-Kommentare vorab entfernen — der erklaerende Kommentar ueber der Regel
    // erwaehnt "@layer base" selbst in Prosa und wuerde eine naive Textsuche sonst
    // an der falschen Stelle treffen lassen.
    const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).toMatch(/@layer base\s*\{[\s\S]*dialog:modal[\s\S]*\}/);
    // Kein ungelayerter dialog:modal-Block ausserhalb von @layer base: alles vor dem
    // ersten "@layer base {" darf keine dialog:modal-Regel mehr enthalten.
    const beforeLayerBase = code.slice(0, code.indexOf("@layer base"));
    expect(beforeLayerBase).not.toMatch(/dialog:modal/);
  });

  it("jedes <dialog> traegt w-full und eine max-w-Klasse", () => {
    // Kommentare (Modul-JSDoc, Zeilenkommentare) erwaehnen `<dialog>` haeufig in
    // Prosa (z. B. "natives <dialog>," oder "`<dialog>`") — ohne Bereinigung liest
    // die Regex das als Tag und der lazy-Abschluss `[\s\S]{0,400}?>` schnappt sich
    // das naechstbeste `>` (auch aus `=>` oder echtem Markup weiter unten) statt
    // eines echten JSX-Tags. Kommentare vorab entfernen, damit nur reale <dialog>-
    // Elemente geprueft werden.
    //
    // Fix-Welle 12a (M7): `//.*$` wuerde auch `//` innerhalb von Zeichenketten (z. B.
    // in einer URL) als Zeilenkommentar lesen und den Rest der Zeile verschlucken —
    // dadurch koennte theoretisch ein echtes `<dialog>`-Tag verstuemmelt werden. Nur
    // Zeilen verwerfen, die (nach optionalem Leerraum) mit `//` oder `*` beginnen
    // (Block-Kommentar-Fortsetzungszeile, JSDoc-Stil).
    function stripComments(src: string): string {
      return src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\*)/.test(line))
        .join("\n");
    }
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const code = stripComments(readFileSync(file, "utf8"));
      for (const m of code.matchAll(/<dialog\b[\s\S]{0,400}?>/g)) {
        const tag = m[0];
        if (!/className="[^"]*\bw-full\b/.test(tag) || !/className="[^"]*\bmax-w-/.test(tag)) {
          offenders.push(`${path.relative(SRC, file)}: ${tag.slice(0, 80)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
