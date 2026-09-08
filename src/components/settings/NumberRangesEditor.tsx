"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface NumberRangeRow {
  docType: string;
  pattern: string;
  prefix: string;
  seqPadding: number;
  yearlyReset: boolean;
  currentValue: number;
  nextNumberPreview: string;
}

const LABELS: Record<string, string> = {
  CUSTOMER: "Kundennummern",
  PRODUCT: "Artikelnummern",
  ANGEBOT: "Angebote",
  AUFTRAGSBESTAETIGUNG: "Auftragsbestätigungen",
  PROFORMA: "Proforma-Rechnungen",
  DELIVERY_NOTE: "Lieferscheine",
  INVOICE: "Rechnungen",
  CREDIT_NOTE: "Gutschriften",
  DUNNING: "Mahnungen",
};

type Draft = Pick<NumberRangeRow, "pattern" | "prefix" | "seqPadding" | "yearlyReset"> & { nextValue: number };

function draftOf(r: NumberRangeRow): Draft {
  return { pattern: r.pattern, prefix: r.prefix, seqPadding: r.seqPadding, yearlyReset: r.yearlyReset, nextValue: r.currentValue + 1 };
}

/**
 * Nummernkreis-Verwaltung (§34) — eine Zeile je Belegtyp (inkl. Kunden-/Artikelnummern),
 * Inline-Bearbeitung analog DunningStagesEditor. Zurückdrehen wird serverseitig (409)
 * abgelehnt (GoBD, §14 Abs.4 Nr.4 UStG) — die Fehlermeldung der Route wird 1:1 angezeigt.
 */
export function NumberRangesEditor({ initialRanges }: { initialRanges: NumberRangeRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRanges);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(Object.fromEntries(initialRanges.map((r) => [r.docType, draftOf(r)])));
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function setDraft(docType: string, patch: Partial<Draft>) {
    setDrafts((d) => ({ ...d, [docType]: { ...d[docType], ...patch } }));
  }

  async function save(docType: string) {
    setBusy(docType);
    setErrors((e) => ({ ...e, [docType]: "" }));
    const res = await fetch(`/api/settings/number-ranges/${docType}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(drafts[docType]),
    });
    const j = (await res.json().catch(() => ({}))) as { range?: NumberRangeRow; error?: string };
    if (!res.ok || !j.range) {
      setErrors((e) => ({ ...e, [docType]: j.error ?? "Speichern fehlgeschlagen." }));
      setBusy(null);
      return;
    }
    setRows((rs) => rs.map((r) => (r.docType === docType ? j.range! : r)));
    setDrafts((d) => ({ ...d, [docType]: draftOf(j.range!) }));
    setBusy(null);
    router.refresh();
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-3 py-2">Typ</th>
            <th className="px-3 py-2">Präfix</th>
            <th className="px-3 py-2">Muster</th>
            <th className="px-3 py-2">Stellen</th>
            <th className="px-3 py-2">Jährlich zurücksetzen</th>
            <th className="px-3 py-2">Nächste Nummer</th>
            <th className="px-3 py-2">Vorschau</th>
            <th className="px-3 py-2 text-right">Aktion</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => {
            const d = drafts[r.docType];
            const label = LABELS[r.docType] ?? r.docType;
            return (
              <tr key={r.docType}>
                <td className="px-3 py-2 font-medium text-slate-700">{label}</td>
                <td className="px-3 py-2">
                  <input
                    value={d.prefix}
                    onChange={(e) => setDraft(r.docType, { prefix: e.target.value })}
                    className="w-20 rounded border border-slate-300 px-2 py-1"
                    aria-label={`Präfix — ${label}`}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    value={d.pattern}
                    onChange={(e) => setDraft(r.docType, { pattern: e.target.value })}
                    className="w-40 rounded border border-slate-300 px-2 py-1"
                    aria-label={`Muster — ${label}`}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={d.seqPadding}
                    onChange={(e) => setDraft(r.docType, { seqPadding: Number(e.target.value) })}
                    className="w-16 rounded border border-slate-300 px-2 py-1"
                    aria-label={`Stellen der laufenden Nummer — ${label}`}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={d.yearlyReset}
                    onChange={(e) => setDraft(r.docType, { yearlyReset: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300"
                    aria-label={`Jährlich zurücksetzen — ${label}`}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    min={1}
                    value={d.nextValue}
                    onChange={(e) => setDraft(r.docType, { nextValue: Number(e.target.value) })}
                    className="w-24 rounded border border-slate-300 px-2 py-1"
                    aria-label={`Nächste Nummer — ${label}`}
                  />
                </td>
                <td className="px-3 py-2 text-slate-500">{r.nextNumberPreview}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-col items-end gap-1">
                    <button
                      type="button"
                      onClick={() => save(r.docType)}
                      disabled={busy === r.docType}
                      className="rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
                    >
                      Speichern
                    </button>
                    {errors[r.docType] && <span className="text-right text-xs text-rose-600">{errors[r.docType]}</span>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
