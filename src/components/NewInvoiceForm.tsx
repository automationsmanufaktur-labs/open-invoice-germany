"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { computeLineNet } from "@/lib/pricing/line";
import { applyDocumentAdjustments, type RateBucket } from "@/lib/pricing/allocate";
import { PricingError } from "@/lib/pricing/errors";

interface CustomerOption {
  id: string;
  name: string;
  defaultPaymentMethodId: string | null;
}
interface ProductOption {
  id: string;
  name: string;
  unit: string;
  netPriceCents: number;
  taxRate: number;
}
interface PaymentMethodOption {
  id: string;
  name: string;
  paymentTermsDays: number | null;
}
interface LineState {
  description: string;
  quantity: string;
  unit: string;
  price: string;
  taxRate: number;
  discountPercent: string;
  discountAmount: string;
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
  return { description: "", quantity: "1", unit: "C62", price: "0", taxRate: 19, discountPercent: "0", discountAmount: "0" };
}

function toCents(s: string): number {
  return Math.round((parseFloat(s.replace(",", ".")) || 0) * 100);
}
function toMilli(s: string): number {
  return Math.round((parseFloat(s.replace(",", ".")) || 0) * 1000);
}
function toPermille(s: string): number {
  return Math.max(0, Math.min(1000, Math.round((parseFloat(s.replace(",", ".")) || 0) * 10)));
}
function toDays(s: string): number | undefined {
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function NewInvoiceForm({
  customers,
  products,
  paymentMethods = [],
}: {
  customers: CustomerOption[];
  products: ProductOption[];
  paymentMethods?: PaymentMethodOption[];
}) {
  const router = useRouter();
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const [scheme, setScheme] = useState("REGULAR");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("Zahlbar innerhalb von 14 Tagen ohne Abzug.");
  const [currency, setCurrency] = useState("EUR");
  const [paymentMethodId, setPaymentMethodId] = useState(customers[0]?.defaultPaymentMethodId ?? "");
  const [lines, setLines] = useState<LineState[]>([emptyLine()]);

  // Belegrabatt/-aufschlag (Phase 4a)
  const [documentDiscountPercent, setDocumentDiscountPercent] = useState("0");
  const [documentDiscountAmount, setDocumentDiscountAmount] = useState("0");
  const [documentChargePercent, setDocumentChargePercent] = useState("0");
  const [documentChargeAmount, setDocumentChargeAmount] = useState("0");
  const [documentChargeReason, setDocumentChargeReason] = useState("");

  // Skonto (bis zu zwei Ziele)
  const [skonto1Percent, setSkonto1Percent] = useState("");
  const [skonto1Days, setSkonto1Days] = useState("");
  const [skonto2Percent, setSkonto2Percent] = useState("");
  const [skonto2Days, setSkonto2Days] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isRegular = scheme === "REGULAR";
  const selectedMethod = paymentMethods.find((m) => m.id === paymentMethodId);

  function selectCustomer(id: string) {
    setCustomerId(id);
    const c = customers.find((x) => x.id === id);
    setPaymentMethodId(c?.defaultPaymentMethodId ?? "");
  }

  function applySuggestedDueDate() {
    if (!selectedMethod?.paymentTermsDays) return;
    const d = new Date();
    d.setDate(d.getDate() + selectedMethod.paymentTermsDays);
    setDueDate(d.toISOString().slice(0, 10));
  }

  function patchLine(i: number, patch: Partial<LineState>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
  function applyProduct(i: number, productId: string) {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    patchLine(i, { description: p.name, unit: p.unit, price: (p.netPriceCents / 100).toFixed(2), taxRate: p.taxRate });
  }

  // Live-Summen über das Rechenmodul (pure, Client-Import erlaubt).
  const totals = useMemo(() => {
    try {
      const lineResults = lines.map((l) =>
        computeLineNet({
          quantityMilli: toMilli(l.quantity),
          unitNetPriceCents: toCents(l.price),
          discountPermille: toPermille(l.discountPercent),
          discountCents: toCents(l.discountAmount),
        }),
      );
      const netBeforeAdjustments = lineResults.reduce((s, r) => s + r.lineNetCents, 0);

      const byRate = new Map<number, number>();
      lines.forEach((l, i) => {
        const rate = isRegular ? l.taxRate : 0;
        byRate.set(rate, (byRate.get(rate) ?? 0) + lineResults[i].lineNetCents);
      });
      const category = SCHEME_CATEGORY[scheme] ?? "S";
      const buckets: RateBucket[] = [...byRate.entries()].map(([taxRate, netCents]) => ({
        key: String(taxRate),
        taxRate,
        taxCategory: category,
        netCents,
      }));

      const adjusted = applyDocumentAdjustments(buckets, {
        discountPermille: toPermille(documentDiscountPercent),
        discountCents: toCents(documentDiscountAmount),
        chargePermille: toPermille(documentChargePercent),
        chargeCents: toCents(documentChargeAmount),
      });

      const netTotalCents = adjusted.reduce((s, b) => s + b.adjustedNetCents, 0);
      const taxTotalCents = adjusted.reduce((s, b) => s + Math.round((b.adjustedNetCents * b.taxRate) / 100), 0);
      const discountTotalCents = adjusted.reduce((s, b) => s + b.allowanceCents, 0);
      const chargeTotalCents = adjusted.reduce((s, b) => s + b.chargeCents, 0);

      return {
        netBeforeAdjustments,
        netTotalCents,
        taxTotalCents,
        grossTotalCents: netTotalCents + taxTotalCents,
        discountTotalCents,
        chargeTotalCents,
        error: null as string | null,
      };
    } catch (e) {
      return {
        netBeforeAdjustments: 0,
        netTotalCents: 0,
        taxTotalCents: 0,
        grossTotalCents: 0,
        discountTotalCents: 0,
        chargeTotalCents: 0,
        error: e instanceof PricingError ? e.message : "Berechnung fehlgeschlagen.",
      };
    }
  }, [lines, isRegular, scheme, documentDiscountPercent, documentDiscountAmount, documentChargePercent, documentChargeAmount]);

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
      documentDiscountPermille: toPermille(documentDiscountPercent),
      documentDiscountCents: toCents(documentDiscountAmount),
      documentChargePermille: toPermille(documentChargePercent),
      documentChargeCents: toCents(documentChargeAmount),
      documentChargeReason: documentChargeReason || undefined,
      skonto1Permille: skonto1Percent ? toPermille(skonto1Percent) : undefined,
      skonto1Days: toDays(skonto1Days),
      skonto2Permille: skonto2Percent ? toPermille(skonto2Percent) : undefined,
      skonto2Days: toDays(skonto2Days),
      paymentMethodId: paymentMethodId || undefined,
      lines: lines.map((l) => ({
        description: l.description,
        quantityMilli: toMilli(l.quantity),
        unit: l.unit,
        unitNetPriceCents: toCents(l.price),
        taxRate: isRegular ? l.taxRate : 0,
        taxCategory: SCHEME_CATEGORY[scheme] ?? "S",
        discountPermille: toPermille(l.discountPercent),
        discountCents: toCents(l.discountAmount),
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
  const small = "rounded-md border border-slate-300 px-2 py-1.5 text-xs focus:border-indigo-500 focus:outline-none";

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
          <div className="flex gap-2">
            <input type="date" className={`${input} flex-1`} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            {selectedMethod?.paymentTermsDays != null && (
              <button type="button" onClick={applySuggestedDueDate} className="whitespace-nowrap text-xs font-medium text-indigo-600 hover:underline">
                +{selectedMethod.paymentTermsDays} Tage übernehmen
              </button>
            )}
          </div>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Zahlungsmethode</span>
          <select className={input} value={paymentMethodId} onChange={(e) => setPaymentMethodId(e.target.value)}>
            <option value="">— keine —</option>
            {paymentMethods.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
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
            <input className={`${input} col-span-3 sm:col-span-1`} placeholder="Menge" value={line.quantity} onChange={(e) => patchLine(i, { quantity: e.target.value })} />
            <input className={`${input} col-span-3 sm:col-span-1`} placeholder="Einh." value={line.unit} onChange={(e) => patchLine(i, { unit: e.target.value })} />
            <input className={`${input} col-span-6 sm:col-span-2`} placeholder="Preis netto €" value={line.price} onChange={(e) => patchLine(i, { price: e.target.value })} />
            <select className={`${input} col-span-6 sm:col-span-1`} value={isRegular ? line.taxRate : 0} onChange={(e) => patchLine(i, { taxRate: Number(e.target.value) })} disabled={!isRegular}>
              <option value={19}>19%</option>
              <option value={7}>7%</option>
              <option value={0}>0%</option>
            </select>
            <input
              className={`${small} col-span-6 sm:col-span-1`}
              placeholder="Rabatt %"
              title="Rabatt in Prozent"
              value={line.discountPercent}
              onChange={(e) => patchLine(i, { discountPercent: e.target.value })}
            />
            <input
              className={`${small} col-span-6 sm:col-span-1`}
              placeholder="Rabatt €"
              title="Rabatt als Festbetrag in €"
              value={line.discountAmount}
              onChange={(e) => patchLine(i, { discountAmount: e.target.value })}
            />
            <button type="button" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))} className="col-span-12 text-sm text-rose-500 hover:underline sm:col-span-1" disabled={lines.length === 1}>
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <h2 className="col-span-full font-semibold text-slate-900">Beleg-Rabatt / -Aufschlag</h2>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Rabatt %</span>
          <input className={input} value={documentDiscountPercent} onChange={(e) => setDocumentDiscountPercent(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Rabatt € (zusätzlich)</span>
          <input className={input} value={documentDiscountAmount} onChange={(e) => setDocumentDiscountAmount(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Aufschlag %</span>
          <input className={input} value={documentChargePercent} onChange={(e) => setDocumentChargePercent(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Aufschlag € (zusätzlich)</span>
          <input className={input} value={documentChargeAmount} onChange={(e) => setDocumentChargeAmount(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="font-medium text-slate-700">Grund für Aufschlag/Rabatt (optional)</span>
          <input className={input} value={documentChargeReason} onChange={(e) => setDocumentChargeReason(e.target.value)} placeholder="z. B. Expresszuschlag" />
        </label>
      </div>

      <div className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
        <h2 className="col-span-full font-semibold text-slate-900">Skonto</h2>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Skonto 1 — Prozent</span>
          <input className={input} value={skonto1Percent} onChange={(e) => setSkonto1Percent(e.target.value)} placeholder="z. B. 2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Skonto 1 — Tage</span>
          <input className={input} value={skonto1Days} onChange={(e) => setSkonto1Days(e.target.value)} placeholder="z. B. 7" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Skonto 2 — Prozent (optional)</span>
          <input className={input} value={skonto2Percent} onChange={(e) => setSkonto2Percent(e.target.value)} placeholder="z. B. 1" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Skonto 2 — Tage (optional, länger als Skonto 1)</span>
          <input className={input} value={skonto2Days} onChange={(e) => setSkonto2Days(e.target.value)} placeholder="z. B. 14" />
        </label>
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

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 pt-4">
        <div className="space-y-0.5 text-sm text-slate-600">
          {totals.error ? (
            <span className="text-rose-600">{totals.error}</span>
          ) : (
            <>
              {(totals.discountTotalCents > 0 || totals.chargeTotalCents > 0) && (
                <div>
                  Netto vor Beleganpassung: <span className="tabular">{(totals.netBeforeAdjustments / 100).toFixed(2)} {currency}</span>
                  {totals.discountTotalCents > 0 && <span> · Rabatt −{(totals.discountTotalCents / 100).toFixed(2)} {currency}</span>}
                  {totals.chargeTotalCents > 0 && <span> · Aufschlag +{(totals.chargeTotalCents / 100).toFixed(2)} {currency}</span>}
                </div>
              )}
              <div>
                Netto: <span className="tabular font-medium text-slate-800">{(totals.netTotalCents / 100).toFixed(2)} {currency}</span> · USt:{" "}
                <span className="tabular font-medium text-slate-800">{(totals.taxTotalCents / 100).toFixed(2)} {currency}</span> · Brutto:{" "}
                <span className="tabular font-semibold text-slate-900">{(totals.grossTotalCents / 100).toFixed(2)} {currency}</span>
              </div>
            </>
          )}
        </div>
        <button type="submit" disabled={busy} className="rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
          {busy ? "Speichern…" : "Als Entwurf anlegen"}
        </button>
      </div>
    </form>
  );
}
