"use client";

/**
 * Einheiten-Auswahl fuer `LineRow` (Phase 11c, Task 5): `<select>` aus `UNIT_OPTIONS`
 * plus Option „andere…" fuer einen Freitext-Code (z. B. beim Bearbeiten eines
 * Altbelegs oder eines Produkts mit einem UN/ECE-Code ausserhalb der kleinen
 * Standardliste — `UNIT_OPTIONS` ist bewusst nur eine Teilmenge, siehe Kommentar in
 * `constants.ts`). `otherMode` ist lokaler Zustand (kein `DraftLine`-Feld) — er
 * steuert NUR, ob das Freitextfeld sichtbar ist, nicht den gespeicherten Wert selbst.
 * Aendert sich, ob `value` ein bekannter Code ist (z. B. nach `applyProduct` mit einer
 * Einheit ausserhalb `UNIT_OPTIONS`, etwa "LTR"), schaltet ein `prevKnown`-Vergleich
 * WAEHREND DES RENDERNS `otherMode` in BEIDE Richtungen automatisch mit: wird der Code
 * bekannt, zurueck auf die Auswahlliste; wird er unbekannt, auf das Freitextfeld (Task-
 * 5-Fix 4 — vorher schaltete dieser Vergleich nur in eine Richtung um, sodass das
 * `<select>` nach einem Produkt mit unbekannter Einheit einen Wert ohne passende
 * `<option>` zeigte). Waehlt der Nutzer dagegen bewusst "andere…", OHNE dass sich der
 * zugrunde liegende Code aendert (`known` bleibt gleich), greift dieser Vergleich nicht
 * — die Auswahl bleibt erhalten. Das React-sanktionierte "State waehrend des Renderns
 * anpassen"-Muster (react.dev, "You Might Not Need an Effect") statt eines
 * `useEffect`, der hierfuer sowohl einen unnoetigen zusaetzlichen Renderdurchlauf als
 * auch den Lint-Fehler `react-hooks/set-state-in-effect` ausloesen wuerde.
 */
import { useState } from "react";
import { UNIT_OPTIONS } from "@/lib/editor/constants";
import { inputCls } from "@/components/forms/fields";

const OTHER = "__other__";

export function UnitSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const known = UNIT_OPTIONS.some((u) => u.code === value);
  const [otherMode, setOtherMode] = useState(!known);
  const [prevKnown, setPrevKnown] = useState(known);
  if (known !== prevKnown) {
    setPrevKnown(known);
    setOtherMode(!known);
  }

  return (
    <div className="flex flex-col gap-1">
      <select
        className={inputCls}
        aria-label="Einheit"
        value={otherMode ? OTHER : value}
        onChange={(e) => {
          if (e.target.value === OTHER) {
            setOtherMode(true);
          } else {
            setOtherMode(false);
            onChange(e.target.value);
          }
        }}
      >
        {UNIT_OPTIONS.map((u) => (
          <option key={u.code} value={u.code}>
            {u.label}
          </option>
        ))}
        <option value={OTHER}>andere…</option>
      </select>
      {otherMode && <input className={inputCls} value={value} placeholder="Einheit" onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}
