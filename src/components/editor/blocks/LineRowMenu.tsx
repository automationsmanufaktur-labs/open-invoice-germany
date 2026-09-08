"use client";

/**
 * „⋯"-Aktionsmenue je Zeile (Phase 11c, Task 5): Duplizieren / optional Langtext
 * ein-/ausblenden (nur ITEM, siehe `LineRow`) / Entfernen. Gleiches Overlay-Klick-
 * aussen-schliesst-Muster wie `ProductPicker`/`CustomerPicker` (`fixed inset-0`-
 * Button statt `onBlur`, damit ein Klick auf einen Menuepunkt nicht durch ein
 * vorzeitiges Blur verloren geht).
 *
 * "Typ ändern" (Task-5-Fix, Ruling): vier Eintraege (Position/Ueberschrift/
 * Textblock/Zwischensumme statt eines echten Submenues — reicht fuer vier Optionen),
 * der aktuelle Typ ist deaktiviert. Nur sichtbar, wenn `currentType`/`onChangeType`
 * gesetzt sind — `LineRow` laesst beide bei DELIVERY_NOTE weg (der Server kennt dort
 * keinen `lineType`, siehe `toDeliveryNotePayload`). Labels aus `LINE_TYPE_LABEL`
 * (`@/lib/editor/constants`) — dieselbe Quelle wie die "+ Position/…"-Links in
 * `LineItemsEditor`, nicht erneut definiert (Lastenheft 1.4/61.5).
 */
import { useState } from "react";
import type { LineType } from "@/lib/editor/draft";
import { LINE_TYPE_LABEL } from "@/lib/editor/constants";

const TYPE_ORDER: readonly LineType[] = ["ITEM", "HEADING", "TEXT", "SUBTOTAL"];

export function LineRowMenu({
  onDuplicate,
  onRemove,
  canRemove,
  toggleLabel,
  onToggleExpanded,
  currentType,
  onChangeType,
}: {
  onDuplicate: () => void;
  onRemove: () => void;
  canRemove: boolean;
  toggleLabel?: string;
  onToggleExpanded?: () => void;
  currentType?: LineType;
  onChangeType?: (lineType: LineType) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Zeilenaktionen"
        title="Zeilenaktionen"
        className="rounded px-1.5 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
      >
        ⋯
      </button>
      {open && (
        <>
          {/* M11 (Abschluss-Review): kein `aria-hidden` mehr auf einem per `tabIndex={-1}`
              zwar aus der Tab-Reihenfolge genommenen, aber weiterhin fokussierbaren
              Element — axe meldet `aria-hidden` dort unabhaengig vom `tabIndex`. */}
          <button type="button" tabIndex={-1} className="fixed inset-0 z-0 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-10 mt-1 w-48 rounded-md border border-slate-200 bg-white py-1 text-xs shadow-lg">
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left hover:bg-slate-50"
              onClick={() => {
                onDuplicate();
                setOpen(false);
              }}
            >
              Duplizieren
            </button>
            {onToggleExpanded && toggleLabel && (
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left hover:bg-slate-50"
                onClick={() => {
                  onToggleExpanded();
                  setOpen(false);
                }}
              >
                {toggleLabel}
              </button>
            )}
            {currentType && onChangeType && (
              <>
                <div className="mt-1 border-t border-slate-100 px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Typ ändern</div>
                {TYPE_ORDER.map((t) => (
                  <button
                    key={t}
                    type="button"
                    disabled={t === currentType}
                    className="block w-full px-3 py-1.5 text-left hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
                    onClick={() => {
                      onChangeType(t);
                      setOpen(false);
                    }}
                  >
                    {LINE_TYPE_LABEL[t]}
                  </button>
                ))}
              </>
            )}
            <button
              type="button"
              disabled={!canRemove}
              className="block w-full px-3 py-1.5 text-left text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => {
                onRemove();
                setOpen(false);
              }}
            >
              Entfernen
            </button>
          </div>
        </>
      )}
    </div>
  );
}
