/**
 * Globale Druckoptionen einer Organisation (Phase 7, Task 1, §36) sowie deren
 * Beleg-individuelle Ueberschreibung (Invoice/Quote/DeliveryNote.printOptionsJson).
 * Selbstheilung analog src/domain/document/settings.ts: ohne gespeicherte Zeile
 * gelten die Defaults, keine Migration noetig vor dem ersten Speichern.
 */
import { dbInternal } from "@/lib/db";
import { InvalidOperationError, NotFoundError } from "@/domain/errors";
import { printSettingsInputSchema, printOptionsOverrideSchema, type PrintSettingsInput, type PrintOptionsOverride } from "@/schemas/settings";

export const DEFAULT_PRINT_SETTINGS: PrintSettingsInput = printSettingsInputSchema.parse({});

/** Laedt die globalen Druckoptionen einer Organisation; Defaults, wenn noch keine Zeile existiert. */
export async function loadPrintSettings(orgId: string): Promise<PrintSettingsInput> {
  const row = await dbInternal.printSettings.findUnique({ where: { orgId } });
  if (!row) return DEFAULT_PRINT_SETTINGS;
  return printSettingsInputSchema.parse({
    showFooter: row.showFooter,
    showPageNumbers: row.showPageNumbers,
    foldMarks: row.foldMarks,
    punchMarks: row.punchMarks,
    showArticleNumber: row.showArticleNumber,
    showDescription: row.showDescription,
    showTaxRatePerLine: row.showTaxRatePerLine,
    showLineTotals: row.showLineTotals,
    showSenderLine: row.showSenderLine,
    showGiroCode: row.showGiroCode,
  });
}

/** Speichert die globalen Druckoptionen (Upsert, da anfangs keine Zeile existiert). */
export async function savePrintSettings(orgId: string, rawInput: unknown): Promise<PrintSettingsInput> {
  const input = printSettingsInputSchema.parse(rawInput);
  await dbInternal.printSettings.upsert({
    where: { orgId },
    create: { orgId, ...input },
    update: { ...input },
  });
  return input;
}

/**
 * Verschmilzt die globalen Druckoptionen mit einer Beleg-individuellen Ueberschreibung
 * (rein, ohne DB) — nur in `overrideJson` gesetzte Felder ueberschreiben `global`.
 * Faellt auch auf `global` zurueck, wenn `overrideJson` zwar gueltiges JSON, aber kein
 * gueltiges PrintOptionsOverride ist (Nit final-review: `.parse()` warf zuvor durch und
 * liess eine kaputte Zeile die PDF-Route mit 500 abbrechen statt sauber zurueckzufallen).
 */
export function effectivePrintOptions(global: PrintSettingsInput, overrideJson: string | null | undefined): PrintSettingsInput {
  if (!overrideJson) return global;
  let raw: unknown;
  try {
    raw = JSON.parse(overrideJson);
  } catch {
    return global;
  }
  const parsed = printOptionsOverrideSchema.safeParse(raw);
  if (!parsed.success) return global;
  return { ...global, ...parsed.data };
}

const PRINT_OPTION_KEYS = Object.keys(DEFAULT_PRINT_SETTINGS) as (keyof PrintSettingsInput)[];

/**
 * S6 (Fix-Welle Final-Review): bei Festschreibung den vollstaendig gemergten Optionssatz
 * einfrieren, damit eine spaetere Aenderung der GLOBALEN Druckoptionen einen bereits
 * festgeschriebenen Beleg nicht mehr veraendert. Nur wirksam, wenn `existingOverrideJson`
 * fehlt oder unvollstaendig ist (nicht alle Schalter gesetzt) — ein bereits vollstaendiger
 * Override ist schon "eingefroren" (globale Aenderungen wirken sich wegen des Spreads in
 * `effectivePrintOptions` ohnehin nicht mehr aus) und wird unveraendert uebernommen.
 */
export function freezePrintOptionsJson(global: PrintSettingsInput, existingOverrideJson: string | null | undefined): string {
  let override: PrintOptionsOverride = {};
  if (existingOverrideJson) {
    try {
      const parsed = printOptionsOverrideSchema.safeParse(JSON.parse(existingOverrideJson));
      if (parsed.success) override = parsed.data;
    } catch {
      override = {};
    }
  }
  const isComplete = PRINT_OPTION_KEYS.every((key) => key in override);
  if (isComplete) return existingOverrideJson as string;
  const merged: PrintSettingsInput = { ...global, ...override };
  return JSON.stringify(merged);
}

type PrintOptionsDocKind = "INVOICE" | "QUOTE" | "DELIVERY_NOTE";

interface SetPrintOptionsTarget {
  kind: PrintOptionsDocKind;
  id: string;
}

/**
 * Setzt die Beleg-individuelle Druckoptionen-Ueberschreibung. Nur erlaubt, solange der
 * Beleg im Entwurf ist (status DRAFT). S8 (Fix-Welle, Final-Review): dieser Schreibzugriff
 * laeuft ueber `dbInternal` (den UNGEGUARDETEN Client, src/lib/db.ts) — der GoBD-Guard
 * (guardInvoiceWhere) greift hier NICHT. Der einzige Schutz vor einer Aenderung an einer
 * festgeschriebenen Invoice/Quote/DeliveryNote ist die explizite `status !== "DRAFT"`-
 * Pruefung unten.
 */
export async function setPrintOptions(orgId: string, target: SetPrintOptionsTarget, rawInput: unknown): Promise<PrintOptionsOverride> {
  const override = printOptionsOverrideSchema.parse(rawInput);
  const printOptionsJson = JSON.stringify(override);

  if (target.kind === "INVOICE") {
    const invoice = await dbInternal.invoice.findFirst({ where: { id: target.id, orgId }, select: { id: true, status: true } });
    if (!invoice) throw new NotFoundError(`Rechnung "${target.id}" nicht gefunden.`);
    if (invoice.status !== "DRAFT") {
      throw new InvalidOperationError("Druckoptionen koennen nur bei einer Rechnung im Entwurf (DRAFT) geaendert werden.");
    }
    await dbInternal.invoice.update({ where: { id: target.id }, data: { printOptionsJson } });
  } else if (target.kind === "QUOTE") {
    const quote = await dbInternal.quote.findFirst({ where: { id: target.id, orgId }, select: { id: true, status: true } });
    if (!quote) throw new NotFoundError(`Angebot "${target.id}" nicht gefunden.`);
    if (quote.status !== "DRAFT") {
      throw new InvalidOperationError("Druckoptionen koennen nur bei einem Angebot im Entwurf (DRAFT) geaendert werden.");
    }
    await dbInternal.quote.update({ where: { id: target.id }, data: { printOptionsJson } });
  } else {
    const deliveryNote = await dbInternal.deliveryNote.findFirst({ where: { id: target.id, orgId }, select: { id: true, status: true } });
    if (!deliveryNote) throw new NotFoundError(`Lieferschein "${target.id}" nicht gefunden.`);
    if (deliveryNote.status !== "DRAFT") {
      throw new InvalidOperationError("Druckoptionen koennen nur bei einem Lieferschein im Entwurf (DRAFT) geaendert werden.");
    }
    await dbInternal.deliveryNote.update({ where: { id: target.id }, data: { printOptionsJson } });
  }

  return override;
}
