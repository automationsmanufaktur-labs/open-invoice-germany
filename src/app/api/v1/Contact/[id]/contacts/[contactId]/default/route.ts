/**
 * POST /api/v1/Contact/{id}/contacts/{contactId}/default — Ansprechpartner als Standard
 * setzen. Task 3, task-3-facts.md: ruft exakt `setDefaultContact` (dieselbe Domain-
 * Funktion wie die Session-Route `/api/customers/[id]/contacts/[contactId]/default`).
 */
import { withApi } from "@/api/auth";
import { apiData } from "@/api/response";
import { apiDataResponseSchema, type RouteSpec } from "@/api/spec";
import { serializeContactPerson, contactPersonSchema } from "@/api/serializers/contact";
import { setDefaultContact } from "@/domain/customer/contacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApi<{ id: string; contactId: string }>(async (_req, ctx) => {
  const contact = await setDefaultContact(ctx.orgId, ctx.params.id, ctx.params.contactId);
  return apiData(serializeContactPerson(contact));
}, { scope: "write" });

export const spec = {
  create: {
    path: "/api/v1/Contact/{id}/contacts/{contactId}/default",
    method: "POST",
    summary: "Ansprechpartner als Standard setzen",
    scope: "write",
    response: apiDataResponseSchema(contactPersonSchema),
    errors: [401, 403, 404, 429],
  },
} satisfies Record<string, RouteSpec>;
