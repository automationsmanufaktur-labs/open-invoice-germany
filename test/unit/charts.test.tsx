/**
 * Phase 12e, Task 1 — der Inline-SVG-Baukasten. Kein RTL im Projekt: gerendert wird mit
 * renderToStaticMarkup (react-dom/server, Next-Abhaengigkeit) und im HTML-String geprueft.
 * `environment: "node"` genuegt — renderToStaticMarkup braucht kein DOM. `tsconfig.json`
 * hat `"jsx": "react-jsx"`, das esbuild von Vitest uebernimmt die Einstellung; scheitert
 * der Lauf dennoch an JSX, `esbuild: { jsx: "automatic" }` in vitest.config.ts ergaenzen.
 *
 * Fix 1 (Review): Geometrie-Tests fuer negative Balken (`parseRects` prueft jedes <rect>
 * gegen die viewBox-Grenzen), Kontrastfarbe der Achsen-/Wertebeschriftung, und schaerfere
 * Verhaltens-Assertions fuer die Randfaelle "ein Punkt" (LineChart) und "Summe 0" (Donut)
 * statt nur "kein NaN".
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BarChart } from "@/components/charts/BarChart";
import { LineChart } from "@/components/charts/LineChart";
import { DonutChart } from "@/components/charts/DonutChart";
import type { ChartDatum } from "@/components/charts/types";

const DATA: ChartDatum[] = [
  { label: "Jan 26", value: 100000, valueLabel: "1.000,00 €" },
  { label: "Feb 26", value: 250000, valueLabel: "2.500,00 €" },
  { label: "Mär 26", value: 0, valueLabel: "0,00 €" },
];

function expectNoNaN(html: string) {
  expect(html).not.toContain("NaN");
  expect(html).not.toContain("Infinity");
  expect(html).not.toContain("undefined");
}

/** Extrahiert x/y/width/height jedes <rect> aus dem gerenderten HTML-String. */
function parseRects(html: string): { x: number; y: number; width: number; height: number }[] {
  const rects: { x: number; y: number; width: number; height: number }[] = [];
  const rectTagRegex = /<rect\b([^>]*)>/g;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = rectTagRegex.exec(html))) {
    const attrs = tagMatch[1];
    const get = (name: string) => {
      const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
      return m ? Number(m[1]) : NaN;
    };
    rects.push({ x: get("x"), y: get("y"), width: get("width"), height: get("height") });
  }
  return rects;
}

/** Extrahiert cx/cy jedes <circle> aus dem gerenderten HTML-String (Fix I1: LineChart-Punkte). */
function parseCircles(html: string): { cx: number; cy: number }[] {
  const circles: { cx: number; cy: number }[] = [];
  const circleTagRegex = /<circle\b([^>]*)>/g;
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = circleTagRegex.exec(html))) {
    const attrs = tagMatch[1];
    const get = (name: string) => {
      const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
      return m ? Number(m[1]) : NaN;
    };
    circles.push({ cx: get("cx"), cy: get("cy") });
  }
  return circles;
}

/** Extrahiert die Punktkoordinaten des <polyline points="x,y x,y ..."> aus dem HTML-String. */
function parsePolylinePoints(html: string): { x: number; y: number }[] {
  const m = /<polyline\b[^>]*\bpoints="([^"]*)"/.exec(html);
  if (!m) return [];
  return m[1]
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      return { x, y };
    });
}

function expectRectsWithinBounds(html: string, width: number, height: number, minCount = 1) {
  const rects = parseRects(html);
  expect(rects.length).toBeGreaterThanOrEqual(minCount);
  for (const r of rects) {
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.x + r.width).toBeLessThanOrEqual(width);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.y + r.height).toBeLessThanOrEqual(height);
  }
}

describe("BarChart", () => {
  it("rendert Balken mit <title>, role=img, aria-labelledby/-describedby, svg-title/desc und sr-only-Wertetabelle", () => {
    const html = renderToStaticMarkup(<BarChart title="Umsatz je Monat" data={DATA} />);
    expect(html.match(/<rect/g)?.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain("<title>Feb 26: 2.500,00 €</title>");
    expect(html).toContain('role="img"');
    // Fix M6 (a11y): aria-label entfaellt (redundant neben aria-labelledby); aria-labelledby
    // referenziert nur noch den Namen (<title>), aria-describedby die Beschreibung (<desc>).
    expect(html).not.toContain("aria-label=");
    expect(html).toMatch(/aria-labelledby="[^"]+"/);
    expect(html).toMatch(/aria-describedby="[^"]+"/);
    expect(html).toMatch(/<title id="[^"]+">Umsatz je Monat<\/title>/);
    expect(html).toMatch(/<desc id="[^"]+">/);
    expect(html).toContain("sr-only");
    expect(html).toContain("<th scope=\"col\">Bezeichnung</th>");
    expect(html).toContain("<td>Jan 26</td>");
    expectNoNaN(html);
  });

  it("waagerecht kehrt die Geometrie um, nicht die Datenreihenfolge", () => {
    const html = renderToStaticMarkup(<BarChart title="Top 5" data={DATA} orientation="horizontal" />);
    expect(html.indexOf("Jan 26")).toBeLessThan(html.indexOf("Feb 26"));
    expectNoNaN(html);
  });

  it("kommt mit Nullwerten, leeren Daten und negativen Werten zurecht", () => {
    expectNoNaN(renderToStaticMarkup(<BarChart title="Null" data={DATA.map((d) => ({ ...d, value: 0 }))} />));
    const empty = renderToStaticMarkup(<BarChart title="Leer" data={[]} />);
    expect(empty).toContain("Keine Daten");
    expectNoNaN(empty);
    expectNoNaN(renderToStaticMarkup(<BarChart title="Umsatz" data={[...DATA, { label: "Apr 26", value: -50000, valueLabel: "-500,00 €" }]} />));
  });

  it("negative Balken bleiben innerhalb der viewBox (senkrecht, gemischte Vorzeichen)", () => {
    const withNegative = [...DATA, { label: "Apr 26", value: -50000, valueLabel: "-500,00 €" }];
    const html = renderToStaticMarkup(<BarChart title="Umsatz" data={withNegative} />);
    expectRectsWithinBounds(html, 640, 240, 4);
    expectNoNaN(html);
  });

  it("negative Balken bleiben innerhalb der viewBox (waagerecht, gemischte Vorzeichen)", () => {
    const withNegative = [...DATA, { label: "Apr 26", value: -50000, valueLabel: "-500,00 €" }];
    const html = renderToStaticMarkup(<BarChart title="Umsatz" data={withNegative} orientation="horizontal" />);
    expectRectsWithinBounds(html, 640, withNegative.length * 34 + 20, 4);
    expectNoNaN(html);
  });

  it("eine komplett negative Reihe bleibt innerhalb der viewBox (senkrecht und waagerecht)", () => {
    const allNegative: ChartDatum[] = [
      { label: "Jan 26", value: -10000, valueLabel: "-100,00 €" },
      { label: "Feb 26", value: -30000, valueLabel: "-300,00 €" },
      { label: "Mär 26", value: -5000, valueLabel: "-50,00 €" },
    ];
    const vertical = renderToStaticMarkup(<BarChart title="Verlust" data={allNegative} />);
    expectRectsWithinBounds(vertical, 640, 240, 3);
    expectNoNaN(vertical);

    const horizontal = renderToStaticMarkup(<BarChart title="Verlust" data={allNegative} orientation="horizontal" />);
    expectRectsWithinBounds(horizontal, 640, allNegative.length * 34 + 20, 3);
    expectNoNaN(horizontal);
  });

  it("Achsen-/Wertebeschriftung nutzt die AA-Kontrastfarbe slate-600, nicht slate-400", () => {
    const html = renderToStaticMarkup(<BarChart title="Umsatz je Monat" data={DATA} />);
    expect(html).toContain('fill="#475569"');
    expect(html).not.toContain('fill="#94a3b8"');
  });

  it("Fix I5: die senkrechte Ansicht zeigt eine y-Achse mit 3 formatierten Ticks (formatCentsShort)", () => {
    const html = renderToStaticMarkup(<BarChart title="Umsatz je Monat" data={DATA} />);
    // DATA-Werte 0/100000/250000 -> domainMax 250000 ("2,5 k€"), domainMin 0 ("0,00 €"),
    // Mitte 125000 ("1,3 k€", kaufmaennisch gerundet).
    expect(html).toContain("2,5 k€");
    expect(html).toContain("0,00 €");
    expect(html.match(/font-size="12"/g)?.length).toBeGreaterThanOrEqual(3);
    expectNoNaN(html);
  });

  it("Fix I6: viewBoxWidth macht die Koordinatenbreite konfigurierbar (halbe Dashboard-Karte)", () => {
    const html = renderToStaticMarkup(<BarChart title="Top 5" data={DATA} viewBoxWidth={320} />);
    expect(html).toContain('viewBox="0 0 320 240"');
    expectRectsWithinBounds(html, 320, 240, 3);
    expectNoNaN(html);
  });

  it("Fix I6: waagerecht bleibt ein 24-stelliger Name auch bei reduzierter viewBoxWidth (320) innerhalb der viewBox", () => {
    const longName = "Beispiel GmbH & Co. KG12"; // 24 Zeichen
    const data: ChartDatum[] = [{ label: longName, value: 100000, valueLabel: "1.000,00 €" }];
    const html = renderToStaticMarkup(<BarChart title="Top 5" data={data} orientation="horizontal" viewBoxWidth={320} />);
    expect(html).toContain('viewBox="0 0 320');
    expectRectsWithinBounds(html, 320, data.length * 34 + 20, 1);
    const groups = [...html.matchAll(/<g[^>]*>([\s\S]*?)<\/g>/g)];
    for (const group of groups) {
      const labelText = /<text\b([^>]*)>/.exec(group[1]);
      expect(labelText).not.toBeNull();
      const x = Number(/\bx="(-?[\d.]+)"/.exec(labelText![1])?.[1]);
      expect(Number.isNaN(x)).toBe(false);
      expect(x).toBeGreaterThanOrEqual(0);
    }
    expectNoNaN(html);
  });

  it("Regression (Screenshot-Review): eine gestauchte Beschriftungsspalte schrumpft die Schrift mit, statt ueber den linken Rand hinauszuragen", () => {
    // Nachgebaut aus dem echten Dashboard-Screenshot (12e-fix-01): ein sehr langer,
    // getrennter Kundenname bei viewBoxWidth=320 liess "Smoke Test Kunde 178879…" als
    // abgeschnittenes "š" statt "S" rendern, weil die Spalte gestaucht wurde, die Schrift
    // aber bei fontSize 12 blieb.
    const CHAR_WIDTH_FACTOR = 0.6; // dieselbe Naeherung wie in BarChart.tsx
    const longLabel = "Smoke Test Kunde 178879364".slice(0, 24); // truncateName-Laenge
    const data: ChartDatum[] = [
      { label: "Beispiel AG", value: 229900, valueLabel: "2.299,00 €" },
      { label: longLabel, value: 28500, valueLabel: "285,00 €" },
    ];
    const html = renderToStaticMarkup(<BarChart title="Top 5" data={data} orientation="horizontal" viewBoxWidth={320} />);
    const groups = [...html.matchAll(/<g[^>]*>([\s\S]*?)<\/g>/g)];
    for (const group of groups) {
      const labelText = /<text\b([^>]*)>/.exec(group[1]);
      expect(labelText).not.toBeNull();
      const attrs = labelText![1];
      const x = Number(/\bx="(-?[\d.]+)"/.exec(attrs)?.[1]);
      const fontSizeAttr = Number(/\bfont-size="([\d.]+)"/.exec(attrs)?.[1]);
      expect(Number.isNaN(x)).toBe(false);
      expect(Number.isNaN(fontSizeAttr)).toBe(false);
      // textAnchor="end": das Label wächst von x aus NACH LINKS um ungefähr
      // Zeichenzahl * fontSize * CHAR_WIDTH_FACTOR — das darf nicht unter 0 fallen.
      const estimatedLeftEdge = x - longLabel.length * fontSizeAttr * CHAR_WIDTH_FACTOR;
      expect(estimatedLeftEdge).toBeGreaterThanOrEqual(-1);
    }
    expectNoNaN(html);
  });

  it("waagerechte Kundenbeschriftung bleibt bei einem 24-stelligen Namen im positiven Bereich (Fix 2)", () => {
    // 24 Zeichen, angelehnt an "Beispiel GmbH & Co. KG" (Review-Fund: bei labelWidth=110
    // ragte textAnchor="end" ueber den linken SVG-Rand hinaus, x < 0).
    const longName = "Beispiel GmbH & Co. KG12"; // 24 Zeichen
    expect(longName.length).toBe(24);
    const data: ChartDatum[] = [{ label: longName, value: 100000, valueLabel: "1.000,00 €" }];
    const html = renderToStaticMarkup(<BarChart title="Top 5" data={data} orientation="horizontal" />);
    const groups = [...html.matchAll(/<g[^>]*>([\s\S]*?)<\/g>/g)];
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      const labelText = /<text\b([^>]*)>/.exec(group[1]);
      expect(labelText).not.toBeNull();
      const x = Number(/\bx="(-?[\d.]+)"/.exec(labelText![1])?.[1]);
      expect(Number.isNaN(x)).toBe(false);
      expect(x).toBeGreaterThanOrEqual(0);
    }
    expectNoNaN(html);
  });
});

describe("LineChart", () => {
  it("rendert eine Polylinie und je Punkt einen Kreis mit <title>", () => {
    const html = renderToStaticMarkup(<LineChart title="Umsatz je Monat" data={DATA} />);
    expect(html).toContain("<polyline");
    expect(html.match(/<circle/g)?.length).toBe(3);
    expect(html).toContain("<title>Jan 26: 1.000,00 €</title>");
    expectNoNaN(html);
  });
  it("ein einzelner Punkt erzeugt keine kaputte Linie", () => {
    const html = renderToStaticMarkup(<LineChart title="Einer" data={[DATA[0]]} />);
    expect(html).not.toContain("<polyline");
    expect(html.match(/<circle/g)?.length).toBe(1);
    expectNoNaN(html);
  });

  it("Fix I1: ein negativer Monat (Stornierungsmonat) bleibt innerhalb der viewBox, statt abgeschnitten zu werden", () => {
    // Nachgebaut aus dem Review-Befund: Storno-Ruling erzeugt planmaessig negative Monate
    // (reporting-revenue.test.ts, Februar/Maerz-Szenario). Mit der alten Math.abs(max)-Skala
    // lag ein rein negativer Monat weit ausserhalb von [0, 240].
    const withNegative: ChartDatum[] = [
      { label: "Jan 26", value: 100000, valueLabel: "1.000,00 €" },
      { label: "Feb 26", value: -40000, valueLabel: "-400,00 €" },
      { label: "Mär 26", value: 0, valueLabel: "0,00 €" },
    ];
    const html = renderToStaticMarkup(<LineChart title="Umsatz" data={withNegative} />);
    const circles = parseCircles(html);
    expect(circles.length).toBe(3);
    for (const c of circles) {
      expect(c.cy).toBeGreaterThanOrEqual(0);
      expect(c.cy).toBeLessThanOrEqual(240);
      expect(c.cx).toBeGreaterThanOrEqual(0);
      expect(c.cx).toBeLessThanOrEqual(640);
    }
    const points = parsePolylinePoints(html);
    expect(points.length).toBe(3);
    for (const p of points) {
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(240);
    }
    // Der negative Monat muss unterhalb der Nulllinie liegen, nicht ausserhalb der viewBox.
    expect(circles[1].cy).toBeGreaterThan(circles[0].cy);
    expectNoNaN(html);
  });

  it("Regression (Screenshot-Review): bei reduzierter viewBoxWidth (340) zeigt LineChart seltener Labels, damit sie nicht kollidieren", () => {
    // Nachgebaut aus dem Screenshot 12e-fix-04 (Kundenseite, 400 px): bei fester
    // "jedes zweite Label"-Regel liefen "Okt 25"/"Dez 25" bei viewBoxWidth=340 ineinander.
    const twelveMonths: ChartDatum[] = Array.from({ length: 12 }, (_, i) => ({
      label: `Mon ${i}`,
      value: i * 1000,
      valueLabel: `${i * 1000}`,
    }));
    const wide = renderToStaticMarkup(<LineChart title="Umsatz" data={twelveMonths} viewBoxWidth={640} />);
    const narrow = renderToStaticMarkup(<LineChart title="Umsatz" data={twelveMonths} viewBoxWidth={340} />);
    const countLabels = (html: string) => (html.match(/<text\b/g) ?? []).length;
    // Bei der schmaleren viewBox muessen STRIKT weniger (oder gleich viele) Labels stehen,
    // nie mehr — sonst waere die Kollisionsgefahr gestiegen statt gesunken.
    expect(countLabels(narrow)).toBeLessThanOrEqual(countLabels(wide));
    // Der letzte Punkt behaelt in jedem Fall sein Label.
    expect(narrow).toContain(">Mon 11<");
    expect(wide).toContain(">Mon 11<");
    expectNoNaN(narrow);
    expectNoNaN(wide);
  });

  it("Fix I1: eine komplett negative Reihe bleibt innerhalb der viewBox", () => {
    const allNegative: ChartDatum[] = [
      { label: "Jan 26", value: -10000, valueLabel: "-100,00 €" },
      { label: "Feb 26", value: -30000, valueLabel: "-300,00 €" },
    ];
    const html = renderToStaticMarkup(<LineChart title="Verlust" data={allNegative} />);
    const circles = parseCircles(html);
    for (const c of circles) {
      expect(c.cy).toBeGreaterThanOrEqual(0);
      expect(c.cy).toBeLessThanOrEqual(240);
    }
    expectNoNaN(html);
  });
});

describe("DonutChart", () => {
  it("rendert je Segment einen Kreis mit <title> und die Summe in der Mitte", () => {
    const html = renderToStaticMarkup(
      <DonutChart
        title="Offen / Überfällig / Bezahlt"
        data={[
          { label: "Offen", value: 3, valueLabel: "3 Rechnungen", color: "#4f46e5" },
          { label: "Überfällig", value: 1, valueLabel: "1 Rechnung", color: "#e11d48" },
          { label: "Bezahlt", value: 6, valueLabel: "6 Rechnungen", color: "#0d9488" },
        ]}
      />,
    );
    expect(html.match(/<circle/g)?.length).toBeGreaterThanOrEqual(4); // Spur + 3 Segmente
    expect(html).toContain("<title>Überfällig: 1 Rechnung</title>");
    expect(html).toContain("10"); // Gesamtzahl in der Mitte
    expect(html).toMatch(/<ul aria-hidden="true"/); // sr-only-Tabelle traegt die Werte bereits vor
    expectNoNaN(html);
  });
  it("Summe 0 erzeugt keine Division durch Null", () => {
    const html = renderToStaticMarkup(<DonutChart title="Leer" data={[{ label: "Offen", value: 0, valueLabel: "0" }]} />);
    expect(html.match(/<circle/g)?.length).toBe(1); // nur die Spur, kein Segment
    expectNoNaN(html);
  });
});
