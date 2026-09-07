"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Task 4 (§16-Aktionsblock): dupliziert eine Rechnung als neuen Entwurf (POST
 * /api/invoices/[id]/duplicate). PARTIAL/DOWNPAYMENT/FINAL koennen nicht dupliziert
 * werden (InvalidOperationError -> 409, Task 2) — der Aufrufer blendet den Button dafuer
 * per `disabled` mit Begruendung aus, statt einen Button zu zeigen, der serverseitig
 * ohnehin scheitert.
 */
export function DuplicateInvoiceButton({ invoiceId, disabled, disabledReason }: { invoiceId: string; disabled?: boolean; disabledReason?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (disabled) {
    return (
      <span className="text-xs text-slate-400" title={disabledReason}>
        Duplizieren nicht möglich{disabledReason ? ` (${disabledReason})` : ""}
      </span>
    );
  }

  async function onClick() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/invoices/${invoiceId}/duplicate`, { method: "POST" });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? "Duplizieren fehlgeschlagen.");
      setBusy(false);
      return;
    }
    const copy = (await res.json()) as { id: string };
    setBusy(false);
    router.push(`/rechnungen/${copy.id}/bearbeiten`);
    router.refresh();
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
      >
        {busy ? "…" : "Duplizieren"}
      </button>
      {error && <span className="text-xs text-rose-600">{error}</span>}
    </span>
  );
}
