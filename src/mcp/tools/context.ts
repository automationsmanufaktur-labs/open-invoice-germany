/**
 * OpenInvoice Germany — geteilter Kontext für die MCP-Tool-Module.
 *
 * Phase 9 / Task 1 (reiner Move aus server.ts): jedes Tool-Modul unter
 * src/mcp/tools/*.ts registriert seinen Bereich über `register<Bereich>Tools(server, ctx)`.
 * `ctx` traegt die orgId-Aufloesung, die ok/fail-Antworthelfer, die Positions-Builder und
 * einen optional injizierbaren MailProvider (fuer Tests von send_email — Facts Task 1).
 * Keine Bypass-Pfade: dieselbe Aufloese-/Validierungslogik wie vor dem Split, nur verschoben.
 */
import { z } from "zod";
import { dbInternal } from "@/lib/db";
import { getActiveOrg } from "@/lib/org";
import { roundHalfUp } from "@/lib/money";
import type { AttachmentDocType } from "@/domain/attachment/manage";
import type { MailProvider } from "@/lib/mail/provider";

export type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

export const ok = (text: string): Result => ({ content: [{ type: "text", text }] });
export const fail = (text: string): Result => ({ content: [{ type: "text", text }], isError: true });

/** Erwartete, absichtlich mit lesbarem deutschem Text geworfene Fehler aus den resolve*-
 *  Helfern/buildSimpleLines/buildEditorLines & Co. — deren Text darf dem Aufrufer angezeigt
 *  werden (Fix-Welle Punkt 6: "Domain-Fehlerklassen behalten ihren Text"). */
export class ToolError extends Error {}

/** Fix-Welle Punkt 6: Unbekannte (nicht als Domain-/ToolError erkannte) Fehler NIE mit
 *  Rohtext an den MCP-Client durchreichen (koennten Prisma-/Interna enthalten) — nur
 *  geloggt, generische Antwort. */
export function failUnknown(e: unknown): Result {
  console.error("[mcp] Unerwarteter Fehler:", e instanceof Error ? (e.stack ?? e.message) : e);
  return fail("Unerwarteter Fehler — Details im Serverlog.");
}

export const euroToCents = (e: number) => roundHalfUp(e * 100);
export const qtyToMilli = (q: number) => roundHalfUp(q * 1000);

export function parseDateInput(s?: string): Date | undefined {
  if (!s) return undefined;
  const t = s.trim().toLowerCase();
  if (t === "heute" || t === "today") return new Date();
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export async function requireOrg() {
  return getActiveOrg(); // wirft, wenn kein Unternehmen eingerichtet
}

export async function resolveCustomer(orgId: string, ref: string) {
  const byId = await dbInternal.customer.findFirst({ where: { id: ref, orgId } });
  if (byId) return byId;
  const all = await dbInternal.customer.findMany({ where: { orgId, isArchived: false } });
  const lower = ref.trim().toLowerCase();
  const exact = all.filter((c) => c.name.toLowerCase() === lower);
  if (exact.length === 1) return exact[0];
  const contains = all.filter((c) => c.name.toLowerCase().includes(lower));
  if (contains.length === 1) return contains[0];
  if (contains.length > 1)
    throw new ToolError(`Mehrere Kunden passen zu "${ref}": ${contains.map((c) => c.name).join(", ")}. Bitte präzisieren.`);
  throw new ToolError(`Kein Kunde "${ref}" gefunden. Lege ihn zuerst mit upsert_customer an (Name + Anschrift).`);
}

export async function resolvePaymentMethod(orgId: string, ref: string) {
  const byCode = await dbInternal.paymentMethod.findFirst({ where: { orgId, code: ref.trim().toUpperCase() } });
  if (byCode) return byCode;
  const all = await dbInternal.paymentMethod.findMany({ where: { orgId } });
  const lower = ref.trim().toLowerCase();
  const match = all.find((m) => m.name.toLowerCase() === lower);
  if (match) return match;
  throw new ToolError(`Keine Zahlungsmethode "${ref}" gefunden. Mit list_payment_methods die verfügbaren Codes/Namen anzeigen.`);
}

export async function resolveInvoice(orgId: string, ref: string) {
  const inv = await dbInternal.invoice.findFirst({ where: { orgId, OR: [{ id: ref }, { number: ref }] } });
  if (!inv) throw new ToolError(`Keine Rechnung "${ref}" gefunden (weder als ID noch als Nummer).`);
  return inv;
}

export async function resolveDunning(orgId: string, ref: string) {
  // Nit (Fix-Welle): explizites select statt vollem Row-Load — der einzige Aufrufer
  // (send_dunning) braucht nur id/number.
  const d = await dbInternal.dunning.findFirst({
    where: { invoice: { orgId }, OR: [{ id: ref }, { number: ref }] },
    select: { id: true, number: true },
  });
  if (!d) throw new ToolError(`Keine Mahnung "${ref}" gefunden (weder als ID noch als Nummer).`);
  return d;
}

export async function resolveDocument(orgId: string, ref: string) {
  const q = await dbInternal.quote.findFirst({ where: { orgId, OR: [{ id: ref }, { number: ref }] } });
  if (!q) throw new ToolError(`Kein Dokument "${ref}" gefunden.`);
  return q;
}

export async function resolveDeliveryNote(orgId: string, ref: string) {
  const n = await dbInternal.deliveryNote.findFirst({ where: { orgId, OR: [{ id: ref }, { number: ref }] } });
  if (!n) throw new ToolError(`Kein Lieferschein "${ref}" gefunden.`);
  return n;
}

/** Fix-Welle Punkt 1: exakter Titel/ID zuerst, bei mehreren Substring-Treffern wirft sie
 *  mit Kandidatenliste (analog resolveCustomer) statt stillschweigend den ersten Treffer
 *  zu nehmen — bisher inline (und uneinheitlich) in run_recurring/set_recurring_state. */
export async function resolveRecurring(orgId: string, ref: string) {
  const byId = await dbInternal.recurringInvoice.findFirst({ where: { id: ref, orgId } });
  if (byId) return byId;
  const all = await dbInternal.recurringInvoice.findMany({ where: { orgId } });
  const lower = ref.trim().toLowerCase();
  const exact = all.filter((r) => r.title.toLowerCase() === lower);
  if (exact.length === 1) return exact[0];
  const contains = all.filter((r) => r.title.toLowerCase().includes(lower));
  if (contains.length === 1) return contains[0];
  if (contains.length > 1)
    throw new ToolError(`Mehrere Abos passen zu "${ref}": ${contains.map((r) => r.title).join(", ")}. Bitte präzisieren.`);
  throw new ToolError(`Kein Abo "${ref}" gefunden.`);
}

/** Loest einen Belegverweis (Nummer oder ID) fuer Beleganhaenge ueber alle DocRefType
 *  hinweg auf — dieselbe Auflosung wie die uebrigen resolve*-Helfer, nur docType-generisch. */
export async function resolveDocForAttachment(orgId: string, docType: AttachmentDocType, ref: string): Promise<{ id: string }> {
  switch (docType) {
    case "INVOICE":
      return resolveInvoice(orgId, ref);
    case "QUOTE":
      return resolveDocument(orgId, ref);
    case "DELIVERY_NOTE":
      return resolveDeliveryNote(orgId, ref);
    case "RECURRING": {
      const r = await dbInternal.recurringInvoice.findFirst({ where: { orgId, OR: [{ id: ref }, { title: ref }] } });
      if (!r) throw new ToolError(`Kein Abo "${ref}" gefunden.`);
      return r;
    }
    case "DUNNING": {
      const d = await dbInternal.dunning.findFirst({ where: { id: ref, invoice: { orgId } } });
      if (!d) throw new ToolError(`Keine Mahnung "${ref}" gefunden.`);
      return d;
    }
  }
}

/** Wandelt MCP-Positionen (mit €/Menge oder Katalog-Verweis) in DB-Positionen um (Schema REGULAR, Kategorie S). Exportiert für Unit-Tests. */
export async function buildSimpleLines(
  orgId: string,
  inputLines: {
    description: string;
    quantity: number;
    unitPriceEuro?: number;
    productName?: string;
    unit?: string;
    taxRatePercent?: number;
    discountPercent?: number;
    discountAmount?: number;
  }[],
) {
  const products = await dbInternal.product.findMany({ where: { orgId, isArchived: false } });
  return inputLines.map((l, idx) => {
    let unitPriceEuro = l.unitPriceEuro;
    let unit = l.unit;
    let taxRate = l.taxRatePercent;
    let description = l.description;
    if (unitPriceEuro == null && l.productName) {
      const p = products.find((x) => x.name.toLowerCase() === l.productName!.toLowerCase());
      if (!p) throw new ToolError(`Produkt "${l.productName}" (Position ${idx + 1}) nicht gefunden.`);
      unitPriceEuro = p.netPriceCents / 100;
      unit = unit ?? p.unit;
      taxRate = taxRate ?? p.taxRate;
      description = description || p.name;
    }
    if (unitPriceEuro == null) throw new ToolError(`Position ${idx + 1} braucht unitPriceEuro oder productName.`);
    return {
      description,
      quantityMilli: qtyToMilli(l.quantity),
      unit: unit ?? "C62",
      unitNetPriceCents: euroToCents(unitPriceEuro),
      taxRate: taxRate ?? 19,
      taxCategory: "S",
      discountPermille: l.discountPercent ? Math.round(l.discountPercent * 10) : 0,
      discountCents: l.discountAmount ? euroToCents(l.discountAmount) : 0,
    };
  });
}

/** Wie buildSimpleLines, aber mit lineType (Phase 4b, §8): HEADING/TEXT/SUBTOTAL tragen
 *  nie einen Betrag und brauchen weder Menge noch Preis. Fuer update_invoice_draft. */
export async function buildEditorLines(
  orgId: string,
  inputLines: {
    lineType?: "ITEM" | "HEADING" | "TEXT" | "SUBTOTAL";
    description: string;
    descriptionLong?: string;
    articleNumber?: string;
    quantity?: number;
    unitPriceEuro?: number;
    productName?: string;
    unit?: string;
    taxRatePercent?: number;
    discountPercent?: number;
    discountAmount?: number;
  }[],
) {
  const products = await dbInternal.product.findMany({ where: { orgId, isArchived: false } });
  return inputLines.map((l, idx) => {
    const lineType = l.lineType ?? "ITEM";
    if (lineType !== "ITEM") {
      return {
        lineType,
        description: l.description,
        descriptionLong: l.descriptionLong,
        articleNumber: l.articleNumber,
        quantityMilli: 0,
        unit: l.unit ?? "C62",
        unitNetPriceCents: 0,
        taxRate: 0,
        taxCategory: "S",
        discountPermille: 0,
        discountCents: 0,
      };
    }
    let unitPriceEuro = l.unitPriceEuro;
    let unit = l.unit;
    let taxRate = l.taxRatePercent;
    let description = l.description;
    if (unitPriceEuro == null && l.productName) {
      const p = products.find((x) => x.name.toLowerCase() === l.productName!.toLowerCase());
      if (!p) throw new ToolError(`Produkt "${l.productName}" (Position ${idx + 1}) nicht gefunden.`);
      unitPriceEuro = p.netPriceCents / 100;
      unit = unit ?? p.unit;
      taxRate = taxRate ?? p.taxRate;
      description = description || p.name;
    }
    if (l.quantity == null) throw new ToolError(`Position ${idx + 1} (ITEM) braucht "quantity".`);
    if (unitPriceEuro == null) throw new ToolError(`Position ${idx + 1} braucht unitPriceEuro oder productName.`);
    return {
      lineType: "ITEM" as const,
      description,
      descriptionLong: l.descriptionLong,
      articleNumber: l.articleNumber,
      quantityMilli: qtyToMilli(l.quantity),
      unit: unit ?? "C62",
      unitNetPriceCents: euroToCents(unitPriceEuro),
      taxRate: taxRate ?? 19,
      taxCategory: "S",
      discountPermille: l.discountPercent ? Math.round(l.discountPercent * 10) : 0,
      discountCents: l.discountAmount ? euroToCents(l.discountAmount) : 0,
    };
  });
}

/** Von mehreren Tool-Bereichen (documents/invoices) genutztes Positions-Eingabeschema. */
export const docLineSchema = z.object({
  description: z.string(),
  quantity: z.number(),
  unitPriceEuro: z.number().optional(),
  productName: z.string().optional(),
  unit: z.string().optional(),
  taxRatePercent: z.union([z.literal(19), z.literal(7), z.literal(0)]).optional(),
  discountPercent: z.number().min(0).max(100).optional().describe("Positionsrabatt in Prozent"),
  discountAmount: z.number().min(0).optional().describe("Zusätzlicher Festbetragsrabatt je Position in Euro"),
});

/**
 * Kontext, den jedes register<Bereich>Tools(server, ctx) erhaelt: orgId-Aufloesung,
 * ok/fail-Antworthelfer, Positions-Builder — und optional (Tests) ein injizierbarer
 * MailProvider fuer send_email, damit Tests keinen echten SMTP/Mailcow brauchen.
 */
export interface McpToolsContext {
  ok: typeof ok;
  fail: typeof fail;
  failUnknown: typeof failUnknown;
  euroToCents: typeof euroToCents;
  qtyToMilli: typeof qtyToMilli;
  parseDateInput: typeof parseDateInput;
  requireOrg: typeof requireOrg;
  resolveCustomer: typeof resolveCustomer;
  resolvePaymentMethod: typeof resolvePaymentMethod;
  resolveInvoice: typeof resolveInvoice;
  resolveDunning: typeof resolveDunning;
  resolveDocument: typeof resolveDocument;
  resolveDeliveryNote: typeof resolveDeliveryNote;
  resolveRecurring: typeof resolveRecurring;
  resolveDocForAttachment: typeof resolveDocForAttachment;
  buildSimpleLines: typeof buildSimpleLines;
  buildEditorLines: typeof buildEditorLines;
  /** Testinjektion (Facts Task 1): sonst nutzt send_email den echten, aus Settings geladenen Provider. */
  mailProvider?: MailProvider;
}

/** Baut den Standard-Kontext (echte DB/Domain-Aufloesung, kein Test-Mail-Provider). */
export function createDefaultContext(overrides: Partial<McpToolsContext> = {}): McpToolsContext {
  return {
    ok,
    fail,
    failUnknown,
    euroToCents,
    qtyToMilli,
    parseDateInput,
    requireOrg,
    resolveCustomer,
    resolvePaymentMethod,
    resolveInvoice,
    resolveDunning,
    resolveDocument,
    resolveDeliveryNote,
    resolveRecurring,
    resolveDocForAttachment,
    buildSimpleLines,
    buildEditorLines,
    ...overrides,
  };
}
