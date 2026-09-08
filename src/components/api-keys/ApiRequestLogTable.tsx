"use client";

/**
 * Filterzeile + Tabelle des Anfrageprotokolls (Phase 12d, Task 4 — Abschluss-Review
 * Fix-Welle m2): aus ApiRequestLogPanel.tsx herausgeloest (war 345 Zeilen in einer Datei).
 * Laedt selbst ueber GET /api/settings/api-log (Session-Route der UI, siehe
 * src/domain/api-log/list.ts — die Liste kommt bewusst OHNE Bodies).
 *
 * Fix-Welle (m3): der Pfad-Filter loeste vorher bei JEDEM Tastendruck sofort einen Fetch
 * aus (die Zahlenfelder in ApiRequestLogPanel.tsx waren schon vorher entkoppelt,
 * Draft/onBlur-Muster) — jetzt ein kleiner Debounce wie bei Sucheingaben ueblich.
 *
 * Fix-Welle (m10): die Datumsfilter rechneten fest in UTC (`T00:00:00.000Z`), die Tabelle
 * zeigt Zeiten aber lokal (`toLocaleString("de-DE")`) — verschob die Tagesgrenze um 1-2 h
 * fuer Europe/Berlin. Jetzt ohne "Z"-Suffix: `new Date(...)` interpretiert den String im
 * lokalen Zeitraum des Browsers, konsistent mit der Anzeige.
 */
import { useEffect, useState, type InputHTMLAttributes } from "react";
import { inputCls } from "@/components/forms/fields";

/** Listenzeile OHNE Bodies (server-seitig aus Datenminimierungsgruenden weggelassen,
 *  siehe list.ts) — der volle Datensatz (inkl. Bodies) ist `LogDetail` in
 *  ApiRequestLogDrawer.tsx (m11: zwei Typen statt eines gemeinsamen, der Bodies fuer
 *  Listenzeilen versprach, obwohl die Session-Route sie dort nie liefert). */
export interface LogListRow {
  id: string;
  apiKeyId: string | null;
  requestId: string;
  method: string;
  path: string;
  query: string | null;
  status: number;
  durationMs: number;
  errorCode: string | null;
  ip: string | null;
  userAgent: string | null;
  bodyTruncated: boolean;
  createdAt: string;
}
export interface KeyOption {
  id: string;
  name: string;
}

const PATH_DEBOUNCE_MS = 250;
const TABLE_HEADERS = ["Zeit", "Methode", "Pfad", "Status", "Dauer (ms)", "Schlüssel"];

export function statusCls(status: number): string {
  if (status >= 500) return "text-rose-600";
  if (status >= 400) return "text-amber-600";
  return "text-emerald-600";
}

function TextFilter({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <input {...props} className={inputCls} />
    </label>
  );
}

export function ApiRequestLogTable({
  enabled,
  initialKeys,
  selectedId,
  onSelectRow,
  refreshKey,
}: {
  enabled: boolean;
  initialKeys: KeyOption[];
  selectedId: string | null;
  onSelectRow: (id: string, trigger: HTMLElement) => void;
  /** Vom Panel bei "Protokoll leeren" erhoeht, um den lokalen Zwischenspeicher hier
   *  (rows/total) neu zu laden — ohne diesen Kanal wuerde die Tabelle nach dem Leeren
   *  bis zum naechsten Filterwechsel die alten Zeilen weiter anzeigen. */
  refreshKey: number;
}) {
  const [apiKeyId, setApiKeyId] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [path, setPath] = useState("");
  const [debouncedPath, setDebouncedPath] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<LogListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const keyName = (id: string | null) => initialKeys.find((k) => k.id === id)?.name ?? "—";

  useEffect(() => {
    const t = setTimeout(() => setDebouncedPath(path.trim()), PATH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [path]);

  // Inline async-IIFE statt eines separaten `load()`-Aufrufs: ein `setLoading(true)` als
  // erste Anweisung DIREKT im Effektkoerper gilt dem Linter als synchrones `setState` im
  // Effekt (`react-hooks/set-state-in-effect`) — siehe PreviewSheet.tsx fuer dasselbe Muster.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const params = new URLSearchParams({ limit: "50" });
      if (apiKeyId) params.set("apiKeyId", apiKeyId);
      if (errorsOnly) params.set("errorsOnly", "true");
      if (debouncedPath) params.set("path", debouncedPath);
      if (from) params.set("from", new Date(`${from}T00:00:00`).toISOString());
      if (to) params.set("to", new Date(`${to}T23:59:59.999`).toISOString());
      const res = await fetch(`/api/settings/api-log?${params.toString()}`);
      if (cancelled) return;
      setLoading(false);
      if (!res.ok) return;
      const j = (await res.json()) as { rows: LogListRow[]; total: number };
      if (!cancelled) {
        setRows(j.rows);
        setTotal(j.total);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiKeyId, errorsOnly, debouncedPath, from, to, refreshKey]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-600">Schlüssel</span>
          <select value={apiKeyId} onChange={(e) => setApiKeyId(e.target.value)} className={inputCls}>
            <option value="">Alle</option>
            {initialKeys.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} /> nur Fehler (≥ 400)
        </label>
        <TextFilter label="Pfad enthält" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/api/v1/Invoice" />
        <TextFilter label="Von" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <TextFilter label="Bis" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <span className="text-xs text-slate-400">{loading ? "Lädt…" : `${total} Einträge`}</span>
      </div>

      {!enabled ? (
        <p className="text-sm text-slate-400">Das Protokoll ist ausgeschaltet.</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-400">Noch keine Anfragen protokolliert.</p>
      ) : (
        <div className="overflow-x-auto rounded border border-slate-100">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-left uppercase tracking-wide text-slate-500">
              <tr>
                {TABLE_HEADERS.map((h) => (
                  <th key={h} className="px-2 py-1">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr
                  key={r.id}
                  tabIndex={0}
                  aria-selected={r.id === selectedId}
                  onClick={(e) => onSelectRow(r.id, e.currentTarget)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectRow(r.id, e.currentTarget);
                    }
                  }}
                  className="cursor-pointer hover:bg-slate-50 focus:outline focus:outline-2 focus:outline-offset-[-2px] focus:outline-indigo-400"
                >
                  <td className="px-2 py-1">{new Date(r.createdAt).toLocaleString("de-DE")}</td>
                  <td className="px-2 py-1 font-mono">{r.method}</td>
                  <td className="px-2 py-1 font-mono">{r.path}</td>
                  <td className={`px-2 py-1 font-semibold ${statusCls(r.status)}`}>{r.status}</td>
                  <td className="px-2 py-1">{r.durationMs}</td>
                  <td className="px-2 py-1">{keyName(r.apiKeyId)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
