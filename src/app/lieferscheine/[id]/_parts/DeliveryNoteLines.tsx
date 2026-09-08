// src/app/lieferscheine/[id]/_parts/DeliveryNoteLines.tsx
import { formatCents, formatQuantity } from "@/lib/money";

export interface DeliveryNoteLineRow {
  id: string;
  articleNumber: string | null;
  description: string;
  quantityMilli: number;
  unit: string;
  unitNetPriceCents: number | null;
  taxRate: number | null;
}

/**
 * Positionstabelle der Lieferscheindetailseite (Phase 11d, Task 4) — unveraendert aus der
 * alten Seite uebernommen. DeliveryNoteLine hat kein `lineType`/`descriptionLong` wie
 * Rechnungs-/Dokumentzeilen (Schema), deshalb keine gemeinsame LineItemsTable, sondern eine
 * eigene, schlankere Tabelle mit den vier Anzeigeoptionen-Spalten des Belegs.
 */
export function DeliveryNoteLines({
  lines,
  showArticleNumber,
  showDescription,
  showPrices,
  showTax,
}: {
  lines: DeliveryNoteLineRow[];
  showArticleNumber: boolean;
  showDescription: boolean;
  showPrices: boolean;
  showTax: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            {showArticleNumber && <th className="px-4 py-2">Art.-Nr.</th>}
            {showDescription && <th className="px-4 py-2">Beschreibung</th>}
            <th className="px-4 py-2 text-right">Menge</th>
            {showPrices && <th className="px-4 py-2 text-right">Einzel</th>}
            {showPrices && showTax && <th className="px-4 py-2 text-right">USt</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {lines.map((l) => (
            <tr key={l.id}>
              {showArticleNumber && <td className="px-4 py-2 text-slate-500">{l.articleNumber ?? ""}</td>}
              {showDescription && <td className="px-4 py-2 text-slate-700">{l.description}</td>}
              <td className="tabular px-4 py-2 text-right">
                {formatQuantity(l.quantityMilli)} {l.unit}
              </td>
              {showPrices && <td className="tabular px-4 py-2 text-right">{l.unitNetPriceCents != null ? formatCents(l.unitNetPriceCents) : ""}</td>}
              {showPrices && showTax && <td className="tabular px-4 py-2 text-right">{l.taxRate != null ? `${l.taxRate}%` : ""}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
