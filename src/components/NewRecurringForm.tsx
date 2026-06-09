"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface CustomerOption {
  id: string;
  name: string;
}
interface ProductOption {
  id: string;
  name: string;
  unit: string;
  netPriceCents: number;
  taxRate: number;
}
interface LineState {
  description: string;
  quantity: string;
  unit: string;
  price: string;
  taxRate: number;
}

function emptyLine(): LineState {
  return { description: "", quantity: "1", unit: "C62", price: "0", taxRate: 19 };
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function NewRecurringForm({ customers, products }: { customers: CustomerOption[]; products: ProductOption[] }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [interval, setInterval] = useState("MONTHLY");
  const [intervalCount, setIntervalCount] = useState("1");
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState("");
  const [paymentTermsDays, setPaymentTermsDays] = useState("14");
  const [autoFinalize, setAutoFinalize] = useState(false);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineState[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toCents = (s: string) => Math.round((parseFloat(s.replace(",", ".")) || 0) * 100);
  const toMilli = (s: string) => Math.round((parseFloat(s.replace(",", ".")) || 0) * 1000);
  const netCents = lines.reduce((sum, l) => sum + Math.round((toMilli(l.quantity) * toCents(l.price)) / 1000), 0);

  function patchLine(i: number, patch: Partial<LineState>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function applyProduct(i: number, productId: string) {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    patchLine(i, { description: p.name, unit: p.unit, price: (p.netPriceCents / 100).toFixed(2), taxRate: p.taxRate });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      title,
      customerId,
      interval,
      intervalCount: Number(intervalCount) || 1,
      startDate,
      endDate: endDate || undefined,
      paymentTermsDays: Number(paymentTermsDays) || 14,
      autoFinalize,
      taxScheme: "REGULAR",
      currency: "EUR",
      notes: notes || undefined,
      lines: lines.map((l) => ({
        description: l.description,
        quantityMilli: toMilli(l.quantity),
        unit: l.unit,
        unitNetPriceCents: toCents(l.price),
        taxRate: l.taxRate,
        taxCategory: "S",
        discountPermille: 0,
      })),
    };
    const res = await fetch("/api/recurring", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? "Anlegen fehlgeschlagen.");
      setBusy(false);
      return;
    }
    const j = (await res.json()) as { id: string };
    router.push(`/abos/${j.id}`);
  }

  const input = "rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none";

  return (
    <form onSubmit={submit} className="space-y-6">
      {error && <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Bezeichnung</span>
          <input className={input} placeholder="z. B. Wartungsvertrag Mustermann" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Kunde</span>
          <select className={input} value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Rhythmus</span>
          <select className={input} value={interval} onChange={(e) => setInterval(e.target.value)}>
            <option value="WEEKLY">wöchentlich</option>
            <option value="MONTHLY">monatlich</option>
            <option value="QUARTERLY">vierteljährlich</option>
            <option value="YEARLY">jährlich</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">alle N Intervalle</span>
          <input className={input} type="number" min={1} max={48} value={intervalCount} onChange={(e) => setIntervalCount(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Startdatum</span>
          <input className={input} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Enddatum (optional)</span>
          <input className={input} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Zahlungsziel (Tage)</span>
          <input className={input} type="number" min={0} max={365} value={paymentTermsDays} onChange={(e) => setPaymentTermsDays(e.target.value)} />
        </label>
        <label className="flex cursor-pointer items-center gap-2 self-end rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
          <input type="checkbox" checked={autoFinalize} onChange={(e) => setAutoFinalize(e.target.checked)} />
          <span className="text-slate-700">Rechnungen automatisch festschreiben (sofort GoBD-konform &amp; nummeriert)</span>
        </label>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-slate-900">Positionen</h2>
          <button type="button" onClick={() => setLines((ls) => [...ls, emptyLine()])} className="text-sm font-medium text-indigo-600 hover:underline">
            + Position
          </button>
        </div>
        {lines.map((line, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 rounded-lg border border-slate-200 bg-white p-3">
            <div className="col-span-12 flex flex-col gap-1 sm:col-span-5">
              <input className={input} placeholder="Beschreibung" value={line.description} onChange={(e) => patchLine(i, { description: e.target.value })} required />
              {products.length > 0 && (
                <select className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-500" defaultValue="" onChange={(e) => applyProduct(i, e.target.value)}>
                  <option value="">aus Katalog…</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <input className={`${input} col-span-4 sm:col-span-2`} placeholder="Menge" value={line.quantity} onChange={(e) => patchLine(i, { quantity: e.target.value })} />
            <input className={`${input} col-span-3 sm:col-span-1`} placeholder="Einh." value={line.unit} onChange={(e) => patchLine(i, { unit: e.target.value })} />
            <input className={`${input} col-span-5 sm:col-span-2`} placeholder="Preis netto €" value={line.price} onChange={(e) => patchLine(i, { price: e.target.value })} />
            <select className={`${input} col-span-8 sm:col-span-1`} value={line.taxRate} onChange={(e) => patchLine(i, { taxRate: Number(e.target.value) })}>
              <option value={19}>19%</option>
              <option value={7}>7%</option>
              <option value={0}>0%</option>
            </select>
            <button type="button" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} className="col-span-4 text-sm text-rose-500 hover:underline sm:col-span-1" disabled={lines.length === 1}>
              ✕
            </button>
          </div>
        ))}
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">Hinweis / Notiz (erscheint auf jeder Rechnung)</span>
        <textarea className={input} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      <div className="flex items-center justify-between border-t border-slate-200 pt-4">
        <span className="text-sm text-slate-500">
          Nettosumme je Rechnung: <span className="tabular font-medium text-slate-800">{(netCents / 100).toFixed(2)} €</span>
        </span>
        <button type="submit" disabled={busy} className="rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
          {busy ? "Speichern…" : "Abo anlegen"}
        </button>
      </div>
    </form>
  );
}
