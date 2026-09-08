import type { ChartDatum } from "./types";
import { CHART_COLORS, CHAR_WIDTH_FACTOR } from "./types";
import { ChartFrame } from "./ChartFrame";

/**
 * Linienreihe (Phase 12e, Task 1): der kanonische Fall fuer eine dichte, lueckenlose
 * Zeitreihe — auf der Kunden-Detailseite "Umsatz je Monat (12 Monate)" (Ruling im Brief,
 * ergaenzt die Spec: dort war LineChart im Baukasten gelistet, aber keinem Konsument
 * zugeordnet). Bei genau einem Datenpunkt entfaellt die `<polyline>` (nur der Kreis) —
 * eine Linie mit einem Punkt waere eine kaputte Linie, kein Diagramm. X-Beschriftung
 * standardmaessig jedes zweite Datum (mindestens), bei schmalerer `viewBoxWidth` seltener
 * (siehe `labelStep` unten), damit zwoelf Monate lesbar bleiben, ohne dass Labels ineinander
 * laufen.
 *
 * Fix I1 (Abschluss-Review): dieselbe Domain-Skala wie `BarChart` (`[min(0, minValue),
 * max(0, maxValue)]`, Nulllinie proportional im Plot) statt der alten `Math.abs(max)`-Skala
 * mit fest unten liegender Grundlinie. Vorher wanderte ein rein negativer oder stark
 * negativer Monat (z. B. der Stornierungsmonat, siehe reporting-revenue.test.ts) unter die
 * viewBox hinaus und wurde vom SVG ersatzlos abgeschnitten — genau der Fall, fuer den das
 * Storno-Ruling (accrual, negative Monate bleiben sichtbar) gedacht ist.
 * Fix M3 (Minor): `padLeft`/`padRight` von 10 auf 24 angehoben — bei 10 ragte das erste/
 * letzte `textAnchor="middle"`-Label ueber den linken/rechten SVG-Rand hinaus ("kt 25" statt
 * "Okt 25").
 * Fix I6 (Abschluss-Review): `viewBoxWidth` (Default 640, siehe BarChart/ChartFrame) macht
 * die Koordinatenbreite konfigurierbar; `emptyMessage` (Fix M1) ueberschreibt den
 * Standard-Leerzustandstext.
 * Fix I6 (Nachtrag, Screenshot-Review bei viewBoxWidth 340): das feste "jedes zweite
 * Label" kollidierte bei reduzierter viewBoxWidth ("Okt 25"/"Dez 25" liefen ineinander,
 * da der Punktabstand mit der viewBoxWidth schrumpft, die Schrift aber nicht). `labelStep`
 * wird jetzt aus dem tatsaechlichen Punktabstand und der laengsten Beschriftung berechnet
 * (mindestens 2, wie bisher) — der letzte Punkt bekommt zusaetzlich IMMER ein Label.
 */
export function LineChart({
  title,
  data,
  color,
  viewBoxWidth = 640,
  emptyMessage,
}: {
  title: string;
  data: ChartDatum[];
  color?: string;
  viewBoxWidth?: number;
  emptyMessage?: string;
}) {
  const width = viewBoxWidth;
  const height = 240;
  const padTop = 10;
  const padBottom = 30;
  const padLeft = 24;
  const padRight = 24;
  const plotHeight = height - padTop - padBottom;
  const plotWidth = width - padLeft - padRight;
  const domainMin = Math.min(0, ...data.map((d) => d.value));
  const domainMax = Math.max(0, ...data.map((d) => d.value));
  const range = domainMax - domainMin || 1;
  // Wert -> y-Position: 0 faellt auf die Nulllinie, nicht mehr fest auf den Plot-Rand
  // (dieselbe Formel wie BarChart.renderVertical#scaleY).
  const scaleY = (v: number) => padTop + ((domainMax - v) / range) * plotHeight;
  const zeroY = scaleY(0);
  const stroke = color ?? CHART_COLORS.primary;

  const points = data.map((d, i) => {
    const x = padLeft + (data.length > 1 ? (i / (data.length - 1)) * plotWidth : plotWidth / 2);
    const y = scaleY(d.value);
    return { x, y, d };
  });

  const fontSize = 12;
  const maxLabelChars = data.length > 0 ? Math.max(...data.map((d) => d.label.length)) : 0;
  const estimatedLabelWidth = maxLabelChars * fontSize * CHAR_WIDTH_FACTOR;
  const avgStepPx = data.length > 1 ? plotWidth / (data.length - 1) : plotWidth;
  const labelStep = Math.max(2, Math.ceil((estimatedLabelWidth + 12) / avgStepPx));
  // Der letzte Punkt hat immer ein Label; ein regulaeres Step-Label direkt davor (naeher als
  // labelStep Punkte) wuerde sonst mit ihm kollidieren (Regression aus dem Screenshot-Review:
  // "Juli"/"Sept 26" liefen ineinander) — dann faellt es aus.
  const showLabel = points.map((_, i) => {
    const isLast = i === points.length - 1;
    const tooCloseToLast = !isLast && points.length - 1 - i < labelStep;
    return (i % labelStep === 0 && !tooCloseToLast) || isLast;
  });

  return (
    <ChartFrame title={title} ariaLabel={title} data={data} width={width} height={height} emptyMessage={emptyMessage}>
      {[0, 0.5, 1].map((f) => (
        <line
          key={f}
          x1={padLeft}
          x2={width - padRight}
          y1={padTop + f * plotHeight}
          y2={padTop + f * plotHeight}
          stroke={CHART_COLORS.grid}
        />
      ))}
      {domainMin < 0 && <line x1={padLeft} x2={width - padRight} y1={zeroY} y2={zeroY} stroke={CHART_COLORS.axis} />}
      {points.length > 1 && (
        <polyline
          fill="none"
          stroke={stroke}
          strokeWidth={2}
          points={points.map((p) => `${p.x},${p.y}`).join(" ")}
        />
      )}
      {points.map((p, i) => (
        <g key={`${i}-${p.d.label}`}>
          <circle cx={p.x} cy={p.y} r={3} fill={p.d.color ?? stroke} className="transition-opacity hover:opacity-80">
            <title>{`${p.d.label}: ${p.d.valueLabel}`}</title>
          </circle>
          {showLabel[i] && (
            <text
              x={p.x}
              y={height - 12}
              textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
              fontSize={fontSize}
              fill={CHART_COLORS.label}
              paintOrder="stroke"
              stroke="#ffffff"
              strokeWidth={3}
            >
              {p.d.label}
            </text>
          )}
        </g>
      ))}
    </ChartFrame>
  );
}
