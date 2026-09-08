"use client";

/**
 * Summenblock (Phase 11c, Task 5): Zwischensumme (Positionen vor Beleg-Rabatt/-
 * Aufschlag), Rabatt/Aufschlag, Netto, USt je Satz, Brutto fett, Skonto-Hinweis
 * (aus `skonto1/2`, nur INVOICE — `documentDiscountPercent`/`skonto1/2` existieren im
 * Draft zwar fuer alle Modi, aber nur `toInvoicePayload` sendet Skonto ueberhaupt,
 * `MoreOptions` zeigt die Skonto-Felder ebenfalls nur bei INVOICE), Fehlertext aus
 * `totals.error` (ungueltige Positionsmenge/-preis, siehe `computeDraftTotals`).
 *
 * Zeigt die USt AUFGESCHLUESSELT je Steuersatz (`totals.taxRows`, nicht EINE
 * kombinierte USt-Zeile) — Brief verlangt "USt je Satz".
 */
import type { DraftState } from "@/lib/editor/draft";
import type { DraftTotals } from "@/lib/editor/totals";
import { fromCents } from "@/lib/editor/parse";

function euro(cents: number): string {
  return `${fromCents(cents)} €`;
}

/** Reiner Anzeigetext aus den rohen Skonto-Eingabefeldern (`MoreOptions`) — bewusst
 *  NICHT ueber `skontoTerms` (`@/lib/pricing/skonto`), die ein konkretes `issueDate`
 *  braucht: ein Entwurf hat vor dem ersten Speichern/Festschreiben noch kein
 *  Rechnungsdatum, gegen das sich eine Frist berechnen liesse. */
function skontoHint(draft: DraftState): string | null {
  const parts: string[] = [];
  if (draft.skonto1Percent.trim() && draft.skonto1Days.trim()) {
    parts.push(`${draft.skonto1Percent} % Skonto bei Zahlung innerhalb ${draft.skonto1Days} Tagen`);
  }
  if (draft.skonto2Percent.trim() && draft.skonto2Days.trim()) {
    parts.push(`${draft.skonto2Percent} % Skonto bei Zahlung innerhalb ${draft.skonto2Days} Tagen`);
  }
  return parts.length ? parts.join(" · ") : null;
}

export function TotalsBlock({ totals, draft }: { totals: DraftTotals; draft: DraftState }) {
  if (totals.error) {
    return <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{totals.error}</div>;
  }

  const hint = draft.mode === "INVOICE" ? skontoHint(draft) : null;

  return (
    <div className="space-y-1 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700">
      <div className="flex justify-between">
        <span>Zwischensumme (Positionen)</span>
        <span className="tabular-nums">{euro(totals.lineNetCents)}</span>
      </div>
      {totals.allowanceCents > 0 && (
        <div className="flex justify-between text-slate-500">
          <span>Rabatt</span>
          <span className="tabular-nums">− {euro(totals.allowanceCents)}</span>
        </div>
      )}
      {totals.chargeCents > 0 && (
        <div className="flex justify-between text-slate-500">
          <span>Aufschlag</span>
          <span className="tabular-nums">+ {euro(totals.chargeCents)}</span>
        </div>
      )}
      <div className="flex justify-between border-t border-slate-100 pt-1">
        <span>Netto</span>
        <span className="tabular-nums font-medium">{euro(totals.netCents)}</span>
      </div>
      {totals.taxRows.map((r) => (
        <div key={r.rate} className="flex justify-between text-slate-500">
          <span>
            USt {r.rate} % <span className="text-slate-400">(Basis {euro(r.baseCents)})</span>
          </span>
          <span className="tabular-nums">{euro(r.taxCents)}</span>
        </div>
      ))}
      <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-semibold text-slate-900">
        <span>Brutto</span>
        <span className="tabular-nums">{euro(totals.grossCents)}</span>
      </div>
      {hint && <p className="border-t border-slate-100 pt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
