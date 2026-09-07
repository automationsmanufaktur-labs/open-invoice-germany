"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PauseDialog } from "@/components/dunning/PauseDialog";

/**
 * Mahn-Aktionen einer Rechnung — wiederverwendet auf /mahnwesen (je Zeile) und der
 * Rechnungsseite (Task 4 Facts: "Aktionen wie /mahnwesen"). Erstellung/Status laufen
 * ueber dieselben Routen wie die frueheren Einzelkomponenten (DunningButton), Versand
 * bleibt separat ueber SendEmailDialog (docType DUNNING) je Mahnung.
 */
export function DunningActions({
  invoiceId,
  dunningState,
  hasNextStage,
}: {
  invoiceId: string;
  dunningState: "ACTIVE" | "PAUSED" | "STOPPED";
  /** Ob ueberhaupt eine weitere (aktivierte) Mahnstufe konfiguriert ist. */
  hasNextStage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function createNext(force = false) {
    setBusy("create");
    setError(null);
    const res = await fetch(`/api/invoices/${invoiceId}/dunning`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!force && res.status === 409 && confirm(`${j.error ?? "Noch nicht fällig."}\n\nTrotzdem jetzt erstellen?`)) {
        setBusy(null);
        return createNext(true);
      }
      setError(j.error ?? "Erstellung fehlgeschlagen.");
      setBusy(null);
      return;
    }
    setBusy(null);
    router.refresh();
  }

  async function setState(state: "ACTIVE" | "STOPPED") {
    if (state === "STOPPED" && !confirm("Mahnprozess dauerhaft beenden?")) return;
    setBusy(state);
    setError(null);
    const res = await fetch(`/api/invoices/${invoiceId}/dunning-state`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? "Aktion fehlgeschlagen.");
      setBusy(null);
      return;
    }
    setBusy(null);
    router.refresh();
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {dunningState === "ACTIVE" && hasNextStage && (
        <button
          type="button"
          onClick={() => createNext(false)}
          disabled={busy === "create"}
          className="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-60"
        >
          {busy === "create" ? "…" : "Nächste Mahnstufe"}
        </button>
      )}
      {dunningState === "PAUSED" && (
        <button
          type="button"
          onClick={() => setState("ACTIVE")}
          disabled={busy === "ACTIVE"}
          className="rounded-md border border-emerald-300 bg-white px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
        >
          Fortsetzen
        </button>
      )}
      {dunningState === "ACTIVE" && <PauseDialog invoiceId={invoiceId} />}
      {dunningState !== "STOPPED" && (
        <button
          type="button"
          onClick={() => setState("STOPPED")}
          disabled={busy === "STOPPED"}
          className="rounded-md border border-rose-300 bg-white px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60"
        >
          Beenden
        </button>
      )}
      {error && <span className="text-xs text-rose-600">{error}</span>}
    </span>
  );
}
