"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { optionalSelectValue, emptyOptionLabel } from "@/lib/forms/optional-select";

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
interface ContactOption {
  id: string;
  customerId: string;
  label: string;
  isDefault?: boolean;
}
interface AddressOption {
  id: string;
  customerId: string;
  label: string;
  isDefault?: boolean;
}
interface LineState {
  description: string;
  articleNumber: string;
  quantity: string;
  unit: string;
  price: string;
  taxRate: number;
}

function emptyLine(): LineState {
  return { description: "", articleNumber: "", quantity: "1", unit: "C62", price: "0", taxRate: 19 };
}

/** Manuelle Lieferscheinanlage ohne Quelldokument (z. B. Direktlieferung). */
export function DeliveryNoteForm({
  customers,
  products,
  contacts = [],
  addresses = [],
}: {
  customers: CustomerOption[];
  products: ProductOption[];
  contacts?: ContactOption[];
  addresses?: AddressOption[];
}) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [contactPersonId, setContactPersonId] = useState("");
  const [shippingAddressId, setShippingAddressId] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [showPrices, setShowPrices] = useState(false);
  const [showTax, setShowTax] = useState(false);
  const [showArticleNumber, setShowArticleNumber] = useState(true);
  const [showDescription, setShowDescription] = useState(true);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineState[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toCents = (s: string) => Math.round((parseFloat(s.replace(",", ".")) || 0) * 100);
  const toMilli = (s: string) => Math.round((parseFloat(s.replace(",", ".")) || 0) * 1000);

  const customerContacts = contacts.filter((c) => c.customerId === customerId);
  const customerAddresses = addresses.filter((a) => a.customerId === customerId);
  // Fix-Welle B3: leere Option nennt die Kundenvorgabe explizit, wenn sie existiert.
  const hasDefaultContact = customerContacts.some((c) => c.isDefault);
  const hasDefaultShippingAddress = customerAddresses.some((a) => a.isDefault);

  function selectCustomer(id: string) {
    setCustomerId(id);
    // Wie NewInvoiceForm/NewDocumentForm: Ansprechpartner/Adresse gehoeren zum ALTEN
    // Kunden — beim Kundenwechsel zuruecksetzen, wenn sie nicht (mehr) passen.
    if (contactPersonId && !contacts.some((c) => c.id === contactPersonId && c.customerId === id)) {
      setContactPersonId("");
    }
    if (shippingAddressId && !addresses.some((a) => a.id === shippingAddressId && a.customerId === id)) {
      setShippingAddressId("");
    }
  }

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
      customerId,
      // Fix-Welle B3: DeliveryNoteForm ist ein reines Anlage-Formular (kein Bearbeiten-Pfad)
      // — ein leeres Feld wird daher immer als fehlender Schluessel (undefined) gesendet,
      // damit die Kundenvorgabe (Default-Ansprechpartner/-Lieferadresse) serverseitig greift.
      contactPersonId: optionalSelectValue(contactPersonId, false),
      shippingAddressId: optionalSelectValue(shippingAddressId, false),
      deliveryDate: deliveryDate || undefined,
      showPrices,
      showTax,
      showArticleNumber,
      showDescription,
      notes: notes || undefined,
      lines: lines.map((l) => ({
        description: l.description,
        articleNumber: l.articleNumber || undefined,
        quantityMilli: toMilli(l.quantity),
        unit: l.unit,
        unitNetPriceCents: toCents(l.price),
        taxRate: l.taxRate,
      })),
    };
    const res = await fetch("/api/delivery-notes", {
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
    router.push(`/lieferscheine/${j.id}`);
  }

  const input = "rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none";

  return (
    <form onSubmit={submit} className="space-y-6">
      {error && <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Kunde</span>
          <select className={input} value={customerId} onChange={(e) => selectCustomer(e.target.value)} required>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Lieferdatum (optional)</span>
          <input type="date" className={input} value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Ansprechpartner</span>
          <select className={input} value={contactPersonId} onChange={(e) => setContactPersonId(e.target.value)}>
            <option value="">{emptyOptionLabel(hasDefaultContact)}</option>
            {customerContacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Lieferadresse</span>
          <select className={input} value={shippingAddressId} onChange={(e) => setShippingAddressId(e.target.value)}>
            <option value="">{emptyOptionLabel(hasDefaultShippingAddress)}</option>
            {customerAddresses.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={showArticleNumber} onChange={(e) => setShowArticleNumber(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
          Artikelnummer anzeigen
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={showDescription} onChange={(e) => setShowDescription(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
          Beschreibung anzeigen
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={showPrices} onChange={(e) => setShowPrices(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
          Preise anzeigen
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={showTax} onChange={(e) => setShowTax(e.target.checked)} className="h-4 w-4 rounded border-slate-300" disabled={!showPrices} />
          USt anzeigen
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
            <div className="col-span-12 flex flex-col gap-1 sm:col-span-4">
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
            <input className={`${input} col-span-6 sm:col-span-2`} placeholder="Art.-Nr." value={line.articleNumber} onChange={(e) => patchLine(i, { articleNumber: e.target.value })} />
            <input className={`${input} col-span-3 sm:col-span-2`} placeholder="Menge" value={line.quantity} onChange={(e) => patchLine(i, { quantity: e.target.value })} />
            <input className={`${input} col-span-3 sm:col-span-1`} placeholder="Einh." value={line.unit} onChange={(e) => patchLine(i, { unit: e.target.value })} />
            <input className={`${input} col-span-5 sm:col-span-1`} placeholder="Preis €" value={line.price} onChange={(e) => patchLine(i, { price: e.target.value })} />
            <select className={`${input} col-span-6 sm:col-span-1`} value={line.taxRate} onChange={(e) => patchLine(i, { taxRate: Number(e.target.value) })}>
              <option value={19}>19%</option>
              <option value={7}>7%</option>
              <option value={0}>0%</option>
            </select>
            <button type="button" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} className="col-span-1 text-sm text-rose-500 hover:underline" disabled={lines.length === 1}>
              ✕
            </button>
          </div>
        ))}
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">Hinweis / Notiz</span>
        <textarea className={input} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      <div className="flex items-center justify-end border-t border-slate-200 pt-4">
        <button type="submit" disabled={busy} className="rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
          {busy ? "Speichern…" : "Lieferschein anlegen"}
        </button>
      </div>
    </form>
  );
}
