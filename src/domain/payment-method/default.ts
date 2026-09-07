/**
 * Phase 8b Fix-Runde 1 (Ruling c) — reine Prioritaetsfunktion fuer die Zahlungsart-
 * Vorbelegung in Zeilen-Kontexten (RowActionsMenu PAYMENT), in denen (anders als die
 * Rechnungs-Detailseite) kein einzelner Kunde geladen wird, sondern eine ganze Liste.
 * Kette: Kunden-Standard -> Org-Standard (DocumentSettings.defaultPaymentMethodId) ->
 * erste aktive Methode -> "TRANSFER" (Schema-Default aus recordPaymentSchema.method).
 * Bewusst NICHT die erste aktive Methode der Organisation ohne Ruecksicht auf den
 * jeweiligen Kunden hartkodieren (das war der Fehler vor dieser Fix-Runde).
 */
export function resolveDefaultPaymentMethodCode(opts: {
  customerDefaultCode?: string | null;
  orgDefaultCode?: string | null;
  activeMethods: { code: string }[];
}): string {
  if (opts.customerDefaultCode) return opts.customerDefaultCode;
  if (opts.orgDefaultCode) return opts.orgDefaultCode;
  return opts.activeMethods[0]?.code ?? "TRANSFER";
}
