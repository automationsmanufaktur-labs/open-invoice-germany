"use client";

/**
 * Kunden-Picker (Phase 11c, Task 3): Suchfeld filtert clientseitig ueber die
 * Kundenliste (Name, Kundennummer, E-Mail), Tastaturbedienung Pfeil/Enter/Escape wie
 * `CommandPalette`, plus „+ Neuen Kunden anlegen" (Inline-Anlage ueber
 * `NewCustomerDialog`). Gewaehlter Kunde wird als Chip mit „aendern" angezeigt.
 *
 * Fix 1 (Task-3-Review): `NewCustomerDialog` haengt IMMER neben dem Suchfeld (wie
 * `ProductPicker`/`NewProductDialog`), nicht innerhalb der `open`-gegateten
 * Dropdown-`<ul>` — sonst unmountet das Schliessen der Dropdown im selben Handler den
 * gerade offenen/gerade geschlossenen Dialog und der Fokus faellt auf `<body>`. Nach der
 * Inline-Anlage wird der Fokus stattdessen explizit auf den „aendern"-Button des neuen
 * Chips gesetzt (Ref + `requestAnimationFrame`, da der Chip erst im naechsten Render
 * existiert).
 *
 * M11 (Abschluss-Review): Suchfeld + Trefferliste folgen jetzt dem ARIA-Combobox-Muster
 * (`role="combobox"`/`aria-expanded`/`aria-controls`/`aria-activedescendant` auf dem
 * Eingabefeld, `role="listbox"`/`role="option"`/`aria-selected` auf Liste/Eintraegen) —
 * vorher bekamen Screenreader-Nutzer die per Pfeiltaste bewegte Cursorposition (`safeCursor`)
 * nicht mitgeteilt.
 */
import { useId, useMemo, useRef, useState } from "react";
import { NewCustomerDialog, type InlineCustomer } from "./NewCustomerDialog";
import { inputCls } from "@/components/forms/fields";

export interface CustomerOption {
  id: string;
  name: string;
  customerNumber?: string | null;
  email?: string | null;
  defaultPaymentMethodId?: string | null;
  defaultDiscountPermille?: number | null;
}

const MAX_HITS = 30;

function subtitle(c: CustomerOption): string | null {
  const parts = [c.customerNumber, c.email].filter((v): v is string => Boolean(v));
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function CustomerPicker({
  customers,
  value,
  onChange,
  onCreated,
  disabled,
}: {
  customers: CustomerOption[];
  value: string;
  onChange: (id: string, customer: CustomerOption | null) => void;
  onCreated?: (c: CustomerOption) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const changeButtonRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const optionId = (id: string) => `${listboxId}-${id}`;

  const selected = useMemo(() => customers.find((c) => c.id === value) ?? null, [customers, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? customers.filter(
          (c) => c.name.toLowerCase().includes(q) || (c.customerNumber ?? "").toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q),
        )
      : customers;
    return list.slice(0, MAX_HITS);
  }, [customers, query]);

  const safeCursor = filtered.length === 0 ? 0 : Math.min(cursor, filtered.length - 1);

  function pick(c: CustomerOption) {
    onChange(c.id, c);
    setQuery("");
    setOpen(false);
  }

  function startSearch() {
    setOpen(true);
    setQuery("");
    setCursor(0);
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleCreated(c: InlineCustomer) {
    const option: CustomerOption = {
      id: c.id,
      name: c.name,
      customerNumber: c.customerNumber,
      email: c.email,
      defaultPaymentMethodId: c.defaultPaymentMethodId,
    };
    onCreated?.(option);
    onChange(option.id, option);
    setQuery("");
    setOpen(false);
    // Der Chip mit dem "aendern"-Button existiert erst im naechsten Render (selected
    // wechselt erst, wenn `value` beim Aufrufer aktualisiert wurde) — requestAnimationFrame
    // statt eines synchronen Fokus-Aufrufs.
    requestAnimationFrame(() => changeButtonRef.current?.focus());
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = filtered[safeCursor];
      if (hit) pick(hit);
    } else if (e.key === "Escape") {
      e.preventDefault();
      // CommandPalette-Verhalten: Escape schliesst immer die Dropdown, unabhaengig davon,
      // ob bereits ein Kunde gewaehlt ist. Der Fokus bleibt auf dem Eingabefeld (kein
      // blur() mehr) — nur wenn bereits ein Kunde gewaehlt ist, wechselt die Ansicht beim
      // naechsten Render zurueck zum Chip.
      setOpen(false);
    }
  }

  if (selected && !open) {
    const sub = subtitle(selected);
    return (
      <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-slate-900">{selected.name}</div>
          {sub && <div className="truncate text-xs text-slate-500">{sub}</div>}
        </div>
        {!disabled && (
          <button ref={changeButtonRef} type="button" className="shrink-0 text-xs font-medium text-indigo-600 hover:underline" onClick={startSearch}>
            ändern
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          className={`${inputCls} w-full`}
          placeholder="Kunde suchen…"
          value={query}
          disabled={disabled}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={open && filtered[safeCursor] ? optionId(filtered[safeCursor].id) : undefined}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setCursor(0);
          }}
          onKeyDown={onKeyDown}
        />
        {!disabled && <NewCustomerDialog onCreated={handleCreated} />}
      </div>
      {open && !disabled && (
        <ul id={listboxId} role="listbox" aria-label="Kundenvorschläge" className="absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-slate-200 bg-white text-sm shadow-lg">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-slate-400">Keine Treffer</li>
          ) : (
            filtered.map((c, i) => (
              <li key={c.id} id={optionId(c.id)} role="option" aria-selected={i === safeCursor}>
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  className={`block w-full px-3 py-1.5 text-left ${i === safeCursor ? "bg-indigo-50 text-indigo-700" : "hover:bg-slate-50"}`}
                  onClick={() => pick(c)}
                >
                  <span className="font-medium">{c.name}</span>
                  {subtitle(c) && <span className="ml-2 text-xs text-slate-400">{subtitle(c)}</span>}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
      {/* M11 (Abschluss-Review): kein `aria-hidden` mehr — siehe Kommentar in
          `LineRowMenu.tsx` (dasselbe Overlay-Klick-aussen-schliesst-Muster). */}
      {open && !disabled && <button type="button" className="fixed inset-0 z-0 cursor-default" onClick={() => setOpen(false)} tabIndex={-1} />}
    </div>
  );
}
