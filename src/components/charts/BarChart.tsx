import type { ChartDatum } from "./types";
import { CHART_COLORS, CHAR_WIDTH_FACTOR } from "./types";
import { ChartFrame } from "./ChartFrame";
import { formatCentsShort } from "@/lib/money";

/**
 * Saeulendiagramm (Phase 12e, Task 1): senkrecht fuer generische Reihen (Dashboard),
 * waagerecht fuer Ranglisten ("Top 5 Kunden"). `orientation="horizontal"` dreht nur die
 * Geometrie um — die Datenreihenfolge (und damit die Reihenfolge im DOM/sr-only-Text)
 * bleibt unveraendert, siehe Test "kehrt die Geometrie um, nicht die Datenreihenfolge".
 *
 * Fix 1 (Review): die Skala wird ueber die gesamte Wertespanne `[min(0, minValue),
 * max(0, maxValue)]` gebildet, nicht mehr nur ueber `Math.abs(value)`. Vorher stand die
 * Grundlinie fest am Plot-Rand (senkrecht unten, waagerecht links), sodass ein negativer
 * Balken ueber diesen Rand hinaus in den Rahmen bzw. ins Negative wuchs. Jetzt liegt die
 * Nulllinie proportional im Plot-Bereich (`scaleY`/`scaleX`), wodurch sowohl positive als
 * auch negative Balken innerhalb von `[0, width] x [0, height]` bleiben — siehe die
 * Geometrie-Tests fuer die `-50000`-Fixture und eine komplett negative Reihe.
 *
 * Fix I5/I6 (Abschluss-Review): `viewBoxWidth` (Default 640) macht die Koordinatenbreite
 * konfigurierbar, damit `fontSize`-Angaben in schmaleren Karten (Dashboard-Grid, halbe
 * Spaltenbreite) nicht auf ~7 px herunterskaliert werden — Aufrufer in halben Karten
 * uebergeben einen kleineren Wert. Die senkrechte Ansicht bekommt eine y-Achse mit 3
 * formatierten Ticks (`formatCentsShort`); Beschriftungs-/Wertespalten der waagerechten
 * Ansicht messen sich jetzt an der tatsaechlich laengsten Beschriftung (statt fixer 150/90-
 * Konstanten) und werden zur Not gestaucht, damit mindestens 30 % der Breite fuer die
 * Balken selbst bleiben — funktioniert dadurch sowohl fuer kurze Aging-Bucket-Label als auch
 * fuer lange Kundennamen, bei voller UND reduzierter `viewBoxWidth`.
 */
export function BarChart({
  title,
  data,
  orientation = "vertical",
  color,
  viewBoxWidth = 640,
  emptyMessage,
}: {
  title: string;
  data: ChartDatum[];
  orientation?: "vertical" | "horizontal";
  color?: string;
  viewBoxWidth?: number;
  emptyMessage?: string;
}) {
  const domainMin = Math.min(0, ...data.map((d) => d.value));
  const domainMax = Math.max(0, ...data.map((d) => d.value));
  const width = viewBoxWidth;
  const height = orientation === "horizontal" ? data.length * 34 + 20 : 240;

  return (
    <ChartFrame title={title} ariaLabel={title} data={data} width={width} height={height} emptyMessage={emptyMessage}>
      {orientation === "horizontal"
        ? renderHorizontal(data, domainMin, domainMax, width, color)
        : renderVertical(data, domainMin, domainMax, width, height, color)}
    </ChartFrame>
  );
}

function renderVertical(
  data: ChartDatum[],
  domainMin: number,
  domainMax: number,
  width: number,
  height: number,
  color?: string,
) {
  const fontSize = 12;
  const padTop = 10;
  const padBottom = 30;
  const padRight = 10;
  const range = domainMax - domainMin || 1;
  const ticks = [
    { f: 0, value: domainMax },
    { f: 0.5, value: (domainMax + domainMin) / 2 },
    { f: 1, value: domainMin },
  ];
  const tickLabels = ticks.map((t) => formatCentsShort(Math.round(t.value)));
  // y-Achse (Fix I5): padLeft misst sich an der laengsten Tick-Beschriftung statt einer
  // festen Konstante — "-1.234,5 k€" braucht mehr Platz als "0,00 €".
  const padLeft = Math.max(36, Math.max(...tickLabels.map((l) => l.length)) * fontSize * CHAR_WIDTH_FACTOR + 14);
  const plotHeight = height - padTop - padBottom;
  const plotWidth = width - padLeft - padRight;
  const step = data.length > 0 ? plotWidth / data.length : 0;
  const barWidth = Math.max(2, step * 0.6);
  // Wert -> y-Position: 0 faellt auf die Nulllinie, nicht mehr fest auf den Plot-Rand.
  const scaleY = (v: number) => padTop + ((domainMax - v) / range) * plotHeight;
  const zeroY = scaleY(0);
  // Fix I6: bei vielen Datenpunkten (z. B. 12 Monate) nur jedes zweite Monatslabel zeigen,
  // dieselbe Regel wie LineChart — reduziert Ueberlappung bei kleiner Schrift.
  const skipLabels = data.length > 6;

  return (
    <>
      {ticks.map((t, i) => (
        <line
          key={t.f}
          x1={padLeft}
          x2={width - padRight}
          y1={padTop + t.f * plotHeight}
          y2={padTop + t.f * plotHeight}
          stroke={CHART_COLORS.grid}
        >
          <title>{tickLabels[i]}</title>
        </line>
      ))}
      {ticks.map((t, i) => (
        <text
          key={`label-${t.f}`}
          x={padLeft - 8}
          y={padTop + t.f * plotHeight}
          textAnchor="end"
          dominantBaseline="middle"
          fontSize={fontSize}
          fill={CHART_COLORS.label}
        >
          {tickLabels[i]}
        </text>
      ))}
      {domainMin < 0 && <line x1={padLeft} x2={width - padRight} y1={zeroY} y2={zeroY} stroke={CHART_COLORS.axis} />}
      {data.map((d, i) => {
        const barTop = scaleY(Math.max(0, d.value));
        const barBottom = scaleY(Math.min(0, d.value));
        const x = padLeft + i * step + (step - barWidth) / 2;
        return (
          <g key={`${i}-${d.label}`}>
            <rect
              x={x}
              y={barTop}
              width={barWidth}
              height={barBottom - barTop}
              fill={d.color ?? color ?? CHART_COLORS.primary}
              className="transition-opacity hover:opacity-80"
            >
              <title>{`${d.label}: ${d.valueLabel}`}</title>
            </rect>
            {(!skipLabels || i % 2 === 0) && (
              <text
                x={x + barWidth / 2}
                y={height - 12}
                textAnchor="middle"
                fontSize={fontSize}
                fill={CHART_COLORS.label}
                paintOrder="stroke"
                stroke="#ffffff"
                strokeWidth={3}
              >
                {d.label}
              </text>
            )}
          </g>
        );
      })}
    </>
  );
}

function renderHorizontal(data: ChartDatum[], domainMin: number, domainMax: number, width: number, color?: string) {
  const fontSize = 12;
  const rowHeight = 34;
  const padTop = 10;
  // Fix I6 (Abschluss-Review): Beschriftungs-/Wertespalten messen sich an der tatsaechlich
  // laengsten Zeichenkette in `data` statt fixer Konstanten (vorher 150/90, siehe Fix 2 des
  // Task-5-Review-Vorlaufs) — funktioniert dadurch sowohl fuer kurze Aging-Bucket-Label
  // ("> 90 Tage") als auch fuer lange, mit `truncateName` gekuerzte Kundennamen, und bleibt
  // auch bei einer reduzierten `viewBoxWidth` (halbe Dashboard-Karte) proportional stimmig.
  // Mindestens 30 % der Breite bleiben den Balken vorbehalten (sonst wuerden sie bei sehr
  // langen Labels auf einer schmalen viewBox unsichtbar).
  const maxLabelChars = Math.max(...data.map((d) => d.label.length));
  const maxValueChars = Math.max(...data.map((d) => d.valueLabel.length));
  const rawLabelWidth = maxLabelChars * fontSize * CHAR_WIDTH_FACTOR + 16;
  const rawValueWidth = maxValueChars * fontSize * CHAR_WIDTH_FACTOR + 16;
  const maxColumnsWidth = width * 0.7;
  const columnScale = rawLabelWidth + rawValueWidth > maxColumnsWidth ? maxColumnsWidth / (rawLabelWidth + rawValueWidth) : 1;
  const labelWidth = Math.max(40, Math.min(170, rawLabelWidth * columnScale));
  const valueWidth = Math.max(40, Math.min(120, rawValueWidth * columnScale));
  // Fix (Screenshot-Review, 12e-fix-01): `labelWidth`/`valueWidth` duerfen kleiner als
  // `rawLabelWidth`/`rawValueWidth` werden (Stauchung ODER die 40er-Untergrenze) — ohne
  // eine passende Verkleinerung der Schrift ragte ein langer Name dann ueber den linken
  // SVG-Rand hinaus (im Screenshot als abgeschnittenes "S" sichtbar). `fontScale` schrumpft
  // die Schrift im selben Verhaeltnis wie die tatsaechlich zugeteilte Spalte gegenueber dem
  // bei `fontSize` berechneten Platzbedarf.
  const labelFontSize = fontSize * Math.min(1, labelWidth / rawLabelWidth);
  const valueFontSize = fontSize * Math.min(1, valueWidth / rawValueWidth);
  const plotLeft = labelWidth + 10;
  const plotRight = width - valueWidth;
  const plotWidth = plotRight - plotLeft;
  const barHeight = 18;
  const range = domainMax - domainMin || 1;
  // Wert -> x-Position: 0 faellt auf die Nulllinie, nicht mehr fest auf `plotLeft`.
  const scaleX = (v: number) => plotLeft + ((v - domainMin) / range) * plotWidth;
  const zeroX = scaleX(0);
  const bottom = padTop + data.length * rowHeight;

  return (
    <>
      {domainMin < 0 && domainMax > 0 && (
        <line x1={zeroX} x2={zeroX} y1={padTop} y2={bottom} stroke={CHART_COLORS.axis} />
      )}
      {data.map((d, i) => {
        const centerY = padTop + i * rowHeight + rowHeight / 2;
        const barStart = scaleX(Math.min(0, d.value));
        const barEnd = scaleX(Math.max(0, d.value));
        const isNegative = d.value < 0;
        return (
          <g key={`${i}-${d.label}`}>
            <text
              x={plotLeft - 8}
              y={centerY}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={labelFontSize}
              fill={CHART_COLORS.label}
              paintOrder="stroke"
              stroke="#ffffff"
              strokeWidth={3}
            >
              {d.label}
            </text>
            <rect
              x={barStart}
              y={centerY - barHeight / 2}
              width={barEnd - barStart}
              height={barHeight}
              fill={d.color ?? color ?? CHART_COLORS.primary}
              className="transition-opacity hover:opacity-80"
            >
              <title>{`${d.label}: ${d.valueLabel}`}</title>
            </rect>
            <text
              x={isNegative ? barStart - 8 : barEnd + 8}
              y={centerY}
              textAnchor={isNegative ? "end" : "start"}
              dominantBaseline="middle"
              fontSize={valueFontSize}
              fill={CHART_COLORS.label}
              paintOrder="stroke"
              stroke="#ffffff"
              strokeWidth={3}
            >
              {d.valueLabel}
            </text>
          </g>
        );
      })}
    </>
  );
}
