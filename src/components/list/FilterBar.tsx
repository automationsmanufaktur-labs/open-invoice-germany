/**
 * URL-Query-getriebene Filterleiste (Phase 8b, §40, Task-2-Facts-Ruling: "server-rendered
 * Listen via searchParams"). Bewusst ein einfaches `<form method="get">` OHNE Client-JS —
 * das Absenden navigiert zur selben Seite mit neuen Query-Parametern, die Server Component
 * der jeweiligen Liste liest sie ueber `searchParams` und ruft `listInvoices`/`listQuotes`/…
 * direkt auf (kein Client-Fetch fuer die Erstansicht). Felder sind je Liste konfigurierbar
 * (`fields`-Prop) — Rechnungen/Dokumente/Lieferscheine/Abos zeigen jeweils eine reduzierte
 * Teilmenge.
 */
export type FilterField =
  | { type: "text"; name: string; label: string; placeholder?: string }
  | { type: "select"; name: string; label: string; options: { value: string; label: string }[] }
  | { type: "date"; name: string; label: string };

export function FilterBar({
  basePath,
  fields,
  values,
}: {
  basePath: string;
  fields: FilterField[];
  /** Aktuelle Werte aus `searchParams`, zur Vorbelegung der Felder. */
  values: Record<string, string | undefined>;
}) {
  return (
    <form method="get" action={basePath} className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
      {/* Task 4: Werte, die nicht als sichtbares Filterfeld existieren (z. B. `type` aus
         der Gutschriften-Navigation, `/rechnungen?type=CREDIT_NOTE`), bleiben beim
         Absenden des Formulars ueber ein verstecktes Feld erhalten, statt beim naechsten
         "Filtern" stillschweigend zu verschwinden. `offset` NICHT uebernehmen — eine neue
         Filterung soll wieder bei Seite 1 beginnen. */}
      {Object.entries(values)
        .filter(([key, v]) => v && key !== "offset" && !fields.some((f) => f.name === key))
        .map(([key, v]) => (
          <input key={key} type="hidden" name={key} value={v} />
        ))}
      {fields.map((f) => (
        <label key={f.name} className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">{f.label}</span>
          {f.type === "select" ? (
            <select name={f.name} defaultValue={values[f.name] ?? ""} className="rounded-md border border-slate-300 px-3 py-2 text-sm">
              <option value="">Alle</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : f.type === "date" ? (
            <input type="date" name={f.name} defaultValue={values[f.name] ?? ""} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          ) : (
            <input
              type="text"
              name={f.name}
              defaultValue={values[f.name] ?? ""}
              placeholder={f.placeholder}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          )}
        </label>
      ))}
      <button type="submit" className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
        Filtern
      </button>
      <a href={basePath} className="text-sm font-medium text-slate-500 hover:text-slate-800">
        Zurücksetzen
      </a>
    </form>
  );
}
