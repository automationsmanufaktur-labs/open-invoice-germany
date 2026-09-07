"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface CustomerDefaultsData {
  defaultCurrency: string | null;
  defaultDiscountPermille: number;
  invoiceEmail: string | null;
  invoiceCc: string | null;
  quoteEmail: string | null;
  eInvoicePreferred: boolean;
  orderReference: string | null;
  deliveryTermsText: string | null;
  paymentTermsText: string | null;
  language: string;
}

/** Kundenvorgaben (§28) — Vollersatz-Formular (kein Merge, siehe Domain-Kommentar). */
export function CustomerDefaultsForm({ customerId, initial }: { customerId: string; initial: CustomerDefaultsData }) {
  const router = useRouter();
  const [defaultCurrency, setDefaultCurrency] = useState(initial.defaultCurrency ?? "");
  const [defaultDiscountPercent, setDefaultDiscountPercent] = useState((initial.defaultDiscountPermille / 10).toString());
  const [invoiceEmail, setInvoiceEmail] = useState(initial.invoiceEmail ?? "");
  const [invoiceCc, setInvoiceCc] = useState(initial.invoiceCc ?? "");
  const [quoteEmail, setQuoteEmail] = useState(initial.quoteEmail ?? "");
  const [eInvoicePreferred, setEInvoicePreferred] = useState(initial.eInvoicePreferred);
  const [orderReference, setOrderReference] = useState(initial.orderReference ?? "");
  const [deliveryTermsText, setDeliveryTermsText] = useState(initial.deliveryTermsText ?? "");
  const [paymentTermsText, setPaymentTermsText] = useState(initial.paymentTermsText ?? "");
  const [language, setLanguage] = useState(initial.language);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    const body = {
      defaultCurrency: defaultCurrency || undefined,
      defaultDiscountPermille: Math.max(0, Math.min(1000, Math.round((parseFloat(defaultDiscountPercent.replace(",", ".")) || 0) * 10))),
      invoiceEmail: invoiceEmail || undefined,
      invoiceCc: invoiceCc || undefined,
      quoteEmail: quoteEmail || undefined,
      eInvoicePreferred,
      orderReference: orderReference || undefined,
      deliveryTermsText: deliveryTermsText || undefined,
      paymentTermsText: paymentTermsText || undefined,
      language,
    };
    const res = await fetch(`/api/customers/${customerId}/defaults`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? "Speichern fehlgeschlagen.");
      setBusy(false);
      return;
    }
    setBusy(false);
    setSaved(true);
    router.refresh();
  }

  const input = "rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none";

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      {error && <div className="rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800">{error}</div>}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Standard-Währung (ISO 4217)</span>
          <input className={input} value={defaultCurrency} onChange={(e) => setDefaultCurrency(e.target.value.toUpperCase())} placeholder="Systemvorgabe" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Standard-Rabatt (%)</span>
          <input className={input} value={defaultDiscountPercent} onChange={(e) => setDefaultDiscountPercent(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Rechnungs-E-Mail</span>
          <input className={input} value={invoiceEmail} onChange={(e) => setInvoiceEmail(e.target.value)} placeholder="Standard des Kunden" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Rechnungs-CC (bis 5, kommagetrennt)</span>
          <input className={input} value={invoiceCc} onChange={(e) => setInvoiceCc(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Angebots-E-Mail</span>
          <input className={input} value={quoteEmail} onChange={(e) => setQuoteEmail(e.target.value)} placeholder="Standard des Kunden" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Bestellreferenz</span>
          <input className={input} value={orderReference} onChange={(e) => setOrderReference(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Sprache (ISO-639-1)</span>
          <input className={input} value={language} onChange={(e) => setLanguage(e.target.value.toLowerCase())} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={eInvoicePreferred} onChange={(e) => setEInvoicePreferred(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
          <span className="font-medium text-slate-700">E-Rechnung bevorzugt (kann die Org-Vorbelegung nur einschalten)</span>
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">Lieferbedingungen (Angebote)</span>
        <textarea className={input} rows={2} value={deliveryTermsText} onChange={(e) => setDeliveryTermsText(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">Zahlungsbedingungen</span>
        <textarea className={input} rows={2} value={paymentTermsText} onChange={(e) => setPaymentTermsText(e.target.value)} />
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
          {busy ? "Speichern…" : "Vorgaben speichern"}
        </button>
        {saved && <span className="text-xs text-emerald-700">Gespeichert.</span>}
      </div>
    </form>
  );
}
