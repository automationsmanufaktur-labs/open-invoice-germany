/**
 * Phase 8b Fix-Runde 1 (Ruling a) — reine Entscheidungsfunktion fuer den
 * force/confirm-Ablauf beim Erstellen einer Mahnung ueber POST /api/invoices/[id]/dunning
 * (RowActionsMenu DUNNING/REMINDER, src/components/dunning/DunningActions.tsx): die Route
 * antwortet mit 409, wenn die naechste Stufe noch nicht faellig ist; der Client fragt dann
 * per `confirm()` nach, ob trotzdem mit `force: true` erneut angefragt werden soll.
 * Extrahiert aus dem Client-Code, damit der reine Entscheidungsteil (ohne `fetch`/
 * `confirm`-Mock) unit-testbar ist.
 */
export function shouldForceDunningRetry(opts: { status: number; alreadyForced: boolean; confirmed: boolean }): boolean {
  return !opts.alreadyForced && opts.status === 409 && opts.confirmed;
}
