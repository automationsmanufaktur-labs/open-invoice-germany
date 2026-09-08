/**
 * Gemeinsame Aktions-Handler fuer /api/v1/Quote/{id}/* und /api/v1/OrderConfirmation/{id}/*
 * (Phase 10, Task 3). Quote (kind=ANGEBOT) und OrderConfirmation (kind=AUFTRAGSBESTAETIGUNG)
 * teilen sich dieselbe Prisma-Tabelle (Quote-Modell) und dieselben Domain-Funktionen — wie
 * bereits bei den Basis-Ressourcen (Task 2, src/api/serializers/document.ts: `objectName`
 * als Parameter). Ein Factory-Muster haelt die Geschaeftslogik EINMAL vor (CLAUDE.md 1.4/
 * 61.5 "nichts doppelt bauen"); jede Routendatei ruft nur `make*Action("Quote"|
 * "OrderConfirmation")` auf und exportiert `POST`/`spec` daraus.
 *
 * Fix-Runde 1 (Koordinator-Befund 2, Phase 10 Task 4): jede Aktion, die ein Dokument
 * anlegt/aendert, liefert jetzt die VOLLSTAENDIGE Ressource (statt eines Ad-hoc-
 * Teil-Objekts) — `spec.response` referenziert entsprechend das echte Ressourcen-
 * Schema statt `z.unknown()`. share-link/send bekommen kleine, explizite Antwort-
 * Schemas (kein "Dokument" im eigentlichen Sinn).
 */
import { z } from "zod";
import { withApi } from "@/api/auth";
import { apiData } from "@/api/response";
import { apiDataResponseSchema, type RouteSpec, type ApiScope } from "@/api/spec";
import { prisma } from "@/lib/db";
import { NotFoundError, InvalidOperationError } from "@/domain/errors";
import { convertDocument } from "@/domain/document/convert";
import { setQuoteStatus, setArchived } from "@/domain/document/status";
import { duplicateDocument } from "@/domain/document/duplicate";
import { createShareLink } from "@/domain/quote-share/link";
import { createShareLinkInputSchema } from "@/schemas/quote-share";
import { createPartialInvoice } from "@/domain/invoice/partial";
import { createDownpaymentInvoice } from "@/domain/invoice/downpayment";
import { createFinalInvoice } from "@/domain/invoice/final";
import { sendDocumentEmail, EmailAttachmentsTooLargeError } from "@/domain/email/send";
import { DocumentNotFoundError } from "@/domain/email/context";
import { resolveBaseUrl } from "@/lib/http/base-url";
import type { SendEmailRawInput } from "@/schemas/email";
import { serializeQuote, quoteSchema, orderConfirmationSchema } from "@/api/serializers/document";
import { serializeInvoice, invoiceSchema } from "@/api/serializers/invoice";
import { serializeDeliveryNote, deliveryNoteSchema } from "@/api/serializers/delivery-note";
import {
  convertDocumentBodySchema,
  documentStatusActionSchema,
  createPartialInvoiceSchema,
  createDownpaymentInvoiceSchema,
  createFinalInvoiceSchema,
} from "@/schemas";

export type QuoteResourceName = "Quote" | "OrderConfirmation";
type QuoteKind = "ANGEBOT" | "AUFTRAGSBESTAETIGUNG";

function kindFor(resource: QuoteResourceName): QuoteKind {
  return resource === "Quote" ? "ANGEBOT" : "AUFTRAGSBESTAETIGUNG";
}

function labelFor(resource: QuoteResourceName): string {
  return resource === "Quote" ? "Angebot" : "Auftragsbestaetigung";
}

async function requireOwnedQuote(orgId: string, resource: QuoteResourceName, id: string): Promise<{ id: string }> {
  const row = await prisma.quote.findFirst({ where: { id, orgId, kind: kindFor(resource) }, select: { id: true } });
  if (!row) throw new NotFoundError(`${labelFor(resource)} nicht gefunden.`);
  return row;
}

/** Laedt die volle Quote/OrderConfirmation-Zeile (inkl. Positionen) neu und
 *  serialisiert sie mit dem Ressourcennamen des AUFRUFERS (Quote bleibt Quote,
 *  OrderConfirmation bleibt OrderConfirmation — `kind` aendert sich durch
 *  status/duplicate nicht). */
async function reloadAndSerializeQuote(orgId: string, resource: QuoteResourceName, id: string) {
  const row = await prisma.quote.findUniqueOrThrow({ where: { id }, include: { lines: { orderBy: { position: "asc" } } } });
  return serializeQuote(row, resource, new Set());
}

/** POST /api/v1/{resource}/{id}/convert — in AB/Rechnung/Lieferschein umwandeln.
 *  Fix-Runde 1: liefert das ERZEUGTE Dokument vollstaendig — der konkrete Typ haengt
 *  von `toKind` ab (AUFTRAGSBESTAETIGUNG -> immer eine OrderConfirmation, unabhaengig
 *  vom aufrufenden Ressourcennamen, siehe convertQuoteToOrderConfirmation; INVOICE ->
 *  Invoice; DELIVERY_NOTE -> DeliveryNote) — `spec.response` ist deshalb ein
 *  `z.union(...)` der drei moeglichen Ressourcen-Schemas. */
export function makeConvertAction(resource: QuoteResourceName) {
  const POST = withApi<{ id: string }>(async (_req, ctx) => {
    const doc = await requireOwnedQuote(ctx.orgId, resource, ctx.params.id);
    const raw = typeof ctx.body === "object" && ctx.body !== null ? ctx.body : {};
    const body = convertDocumentBodySchema.parse({ toKind: "INVOICE", ...raw });
    const result = await convertDocument(
      ctx.orgId,
      { fromType: "QUOTE", fromId: doc.id, toKind: body.toKind, quantities: body.quantities, deliveryDate: body.deliveryDate },
      { actor: ctx.actor },
    );
    if (result.type === "INVOICE") {
      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: result.id }, include: { lines: { orderBy: { position: "asc" } } } });
      return apiData(serializeInvoice(invoice, new Set()), 201);
    }
    if (result.type === "QUOTE") {
      // convertDocument liefert type "QUOTE" ausschliesslich fuer toKind=AUFTRAGSBESTAETIGUNG
      // (siehe convertQuoteToOrderConfirmation) — das Ergebnis ist immer eine OrderConfirmation.
      const ab = await prisma.quote.findUniqueOrThrow({ where: { id: result.id }, include: { lines: { orderBy: { position: "asc" } } } });
      return apiData(serializeQuote(ab, "OrderConfirmation", new Set()), 201);
    }
    const note = await prisma.deliveryNote.findUniqueOrThrow({ where: { id: result.id }, include: { lines: { orderBy: { position: "asc" } } } });
    return apiData(serializeDeliveryNote(note, new Set()), 201);
  }, { scope: "write" });

  const spec = {
    create: {
      path: `/api/v1/${resource}/{id}/convert`,
      method: "POST",
      summary: `${labelFor(resource)} umwandeln (AB/Rechnung/Lieferschein; liefert das erzeugte Dokument)`,
      scope: "write" as ApiScope,
      request: { body: convertDocumentBodySchema },
      response: apiDataResponseSchema(z.union([invoiceSchema, orderConfirmationSchema, deliveryNoteSchema])),
      errors: [400, 401, 403, 404, 409, 429],
    },
  } satisfies Record<string, RouteSpec>;

  return { POST, spec };
}

const QUOTE_STATUS_TARGET = { MARK_SENT: "SENT", MARK_ACCEPTED: "ACCEPTED", MARK_REJECTED: "REJECTED", CANCEL: "CANCELLED" } as const;

/** POST /api/v1/{resource}/{id}/status — MARK_SENT/MARK_ACCEPTED/MARK_REJECTED/CANCEL/ARCHIVE/UNARCHIVE.
 *  Fix-Runde 1: liefert die vollstaendige, aktualisierte Ressource (statt {id,status}/
 *  {id,archived}). */
export function makeStatusAction(resource: QuoteResourceName) {
  const POST = withApi<{ id: string }>(async (_req, ctx) => {
    const doc = await requireOwnedQuote(ctx.orgId, resource, ctx.params.id);
    const input = documentStatusActionSchema.parse(ctx.body);

    if (input.action === "ARCHIVE" || input.action === "UNARCHIVE") {
      await setArchived(ctx.orgId, "QUOTE", doc.id, input.action === "ARCHIVE", ctx.actor);
    } else if (input.action === "MARK_DELIVERED" || input.action === "MARK_CREATED") {
      throw new InvalidOperationError(`${input.action} ist fuer ${resource} nicht gueltig.`);
    } else {
      const target = QUOTE_STATUS_TARGET[input.action];
      await setQuoteStatus(ctx.orgId, doc.id, target, { actor: ctx.actor, note: input.note });
    }
    return apiData(await reloadAndSerializeQuote(ctx.orgId, resource, doc.id));
  }, { scope: "write" });

  const spec = {
    create: {
      path: `/api/v1/${resource}/{id}/status`,
      method: "POST",
      summary: `${labelFor(resource)}-Status setzen (liefert die aktualisierte Ressource)`,
      scope: "write" as ApiScope,
      request: { body: documentStatusActionSchema },
      response: apiDataResponseSchema(resource === "Quote" ? quoteSchema : orderConfirmationSchema),
      errors: [400, 401, 403, 404, 409, 429],
    },
  } satisfies Record<string, RouteSpec>;

  return { POST, spec };
}

/** POST /api/v1/{resource}/{id}/duplicate — als neuer Entwurf duplizieren.
 *  Fix-Runde 1: liefert den vollstaendigen neuen Entwurf (statt {type,id}) —
 *  `duplicateDocument` selbst liefert nur den Diskriminator + die ID zurueck, die
 *  Route laedt die Kopie deshalb einmal nach. `kind` bleibt beim Duplizieren erhalten
 *  (siehe duplicateQuote), das Ergebnis hat also denselben Ressourcennamen wie der
 *  Aufrufer. */
export function makeDuplicateAction(resource: QuoteResourceName) {
  const POST = withApi<{ id: string }>(async (_req, ctx) => {
    const doc = await requireOwnedQuote(ctx.orgId, resource, ctx.params.id);
    const copy = await duplicateDocument(ctx.orgId, "QUOTE", doc.id, ctx.actor);
    return apiData(await reloadAndSerializeQuote(ctx.orgId, resource, copy.id), 201);
  }, { scope: "write" });

  const spec = {
    create: {
      path: `/api/v1/${resource}/{id}/duplicate`,
      method: "POST",
      summary: `${labelFor(resource)} duplizieren (neuer Entwurf; liefert den erzeugten Entwurf)`,
      scope: "write" as ApiScope,
      response: apiDataResponseSchema(resource === "Quote" ? quoteSchema : orderConfirmationSchema),
      errors: [401, 403, 404, 429],
    },
  } satisfies Record<string, RouteSpec>;

  return { POST, spec };
}

const shareLinkActionResponseSchema = z.object({
  url: z.string(),
  token: z.string().optional(),
  expiresAt: z.string(),
});

/**
 * POST /api/v1/{resource}/{id}/share-link — Annahme-Link erzeugen. `createShareLink`
 * selbst lehnt kind!=ANGEBOT mit `ShareLinkError` (409) ab — bei OrderConfirmation ist
 * dieser Endpunkt daher immer ein 409 (kein Sonderfall in der Route noetig).
 *
 * Fix-Runde 1: Antwort `{url, token, expiresAt}` (Koordinator-Vorgabe) — `token` war
 * bisher NICHT im Antwortkoerper enthalten, obwohl er bereits erzeugt und Teil der
 * `url` ist (`${baseUrl}/angebot/${token}`); jetzt zusaetzlich als eigenes Feld.
 */
export function makeShareLinkAction(resource: QuoteResourceName) {
  const POST = withApi<{ id: string }>(async (req, ctx) => {
    const doc = await requireOwnedQuote(ctx.orgId, resource, ctx.params.id);
    const { link, token } = await createShareLink(ctx.orgId, doc.id, ctx.body ?? {}, { actor: ctx.actor });
    const baseUrl = resolveBaseUrl(req.headers);
    return apiData({ url: `${baseUrl}/angebot/${token}`, token, expiresAt: link.expiresAt.toISOString() }, 201);
  }, { scope: "write" });

  const spec = {
    create: {
      path: `/api/v1/${resource}/{id}/share-link`,
      method: "POST",
      summary: `Annahme-Link fuer ein ${labelFor(resource)} erzeugen (nur kind=ANGEBOT)`,
      scope: "write" as ApiScope,
      request: { body: createShareLinkInputSchema },
      response: apiDataResponseSchema(shareLinkActionResponseSchema),
      errors: [400, 401, 403, 404, 409, 429],
    },
  } satisfies Record<string, RouteSpec>;

  return { POST, spec };
}

const sendActionBodySchema = z.object({
  to: z.array(z.string()).min(1),
  cc: z.array(z.string()).optional(),
  bcc: z.array(z.string()).optional(),
  subject: z.string().min(1).max(300),
  body: z.string().min(1).max(50000),
  signature: z.string().max(5000).optional(),
  copyToSelf: z.boolean().default(false),
  standardAttachments: z.array(z.string()).optional(),
  attachmentIds: z.array(z.string()).optional(),
  templateId: z.string().optional(),
});

const sendActionResponseSchema = z.object({ emailLogId: z.string(), status: z.string() });

/** POST /api/v1/{resource}/{id}/send — per E-Mail versenden (dieselbe Domain wie Invoice/{id}/send).
 *  Fix-Runde 1: Antwortfeld `logId` in `emailLogId` umbenannt (Koordinator-Vorgabe),
 *  analog zu `/Invoice/{id}/send`. */
export function makeSendAction(resource: QuoteResourceName) {
  const POST = withApi<{ id: string }>(async (_req, ctx) => {
    const doc = await requireOwnedQuote(ctx.orgId, resource, ctx.params.id);
    const body = sendActionBodySchema.parse(ctx.body);
    const rawInput: SendEmailRawInput = {
      docType: resource === "Quote" ? "ANGEBOT" : "AUFTRAGSBESTAETIGUNG",
      docId: doc.id,
      to: body.to.join(","),
      cc: (body.cc ?? []).join(","),
      bcc: (body.bcc ?? []).join(","),
      subject: body.subject,
      body: body.body,
      signature: body.signature ?? "",
      copyToSelf: body.copyToSelf,
      standardAttachments: body.standardAttachments ?? [],
      templateId: body.templateId,
      attachmentIds: body.attachmentIds ?? [],
      warnings: [],
    };
    try {
      const result = await sendDocumentEmail(ctx.orgId, ctx.actor, rawInput, []);
      if (result.status === "FAILED") throw new InvalidOperationError(result.error ?? "Versand fehlgeschlagen.");
      return apiData({ emailLogId: result.logId, status: result.status });
    } catch (e) {
      if (e instanceof DocumentNotFoundError) throw new NotFoundError(e.message);
      if (e instanceof EmailAttachmentsTooLargeError) throw new InvalidOperationError(e.message);
      throw e;
    }
  }, { scope: "send" });

  const spec = {
    create: {
      path: `/api/v1/${resource}/{id}/send`,
      method: "POST",
      summary: `${labelFor(resource)} per E-Mail versenden`,
      scope: "send" as ApiScope,
      request: { body: sendActionBodySchema },
      response: apiDataResponseSchema(sendActionResponseSchema),
      errors: [400, 401, 403, 404, 409, 429],
    },
  } satisfies Record<string, RouteSpec>;

  return { POST, spec };
}

/** POST /api/v1/{resource}/{id}/partial-invoice — Teilrechnung (§13 UStG).
 *  Fix-Runde 1: liefert die vollstaendige erzeugte Rechnung (statt {id,status,type}) —
 *  `createPartialInvoice` liefert die volle Zeile bereits zurueck. */
export function makePartialInvoiceAction(resource: QuoteResourceName) {
  const POST = withApi<{ id: string }>(async (_req, ctx) => {
    const doc = await requireOwnedQuote(ctx.orgId, resource, ctx.params.id);
    const raw = typeof ctx.body === "object" && ctx.body !== null ? ctx.body : {};
    const body = createPartialInvoiceSchema.parse({ ...raw, sourceType: "QUOTE", sourceId: doc.id });
    const invoice = await createPartialInvoice(ctx.orgId, body, { actor: ctx.actor });
    return apiData(serializeInvoice(invoice, new Set()), 201);
  }, { scope: "write" });

  const spec = {
    create: {
      path: `/api/v1/${resource}/{id}/partial-invoice`,
      method: "POST",
      summary: `Teilrechnung (§13 UStG) aus einem ${labelFor(resource)} anlegen (liefert die erzeugte Rechnung)`,
      scope: "write" as ApiScope,
      request: { body: createPartialInvoiceSchema },
      response: apiDataResponseSchema(invoiceSchema),
      errors: [400, 401, 403, 404, 409, 429],
    },
  } satisfies Record<string, RouteSpec>;

  return { POST, spec };
}

/** POST /api/v1/{resource}/{id}/downpayment-invoice — Abschlagsrechnung (§13/§14 Abs. 5 UStG).
 *  Fix-Runde 1: liefert die vollstaendige erzeugte Rechnung (statt {id,status,type}). */
export function makeDownpaymentInvoiceAction(resource: QuoteResourceName) {
  const POST = withApi<{ id: string }>(async (_req, ctx) => {
    const doc = await requireOwnedQuote(ctx.orgId, resource, ctx.params.id);
    const raw = typeof ctx.body === "object" && ctx.body !== null ? ctx.body : {};
    const body = createDownpaymentInvoiceSchema.parse({ ...raw, sourceType: "QUOTE", sourceId: doc.id });
    const invoice = await createDownpaymentInvoice(ctx.orgId, body, { actor: ctx.actor });
    return apiData(serializeInvoice(invoice, new Set()), 201);
  }, { scope: "write" });

  const spec = {
    create: {
      path: `/api/v1/${resource}/{id}/downpayment-invoice`,
      method: "POST",
      summary: `Abschlagsrechnung (§13/§14 Abs. 5 UStG) aus einem ${labelFor(resource)} anlegen (liefert die erzeugte Rechnung)`,
      scope: "write" as ApiScope,
      request: { body: createDownpaymentInvoiceSchema },
      response: apiDataResponseSchema(invoiceSchema),
      errors: [400, 401, 403, 404, 409, 429],
    },
  } satisfies Record<string, RouteSpec>;

  return { POST, spec };
}

/** POST /api/v1/{resource}/{id}/final-invoice — Schlussrechnung (§14 Abs. 5 UStG).
 *  Fix-Runde 1: liefert die vollstaendige erzeugte Rechnung (statt {id,status,type}). */
export function makeFinalInvoiceAction(resource: QuoteResourceName) {
  const POST = withApi<{ id: string }>(async (_req, ctx) => {
    const doc = await requireOwnedQuote(ctx.orgId, resource, ctx.params.id);
    const body = createFinalInvoiceSchema.parse({ sourceType: "QUOTE", sourceId: doc.id });
    const invoice = await createFinalInvoice(ctx.orgId, body, { actor: ctx.actor });
    return apiData(serializeInvoice(invoice, new Set()), 201);
  }, { scope: "write" });

  const spec = {
    create: {
      path: `/api/v1/${resource}/{id}/final-invoice`,
      method: "POST",
      summary: `Schlussrechnung (§14 Abs. 5 UStG) aus einem ${labelFor(resource)} anlegen (liefert die erzeugte Rechnung)`,
      scope: "write" as ApiScope,
      response: apiDataResponseSchema(invoiceSchema),
      errors: [401, 403, 404, 409, 429],
    },
  } satisfies Record<string, RouteSpec>;

  return { POST, spec };
}
