/** Eingebettete PDF-Vorschau (Task 4) — reines iframe auf eine bestehende PDF-Route,
 *  kein neuer Renderer/keine neue Route. */
export function PdfPreview({ src, title = "PDF-Vorschau" }: { src: string; title?: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
      <iframe src={src} title={title} className="h-[70vh] w-full" />
    </div>
  );
}
