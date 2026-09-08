import { z } from "zod";
import { withApi } from "@/api/auth";
import { apiData, apiList } from "@/api/response";
import { apiDataResponseSchema, apiListResponseSchema, type RouteSpec } from "@/api/spec";
import { serializeProduct } from "@/api/serializers/product";
import { listProductsApi, productListFilterSchema } from "@/domain/product/list";
import { createProduct } from "@/domain/product/save";
import { productSchema } from "@/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi(async (req, ctx) => {
  const { searchParams } = new URL(req.url);
  const result = await listProductsApi(ctx.orgId, Object.fromEntries(searchParams));
  return apiList(result.rows.map(serializeProduct), result);
}, { scope: "read" });

export const POST = withApi(async (_req, ctx) => {
  const created = await createProduct(ctx.orgId, ctx.body);
  return apiData(serializeProduct(created), 201);
}, { scope: "write" });

export const spec = {
  list: {
    path: "/api/v1/Product",
    method: "GET",
    summary: "Produkte auflisten",
    scope: "read",
    request: { query: productListFilterSchema },
    response: apiListResponseSchema(z.unknown()),
    errors: [400, 401, 403, 429],
  },
  create: {
    path: "/api/v1/Product",
    method: "POST",
    summary: "Produkt anlegen",
    scope: "write",
    request: { body: productSchema },
    response: apiDataResponseSchema(z.unknown()),
    errors: [400, 401, 403, 429],
  },
} satisfies Record<string, RouteSpec>;
