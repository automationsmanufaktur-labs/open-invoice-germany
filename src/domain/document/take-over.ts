/**
 * "Letztes Dokument übernehmen" (Phase 8a, Task 2, §32) — rein lesende Vorbelegung fuer
 * eine NEUE Beleganlage aus dem letzten Beleg desselben Kunden. Anders als
 * `src/domain/document/duplicate.ts` legt dieses Modul NICHTS an: es liefert nur ein
 * Prefill-Objekt, das der Aufrufer (Route/MCP/Formular, Task 3) in ein normales
 * `createDraftInvoice`/`createBusinessDocument`-Payload einbaut. Keine Relation, kein
 * ChangeLog, keine DB-Schreibzugriffe — `internalNotes` wird hier nie gelesen (§48).
 */
import { dbInternal } from "@/lib/db";
import { NotFoundError } from "@/domain/errors";
import { logActivity, type ActivityEntityType } from "@/domain/activity/log";
import type { InvoiceLineInput } from "@/schemas";

export type TakeOverDocumentKind = "INVOICE" | "QUOTE" | "ORDER_CONFIRMATION";

export interface LastDocumentForCustomer {
  id: string;
  number: string;
  issueDate: Date;
  kind: TakeOverDocumentKind;
}

const QUOTE_KIND_FOR: Record<"QUOTE" | "ORDER_CONFIRMATION", string> = {
  QUOTE: "ANGEBOT",
  ORDER_CONFIRMATION: "AUFTRAGSBESTAETIGUNG",
};

/**
 * Letzter festgeschriebener/versendeter Beleg eines Kunden fuer `kind` — Entwuerfe
 * (status DRAFT) werden ignoriert, `null` wenn keiner existiert. Org- UND
 * kundengeprueft. Sortiert nach `issueDate` absteigend (bei Gleichstand `createdAt`
 * absteigend als deterministischer Tie-Breaker).
 */
export async function findLastDocumentForCustomer(
  orgId: string,
  customerId: string,
  kind: TakeOverDocumentKind,
): Promise<LastDocumentForCustomer | null> {
  if (kind === "INVOICE") {
    const inv = await dbInternal.invoice.findFirst({
      where: { orgId, customerId, status: { not: "DRAFT" }, number: { not: null } },
      orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
      select: { id: true, number: true, issueDate: true },
    });
    if (!inv || !inv.number) return null;
    return { id: inv.id, number: inv.number, issueDate: inv.issueDate, kind: "INVOICE" };
  }

  const q = await dbInternal.quote.findFirst({
    where: { orgId, customerId, kind: QUOTE_KIND_FOR[kind], status: { not: "DRAFT" }, number: { not: null } },
    orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
    select: { id: true, number: true, issueDate: true },
  });
  if (!q || !q.number) return null;
  return { id: q.id, number: q.number, issueDate: q.issueDate, kind };
}

export interface TakeOverOptions {
  lines: boolean;
  texts: boolean;
  terms: boolean;
  prices: boolean;
}

export interface TakeOverPrefill {
  lines?: InvoiceLineInput[];
  headerText?: string | null;
  footerText?: string | null;
  paymentTerms?: string | null;
  deliveryTerms?: string | null;
  documentDiscount?: { permille: number; cents: number };
}

function toLineInput(l: {
  lineType: string;
  productId?: string | null;
  description: string;
  descriptionLong: string | null;
  articleNumber: string | null;
  quantityMilli: number;
  unit: string;
  unitNetPriceCents: number;
  taxRate: number;
  taxCategory: string;
  discountPermille: number;
  discountCents: number;
}, prices: boolean): InvoiceLineInput {
  return {
    lineType: l.lineType as InvoiceLineInput["lineType"],
    productId: l.productId ?? undefined,
    description: l.description,
    descriptionLong: l.descriptionLong ?? undefined,
    articleNumber: l.articleNumber ?? undefined,
    quantityMilli: l.quantityMilli,
    unit: l.unit,
    // bei prices=false: nur die Gliederung (Positionen/Mengen/Text) wird uebernommen,
    // NICHT die Preise/Rabatte der Quelle (Task-2-Facts) — Menge-0-Workaround ist hier
    // nicht relevant, das gilt nur fuer HEADING/TEXT/SUBTOTAL (unveraendert 0).
    unitNetPriceCents: l.lineType === "ITEM" && !prices ? 0 : l.unitNetPriceCents,
    taxRate: l.taxRate as InvoiceLineInput["taxRate"],
    taxCategory: l.taxCategory as InvoiceLineInput["taxCategory"],
    discountPermille: l.lineType === "ITEM" && !prices ? 0 : l.discountPermille,
    discountCents: l.lineType === "ITEM" && !prices ? 0 : l.discountCents,
  };
}

/**
 * Baut das Prefill-Objekt aus einem bestehenden Beleg (Invoice ODER Quote — `docId`
 * traegt keinen expliziten Typ, siehe Modulkommentar; Invoice wird zuerst versucht).
 * Rein lesend: KEINE Relation, KEIN ChangeLog, KEIN Schreibzugriff. `internalNotes`
 * wird nie gelesen (§48). Wirft `NotFoundError`, wenn `docId` zu keinem Beleg der
 * Organisation gehoert (auch bei fremder Org).
 */
export async function buildTakeOverPrefill(orgId: string, docId: string, opts: TakeOverOptions, actor = "system"): Promise<TakeOverPrefill> {
  const invoice = await dbInternal.invoice.findFirst({
    where: { id: docId, orgId },
    include: { lines: { orderBy: { position: "asc" } } },
  });

  const result: TakeOverPrefill = {};
  let entityType: ActivityEntityType | null = null;

  if (invoice) {
    entityType = "INVOICE";
    if (opts.lines) result.lines = invoice.lines.map((l) => toLineInput(l, opts.prices));
    if (opts.texts) {
      result.headerText = invoice.headerText;
      result.footerText = invoice.footerText;
    }
    if (opts.terms) {
      result.paymentTerms = invoice.paymentTerms;
      // Invoice kennt kein eigenes deliveryTerms-Feld (nur Quote) — bleibt unbelegt.
    }
    if (opts.prices) {
      result.documentDiscount = { permille: invoice.documentDiscountPermille, cents: invoice.documentDiscountCents };
    }
  } else {
    const quote = await dbInternal.quote.findFirst({
      where: { id: docId, orgId },
      include: { lines: { orderBy: { position: "asc" } } },
    });
    if (!quote) throw new NotFoundError(`Beleg ${docId} nicht gefunden.`);
    entityType = "QUOTE";

    if (opts.lines) result.lines = quote.lines.map((l) => toLineInput(l, opts.prices));
    if (opts.texts) {
      result.headerText = quote.headerText;
      result.footerText = quote.footerText;
    }
    if (opts.terms) {
      result.paymentTerms = quote.paymentTerms;
      result.deliveryTerms = quote.deliveryTerms;
    }
    if (opts.prices) {
      result.documentDiscount = { permille: quote.documentDiscountPermille, cents: quote.documentDiscountCents };
    }
  }

  // TAKEN_OVER (Phase 8a, §32): rein informativ — diese Funktion selbst legt nichts an
  // (Modulkommentar), der Aufrufer baut daraus erst spaeter einen neuen Beleg. Der
  // Aktivitaetseintrag haengt trotzdem am QUELLBELEG, damit dessen Verlauf zeigt, dass er
  // als Vorlage diente. `logActivity` wirft nie — dieser rein lesende Pfad bleibt so
  // unveraendert auch bei einem DB-Fehler beim Protokollieren.
  await logActivity(dbInternal, { orgId, entityType, entityId: docId, type: "TAKEN_OVER", actor });

  return result;
}
