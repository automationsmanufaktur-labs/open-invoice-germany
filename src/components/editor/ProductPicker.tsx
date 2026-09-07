"use client";

/**
 * Produkt-Picker (Phase 4b): Suchfeld filtert clientseitig ueber die Produktliste
 * (Props, keine neue Route noetig laut Vorgabe), plus "Neues Produkt"-Dialog fuer
 * die Inline-Anlage.
 */
import { useState } from "react";
import { NewProductDialog, type InlineProduct } from "./NewProductDialog";

export interface ProductOption {
  id: string;
  name: string;
  unit: string;
  netPriceCents: number;
  taxRate: number;
  articleNumber?: string | null;
}

export function ProductPicker({
  products,
  onPick,
  onCreated,
}: {
  products: ProductOption[];
  onPick: (p: ProductOption) => void;
  onCreated?: (p: InlineProduct) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const filtered = query.trim()
    ? products.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()))
    : products;

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <input
          className="w-full rounded border border-slate-200 px-2 py-1 text-xs text-slate-600"
          placeholder="Produkt suchen…"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
        />
        <NewProductDialog
          onCreated={(p) => {
            onCreated?.(p);
            onPick(p);
            setQuery("");
            setOpen(false);
          }}
        />
      </div>
      {open && filtered.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-slate-200 bg-white text-xs shadow-lg">
          {filtered.slice(0, 30).map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="block w-full px-2 py-1.5 text-left hover:bg-indigo-50"
                onClick={() => {
                  onPick(p);
                  setQuery("");
                  setOpen(false);
                }}
              >
                {p.name} <span className="text-slate-400">— {(p.netPriceCents / 100).toFixed(2)} € / {p.unit}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <button type="button" aria-hidden className="fixed inset-0 z-0 cursor-default" onClick={() => setOpen(false)} tabIndex={-1} />
      )}
    </div>
  );
}
