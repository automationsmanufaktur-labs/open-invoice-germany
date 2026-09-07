"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatQuantity } from "@/lib/money";

interface RemainingLine {
  sourceLineId: string;
  description: string;
  unit: string;
  orderedMilli: number;
  deliveredMilli: number;
  remainingMilli: number;
}

interface BilledLine {
  sourceLineId: string;
  description: string;
  unit: string;
  orderedMilli: number;
  billedMilli: number;
  remainingMilli: number;
}

type PartialMode = "PERCENT" | "NET_AMOUNT" | "GROSS_AMOUNT" | "POSITIONS" | "QUANTITIES";
type DownpaymentMode = "PERCENT" | "AMOUNT";

const btnCls = "rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60";
const btnOutlineCls = "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60";

function parseEuroToCents(v: string): number {
  const n = parseFloat(v.replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
function parsePercentToPermille(v: string): number {
  const n = parseFloat(v.replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 10) : 0;
}

/**
 * "Erzeugen"-Aktionen fuer ein Dokument (Angebot/AB) oder eine Rechnung: Auftrags-
 * bestaetigung, Rechnung, Lieferschein (mit Mengen-Dialog gegen die Restmengen), sowie
 * (Task 4, Phase 5) Teilrechnung/Abschlagsrechnung/Schlussrechnung auf einem Angebot.
 * Nur die zutreffenden Optionen werden ueber die `show*`-Props eingeblendet — die
 * eigentliche Pruefung (Status/100-%-Grenze/Mischverbot) bleibt serverseitig (409 bei
 * Regelverstoss).
 */
export function ConvertMenu({
  sourceType,
  sourceId,
  showToOrderConfirmation,
  showToInvoice,
  showToDeliveryNote = true,
  showPartialInvoice,
  allowShareModesInPartialInvoice = true,
  showDownpaymentInvoice,
  showFinalInvoice,
}: {
  // B11 (Fix-Welle): "DELIVERY_NOTE" ergaenzt fuer den Teilrechnung-Einstieg auf der
  // Lieferschein-Detailseite — dort sind ausschliesslich showPartialInvoice und
  // allowShareModesInPartialInvoice relevant, alle anderen show*-Props bleiben false.
  sourceType: "QUOTE" | "INVOICE" | "DELIVERY_NOTE";
  sourceId: string;
  showToOrderConfirmation?: boolean;
  showToInvoice?: boolean;
  showToDeliveryNote?: boolean;
  /** Task 4 (sourceType QUOTE/DELIVERY_NOTE): Teilrechnung erzeugen. */
  showPartialInvoice?: boolean;
  /** B11 (Fix-Welle, nur sourceType DELIVERY_NOTE relevant): Anteils-Modi (PERCENT/
   *  NET_AMOUNT/GROSS_AMOUNT) nur anbieten, wenn ALLE Positionen des Lieferscheins einen
   *  Preis tragen (sonst kann keine Gesamtleistung berechnet werden, siehe B12/
   *  assertAllLinesPriced) — Default true (QUOTE hat immer Preise). */
  allowShareModesInPartialInvoice?: boolean;
  /** Task 4 (nur sourceType QUOTE): Abschlagsrechnung erzeugen. */
  showDownpaymentInvoice?: boolean;
  /** Task 4 (nur sourceType QUOTE): Schlussrechnung erzeugen (nur wenn Abschlaege
   *  festgeschrieben sind — die Bedingung prueft der Aufrufer, siehe Dokumentseite). */
  showFinalInvoice?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const [remaining, setRemaining] = useState<RemainingLine[] | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [deliveryDate, setDeliveryDate] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);

  // Task 4: Teilrechnung
  const partialDialogRef = useRef<HTMLDialogElement>(null);
  const [billed, setBilled] = useState<BilledLine[] | null>(null);
  const [partialMode, setPartialMode] = useState<PartialMode>("PERCENT");
  const [partialPercent, setPartialPercent] = useState("");
  const [partialAmount, setPartialAmount] = useState("");
  const [partialSelectedLines, setPartialSelectedLines] = useState<Record<string, boolean>>({});
  const [partialQuantities, setPartialQuantities] = useState<Record<string, string>>({});
  const [partialError, setPartialError] = useState<string | null>(null);
  const [partialBusy, setPartialBusy] = useState(false);

  // Task 4: Abschlagsrechnung
  const downpaymentDialogRef = useRef<HTMLDialogElement>(null);
  const [downpaymentMode, setDownpaymentMode] = useState<DownpaymentMode>("PERCENT");
  const [downpaymentPercent, setDownpaymentPercent] = useState("");
  const [downpaymentAmount, setDownpaymentAmount] = useState("");
  const [downpaymentAmountIsGross, setDownpaymentAmountIsGross] = useState(false);
  const [downpaymentError, setDownpaymentError] = useState<string | null>(null);
  const [downpaymentBusy, setDownpaymentBusy] = useState(false);

  const convertRoute = `/api/documents/${sourceId}/convert`;
  // B11 (Fix-Welle): Teilrechnung-Routen je nach Quelltyp — QUOTE nutzt
  // /api/documents/..., DELIVERY_NOTE die eigene, gleich benannte Ressource.
  const partialBillingRoute = sourceType === "DELIVERY_NOTE" ? `/api/delivery-notes/${sourceId}/billing` : `/api/documents/${sourceId}/billing`;
  const partialInvoiceRoute = sourceType === "DELIVERY_NOTE" ? `/api/delivery-notes/${sourceId}/partial-invoice` : `/api/documents/${sourceId}/partial-invoice`;

  async function convertTo(toKind: "AUFTRAGSBESTAETIGUNG" | "INVOICE") {
    setBusy(toKind);
    setError(null);
    const res = await fetch(convertRoute, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toKind }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? "Umwandeln fehlgeschlagen.");
      setBusy(null);
      return;
    }
    const j = (await res.json()) as { type: string; id: string };
    setBusy(null);
    router.push(j.type === "INVOICE" ? `/rechnungen/${j.id}` : `/dokumente/${j.id}`);
    router.refresh();
  }

  async function openDeliveryNoteDialog() {
    setError(null);
    dialogRef.current?.showModal();
    setDialogError(null);
    const remainingRoute = sourceType === "QUOTE" ? `/api/documents/${sourceId}/remaining` : `/api/invoices/${sourceId}/remaining`;
    const res = await fetch(remainingRoute);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setDialogError(j.error ?? "Restmengen konnten nicht geladen werden.");
      return;
    }
    const lines = (await res.json()) as RemainingLine[];
    setRemaining(lines);
    const initial: Record<string, string> = {};
    for (const l of lines) initial[l.sourceLineId] = (l.remainingMilli / 1000).toFixed(3);
    setQuantities(initial);
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  async function submitDeliveryNote() {
    if (!remaining) return;
    setDialogBusy(true);
    setDialogError(null);
    const parsed = remaining
      .map((l) => ({ sourceLineId: l.sourceLineId, quantityMilli: Math.round((parseFloat((quantities[l.sourceLineId] ?? "0").replace(",", ".")) || 0) * 1000) }))
      .filter((q) => q.quantityMilli > 0);
    if (parsed.length === 0) {
      setDialogError("Bitte mindestens eine Menge angeben.");
      setDialogBusy(false);
      return;
    }
    const route = sourceType === "QUOTE" ? `/api/documents/${sourceId}/convert` : `/api/invoices/${sourceId}/delivery-note`;
    const body: Record<string, unknown> =
      sourceType === "QUOTE" ? { toKind: "DELIVERY_NOTE", quantities: parsed, deliveryDate: deliveryDate || undefined } : { quantities: parsed, deliveryDate: deliveryDate || undefined };
    const res = await fetch(route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setDialogError(j.error ?? "Lieferschein konnte nicht erzeugt werden.");
      setDialogBusy(false);
      return;
    }
    const j = (await res.json()) as { id: string };
    setDialogBusy(false);
    closeDialog();
    router.push(`/lieferscheine/${j.id}`);
    router.refresh();
  }

  // ── Teilrechnung ────────────────────────────────────────────────────────────
  async function openPartialDialog() {
    setError(null);
    partialDialogRef.current?.showModal();
    setPartialError(null);
    setPartialMode(allowShareModesInPartialInvoice ? "PERCENT" : "POSITIONS");
    setPartialPercent("");
    setPartialAmount("");
    const res = await fetch(partialBillingRoute);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setPartialError(j.error ?? "Abrechnungsstand konnte nicht geladen werden.");
      return;
    }
    const j = (await res.json()) as { lines: BilledLine[] };
    setBilled(j.lines);
    const initialSelected: Record<string, boolean> = {};
    const initialQty: Record<string, string> = {};
    for (const l of j.lines) {
      initialSelected[l.sourceLineId] = false;
      initialQty[l.sourceLineId] = (l.remainingMilli / 1000).toFixed(3);
    }
    setPartialSelectedLines(initialSelected);
    setPartialQuantities(initialQty);
  }
  function closePartialDialog() {
    partialDialogRef.current?.close();
  }

  async function submitPartialInvoice() {
    setPartialBusy(true);
    setPartialError(null);
    let body: Record<string, unknown>;
    if (partialMode === "PERCENT") {
      body = { mode: "PERCENT", permille: parsePercentToPermille(partialPercent) };
    } else if (partialMode === "NET_AMOUNT" || partialMode === "GROSS_AMOUNT") {
      body = { mode: partialMode, amountCents: parseEuroToCents(partialAmount) };
    } else if (partialMode === "POSITIONS") {
      body = { mode: "POSITIONS", lineIds: Object.entries(partialSelectedLines).filter(([, v]) => v).map(([k]) => k) };
    } else {
      body = {
        mode: "QUANTITIES",
        quantities: (billed ?? [])
          .map((l) => ({ sourceLineId: l.sourceLineId, quantityMilli: Math.round((parseFloat((partialQuantities[l.sourceLineId] ?? "0").replace(",", ".")) || 0) * 1000) }))
          .filter((q) => q.quantityMilli > 0),
      };
    }
    const res = await fetch(partialInvoiceRoute, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setPartialError(j.error ?? "Teilrechnung konnte nicht erzeugt werden.");
      setPartialBusy(false);
      return;
    }
    const j = (await res.json()) as { id: string };
    setPartialBusy(false);
    closePartialDialog();
    router.push(`/rechnungen/${j.id}`);
    router.refresh();
  }

  // ── Abschlagsrechnung ───────────────────────────────────────────────────────
  function openDownpaymentDialog() {
    setError(null);
    setDownpaymentError(null);
    setDownpaymentMode("PERCENT");
    setDownpaymentPercent("");
    setDownpaymentAmount("");
    setDownpaymentAmountIsGross(false);
    downpaymentDialogRef.current?.showModal();
  }
  function closeDownpaymentDialog() {
    downpaymentDialogRef.current?.close();
  }

  async function submitDownpaymentInvoice() {
    setDownpaymentBusy(true);
    setDownpaymentError(null);
    const body: Record<string, unknown> =
      downpaymentMode === "PERCENT"
        ? { mode: "PERCENT", permille: parsePercentToPermille(downpaymentPercent) }
        : { mode: "AMOUNT", amountCents: parseEuroToCents(downpaymentAmount), amountIsGross: downpaymentAmountIsGross };
    const res = await fetch(`/api/documents/${sourceId}/downpayment-invoice`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setDownpaymentError(j.error ?? "Abschlagsrechnung konnte nicht erzeugt werden.");
      setDownpaymentBusy(false);
      return;
    }
    const j = (await res.json()) as { id: string };
    setDownpaymentBusy(false);
    closeDownpaymentDialog();
    router.push(`/rechnungen/${j.id}`);
    router.refresh();
  }

  // ── Schlussrechnung (kein Dialog — keine Eingabefelder noetig) ──────────────
  async function createFinalInvoice() {
    setBusy("FINAL_INVOICE");
    setError(null);
    const res = await fetch(`/api/documents/${sourceId}/final-invoice`, { method: "POST" });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? "Schlussrechnung konnte nicht erzeugt werden.");
      setBusy(null);
      return;
    }
    const j = (await res.json()) as { id: string };
    setBusy(null);
    router.push(`/rechnungen/${j.id}`);
    router.refresh();
  }

  const selectableLinesForPositions = (billed ?? []).filter((l) => l.billedMilli === 0);

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className="flex flex-wrap items-center gap-2">
        {showToOrderConfirmation && (
          <button type="button" onClick={() => convertTo("AUFTRAGSBESTAETIGUNG")} disabled={busy !== null} className={btnOutlineCls}>
            {busy === "AUFTRAGSBESTAETIGUNG" ? "…" : "AB erzeugen"}
          </button>
        )}
        {showToInvoice && (
          <button type="button" onClick={() => convertTo("INVOICE")} disabled={busy !== null} className={btnCls}>
            {busy === "INVOICE" ? "…" : "Rechnung erzeugen"}
          </button>
        )}
        {showToDeliveryNote && (
          <button type="button" onClick={openDeliveryNoteDialog} disabled={busy !== null} className={btnOutlineCls}>
            Lieferschein erzeugen
          </button>
        )}
        {showPartialInvoice && (
          <button type="button" onClick={openPartialDialog} disabled={busy !== null} className={btnOutlineCls}>
            Teilrechnung…
          </button>
        )}
        {showDownpaymentInvoice && (
          <button type="button" onClick={openDownpaymentDialog} disabled={busy !== null} className={btnOutlineCls}>
            Abschlagsrechnung…
          </button>
        )}
        {showFinalInvoice && (
          <button type="button" onClick={createFinalInvoice} disabled={busy !== null} className={btnCls}>
            {busy === "FINAL_INVOICE" ? "…" : "Schlussrechnung erzeugen"}
          </button>
        )}
      </span>
      {error && <span className="text-xs text-rose-600">{error}</span>}

      <dialog ref={dialogRef} className="w-full max-w-2xl rounded-lg border border-slate-200 p-0 backdrop:bg-slate-900/40">
        <div className="max-h-[85vh] overflow-y-auto p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Lieferschein erzeugen</h2>
            <button type="button" onClick={closeDialog} className="text-slate-400 hover:text-slate-700">
              ✕
            </button>
          </div>

          {dialogError && <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{dialogError}</div>}

          {!remaining ? (
            <p className="text-sm text-slate-500">Lade Restmengen…</p>
          ) : (
            <div className="space-y-4">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-slate-700">Lieferdatum (optional)</span>
                <input type="date" className="rounded-md border border-slate-300 px-3 py-2 text-sm" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
              </label>

              <div className="overflow-hidden rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Beschreibung</th>
                      <th className="px-3 py-2 text-right">Bestellt</th>
                      <th className="px-3 py-2 text-right">Geliefert</th>
                      <th className="px-3 py-2 text-right">Rest</th>
                      <th className="px-3 py-2 text-right">Menge jetzt</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {remaining.map((l) => (
                      <tr key={l.sourceLineId}>
                        <td className="px-3 py-2 text-slate-700">{l.description}</td>
                        <td className="tabular px-3 py-2 text-right text-slate-500">
                          {formatQuantity(l.orderedMilli)} {l.unit}
                        </td>
                        <td className="tabular px-3 py-2 text-right text-slate-500">
                          {formatQuantity(l.deliveredMilli)} {l.unit}
                        </td>
                        <td className="tabular px-3 py-2 text-right text-slate-500">
                          {formatQuantity(l.remainingMilli)} {l.unit}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <input
                            className="w-24 rounded-md border border-slate-300 px-2 py-1 text-right text-sm"
                            value={quantities[l.sourceLineId] ?? ""}
                            onChange={(e) => setQuantities((q) => ({ ...q, [l.sourceLineId]: e.target.value }))}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center gap-3">
                <button type="button" onClick={submitDeliveryNote} disabled={dialogBusy} className={btnCls}>
                  {dialogBusy ? "…" : "Lieferschein anlegen"}
                </button>
                <button type="button" onClick={closeDialog} className="text-sm text-slate-500 hover:text-slate-800">
                  Abbrechen
                </button>
              </div>
            </div>
          )}
        </div>
      </dialog>

      {/* Task 4: Teilrechnung */}
      <dialog ref={partialDialogRef} className="w-full max-w-2xl rounded-lg border border-slate-200 p-0 backdrop:bg-slate-900/40">
        <div className="max-h-[85vh] overflow-y-auto p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Teilrechnung erzeugen</h2>
            <button type="button" onClick={closePartialDialog} className="text-slate-400 hover:text-slate-700">
              ✕
            </button>
          </div>

          {partialError && <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{partialError}</div>}

          {!billed ? (
            <p className="text-sm text-slate-500">Lade Abrechnungsstand…</p>
          ) : (
            <div className="space-y-4">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-slate-700">Art der Teilrechnung</span>
                <select className="rounded-md border border-slate-300 px-3 py-2 text-sm" value={partialMode} onChange={(e) => setPartialMode(e.target.value as PartialMode)}>
                  {/* B11 (Fix-Welle): Anteils-Modi nur, wenn alle Quellpositionen einen
                      Preis tragen (preisloser Lieferschein -> nur POSITIONS/QUANTITIES). */}
                  {allowShareModesInPartialInvoice && <option value="PERCENT">Prozentualer Anteil</option>}
                  {allowShareModesInPartialInvoice && <option value="NET_AMOUNT">Fester Nettobetrag</option>}
                  {allowShareModesInPartialInvoice && <option value="GROSS_AMOUNT">Fester Bruttobetrag</option>}
                  <option value="POSITIONS">Einzelne Positionen (vollstaendig)</option>
                  <option value="QUANTITIES">Teilmengen je Position</option>
                </select>
              </label>

              {partialMode === "PERCENT" && (
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-slate-700">Anteil in %</span>
                  <input className="w-32 rounded-md border border-slate-300 px-3 py-2 text-sm" value={partialPercent} onChange={(e) => setPartialPercent(e.target.value)} placeholder="z. B. 40" />
                </label>
              )}

              {(partialMode === "NET_AMOUNT" || partialMode === "GROSS_AMOUNT") && (
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-slate-700">Betrag in € ({partialMode === "NET_AMOUNT" ? "netto" : "brutto"})</span>
                  <input className="w-32 rounded-md border border-slate-300 px-3 py-2 text-sm" value={partialAmount} onChange={(e) => setPartialAmount(e.target.value)} placeholder="z. B. 1000,00" />
                </label>
              )}

              {partialMode === "POSITIONS" && (
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2"></th>
                        <th className="px-3 py-2">Beschreibung</th>
                        <th className="px-3 py-2 text-right">Menge</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectableLinesForPositions.map((l) => (
                        <tr key={l.sourceLineId}>
                          <td className="px-3 py-2">
                            <input type="checkbox" checked={partialSelectedLines[l.sourceLineId] ?? false} onChange={(e) => setPartialSelectedLines((s) => ({ ...s, [l.sourceLineId]: e.target.checked }))} />
                          </td>
                          <td className="px-3 py-2 text-slate-700">{l.description}</td>
                          <td className="tabular px-3 py-2 text-right text-slate-500">
                            {formatQuantity(l.orderedMilli)} {l.unit}
                          </td>
                        </tr>
                      ))}
                      {selectableLinesForPositions.length === 0 && (
                        <tr>
                          <td className="px-3 py-2 text-slate-500" colSpan={3}>
                            Keine vollstaendig unabgerechneten Positionen mehr.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {partialMode === "QUANTITIES" && (
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Beschreibung</th>
                        <th className="px-3 py-2 text-right">Bestellt</th>
                        <th className="px-3 py-2 text-right">Bereits berechnet</th>
                        <th className="px-3 py-2 text-right">Rest</th>
                        <th className="px-3 py-2 text-right">Menge jetzt</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {billed.map((l) => (
                        <tr key={l.sourceLineId}>
                          <td className="px-3 py-2 text-slate-700">{l.description}</td>
                          <td className="tabular px-3 py-2 text-right text-slate-500">
                            {formatQuantity(l.orderedMilli)} {l.unit}
                          </td>
                          <td className="tabular px-3 py-2 text-right text-slate-500">
                            {formatQuantity(l.billedMilli)} {l.unit}
                          </td>
                          <td className="tabular px-3 py-2 text-right text-slate-500">
                            {formatQuantity(l.remainingMilli)} {l.unit}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <input
                              className="w-24 rounded-md border border-slate-300 px-2 py-1 text-right text-sm"
                              value={partialQuantities[l.sourceLineId] ?? ""}
                              onChange={(e) => setPartialQuantities((q) => ({ ...q, [l.sourceLineId]: e.target.value }))}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex items-center gap-3">
                <button type="button" onClick={submitPartialInvoice} disabled={partialBusy} className={btnCls}>
                  {partialBusy ? "…" : "Teilrechnung anlegen"}
                </button>
                <button type="button" onClick={closePartialDialog} className="text-sm text-slate-500 hover:text-slate-800">
                  Abbrechen
                </button>
              </div>
            </div>
          )}
        </div>
      </dialog>

      {/* Task 4: Abschlagsrechnung */}
      <dialog ref={downpaymentDialogRef} className="w-full max-w-md rounded-lg border border-slate-200 p-0 backdrop:bg-slate-900/40">
        <div className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Abschlagsrechnung erzeugen</h2>
            <button type="button" onClick={closeDownpaymentDialog} className="text-slate-400 hover:text-slate-700">
              ✕
            </button>
          </div>

          {downpaymentError && <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{downpaymentError}</div>}

          <div className="space-y-4">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-slate-700">Art des Abschlags</span>
              <select className="rounded-md border border-slate-300 px-3 py-2 text-sm" value={downpaymentMode} onChange={(e) => setDownpaymentMode(e.target.value as DownpaymentMode)}>
                <option value="PERCENT">Prozentualer Anteil</option>
                <option value="AMOUNT">Fester Betrag</option>
              </select>
            </label>

            {downpaymentMode === "PERCENT" ? (
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-slate-700">Anteil in %</span>
                <input className="w-32 rounded-md border border-slate-300 px-3 py-2 text-sm" value={downpaymentPercent} onChange={(e) => setDownpaymentPercent(e.target.value)} placeholder="z. B. 30" />
              </label>
            ) : (
              <>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium text-slate-700">Betrag in €</span>
                  <input className="w-32 rounded-md border border-slate-300 px-3 py-2 text-sm" value={downpaymentAmount} onChange={(e) => setDownpaymentAmount(e.target.value)} placeholder="z. B. 3000,00" />
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={downpaymentAmountIsGross} onChange={(e) => setDownpaymentAmountIsGross(e.target.checked)} />
                  Betrag ist brutto (inkl. USt)
                </label>
              </>
            )}

            <div className="flex items-center gap-3">
              <button type="button" onClick={submitDownpaymentInvoice} disabled={downpaymentBusy} className={btnCls}>
                {downpaymentBusy ? "…" : "Abschlagsrechnung anlegen"}
              </button>
              <button type="button" onClick={closeDownpaymentDialog} className="text-sm text-slate-500 hover:text-slate-800">
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      </dialog>
    </span>
  );
}
