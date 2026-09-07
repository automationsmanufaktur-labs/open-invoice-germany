// ── Produkte/Leistungen ───────────────────────────────────────────────────────
// Task 1 (Phase 9): Move aus server.ts + Paritaets-Fix (upsert_product nutzt jetzt
// productSchema wie saveProduct/createProductInline, statt eines eigenen inline-Zod-
// Objekts ohne "differential"/§25a-Unterstuetzung — sonst Drift, Lastenheft §55) +
// neue Tools update_product/archive_product (Domain: archiveProduct aus
// src/domain/product/archive.ts, analog zu Kunden).
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { dbInternal } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { assignArticleNumber } from "@/domain/numbering/ranges";
import { archiveProduct } from "@/domain/product/archive";
import { productSchema, TaxRate } from "@/schemas";
import { ToolError, type McpToolsContext, type Result } from "./context";

async function resolveProduct(orgId: string, ref: string) {
  const byId = await dbInternal.product.findFirst({ where: { id: ref, orgId } });
  if (byId) return byId;
  const all = await dbInternal.product.findMany({ where: { orgId, isArchived: false } });
  const lower = ref.trim().toLowerCase();
  const exact = all.filter((p) => p.name.toLowerCase() === lower);
  if (exact.length === 1) return exact[0];
  const contains = all.filter((p) => p.name.toLowerCase().includes(lower));
  if (contains.length === 1) return contains[0];
  if (contains.length > 1)
    throw new ToolError(`Mehrere Produkte passen zu "${ref}": ${contains.map((p) => p.name).join(", ")}. Bitte präzisieren.`);
  throw new ToolError(`Kein Produkt "${ref}" gefunden.`);
}

export function registerProductTools(server: McpServer, ctx: McpToolsContext): void {
  // ── list_products ────────────────────────────────────────────────────────────
  server.registerTool(
    "list_products",
    {
      title: "Produkte/Leistungen auflisten",
      description: "Listet den Katalog der gespeicherten Produkte/Leistungen.",
      inputSchema: { query: z.string().optional() },
    },
    async ({ query }): Promise<Result> => {
      // Testbarkeit-/Korrektheits-Fix (Task 2): fehlte bisher orgId im where — listete
      // Produkte ueber ALLE Organisationen hinweg statt nur der aktiven (anders als jedes
      // andere Produkt-Tool in dieser Datei, die alle ueber ctx.requireOrg()+orgId scopen).
      // Fix-Welle Punkt 4: requireOrg jetzt innerhalb try/catch (analog list_documents in
      // documents.ts) statt ungefangen durchzuwerfen.
      let org: Awaited<ReturnType<typeof ctx.requireOrg>>;
      try {
        org = await ctx.requireOrg();
      } catch {
        return ctx.fail("Kein Unternehmen eingerichtet. Zuerst setup_company.");
      }
      const all = await dbInternal.product.findMany({ where: { orgId: org.id, isArchived: false }, orderBy: { name: "asc" } });
      const filtered = query ? all.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())) : all;
      return ctx.ok(
        JSON.stringify(
          filtered.map((p) => ({ id: p.id, name: p.name, unit: p.unit, netPrice: formatCents(p.netPriceCents), taxRate: p.taxRate, differential: p.differential })),
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
      // Fix-Welle Punkt 8: Feldliste aus productSchema komponiert statt handgepflegtem
      // inline-Zod (analog update_product) — sonst driften upsert_product und productSchema
      // auseinander. netPriceCents/taxRate/taxCategory bleiben ausgenommen: der MCP-
      // Aufrufer uebergibt netPriceEuro (Euro statt Cent) und taxRatePercent (leitet
      // taxCategory ab). Lookup-Feld "name" bleibt ueber productSchema (min(1)) Pflicht.
      inputSchema: {
        ...productSchema.omit({ netPriceCents: true, taxRate: true, taxCategory: true }).shape,
        netPriceEuro: z.number().describe("Nettopreis in Euro, z. B. 95 oder 95.50"),
        taxRatePercent: TaxRate.default(19),
      },
    },
    async (args): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const { netPriceEuro, taxRatePercent, ...rest } = args;
        // Paritaet mit saveProduct/createProductInline (Server Actions): dieselbe Zod
        // (productSchema) statt eines eigenen Objekts — sonst Drift (§25a "differential"
        // fehlte vorher am MCP-Pfad). taxRatePercent separat gegen dieselbe TaxRate-Union
        // geprueft, mit der auch productSchema.taxRate validiert (die Tools rufen den
        // Handler in Tests direkt auf, ohne die SDK-Dispatch-Validierung des inputSchema —
        // die Laufzeitpruefung muss also im Handler selbst stattfinden, nicht nur in der
        // inputSchema-Deklaration).
        const v = productSchema.omit({ netPriceCents: true, taxRate: true, taxCategory: true }).parse(rest);
        const taxRate = TaxRate.default(19).parse(taxRatePercent);
        const data = {
          name: v.name,
          description: v.description ?? null,
          articleNumber: v.articleNumber ?? null,
          unit: v.unit,
          netPriceCents: ctx.euroToCents(netPriceEuro),
          taxRate,
          taxCategory: taxRate === 0 ? "Z" : "S",
          differential: v.differential,
        };
        const existing = (await dbInternal.product.findMany({ where: { orgId: org.id, isArchived: false } })).find(
          (p) => p.name.toLowerCase() === v.name.toLowerCase(),
        );
        const product = existing
          ? await dbInternal.product.update({ where: { id: existing.id }, data })
          : await dbInternal.$transaction(async (tx) => {
              const articleNumber = data.articleNumber ?? (await assignArticleNumber(tx, org.id));
              return tx.product.create({ data: { ...data, articleNumber, orgId: org.id } });
            });
        return ctx.ok(`Produkt ${existing ? "aktualisiert" : "gespeichert"}: ${product.name} — ${formatCents(product.netPriceCents)} / ${product.unit}.`);
      } catch (e) {
        if (e instanceof z.ZodError) return ctx.fail(`Validierung fehlgeschlagen: ${e.issues.map((i) => i.message).join("; ")}`);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── update_product ───────────────────────────────────────────────────────────
  // Fix-Runde 1 (Koordinator, Task 1): Feldliste jetzt aus productSchema.partial()
  // komponiert statt handgepflegtem inline-Zod (analog update_customer) — sonst driften
  // die Felder auseinander. netPriceCents/taxRate/taxCategory bleiben ausgenommen: der
  // MCP-Aufrufer uebergibt netPriceEuro (Euro statt Cent) und taxRatePercent (leitet
  // taxCategory ab), wie bei upsert_product.
  server.registerTool(
    "update_product",
    {
      title: "Produkt/Leistung bearbeiten (per ID/Name)",
      description:
        "Aktualisiert ein bestehendes Produkt gezielt per ID oder Name (anders als upsert_product KEIN Anlegen). Nicht angegebene Felder bleiben unveraendert.",
      inputSchema: {
        product: z.string().describe("Produkt-ID oder -Name"),
        ...productSchema.partial().omit({ netPriceCents: true, taxRate: true, taxCategory: true }).shape,
        netPriceEuro: z.number().optional(),
        taxRatePercent: z.union([z.literal(19), z.literal(7), z.literal(0)]).optional(),
      },
    },
    async (args): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const existing = await resolveProduct(org.id, args.product);
        const { product: _productRef, netPriceEuro, taxRatePercent, ...rest } = args;
        void _productRef;
        const v = productSchema.partial().omit({ netPriceCents: true, taxRate: true, taxCategory: true }).parse(rest);
        // NUR die tatsaechlich uebergebenen Felder patchen: zod fuellt bei .partial()
        // fehlende Schluessel mit dem Schema-Default (z. B. unit="C62",
        // differential=false) statt sie undefined zu lassen — ein blindes `{ ...v }`
        // wuerde also nicht angegebene Felder stillschweigend zuruecksetzen.
        const patch: Record<string, unknown> = {};
        for (const key of Object.keys(rest) as (keyof typeof v)[]) {
          if ((rest as Record<string, unknown>)[key as string] !== undefined) patch[key as string] = v[key];
        }
        if (netPriceEuro !== undefined) patch.netPriceCents = ctx.euroToCents(netPriceEuro);
        if (taxRatePercent !== undefined) {
          patch.taxRate = taxRatePercent;
          patch.taxCategory = taxRatePercent === 0 ? "Z" : "S";
        }
        const product = await dbInternal.product.update({ where: { id: existing.id }, data: patch });
        return ctx.ok(`Produkt aktualisiert: ${product.name} — ${formatCents(product.netPriceCents)} / ${product.unit}.`);
      } catch (e) {
        if (e instanceof z.ZodError) return ctx.fail(`Validierung fehlgeschlagen: ${e.issues.map((i) => i.message).join("; ")}`);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── archive_product ──────────────────────────────────────────────────────────
  server.registerTool(
    "archive_product",
    {
      title: "Produkt archivieren",
      description: "Archiviert ein Produkt (verschwindet aus list_products/dem Katalog-Picker, bleibt aber in bestehenden Belegen als Snapshot erhalten).",
      inputSchema: { product: z.string().describe("Produkt-ID oder -Name") },
    },
    async ({ product }): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const existing = await resolveProduct(org.id, product);
        await archiveProduct(org.id, existing.id);
        return ctx.ok(`Produkt archiviert: ${existing.name}.`);
      } catch (e) {
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );
}
