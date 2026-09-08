/**
 * Durchsetzung der org-eigenen Steuersatz-Liste (Phase 12c, §33/§50). Sitzt in den
 * Domain-Kernen (…WithinTx / update… / saveProduct), NIE in einer Route oder einem
 * Formular — UI, REST-API und MCP laufen dort zusammen, es gibt keinen Bypass.
 *
 * Ein Satz ist zulaessig, wenn er
 *   (a) in der Liste der Organisation steht, ODER
 *   (b) bereits auf dem zu aendernden/abgeleiteten Beleg gespeichert ist (GoBD, §51:
 *       ein Beleg verliert seinen Satz nicht, weil die Organisation die Liste aendert), ODER
 *   (c) 0 ist — Gliederungszeilen (HEADING/TEXT/SUBTOTAL) und die Nullsatz-Schemata
 *       (KLEINUNTERNEHMER, DIFFERENZ, REVERSE_CHARGE, IG_*, AUSFUHR) brauchen ihn immer.
 */
import type { Prisma } from "@/generated/prisma/client";
import { dbInternal } from "@/lib/db";
import { loadDocumentSettings } from "@/domain/document/settings";

export class TaxRateNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaxRateNotAllowedError";
  }
}

/** Die tatsaechlich vorkommenden Saetze einer Positionsliste (undefined/null -> ignoriert). */
export function ratesOfLines(lines: readonly { taxRate?: number | null }[]): number[] {
  const out = new Set<number>();
  for (const l of lines) if (typeof l.taxRate === "number") out.add(l.taxRate);
  return [...out];
}

// `_tx` bleibt in der Signatur (Spec), wird aber bewusst nicht benutzt: `loadDocumentSettings`
// liest eine org-weite Einstellungszeile, die nicht Teil der Beleg-Transaktion ist. Der
// Parameter haelt die Aufrufstellen einheitlich und laesst eine spaetere Umstellung auf den
// Transaktionsclient zu, ohne jede Aufrufstelle anzufassen.
export async function assertAllowedTaxRates(
  _tx: Prisma.TransactionClient | typeof dbInternal,
  orgId: string,
  rates: readonly number[],
  opts: { existing?: readonly number[] } = {},
): Promise<void> {
  const candidates = [...new Set(rates)].filter((r) => r !== 0);
  if (candidates.length === 0) return;
  const allowed = new Set((await loadDocumentSettings(orgId)).taxRates);
  for (const r of opts.existing ?? []) allowed.add(r);
  for (const rate of candidates) {
    if (!allowed.has(rate)) {
      throw new TaxRateNotAllowedError(`Steuersatz ${rate} % ist für diese Organisation nicht freigegeben (Einstellungen → Belege).`);
    }
  }
}
