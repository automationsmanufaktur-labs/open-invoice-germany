// src/components/detail/PdfStack.tsx
/** PDF-Ansicht in der Seitenmitte (Phase 11d): Browser-PDF-Viewer im iframe im A4-Verhaeltnis
 *  (Hoehe = Breite * sqrt 2, per CSS aspect-ratio), darunter ein Download-Link als Fallback fuer
 *  Browser ohne eingebetteten Viewer. Ohne `src` (Entwurf ohne Nummer/PDF) ein Hinweis. */
export function PdfStack({
  src,
  title,
  emptyText,
}: {
  src: string | null;
  title: string;
  emptyText?: string;
}) {
  if (!src) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-slate-500">
        {emptyText ?? "Noch kein PDF verfügbar."}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100 shadow-sm">
        <iframe src={`${src}#toolbar=0&navpanes=0`} title={title} className="block w-full" style={{ aspectRatio: "1 / 1.4142" }} />
      </div>
      <p className="text-right text-xs text-slate-500">
        Wird das PDF nicht angezeigt:{" "}
        <a href={src} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
          PDF öffnen
        </a>
      </p>
    </div>
  );
}
