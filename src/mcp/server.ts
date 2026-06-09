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
import { roundHalfUp, formatCents } from "@/lib/money";
import { defaultCategoryForScheme } from "@/lib/tax";
import { SCHEME_NOTICE } from "@/domain/invoice/mandatory";
import { createDraftInvoice } from "@/domain/invoice/create";
import { finalizeInvoice, FinalizeError } from "@/domain/invoice/finalize";
import { cancelInvoice, CancelError } from "@/domain/invoice/cancel";
import { createPartialCreditNote, CreditError } from "@/domain/invoice/credit";
import { recordPayment, PaymentError } from "@/domain/invoice/payment";
import { createDunning, DunningError } from "@/domain/dunning/create";
import { createRecurring, RecurringError } from "@/domain/recurring/create";
import { emitRecurringNow, runDueRecurring } from "@/domain/recurring/run";
import { intervalLabel } from "@/lib/recurring";
import { createBusinessDocument } from "@/domain/document/create";
import { convertDocumentToInvoice, ConvertError } from "@/domain/document/convert";
import { loadEInvoiceData } from "@/lib/einvoice/load";
import { buildXRechnungUBL } from "@/lib/einvoice/xrechnung";
import { renderZugferdPdf } from "@/lib/einvoice/zugferd";
import { validateXRechnung } from "@/lib/einvoice/en16931-core";
import { renderInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { organizationSchema, customerSchema, createInvoiceSchema, createDocumentSchema, recordPaymentSchema, createRecurringSchema, TaxScheme } from "@/schemas";

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

async function resolveInvoice(orgId: string, ref: string) {
  const inv = await dbInternal.invoice.findFirst({ where: { orgId, OR: [{ id: ref }, { number: ref }] } });
  if (!inv) throw new Error(`Keine Rechnung "${ref}" gefunden (weder als ID noch als Nummer).`);
  return inv;
}

async function resolveDocument(orgId: string, ref: string) {
  const q = await dbInternal.quote.findFirst({ where: { orgId, OR: [{ id: ref }, { number: ref }] } });
  if (!q) throw new Error(`Kein Dokument "${ref}" gefunden.`);
  return q;
}

/** Wandelt MCP-Positionen (mit €/Menge oder Katalog-Verweis) in DB-Positionen um (Schema REGULAR, Kategorie S). */
async function buildSimpleLines(
  orgId: string,
  inputLines: { description: string; quantity: number; unitPriceEuro?: number; productName?: string; unit?: string; taxRatePercent?: number }[],
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
      discountPermille: 0,
    };
  });
}

const server = new McpServer({ name: "open-invoice-germany", version: "0.1.0" });

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
      notes: z.string().optional(),
    },
  },
  async (args): Promise<Result> => {
    try {
      const org = await requireOrg();
      const v = customerSchema.parse({ ...args, email: args.email ?? "" });
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
    },
  },
  async (args): Promise<Result> => {
    try {
      const org = await requireOrg();
      const data = {
        name: args.name,
        description: args.description ?? null,
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
          }),
        )
        .min(1),
      taxScheme: TaxScheme.optional().describe("Default: Schema des Unternehmens (sonst REGULAR)"),
      deliveryDate: z.string().optional().describe("Leistungsdatum YYYY-MM-DD oder 'heute' (Pflicht für Festschreiben)"),
      dueDate: z.string().optional(),
      notes: z.string().optional(),
      paymentTerms: z.string().optional(),
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
        };
      });

      const notice = SCHEME_NOTICE[scheme];
      const notes = notice ? `${notice}${args.notes ? " — " + args.notes : ""}` : args.notes;

      const input = createInvoiceSchema.parse({
        customerId: customer.id,
        type: "INVOICE",
        taxScheme: scheme,
        currency: "EUR",
        deliveryDate: parseDateInput(args.deliveryDate),
        dueDate: parseDateInput(args.dueDate),
        notes,
        paymentTerms: args.paymentTerms,
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
      const invoice = await convertDocumentToInvoice(doc.id);
      return ok(`Umgewandelt: ${doc.number} → Rechnungs-Entwurf ${invoice.id}. Mit finalize_invoice festschreiben.`);
    } catch (e) {
      if (e instanceof ConvertError) return fail(e.message);
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
    description: "Erfasst einen Zahlungseingang auf eine festgeschriebene Rechnung und aktualisiert offenen Betrag + Status (bezahlt/teilbezahlt).",
    inputSchema: {
      invoice: z.string().describe("Rechnungs-ID oder -Nummer"),
      amountEuro: z.number().describe("Gezahlter Betrag in Euro"),
      method: z.enum(["TRANSFER", "CASH", "CARD", "SEPA"]).default("TRANSFER"),
      reference: z.string().optional(),
    },
  },
  async (args): Promise<Result> => {
    try {
      const org = await requireOrg();
      const inv = await resolveInvoice(org.id, args.invoice);
      const updated = await recordPayment(
        inv.id,
        recordPaymentSchema.parse({ amountCents: euroToCents(args.amountEuro), method: args.method, reference: args.reference }),
      );
      const open = updated.grossTotalCents - updated.paidAmountCents;
      return ok(`Zahlung erfasst. Status: ${updated.status} · offen: ${formatCents(open)}.`);
    } catch (e) {
      if (e instanceof PaymentError) return fail(e.message);
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
      "Erstellt die nächste Mahnstufe (Zahlungserinnerung → 1./2. Mahnung) zu einer überfälligen, offenen Rechnung. Ab Stufe 1 mit Verzugszins (§ 288 BGB) und 40-€-Pauschale (nur B2B).",
    inputSchema: { invoice: z.string().describe("Rechnungs-ID oder -Nummer") },
  },
  async ({ invoice }): Promise<Result> => {
    try {
      const org = await requireOrg();
      const inv = await resolveInvoice(org.id, invoice);
      const res = await createDunning(inv.id);
      const title = ["Zahlungserinnerung", "1. Mahnung", "2. Mahnung"][res.level] ?? `${res.level}. Mahnung`;
      return ok(`${title} ${res.dunning.number} erstellt · offen ${formatCents(res.openAmountCents)} · Gesamtforderung ${formatCents(res.totalCents)}.`);
    } catch (e) {
      if (e instanceof DunningError) return fail(e.message);
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

// ── Start ─────────────────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr, damit stdout dem JSON-RPC vorbehalten bleibt
  console.error("[open-invoice-germany] MCP-Server bereit (stdio).");
}

main().catch((e) => {
  console.error("[open-invoice-germany] Fehler:", e);
  process.exit(1);
});
