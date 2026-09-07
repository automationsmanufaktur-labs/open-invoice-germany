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

const btnCls = "rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60";
const btnOutlineCls = "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60";

/**
 * "Erzeugen"-Aktionen fuer ein Dokument (Angebot/AB) oder eine Rechnung: Auftrags-
 * bestaetigung, Rechnung, Lieferschein (mit Mengen-Dialog gegen die Restmengen). Nur
 * die zutreffenden Optionen werden ueber die `show*`-Props eingeblendet.
 */
export function ConvertMenu({
  sourceType,
  sourceId,
  showToOrderConfirmation,
  showToInvoice,
  showToDeliveryNote = true,
}: {
  sourceType: "QUOTE" | "INVOICE";
  sourceId: string;
  showToOrderConfirmation?: boolean;
  showToInvoice?: boolean;
  showToDeliveryNote?: boolean;
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

  const convertRoute = `/api/documents/${sourceId}/convert`;

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
    </span>
  );
}
