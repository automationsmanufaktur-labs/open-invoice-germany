/**
 * Phase 11c, Task 2 — Live-Vorschau eines UNGESPEICHERTEN Editor-Entwurfs (Rechnung/
 * Geschaeftsdokument/Lieferschein), OHNE DB-Schreibzugriff: kein Nummernkreis, kein
 * ChangeLog, kein Prisma-`create`. Nutzt dieselben Anlage-Schemas wie die echte Anlage
 * (`createInvoiceSchema`/`createDocumentSchema`/`createDeliveryNoteSchema` — auch beim
 * Bearbeiten eines bestehenden Belegs im Editor, eine mitgesendete `id` wird ignoriert)
 * und dieselben Renderer wie ein echter Beleg (`buildDocEInvoiceData`/
 * `renderInvoicePdf`/`renderDeliveryNotePdf`, analog `src/domain/settings/preview.ts`,
 * das die Briefpapier-Vorschau mit FESTEN Musterdaten baut) — kein separater,
 * ggf. abweichender Vorschau-Renderer.
 *
 * Bewusst EINFACHER als die echte Anlage (`invoice/create.ts`/`document/create.ts`):
 * keine Aufloesung von Kunden-/Zahlungsmethoden-/Textvorlagen-Defaults, keine Adress-/
 * Ansprechpartner-Pruefung — nur Organisation + Kunde (mandantengeprueft) + die vom
 * Formular gesendeten Werte. Ausnahme: die Lieferschein-Anzeigeflags (showPrices/
 * showTax/showArticleNumber/showDescription/showDeliveryAddress) spiegeln exakt
 * `createDeliveryNoteWithinTx` (Org-Einstellung `DocumentSettings.dnShow*` als Fallback,
 * Fix Round 1) — sonst wuerde die Vorschau z. B. Preise zeigen, die der echte Lieferschein
 * nie zeigen wuerde. `internalNotes` werden NIE gelesen/uebergeben (Lastenheft 48 —
 * interne Notizen erscheinen nie im Beleg). Kopf-/Fusstext kommen ROH aus dem Payload
 * (Platzhalter werden bewusst NICHT aufgeloest — ein Entwurf hat i. d. R. noch keine
 * gespeicherten Stammdaten-Bezuege, die `renderTemplate` zuverlaessig aufloesen koennte;
 * LIMITATION, kein Bug).
 */
import { dbInternal } from "@/lib/db";
import { NotFoundError } from "@/domain/errors";
import { computeLineNet } from "@/lib/pricing/line";
import { normalizeLines } from "@/domain/document/lines";
import { buildDocEInvoiceData } from "@/domain/document/pdf-data";
import { loadDocumentSettings } from "@/domain/document/settings";
import { loadPdfTheme } from "@/domain/settings/theme";
import { invoiceTypeToLayoutDocType } from "@/domain/settings/layout";
import { renderInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { renderDeliveryNotePdf, type DeliveryNotePdfData } from "@/lib/pdf/delivery-note-pdf";
import type { PdfTheme } from "@/lib/pdf/theme";
import type { LayoutDocType, LayoutId } from "@/lib/pdf/layouts/ids";
import { createInvoiceSchema, createDocumentSchema, createDeliveryNoteSchema, type InvoiceLineInput } from "@/schemas";

/** Belegarten, die der Editor (Task 1) als Entwurf vorschauen kann. */
export const PREVIEW_KINDS = ["INVOICE", "DOCUMENT", "DELIVERY_NOTE"] as const;
export type PreviewKind = (typeof PREVIEW_KINDS)[number];

/** Body von `POST /api/pdf/preview` — `payload` wird ERST hier innen gegen das
 *  passende Anlage-Schema geparst (Route reicht `unknown` durch, keine Bypass-Pfade). */
export interface PreviewBody {
  kind: PreviewKind;
  payload: unknown;
  layoutId?: LayoutId;
}

const DRAFT_NUMBER = "ENTWURF";
const PREVIEW_WATERMARK = "VORSCHAU";

async function loadPreviewOrg(orgId: string) {
  const org = await dbInternal.organization.findUnique({
    where: { id: orgId },
    select: {
      legalName: true,
      addressLine1: true,
      addressLine2: true,
      postalCode: true,
      city: true,
      country: true,
      vatId: true,
      taxNumber: true,
      email: true,
      phone: true,
      electronicAddress: true,
      iban: true,
      bic: true,
      bankName: true,
    },
  });
  if (!org) throw new NotFoundError("Organisation nicht gefunden.");
  return org;
}

/** Kunde muss zur Organisation gehoeren (kein Cross-Tenant-Bezug) — sonst 404, analog
 *  `createDraftInvoiceWithinTx`/`createBusinessDocumentWithinTx`. */
async function loadPreviewCustomer(orgId: string, customerId: string) {
  const customer = await dbInternal.customer.findFirst({
    where: { id: customerId, orgId },
    select: {
      name: true,
      contactName: true,
      addressLine1: true,
      addressLine2: true,
      postalCode: true,
      city: true,
      countryCode: true,
      vatId: true,
      email: true,
      leitwegId: true,
      customerNumber: true,
    },
  });
  if (!customer) throw new NotFoundError("Kunde nicht gefunden.");
  return customer;
}

/** Positionsnetto je Zeile — dieselbe Rechenregel wie bei der echten Anlage
 *  (`computeLineNet`, Nicht-ITEM-Zeilen bleiben bei 0, Lastenheft §8). */
function toEInvoiceLines(rawLines: InvoiceLineInput[]) {
  return normalizeLines(rawLines).map((l) => ({
    lineType: l.lineType,
    description: l.description,
    descriptionLong: l.descriptionLong ?? null,
    articleNumber: l.articleNumber ?? null,
    quantityMilli: l.quantityMilli,
    unit: l.unit,
    unitNetPriceCents: l.unitNetPriceCents,
    taxRate: l.taxRate,
    taxCategory: l.taxCategory,
    lineNetCents: l.lineType === "ITEM" ? computeLineNet(l).lineNetCents : 0,
  }));
}

async function loadPreviewTheme(orgId: string, docType: LayoutDocType, layoutId: LayoutId | undefined, compress: boolean | undefined): Promise<PdfTheme> {
  const theme = await loadPdfTheme(orgId, null, docType);
  if (layoutId) theme.layoutId = layoutId;
  theme.watermark = PREVIEW_WATERMARK;
  if (compress === false) theme.compress = false;
  return theme;
}

async function buildInvoicePreview(orgId: string, org: Awaited<ReturnType<typeof loadPreviewOrg>>, body: PreviewBody, compress: boolean | undefined): Promise<Buffer> {
  const payload = createInvoiceSchema.parse(body.payload);
  const customer = await loadPreviewCustomer(orgId, payload.customerId);
  const theme = await loadPreviewTheme(orgId, invoiceTypeToLayoutDocType(payload.type), body.layoutId, compress);

  const data = buildDocEInvoiceData({
    number: null,
    kind: payload.type,
    issueDate: new Date(),
    currency: payload.currency ?? "EUR",
    notes: payload.notes ?? null,
    org,
    customer,
    lines: toEInvoiceLines(payload.lines),
    documentDiscountPermille: payload.documentDiscountPermille,
    documentDiscountCents: payload.documentDiscountCents,
    documentChargePermille: payload.documentChargePermille,
    documentChargeCents: payload.documentChargeCents,
    documentChargeReason: payload.documentChargeReason ?? null,
  });

  data.number = DRAFT_NUMBER;
  data.type = payload.type;
  // Roh aus dem Payload — KEINE Platzhalteraufloesung (siehe Datei-Kommentar).
  data.headerText = payload.headerText ?? null;
  data.footerText = payload.footerText ?? null;
  data.dueDate = payload.dueDate ?? null;
  data.paymentTermsHuman = payload.paymentTerms ?? null;
  data.deliveryDate = payload.deliveryDate ?? null;
  data.buyerReference = payload.buyerReference ?? null;
  // GiroCode nur fuer die Rechnungs-Familie, nie fuer eine Gutschrift (analog
  // GIRO_ELIGIBLE_TYPES in invoice-pdf.ts).
  if (payload.type !== "CREDIT_NOTE") data.giroAmountCents = data.payableCents;

  return renderInvoicePdf(data, theme);
}

async function buildDocumentPreview(orgId: string, org: Awaited<ReturnType<typeof loadPreviewOrg>>, body: PreviewBody, compress: boolean | undefined): Promise<Buffer> {
  const payload = createDocumentSchema.parse(body.payload);
  const customer = await loadPreviewCustomer(orgId, payload.customerId);
  const theme = await loadPreviewTheme(orgId, invoiceTypeToLayoutDocType(payload.kind), body.layoutId, compress);

  const data = buildDocEInvoiceData({
    number: null,
    kind: payload.kind,
    issueDate: new Date(),
    validUntil: payload.validUntil ?? null,
    currency: payload.currency ?? "EUR",
    notes: payload.notes ?? null,
    org,
    customer,
    lines: toEInvoiceLines(payload.lines),
    documentDiscountPermille: payload.documentDiscountPermille,
    documentDiscountCents: payload.documentDiscountCents,
    documentChargePermille: payload.documentChargePermille,
    documentChargeCents: payload.documentChargeCents,
    documentChargeReason: payload.documentChargeReason ?? null,
  });

  data.number = DRAFT_NUMBER;
  data.type = payload.kind;
  // Roh aus dem Payload — KEINE Platzhalteraufloesung (siehe Datei-Kommentar).
  data.headerText = payload.headerText ?? null;
  data.footerText = payload.footerText ?? null;

  return renderInvoicePdf(data, theme);
}

async function buildDeliveryNotePreview(orgId: string, org: Awaited<ReturnType<typeof loadPreviewOrg>>, body: PreviewBody, compress: boolean | undefined): Promise<Buffer> {
  const payload = createDeliveryNoteSchema.parse(body.payload);
  const customer = await loadPreviewCustomer(orgId, payload.customerId);
  const theme = await loadPreviewTheme(orgId, "DELIVERY_NOTE", body.layoutId, compress);
  // Fix Round 1, Wichtig — dieselben Anzeige-Defaults wie die echte Anlage
  // (`createDeliveryNoteWithinTx`, src/domain/delivery-note/create.ts ~L95-105): fehlt
  // ein Flag im Payload, greift die Org-Einstellung (dnShowPrices/dnShowArticleNumber/
  // dnShowDeliveryAddress) statt eines hart codierten Vorschau-Defaults; showTax/
  // showDescription kennen keine eigene Org-Einstellung und behalten denselben
  // Zod-Schema-Default wie dort (false/true).
  const docSettings = await loadDocumentSettings(orgId);

  const data: DeliveryNotePdfData = {
    number: DRAFT_NUMBER,
    issueDate: new Date(),
    deliveryDate: payload.deliveryDate ?? null,
    shippingDate: payload.shippingDate ?? null,
    currency: "EUR",
    seller: {
      name: org.legalName,
      addressLine1: org.addressLine1,
      postalCode: org.postalCode,
      city: org.city,
      taxNumber: org.taxNumber,
      vatId: org.vatId,
      iban: org.iban,
      bic: org.bic,
      bankName: org.bankName,
    },
    buyer: {
      name: customer.name,
      contactName: customer.contactName,
      addressLine1: customer.addressLine1,
      addressLine2: customer.addressLine2,
      postalCode: customer.postalCode,
      city: customer.city,
    },
    lines: payload.lines.map((l, i) => ({
      pos: i + 1,
      articleNumber: l.articleNumber ?? null,
      description: l.description,
      quantityMilli: l.quantityMilli,
      unit: l.unit,
      unitNetPriceCents: l.unitNetPriceCents ?? null,
      taxRate: l.taxRate ?? null,
    })),
    showPrices: payload.showPrices ?? docSettings.dnShowPrices,
    showTax: payload.showTax ?? false,
    showArticleNumber: payload.showArticleNumber ?? docSettings.dnShowArticleNumber,
    showDescription: payload.showDescription ?? true,
    showDeliveryAddress: payload.showDeliveryAddress ?? docSettings.dnShowDeliveryAddress,
    deliveryAddress: null,
    // Roh aus dem Payload — KEINE Platzhalteraufloesung (siehe Datei-Kommentar).
    headerText: payload.headerText ?? null,
    footerText: payload.footerText ?? null,
    sourceNumber: null,
  };

  return renderDeliveryNotePdf(data, theme);
}

/**
 * Rendert die Live-Vorschau eines ungespeicherten Editor-Entwurfs als PDF. `orgId` ist
 * bereits von der Route aufgeloest (`getActiveOrg`); diese Funktion prueft nur noch, dass
 * die Organisation (weiterhin) existiert und dass `payload.customerId` zu ihr gehoert
 * (`NotFoundError` -> 404, von der Route gemappt). `payload` wird gegen das
 * Neuanlage-Schema des jeweiligen `kind` geparst (`ZodError` -> 400 in der Route) — auch
 * beim Bearbeiten eines bestehenden Belegs (eine mitgesendete `id` bleibt unbeachtet, es
 * wird nie etwas gespeichert). `compress` ist NUR fuer Tests gedacht (siehe Route,
 * `?compress=0` unter NODE_ENV=test) — Produktionsaufrufe lassen es `undefined`.
 */
export async function buildDraftPreview(orgId: string, body: PreviewBody, compress?: boolean): Promise<Buffer> {
  const org = await loadPreviewOrg(orgId);
  if (body.kind === "DELIVERY_NOTE") return buildDeliveryNotePreview(orgId, org, body, compress);
  if (body.kind === "DOCUMENT") return buildDocumentPreview(orgId, org, body, compress);
  return buildInvoicePreview(orgId, org, body, compress);
}
