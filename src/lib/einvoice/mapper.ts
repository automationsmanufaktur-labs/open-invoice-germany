/**
 * Bildet eine festgeschriebene Rechnung (Prisma) auf die framework-freie
 * EInvoiceData-Struktur ab — gemeinsame Quelle für XRechnung- und PDF-Export.
 */
import { parseSellerSnapshot, parseBuyerSnapshot } from "@/domain/snapshot";
import { buildDocumentTextContext } from "@/domain/email/context";
import { renderTemplate } from "@/lib/template/render";
import { roundHalfUp } from "@/lib/money";
import { skontoTerms, paymentTermsText, xrechnungSkontoNote } from "@/lib/pricing/skonto";
import { taxBreakdownSchema, paymentMethodSnapshotSchema } from "@/schemas";
import type { EmailDocType } from "@/schemas/email";
import type { EInvoiceData, EInvoiceDocumentAllowanceCharge, EInvoicePaymentMeans } from "./types";

function tryParseJson(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

export interface MapInput {
  number: string | null;
  type: string;
  issueDate: Date;
  dueDate: Date | null;
  deliveryDate: Date | null;
  currency: string;
  buyerReference: string | null;
  paymentTerms: string | null;
  notes: string | null;
  headerText?: string | null;
  footerText?: string | null;
  netTotalCents: number;
  taxTotalCents: number;
  grossTotalCents: number;
  paidAmountCents: number;
  taxBreakdownJson: string;
  // Phase 4a — Beleg-Aufschlagsgrund (Freitext) und Skonto-Konditionen.
  documentChargeReason?: string | null;
  skonto1Permille?: number | null;
  skonto1Days?: number | null;
  skonto2Permille?: number | null;
  skonto2Days?: number | null;
  // Phase 4a — Snapshot der gewaehlten Zahlungsmethode (siehe finalize.ts). NULL,
  // wenn keine Zahlungsmethode gewaehlt war -> Fallback Org-Konto, Code 58.
  paymentMethodSnapshotJson?: string | null;
  // Phase 0: Snapshot der Parteien; bei Entwuerfen null -> Live-Relation.
  sellerSnapshotJson?: string | null;
  buyerSnapshotJson?: string | null;
  id?: string;
  org: {
    legalName: string;
    addressLine1: string;
    addressLine2: string | null;
    postalCode: string;
    city: string;
    country: string;
    vatId: string | null;
    taxNumber: string | null;
    email: string | null;
    phone: string | null;
    electronicAddress: string | null;
    iban: string | null;
    bic: string | null;
    bankName: string | null;
  };
  customer: {
    name: string;
    contactName: string | null;
    addressLine1: string;
    addressLine2: string | null;
    postalCode: string;
    city: string;
    countryCode: string;
    vatId: string | null;
    email: string | null;
    leitwegId: string | null;
  };
  lines: Array<{
    id: string;
    description: string;
    quantityMilli: number;
    unit: string;
    unitNetPriceCents: number;
    lineNetCents: number;
    taxRate: number;
    taxCategory: string;
    // Phase 4a — Zeilenrabatt (BG-27). Fehlen diese Felder (Alt-Belege), bleibt
    // grossLineCents === lineNetCents -> kein Zeilen-AllowanceCharge im XML.
    discountPermille?: number;
    discountCents?: number;
  }>;
}

export function buildEInvoiceData(invoice: MapInput): EInvoiceData {
  const ctx = invoice.id ?? invoice.number ?? "unbekannt";
  const breakdownParsed = taxBreakdownSchema.safeParse(tryParseJson(invoice.taxBreakdownJson));
  if (!breakdownParsed.success) {
    console.warn(`mapper: taxBreakdownJson von ${ctx} ungueltig, nutze leere Aufschluesselung`);
  }
  const breakdown = breakdownParsed.success ? breakdownParsed.data : [];
  const org = parseSellerSnapshot(invoice.sellerSnapshotJson, invoice.org, ctx);
  const customer = parseBuyerSnapshot(invoice.buyerSnapshotJson, invoice.customer, ctx);

  // Phase 4a — Beleg-Rabatt/-Aufschlag je Steuersatz-Gruppe, aus der bereits
  // (bei Festschreibung) proportional aufgeteilten Aufschluesselung.
  // Fix-Runde 1 (Befund A): Gutschrift-Buckets sind vorzeichen-gespiegelt (negativ,
  // Bestandskonvention "positive Darstellung + TypeCode 381") — Filter auf !== 0 und
  // Math.abs() beim Schreiben von Amount/BaseAmount, analog zum Zeilenrabatt.
  const documentAllowances: EInvoiceDocumentAllowanceCharge[] = breakdown
    .filter((b) => b.allowanceCents !== 0)
    .map((b) => ({
      amountCents: Math.abs(b.allowanceCents),
      baseCents: Math.abs(b.baseNetCents),
      taxRate: b.taxRate,
      taxCategory: b.taxCategory,
      reason: "Rabatt",
    }));
  const documentCharges: EInvoiceDocumentAllowanceCharge[] = breakdown
    .filter((b) => b.chargeCents !== 0)
    .map((b) => ({
      amountCents: Math.abs(b.chargeCents),
      baseCents: Math.abs(b.baseNetCents - b.allowanceCents),
      taxRate: b.taxRate,
      taxCategory: b.taxCategory,
      reason: invoice.documentChargeReason || "Aufschlag",
    }));
  const lineTotalCents = invoice.lines.reduce((s, l) => s + l.lineNetCents, 0);
  const allowanceTotalCents = breakdown.reduce((s, b) => s + b.allowanceCents, 0);
  const chargeTotalCents = breakdown.reduce((s, b) => s + b.chargeCents, 0);

  // Phase 4a — Skonto (BT-20): #SKONTO#-Syntax vor dem Menschentext, sofern Skonto-
  // Konditionen gesetzt sind. Ohne Skonto ist paymentTermsNote === paymentTerms
  // (byte-identisch zum bisherigen Verhalten fuer Alt-Belege).
  const skTerms = skontoTerms({
    issueDate: invoice.issueDate,
    grossTotalCents: invoice.grossTotalCents,
    skonto1Permille: invoice.skonto1Permille ?? null,
    skonto1Days: invoice.skonto1Days ?? null,
    skonto2Permille: invoice.skonto2Permille ?? null,
    skonto2Days: invoice.skonto2Days ?? null,
  });
  // Fix-Runde 1 (Befund C): Klartext OHNE #SKONTO#-Tags fuer das PDF — identisch
  // zu paymentTermsNote, wenn kein Skonto gesetzt ist (Alt-Belege byte-identisch).
  // Fix-Welle (W3): ist ZUSAETZLICH ein Freitext-Zahlungsziel gesetzt, ergaenzt der
  // Skonto-Klartext per Zeilenumbruch, statt ihn zu verschlucken (bisher liess `??`
  // den Skonto-Hinweis komplett entfallen, sobald `paymentTerms` gesetzt war).
  const skontoHumanText = skTerms.length > 0 ? paymentTermsText(skTerms, invoice.dueDate) : null;
  const paymentTermsHuman =
    invoice.paymentTerms && skontoHumanText
      ? `${invoice.paymentTerms}\n${skontoHumanText}`
      : (invoice.paymentTerms ?? skontoHumanText);
  const paymentTermsNote =
    skTerms.length > 0 && paymentTermsHuman ? xrechnungSkontoNote(skTerms, paymentTermsHuman) : paymentTermsHuman;

  // Phase 4a — Zahlungsweg aus dem Zahlungsmethoden-Snapshot; Fallback Org-Konto,
  // Code 58 (SEPA-Überweisung).
  // Fix-Runde 1 (Befund B), angepasst: XRechnung-CIUS verlangt BG-16 (PAYMENT
  // INSTRUCTIONS) auf JEDER Rechnung (BR-DE-1) — ein komplett fehlendes PaymentMeans
  // faellt beim offiziellen Validator durch (siehe validate:erechnung, Fixture
  // "no-iban"). OHNE gewaehlte Methode und OHNE Org-IBAN wird daher UNTDID-4461-Code
  // "1" ("Instrument not defined") OHNE Kontodaten gesetzt — BG-16 ist damit erfuellt,
  // ohne ein irrefuehrendes Konto vorzutaeuschen. Verlangt der gewaehlte Methoden-Code
  // ein Konto (58/59/30 — BR-DE-23) und liegt weder ein Methoden- noch ein Org-Konto
  // vor, greift derselbe Fallback (protokolliert).
  const ACCOUNT_REQUIRING_CODES = new Set(["58", "59", "30"]);
  // K2 — Allowlist exportierbarer PaymentMeans-Codes OHNE Zusatzgruppen (CardAccount/
  // PaymentMandate), die die XRechnung/ZUGFeRD-Mapper nicht abbilden. Karte (48/54/55)
  // und Lastschrift (59) fallen auf Code 1 zurueck — die brauchten je ein eigenes
  // XML-Element (CardAccount bzw. PaymentMandate), das dieser Mapper nicht erzeugt.
  const NON_EXPORTABLE_CODES = new Set(["48", "54", "55", "59"]);
  const NO_ACCOUNT_FALLBACK: EInvoicePaymentMeans = { code: "1", iban: null, bic: null, accountName: null };
  let paymentMeans: EInvoicePaymentMeans = org.iban
    ? { code: "58", iban: org.iban, bic: org.bic, accountName: org.bankName }
    : NO_ACCOUNT_FALLBACK;
  let paymentMethodText: string | null = null;
  if (invoice.paymentMethodSnapshotJson) {
    const pmParsed = paymentMethodSnapshotSchema.safeParse(tryParseJson(invoice.paymentMethodSnapshotJson));
    if (pmParsed.success) {
      const pm = pmParsed.data;
      const code = pm.untdidCode || "58";
      const iban = pm.bankIban ?? org.iban;
      if (NON_EXPORTABLE_CODES.has(code)) {
        console.warn(`mapper: PaymentMeans ${code} nicht exportierbar, Fallback 1`);
        paymentMeans = NO_ACCOUNT_FALLBACK;
      } else if (ACCOUNT_REQUIRING_CODES.has(code) && !iban) {
        console.warn(
          `mapper: Zahlungsmethode von ${ctx} verlangt ein Konto (Code ${code}), aber weder Methode noch Organisation haben eine IBAN — nutze Fallback "Instrument not defined"`,
        );
        paymentMeans = NO_ACCOUNT_FALLBACK;
      } else {
        paymentMeans = { code, iban, bic: pm.bankBic ?? org.bic, accountName: pm.bankName ?? org.bankName };
      }
      paymentMethodText = pm.invoiceText;
    } else {
      console.warn(`mapper: Zahlungsmethoden-Snapshot von ${ctx} ungueltig, nutze Org-Konto`);
    }
  }

  // Kopf-/Fusstext: Platzhalter mit einem DB-freien Kontext aus den bereits aufgeloesten
  // Snapshot-Werten aufloesen — Ruling: das Ergebnis geht NUR ins PDF, nie ins XML.
  const emailDocType: EmailDocType = invoice.type === "CREDIT_NOTE" ? "CREDIT_NOTE" : "INVOICE";
  const textCtx = buildDocumentTextContext({
    docType: emailDocType,
    number: invoice.number,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    totals: { netCents: invoice.netTotalCents, taxCents: invoice.taxTotalCents, grossCents: invoice.grossTotalCents },
    currency: invoice.currency,
    seller: org,
    buyer: customer,
  });
  const headerText = invoice.headerText ? renderTemplate(invoice.headerText, textCtx).text : null;
  const footerText = invoice.footerText ? renderTemplate(invoice.footerText, textCtx).text : null;

  return {
    number: invoice.number ?? "ENTWURF",
    type: invoice.type,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    deliveryDate: invoice.deliveryDate,
    currency: invoice.currency,
    // B2G: Leitweg-ID des Kunden als Buyer reference (BT-10), sonst explizit gesetzter Wert.
    buyerReference: invoice.buyerReference ?? customer.leitwegId,
    paymentTerms: invoice.paymentTerms,
    paymentTermsNote,
    paymentTermsHuman,
    notes: invoice.notes,
    seller: {
      name: org.legalName,
      addressLine1: org.addressLine1,
      addressLine2: org.addressLine2,
      postalCode: org.postalCode,
      city: org.city,
      countryCode: org.country,
      vatId: org.vatId,
      taxNumber: org.taxNumber,
      email: org.email,
      phone: org.phone,
      contactName: null,
      electronicAddress: org.electronicAddress,
    },
    buyer: {
      name: customer.name,
      contactName: customer.contactName,
      addressLine1: customer.addressLine1,
      addressLine2: customer.addressLine2,
      postalCode: customer.postalCode,
      city: customer.city,
      countryCode: customer.countryCode,
      vatId: customer.vatId,
      email: customer.email,
    },
    lines: invoice.lines.map((l) => {
      const grossLineCents = roundHalfUp((l.quantityMilli * l.unitNetPriceCents) / 1000);
      const discountCents = grossLineCents - l.lineNetCents;
      // MultiplierFactorNumeric nur bei REIN prozentualem Rabatt (kein zusaetzlicher
      // Festbetrag) — sonst ist die Prozent/Betrag-Beziehung nicht mehr exakt.
      const discountPermille =
        !l.discountCents && l.discountPermille ? l.discountPermille : undefined;
      return {
        id: l.id,
        description: l.description,
        quantityMilli: l.quantityMilli,
        unit: l.unit,
        unitNetPriceCents: l.unitNetPriceCents,
        lineNetCents: l.lineNetCents,
        taxRate: l.taxRate,
        taxCategory: l.taxCategory,
        grossLineCents,
        discountCents,
        discountPermille,
      };
    }),
    taxSubtotals: breakdown,
    netTotalCents: invoice.netTotalCents,
    taxTotalCents: invoice.taxTotalCents,
    grossTotalCents: invoice.grossTotalCents,
    payableCents: invoice.grossTotalCents - invoice.paidAmountCents,
    paidCents: invoice.paidAmountCents,
    iban: org.iban,
    bic: org.bic,
    bankName: org.bankName,
    documentAllowances,
    documentCharges,
    lineTotalCents,
    allowanceTotalCents,
    chargeTotalCents,
    paymentMeans,
    paymentMethodText,
    headerText,
    footerText,
  };
}
