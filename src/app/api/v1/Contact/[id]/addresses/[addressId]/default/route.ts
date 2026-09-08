/**
 * POST /api/v1/Contact/{id}/addresses/{addressId}/default — Zusatzadresse als Standard
 * (je Typ) setzen. Task 3, task-3-facts.md: ruft exakt `setDefaultAddress` (dieselbe
 * Domain-Funktion wie die Session-Route `/api/customers/[id]/addresses/[addressId]/default`).
 */
import { withApi } from "@/api/auth";
import { apiData } from "@/api/response";
import { apiDataResponseSchema, type RouteSpec } from "@/api/spec";
import { serializeContactAddress, contactAddressSchema } from "@/api/serializers/contact";
import { setDefaultAddress } from "@/domain/customer/addresses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApi<{ id: string; addressId: string }>(async (_req, ctx) => {
  const address = await setDefaultAddress(ctx.orgId, ctx.params.id, ctx.params.addressId);
  return apiData(serializeContactAddress(address));
}, { scope: "write" });

export const spec = {
  create: {
    path: "/api/v1/Contact/{id}/addresses/{addressId}/default",
    method: "POST",
    summary: "Zusatzadresse als Standard (je Typ) setzen",
    scope: "write",
    response: apiDataResponseSchema(contactAddressSchema),
    errors: [401, 403, 404, 429],
  },
} satisfies Record<string, RouteSpec>;
