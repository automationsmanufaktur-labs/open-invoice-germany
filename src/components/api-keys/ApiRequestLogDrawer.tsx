"use client";

/**
 * Detail-Schublade des Anfrageprotokolls (Phase 12d, Task 4 — Abschluss-Review Fix-Welle
 * m2): aus ApiRequestLogPanel.tsx herausgeloest. Laedt GET /api/settings/api-log/[id] bei
 * jedem Wechsel von `id` (voller Datensatz inkl. Bodies, siehe findApiRequestLog).
 *
 * Fokus/Tastatur (m2-Nachtrag, Task-4-Review): exakt das Muster aus PreviewSheet.tsx (dort
 * ausfuehrlich begruendet) statt des vorherigen Nur-Escape-Handlers: Fokus wandert beim
 * Oeffnen auf "Schließen", ein DOCUMENT-Level-Escape-Handler schliesst UNABHAENGIG vom
 * aktuellen Fokusziel, Tab/Shift+Tab zirkuliert innerhalb der Schublade (Fokus-Falle via
 * `getFocusable`), und beim Schliessen kehrt der Fokus auf das zuvor fokussierte Element
 * zurueck (der Aufrufer — ApiRequestLogPanel.tsx — merkt sich dafuer die anklickte
 * Tabellenzeile und uebergibt sie in `onClose`).
 *
 * m11: eigener `LogDetail`-Typ (statt der Listenzeile `LogListRow` mit `requestBody`/
 * `responseBody`, die die Liste nie liefert) UND die Schublade zeigt jetzt zusaetzlich
 * Status/Dauer/errorCode — beim Debuggen genau die Werte, die man neben der Request-Id
 * braucht.
 */
import { useEffect, useRef, useState } from "react";
import { getFocusable } from "@/lib/focus";
import { statusCls, type LogListRow } from "./ApiRequestLogTable";

export interface LogDetail extends LogListRow {
  requestBody: string | null;
  responseBody: string | null;
}

export function ApiRequestLogDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const open = id !== null;
  const [detail, setDetail] = useState<LogDetail | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // `detail` beim Wechsel von `id` (auch auf `null`) WAEHREND DES RENDERNS zuruecksetzen
  // (Muster PreviewSheet.tsx) statt per `setState` direkt im Effektkoerper — zeigt beim
  // Wechsel auf eine andere Zeile sofort "Lädt…" statt kurz die vorherige Zeile.
  const [prevId, setPrevId] = useState<string | null>(null);
  if (id !== prevId) {
    setPrevId(id);
    setDetail(null);
  }

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/settings/api-log/${id}`);
      if (cancelled || !res.ok) return;
      const j = (await res.json()) as { row: LogDetail };
      if (!cancelled) setDetail(j.row);
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const t = setTimeout(() => closeBtnRef.current?.focus(), 0);
    return () => {
      clearTimeout(t);
      previouslyFocusedRef.current?.focus();
      previouslyFocusedRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = getFocusable(panel);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const fields: [string, string][] = detail
    ? [
        ["Request-ID", detail.requestId],
        ["Status", `${detail.status}${detail.errorCode ? ` (${detail.errorCode})` : ""}`],
        ["Dauer", `${detail.durationMs} ms`],
        ["Pfad", `${detail.path}${detail.query ? `?${detail.query}` : ""}`],
        ["IP", detail.ip ?? "—"],
        ["User-Agent", detail.userAgent ?? "—"],
      ]
    : [];

  return (
    <aside
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Anfrage-Details"
      className="fixed inset-y-0 right-0 z-40 w-full max-w-md overflow-y-auto border-l border-slate-200 bg-white p-4 shadow-xl"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Anfrage-Details</h3>
        <button ref={closeBtnRef} type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-800">
          Schließen
        </button>
      </div>
      {!detail ? (
        <p className="mt-4 text-sm text-slate-400">Lädt…</p>
      ) : (
        <dl className="mt-4 space-y-3 text-xs">
          {fields.map(([label, value]) => (
            <div key={label}>
              <dt className="font-medium text-slate-600">{label}</dt>
              <dd className={`break-all font-mono ${label === "Status" ? `font-semibold ${statusCls(detail.status)}` : ""}`}>{value}</dd>
            </div>
          ))}
          {detail.bodyTruncated && <p className="text-amber-700">Hinweis: gekürzt.</p>}
          {(["Request-Body", "Response-Body"] as const).map((label, i) => (
            <div key={label}>
              <dt className="font-medium text-slate-600">{label}</dt>
              <dd>
                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2">{(i === 0 ? detail.requestBody : detail.responseBody) ?? "—"}</pre>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </aside>
  );
}
