"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  allTypes: [string, string][]; // [key, label]
  initial: { enabledTypes: string[]; emailDigest: boolean };
}

/** Task 4: Einstellungen -> Benachrichtigungen — welche Typen erzeugen In-App-
 *  Benachrichtigungen, optional taeglicher E-Mail-Digest. */
export function NotificationSettingsForm({ allTypes, initial }: Props) {
  const router = useRouter();
  const [enabled, setEnabled] = useState<Set<string>>(new Set(initial.enabledTypes));
  const [emailDigest, setEmailDigest] = useState(initial.emailDigest);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(key: string) {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setSaved(false);
  }

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/notification-settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabledTypes: Array.from(enabled), emailDigest }),
    });
    setBusy(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? "Speichern fehlgeschlagen.");
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
      <div className="space-y-2">
        {allTypes.map(([key, label]) => {
          // Fix-Welle (S4): EMAIL_BOUNCED hat aktuell keinen Erzeuger im laufenden System
          // (markEmailBounced wird von keiner Route/keinem MCP-Tool aufgerufen — kein
          // Bounce-Webhook angebunden) — die Checkbox waere ohne Hinweis irrefuehrend
          // ("aktiviert", aber es passiert nie etwas), deshalb deaktiviert + Hinweistext.
          const disabled = key === "EMAIL_BOUNCED";
          return (
            <label key={key} className={`flex items-center gap-2 text-sm ${disabled ? "text-slate-400" : "text-slate-700"}`}>
              <input
                type="checkbox"
                checked={enabled.has(key)}
                onChange={() => toggle(key)}
                disabled={disabled}
                className="h-4 w-4 rounded border-slate-300"
              />
              {label}
              {disabled && <span className="text-xs italic">(noch nicht aktiv — kein Bounce-Empfang angebunden)</span>}
            </label>
          );
        })}
      </div>
      <label className="flex items-center gap-2 border-t border-slate-100 pt-4 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={emailDigest}
          onChange={(e) => {
            setEmailDigest(e.target.checked);
            setSaved(false);
          }}
          className="h-4 w-4 rounded border-slate-300"
        />
        Täglichen E-Mail-Digest versenden
      </label>
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => void save()} disabled={busy} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
          {busy ? "Speichert…" : "Speichern"}
        </button>
        {saved && <span className="text-xs text-emerald-600">Gespeichert.</span>}
        {error && <span className="text-xs text-rose-600">{error}</span>}
      </div>
    </div>
  );
}
