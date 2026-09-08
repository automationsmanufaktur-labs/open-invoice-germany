"use client";

/**
 * Sticky Kopfleiste des Beleg-Editors (Phase 11c, Task 4): Zurueck-Link + Titel +
 * Status-Badges links, „Vorschau" + Primaerknopf rechts.
 *
 * Zurueck-Link: bei ungespeicherten Aenderungen (`dirty`) KEIN direkter `<Link>` (der
 * wuerde sofort navigieren) und bewusst KEIN `window.confirm` (Facts/Brief: fuer den
 * Zurueck-Link ein eigener kleiner Bestaetigungs-`<dialog>`, nur das Browser-native
 * Verlassen ueber `beforeunload` — siehe `DocumentEditor` — nutzt den Browser-Standard-
 * Dialog). Ohne offene Aenderungen navigiert der Link direkt.
 *
 * Rechts genau EIN Speichern-Knopf (Primaerknopf, Beschriftung je Modus/Anlage-vs-
 * Bearbeiten-Fall von `DocumentEditor` berechnet) statt zweier Knoepfe mit identischer
 * `save()`-Wirkung — der Brief listet „Vorschau", „Speichern" (sekundaer) und einen
 * Primaerknopf nebeneinander auf; zwei Knoepfe mit exakt derselben Wirkung waeren
 * redundant und verwirrend, siehe Bericht (Task-4-Report, offener Punkt).
 *
 * `-mx-6 px-6` laesst die Leiste ueber die volle Breite des umschliessenden Containers
 * "ausbluten" — abgestimmt auf `AppShell`s `<main className="... px-6 py-8">` (Task 6
 * bindet den Editor dort ein); bei einem abweichenden Seiten-Container muesste Task 6
 * diesen Wert anpassen.
 *
 * I5 (Abschluss-Review): der bisherige Guard schuetzte nur den eigenen Zurueck-Link —
 * ein Klick auf einen Sidebar-/Topbar-Link (die App-Shell liegt dauerhaft NEBEN dem
 * Editor) verwarf einen ungespeicherten Entwurf kommentarlos. Solange `dirty`, faengt
 * ein `document`-Listener in der CAPTURING-Phase jeden Klick auf ein `<a href>` ab, bevor
 * Next.js' `Link`-eigener Klick-Handler (der die Navigation ausloest) ihn sieht — dessen
 * Implementierung bricht bereits bei `e.defaultPrevented` ab (`next/dist/client/link.js`),
 * ein `preventDefault()` hier reicht also aus, kein `stopPropagation()` noetig. Ausnahmen:
 * modifizierte Klicks (Strg/Cmd/Shift/Alt, Mittelklick — neuer Tab/Fenster, soll normal
 * funktionieren), Ziele in einem `target != _self`/`download`-Link, fremde Origins (externe
 * Links) und Klicks INNERHALB eines `<dialog>` — das deckt sowohl den eigenen
 * Bestaetigungs-Dialog unten (dessen "Verlassen"-Link darf nicht sich selbst abfangen) als
 * auch `NewCustomerDialog`/`NewProductDialog` ab (beide natives `<dialog>`, siehe dort).
 * Abgefangene Klicks oeffnen denselben Dialog wie der Zurueck-Link, mit `pendingHref` statt
 * `backHref` als Ziel — bestaetigt der Nutzer, navigiert der "Verlassen"-Link dorthin (kein
 * `router.push` noetig, der Klick auf den `Link` reicht).
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ConfirmDialog, type ConfirmDialogHandle } from "@/components/ui/ConfirmDialog";

function isModifiedClick(e: MouseEvent): boolean {
  return e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
}

export function EditorHeader({
  backHref,
  title,
  dirty,
  saving,
  primaryLabel,
  onSave,
  onPreview,
  previewDisabled,
}: {
  backHref: string;
  title: string;
  dirty: boolean;
  saving: boolean;
  primaryLabel: string;
  onSave: () => void;
  onPreview: () => void;
  previewDisabled?: boolean;
}) {
  const dialogRef = useRef<ConfirmDialogHandle>(null);
  // Ziel-Href eines abgefangenen In-App-Navigationsklicks (Sidebar/Topbar/Breadcrumb) —
  // `null` bedeutet "der eigene Zurueck-Link hat den Dialog geoeffnet", dann greift
  // `backHref` als Fallback (siehe `Link href` im Dialog unten).
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) return;
    function onDocumentClick(e: MouseEvent) {
      if (e.defaultPrevented || isModifiedClick(e)) return;
      const target = e.target;
      if (!(target instanceof Element)) return;
      // Klicks innerhalb eines nativen <dialog> nicht abfangen — deckt sowohl den
      // eigenen Bestaetigungs-Dialog (dessen "Verlassen"-Link) als auch
      // NewCustomerDialog/NewProductDialog ab (siehe Modulkommentar).
      if (target.closest("dialog")) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      e.preventDefault();
      setPendingHref(`${url.pathname}${url.search}${url.hash}`);
      dialogRef.current?.open();
    }
    document.addEventListener("click", onDocumentClick, true);
    return () => document.removeEventListener("click", onDocumentClick, true);
  }, [dirty]);

  return (
    <div className="sticky top-0 z-20 -mx-6 mb-6 border-b border-slate-200 bg-white/95 px-6 py-3 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {dirty ? (
            <button
              type="button"
              onClick={() => {
                setPendingHref(null);
                dialogRef.current?.open();
              }}
              className="shrink-0 text-sm text-slate-500 hover:text-slate-800"
            >
              ← Zurück
            </button>
          ) : (
            <Link href={backHref} className="shrink-0 text-sm text-slate-500 hover:text-slate-800">
              ← Zurück
            </Link>
          )}
          <h1 className="truncate text-lg font-bold tracking-tight text-slate-900 sm:text-xl">{title}</h1>
          <span className="shrink-0 rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">Entwurf</span>
          {dirty && <span className="shrink-0 rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">ungespeichert</span>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onPreview}
            disabled={previewDisabled}
            title={previewDisabled ? "Vorschau folgt" : undefined}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Vorschau
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {saving ? "Speichern…" : primaryLabel}
          </button>
        </div>
      </div>

      <ConfirmDialog
        ref={dialogRef}
        message="Es gibt ungespeicherte Änderungen. Trotzdem verlassen?"
        confirmLabel="Verlassen"
        tone="danger"
        confirmHref={pendingHref ?? backHref}
      />
    </div>
  );
}
