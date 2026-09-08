// src/components/detail/InternalNotesBox.tsx
/**
 * Interne Notiz einer Belegdetailseite (Fix-Welle I3) — immer sichtbar ausserhalb/oberhalb
 * der eingeklappten "Positionen"-Sektion, da sie als einziges Beleg-Feld nirgends sonst
 * steht (nie im PDF, XRechnung, ZUGFeRD oder Kunden-Mail, Lastenheft 48). Gemeinsamer
 * Baustein fuer Rechnung/Dokument/Lieferschein statt dreifach identischem JSX.
 */
export function InternalNotesBox({ notes }: { notes: string | null }) {
  if (!notes) return null;
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <span className="mr-2 font-medium">Interne Notiz</span>
      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs">nur intern sichtbar</span>
      <p className="mt-1 whitespace-pre-line">{notes}</p>
    </div>
  );
}
