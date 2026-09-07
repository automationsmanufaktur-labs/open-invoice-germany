"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Run {
  id: string;
  job: string;
  trigger: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  summaryJson: string | null;
  error: string | null;
}

const STATUS_CLS: Record<string, string> = {
  RUNNING: "bg-sky-100 text-sky-800",
  OK: "bg-emerald-100 text-emerald-800",
  FAILED: "bg-rose-100 text-rose-700",
};

function deDateTime(iso: string | null) {
  return iso ? new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "medium" }).format(new Date(iso)) : "—";
}

/** Task 4: "Jetzt pruefen"-Knopf + Protokoll der letzten Laeufe — nutzt die bereits in
 *  Task 3 vorhandenen Routen (/api/scheduler/run, /api/scheduler/runs), keine neue Logik. */
export function SchedulerRunsTable({ initialRuns }: { initialRuns: Run[] }) {
  const router = useRouter();
  const [runs, setRuns] = useState(initialRuns);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runNow() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/scheduler/run", { method: "POST" });
    if (!res.ok && res.status !== 207) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? "Lauf fehlgeschlagen.");
      setBusy(false);
      return;
    }
    const refreshed = await fetch("/api/scheduler/runs");
    if (refreshed.ok) {
      const j = (await refreshed.json()) as { runs: Run[] };
      setRuns(j.runs);
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <button type="button" onClick={runNow} disabled={busy} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
          {busy ? "Läuft…" : "Jetzt prüfen"}
        </button>
        {error && <span className="text-xs text-rose-600">{error}</span>}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Job</th>
              <th className="px-3 py-2">Auslöser</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Gestartet</th>
              <th className="px-3 py-2">Beendet</th>
              <th className="px-3 py-2">Ergebnis</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {runs.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2 font-medium text-slate-800">{r.job}</td>
                <td className="px-3 py-2 text-slate-600">{r.trigger}</td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_CLS[r.status] ?? "bg-slate-100 text-slate-700"}`}>{r.status}</span>
                </td>
                <td className="px-3 py-2 text-slate-600">{deDateTime(r.startedAt)}</td>
                <td className="px-3 py-2 text-slate-600">{deDateTime(r.finishedAt)}</td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  <span className="line-clamp-2 break-all">{r.error ?? r.summaryJson ?? "—"}</span>
                </td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                  Noch keine Läufe protokolliert.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
