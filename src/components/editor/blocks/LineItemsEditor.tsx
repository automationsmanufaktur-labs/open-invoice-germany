"use client";

/**
 * Positionstabelle (Phase 11c, Task 5): Tabellenkopf Pos. | Beschreibung | Menge |
 * Einheit | Preis | USt. | Rabatt | Betrag | ⋯, eine `LineRow` je `draft.lines`-
 * Eintrag, darunter die Add-Links. Echte `<table>` statt Grid-`<div>`s (Brief verlangt
 * eine Kopfzeile mit festen Spalten) — daher `overflow-x-auto` als bewusste
 * Vereinfachung fuer schmale Bildschirme (kein Card-Layout-Fallback, siehe
 * Task-5-Report).
 *
 * `grossDisplay` ist Teil von `DraftState` (nicht lokaler Komponentenzustand) —
 * ueberlebt so z. B. ein `replace` durch `TakeOverPrompt` und bleibt beim Umschalten
 * zwischen Bloecken erhalten. Reine Anzeige (siehe `LineRow`): `price` bleibt immer
 * netto, nur die berechnete Betrag-Spalte und ein Hinweistext neben dem Preisfeld
 * zeigen den Brutto-Wert.
 *
 * DELIVERY_NOTE kennt serverseitig keinen `lineType` (`toDeliveryNotePayload`,
 * `draft.ts`, filtert ausschliesslich ITEM-Zeilen) — die Add-Links "+ Überschrift"/
 * "+ Textblock"/"+ Zwischensumme" erscheinen deshalb NUR bei INVOICE/DOCUMENT
 * (Lastenheft 59: keine Buttons ohne Backend-Wirkung). Aus demselben Grund fehlt die
 * Rabatt-Spalte bei DELIVERY_NOTE komplett (Task-5-Fix 2, `deliveryNoteLineInputSchema`
 * kennt keinen Rabatt) — siehe `LineRow`s Modulkommentar (`showDiscount`).
 *
 * `totals` kommt als Prop von `DocumentEditor` (`useMemo`, Task-5-Fix Minor) statt
 * hier ein zweites Mal ueber `computeDraftTotals(draft)` berechnet zu werden — beide
 * Aufrufer haetten sonst bei jedem Tastendruck dieselbe (nicht ganz billige) Berechnung
 * doppelt ausgefuehrt.
 *
 * Drag & Drop: `dragKey` (lokaler State) haelt den `key` der gezogenen Zeile;
 * `onDrop` dispatcht `moveLine` mit dem (Vor-Entfernen-)Index der Zielzeile — gleiches
 * Verhalten wie die alte `dragIndex`-Logik, nur ueber den stabilen `line.key` statt
 * eines Arrayindex. Tastatur-Alternative: Alt+↑/↓ auf einer Zeile (`onRowKeyDown`,
 * bubbelt von jedem fokussierten Feld der Zeile zum `<tr>` hoch).
 *
 * "Enter" im Beschreibungs-/Bezeichnungsfeld der LETZTEN Zeile legt eine neue
 * ITEM-Zeile an und fokussiert deren Beschreibungsfeld: `descRefs` haelt eine
 * Ref-Map je `line.key`, `pendingFocusRef` markiert "eine Enter-Zeile wurde gerade
 * angefordert" und ein Effekt auf `draft.lines.length` fokussiert die dann neue letzte
 * Zeile, sobald sie tatsaechlich existiert (der neue `key` wird erst im Reducer per
 * `crypto.randomUUID()` erzeugt, ist also vor dem Dispatch nicht bekannt).
 */
import { useEffect, useRef, useState } from "react";
import type { DraftState, DraftAction } from "@/lib/editor/draft";
import type { EditorMode } from "@/lib/editor/constants";
import type { DraftTotals } from "@/lib/editor/totals";
import type { ProductOption } from "../ProductPicker";
import { LineRow } from "./LineRow";

export function LineItemsEditor({
  draft,
  dispatch,
  products,
  taxRates,
  mode,
  totals,
  onProductCreated,
}: {
  draft: DraftState;
  dispatch: (action: DraftAction) => void;
  products: ProductOption[];
  /** Phase 12c — org-eigene Steuersatz-Liste, durchgereicht an `LineRow`. */
  taxRates: readonly number[];
  mode: EditorMode;
  totals: DraftTotals;
  onProductCreated?: (p: ProductOption) => void;
}) {
  const taxDisabled = mode === "INVOICE" && draft.taxScheme !== "REGULAR";
  const allowOtherTypes = mode !== "DELIVERY_NOTE";
  const showDiscount = mode !== "DELIVERY_NOTE";

  let itemCounter = 0;
  const itemPositions = draft.lines.map((l) => (l.lineType === "ITEM" ? ++itemCounter : null));

  const [dragKey, setDragKey] = useState<string | null>(null);
  const descRefs = useRef(new Map<string, HTMLInputElement>());
  const pendingFocusRef = useRef(false);
  const prevLen = useRef(draft.lines.length);

  useEffect(() => {
    if (pendingFocusRef.current && draft.lines.length > prevLen.current) {
      const last = draft.lines[draft.lines.length - 1];
      if (last) descRefs.current.get(last.key)?.focus();
      pendingFocusRef.current = false;
    }
    prevLen.current = draft.lines.length;
  }, [draft.lines]);

  function addLineAfterLast() {
    pendingFocusRef.current = true;
    dispatch({ type: "addLine", lineType: "ITEM" });
  }
  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
  }
  function onDrop(index: number) {
    if (dragKey) dispatch({ type: "moveLine", key: dragKey, to: index });
    setDragKey(null);
  }
  function onRowKeyDown(e: React.KeyboardEvent, index: number, key: string) {
    if (!e.altKey) return;
    if (e.key === "ArrowUp" && index > 0) {
      e.preventDefault();
      dispatch({ type: "moveLine", key, to: index - 1 });
    } else if (e.key === "ArrowDown" && index < draft.lines.length - 1) {
      e.preventDefault();
      dispatch({ type: "moveLine", key, to: index + 1 });
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold text-slate-900">Positionen</h2>
        <label className="flex items-center gap-2 text-xs text-slate-500" title="Reine Anzeige — die Eingabe bleibt immer netto.">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 rounded border-slate-300"
            checked={draft.grossDisplay}
            onChange={(e) => dispatch({ type: "set", field: "grossDisplay", value: e.target.checked })}
          />
          Brutto anzeigen
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-medium text-slate-500">
              <th scope="col" className="w-10 py-1.5 pr-2">Pos.</th>
              <th scope="col" className="py-1.5 pr-2">Beschreibung</th>
              <th scope="col" className="w-20 py-1.5 pr-2">Menge</th>
              <th scope="col" className="w-28 py-1.5 pr-2">Einheit</th>
              <th scope="col" className="w-28 py-1.5 pr-2">{draft.grossDisplay ? "Preis (brutto)" : "Preis (netto)"}</th>
              <th scope="col" className="w-16 py-1.5 pr-2">USt.</th>
              {showDiscount && (
                <th scope="col" className="w-28 py-1.5 pr-2">Rabatt</th>
              )}
              <th scope="col" className="w-28 py-1.5 pr-2 text-right">Betrag</th>
              <th scope="col" className="w-8 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {draft.lines.map((line, index) => (
              <LineRow
                key={line.key}
                line={line}
                mode={mode}
                taxRates={taxRates}
                itemPos={itemPositions[index] ?? null}
                isLast={index === draft.lines.length - 1}
                taxDisabled={taxDisabled}
                grossDisplay={draft.grossDisplay}
                products={products}
                dispatch={dispatch}
                subtotalCents={totals.subtotals[index] ?? 0}
                canRemove={draft.lines.length > 1}
                registerDescRef={(key, el) => {
                  if (el) descRefs.current.set(key, el);
                  else descRefs.current.delete(key);
                }}
                onEnterLast={addLineAfterLast}
                onDragStart={() => setDragKey(line.key)}
                onDragOver={onDragOver}
                onDrop={() => onDrop(index)}
                onRowKeyDown={(e) => onRowKeyDown(e, index, line.key)}
                onProductCreated={onProductCreated}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-3 text-sm font-medium text-indigo-600">
        <button type="button" onClick={() => dispatch({ type: "addLine", lineType: "ITEM" })} className="hover:underline">
          + Position
        </button>
        {allowOtherTypes && (
          <>
            <button type="button" onClick={() => dispatch({ type: "addLine", lineType: "HEADING" })} className="hover:underline">
              + Überschrift
            </button>
            <button type="button" onClick={() => dispatch({ type: "addLine", lineType: "TEXT" })} className="hover:underline">
              + Textblock
            </button>
            <button type="button" onClick={() => dispatch({ type: "addLine", lineType: "SUBTOTAL" })} className="hover:underline">
              + Zwischensumme
            </button>
          </>
        )}
      </div>
    </div>
  );
}
