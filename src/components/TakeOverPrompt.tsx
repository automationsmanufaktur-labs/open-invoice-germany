"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export interface TakeOverLineDTO {
  lineType: "ITEM" | "HEADING" | "TEXT" | "SUBTOTAL";
  productId?: string;
  description: string;
  descriptionLong?: string;
  articleNumber?: string;
  quantityMilli: number;
  unit: string;
  unitNetPriceCents: number;
  taxRate: number;
  taxCategory: string;
  discountPermille: number;
  discountCents: number;
}

export interface TakeOverPrefillDTO {
  lines?: TakeOverLineDTO[];
  headerText?: string | null;
  footerText?: string | null;
  paymentTerms?: string | null;
  deliveryTerms?: string | null;
  documentDiscount?: { permille: number; cents: number };
}

interface LastDocumentDTO {
  id: string;
  number: string;
  issueDate: string;
  kind: "INVOICE" | "QUOTE" | "ORDER_CONFIRMATION";
}

const KIND_LABEL: Record<LastDocumentDTO["kind"], string> = { INVOICE: "Rechnung", QUOTE: "Angebot", ORDER_CONFIRMATION: "Auftragsbestätigung" };

/**
 * "Letztes Dokument übernehmen" (§32, Task 3) — erscheint einmal je Kundenwahl, sofern
 * DocumentSettings.offerLastDocument aktiv ist (Gate liegt beim Aufrufer: `enabled`).
 * Preise sind nur zusammen mit Positionen wählbar (Facts). Reiner Prefill — legt selbst
 * nichts an; "Dokument duplizieren" verlinkt auf die bestehende Duplizierfunktion der
 * Beleg-Detailseite.
 */
export function TakeOverPrompt({
  enabled,
  customerId,
  kind,
  documentDetailBasePath,
  onApply,
}: {
  enabled: boolean;
  customerId: string;
  kind: LastDocumentDTO["kind"];
  documentDetailBasePath: string;
  onApply: (prefill: TakeOverPrefillDTO) => void;
}) {
  // Ein Slot pro Kundenwahl: "fuer welchen Kunden wurde bereits geprueft/angezeigt" +
  // gefundener Beleg + dismissed-Flag in EINEM State-Update (vermeidet mehrere
  // setState-Aufrufe direkt im Effekt-Body).
  const [state, setState] = useState<{ customerId: string; last: LastDocumentDTO | null; dismissed: boolean } | null>(null);
  const [lines, setLines] = useState(true);
  const [texts, setTexts] = useState(true);
  const [terms, setTerms] = useState(true);
  const [prices, setPrices] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!enabled || !customerId || state?.customerId === customerId) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/customers/${customerId}/last-document?kind=${kind}`);
      if (cancelled || !res.ok) return;
      const j = (await res.json()) as { document: LastDocumentDTO | null };
      setState({ customerId, last: j.document, dismissed: false });
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, customerId, kind, state?.customerId]);

  const last = state?.customerId === customerId ? state.last : null;
  if (!enabled || !last || state?.dismissed) return null;

  async function apply() {
    if (!last) return;
    setBusy(true);
    const res = await fetch(`/api/documents/${last.id}/take-over-prefill`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lines, texts, terms, prices: prices && lines }),
    });
    setBusy(false);
    if (!res.ok) return;
    const j = (await res.json()) as { prefill: TakeOverPrefillDTO };
    onApply(j.prefill);
    setState((s) => (s ? { ...s, dismissed: true } : s));
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm">
      <span className="text-indigo-900">
        Letzte {KIND_LABEL[last.kind]} <strong>{last.number}</strong> dieses Kunden als Vorlage übernehmen?
      </span>
      <div className="flex flex-wrap items-center gap-3 text-xs text-indigo-800">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={lines} onChange={(e) => setLines(e.target.checked)} className="h-3.5 w-3.5" />
          Positionen
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={texts} onChange={(e) => setTexts(e.target.checked)} className="h-3.5 w-3.5" />
          Texte
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="h-3.5 w-3.5" />
          Bedingungen
        </label>
        <label className={`flex items-center gap-1 ${lines ? "" : "opacity-40"}`} title={lines ? "" : "Preise nur zusammen mit Positionen"}>
          <input type="checkbox" checked={prices} disabled={!lines} onChange={(e) => setPrices(e.target.checked)} className="h-3.5 w-3.5" />
          Preise
        </label>
      </div>
      <button
        type="button"
        onClick={apply}
        disabled={busy}
        className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {busy ? "…" : "Übernehmen"}
      </button>
      <Link href={`${documentDetailBasePath}/${last.id}`} className="text-xs font-medium text-indigo-700 hover:underline">
        Dokument duplizieren
      </Link>
      <button type="button" onClick={() => setState((s) => (s ? { ...s, dismissed: true } : s))} className="ml-auto text-xs text-indigo-500 hover:underline">
        Nicht jetzt
      </button>
    </div>
  );
}
