/**
 * Baut die Eingabedaten fuer das Lieferschein-PDF aus den DB-Entitaeten. Snapshot-bewusst
 * (Seller/Buyer aus sellerSnapshotJson/buyerSnapshotJson mit Fallback auf den Live-Stamm,
 * siehe src/domain/document/pdf-data.ts) — spaetere Stammdatenaenderungen duerfen einen
 * bereits erstellten Lieferschein nicht rueckwirkend veraendern.
 */
import type { Prisma } from "@/generated/prisma/client";
import { parseSellerSnapshot, parseBuyerSnapshot, buildSellerSnapshot, buildBuyerSnapshot } from "@/domain/snapshot";
import { buildDocumentTextContext } from "@/domain/email/context";
import { renderTemplate } from "@/lib/template/render";
import type { DeliveryNotePdfData } from "./delivery-note-pdf";

export type DeliveryNoteRow = Prisma.DeliveryNoteGetPayload<{ include: { lines: true } }>;
export type OrgRow = Prisma.OrganizationGetPayload<Record<string, never>>;
export type CustomerRow = Prisma.CustomerGetPayload<Record<string, never>>;

export function buildDeliveryNotePdfData(
  dn: DeliveryNoteRow,
  org: OrgRow,
  customer: CustomerRow,
  sourceNumber: string | null = null,
): DeliveryNotePdfData {
  const ctx = dn.id;
  const seller = parseSellerSnapshot(dn.sellerSnapshotJson, buildSellerSnapshot(org), ctx);
  const buyer = parseBuyerSnapshot(dn.buyerSnapshotJson, buildBuyerSnapshot(customer), ctx);

  // Kopf-/Fusstext: Platzhalter mit einem DB-freien Kontext aus den bereits aufgeloesten
  // Snapshot-Werten aufloesen (kein Beleg-Betrag am Lieferschein -> totals: null).
  const textCtx = buildDocumentTextContext({
    docType: "DELIVERY_NOTE",
    number: dn.number,
    issueDate: dn.issueDate,
    dueDate: dn.deliveryDate ?? null,
    totals: null,
    currency: "EUR",
    seller,
    buyer,
  });
  const headerText = dn.headerText ? renderTemplate(dn.headerText, textCtx).text : null;
  const footerText = dn.footerText ? renderTemplate(dn.footerText, textCtx).text : null;

  return {
    number: dn.number ?? "ENTWURF",
    issueDate: dn.issueDate,
    deliveryDate: dn.deliveryDate,
    shippingDate: dn.shippingDate,
    currency: "EUR",
    seller: {
      name: seller.legalName,
      addressLine1: seller.addressLine1,
      postalCode: seller.postalCode,
      city: seller.city,
      taxNumber: seller.taxNumber,
      vatId: seller.vatId,
      iban: seller.iban,
      bic: seller.bic,
      bankName: seller.bankName,
    },
    buyer: {
      name: buyer.name,
      contactName: buyer.contactName,
      addressLine1: buyer.addressLine1,
      addressLine2: buyer.addressLine2,
      postalCode: buyer.postalCode,
      city: buyer.city,
    },
    lines: dn.lines
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((l) => ({
        pos: l.position,
        articleNumber: l.articleNumber,
        description: l.description,
        quantityMilli: l.quantityMilli,
        unit: l.unit,
        unitNetPriceCents: l.unitNetPriceCents,
        taxRate: l.taxRate,
      })),
    showPrices: dn.showPrices,
    showTax: dn.showTax,
    showArticleNumber: dn.showArticleNumber,
    showDescription: dn.showDescription,
    headerText,
    footerText,
    sourceNumber,
  };
}
