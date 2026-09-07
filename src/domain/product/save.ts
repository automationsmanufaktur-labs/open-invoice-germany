/**
 * Anlegen/Aendern eines Produkts — EINZIGE Domain-Funktion fuer Server-Actions
 * (`saveProduct`/`createProductInline`, src/app/actions/masterdata.ts), MCP-Tools
 * (`upsert_product`/`update_product`, src/mcp/tools/products.ts) und die REST-API
 * (POST/PATCH /api/v1/Product). Fix-Runde 1 zu Phase 10 Task 2 (Koordinator-Ruling a,
 * 2026-09-04): ersetzt die bisher dreifach duplizierte Anlage-/Aenderungslogik.
 *
 * `updateProduct` folgt PATCH-Semantik wie `updateCustomer`
 * (src/domain/customer/save.ts) — siehe dort fuer die ausfuehrliche Begruendung.
 */
import { dbInternal } from "@/lib/db";
import { productSchema, type ProductInput } from "@/schemas";
import { assignArticleNumber } from "@/domain/numbering/ranges";
import { NotFoundError } from "@/domain/errors";
import type { Product } from "@/generated/prisma/client";

function toCreateData(v: ProductInput) {
  return {
    name: v.name,
    description: v.description ?? null,
    articleNumber: v.articleNumber ?? null,
    unit: v.unit,
    netPriceCents: v.netPriceCents,
    taxRate: v.taxRate,
    taxCategory: v.taxCategory,
    differential: v.differential,
  };
}

/** Legt ein neues Produkt an. Artikelnummer per Nummernkreis (PRODUCT), sofern im Input
 *  nicht bereits gesetzt (§34). */
export async function createProduct(orgId: string, rawInput: unknown): Promise<Product> {
  const v = productSchema.parse(rawInput);
  const data = toCreateData(v);
  return dbInternal.$transaction(async (tx) => {
    const articleNumber = data.articleNumber ?? (await assignArticleNumber(tx, orgId));
    return tx.product.create({ data: { ...data, articleNumber, orgId } });
  });
}

const NULLABLE_ON_EMPTY = new Set(["description", "articleNumber"]);

export async function updateProduct(orgId: string, id: string, rawInput: unknown): Promise<Product> {
  const raw = rawInput && typeof rawInput === "object" ? (rawInput as Record<string, unknown>) : {};
  const v = productSchema.partial().parse(raw);

  const existing = await dbInternal.product.findFirst({ where: { id, orgId } });
  if (!existing) throw new NotFoundError("Produkt nicht gefunden.");

  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(raw)) {
    if (!(key in v)) continue;
    let value = (v as Record<string, unknown>)[key];
    if (NULLABLE_ON_EMPTY.has(key)) value = value ?? null;
    patch[key] = value;
  }
  return dbInternal.product.update({ where: { id: existing.id }, data: patch });
}
