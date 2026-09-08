// src/app/rechnungen/[id]/_parts/InvoiceTotals.tsx
import { formatCents } from "@/lib/money";
import { deDate, type DeductionSummary, type TaxBreakdownRow } from "./invoice-view-model";

/** Summenblock einer Rechnung (Phase 11d, Task 3) — unveraendert aus der frueheren
 *  `page.tsx` (Belegrabatt/-aufschlag, Netto, USt je Satz, Gesamt/Gesamtleistung,
 *  Abzugsblock der Schlussrechnung mit Restbetrag). */
export function InvoiceTotals({
  currency,
  type,
  hasDocumentAdjustment,
  documentDiscountTotalCents,
  documentChargeTotalCents,
  documentChargeReason,
  netTotalCents,
  breakdown,
  grossTotalCents,
  payableBase,
  deductionsByInvoice,
}: {
  currency: string;
  type: string;
  hasDocumentAdjustment: boolean;
  documentDiscountTotalCents: number;
  documentChargeTotalCents: number;
  documentChargeReason: string | null;
  netTotalCents: number;
  breakdown: TaxBreakdownRow[];
  grossTotalCents: number;
  payableBase: number;
  deductionsByInvoice: Map<string, DeductionSummary>;
}) {
  return (
    <div className="ml-auto max-w-xs space-y-1 text-sm">
      {hasDocumentAdjustment && (
        <>
          {/* Gutschriften spiegeln die Betraege (negativ). Anzeige vorzeichenrichtig
              (analog invoice-pdf.ts); der Grund gehoert nur zum Aufschlag. */}
          {documentDiscountTotalCents !== 0 && (
            <div className="flex justify-between text-slate-600">
              <span>Belegrabatt</span>
              <span className="tabular">{formatCents(-documentDiscountTotalCents, currency)}</span>
            </div>
          )}
          {documentChargeTotalCents !== 0 && (
            <div className="flex justify-between text-slate-600">
              <span>Belegaufschlag{documentChargeReason ? ` (${documentChargeReason})` : ""}</span>
              <span className="tabular">{formatCents(documentChargeTotalCents, currency)}</span>
            </div>
          )}
        </>
      )}
      <div className="flex justify-between">
        <span className="text-slate-600">Netto</span>
        <span className="tabular font-medium">{formatCents(netTotalCents, currency)}</span>
      </div>
      {breakdown
        .filter((b) => b.taxCents > 0)
        .map((b) => (
          <div key={b.taxRate} className="flex justify-between text-slate-600">
            <span>zzgl. {b.taxRate}% USt</span>
            <span className="tabular">{formatCents(b.taxCents, currency)}</span>
          </div>
        ))}
      <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-semibold">
        <span>{type === "FINAL" ? "Gesamtleistung" : "Gesamt"}</span>
        <span className="tabular">{formatCents(grossTotalCents, currency)}</span>
      </div>
      {type === "FINAL" && deductionsByInvoice.size > 0 && (
        <>
          {[...deductionsByInvoice.values()].map((d) => (
            <div key={d.number} className="flex justify-between text-slate-600">
              <span>
                abzüglich Abschlagsrechnung {d.number} vom {deDate(d.issueDate)}
              </span>
              <span className="tabular">
                −{formatCents(d.grossCents, currency)} (enthaltene USt {formatCents(d.taxCents, currency)})
              </span>
            </div>
          ))}
          <div className="flex justify-between border-t border-slate-200 pt-1 text-base font-semibold">
            <span>Restbetrag</span>
            <span className="tabular">{formatCents(payableBase, currency)}</span>
          </div>
        </>
      )}
    </div>
  );
}
