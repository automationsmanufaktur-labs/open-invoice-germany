"use client";

/**
 * "Neues Produkt"-Dialog (Phase 4b, Produkt-Picker Inline-Anlage): natives <dialog>,
 * legt ueber die Server Action createProductInline ein Produkt an (dieselbe Domain/Zod
 * wie ProductForm/saveProduct) und uebergibt es an den Aufrufer, statt zu redirecten.
 */
import { useRef, useState } from "react";
import { createProductInline, type CreateProductInlineResult } from "@/app/actions/masterdata";

export interface InlineProduct {
  id: string;
  name: string;
  unit: string;
  netPriceCents: number;
  taxRate: number;
}

export function NewProductDialog({ onCreated }: { onCreated: (p: InlineProduct) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [articleNumber, setArticleNumber] = useState("");
  const [unit, setUnit] = useState("C62");
  const [netPrice, setNetPrice] = useState("");
  const [taxRate, setTaxRate] = useState(19);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open() {
    setError(null);
    dialogRef.current?.showModal();
  }
  function close() {
    dialogRef.current?.close();
  }

  async function submit() {
    if (!name.trim() || !netPrice.trim()) return;
    setBusy(true);
    setError(null);
    const result: CreateProductInlineResult = await createProductInline({
      name,
      articleNumber: articleNumber || undefined,
      unit,
      netPrice,
      taxRate,
      differential: false,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onCreated(result.product);
    setName("");
    setArticleNumber("");
    setNetPrice("");
    close();
  }

  const input = "rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none";

  return (
    <>
      <button type="button" onClick={open} className="text-xs font-medium text-indigo-600 hover:underline">
        + Neues Produkt
      </button>
      {/* Bewusst KEIN <form> hier: der Dialog haengt (ueber ProductPicker) im DOM-Baum
          des umschliessenden Editor-<form> (NewInvoiceForm/NewDocumentForm) — ein
          verschachteltes <form> ist ungueltiges HTML und fuehrt zu einem
          Hydration-Mismatch, der den GESAMTEN Editor-Zustand zuruecksetzt. Speichern
          laeuft daher ueber einen normalen Button-Klick, nicht ueber form-Submit. */}
      <dialog
        ref={dialogRef}
        className="w-full max-w-md rounded-lg border border-slate-200 p-0 backdrop:bg-slate-900/40"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !busy) {
            e.preventDefault();
            void submit();
          }
        }}
      >
        <div className="space-y-3 p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-900">Neues Produkt</h3>
            <button type="button" onClick={close} className="text-slate-400 hover:text-slate-700">
              ✕
            </button>
          </div>
          {error && <div className="rounded-md border border-rose-200 bg-rose-50 p-2 text-sm text-rose-800">{error}</div>}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Bezeichnung</span>
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Artikelnummer (optional)</span>
            <input className={input} value={articleNumber} onChange={(e) => setArticleNumber(e.target.value)} />
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-slate-700">Einheit</span>
              <input className={input} value={unit} onChange={(e) => setUnit(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-slate-700">Preis netto €</span>
              <input className={input} value={netPrice} onChange={(e) => setNetPrice(e.target.value)} placeholder="0,00" required />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-slate-700">USt-Satz</span>
              <select className={input} value={taxRate} onChange={(e) => setTaxRate(Number(e.target.value))}>
                <option value={19}>19 %</option>
                <option value={7}>7 %</option>
                <option value={0}>0 %</option>
              </select>
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={close} className="text-sm text-slate-500 hover:text-slate-800">
              Abbrechen
            </button>
            <button type="button" onClick={() => void submit()} disabled={busy} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
              {busy ? "Speichern…" : "Anlegen und uebernehmen"}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
