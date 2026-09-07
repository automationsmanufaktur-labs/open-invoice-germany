#!/usr/bin/env node
/**
 * OpenInvoice Germany — MCP-Server.
 *
 * Macht die Rechnungssoftware per natürlicher Sprache steuerbar (Claude Code /
 * Claude Desktop). Die Tools setzen auf den GoBD-/EN-16931-gehärteten Domain-Kern
 * auf — das Festschreiben erzwingt die § 14-Pflichtangaben, festgeschriebene
 * Rechnungen sind unveränderbar. Keine Cloud, alles lokal.
 *
 * Start: npm run mcp   (oder via Claude-Code-MCP-Konfiguration, siehe README)
 */
import "./bootstrap";
import { PROJECT_ROOT } from "./bootstrap";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { dbInternal } from "@/lib/db";
import { getActiveOrg } from "@/lib/org";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { roundHalfUp, formatCents } from "@/lib/money";
import { defaultCategoryForScheme } from "@/lib/tax";
import { SCHEME_NOTICE } from "@/domain/invoice/mandatory";
import { createDraftInvoice } from "@/domain/invoice/create";
import { finalizeInvoice, FinalizeError } from "@/domain/invoice/finalize";
import { cancelInvoice, CancelError } from "@/domain/invoice/cancel";
import { createPartialCreditNote, CreditError } from "@/domain/invoice/credit";
import { recordPayment, PaymentError } from "@/domain/invoice/payment";
import { listPaymentMethods } from "@/domain/payment-method/manage";
import { createDunning, DunningError } from "@/domain/dunning/create";
import { sendDunning } from "@/domain/dunning/send";
import { setDunningState } from "@/domain/dunning/state";
import { loadDunningOverview } from "@/domain/dunning/overview";
import { runScheduledJobs, type SchedulerJob } from "@/domain/scheduler/runner";
import { MailNotConfiguredError } from "@/domain/email/settings";
import { createRecurring, RecurringError } from "@/domain/recurring/create";
import { emitRecurringNow, runDueRecurring } from "@/domain/recurring/run";
import { intervalLabel } from "@/lib/recurring";
import { createBusinessDocument } from "@/domain/document/create";
import { convertDocument, ConvertError } from "@/domain/document/convert";
import { createDeliveryNote, DeliveryNoteError } from "@/domain/delivery-note/create";
import { setQuoteStatus, setDeliveryNoteStatus, setArchived, StatusTransitionError } from "@/domain/document/status";
import { createShareLink, revokeShareLink, listShareLinks, ShareLinkError } from "@/domain/quote-share/link";
import { saveDocumentSettings } from "@/domain/document/settings";
import { SecretsUnavailableError } from "@/lib/crypto/secrets";
import { appBaseUrlFromEnv } from "@/lib/http/base-url";
import { duplicateDocument, type DuplicatableType } from "@/domain/document/duplicate";
import { createPartialInvoice, PartialInvoiceError } from "@/domain/invoice/partial";
import { createDownpaymentInvoice, DownpaymentInvoiceError } from "@/domain/invoice/downpayment";
import { createFinalInvoice, FinalInvoiceError } from "@/domain/invoice/final";
import { billingStateFor } from "@/domain/document/billing-state";
import { PricingError } from "@/lib/pricing/errors";
import { loadEInvoiceData } from "@/lib/einvoice/load";
import { buildXRechnungUBL } from "@/lib/einvoice/xrechnung";
import { renderZugferdPdf } from "@/lib/einvoice/zugferd";
import { validateXRechnung } from "@/lib/einvoice/en16931-core";
import { renderInvoicePdf } from "@/lib/pdf/invoice-pdf";
import {
  organizationSchema,
  customerSchema,
  createInvoiceSchema,
  createDocumentSchema,
  recordPaymentSchema,
  createRecurringSchema,
  createDeliveryNoteSchema,
  createPartialInvoiceSchema,
  createDownpaymentInvoiceSchema,
  createFinalInvoiceSchema,
  documentStatusActionSchema,
  convertDocumentBodySchema,
  documentSettingsInputSchema,
  OnQuoteAccept,
  TaxScheme,
  PaymentMethod,
  DocRefType,
  LineType,
} from "@/schemas";
import { NotFoundError } from "@/domain/errors";
import { updateDraftInvoice, InvoiceUpdateError } from "@/domain/invoice/update";
import { addAttachment, removeAttachment, listAttachments, type AttachmentDocType } from "@/domain/attachment/manage";
import { AttachmentValidationError } from "@/lib/attachments/storage";
import { MAX_ATTACHMENT_FILE_BYTES } from "@/lib/attachments/mime";

// ── Helfer ────────────────────────────────────────────────────────────────
type Result = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (text: string): Result => ({ content: [{ type: "text", text }] });
const fail = (text: string): Result => ({ content: [{ type: "text", text }], isError: true });

const euroToCents = (e: number) => roundHalfUp(e * 100);
const qtyToMilli = (q: number) => roundHalfUp(q * 1000);

function parseDateInput(s?: string): Date | undefined {
  if (!s) return undefined;
  const t = s.trim().toLowerCase();
  if (t === "heute" || t === "today") return new Date();
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

async function requireOrg() {
  return getActiveOrg(); // wirft, wenn kein Unternehmen eingerichtet
}

async function resolveCustomer(orgId: string, ref: string) {
  const byId = await dbInternal.customer.findFirst({ where: { id: ref, orgId } });
  if (byId) return byId;
  const all = await dbInternal.customer.findMany({ where: { orgId, isArchived: false } });
  const lower = ref.trim().toLowerCase();
  const exact = all.filter((c) => c.name.toLowerCase() === lower);
  if (exact.length === 1) return exact[0];
  const contains = all.filter((c) => c.name.toLowerCase().includes(lower));
  if (contains.length === 1) return contains[0];
  if (contains.length > 1)
    throw new Error(`Mehrere Kunden passen zu "${ref}": ${contains.map((c) => c.name).join(", ")}. Bitte präzisieren.`);
  throw new Error(`Kein Kunde "${ref}" gefunden. Lege ihn zuerst mit upsert_customer an (Name + Anschrift).`);
}

async function resolvePaymentMethod(orgId: string, ref: string) {
  const byCode = await dbInternal.paymentMethod.findFirst({ where: { orgId, code: ref.trim().toUpperCase() } });
  if (byCode) return byCode;
  const all = await dbInternal.paymentMethod.findMany({ where: { orgId } });
  const lower = ref.trim().toLowerCase();
  const match = all.find((m) => m.name.toLowerCase() === lower);
  if (match) return match;
  throw new Error(`Keine Zahlungsmethode "${ref}" gefunden. Mit list_payment_methods die verfügbaren Codes/Namen anzeigen.`);
}

async function resolveInvoice(orgId: string, ref: string) {
  const inv = await dbInternal.invoice.findFirst({ where: { orgId, OR: [{ id: ref }, { number: ref }] } });
  if (!inv) throw new Error(`Keine Rechnung "${ref}" gefunden (weder als ID noch als Nummer).`);
  return inv;
}

async function resolveDunning(orgId: string, ref: string) {
  // Nit (Fix-Welle): explizites select statt vollem Row-Load — der einzige Aufrufer
  // (send_dunning) braucht nur id/number.
  const d = await dbInternal.dunning.findFirst({
    where: { invoice: { orgId }, OR: [{ id: ref }, { number: ref }] },
    select: { id: true, number: true },
  });
  if (!d) throw new Error(`Keine Mahnung "${ref}" gefunden (weder als ID noch als Nummer).`);
  return d;
}

async function resolveDocument(orgId: string, ref: string) {
  const q = await dbInternal.quote.findFirst({ where: { orgId, OR: [{ id: ref }, { number: ref }] } });
  if (!q) throw new Error(`Kein Dokument "${ref}" gefunden.`);
  return q;
}

async function resolveDeliveryNote(orgId: string, ref: string) {
  const n = await dbInternal.deliveryNote.findFirst({ where: { orgId, OR: [{ id: ref }, { number: ref }] } });
  if (!n) throw new Error(`Kein Lieferschein "${ref}" gefunden.`);
  return n;
}

/** Loest einen Belegverweis (Nummer oder ID) fuer Beleganhaenge ueber alle DocRefType
 *  hinweg auf — dieselbe Auflosung wie die uebrigen resolve*-Helfer, nur docType-generisch. */
async function resolveDocForAttachment(orgId: string, docType: AttachmentDocType, ref: string): Promise<{ id: string }> {
  switch (docType) {
    case "INVOICE":
      return resolveInvoice(orgId, ref);
    case "QUOTE":
      return resolveDocument(orgId, ref);
    case "DELIVERY_NOTE":
      return resolveDeliveryNote(orgId, ref);
    case "RECURRING": {
      const r = await dbInternal.recurringInvoice.findFirst({ where: { orgId, OR: [{ id: ref }, { title: ref }] } });
      if (!r) throw new Error(`Kein Abo "${ref}" gefunden.`);
      return r;
    }
    case "DUNNING": {
      const d = await dbInternal.dunning.findFirst({ where: { id: ref, invoice: { orgId } } });
      if (!d) throw new Error(`Keine Mahnung "${ref}" gefunden.`);
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
      if (!p) throw new Error(`Produkt "${l.productName}" (Position ${idx + 1}) nicht gefunden.`);
      unitPriceEuro = p.netPriceCents / 100;
      unit = unit ?? p.unit;
      taxRate = taxRate ?? p.taxRate;
      description = description || p.name;
    }
    if (unitPriceEuro == null) throw new Error(`Position ${idx + 1} braucht unitPriceEuro oder productName.`);
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
async function buildEditorLines(
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
      if (!p) throw new Error(`Produkt "${l.productName}" (Position ${idx + 1}) nicht gefunden.`);
      unitPriceEuro = p.netPriceCents / 100;
      unit = unit ?? p.unit;
      taxRate = taxRate ?? p.taxRate;
      description = description || p.name;
    }
    if (l.quantity == null) throw new Error(`Position ${idx + 1} (ITEM) braucht "quantity".`);
    if (unitPriceEuro == null) throw new Error(`Position ${idx + 1} braucht unitPriceEuro oder productName.`);
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

// Exportiert fuer Integrationstests (test/integration/mcp-server.test.ts): erlaubt,
// registrierte Tool-Handler direkt aufzurufen, ohne einen Stdio-Transport zu starten.
export const server = new McpServer({ name: "open-invoice-germany", version: "0.1.0" });

// ── get_status ──────────────────────────────────────────────────────────────
server.registerTool(
  "get_status",
  {
    title: "Status / Orientierung",
    description:
      "Zeigt, ob das eigene Unternehmen eingerichtet ist, und Zähler (Kunden, Produkte, Rechnungen). Immer ZUERST aufrufen, um den Zustand zu verstehen.",
    inputSchema: {},
  },
  async (): Promise<Result> => {
    const org = await dbInternal.organization.findFirst();
    const [customers, products, invoices, drafts] = await Promise.all([
      dbInternal.customer.count({ where: { isArchived: false } }),
      dbInternal.product.count({ where: { isArchived: false } }),
      dbInternal.invoice.count(),
      dbInternal.invoice.count({ where: { status: "DRAFT" } }),
    ]);
    return ok(
      JSON.stringify(
        {
          companyConfigured: Boolean(org),
          company: org ? { legalName: org.legalName, taxId: org.vatId ?? org.taxNumber, scheme: org.defaultTaxScheme } : null,
          counts: { customers, products, invoices, drafts },
          hint: org ? "Bereit. Kunden/Produkte mit upsert_* anlegen, dann create_invoice." : "Zuerst setup_company aufrufen.",
        },
        null,
        2,
      ),
    );
  },
);

// ── setup_company ────────────────────────────────────────────────────────────
server.registerTool(
  "setup_company",
  {
    title: "Eigenes Unternehmen einrichten/ändern",
    description:
      "Legt die Absender-Stammdaten an oder aktualisiert sie (erscheinen als Pflichtangaben auf jeder Rechnung, § 14 UStG). Steuernummer ODER USt-IdNr. ist Pflicht.",
    inputSchema: {
      legalName: z.string().describe("Firmenname"),
      addressLine1: z.string().describe("Straße und Hausnummer"),
      postalCode: z.string(),
      city: z.string(),
      country: z.string().length(2).default("DE"),
      taxNumber: z.string().optional().describe("Steuernummer (alternativ zur USt-IdNr.)"),
      vatId: z.string().optional().describe("USt-IdNr., z. B. DE123456789"),
      email: z.string().optional(),
      phone: z.string().optional(),
      iban: z.string().optional(),
      bic: z.string().optional(),
      bankName: z.string().optional(),
      smallBusiness: z.boolean().default(false).describe("Kleinunternehmer nach § 19 UStG"),
      defaultTaxScheme: TaxScheme.default("REGULAR"),
    },
  },
  async (args): Promise<Result> => {
    try {
      const v = organizationSchema.parse({ ...args, email: args.email ?? "" });
      const data = {
        legalName: v.legalName,
        addressLine1: v.addressLine1,
        postalCode: v.postalCode,
        city: v.city,
        country: v.country,
        email: v.email || null,
        phone: v.phone ?? null,
        taxNumber: v.taxNumber ?? null,
        vatId: v.vatId ?? null,
        smallBusiness: v.smallBusiness,
        defaultTaxScheme: v.defaultTaxScheme,
        iban: v.iban ?? null,
        bic: v.bic ?? null,
        bankName: v.bankName ?? null,
        electronicAddress: v.email || null,
      };
      const existing = await dbInternal.organization.findFirst();
      const org = existing
        ? await dbInternal.organization.update({ where: { id: existing.id }, data })
        : await dbInternal.organization.create({ data });
      // idempotent, deshalb unabhaengig von Create/Update sicher aufrufbar
      await ensureOrgMasterdata(dbInternal, org.id);
      return ok(`Unternehmen ${existing ? "aktualisiert" : "angelegt"}: ${org.legalName} (${org.id}).`);
    } catch (e) {
      return fail(`Konnte Unternehmen nicht speichern: ${(e as Error).message}`);
    }
  },
);

// ── list_customers ───────────────────────────────────────────────────────────
server.registerTool(
  "list_customers",
  {
    title: "Kunden auflisten",
    description: "Listet die Kunden (optional gefiltert nach Namensteil).",
    inputSchema: { query: z.string().optional().describe("Namensteil zum Filtern") },
  },
  async ({ query }): Promise<Result> => {
    const all = await dbInternal.customer.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } });
    const filtered = query ? all.filter((c) => c.name.toLowerCase().includes(query.toLowerCase())) : all;
    return ok(
      JSON.stringify(
        filtered.map((c) => ({ id: c.id, name: c.name, city: c.city, type: c.type, vatId: c.vatId })),
        null,
        2,
      ),
    );
  },
);

// ── upsert_customer ──────────────────────────────────────────────────────────
server.registerTool(
  "upsert_customer",
  {
    title: "Kunde anlegen/aktualisieren",
    description:
      "Legt einen Kunden an oder aktualisiert ihn (Match per exaktem Namen). Für rechtssichere Rechnungen sind Name + vollständige Anschrift nötig.",
    inputSchema: {
      name: z.string(),
      addressLine1: z.string(),
      postalCode: z.string(),
      city: z.string(),
      countryCode: z.string().length(2).default("DE"),
      type: z.enum(["BUSINESS", "CONSUMER"]).default("BUSINESS"),
      vatId: z.string().optional().describe("USt-IdNr. (Pflicht bei ig. Lieferung/Leistung)"),
      email: z.string().optional(),
      contactName: z.string().optional(),
      leitwegId: z.string().optional().describe("Leitweg-ID für Behörden (B2G)"),
      defaultPaymentTermsDays: z.number().int().min(0).max(365).default(14),
      defaultPaymentMethod: z.string().optional().describe("Name oder Code der Standard-Zahlungsmethode"),
      notes: z.string().optional(),
    },
  },
  async (args): Promise<Result> => {
    try {
      const org = await requireOrg();
      const v = customerSchema.parse({ ...args, email: args.email ?? "" });
      const defaultPaymentMethod = args.defaultPaymentMethod ? await resolvePaymentMethod(org.id, args.defaultPaymentMethod) : null;
      const data = {
        type: v.type,
        name: v.name,
        contactName: v.contactName ?? null,
        addressLine1: v.addressLine1,
        postalCode: v.postalCode,
        city: v.city,
        countryCode: v.countryCode,
        email: v.email || null,
        vatId: v.vatId ?? null,
        leitwegId: v.leitwegId ?? null,
        defaultPaymentTermsDays: v.defaultPaymentTermsDays,
        defaultPaymentMethodId: defaultPaymentMethod?.id,
        notes: v.notes ?? null,
      };
      const existing = (await dbInternal.customer.findMany({ where: { orgId: org.id, isArchived: false } })).find(
        (c) => c.name.toLowerCase() === v.name.toLowerCase(),
      );
      const customer = existing
        ? await dbInternal.customer.update({ where: { id: existing.id }, data })
        : await dbInternal.customer.create({ data: { ...data, orgId: org.id } });
      return ok(`Kunde ${existing ? "aktualisiert" : "angelegt"}: ${customer.name} (${customer.id}).`);
    } catch (e) {
      return fail(`Konnte Kunde nicht speichern: ${(e as Error).message}`);
    }
  },
);

// ── list_products ────────────────────────────────────────────────────────────
server.registerTool(
  "list_products",
  {
    title: "Produkte/Leistungen auflisten",
    description: "Listet den Katalog der gespeicherten Produkte/Leistungen.",
    inputSchema: { query: z.string().optional() },
  },
  async ({ query }): Promise<Result> => {
    const all = await dbInternal.product.findMany({ where: { isArchived: false }, orderBy: { name: "asc" } });
    const filtered = query ? all.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())) : all;
    return ok(
      JSON.stringify(
        filtered.map((p) => ({ id: p.id, name: p.name, unit: p.unit, netPrice: formatCents(p.netPriceCents), taxRate: p.taxRate })),
        null,
        2,
      ),
    );
  },
);

// ── upsert_product ───────────────────────────────────────────────────────────
server.registerTool(
  "upsert_product",
  {
    title: "Produkt/Leistung speichern",
    description: "Speichert eine wiederkehrende Leistung/ein Produkt im Katalog (Match per exaktem Namen).",
    inputSchema: {
      name: z.string(),
      netPriceEuro: z.number().describe("Nettopreis in Euro, z. B. 95 oder 95.50"),
      unit: z.string().default("C62").describe("Einheit (UN/ECE): C62=Stück, HUR=Stunde, DAY=Tag, KGM=kg, MTR=m"),
      taxRatePercent: z.union([z.literal(19), z.literal(7), z.literal(0)]).default(19),
      description: z.string().optional(),
      articleNumber: z.string().max(60).optional().describe("Artikelnummer, wird als Snapshot in Positionen uebernommen"),
    },
  },
  async (args): Promise<Result> => {
    try {
      const org = await requireOrg();
      const data = {
        name: args.name,
        description: args.description ?? null,
        articleNumber: args.articleNumber ?? null,
        unit: args.unit,
        netPriceCents: euroToCents(args.netPriceEuro),
        taxRate: args.taxRatePercent,
        taxCategory: args.taxRatePercent === 0 ? "Z" : "S",
      };
      const existing = (await dbInternal.product.findMany({ where: { orgId: org.id, isArchived: false } })).find(
        (p) => p.name.toLowerCase() === args.name.toLowerCase(),
      );
      const product = existing
        ? await dbInternal.product.update({ where: { id: existing.id }, data })
        : await dbInternal.product.create({ data: { ...data, orgId: org.id } });
      return ok(`Produkt ${existing ? "aktualisiert" : "gespeichert"}: ${product.name} — ${formatCents(product.netPriceCents)} / ${product.unit}.`);
    } catch (e) {
      return fail(`Konnte Produkt nicht speichern: ${(e as Error).message}`);
    }
  },
);

// ── create_invoice ───────────────────────────────────────────────────────────
server.registerTool(
  "create_invoice",
  {
    title: "Rechnung anlegen (Entwurf)",
    description:
      "Erstellt eine Rechnung als ENTWURF. Kunde per Name oder ID. Positionen mit Menge + Preis (oder Verweis auf eine gespeicherte Leistung via productName). Danach finalize_invoice zum Festschreiben.",
    inputSchema: {
      customer: z.string().describe("Kundenname oder Kunden-ID"),
      lines: z
        .array(
          z.object({
            description: z.string(),
            quantity: z.number().describe("Menge, z. B. 3 oder 2.5"),
            unitPriceEuro: z.number().optional().describe("Nettopreis je Einheit in Euro (oder productName nutzen)"),
            productName: z.string().optional().describe("Name einer gespeicherten Leistung — Preis/Einheit/Steuersatz werden übernommen"),
            unit: z.string().optional(),
            taxRatePercent: z.union([z.literal(19), z.literal(7), z.literal(0)]).optional(),
            discountPercent: z.number().min(0).max(100).optional(),
            discountAmount: z.number().min(0).optional().describe("Zusaetzlicher Festbetragsrabatt je Position in Euro"),
          }),
        )
        .min(1),
      taxScheme: TaxScheme.optional().describe("Default: Schema des Unternehmens (sonst REGULAR)"),
      deliveryDate: z.string().optional().describe("Leistungsdatum YYYY-MM-DD oder 'heute' (Pflicht für Festschreiben)"),
      dueDate: z.string().optional(),
      notes: z.string().optional(),
      paymentTerms: z.string().optional(),
      documentDiscountPercent: z.number().min(0).max(100).optional().describe("Belegrabatt in Prozent (auf alle Steuersaetze proportional verteilt)"),
      documentDiscountEuro: z.number().min(0).optional().describe("Zusaetzlicher Belegrabatt als Festbetrag in Euro"),
      documentChargePercent: z.number().min(0).max(100).optional().describe("Belegaufschlag in Prozent (nach Rabatt berechnet)"),
      documentChargeEuro: z.number().min(0).optional().describe("Zusaetzlicher Belegaufschlag als Festbetrag in Euro"),
      documentChargeReason: z.string().max(500).optional(),
      skonto1Percent: z.number().min(0).max(100).optional().describe("1. Skontosatz in Prozent"),
      skonto1Days: z.number().int().min(1).max(365).optional().describe("1. Skontofrist in Tagen"),
      skonto2Percent: z.number().min(0).max(100).optional().describe("2. Skontosatz in Prozent (nur zusammen mit Skonto 1, laengere Frist)"),
      skonto2Days: z.number().int().min(1).max(365).optional(),
      paymentMethod: z.string().optional().describe("Name oder Code einer Zahlungsmethode (Default: Kunden-Standard)"),
    },
  },
  async (args): Promise<Result> => {
    try {
      const org = await requireOrg();
      const customer = await resolveCustomer(org.id, args.customer);
      const scheme = args.taxScheme ?? org.defaultTaxScheme ?? "REGULAR";
      const isRegular = scheme === "REGULAR";
      const category = defaultCategoryForScheme(scheme);
      const products = await dbInternal.product.findMany({ where: { orgId: org.id, isArchived: false } });

      const lines = args.lines.map((l, idx) => {
        let unitPriceEuro = l.unitPriceEuro;
        let unit = l.unit;
        let taxRatePercent: number | undefined = l.taxRatePercent;
        let description = l.description;
        if (unitPriceEuro == null && l.productName) {
          const p = products.find((x) => x.name.toLowerCase() === l.productName!.toLowerCase());
          if (!p) throw new Error(`Produkt "${l.productName}" (Position ${idx + 1}) nicht gefunden.`);
          unitPriceEuro = p.netPriceCents / 100;
          unit = unit ?? p.unit;
          taxRatePercent = taxRatePercent ?? p.taxRate;
          description = description || p.name;
        }
        if (unitPriceEuro == null) throw new Error(`Position ${idx + 1} braucht unitPriceEuro oder productName.`);
        return {
          description,
          quantityMilli: qtyToMilli(l.quantity),
          unit: unit ?? "C62",
          unitNetPriceCents: euroToCents(unitPriceEuro),
          taxRate: isRegular ? (taxRatePercent ?? 19) : 0,
          taxCategory: category,
          discountPermille: l.discountPercent ? Math.round(l.discountPercent * 10) : 0,
          discountCents: l.discountAmount ? euroToCents(l.discountAmount) : 0,
        };
      });

      const notice = SCHEME_NOTICE[scheme];
      const notes = notice ? `${notice}${args.notes ? " — " + args.notes : ""}` : args.notes;
      const paymentMethod = args.paymentMethod ? await resolvePaymentMethod(org.id, args.paymentMethod) : null;

      const input = createInvoiceSchema.parse({
        customerId: customer.id,
        type: "INVOICE",
        taxScheme: scheme,
        currency: "EUR",
        deliveryDate: parseDateInput(args.deliveryDate),
        dueDate: parseDateInput(args.dueDate),
        notes,
        paymentTerms: args.paymentTerms,
        documentDiscountPermille: args.documentDiscountPercent ? Math.round(args.documentDiscountPercent * 10) : undefined,
        documentDiscountCents: args.documentDiscountEuro ? euroToCents(args.documentDiscountEuro) : undefined,
        documentChargePermille: args.documentChargePercent ? Math.round(args.documentChargePercent * 10) : undefined,
        documentChargeCents: args.documentChargeEuro ? euroToCents(args.documentChargeEuro) : undefined,
        documentChargeReason: args.documentChargeReason,
        skonto1Permille: args.skonto1Percent ? Math.round(args.skonto1Percent * 10) : undefined,
        skonto1Days: args.skonto1Days,
        skonto2Permille: args.skonto2Percent ? Math.round(args.skonto2Percent * 10) : undefined,
        skonto2Days: args.skonto2Days,
        paymentMethodId: paymentMethod?.id,
        lines,
      });
      const invoice = await createDraftInvoice(org.id, input);
      return ok(
        `Entwurf angelegt für ${customer.name}.\n` +
          `ID: ${invoice.id}\nNetto: ${formatCents(invoice.netTotalCents)} · USt: ${formatCents(invoice.taxTotalCents)} · Brutto: ${formatCents(invoice.grossTotalCents)}\n` +
          `Nächster Schritt: finalize_invoice (vergibt die Rechnungsnummer, macht GoBD-konform unveränderbar).`,
      );
    } catch (e) {
      return fail(`Konnte Rechnung nicht anlegen: ${(e as Error).message}`);
    }
  },
);

// ── finalize_invoice ─────────────────────────────────────────────────────────
server.registerTool(
  "finalize_invoice",
  {
    title: "Rechnung festschreiben",
    description:
      "Schreibt einen Entwurf fest: prüft die § 14-Pflichtangaben, vergibt die fortlaufende Rechnungsnummer und macht die Rechnung GoBD-konform unveränderbar. Bei fehlenden Pflichtangaben kommt eine klare Liste zurück.",
    inputSchema: { invoice: z.string().describe("Rechnungs-ID oder -Nummer") },
  },
  async ({ invoice }): Promise<Result> => {
    try {
      const org = await requireOrg();
      const inv = await resolveInvoice(org.id, invoice);
      const finalized = await finalizeInvoice(inv.id);
      return ok(`Festgeschrieben: ${finalized.number} · Brutto ${formatCents(finalized.grossTotalCents)}. Unveränderbar. Export mit export_invoice.`);
    } catch (e) {
      if (e instanceof FinalizeError) return fail(`Festschreiben nicht möglich:\n${e.message}`);
      return fail(`Fehler: ${(e as Error).message}`);
    }
  },
);

// ── cancel_invoice ───────────────────────────────────────────────────────────
server.registerTool(
  "cancel_invoice",
  {
    title: "Rechnung stornieren",
    description: "Storniert eine festgeschriebene Rechnung GoBD-konform: legt eine Storno-Gutschrift an, Original bleibt erhalten.",
    inputSchema: { invoice: z.string().describe("Rechnungs-ID oder -Nummer") },
  },
  async ({ invoice }): Promise<Result> => {
    try {
      const org = await requireOrg();
      const inv = await resolveInvoice(org.id, invoice);
      const res = await cancelInvoice(inv.id);
      return ok(`Storniert. Storno-Gutschrift ${res.creditNote.number} zu ${res.originalNumber} angelegt.`);
    } catch (e) {
      if (e instanceof CancelError) return fail(`Storno nicht möglich: ${e.message}`);
      return fail(`Fehler: ${(e as Error).message}`);
    }
  },
);

// ── get_invoice ──────────────────────────────────────────────────────────────
server.registerTool(
  "get_invoice",
  {
    title: "Rechnung anzeigen",
    description: "Zeigt Details einer Rechnung (Status, Nummer, Positionen, Summen).",
    inputSchema: { invoice: z.string().describe("Rechnungs-ID oder -Nummer") },
  },
  async ({ invoice }): Promise<Result> => {
    try {
      const org = await requireOrg();
      const ref = await resolveInvoice(org.id, invoice);
      const inv = await dbInternal.invoice.findUnique({
        where: { id: ref.id },
        include: { lines: { orderBy: { position: "asc" } }, customer: true },
      });
      if (!inv) return fail("Nicht gefunden.");
      return ok(
        JSON.stringify(
          {
            id: inv.id,
            number: inv.number,
            status: inv.status,
            type: inv.type,
            taxScheme: inv.taxScheme,
            customer: inv.customer.name,
            net: formatCents(inv.netTotalCents),
            tax: formatCents(inv.taxTotalCents),
            gross: formatCents(inv.grossTotalCents),
            lines: inv.lines.map((l) => ({ description: l.description, qty: l.quantityMilli / 1000, unit: l.unit, net: formatCents(l.lineNetCents) })),
          },
          null,
          2,
        ),
      );
    } catch (e) {
      return fail(`Fehler: ${(e as Error).message}`);
    }
  },
);

// ── list_invoices ────────────────────────────────────────────────────────────
server.registerTool(
  "list_invoices",
  {
    title: "Rechnungen auflisten",
    description: "Listet Rechnungen (optional nach Status: DRAFT, FINALIZED, PAID, CANCELLED …).",
    inputSchema: { status: z.string().optional() },
  },
  async ({ status }): Promise<Result> => {
    const org = await dbInternal.organization.findFirst();
    if (!org) return fail("Kein Unternehmen eingerichtet. Zuerst setup_company.");
    const invoices = await dbInternal.invoice.findMany({
      where: { orgId: org.id, ...(status ? { status } : {}) },
      orderBy: { createdAt: "desc" },
      include: { customer: { select: { name: true } } },
      take: 50,
    });
    return ok(
      JSON.stringify(
        invoices.map((i) => ({ id: i.id, number: i.number, status: i.status, customer: i.customer.name, gross: formatCents(i.grossTotalCents) })),
        null,
        2,
      ),
    );
  },
);

// ── export_invoice ───────────────────────────────────────────────────────────
server.registerTool(
  "export_invoice",
  {
    title: "Rechnung exportieren (PDF + XRechnung)",
    description:
      "Schreibt die Rechnung als PDF, XRechnung-XML und/oder ZUGFeRD (Hybrid-PDF mit eingebettetem CII-XML) in eine Datei und gibt die Pfade + EN-16931-Validierungsreport zurück. XRechnung/ZUGFeRD nur für festgeschriebene Rechnungen.",
    inputSchema: {
      invoice: z.string().describe("Rechnungs-ID oder -Nummer"),
      format: z.enum(["both", "pdf", "xrechnung", "zugferd"]).default("both"),
      outputDir: z.string().optional().describe("Zielverzeichnis (Default: <Projekt>/exports)"),
    },
  },
  async ({ invoice, format, outputDir }): Promise<Result> => {
    try {
      const org = await requireOrg();
      const ref = await resolveInvoice(org.id, invoice);
      const loaded = await loadEInvoiceData(ref.id);
      if (!loaded) return fail("Nicht gefunden.");
      const inv = loaded.invoice;
      const data = loaded.data;
      const dir = outputDir ? path.resolve(outputDir) : path.join(PROJECT_ROOT, "exports");
      mkdirSync(dir, { recursive: true });
      const base = (inv.number ?? `entwurf-${inv.id.slice(0, 8)}`).replace(/[^A-Za-z0-9._-]/g, "_");
      const written: string[] = [];
      let validation: { valid: boolean; errors: string[] } | null = null;

      if (format === "both" || format === "pdf") {
        const pdf = await renderInvoicePdf(data);
        const pdfPath = path.join(dir, `${base}.pdf`);
        writeFileSync(pdfPath, pdf);
        written.push(pdfPath);
      }
      if (format === "both" || format === "xrechnung") {
        if (inv.status === "DRAFT") {
          if (format === "xrechnung") return fail("XRechnung nur für festgeschriebene Rechnungen. Zuerst finalize_invoice.");
        } else {
          const xml = buildXRechnungUBL(data);
          validation = validateXRechnung(data, xml);
          const xmlPath = path.join(dir, `${base}.xml`);
          writeFileSync(xmlPath, xml, "utf8");
          written.push(xmlPath);
        }
      }
      if (format === "zugferd") {
        if (inv.status === "DRAFT") return fail("ZUGFeRD nur für festgeschriebene Rechnungen. Zuerst finalize_invoice.");
        const zpdf = await renderZugferdPdf(data);
        const zpath = path.join(dir, `${base}-zugferd.pdf`);
        writeFileSync(zpath, zpdf);
        written.push(zpath);
      }
      return ok(
        `Export geschrieben:\n${written.join("\n")}` +
          (validation ? `\nEN-16931-Kernvalidierung: ${validation.valid ? "BESTANDEN" : "FEHLER: " + validation.errors.join("; ")}` : ""),
      );
    } catch (e) {
      return fail(`Export fehlgeschlagen: ${(e as Error).message}`);
    }
  },
);

const docLineSchema = z.object({
  description: z.string(),
  quantity: z.number(),
  unitPriceEuro: z.number().optional(),
  productName: z.string().optional(),
  unit: z.string().optional(),
  taxRatePercent: z.union([z.literal(19), z.literal(7), z.literal(0)]).optional(),
  discountPercent: z.number().min(0).max(100).optional().describe("Positionsrabatt in Prozent"),
  discountAmount: z.number().min(0).optional().describe("Zusätzlicher Festbetragsrabatt je Position in Euro"),
});

// ── create_document ─────────────────────────────────────────────────────────
server.registerTool(
  "create_document",
  {
    title: "Angebot / Auftragsbestätigung / Proforma anlegen",
    description:
      "Erstellt ein Geschäftsdokument (KEIN Steuerbeleg): Angebot, Auftragsbestätigung oder Proforma-Rechnung. Kunde per Name, Positionen wie bei create_invoice. Später mit convert_document_to_invoice in eine echte Rechnung umwandelbar.",
    inputSchema: {
      kind: z.enum(["ANGEBOT", "AUFTRAGSBESTAETIGUNG", "PROFORMA"]),
      customer: z.string().describe("Kundenname oder -ID"),
      lines: z.array(docLineSchema).min(1),
      validUntil: z.string().optional().describe("Gültig bis YYYY-MM-DD (für Angebote)"),
      notes: z.string().optional(),
      documentDiscountPercent: z.number().min(0).max(100).optional().describe("Belegrabatt in Prozent (auf alle Steuersaetze proportional verteilt)"),
      documentDiscountEuro: z.number().min(0).optional().describe("Zusaetzlicher Belegrabatt als Festbetrag in Euro"),
      documentChargePercent: z.number().min(0).max(100).optional().describe("Belegaufschlag in Prozent (nach Rabatt berechnet)"),
      documentChargeEuro: z.number().min(0).optional().describe("Zusaetzlicher Belegaufschlag als Festbetrag in Euro"),
      documentChargeReason: z.string().max(500).optional(),
    },
  },
  async (args): Promise<Result> => {
    try {
      const org = await requireOrg();
      const customer = await resolveCustomer(org.id, args.customer);
      const lines = await buildSimpleLines(org.id, args.lines);
      const input = createDocumentSchema.parse({
        kind: args.kind,
        customerId: customer.id,
        taxScheme: "REGULAR",
        currency: "EUR",
        validUntil: parseDateInput(args.validUntil),
        notes: args.notes,
        documentDiscountPermille: args.documentDiscountPercent ? Math.round(args.documentDiscountPercent * 10) : undefined,
        documentDiscountCents: args.documentDiscountEuro ? euroToCents(args.documentDiscountEuro) : undefined,
        documentChargePermille: args.documentChargePercent ? Math.round(args.documentChargePercent * 10) : undefined,
        documentChargeCents: args.documentChargeEuro ? euroToCents(args.documentChargeEuro) : undefined,
        documentChargeReason: args.documentChargeReason,
        lines,
      });
      const doc = await createBusinessDocument(org.id, input);
      return ok(`${args.kind} angelegt: ${doc.number} für ${customer.name} · Brutto ${formatCents(doc.grossTotalCents)}.`);
    } catch (e) {
      return fail(`Konnte Dokument nicht anlegen: ${(e as Error).message}`);
    }
  },
);

// ── list_documents ───────────────────────────────────────────────────────────
server.registerTool(
  "list_documents",
  {
    title: "Dokumente auflisten",
    description: "Listet Angebote/Auftragsbestätigungen/Proforma (optional nach Art gefiltert).",
    inputSchema: { kind: z.enum(["ANGEBOT", "AUFTRAGSBESTAETIGUNG", "PROFORMA"]).optional() },
  },
  async ({ kind }): Promise<Result> => {
    const org = await dbInternal.organization.findFirst();
    if (!org) return fail("Kein Unternehmen eingerichtet. Zuerst setup_company.");
    const docs = await dbInternal.quote.findMany({
      where: { orgId: org.id, ...(kind ? { kind } : {}) },
      orderBy: { createdAt: "desc" },
      include: { customer: { select: { name: true } } },
      take: 50,
    });
    return ok(
      JSON.stringify(
        docs.map((d) => ({ id: d.id, number: d.number, kind: d.kind, customer: d.customer.name, gross: formatCents(d.grossTotalCents), status: d.status })),
        null,
        2,
      ),
    );
  },
);

// ── convert_document_to_invoice ──────────────────────────────────────────────
server.registerTool(
  "convert_document_to_invoice",
  {
    title: "Dokument in Rechnung umwandeln",
    description: "Wandelt ein Angebot/Auftragsbestätigung/Proforma in einen Rechnungs-Entwurf um (danach finalize_invoice).",
    inputSchema: { document: z.string().describe("Dokument-Nummer oder -ID") },
  },
  async ({ document }): Promise<Result> => {
    try {
      const org = await requireOrg();
      const doc = await resolveDocument(org.id, document);
      const result = await convertDocument(org.id, { fromType: "QUOTE", fromId: doc.id, toKind: "INVOICE" });
      return ok(`Umgewandelt: ${doc.number} → Rechnungs-Entwurf ${result.id}. Mit finalize_invoice festschreiben.`);
    } catch (e) {
      if (e instanceof ConvertError) return fail(e.message);
      return fail(`Fehler: ${(e as Error).message}`);
    }
  },
);

// ── convert_document (generisch: AB, Rechnung, Lieferschein) ─────────────────
server.registerTool(
  "convert_document",
  {
    title: "Dokument umwandeln (generisch)",
    description:
      "Wandelt ein Angebot in eine Auftragsbestaetigung um, ein Angebot/AB/Proforma in eine Rechnung, oder ein Angebot/AB/Rechnung in einen Lieferschein (mit optionalen Teilmengen). Fuer Rechnung -> Lieferschein 'fromType' auf INVOICE setzen.",
    inputSchema: {
      fromType: z.enum(["QUOTE", "INVOICE"]).default("QUOTE").describe("QUOTE fuer Angebot/AB/Proforma, INVOICE fuer eine Rechnung"),
      document: z.string().describe("Dokument- oder Rechnungs-Nummer bzw. -ID der Quelle"),
      // toKind/quantities wiederverwenden aus dem Routen-Schema (Fix-Runde 1, Befund 2) —
      // deliveryDate bleibt ein eigener String-Typ, da hier natuerlichsprachliche Eingaben
      // (z. B. "heute") ueber parseDateInput geparst werden, nicht Zod-coerce.
      toKind: convertDocumentBodySchema.shape.toKind,
      quantities: convertDocumentBodySchema.shape.quantities.describe(
        "Nur fuer DELIVERY_NOTE: Mengen je Quellposition (in Milliunits). Ohne Angabe = volle Restmenge.",
      ),
      deliveryDate: z.string().optional().describe("Nur fuer DELIVERY_NOTE, YYYY-MM-DD"),
    },
  },
  async ({ fromType, document, toKind, quantities, deliveryDate }): Promise<Result> => {
    try {
      const org = await requireOrg();
      const src = fromType === "INVOICE" ? await resolveInvoice(org.id, document) : await resolveDocument(org.id, document);
      const result = await convertDocument(org.id, {
        fromType,
        fromId: src.id,
        toKind,
        quantities,
        deliveryDate: parseDateInput(deliveryDate),
      });
      return ok(`Umgewandelt zu ${toKind}: ${result.type} ${result.id}.`);
    } catch (e) {
      if (e instanceof ConvertError) return fail(e.message);
      return fail(`Fehler: ${(e as Error).message}`);
    }
  },
);

// ── create_delivery_note (manuell) ────────────────────────────────────────────
server.registerTool(
  "create_delivery_note",
  {
    title: "Lieferschein anlegen (manuell)",
    description: "Legt einen Lieferschein ohne Quelldokument an, z. B. fuer eine Direktlieferung ohne vorheriges Angebot.",
    inputSchema: {
      customer: z.string().describe("Kundenname oder -ID"),
      lines: z.array(docLineSchema).min(1),
      deliveryDate: z.string().optional().describe("YYYY-MM-DD"),
      notes: z.string().optional(),
    },
  },
  async (args): Promise<Result> => {
    try {
      const org = await requireOrg();
      const customer = await resolveCustomer(org.id, args.customer);
      const lines = await buildSimpleLines(org.id, args.lines);
      const input = createDeliveryNoteSchema.parse({
        customerId: customer.id,
        deliveryDate: parseDateInput(args.deliveryDate),
        notes: args.notes,
        lines: lines.map((l) => ({
          description: l.description,
          quantityMilli: l.quantityMilli,
          unit: l.unit,
          unitNetPriceCents: l.unitNetPriceCents,
          taxRate: l.taxRate,
        })),
      });
      const note = await createDeliveryNote(org.id, input);
      return ok(`Lieferschein angelegt: ${note.number} für ${customer.name}.`);
    } catch (e) {
      if (e instanceof DeliveryNoteError) return fail(e.message);
      return fail(`Konnte Lieferschein nicht anlegen: ${(e as Error).message}`);
    }
  },
);

// ── set_document_status ───────────────────────────────────────────────────────
server.registerTool(
  "set_document_status",
  {
    title: "Dokument-/Lieferscheinstatus setzen",
    description:
      "Setzt den Status eines Angebots/einer Auftragsbestaetigung (QUOTE) oder eines Lieferscheins (DELIVERY_NOTE): MARK_SENT, MARK_ACCEPTED, MARK_REJECTED (nur QUOTE), MARK_CREATED, MARK_DELIVERED (nur DELIVERY_NOTE), CANCEL, ARCHIVE, UNARCHIVE. MARK_CREATED vergibt bei einem DRAFT-Lieferschein (z. B. einem Duplikat) die Belegnummer.",
    inputSchema: {
      type: z.enum(["QUOTE", "DELIVERY_NOTE"]),
      document: z.string().describe("Nummer oder ID des Angebots/Lieferscheins"),
      action: documentStatusActionSchema.shape.action,
      note: z.string().optional(),
    },
  },
  async ({ type, document, action, note }): Promise<Result> => {
    try {
      const org = await requireOrg();
      const doc = type === "QUOTE" ? await resolveDocument(org.id, document) : await resolveDeliveryNote(org.id, document);

      if (action === "ARCHIVE" || action === "UNARCHIVE") {
        await setArchived(org.id, type, doc.id, action === "ARCHIVE", "mcp");
        return ok(`Status gesetzt: ${action}.`);
      }

      if (type === "QUOTE") {
        if (action !== "MARK_SENT" && action !== "MARK_ACCEPTED" && action !== "MARK_REJECTED" && action !== "CANCEL") {
          return fail(`${action} ist fuer QUOTE nicht gueltig.`);
        }
        const target = { MARK_SENT: "SENT", MARK_ACCEPTED: "ACCEPTED", MARK_REJECTED: "REJECTED", CANCEL: "CANCELLED" } as const;
        const updated = await setQuoteStatus(org.id, doc.id, target[action], { actor: "mcp", note });
        return ok(`Status gesetzt: ${updated.status}.`);
      }

      if (action !== "MARK_CREATED" && action !== "MARK_SENT" && action !== "MARK_DELIVERED" && action !== "CANCEL") {
        return fail(`${action} ist fuer DELIVERY_NOTE nicht gueltig.`);
      }
      const target = { MARK_CREATED: "CREATED", MARK_SENT: "SENT", MARK_DELIVERED: "DELIVERED", CANCEL: "CANCELLED" } as const;
      const updated = await setDeliveryNoteStatus(org.id, doc.id, target[action], { actor: "mcp", note });
      return ok(`Status gesetzt: ${updated.status}${updated.number ? ` (Nummer ${updated.number})` : ""}.`);
    } catch (e) {
      if (e instanceof StatusTransitionError) return fail(e.message);
      return fail(`Fehler: ${(e as Error).message}`);
    }
  },
);

// ── duplicate_document ────────────────────────────────────────────────────────
server.registerTool(
  "duplicate_document",
  {
    title: "Beleg duplizieren",
    description: "Dupliziert ein Angebot/AB/Proforma (QUOTE), einen Lieferschein (DELIVERY_NOTE) oder eine Rechnung (INVOICE) als neuen Entwurf.",
    inputSchema: {
      type: z.enum(["QUOTE", "DELIVERY_NOTE", "INVOICE"]),
      document: z.string().describe("Nummer oder ID der Quelle"),
    },
  },
  async ({ type, document }): Promise<Result> => {
    try {
      const org = await requireOrg();
      const src: DuplicatableType = type;
      const doc =
        type === "QUOTE"
          ? await resolveDocument(org.id, document)
          : type === "INVOICE"
            ? await resolveInvoice(org.id, document)
            : await resolveDeliveryNote(org.id, document);
      const copy = await duplicateDocument(org.id, src, doc.id, "mcp");
      return ok(`Dupliziert als neuer Entwurf: ${copy.type} ${copy.id}.`);
    } catch (e) {
      return fail(`Fehler: ${(e as Error).message}`);
    }
  },
);

// ── create_partial_invoice / create_downpayment_invoice / create_final_invoice ──
// Task 4 (Phase 5, §13-15 UStG): dieselben Domain-Funktionen/Zod-Schemas wie die
// Routen unter /api/documents/[id]/*-invoice — keine Bypass-Pfade (Lastenheft 55).
// permille wird hier als Prozent (0,1..100,0) entgegengenommen (Konvention wie
// discountPercent in buildSimpleLines), amountCents als Euro-Betrag.

server.registerTool(
  "create_partial_invoice",
  {
    title: "Teilrechnung anlegen",
    description:
      "Erstellt eine Teilrechnung (§13 UStG, Entwurf) aus einem Angebot/einer Auftragsbestaetigung oder einem Lieferschein — als Anteil (Prozent/Netto-/Bruttobetrag je Steuersatz) oder als konkrete Positionen/Mengen. Danach mit finalize_invoice festschreiben.",
    inputSchema: {
      sourceType: z.enum(["QUOTE", "DELIVERY_NOTE"]).default("QUOTE").describe("QUOTE fuer Angebot/AB, DELIVERY_NOTE fuer einen Lieferschein"),
      source: z.string().describe("Nummer oder ID der Quelle"),
      mode: z.enum(["PERCENT", "NET_AMOUNT", "GROSS_AMOUNT", "POSITIONS", "QUANTITIES"]),
      percent: z.number().min(0.1).max(100).optional().describe("Nur mode PERCENT: Anteil in Prozent, z. B. 30 fuer 30 %"),
      amountEuro: z.number().positive().optional().describe("Nur mode NET_AMOUNT/GROSS_AMOUNT: Betrag in Euro"),
      lineIds: z.array(z.string()).optional().describe("Nur mode POSITIONS: IDs der vollstaendig abzurechnenden Quellpositionen"),
      quantities: z
        .array(z.object({ sourceLineId: z.string(), quantityMilli: z.number().int().positive() }))
        .optional()
        .describe("Nur mode QUANTITIES: Mengen je Quellposition in Milliunits (Stk*1000)"),
    },
  },
  async ({ sourceType, source, mode, percent, amountEuro, lineIds, quantities }): Promise<Result> => {
    try {
      const org = await requireOrg();
      // Der MCP-SDK-Client wendet Zod-Defaults aus inputSchema an; direkte Testaufrufe
      // (server["_registeredTools"][name].handler(args)) umgehen das — hier zusaetzlich
      // defensiv defaulten, damit beide Aufrufwege identisch funktionieren.
      const effectiveSourceType = sourceType ?? "QUOTE";
      const src = effectiveSourceType === "DELIVERY_NOTE" ? await resolveDeliveryNote(org.id, source) : await resolveDocument(org.id, source);
      const input = createPartialInvoiceSchema.parse({
        sourceType: effectiveSourceType,
        sourceId: src.id,
        mode,
        permille: percent != null ? Math.round(percent * 10) : undefined,
        amountCents: amountEuro != null ? euroToCents(amountEuro) : undefined,
        lineIds,
        quantities,
      });
      const invoice = await createPartialInvoice(org.id, input);
      return ok(`Teilrechnung angelegt: Entwurf ${invoice.id} (${formatCents(invoice.grossTotalCents)} brutto). Mit finalize_invoice festschreiben.`);
    } catch (e) {
      if (e instanceof z.ZodError) return fail(`Validierung fehlgeschlagen: ${e.issues.map((i) => i.message).join("; ")}`);
      if (e instanceof PartialInvoiceError || e instanceof PricingError) return fail(e.message);
      return fail(`Fehler: ${(e as Error).message}`);
    }
  },
);

server.registerTool(
  "create_downpayment_invoice",
  {
    title: "Abschlagsrechnung anlegen",
    description:
      "Erstellt eine Abschlagsrechnung (§13/§14 Abs. 5 UStG, Entwurf) auf ein Angebot/eine Auftragsbestaetigung — als Prozentanteil oder Festbetrag. Danach mit finalize_invoice festschreiben; nach mindestens einem festgeschriebenen Abschlag kann eine Schlussrechnung erzeugt werden.",
    inputSchema: {
      source: z.string().describe("Nummer oder ID des Angebots/der Auftragsbestaetigung"),
      mode: z.enum(["PERCENT", "AMOUNT"]),
      percent: z.number().min(0.1).max(100).optional().describe("Nur mode PERCENT: Anteil in Prozent"),
      amountEuro: z.number().positive().optional().describe("Nur mode AMOUNT: Betrag in Euro"),
      amountIsGross: z.boolean().default(false).describe("Nur mode AMOUNT: amountEuro als Brutto- statt Nettobetrag lesen"),
    },
  },
  async ({ source, mode, percent, amountEuro, amountIsGross }): Promise<Result> => {
    try {
      const org = await requireOrg();
      const quote = await resolveDocument(org.id, source);
      const input = createDownpaymentInvoiceSchema.parse({
        sourceType: "QUOTE",
        sourceId: quote.id,
        mode,
        permille: percent != null ? Math.round(percent * 10) : undefined,
        amountCents: amountEuro != null ? euroToCents(amountEuro) : undefined,
        amountIsGross,
      });
      const invoice = await createDownpaymentInvoice(org.id, input);
      return ok(`Abschlagsrechnung angelegt: Entwurf ${invoice.id} (${formatCents(invoice.grossTotalCents)} brutto). Mit finalize_invoice festschreiben.`);
    } catch (e) {
      if (e instanceof z.ZodError) return fail(`Validierung fehlgeschlagen: ${e.issues.map((i) => i.message).join("; ")}`);
      if (e instanceof DownpaymentInvoiceError || e instanceof PricingError) return fail(e.message);
      return fail(`Fehler: ${(e as Error).message}`);
    }
  },
);

server.registerTool(
  "create_final_invoice",
  {
    title: "Schlussrechnung anlegen",
    description:
      "Erstellt eine Schlussrechnung (§14 Abs. 5 UStG, Entwurf) ueber die gesamte Leistung eines Angebots/einer Auftragsbestaetigung. Voraussetzung: mindestens eine festgeschriebene, nicht stornierte Abschlagsrechnung. Beim Festschreiben werden die Abschlaege automatisch als Abzug ausgewiesen (Restbetrag).",
    inputSchema: { source: z.string().describe("Nummer oder ID des Angebots/der Auftragsbestaetigung") },
  },
  async ({ source }): Promise<Result> => {
    try {
      const org = await requireOrg();
      const quote = await resolveDocument(org.id, source);
      const input = createFinalInvoiceSchema.parse({ sourceType: "QUOTE", sourceId: quote.id });
      const invoice = await createFinalInvoice(org.id, input);
      return ok(`Schlussrechnung angelegt: Entwurf ${invoice.id}. Mit finalize_invoice festschreiben (Abzugs-Snapshot/Restbetrag werden dabei berechnet).`);
    } catch (e) {
      if (e instanceof z.ZodError) return fail(`Validierung fehlgeschlagen: ${e.issues.map((i) => i.message).join("; ")}`);
      if (e instanceof FinalInvoiceError) return fail(e.message);
      return fail(`Fehler: ${(e as Error).message}`);
    }
  },
);

// ── get_billing_state ────────────────────────────────────────────────────────
server.registerTool(
  "get_billing_state",
  {
    title: "Abrechnungsstand anzeigen",
    description: "Zeigt den Abrechnungsstand (NONE/PARTIAL/FULL, Prozent, Summe Abschlaege) eines Angebots/einer Auftragsbestaetigung — Grundlage fuer create_partial_invoice/create_downpayment_invoice/create_final_invoice.",
    inputSchema: { document: z.string().describe("Dokument-Nummer oder -ID") },
  },
  async ({ document }): Promise<Result> => {
    try {
      const org = await requireOrg();
      const doc = await resolveDocument(org.id, document);
      const billing = await billingStateFor(org.id, "QUOTE", doc.id);
      return ok(
        JSON.stringify(
          {
            state: billing.state,
            billedPercent: billing.billedPermille / 10,
            downpaymentGross: formatCents(billing.downpaymentGrossCents),
            invoiceIds: billing.invoiceIds,
          },
          null,
          2,
        ),
      );
    } catch (e) {
      return fail(`Fehler: ${(e as Error).message}`);
    }
  },
);

// ── credit_invoice (Teilgutschrift) ──────────────────────────────────────────
server.registerTool(
  "credit_invoice",
  {
    title: "Teilgutschrift / Teilerstattung",
    description:
      "Erstellt eine Teilgutschrift zu einer festgeschriebenen Rechnung über die angegebenen Positionen (Beträge positiv angeben). Das Original bleibt erhalten. Für einen VOLL-Storno: cancel_invoice.",
    inputSchema: {
      invoice: z.string().describe("Rechnungs-ID oder -Nummer"),
      lines: z.array(docLineSchema).min(1).describe("Zu erstattende Positionen"),
      notes: z.string().optional().describe("Grund der Gutschrift"),
    },
  },
  async (args): Promise<Result> => {
    try {
      const org = await requireOrg();
      const inv = await resolveInvoice(org.id, args.invoice);
      const lines = (await buildSimpleLines(org.id, args.lines)).map((l) => ({
        description: l.description,
        quantityMilli: l.quantityMilli,
        unit: l.unit,
        unitNetPriceCents: l.unitNetPriceCents,
        taxRate: l.taxRate,
        taxCategory: l.taxCategory,
      }));
      const res = await createPartialCreditNote(inv.id, { lines, notes: args.notes });
      return ok(`Teilgutschrift ${res.creditNote.number} zu ${res.originalNumber} erstellt · Brutto ${formatCents(res.creditNote.grossTotalCents)}.`);
    } catch (e) {
      if (e instanceof CreditError) return fail(e.message);
      return fail(`Fehler: ${(e as Error).message}`);
    }
  },
);

// ── record_payment ───────────────────────────────────────────────────────────
server.registerTool(
  "record_payment",
  {
    title: "Zahlung erfassen",
    description:
      "Erfasst einen Zahlungseingang auf eine festgeschriebene Rechnung und aktualisiert offenen Betrag + Status (bezahlt/teilbezahlt). " +
      "Faellt die Zahlung in eine Skontofrist der Rechnung, wird ein Vorschlag zurueckgegeben; mit applySkonto=true wird der verbleibende " +
      "Rest sofort als zweite Zahlung (Skontoabzug) gebucht.",
    inputSchema: {
      invoice: z.string().describe("Rechnungs-ID oder -Nummer"),
      amountEuro: z.number().describe("Gezahlter Betrag in Euro"),
      paidAt: z.string().optional().describe("Zahlungsdatum YYYY-MM-DD oder 'heute' (Default: heute)"),
      method: PaymentMethod.default("TRANSFER"),
      reference: z.string().optional(),
      applySkonto: z.boolean().default(false).describe("Erkannten Skontoabzug sofort als zweite Zahlung buchen"),
    },
  },
  async (args): Promise<Result> => {
    try {
      const org = await requireOrg();
      const inv = await resolveInvoice(org.id, args.invoice);
      const result = await recordPayment(
        inv.id,
        recordPaymentSchema.parse({
          amountCents: euroToCents(args.amountEuro),
          paidAt: parseDateInput(args.paidAt),
          method: args.method,
          reference: args.reference,
          applySkonto: args.applySkonto,
        }),
      );
      const updated = result.payment;
      const open = updated.grossTotalCents - updated.paidAmountCents;
      const skontoNote = result.skontoPayment
        ? ` Skontoabzug ${formatCents(result.skontoPayment.amountCents)} automatisch gebucht — Rechnung vollstaendig bezahlt.`
        : result.skontoSuggestion
          ? ` Skonto moeglich bis ${result.skontoSuggestion.dueDate.toISOString().slice(0, 10)} (${formatCents(result.skontoSuggestion.restCents)}) — mit applySkonto=true buchen.`
          : "";
      return ok(`Zahlung erfasst. Status: ${updated.status} · offen: ${formatCents(open)}.${skontoNote}`);
    } catch (e) {
      if (e instanceof PaymentError) return fail(e.message);
      return fail(`Fehler: ${(e as Error).message}`);
    }
  },
);

// ── list_payment_methods ────────────────────────────────────────────────────
server.registerTool(
  "list_payment_methods",
  {
    title: "Zahlungsmethoden auflisten",
    description: "Listet die Zahlungsmethoden der Organisation (Code, Name, Zahlungsziel, aktiv/System) — nuetzlich, um Codes fuer create_invoice/record_payment nachzuschlagen.",
    inputSchema: {},
  },
  async (): Promise<Result> => {
    try {
      const org = await requireOrg();
      const methods = await listPaymentMethods(org.id);
      return ok(
        JSON.stringify(
          methods.map((m) => ({
            id: m.id,
            code: m.code,
            name: m.name,
            paymentTermsDays: m.paymentTermsDays,
            isSystem: m.isSystem,
            isActive: m.isActive,
          })),
          null,
          2,
        ),
      );
    } catch (e) {
      return fail(`Fehler: ${(e as Error).message}`);
    }
  },
);

// ── create_dunning ───────────────────────────────────────────────────────────
server.registerTool(
  "create_dunning",
  {
    title: "Mahnung / Zahlungserinnerung erstellen",
    description:
      "Erstellt die nächste konfigurierte Mahnstufe (Zahlungserinnerung → 1./2./…​ Mahnung) zu einer überfälligen, offenen Rechnung. Ab Stufe ≥ 2 mit Mahnkosten, je nach Stufe mit Verzugszins (§ 288 BGB) und 40-€-Pauschale (nur B2B). Ist die Stufe noch nicht fällig, schlägt der Aufruf fehl — mit force=true trotzdem erzwingen.",
    inputSchema: {
      invoice: z.string().describe("Rechnungs-ID oder -Nummer"),
      force: z.boolean().optional().describe("Erstellung vor Fälligkeit der nächsten Stufe erzwingen"),
    },
  },
  async ({ invoice, force }): Promise<Result> => {
    try {
      const org = await requireOrg();
      const inv = await resolveInvoice(org.id, invoice);
      const res = await createDunning(inv.id, { force, createdBy: "mcp" });
      return ok(`${res.stage.name} ${res.dunning.number} erstellt · offen ${formatCents(res.openAmountCents)} · Gesamtforderung ${formatCents(res.totalCents)}.`);
    } catch (e) {
      if (e instanceof DunningError) return fail(e.message);
      return fail(`Fehler: ${(e as Error).message}`);
    }
  },
);

// ── send_dunning ──────────────────────────────────────────────────────────────
server.registerTool(
  "send_dunning",
  {
    title: "Mahnung per E-Mail versenden",
    description: "Versendet eine bereits erstellte Mahnung per E-Mail an den Kunden (Vorlage der zugehörigen Mahnstufe).",
    inputSchema: {
      dunning: z.string().describe("Mahnungs-ID oder -Nummer"),
      to: z.email().optional().describe("Empfänger ueberschreiben (sonst Kundenstamm/Snapshot)"),
    },
  },
  async ({ dunning, to }): Promise<Result> => {
    try {
      const org = await requireOrg();
      const d = await resolveDunning(org.id, dunning);
      const result = await sendDunning(org.id, d.id, { actor: "mcp", to });
      if (result.status === "FAILED") return fail(result.error ?? "Versand fehlgeschlagen.");
      return ok(`Mahnung ${d.number ?? d.id} versendet.`);
    } catch (e) {
      if (e instanceof MailNotConfiguredError) return fail(e.message);
      if (e instanceof DunningError) return fail(e.message);
      return fail(`Fehler: ${(e as Error).message}`);
    }
  },
);

// ── set_dunning_state ─────────────────────────────────────────────────────────
server.registerTool(
  "set_dunning_state",
  {
    title: "Mahnprozess-Status setzen",
    description: "Setzt den Mahnprozess einer Rechnung auf ACTIVE (normal), PAUSED (bis pausedUntil ausgesetzt, z.B. Ratenzahlung) oder STOPPED (dauerhaft angehalten, z.B. Inkasso).",
    inputSchema: {
      invoice: z.string().describe("Rechnungs-ID oder -Nummer"),
      state: z.enum(["ACTIVE", "PAUSED", "STOPPED"]),
      pausedUntil: z.iso.date().optional().describe("Nur bei state=PAUSED"),
      note: z.string().max(500).optional(),
    },
  },
  async ({ invoice, state, pausedUntil, note }): Promise<Result> => {
    try {
      const org = await requireOrg();
      const inv = await resolveInvoice(org.id, invoice);
      const res = await setDunningState(org.id, inv.id, { state, pausedUntil, note }, "mcp");
      return ok(`Mahnprozess-Status: ${res.state}${res.pausedUntil ? ` bis ${res.pausedUntil.toISOString().slice(0, 10)}` : ""}.`);
    } catch (e) {
      if (e instanceof DunningError) return fail(e.message);
      return fail(`Fehler: ${(e as Error).message}`);
    }
  },
);

// ── list_overdue_invoices ──────────────────────────────────────────────────────
server.registerTool(
  "list_overdue_invoices",
  {
    title: "Überfällige Rechnungen auflisten (Mahnwesen-Übersicht)",
    description: "Listet überfällige, offene Rechnungen mit Mahnstatus (aktuelle/nächste Mahnstufe, fällig ab, pausiert bis, letzter Kontakt) — dieselben Daten wie /mahnwesen.",
    inputSchema: { state: z.enum(["ACTIVE", "PAUSED", "STOPPED"]).optional() },
  },
  async ({ state }): Promise<Result> => {
    try {
      const org = await requireOrg();
      const overview = await loadDunningOverview(org.id, new Date(), { state });
      return ok(
        JSON.stringify(
          {
            widgets: overview.widgets,
            rows: overview.rows.map((r) => ({
              invoice: r.number ?? r.invoiceId,
              customer: r.customerName,
              openAmount: formatCents(r.openCents),
              daysOverdue: r.daysOverdue,
              currentStage: r.currentStage?.name ?? null,
              nextStage: r.nextStage?.name ?? null,
              nextDunningAt: r.nextDunningAt ? r.nextDunningAt.toISOString().slice(0, 10) : null,
              dunningState: r.dunningState,
              pausedUntil: r.pausedUntil ? r.pausedUntil.toISOString().slice(0, 10) : null,
            })),
          },
          null,
          2,
        ),
      );
    } catch (e) {
      return fail(`Fehler: ${(e as Error).message}`);
    }
  },
);

// ── run_scheduler_job ─────────────────────────────────────────────────────────
server.registerTool(
  "run_scheduler_job",
  {
    title: "Scheduler-Job manuell anstoßen",
    description: "Stößt den Mahn-Scheduler ('dunning', automatischer Mahnlauf) und/oder den Abo-Scheduler ('recurring') sofort an, statt auf den nächsten Intervall-Lauf zu warten.",
    inputSchema: { job: z.enum(["dunning", "recurring"]).optional().describe("Nur diesen Job ausführen (sonst beide, Reihenfolge recurring → dunning)") },
  },
  async ({ job }): Promise<Result> => {
    try {
      const jobs: SchedulerJob[] | undefined = job ? [job] : undefined;
      const results = await runScheduledJobs({ jobs, trigger: "MANUAL" });
      const lines = results.map((r) => `${r.job}: ${r.ok ? "OK" : `FEHLER (${r.error})`} · ${JSON.stringify(r.summary)}`);
      return ok(lines.join("\n"));
    } catch (e) {
      return fail(`Fehler: ${(e as Error).message}`);
    }
  },
);

// ── create_recurring ─────────────────────────────────────────────────────────
server.registerTool(
  "create_recurring",
  {
    title: "Abo / wiederkehrende Rechnung anlegen",
    description:
      "Legt ein Abo an, aus dem nach Plan automatisch Rechnungen entstehen (z. B. monatlicher Wartungsvertrag). Kunde per Name, Positionen wie bei create_invoice. Mit run_recurring oder dem Cron-Lauf werden die fälligen Rechnungen erzeugt.",
    inputSchema: {
      customer: z.string().describe("Kundenname oder -ID"),
      title: z.string().describe("Interne Bezeichnung, z. B. 'Wartungsvertrag Mustermann'"),
      lines: z.array(docLineSchema).min(1),
      interval: z.enum(["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"]).default("MONTHLY"),
      intervalCount: z.number().int().min(1).max(48).default(1).describe("alle N Intervalle (z. B. 2 = alle 2 Monate)"),
      startDate: z.string().describe("Erster Stichtag YYYY-MM-DD oder 'heute'"),
      endDate: z.string().optional().describe("Letzter Stichtag YYYY-MM-DD (optional)"),
      anchorDay: z.number().int().min(1).max(28).optional().describe("Fester Tag im Monat (1..28)"),
      paymentTermsDays: z.number().int().min(0).max(365).default(14),
      autoFinalize: z.boolean().default(false).describe("true = erzeugte Rechnungen sofort festschreiben"),
      notes: z.string().optional(),
    },
  },
  async (args): Promise<Result> => {
    try {
      const org = await requireOrg();
      const customer = await resolveCustomer(org.id, args.customer);
      const lines = await buildSimpleLines(org.id, args.lines);
      const start = parseDateInput(args.startDate);
      if (!start) throw new Error("startDate konnte nicht gelesen werden (YYYY-MM-DD oder 'heute').");
      const input = createRecurringSchema.parse({
        customerId: customer.id,
        title: args.title,
        interval: args.interval,
        intervalCount: args.intervalCount,
        anchorDay: args.anchorDay,
        startDate: start,
        endDate: parseDateInput(args.endDate),
        paymentTermsDays: args.paymentTermsDays,
        autoFinalize: args.autoFinalize,
        taxScheme: "REGULAR",
        currency: "EUR",
        notes: args.notes,
        lines,
      });
      const rec = await createRecurring(org.id, input);
      return ok(
        `Abo angelegt: "${rec.title}" für ${customer.name} · ${intervalLabel(rec.interval, rec.intervalCount)} · ` +
          `erste Rechnung ab ${rec.nextRunDate.toISOString().slice(0, 10)}${rec.autoFinalize ? " (auto-festschreiben)" : ""}.\n` +
          `ID: ${rec.id}. Erzeugen: run_recurring (alle fälligen) oder warten auf den Cron-Lauf.`,
      );
    } catch (e) {
      if (e instanceof RecurringError) return fail(e.message);
      return fail(`Konnte Abo nicht anlegen: ${(e as Error).message}`);
    }
  },
);

// ── list_recurring ───────────────────────────────────────────────────────────
server.registerTool(
  "list_recurring",
  {
    title: "Abos auflisten",
    description: "Listet die Abos / wiederkehrenden Rechnungen mit Status, Rhythmus und nächstem Stichtag.",
    inputSchema: { status: z.enum(["ACTIVE", "PAUSED", "ENDED"]).optional() },
  },
  async ({ status }): Promise<Result> => {
    const org = await dbInternal.organization.findFirst();
    if (!org) return fail("Kein Unternehmen eingerichtet. Zuerst setup_company.");
    const recs = await dbInternal.recurringInvoice.findMany({
      where: { orgId: org.id, ...(status ? { status } : {}) },
      include: { customer: { select: { name: true } }, _count: { select: { invoices: true } } },
      orderBy: { nextRunDate: "asc" },
    });
    return ok(
      JSON.stringify(
        recs.map((r) => ({
          id: r.id,
          title: r.title,
          customer: r.customer.name,
          rhythm: intervalLabel(r.interval, r.intervalCount),
          status: r.status,
          nextRunDate: r.status === "ENDED" ? null : r.nextRunDate.toISOString().slice(0, 10),
          issued: r._count.invoices,
          autoFinalize: r.autoFinalize,
        })),
        null,
        2,
      ),
    );
  },
);

// ── run_recurring ────────────────────────────────────────────────────────────
server.registerTool(
  "run_recurring",
  {
    title: "Fällige Abo-Rechnungen erzeugen",
    description:
      "Erzeugt alle aktuell fälligen Rechnungen aus den Abos (wie der Cron-Lauf). Mit 'recurring' kann gezielt EIN Abo (per ID/Name) sofort abgerechnet werden, auch wenn der Stichtag noch nicht erreicht ist.",
    inputSchema: {
      recurring: z.string().optional().describe("Optional: ein bestimmtes Abo (ID oder Titel) sofort abrechnen"),
    },
  },
  async ({ recurring }): Promise<Result> => {
    try {
      const org = await requireOrg();
      if (recurring) {
        const all = await dbInternal.recurringInvoice.findMany({ where: { orgId: org.id } });
        const lower = recurring.trim().toLowerCase();
        const match =
          all.find((r) => r.id === recurring) ??
          all.find((r) => r.title.toLowerCase() === lower) ??
          all.filter((r) => r.title.toLowerCase().includes(lower))[0];
        if (!match) return fail(`Kein Abo "${recurring}" gefunden.`);
        const res = await emitRecurringNow(match.id);
        return ok(
          `Rechnung erzeugt für Abo "${match.title}": ${res.number ?? "Entwurf " + res.invoiceId.slice(0, 8)}` +
            `${res.finalized ? " (festgeschrieben)" : " (Entwurf — finalize_invoice zum Festschreiben)"}.`,
        );
      }
      const summaries = await runDueRecurring({ orgId: org.id });
      const total = summaries.reduce((n, s) => n + s.emitted.length, 0);
      if (total === 0) return ok("Keine fälligen Abos.");
      const lines = summaries.flatMap((s) =>
        s.emitted.map((e) => `• ${s.title}: ${e.number ?? "Entwurf " + e.invoiceId.slice(0, 8)} (Periode ${e.periodDate.toISOString().slice(0, 10)})`),
      );
      return ok(`${total} Rechnung(en) aus ${summaries.length} Abo(s) erzeugt:\n${lines.join("\n")}`);
    } catch (e) {
      if (e instanceof RecurringError) return fail(e.message);
      return fail(`Fehler: ${(e as Error).message}`);
    }
  },
);

// ── create_share_link ─────────────────────────────────────────────────────────
server.registerTool(
  "create_share_link",
  {
    title: "Angebots-Annahmelink erzeugen",
    description:
      "Erzeugt einen oeffentlichen Annahme-Link (ohne Login) fuer ein Angebot (kind=ANGEBOT, Status DRAFT/SENT/EXPIRED). Der Kunde kann darueber das Angebot ansehen, als PDF herunterladen und annehmen/ablehnen. expiresInDays ueberschreibt die Standard-Gueltigkeitsdauer aus den Dokument-Einstellungen.",
    inputSchema: {
      documentId: z.string().describe("Nummer oder ID des Angebots"),
      expiresInDays: z.number().int().min(1).max(365).optional(),
    },
  },
  async ({ documentId, expiresInDays }): Promise<Result> => {
    try {
      const org = await requireOrg();
      const doc = await resolveDocument(org.id, documentId);
      const { link, token } = await createShareLink(org.id, doc.id, { expiresInDays });
      const baseUrl = appBaseUrlFromEnv();
      const url = baseUrl ? `${baseUrl}/angebot/${token}` : `(APP_BASE_URL nicht gesetzt) /angebot/${token}`;
      return ok(`Annahme-Link erzeugt fuer ${doc.number ?? doc.id} · gueltig bis ${link.expiresAt.toISOString().slice(0, 10)} · ${url}`);
    } catch (e) {
      if (e instanceof ShareLinkError) return fail(e.message);
      if (e instanceof SecretsUnavailableError) return fail(e.message);
      return fail(`Fehler: ${(e as Error).message}`);
    }
  },
);

// ── revoke_share_link ─────────────────────────────────────────────────────────
server.registerTool(
  "revoke_share_link",
  {
    title: "Angebots-Annahmelink widerrufen",
    description: "Widerruft einen Angebots-Annahmelink (linkId). Der Link liefert danach 404, eine Entscheidung ist nicht mehr moeglich.",
    inputSchema: {
      linkId: z.string(),
    },
  },
  async ({ linkId }): Promise<Result> => {
    try {
      const org = await requireOrg();
      await revokeShareLink(org.id, linkId);
      return ok(`Link ${linkId} widerrufen.`);
    } catch (e) {
      if (e instanceof NotFoundError) return fail(e.message);
      return fail(`Fehler: ${(e as Error).message}`);
    }
  },
);

// ── list_share_links ──────────────────────────────────────────────────────────
server.registerTool(
  "list_share_links",
  {
    title: "Angebots-Annahmelinks auflisten",
    description:
      "Listet alle Annahme-Links eines Angebots mit Status/Aufrufen/Entscheidung — NIE den Klartext-Token (der ist ueber diesen Weg nicht abrufbar; siehe Betreiber-UI fuer 'Link anzeigen').",
    inputSchema: {
      documentId: z.string().describe("Nummer oder ID des Angebots"),
    },
  },
  async ({ documentId }): Promise<Result> => {
    try {
      const org = await requireOrg();
      const doc = await resolveDocument(org.id, documentId);
      const links = await listShareLinks(org.id, doc.id);
      if (links.length === 0) return ok(`Keine Annahme-Links fuer ${doc.number ?? doc.id}.`);
      const lines = links.map((l) => {
        const status = l.revokedAt
          ? "widerrufen"
          : l.decidedAt
            ? `entschieden (${l.decision})`
            : l.expiresAt.getTime() < Date.now()
              ? "abgelaufen"
              : "aktiv";
        return `• ${l.id} · ${status} · erzeugt ${l.createdAt.toISOString().slice(0, 10)} · laeuft ab ${l.expiresAt.toISOString().slice(0, 10)} · ${l.viewCount} Aufruf(e)`;
      });
      return ok(lines.join("\n"));
    } catch (e) {
      return fail(`Fehler: ${(e as Error).message}`);
    }
  },
);

// ── save_document_settings ────────────────────────────────────────────────────
server.registerTool(
  "save_document_settings",
  {
    title: "Dokument-Einstellungen speichern",
    description:
      "Speichert die org-weiten Einstellungen fuer Angebotsannahme: onQuoteAccept (Automatik nach Online-Annahme: NONE/ORDER_CONFIRMATION/INVOICE), shareLinkDays (Standard-Gueltigkeitsdauer neuer Links in Tagen), storeAcceptIp (ob die IP-Adresse des Entscheiders gespeichert wird).",
    inputSchema: {
      onQuoteAccept: OnQuoteAccept.optional(),
      shareLinkDays: z.number().int().min(1).max(365).optional(),
      storeAcceptIp: z.boolean().optional(),
    },
  },
  async (args): Promise<Result> => {
    try {
      const org = await requireOrg();
      const saved = await saveDocumentSettings(org.id, documentSettingsInputSchema.parse(args));
      return ok(`Dokument-Einstellungen gespeichert: onQuoteAccept=${saved.onQuoteAccept}, shareLinkDays=${saved.shareLinkDays}, storeAcceptIp=${saved.storeAcceptIp}.`);
    } catch (e) {
      if (e instanceof z.ZodError) return fail(`Validierung fehlgeschlagen: ${e.issues.map((i) => i.message).join("; ")}`);
      return fail(`Fehler: ${(e as Error).message}`);
    }
  },
);

// ── update_invoice_draft ─────────────────────────────────────────────────────
server.registerTool(
  "update_invoice_draft",
  {
    title: "Rechnungsentwurf bearbeiten",
    description:
      "Aktualisiert einen Rechnungsentwurf (nur DRAFT — festgeschriebene Rechnungen sind unveraenderbar, GoBD). Nicht angegebene Felder bleiben unveraendert. Wird 'lines' angegeben, werden ALLE Positionen ersetzt; lineType erlaubt Ueberschriften/Textbloecke/Zwischensummen (HEADING/TEXT/SUBTOTAL, tragen nie einen Betrag).",
    inputSchema: {
      invoice: z.string().describe("Rechnungsnummer oder ID"),
      subject: z.string().optional().describe("Betreff"),
      orderNumber: z.string().optional().describe("Bestellnummer (BT-13)"),
      internalReference: z.string().optional(),
      buyerReference: z.string().optional().describe("Leitweg-ID-Override (BT-10)"),
      notes: z.string().optional(),
      internalNotes: z.string().optional().describe("Nur intern sichtbar, erscheint nie im Beleg/E-Mail"),
      paymentTerms: z.string().optional(),
      dueDate: z.string().optional().describe("YYYY-MM-DD oder 'heute'"),
      deliveryDate: z.string().optional().describe("YYYY-MM-DD oder 'heute'"),
      lines: z
        .array(
          z.object({
            lineType: LineType.default("ITEM"),
            description: z.string(),
            descriptionLong: z.string().optional().describe("Rich-Text-Langbeschreibung (Markdown-Teilmenge)"),
            articleNumber: z.string().optional(),
            quantity: z.number().optional().describe("Menge (Pflicht bei ITEM)"),
            unitPriceEuro: z.number().optional(),
            productName: z.string().optional(),
            unit: z.string().optional(),
            taxRatePercent: z.union([z.literal(19), z.literal(7), z.literal(0)]).optional(),
            discountPercent: z.number().min(0).max(100).optional(),
            discountAmount: z.number().min(0).optional(),
          }),
        )
        .optional(),
    },
  },
  async (args): Promise<Result> => {
    try {
      const org = await requireOrg();
      const inv = await resolveInvoice(org.id, args.invoice);
      const patch: Record<string, unknown> = {};
      if (args.subject !== undefined) patch.subject = args.subject;
      if (args.orderNumber !== undefined) patch.orderNumber = args.orderNumber;
      if (args.internalReference !== undefined) patch.internalReference = args.internalReference;
      if (args.buyerReference !== undefined) patch.buyerReference = args.buyerReference;
      if (args.notes !== undefined) patch.notes = args.notes;
      if (args.internalNotes !== undefined) patch.internalNotes = args.internalNotes;
      if (args.paymentTerms !== undefined) patch.paymentTerms = args.paymentTerms;
      if (args.dueDate !== undefined) patch.dueDate = parseDateInput(args.dueDate);
      if (args.deliveryDate !== undefined) patch.deliveryDate = parseDateInput(args.deliveryDate);
      if (args.lines) patch.lines = await buildEditorLines(org.id, args.lines);

      const updated = await updateDraftInvoice(org.id, inv.id, patch, "mcp");
      return ok(`Entwurf aktualisiert: ${updated.number ?? "Entwurf " + updated.id.slice(0, 8)} · Netto ${formatCents(updated.netTotalCents)} · Brutto ${formatCents(updated.grossTotalCents)}.`);
    } catch (e) {
      if (e instanceof InvoiceUpdateError) return fail(e.message);
      if (e instanceof z.ZodError) return fail(`Validierung fehlgeschlagen: ${e.issues.map((i) => i.message).join("; ")}`);
      return fail(`Fehler: ${(e as Error).message}`);
    }
  },
);

// ── add_attachment ───────────────────────────────────────────────────────────
server.registerTool(
  "add_attachment",
  {
    title: "Beleganhang hochladen",
    description:
      "Fuegt einem Beleg (Rechnung/Angebot/Lieferschein/Abo/Mahnung) einen Anhang hinzu. Dateiinhalt als Base64. Gleiche Grenzen/Whitelist wie im UI (10 MB je Datei, 50 MB je Beleg, keine ausfuehrbaren Formate, Magic-Bytes-Pruefung).",
    inputSchema: {
      docType: DocRefType,
      docId: z.string().describe("Belegnummer oder ID"),
      filename: z.string(),
      mime: z.string().describe("MIME-Typ, z. B. application/pdf"),
      contentBase64: z.string().describe("Dateiinhalt Base64-kodiert"),
    },
  },
  async (args): Promise<Result> => {
    try {
      // G2: Base64-Laenge VOR dem Dekodieren gegen die Datei-Obergrenze pruefen — ein
      // riesiger Base64-String wuerde sonst erst vollstaendig in einen Buffer dekodiert
      // (bis zu ~33 % groesser im Speicher) und danach ERST von addAttachment abgelehnt.
      // Base64 kodiert 3 Rohbytes in 4 Zeichen -> max. zulaessige Zeichenlaenge =
      // ceil(MAX_BYTES * 4/3) + 4 (Puffer fuer Padding/Zeilenumbrueche).
      const maxBase64Length = Math.ceil((MAX_ATTACHMENT_FILE_BYTES * 4) / 3) + 4;
      if (args.contentBase64.length > maxBase64Length) {
        return fail(`Anhang ueberschreitet die Groesse von ${MAX_ATTACHMENT_FILE_BYTES / (1024 * 1024)} MB.`);
      }
      const org = await requireOrg();
      const doc = await resolveDocForAttachment(org.id, args.docType, args.docId);
      const buffer = Buffer.from(args.contentBase64, "base64");
      const row = await addAttachment(org.id, args.docType, doc.id, { filename: args.filename, mime: args.mime, buffer }, "mcp");
      return ok(`Anhang gespeichert: ${row.filename} (${(row.sizeBytes / 1024).toFixed(0)} KB). ID: ${row.id}.`);
    } catch (e) {
      if (e instanceof AttachmentValidationError) return fail(e.message);
      return fail(`Fehler: ${(e as Error).message}`);
    }
  },
);

// ── list_attachments ─────────────────────────────────────────────────────────
server.registerTool(
  "list_attachments",
  {
    title: "Beleganhaenge auflisten",
    description: "Listet die Anhaenge eines Belegs.",
    inputSchema: {
      docType: DocRefType,
      docId: z.string().describe("Belegnummer oder ID"),
    },
  },
  async (args): Promise<Result> => {
    try {
      const org = await requireOrg();
      const doc = await resolveDocForAttachment(org.id, args.docType, args.docId);
      const rows = await listAttachments(org.id, args.docType, doc.id);
      if (rows.length === 0) return ok("Keine Anhaenge.");
      return ok(
        JSON.stringify(
          rows.map((r) => ({ id: r.id, filename: r.filename, mime: r.mime, sizeBytes: r.sizeBytes, uploadedAt: r.createdAt.toISOString() })),
          null,
          2,
        ),
      );
    } catch (e) {
      return fail(`Fehler: ${(e as Error).message}`);
    }
  },
);

// ── remove_attachment ────────────────────────────────────────────────────────
server.registerTool(
  "remove_attachment",
  {
    title: "Beleganhang entfernen",
    description: "Entfernt einen Anhang von einem Beleg (kein GoBD-Beleg — die Datei ist loeschbar, die Aktion geht ins ChangeLog).",
    inputSchema: {
      docType: DocRefType,
      docId: z.string().describe("Belegnummer oder ID"),
      attachmentId: z.string(),
    },
  },
  async (args): Promise<Result> => {
    try {
      const org = await requireOrg();
      const doc = await resolveDocForAttachment(org.id, args.docType, args.docId);
      await removeAttachment(org.id, args.docType, doc.id, args.attachmentId, "mcp");
      return ok(`Anhang ${args.attachmentId} entfernt.`);
    } catch (e) {
      if (e instanceof NotFoundError) return fail(e.message);
      return fail(`Fehler: ${(e as Error).message}`);
    }
  },
);

// ── Start ─────────────────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr, damit stdout dem JSON-RPC vorbehalten bleibt
  console.error("[open-invoice-germany] MCP-Server bereit (stdio).");
}

// Nur starten, wenn direkt ausgeführt (nicht beim Import in Unit-Tests).
const isEntrypoint = process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`;
if (isEntrypoint) {
  main().catch((e) => {
    console.error("[open-invoice-germany] Fehler:", e);
    process.exit(1);
  });
}
