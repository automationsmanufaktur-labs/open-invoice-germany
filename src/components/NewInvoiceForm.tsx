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

const SCHEME_NOTICE: Record<string, string> = {
  KLEINUNTERNEHMER: "Kleinunternehmer gemäß § 19 UStG, kein Ausweis von Umsatzsteuer",
  REVERSE_CHARGE: "Steuerschuldnerschaft des Leistungsempfängers",
  DIFFERENZ: "Gebrauchtgegenstände/Sonderregelung (§ 25a UStG)",
  DRITTLAND_LEISTUNG: "Leistungsort im Drittland (§ 3a Abs. 2 UStG) — nicht im Inland steuerbar",
};
const SCHEME_CATEGORY: Record<string, string> = {
  REGULAR: "S",
  KLEINUNTERNEHMER: "E",
  REVERSE_CHARGE: "AE",
  DIFFERENZ: "S",
  DRITTLAND_LEISTUNG: "O",
};

function emptyLine(): LineState {
  return { description: "", quantity: "1", unit: "C62", price: "0", taxRate: 19 };
}

export function NewInvoiceForm({ customers, products }: { customers: CustomerOption[]; products: ProductOption[] }) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [scheme, setScheme] = useState("REGULAR");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("Zahlbar innerhalb von 14 Tagen ohne Abzug.");
  const [currency, setCurrency] = useState("EUR");
  const [lines, setLines] = useState<LineState[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isRegular = scheme === "REGULAR";
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
    const notice = SCHEME_NOTICE[scheme];
    const finalNotes = notice ? `${notice}${notes ? " — " + notes : ""}` : notes || undefined;
    const body = {
      customerId,
      type: "INVOICE",
      taxScheme: scheme,
      currency: currency,
      deliveryDate: deliveryDate || undefined,
      dueDate: dueDate || undefined,
      notes: finalNotes,
      internalNotes: internalNotes || undefined,
      paymentTerms: paymentTerms || undefined,
      lines: lines.map((l) => ({
        description: l.description,
        quantityMilli: toMilli(l.quantity),
        unit: l.unit,
        unitNetPriceCents: toCents(l.price),
        taxRate: isRegular ? l.taxRate : 0,
        taxCategory: SCHEME_CATEGORY[scheme] ?? "S",
        discountPermille: 0,
      })),
    };
    const res = await fetch("/api/invoices", {
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
    router.push(`/rechnungen/${j.id}`);
  }

  const input = "rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none";

  return (
    <form onSubmit={submit} className="space-y-6">
      {error && <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

      <div className="grid gap-4 sm:grid-cols-2">
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
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Steuerschema</span>
          <select className={input} value={scheme} onChange={(e) => setScheme(e.target.value)}>
            <option value="REGULAR">Regelbesteuerung</option>
            <option value="KLEINUNTERNEHMER">Kleinunternehmer (§ 19)</option>
            <option value="REVERSE_CHARGE">Reverse Charge (§ 13b)</option>
            <option value="DIFFERENZ">Differenzbesteuerung (§ 25a)</option>
            <option value="DRITTLAND_LEISTUNG">Drittland-Leistung (§ 3a Abs. 2)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Währung</span>
          <select className={input} value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="EUR">EUR (€)</option>
            <option value="USD">USD ($)</option>
            <option value="CHF">CHF</option>
            <option value="GBP">GBP (£)</option>
            <option value="JPY">JPY (¥)</option>
            <option value="CAD">CAD</option>
            <option value="AUD">AUD</option>
            <option value="SEK">SEK</option>
            <option value="PLN">PLN</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Leistungsdatum</span>
          <input type="date" className={input} value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Fällig am</span>
          <input type="date" className={input} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
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
              <input
                className={input}
                placeholder="Beschreibung"
                value={line.description}
                onChange={(e) => patchLine(i, { description: e.target.value })}
                required
              />
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
            <select className={`${input} col-span-8 sm:col-span-1`} value={isRegular ? line.taxRate : 0} onChange={(e) => patchLine(i, { taxRate: Number(e.target.value) })} disabled={!isRegular}>
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

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Hinweis / Notiz</span>
          <textarea className={input} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          {SCHEME_NOTICE[scheme] && <span className="text-xs text-slate-500">Pflichthinweis „{SCHEME_NOTICE[scheme]}“ wird automatisch ergänzt.</span>}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Zahlungsbedingungen</span>
          <textarea className={input} rows={2} value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">
            Interne Notiz
            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-800">nur intern sichtbar</span>
          </span>
          <textarea className={input} rows={2} value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} />
        </label>
      </div>

      <div className="flex items-center justify-between border-t border-slate-200 pt-4">
        <span className="text-sm text-slate-500">
          Nettosumme: <span className="tabular font-medium text-slate-800">{(netCents / 100).toFixed(2)} {currency}</span>
        </span>
        <button type="submit" disabled={busy} className="rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
          {busy ? "Speichern…" : "Als Entwurf anlegen"}
        </button>
      </div>
    </form>
  );
}
