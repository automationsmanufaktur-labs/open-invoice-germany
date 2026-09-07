const MAP: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "Entwurf", cls: "bg-slate-100 text-slate-700" },
  FINALIZED: { label: "Festgeschrieben", cls: "bg-indigo-100 text-indigo-800" },
  SENT: { label: "Versendet", cls: "bg-sky-100 text-sky-800" },
  PARTIALLY_PAID: { label: "Teilbezahlt", cls: "bg-amber-100 text-amber-800" },
  PAID: { label: "Bezahlt", cls: "bg-emerald-100 text-emerald-800" },
  CANCELLED: { label: "Storniert", cls: "bg-rose-100 text-rose-700" },
  // QuoteStatus (Angebot/AB/Proforma)
  ACCEPTED: { label: "Angenommen", cls: "bg-emerald-100 text-emerald-800" },
  REJECTED: { label: "Abgelehnt", cls: "bg-rose-100 text-rose-700" },
  EXPIRED: { label: "Abgelaufen", cls: "bg-amber-100 text-amber-800" },
  // DeliveryNoteStatus
  CREATED: { label: "Erstellt", cls: "bg-indigo-100 text-indigo-800" },
  DELIVERED: { label: "Geliefert", cls: "bg-emerald-100 text-emerald-800" },
  // EffectiveInvoiceStatus (Phase 8b, §39 — src/domain/invoice/status.ts): OPEN/DUE/
  // OVERDUE werden NIE gespeichert, nur angezeigt. Labels aus INVOICE_STATUS_LABEL
  // uebernommen (dort die Quelle der Wahrheit fuer den Text), hier nur die Farbe ergaenzt.
  OPEN: { label: "Offen", cls: "bg-sky-100 text-sky-800" },
  DUE: { label: "Fällig heute", cls: "bg-amber-100 text-amber-800" },
  OVERDUE: { label: "Überfällig", cls: "bg-rose-100 text-rose-700" },
  // Kunden-Archivstatus (Task 4, Kunden-Detailseite).
  ARCHIVED: { label: "Archiviert", cls: "bg-slate-200 text-slate-600" },
  ACTIVE: { label: "Aktiv", cls: "bg-emerald-100 text-emerald-800" },
  PAUSED: { label: "Pausiert", cls: "bg-amber-100 text-amber-800" },
  ENDED: { label: "Beendet", cls: "bg-slate-100 text-slate-600" },
};

/**
 * Fix-Welle (S1): `partiallyPaid` haengt "· teilbezahlt" an ein OPEN/DUE/OVERDUE-Badge an —
 * seit S1 kann effectiveInvoiceStatus fuer eine teilweise bezahlte Rechnung mit
 * Restbetrag OVERDUE/DUE/OPEN liefern (statt PARTIALLY_PAID durchzureichen); der Hinweis
 * macht sichtbar, dass bereits eine Teilzahlung eingegangen ist.
 */
export function StatusBadge({ status, partiallyPaid }: { status: string; partiallyPaid?: boolean }) {
  const s = MAP[status] ?? { label: status, cls: "bg-slate-100 text-slate-700" };
  const label = partiallyPaid && status !== "PARTIALLY_PAID" ? `${s.label} · teilbezahlt` : s.label;
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${s.cls}`}>{label}</span>;
}

const BILLING_STATE_MAP: Record<string, { label: string; cls: string }> = {
  NONE: { label: "Nicht berechnet", cls: "bg-slate-100 text-slate-600" },
  PARTIAL: { label: "Teilweise berechnet", cls: "bg-amber-100 text-amber-800" },
  FULL: { label: "Berechnet", cls: "bg-emerald-100 text-emerald-800" },
};

/** Abrechnungsstand eines Angebots/einer AB (src/domain/document/billing-state.ts) — bewusst
 *  ein eigenes Badge, da er kein Beleg-Status ist, sondern aus den Relationen abgeleitet wird.
 *  Task 4: optional mit Prozent (billedPermille aus BillingStateResult) — bei FULL immer 100 %. */
export function BillingStateBadge({ state, billedPermille }: { state: string; billedPermille?: number }) {
  const s = BILLING_STATE_MAP[state] ?? { label: state, cls: "bg-slate-100 text-slate-600" };
  const percentSuffix = billedPermille != null && state !== "NONE" ? ` (${(billedPermille / 10).toString().replace(".", ",")} %)` : "";
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${s.cls}`}>
      {s.label}
      {percentSuffix}
    </span>
  );
}
