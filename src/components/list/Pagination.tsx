import Link from "next/link";

/**
 * URL-getriebene Seitennavigation fuer Listen (Phase 8b, §40) — Server Component, keine
 * eigene Fetch-Logik. `basePath` + `searchParams` (die aktuellen Filterwerte) bestimmen
 * das Ziel jedes Links; nur `offset` wird je Link veraendert.
 */
export function Pagination({
  basePath,
  searchParams,
  total,
  limit,
  offset,
}: {
  basePath: string;
  searchParams: Record<string, string | undefined>;
  total: number;
  limit: number;
  offset: number;
}) {
  if (total <= limit && offset === 0) return null;

  const page = Math.floor(offset / limit) + 1;
  const pageCount = Math.max(1, Math.ceil(total / limit));
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);

  function hrefFor(newOffset: number): string {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (v) params.set(k, v);
    }
    params.set("offset", String(newOffset));
    return `${basePath}?${params.toString()}`;
  }

  const prevOffset = Math.max(0, offset - limit);
  const nextOffset = offset + limit;
  const hasPrev = offset > 0;
  const hasNext = offset + limit < total;

  return (
    <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
      <span>
        {from}–{to} von {total} · Seite {page} / {pageCount}
      </span>
      <div className="flex items-center gap-2">
        {hasPrev ? (
          <Link href={hrefFor(prevOffset)} className="rounded-md border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50">
            ← Zurück
          </Link>
        ) : (
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-400">← Zurück</span>
        )}
        {hasNext ? (
          <Link href={hrefFor(nextOffset)} className="rounded-md border border-slate-300 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50">
            Weiter →
          </Link>
        ) : (
          <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-slate-400">Weiter →</span>
        )}
      </div>
    </div>
  );
}
