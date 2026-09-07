/**
 * BT-22 (cbc:Note / ram:IncludedNote) — Abzugsaufstellung für Schlussrechnungen
 * (Phase 5, §14 Abs. 5 Satz 2 UStG). Wird von xrechnung.ts UND cii.ts als ZUSÄTZLICHES
 * Note-Element ausgegeben (mehrere Note-Elemente sind in beiden Formaten zulässig) —
 * ein bereits vorhandener Freitext-Hinweis (z. B. Kleinunternehmer) bleibt unangetastet.
 */
import type { EInvoiceDeduction } from "./types";

function deMoney(cents: number): string {
  return new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
}

function deDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${d}.${m}.${y}`;
}

/** "Abzüge: RE-001 vom 01.02.2040: 3.000,00 netto + 570,00 USt = 3.570,00; ...". */
export function deductionsNoteText(deductions: EInvoiceDeduction[]): string {
  const parts = deductions.map(
    (d) => `${d.number} vom ${deDate(d.issueDate)}: ${deMoney(d.netCents)} netto + ${deMoney(d.taxCents)} USt = ${deMoney(d.grossCents)}`,
  );
  return `Abzüge: ${parts.join("; ")}`;
}
