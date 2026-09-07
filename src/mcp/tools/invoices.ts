// ── Rechnungen (Entwurf, Festschreiben, Storno, Teil-/Abschlags-/Schlussrechnung,
//    Gutschrift, Export, Liste) ────────────────────────────────────────────────
// Task 1 (Phase 9): reiner Move aus server.ts — Verhalten unveraendert.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { PROJECT_ROOT } from "../bootstrap";
import { dbInternal } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { defaultCategoryForScheme } from "@/lib/tax";
import { SCHEME_NOTICE } from "@/domain/invoice/mandatory";
import { createDraftInvoice } from "@/domain/invoice/create";
import { finalizeInvoice, FinalizeError } from "@/domain/invoice/finalize";
import { cancelInvoice, CancelError } from "@/domain/invoice/cancel";
import { createPartialCreditNote, CreditError } from "@/domain/invoice/credit";
import { createPartialInvoice, PartialInvoiceError } from "@/domain/invoice/partial";
import { createDownpaymentInvoice, DownpaymentInvoiceError } from "@/domain/invoice/downpayment";
import { createFinalInvoice, FinalInvoiceError } from "@/domain/invoice/final";
import { billingStateFor } from "@/domain/document/billing-state";
import { PricingError } from "@/lib/pricing/errors";
import { listInvoices } from "@/domain/invoice/list";
import { updateDraftInvoice, InvoiceUpdateError } from "@/domain/invoice/update";
import { loadEInvoiceData } from "@/lib/einvoice/load";
import { buildXRechnungUBL } from "@/lib/einvoice/xrechnung";
import { renderZugferdPdf } from "@/lib/einvoice/zugferd";
import { validateXRechnung } from "@/lib/einvoice/en16931-core";
import { renderInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { loadPdfTheme } from "@/domain/settings/theme";
import { onEInvoiceInvalid } from "@/domain/notifications/hooks";
import { NotFoundError } from "@/domain/errors";
import {
  TaxScheme,
  createInvoiceSchema,
  createPartialInvoiceSchema,
  createDownpaymentInvoiceSchema,
  createFinalInvoiceSchema,
  invoiceListFilterSchema,
  LineType,
} from "@/schemas";
import { docLineSchema, ToolError, type McpToolsContext, type Result } from "./context";

export function registerInvoiceTools(server: McpServer, ctx: McpToolsContext): void {
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
        const org = await ctx.requireOrg();
        const customer = await ctx.resolveCustomer(org.id, args.customer);
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
            if (!p) throw new ToolError(`Produkt "${l.productName}" (Position ${idx + 1}) nicht gefunden.`);
            unitPriceEuro = p.netPriceCents / 100;
            unit = unit ?? p.unit;
            taxRatePercent = taxRatePercent ?? p.taxRate;
            description = description || p.name;
          }
          if (unitPriceEuro == null) throw new ToolError(`Position ${idx + 1} braucht unitPriceEuro oder productName.`);
          return {
            description,
            quantityMilli: ctx.qtyToMilli(l.quantity),
            unit: unit ?? "C62",
            unitNetPriceCents: ctx.euroToCents(unitPriceEuro),
            taxRate: isRegular ? (taxRatePercent ?? 19) : 0,
            taxCategory: category,
            discountPermille: l.discountPercent ? Math.round(l.discountPercent * 10) : 0,
            discountCents: l.discountAmount ? ctx.euroToCents(l.discountAmount) : 0,
          };
        });

        const notice = SCHEME_NOTICE[scheme];
        const notes = notice ? `${notice}${args.notes ? " — " + args.notes : ""}` : args.notes;
        const paymentMethod = args.paymentMethod ? await ctx.resolvePaymentMethod(org.id, args.paymentMethod) : null;

        const input = createInvoiceSchema.parse({
          customerId: customer.id,
          type: "INVOICE",
          taxScheme: scheme,
          currency: "EUR",
          deliveryDate: ctx.parseDateInput(args.deliveryDate),
          dueDate: ctx.parseDateInput(args.dueDate),
          notes,
          paymentTerms: args.paymentTerms,
          documentDiscountPermille: args.documentDiscountPercent ? Math.round(args.documentDiscountPercent * 10) : undefined,
          documentDiscountCents: args.documentDiscountEuro ? ctx.euroToCents(args.documentDiscountEuro) : undefined,
          documentChargePermille: args.documentChargePercent ? Math.round(args.documentChargePercent * 10) : undefined,
          documentChargeCents: args.documentChargeEuro ? ctx.euroToCents(args.documentChargeEuro) : undefined,
          documentChargeReason: args.documentChargeReason,
          skonto1Permille: args.skonto1Percent ? Math.round(args.skonto1Percent * 10) : undefined,
          skonto1Days: args.skonto1Days,
          skonto2Permille: args.skonto2Percent ? Math.round(args.skonto2Percent * 10) : undefined,
          skonto2Days: args.skonto2Days,
          paymentMethodId: paymentMethod?.id,
          lines,
        });
        const invoice = await createDraftInvoice(org.id, input);
        return ctx.ok(
          `Entwurf angelegt für ${customer.name}.\n` +
            `ID: ${invoice.id}\nNetto: ${formatCents(invoice.netTotalCents)} · USt: ${formatCents(invoice.taxTotalCents)} · Brutto: ${formatCents(invoice.grossTotalCents)}\n` +
            `Nächster Schritt: finalize_invoice (vergibt die Rechnungsnummer, macht GoBD-konform unveränderbar).`,
        );
      } catch (e) {
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
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
        const org = await ctx.requireOrg();
        const inv = await ctx.resolveInvoice(org.id, invoice);
        const finalized = await finalizeInvoice(inv.id);
        return ctx.ok(`Festgeschrieben: ${finalized.number} · Brutto ${formatCents(finalized.grossTotalCents)}. Unveränderbar. Export mit export_invoice.`);
      } catch (e) {
        if (e instanceof FinalizeError) return ctx.fail(`Festschreiben nicht möglich:\n${e.message}`);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
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
        const org = await ctx.requireOrg();
        const inv = await ctx.resolveInvoice(org.id, invoice);
        const res = await cancelInvoice(inv.id);
        return ctx.ok(`Storniert. Storno-Gutschrift ${res.creditNote.number} zu ${res.originalNumber} angelegt.`);
      } catch (e) {
        if (e instanceof CancelError) return ctx.fail(`Storno nicht möglich: ${e.message}`);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
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
        const org = await ctx.requireOrg();
        const ref = await ctx.resolveInvoice(org.id, invoice);
        const inv = await dbInternal.invoice.findUnique({
          where: { id: ref.id },
          include: { lines: { orderBy: { position: "asc" } }, customer: true },
        });
        if (!inv) return ctx.fail("Nicht gefunden.");
        return ctx.ok(
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
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── list_invoices ────────────────────────────────────────────────────────────
  // Task 4 (Facts): ersetzt die bisherige, einfache Version (Status als Rohstring, kein
  // Org-Scoping-via-requireOrg — CLAUDE.md "Nichts doppelt bauen") durch listInvoices
  // (Task 1) mit vollem Filterschema.
  server.registerTool(
    "list_invoices",
    {
      title: "Rechnungen auflisten/filtern",
      description:
        "Listet Rechnungen mit Filter/Suche/Paginierung (§40) — Status (effektiv: draft/open/due/overdue/partial/paid/cancelled/all), Typ, Zeitraum, Betragsspanne, Volltextsuche.",
      inputSchema: {
        ...invoiceListFilterSchema.shape,
        customer: z.string().optional().describe("Kundenname oder -ID (Alternative zu customerId)"),
      },
    },
    async (args): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const { customer, ...filter } = args;
        let customerId = filter.customerId;
        if (customer) {
          const c = await ctx.resolveCustomer(org.id, customer);
          customerId = c.id;
        }
        const result = await listInvoices(org.id, { ...filter, customerId });
        return ctx.ok(
          JSON.stringify(
            {
              total: result.total,
              limit: result.limit,
              offset: result.offset,
              rows: result.rows.map((r) => ({
                id: r.id,
                number: r.number,
                type: r.type,
                customer: r.customerName,
                issueDate: r.issueDate.toISOString().slice(0, 10),
                dueDate: r.dueDate ? r.dueDate.toISOString().slice(0, 10) : null,
                gross: formatCents(r.grossTotalCents),
                open: formatCents(r.openCents),
                status: r.effectiveStatus,
              })),
            },
            null,
            2,
          ),
        );
      } catch (e) {
        if (e instanceof z.ZodError) return ctx.fail(`Validierung fehlgeschlagen: ${e.issues.map((i) => i.message).join("; ")}`);
        if (e instanceof NotFoundError) return ctx.fail(e.message);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
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
        const org = await ctx.requireOrg();
        const ref = await ctx.resolveInvoice(org.id, invoice);
        const loaded = await loadEInvoiceData(ref.id);
        if (!loaded) return ctx.fail("Nicht gefunden.");
        const inv = loaded.invoice;
        const data = loaded.data;
        const dir = outputDir ? path.resolve(outputDir) : path.join(PROJECT_ROOT, "exports");
        mkdirSync(dir, { recursive: true });
        const base = (inv.number ?? `entwurf-${inv.id.slice(0, 8)}`).replace(/[^A-Za-z0-9._-]/g, "_");
        const written: string[] = [];
        let validation: { valid: boolean; errors: string[] } | null = null;
        const theme = await loadPdfTheme(org.id, inv.printOptionsJson);

        if (format === "both" || format === "pdf") {
          const pdf = await renderInvoicePdf(data, theme);
          const pdfPath = path.join(dir, `${base}.pdf`);
          writeFileSync(pdfPath, pdf);
          written.push(pdfPath);
        }
        if (format === "both" || format === "xrechnung") {
          if (inv.status === "DRAFT") {
            if (format === "xrechnung") return ctx.fail("XRechnung nur für festgeschriebene Rechnungen. Zuerst finalize_invoice.");
          } else {
            const xml = buildXRechnungUBL(data);
            validation = validateXRechnung(data, xml);
            const xmlPath = path.join(dir, `${base}.xml`);
            writeFileSync(xmlPath, xml, "utf8");
            written.push(xmlPath);
          }
        }
        if (format === "zugferd") {
          if (inv.status === "DRAFT") return ctx.fail("ZUGFeRD nur für festgeschriebene Rechnungen. Zuerst finalize_invoice.");
          const zpdf = await renderZugferdPdf(data, theme);
          const zpath = path.join(dir, `${base}-zugferd.pdf`);
          writeFileSync(zpath, zpdf);
          written.push(zpath);
        }
        if (validation && !validation.valid) {
          // Task 4 (Facts): Benachrichtigung auch am MCP-Export-Pfad, wenn die EN-16931-
          // Kernvalidierung fehlschlaegt — analog den beiden HTTP-Export-Routen.
          await onEInvoiceInvalid(org.id, { invoiceId: inv.id, errors: validation.errors });
        }
        return ctx.ok(
          `Export geschrieben:\n${written.join("\n")}` +
            (validation ? `\nEN-16931-Kernvalidierung: ${validation.valid ? "BESTANDEN" : "FEHLER: " + validation.errors.join("; ")}` : ""),
        );
      } catch (e) {
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
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
        const org = await ctx.requireOrg();
        // Der MCP-SDK-Client wendet Zod-Defaults aus inputSchema an; direkte Testaufrufe
        // (server["_registeredTools"][name].handler(args)) umgehen das — hier zusaetzlich
        // defensiv defaulten, damit beide Aufrufwege identisch funktionieren.
        const effectiveSourceType = sourceType ?? "QUOTE";
        const src = effectiveSourceType === "DELIVERY_NOTE" ? await ctx.resolveDeliveryNote(org.id, source) : await ctx.resolveDocument(org.id, source);
        const input = createPartialInvoiceSchema.parse({
          sourceType: effectiveSourceType,
          sourceId: src.id,
          mode,
          permille: percent != null ? Math.round(percent * 10) : undefined,
          amountCents: amountEuro != null ? ctx.euroToCents(amountEuro) : undefined,
          lineIds,
          quantities,
        });
        const invoice = await createPartialInvoice(org.id, input);
        return ctx.ok(`Teilrechnung angelegt: Entwurf ${invoice.id} (${formatCents(invoice.grossTotalCents)} brutto). Mit finalize_invoice festschreiben.`);
      } catch (e) {
        if (e instanceof z.ZodError) return ctx.fail(`Validierung fehlgeschlagen: ${e.issues.map((i) => i.message).join("; ")}`);
        if (e instanceof PartialInvoiceError || e instanceof PricingError) return ctx.fail(e.message);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
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
        const org = await ctx.requireOrg();
        const quote = await ctx.resolveDocument(org.id, source);
        const input = createDownpaymentInvoiceSchema.parse({
          sourceType: "QUOTE",
          sourceId: quote.id,
          mode,
          permille: percent != null ? Math.round(percent * 10) : undefined,
          amountCents: amountEuro != null ? ctx.euroToCents(amountEuro) : undefined,
          amountIsGross,
        });
        const invoice = await createDownpaymentInvoice(org.id, input);
        return ctx.ok(`Abschlagsrechnung angelegt: Entwurf ${invoice.id} (${formatCents(invoice.grossTotalCents)} brutto). Mit finalize_invoice festschreiben.`);
      } catch (e) {
        if (e instanceof z.ZodError) return ctx.fail(`Validierung fehlgeschlagen: ${e.issues.map((i) => i.message).join("; ")}`);
        if (e instanceof DownpaymentInvoiceError || e instanceof PricingError) return ctx.fail(e.message);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
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
        const org = await ctx.requireOrg();
        const quote = await ctx.resolveDocument(org.id, source);
        const input = createFinalInvoiceSchema.parse({ sourceType: "QUOTE", sourceId: quote.id });
        const invoice = await createFinalInvoice(org.id, input);
        return ctx.ok(`Schlussrechnung angelegt: Entwurf ${invoice.id}. Mit finalize_invoice festschreiben (Abzugs-Snapshot/Restbetrag werden dabei berechnet).`);
      } catch (e) {
        if (e instanceof z.ZodError) return ctx.fail(`Validierung fehlgeschlagen: ${e.issues.map((i) => i.message).join("; ")}`);
        if (e instanceof FinalInvoiceError) return ctx.fail(e.message);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
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
        const org = await ctx.requireOrg();
        const doc = await ctx.resolveDocument(org.id, document);
        const billing = await billingStateFor(org.id, "QUOTE", doc.id);
        return ctx.ok(
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
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
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
        const org = await ctx.requireOrg();
        const inv = await ctx.resolveInvoice(org.id, args.invoice);
        const lines = (await ctx.buildSimpleLines(org.id, args.lines)).map((l) => ({
          description: l.description,
          quantityMilli: l.quantityMilli,
          unit: l.unit,
          unitNetPriceCents: l.unitNetPriceCents,
          taxRate: l.taxRate,
          taxCategory: l.taxCategory,
        }));
        const res = await createPartialCreditNote(inv.id, { lines, notes: args.notes });
        return ctx.ok(`Teilgutschrift ${res.creditNote.number} zu ${res.originalNumber} erstellt · Brutto ${formatCents(res.creditNote.grossTotalCents)}.`);
      } catch (e) {
        if (e instanceof CreditError) return ctx.fail(e.message);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
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
        const org = await ctx.requireOrg();
        const inv = await ctx.resolveInvoice(org.id, args.invoice);
        const patch: Record<string, unknown> = {};
        if (args.subject !== undefined) patch.subject = args.subject;
        if (args.orderNumber !== undefined) patch.orderNumber = args.orderNumber;
        if (args.internalReference !== undefined) patch.internalReference = args.internalReference;
        if (args.buyerReference !== undefined) patch.buyerReference = args.buyerReference;
        if (args.notes !== undefined) patch.notes = args.notes;
        if (args.internalNotes !== undefined) patch.internalNotes = args.internalNotes;
        if (args.paymentTerms !== undefined) patch.paymentTerms = args.paymentTerms;
        if (args.dueDate !== undefined) patch.dueDate = ctx.parseDateInput(args.dueDate);
        if (args.deliveryDate !== undefined) patch.deliveryDate = ctx.parseDateInput(args.deliveryDate);
        if (args.lines) patch.lines = await ctx.buildEditorLines(org.id, args.lines);

        const updated = await updateDraftInvoice(org.id, inv.id, patch, "mcp");
        return ctx.ok(`Entwurf aktualisiert: ${updated.number ?? "Entwurf " + updated.id.slice(0, 8)} · Netto ${formatCents(updated.netTotalCents)} · Brutto ${formatCents(updated.grossTotalCents)}.`);
      } catch (e) {
        if (e instanceof InvoiceUpdateError) return ctx.fail(e.message);
        if (e instanceof z.ZodError) return ctx.fail(`Validierung fehlgeschlagen: ${e.issues.map((i) => i.message).join("; ")}`);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );
}
