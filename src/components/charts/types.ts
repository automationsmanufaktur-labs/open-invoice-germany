/**
 * Gemeinsame Typen und Farbkonstanten des Inline-SVG-Chart-Baukastens (Phase 12e, Task 1).
 * Es gibt heute keine CSS-Design-Tokens in der Codebasis (Ad-hoc-Tailwind-Klassen:
 * indigo-600 primaer, slate-* neutral, amber-500 Warnung, rose-700 Gefahr) — die Palette
 * wird deshalb hier als Hex-Konstanten festgehalten, passend zu diesen Klassen.
 */
export interface ChartDatum {
  /** Achsen-/Legendenbeschriftung, z. B. "Mär 26". */
  label: string;
  /** Rohwert (Cent oder Anzahl) — nur fuer die Geometrie. */
  value: number;
  /** Fertig formatiert, z. B. "1.234,56 €" — fuer <title> und sr-only-Wertetabelle. */
  valueLabel: string;
  /** Ueberschreibt die Reihenfarbe (Donut/Status). */
  color?: string;
}

/**
 * Grobe mittlere Zeichenbreite in viewBox-Einheiten je `fontSize`-Einheit (Erfahrungswert
 * fuer Systemschriften) — gemeinsame Konstante fuer `BarChart` (Beschriftungsspalten,
 * waagerecht) und `LineChart` (x-Achsen-Label-Abstand), Fix I6, kein zweiter Naeherungswert.
 */
export const CHAR_WIDTH_FACTOR = 0.6;

export const CHART_COLORS = {
  primary: "#4f46e5", // indigo-600
  second: "#0d9488", // teal-600
  due: "#f59e0b", // amber-500
  overdue: "#e11d48", // rose-600
  grid: "#e2e8f0", // slate-200 — Rasterlinien (dekorativ, keine Text-Kontrastpflicht)
  axis: "#94a3b8", // slate-400 — Achsenlinien (dekorativ), NICHT fuer Text (Fix 1: WCAG AA)
  label: "#475569", // slate-600 — Achsen-/Wertebeschriftung (Text): faellt auf Weiss unter AA (Fix 1)
  centerText: "#1e293b", // slate-800 — Fix M10: DonutChart-Mittelwert, war hartkodiert statt Konstante
} as const;
