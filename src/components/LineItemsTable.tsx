/**
 * Gemeinsame Positionstabelle fuer die HTML-Ansichten (Rechnung, Dokument, oeffentliches
 * Angebot) — Server-Komponente (W2, Fix-Welle nach Abschluss-Review). Bildet dieselben
 * Positionsbloecke ab wie PDF/XML (§8): HEADING fett ueber die volle Breite, TEXT als
 * Rich-Text-HTML, SUBTOTAL rechtsbuendig aus computeSubtotals, ITEM mit optionaler
 * Artikelnummer-Spalte und descriptionLong als Rich-Text unter der Bezeichnung. Keine
 * Menge-0-Zeilen mehr sichtbar (Nicht-ITEM-Zeilen zeigen weder Menge noch Preis/Netto).
 *
 * Server-only (parseRichText/renderRichTextHtml ueber den Sammel-Import "@/lib/richtext",
 * der auch den PDF-Renderer buendelt) — im Client NIE importieren, dort nur "@/lib/richtext/
 * parse" + "@/lib/richtext/render-html" direkt (siehe src/components/editor/RichTextField.tsx).
 */
import { parseRichText, renderRichTextHtml } from "@/lib/richtext";
import { computeSubtotals, type LineForSubtotal } from "@/domain/document/lines";
import { formatCents, formatQuantity } from "@/lib/money";

const KNOWN_LINE_TYPES = new Set<LineForSubtotal["lineType"]>(["ITEM", "HEADING", "TEXT", "SUBTOTAL"]);

/** Engt eine rohe DB-lineType-Zeichenkette auf die bekannte Union ein (Fallback ITEM,
 *  gleiche Regel wie toLineType in src/lib/einvoice/mapper.ts). */
function toLineType(value: string | null | undefined): LineForSubtotal["lineType"] {
  return value && KNOWN_LINE_TYPES.has(value as LineForSubtotal["lineType"]) ? (value as LineForSubtotal["lineType"]) : "ITEM";
}

export interface LineItemsTableLine {
  id: string;
  /** Roh aus der DB (string) oder bereits die bekannte Union — beides erlaubt. */
  lineType?: string | null;
  description: string;
  descriptionLong?: string | null;
  articleNumber?: string | null;
  quantityMilli: number;
  unit: string;
  unitNetPriceCents: number;
  taxRate: number;
  lineNetCents: number;
}

function richTextHtml(markdown: string): string {
  return renderRichTextHtml(parseRichText(markdown));
}

export function LineItemsTable({ lines, currency }: { lines: readonly LineItemsTableLine[]; currency: string }) {
  const normalized = lines.map((l) => ({ ...l, lineType: toLineType(l.lineType) }));
  const subtotals = computeSubtotals(normalized);
  const showArticleNumber = normalized.some((l) => l.lineType === "ITEM" && l.articleNumber);
  // Beschreibung + ggf. Artikelnummer + USt + Netto (+ Menge/Einzel je nach Layout).
  const totalColumns = showArticleNumber ? 6 : 5;

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2">Beschreibung</th>
            {showArticleNumber && <th className="px-4 py-2">Art.-Nr.</th>}
            <th className="px-4 py-2 text-right">Menge</th>
            <th className="px-4 py-2 text-right">Einzel</th>
            <th className="px-4 py-2 text-right">USt</th>
            <th className="px-4 py-2 text-right">Netto</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {normalized.map((l, i) => {
            if (l.lineType === "HEADING") {
              return (
                <tr key={l.id}>
                  <td className="px-4 py-2 font-semibold text-slate-900" colSpan={totalColumns}>
                    {l.description}
                  </td>
                </tr>
              );
            }
            if (l.lineType === "TEXT") {
              return (
                <tr key={l.id}>
                  <td className="px-4 py-2 text-slate-600" colSpan={totalColumns}>
                    {l.description && <p className="mb-1">{l.description}</p>}
                    {l.descriptionLong && (
                      <div className="rich-text text-slate-600" dangerouslySetInnerHTML={{ __html: richTextHtml(l.descriptionLong) }} />
                    )}
                  </td>
                </tr>
              );
            }
            if (l.lineType === "SUBTOTAL") {
              return (
                <tr key={l.id} className="font-medium text-slate-800">
                  <td className="px-4 py-2" colSpan={totalColumns - 1}>
                    {l.description}
                  </td>
                  <td className="tabular px-4 py-2 text-right">{formatCents(subtotals[i], currency)}</td>
                </tr>
              );
            }
            // ITEM
            return (
              <tr key={l.id}>
                <td className="px-4 py-2 text-slate-700">
                  {l.description}
                  {l.descriptionLong && (
                    <div
                      className="rich-text mt-1 text-xs text-slate-500"
                      dangerouslySetInnerHTML={{ __html: richTextHtml(l.descriptionLong) }}
                    />
                  )}
                </td>
                {showArticleNumber && <td className="px-4 py-2 text-slate-500">{l.articleNumber}</td>}
                <td className="tabular px-4 py-2 text-right">
                  {formatQuantity(l.quantityMilli)} {l.unit}
                </td>
                <td className="tabular px-4 py-2 text-right">{formatCents(l.unitNetPriceCents, currency)}</td>
                <td className="tabular px-4 py-2 text-right">{l.taxRate}%</td>
                <td className="tabular px-4 py-2 text-right">{formatCents(l.lineNetCents, currency)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
