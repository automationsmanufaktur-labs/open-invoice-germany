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
};

export function StatusBadge({ status }: { status: string }) {
  const s = MAP[status] ?? { label: status, cls: "bg-slate-100 text-slate-700" };
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>;
}

const BILLING_STATE_MAP: Record<string, { label: string; cls: string }> = {
  NONE: { label: "Nicht berechnet", cls: "bg-slate-100 text-slate-600" },
  PARTIAL: { label: "Teilweise berechnet", cls: "bg-amber-100 text-amber-800" },
  FULL: { label: "Berechnet", cls: "bg-emerald-100 text-emerald-800" },
};

/** Abrechnungsstand eines Angebots/einer AB (src/domain/document/billing-state.ts) — bewusst
 *  ein eigenes Badge, da er kein Beleg-Status ist, sondern aus den Relationen abgeleitet wird. */
export function BillingStateBadge({ state }: { state: string }) {
  const s = BILLING_STATE_MAP[state] ?? { label: state, cls: "bg-slate-100 text-slate-600" };
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>;
}
