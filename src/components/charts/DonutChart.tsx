import type { ChartDatum } from "./types";
import { CHART_COLORS } from "./types";
import { ChartFrame } from "./ChartFrame";

/**
 * Ringdiagramm (Phase 12e, Task 1): Statusverteilung (z. B. offen/ueberfaellig/bezahlt).
 * Farbe je Segment kommt aus `datum.color` — es gibt keine automatische Palettenrotation,
 * weil Status im Projekt feste Farben tragen (amber = faellig, rose = ueberfaellig, ...).
 * `total === 0` rendert nur Spur + Mitteltext, keine Segmente — keine Division durch Null.
 * Legende als `<ul>` unter dem SVG (nicht im SVG), wie im Brief vorgegeben. Fix 1 (Review):
 * die Legende ist `aria-hidden`, weil die sr-only-Wertetabelle aus `ChartFrame` dieselben
 * Label/Wert-Paare bereits vorliest — ohne das haette ein Screenreader jedes Segment
 * doppelt angesagt.
 *
 * Fix I5 (Abschluss-Review): Mittelzahl-`fontSize` 28 -> 20 — in einem gestreckten Grid-Item
 * (vorher `items-stretch`, jetzt `items-start`, siehe DashboardWidgets.tsx) rendert die
 * 240er-viewBox sonst weit über ihre native Größe hinaus. Fix M4: `key={d.label}` ->
 * `key={`${i}-${d.label}`}` (Kollision bei gleichnamigen Segmenten). Fix M10: `"tabular"`
 * ist keine Tailwind-Klasse (wirkungslos) -> `"tabular-nums"`; Mittelzahl-Farbe kommt jetzt
 * aus `CHART_COLORS.centerText` statt einer hartkodierten Hex-Konstante.
 */
export function DonutChart({ title, data }: { title: string; data: ChartDatum[] }) {
  const size = 240;
  const center = size / 2;
  const radius = 100;
  const strokeWidth = 28;
  const circumference = 2 * Math.PI * radius;
  const total = data.reduce((sum, d) => sum + Math.max(0, d.value), 0);

  let cumulative = 0;

  return (
    <div>
      <ChartFrame title={title} ariaLabel={title} data={data} width={size} height={size}>
        <circle cx={center} cy={center} r={radius} fill="none" stroke={CHART_COLORS.grid} strokeWidth={strokeWidth} />
        {total > 0 &&
          data.map((d, i) => {
            const value = Math.max(0, d.value);
            const len = (value / total) * circumference;
            const offset = -cumulative;
            cumulative += len;
            return (
              <circle
                key={`${i}-${d.label}`}
                cx={center}
                cy={center}
                r={radius}
                fill="none"
                stroke={d.color ?? CHART_COLORS.primary}
                strokeWidth={strokeWidth}
                strokeDasharray={`${len} ${circumference - len}`}
                strokeDashoffset={offset}
                transform={`rotate(-90 ${center} ${center})`}
                className="transition-opacity hover:opacity-80"
              >
                <title>{`${d.label}: ${d.valueLabel}`}</title>
              </circle>
            );
          })}
        <text x={center} y={center} textAnchor="middle" dominantBaseline="middle" fontSize={20} fontWeight={600} fill={CHART_COLORS.centerText}>
          {total}
        </text>
      </ChartFrame>
      {data.length > 0 && (
        <ul aria-hidden="true" className="mt-3 space-y-1 text-sm text-slate-600">
          {data.map((d, i) => (
            <li key={`${i}-${d.label}`} className="flex items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: d.color ?? CHART_COLORS.primary }}
              />
              <span>{d.label}</span>
              <span className="tabular-nums ml-auto text-slate-500">{d.valueLabel}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
