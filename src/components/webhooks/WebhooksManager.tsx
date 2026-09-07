"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface EndpointRow {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

interface DeliveryRow {
  id: string;
  event: string;
  status: string;
  attempts: number;
  responseCode: number | null;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
  nextAttemptAt: string;
}

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("de-DE");
}

/**
 * Einstellungen -> Webhooks (Phase 10, Task 5): Endpunkte anlegen/aendern/deaktivieren,
 * Test-Zustellung, Zustellprotokoll (Status/Antwortcode/Versuche) mit Replay. Muster
 * analog ApiKeysManager/DunningStagesEditor (Klartext-Secret nur einmalig anzeigen,
 * confirm() vor destruktiven Aktionen).
 */
export function WebhooksManager({ initialEndpoints, availableEvents }: { initialEndpoints: EndpointRow[]; availableEvents: string[] }) {
  const router = useRouter();
  const [endpoints, setEndpoints] = useState(initialEndpoints);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newSecret, setNewSecret] = useState<{ endpointId: string; secret: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [openDeliveries, setOpenDeliveries] = useState<Record<string, DeliveryRow[] | undefined>>({});

  function toggleEvent(e: string) {
    setEvents((cur) => (cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e]));
  }

  async function create() {
    setCreateError(null);
    if (!url.trim()) {
      setCreateError("URL ist erforderlich.");
      return;
    }
    if (events.length === 0) {
      setCreateError("Mindestens ein Ereignis ist erforderlich.");
      return;
    }
    setCreating(true);
    const res = await fetch("/api/webhooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: url.trim(), events }),
    });
    setCreating(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setCreateError(j.error ?? "Anlegen fehlgeschlagen.");
      return;
    }
    const j = (await res.json()) as { endpoint: EndpointRow & { secret: string } };
    setNewSecret({ endpointId: j.endpoint.id, secret: j.endpoint.secret });
    setEndpoints((cur) => [j.endpoint, ...cur]);
    setUrl("");
    setEvents([]);
    router.refresh();
  }

  async function toggleActive(ep: EndpointRow) {
    setBusyId(ep.id);
    setRowError((e) => ({ ...e, [ep.id]: "" }));
    const res = await fetch(`/api/webhooks/${ep.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: !ep.active }),
    });
    setBusyId(null);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setRowError((e) => ({ ...e, [ep.id]: j.error ?? "Speichern fehlgeschlagen." }));
      return;
    }
    setEndpoints((cur) => cur.map((e) => (e.id === ep.id ? { ...e, active: !e.active } : e)));
    router.refresh();
  }

  async function rotateSecret(ep: EndpointRow) {
    if (!confirm("Secret wirklich neu erzeugen? Das alte Secret wird sofort ungueltig.")) return;
    setBusyId(ep.id);
    const res = await fetch(`/api/webhooks/${ep.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ rotateSecret: true }),
    });
    setBusyId(null);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setRowError((e) => ({ ...e, [ep.id]: j.error ?? "Rotation fehlgeschlagen." }));
      return;
    }
    const j = (await res.json()) as { endpoint: EndpointRow & { secret?: string } };
    if (j.endpoint.secret) setNewSecret({ endpointId: ep.id, secret: j.endpoint.secret });
  }

  async function testDelivery(ep: EndpointRow) {
    setBusyId(ep.id);
    setTestResult((t) => ({ ...t, [ep.id]: "" }));
    const res = await fetch(`/api/webhooks/${ep.id}/test`, { method: "POST" });
    setBusyId(null);
    const j = (await res.json().catch(() => ({}))) as { attempt?: { outcome: string; status: number | null; error?: string }; error?: string };
    if (!res.ok) {
      setTestResult((t) => ({ ...t, [ep.id]: j.error ?? "Test fehlgeschlagen." }));
      return;
    }
    const a = j.attempt;
    setTestResult((t) => ({
      ...t,
      [ep.id]: a ? `${a.outcome === "delivered" ? "Erfolgreich" : a.outcome === "dead" ? "Fehlgeschlagen (DEAD)" : "Fehlgeschlagen (Wiederholung geplant)"} — HTTP ${a.status ?? "—"}${a.error ? `: ${a.error}` : ""}` : "Unbekanntes Ergebnis.",
    }));
    if (openDeliveries[ep.id]) await loadDeliveries(ep);
  }

  async function loadDeliveries(ep: EndpointRow) {
    const res = await fetch(`/api/webhooks/${ep.id}/deliveries?limit=20`);
    if (!res.ok) return;
    const j = (await res.json()) as { rows: DeliveryRow[] };
    setOpenDeliveries((cur) => ({ ...cur, [ep.id]: j.rows }));
  }

  async function toggleDeliveries(ep: EndpointRow) {
    if (openDeliveries[ep.id]) {
      setOpenDeliveries((cur) => ({ ...cur, [ep.id]: undefined }));
      return;
    }
    await loadDeliveries(ep);
  }

  async function replay(ep: EndpointRow, deliveryId: string) {
    setBusyId(deliveryId);
    const res = await fetch(`/api/webhooks/${ep.id}/deliveries/${deliveryId}/replay`, { method: "POST" });
    setBusyId(null);
    if (res.ok) await loadDeliveries(ep);
  }

  return (
    <div className="space-y-6">
      {newSecret && (
        <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-semibold text-amber-900">Secret — nur jetzt sichtbar, danach nicht mehr abrufbar:</p>
          <code className="mt-1 block break-all rounded bg-white p-2 text-xs">{newSecret.secret}</code>
          <button type="button" onClick={() => setNewSecret(null)} className="mt-2 text-xs font-medium text-amber-800 underline">
            Verstanden, ausblenden
          </button>
        </div>
      )}

      <div className="space-y-3 rounded border border-slate-200 p-3">
        <h2 className="text-sm font-semibold text-slate-900">Neuer Endpunkt</h2>
        <div>
          <label className="block text-xs font-medium text-slate-600">Ziel-URL (https)</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://beispiel.example/webhook"
            className="mt-1 w-full max-w-md rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </div>
        <div>
          <span className="block text-xs font-medium text-slate-600">Ereignisse</span>
          <div className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-3">
            {availableEvents.map((ev) => (
              <label key={ev} className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={events.includes(ev)} onChange={() => toggleEvent(ev)} />
                {ev}
              </label>
            ))}
          </div>
        </div>
        {createError && <p className="text-sm text-red-600">{createError}</p>}
        <button
          type="button"
          onClick={create}
          disabled={creating}
          className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {creating ? "Wird angelegt…" : "Anlegen"}
        </button>
      </div>

      <div className="space-y-3">
        {endpoints.length === 0 && <p className="text-sm text-slate-400">Noch keine Webhook-Endpunkte.</p>}
        {endpoints.map((ep) => (
          <div key={ep.id} className="rounded border border-slate-200 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-mono text-xs">{ep.url}</p>
                <p className="mt-1 text-xs text-slate-500">{ep.events.join(", ")}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {ep.active ? "aktiv" : "deaktiviert"} · angelegt {fmt(ep.createdAt)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => toggleActive(ep)} disabled={busyId === ep.id} className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50">
                  {ep.active ? "Deaktivieren" : "Aktivieren"}
                </button>
                <button type="button" onClick={() => rotateSecret(ep)} disabled={busyId === ep.id} className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50">
                  Secret erneuern
                </button>
                <button type="button" onClick={() => testDelivery(ep)} disabled={busyId === ep.id} className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50">
                  Test-Zustellung
                </button>
                <button type="button" onClick={() => toggleDeliveries(ep)} className="rounded border border-slate-300 px-2 py-1 text-xs">
                  {openDeliveries[ep.id] ? "Protokoll ausblenden" : "Zustellprotokoll"}
                </button>
              </div>
            </div>
            {rowError[ep.id] && <p className="mt-2 text-xs text-red-600">{rowError[ep.id]}</p>}
            {testResult[ep.id] && <p className="mt-2 text-xs text-slate-700">{testResult[ep.id]}</p>}

            {openDeliveries[ep.id] && (
              <div className="mt-3 overflow-x-auto rounded border border-slate-100">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 text-left uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-2 py-1">Ereignis</th>
                      <th className="px-2 py-1">Status</th>
                      <th className="px-2 py-1">Versuche</th>
                      <th className="px-2 py-1">Antwortcode</th>
                      <th className="px-2 py-1">Angelegt</th>
                      <th className="px-2 py-1">Zugestellt</th>
                      <th className="px-2 py-1" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(openDeliveries[ep.id] ?? []).map((d) => (
                      <tr key={d.id}>
                        <td className="px-2 py-1">{d.event}</td>
                        <td className="px-2 py-1">{d.status}</td>
                        <td className="px-2 py-1">{d.attempts}</td>
                        <td className="px-2 py-1">{d.responseCode ?? "—"}</td>
                        <td className="px-2 py-1">{fmt(d.createdAt)}</td>
                        <td className="px-2 py-1">{fmt(d.deliveredAt)}</td>
                        <td className="px-2 py-1 text-right">
                          <button
                            type="button"
                            onClick={() => replay(ep, d.id)}
                            disabled={busyId === d.id}
                            className="text-xs font-medium text-indigo-600 underline disabled:opacity-50"
                          >
                            Replay
                          </button>
                        </td>
                      </tr>
                    ))}
                    {(openDeliveries[ep.id] ?? []).length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-2 py-2 text-center text-slate-400">
                          Noch keine Zustellungen.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
