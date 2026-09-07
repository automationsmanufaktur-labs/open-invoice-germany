"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { computeLineNet } from "@/lib/pricing/line";
import { applyDocumentAdjustments, type RateBucket } from "@/lib/pricing/allocate";
import { PricingError } from "@/lib/pricing/errors";

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
}
interface AddressOption {
  id: string;
  customerId: string;
  label: string;
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

export interface DocumentInitial {
  id: string;
  kind: string;
  customerId: string;
  taxScheme: string;
  currency: string;
  subject: string;
  customerReference: string;
  contactPersonId: string;
  billingAddressId: string;
  validUntil: string;
  headerText: string;
  footerText: string;
  deliveryTerms: string;
  paymentTerms: string;
  notes: string;
  internalNotes: string;
  documentDiscountPercent: string;
  documentDiscountAmount: string;
  documentChargePercent: string;
  documentChargeAmount: string;
  documentChargeReason: string;
  lines: LineState[];
}

const SCHEME_NOTICE_DOC: Record<string, string> = {
  KLEINUNTERNEHMER: "Kleinunternehmer gemäß § 19 UStG, kein Ausweis von Umsatzsteuer",
  REVERSE_CHARGE: "Steuerschuldnerschaft des Leistungsempfängers",
  DIFFERENZ: "Gebrauchtgegenstände/Sonderregelung (§ 25a UStG)",
  DRITTLAND_LEISTUNG: "Leistungsort im Drittland (§ 3a Abs. 2 UStG) — nicht im Inland steuerbar",
};

const SCHEME_CATEGORY_DOC: Record<string, string> = {
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

export function NewDocumentForm({
  customers,
  products,
  contacts = [],
  addresses = [],
  initial,
}: {
  customers: CustomerOption[];
  products: ProductOption[];
  contacts?: ContactOption[];
  addresses?: AddressOption[];
  initial?: DocumentInitial;
}) {
  const router = useRouter();
  const isEdit = Boolean(initial);
  const [kind, setKind] = useState(initial?.kind ?? "ANGEBOT");
  const [customerId, setCustomerId] = useState(initial?.customerId ?? customers[0]?.id ?? "");
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [customerReference, setCustomerReference] = useState(initial?.customerReference ?? "");
  const [contactPersonId, setContactPersonId] = useState(initial?.contactPersonId ?? "");
  const [billingAddressId, setBillingAddressId] = useState(initial?.billingAddressId ?? "");
  const [validUntil, setValidUntil] = useState(initial?.validUntil ?? "");
  const [headerText, setHeaderText] = useState(initial?.headerText ?? "");
  const [footerText, setFooterText] = useState(initial?.footerText ?? "");
  const [deliveryTerms, setDeliveryTerms] = useState(initial?.deliveryTerms ?? "");
  const [paymentTerms, setPaymentTerms] = useState(initial?.paymentTerms ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [internalNotes, setInternalNotes] = useState(initial?.internalNotes ?? "");
  const [scheme, setScheme] = useState(initial?.taxScheme ?? "REGULAR");
  const [currency, setCurrency] = useState(initial?.currency ?? "EUR");
  const [lines, setLines] = useState<LineState[]>(initial?.lines?.length ? initial.lines : [emptyLine()]);
  const [documentDiscountPercent, setDocumentDiscountPercent] = useState(initial?.documentDiscountPercent ?? "0");
  const [documentDiscountAmount, setDocumentDiscountAmount] = useState(initial?.documentDiscountAmount ?? "0");
  const [documentChargePercent, setDocumentChargePercent] = useState(initial?.documentChargePercent ?? "0");
  const [documentChargeAmount, setDocumentChargeAmount] = useState(initial?.documentChargeAmount ?? "0");
  const [documentChargeReason, setDocumentChargeReason] = useState(initial?.documentChargeReason ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isRegular = scheme === "REGULAR";

  // Kopf-/Fusstext/Bedingungen bei Neuanlage vorbelegen, sobald sich die Art aendert —
  // nur solange der Nutzer noch nichts eingetragen hat und wir nicht bearbeiten.
  useEffect(() => {
    if (isEdit) return;
    async function loadDefault(position: "HEAD" | "FOOT" | "TERMS_DELIVERY" | "TERMS_PAYMENT", set: (v: string) => void, current: string) {
      if (current.trim() !== "") return;
      const res = await fetch(`/api/text-templates/pick?docType=${kind}&position=${position}`);
      if (!res.ok) return;
      const j = (await res.json()) as { body: string | null };
      if (j.body) set(j.body);
    }
    void loadDefault("HEAD", setHeaderText, headerText);
    void loadDefault("FOOT", setFooterText, footerText);
    void loadDefault("TERMS_DELIVERY", setDeliveryTerms, deliveryTerms);
    void loadDefault("TERMS_PAYMENT", setPaymentTerms, paymentTerms);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, isEdit]);

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

      const effCategory = SCHEME_CATEGORY_DOC[scheme] ?? "S";
      const byRate = new Map<number, number>();
      lines.forEach((l, i) => {
        const rate = isRegular ? l.taxRate : 0;
        byRate.set(rate, (byRate.get(rate) ?? 0) + lineResults[i].lineNetCents);
      });
      const buckets: RateBucket[] = [...byRate.entries()].map(([taxRate, netCents]) => ({
        key: String(taxRate),
        taxRate,
        taxCategory: effCategory,
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
  }, [lines, scheme, isRegular, documentDiscountPercent, documentDiscountAmount, documentChargePercent, documentChargeAmount]);

  const customerContacts = contacts.filter((c) => c.customerId === customerId);
  const customerAddresses = addresses.filter((a) => a.customerId === customerId);

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
    const linesBody = lines.map((l) => ({
      description: l.description,
      quantityMilli: toMilli(l.quantity),
      unit: l.unit,
      unitNetPriceCents: toCents(l.price),
      taxRate: isRegular ? l.taxRate : 0,
      taxCategory: SCHEME_CATEGORY_DOC[scheme] ?? "S",
      discountPermille: toPermille(l.discountPercent),
      discountCents: toCents(l.discountAmount),
    }));
    const notice = SCHEME_NOTICE_DOC[scheme];
    const finalNotes = notice ? `${notice}${notes ? " — " + notes : ""}` : notes || undefined;
    const shared = {
      customerId,
      taxScheme: scheme,
      currency: currency,
      subject: subject || undefined,
      customerReference: customerReference || undefined,
      contactPersonId: contactPersonId || undefined,
      billingAddressId: billingAddressId || undefined,
      validUntil: validUntil || undefined,
      headerText: headerText || undefined,
      footerText: footerText || undefined,
      deliveryTerms: deliveryTerms || undefined,
      paymentTerms: paymentTerms || undefined,
      documentDiscountPermille: toPermille(documentDiscountPercent),
      documentDiscountCents: toCents(documentDiscountAmount),
      documentChargePermille: toPermille(documentChargePercent),
      documentChargeCents: toCents(documentChargeAmount),
      documentChargeReason: documentChargeReason || undefined,
      notes: finalNotes,
      internalNotes: internalNotes || undefined,
      lines: linesBody,
    };

    const res = isEdit
      ? await fetch(`/api/documents/${initial!.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(shared),
        })
      : await fetch("/api/documents", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind, ...shared }),
        });

    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? "Speichern fehlgeschlagen.");
      setBusy(false);
      return;
    }
    const j = (await res.json()) as { id: string };
    router.push(`/dokumente/${isEdit ? initial!.id : j.id}`);
    router.refresh();
  }

  const input = "rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none";

  return (
    <form onSubmit={submit} className="space-y-6">
      {error && <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Art</span>
          <select className={input} value={kind} onChange={(e) => setKind(e.target.value)} disabled={isEdit}>
            <option value="ANGEBOT">Angebot</option>
            <option value="AUFTRAGSBESTAETIGUNG">Auftragsbestätigung</option>
            <option value="PROFORMA">Proforma-Rechnung</option>
          </select>
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
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Gültig bis (optional)</span>
          <input type="date" className={input} value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Betreff</span>
          <input className={input} value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Kundenreferenz / Bestellnummer</span>
          <input className={input} value={customerReference} onChange={(e) => setCustomerReference(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Ansprechpartner</span>
          <select className={input} value={contactPersonId} onChange={(e) => setContactPersonId(e.target.value)}>
            <option value="">— keiner —</option>
            {customerContacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Rechnungsadresse</span>
          <select className={input} value={billingAddressId} onChange={(e) => setBillingAddressId(e.target.value)}>
            <option value="">— Standardadresse —</option>
            {customerAddresses.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
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
            <input className={`${input} col-span-3 sm:col-span-1`} placeholder="Menge" value={line.quantity} onChange={(e) => patchLine(i, { quantity: e.target.value })} />
            <input className={`${input} col-span-3 sm:col-span-1`} placeholder="Einh." value={line.unit} onChange={(e) => patchLine(i, { unit: e.target.value })} />
            <input className={`${input} col-span-6 sm:col-span-2`} placeholder="Preis netto €" value={line.price} onChange={(e) => patchLine(i, { price: e.target.value })} />
            <select className={`${input} col-span-6 sm:col-span-1`} value={isRegular ? line.taxRate : 0} onChange={(e) => patchLine(i, { taxRate: Number(e.target.value) })} disabled={!isRegular}>
              <option value={19}>19%</option>
              <option value={7}>7%</option>
              <option value={0}>0%</option>
            </select>
            <input
              className={`${input} col-span-6 sm:col-span-1`}
              placeholder="Rabatt %"
              title="Rabatt in Prozent"
              value={line.discountPercent}
              onChange={(e) => patchLine(i, { discountPercent: e.target.value })}
            />
            <input
              className={`${input} col-span-6 sm:col-span-1`}
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

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Kopftext</span>
          <textarea className={input} rows={3} value={headerText} onChange={(e) => setHeaderText(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Fußtext</span>
          <textarea className={input} rows={3} value={footerText} onChange={(e) => setFooterText(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Lieferbedingungen</span>
          <textarea className={input} rows={2} value={deliveryTerms} onChange={(e) => setDeliveryTerms(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Zahlungsbedingungen</span>
          <textarea className={input} rows={2} value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">Hinweis / Notiz</span>
        <textarea className={input} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        {SCHEME_NOTICE_DOC[scheme] && <span className="text-xs text-slate-500">Pflichthinweis „{SCHEME_NOTICE_DOC[scheme]}“ wird automatisch ergänzt.</span>}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">
          Interne Notiz
          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-800">nur intern sichtbar</span>
        </span>
        <textarea className={input} rows={2} value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} />
      </label>

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 pt-4">
        <div className="text-sm text-slate-500">
          {totals.error ? (
            <span className="text-rose-600">{totals.error}</span>
          ) : (
            <>
              {(totals.discountTotalCents > 0 || totals.chargeTotalCents > 0) && (
                <span>
                  Netto vor Beleganpassung: <span className="tabular">{(totals.netBeforeAdjustments / 100).toFixed(2)} {currency}</span>
                  {totals.discountTotalCents > 0 && <span> · Rabatt −{(totals.discountTotalCents / 100).toFixed(2)} {currency}</span>}
                  {totals.chargeTotalCents > 0 && <span> · Aufschlag +{(totals.chargeTotalCents / 100).toFixed(2)} {currency}</span>}
                  {" · "}
                </span>
              )}
              Netto: <span className="tabular font-medium text-slate-800">{(totals.netTotalCents / 100).toFixed(2)} {currency}</span> · USt:{" "}
              <span className="tabular font-medium text-slate-800">{(totals.taxTotalCents / 100).toFixed(2)} {currency}</span> · Brutto:{" "}
              <span className="tabular font-semibold text-slate-900">{(totals.grossTotalCents / 100).toFixed(2)} {currency}</span>
            </>
          )}
        </div>
        <button type="submit" disabled={busy} className="rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
          {busy ? "Speichern…" : isEdit ? "Änderungen speichern" : "Dokument anlegen"}
        </button>
      </div>
    </form>
  );
}
