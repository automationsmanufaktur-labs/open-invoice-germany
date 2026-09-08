/**
 * Reine Berechnungen der Rechnungsdetailseite (Phase 11d, Task 3) — 1:1 aus der frueheren
 * `page.tsx` (Z. 87-175, ohne den DB-Zugriff auf den Mahnplan) uebernommen, keine
 * Logikaenderung. DB-Zugriffe (Quelle, Mahnplan, Zahlungsmethoden, Anhaenge) bleiben
 * bewusst in `page.tsx` — diese Datei greift NIE auf die Datenbank zu.
 *
 * Abweichung vom Brief: `buildInvoiceViewModel` nimmt nur `invoice` entgegen, kein
 * zweiter `org`-Parameter — die hier verschobenen Berechnungen (Z. 87-175 abzueglich des
 * Mahnplan-Blocks) griffen nie auf `org` zu; ein ungenutzter Parameter waere ein
 * Lint-Fund (@typescript-eslint/no-unused-vars) ohne Nutzen.
 */
import type { Prisma } from "@/generated/prisma/client";
import { payableBaseCents, openAmountCents } from "@/domain/invoice/amounts";
import { effectiveInvoiceStatus } from "@/domain/invoice/status";
import { availableActions, type ActionKey } from "@/domain/document/actions";
import type { EmailDocType } from "@/schemas/email";

/** Deckungsgleich mit dem `include` in `page.tsx` — beide Stellen bei einer Aenderung pflegen. */
export type InvoiceDetail = Prisma.InvoiceGetPayload<{
  include: {
    lines: { orderBy: { position: "asc" } };
    customer: { include: { defaultPaymentMethod: true } };
    org: true;
    payments: { orderBy: { paidAt: "asc" } };
    dunnings: { orderBy: { level: "asc" }; include: { stage: { select: { order: true; name: true } } } };
    paymentMethod: true;
    finalDeductions: { orderBy: { issueDate: "asc" } };
  };
}>;

// Task 4: PARTIAL/DOWNPAYMENT/FINAL sind rechtlich ebenfalls Rechnungen (§13-15 UStG).
// Smoke-Bug-Fix (Fix-Welle Final-Review, Phase 12b): CREDIT_NOTE/CORRECTION passen den
// Titel an den PDF-Titel an (invoice-pdf.ts documentTitle(), COMPLIANCE.md § 11 — "Gutschrift"
// ist umsatzsteuerlich die Selbstabrechnung, die diese Software nicht ausstellt). Bewusst
// STATISCH (kein Vollstorno-/Teilgutschrift-Unterschied wie im PDF): diese Datei greift nie
// auf die Datenbank zu (s. o.), "Stornorechnung" ist laut invoice-pdf.ts der weit haeufigere
// Fall und damit der richtige Default hier.
export const TYPE_TITLE: Record<string, string> = {
  INVOICE: "Rechnung",
  CREDIT_NOTE: "Stornorechnung",
  CORRECTION: "Rechnungskorrektur",
  PARTIAL: "Teilrechnung",
  DOWNPAYMENT: "Abschlagsrechnung",
  FINAL: "Schlussrechnung",
};

export function deDate(d: Date | null): string {
  return d ? new Intl.DateTimeFormat("de-DE").format(d) : "—";
}

export interface TaxBreakdownRow {
  taxRate: number;
  netCents: number;
  taxCents: number;
  allowanceCents?: number;
  chargeCents?: number;
}

export interface DeductionSummary {
  number: string;
  issueDate: Date;
  netCents: number;
  taxCents: number;
  grossCents: number;
}

export interface InvoiceViewModel {
  isDraft: boolean;
  isCancelled: boolean;
  actions: ActionKey[];
  canCancelOrCredit: boolean;
  canDuplicate: boolean;
  breakdown: TaxBreakdownRow[];
  hasDocumentAdjustment: boolean;
  documentDiscountTotalCents: number;
  documentChargeTotalCents: number;
  hasSkonto: boolean;
  paymentMethodName: string | null;
  isInvoiceType: boolean;
  payableBase: number;
  openCents: number;
  dueDate: Date;
  isOverdue: boolean;
  canPay: boolean;
  emailDocType: EmailDocType;
  deductionsByInvoice: Map<string, DeductionSummary>;
}

export function buildInvoiceViewModel(invoice: InvoiceDetail): InvoiceViewModel {
  const isDraft = invoice.status === "DRAFT";
  const isCancelled = invoice.status === "CANCELLED";
  // Task 2 (Task-2-Facts): Sichtbarkeit der §16-Aktionen (Stornieren/Teilgutschrift/
  // Duplizieren) ueber availableActions (Task 1) statt eigener CANCELLABLE_TYPES/
  // CREDITABLE_TYPES/NOT_DUPLICATABLE_TYPES-Sets — `status` ist der WIRKSAME Status
  // (effectiveInvoiceStatus), wie von availableActions verlangt.
  const actions = availableActions({
    kind: "INVOICE",
    type: invoice.type,
    status: effectiveInvoiceStatus({ status: invoice.status, dueDate: invoice.dueDate, issueDate: invoice.issueDate }),
    isDraft,
    dunningState: invoice.dunningState as "ACTIVE" | "PAUSED" | "STOPPED" | undefined,
  });
  const canCancelOrCredit = actions.includes("CANCEL");
  const canDuplicate = actions.includes("DUPLICATE");
  const breakdown = JSON.parse(invoice.taxBreakdownJson) as TaxBreakdownRow[];
  const hasDocumentAdjustment =
    invoice.documentDiscountPermille > 0 ||
    invoice.documentDiscountCents > 0 ||
    invoice.documentChargePermille > 0 ||
    invoice.documentChargeCents > 0;
  const documentDiscountTotalCents = breakdown.reduce((s, b) => s + (b.allowanceCents ?? 0), 0);
  const documentChargeTotalCents = breakdown.reduce((s, b) => s + (b.chargeCents ?? 0), 0);
  const hasSkonto = invoice.skonto1Permille != null && invoice.skonto1Days != null;
  const paymentMethodName = invoice.paymentMethodSnapshotJson
    ? (JSON.parse(invoice.paymentMethodSnapshotJson) as { name: string }).name
    : (invoice.paymentMethod?.name ?? null);
  // Task 4: PARTIAL/DOWNPAYMENT sind wie INVOICE/CORRECTION regulaer zahlbar; FINAL
  // ebenso, aber auf Basis von `payableCents` (Rest nach Abzug der Abschlaege) statt
  // `grossTotalCents` — payableBaseCents/openAmountCents (Task 2) kapseln das.
  const isInvoiceType =
    invoice.type === "INVOICE" ||
    invoice.type === "CORRECTION" ||
    invoice.type === "PARTIAL" ||
    invoice.type === "DOWNPAYMENT" ||
    invoice.type === "FINAL";
  const payableBase = payableBaseCents(invoice);
  const openCents = openAmountCents(invoice);
  const dueDate = invoice.dueDate ?? invoice.issueDate;
  const isOverdue = !isDraft && !isCancelled && openCents > 0 && new Date() > dueDate;
  const canPay = !isDraft && !isCancelled && isInvoiceType && openCents > 0;
  const emailDocType: EmailDocType = invoice.type === "CREDIT_NOTE" ? "CREDIT_NOTE" : "INVOICE";

  // Task 4: Abzugsblock einer Schlussrechnung — je Abschlagsrechnung EINE Zeile (ueber
  // alle Steuersaetze aggregiert), aus dem unveraenderlichen FinalInvoiceDeduction-
  // Snapshot (Task 2), niemals live aus den Abschlagsrechnungen selbst.
  const deductionsByInvoice = new Map<string, DeductionSummary>();
  for (const d of invoice.finalDeductions) {
    const existing = deductionsByInvoice.get(d.downpaymentInvoiceId);
    if (existing) {
      existing.netCents += d.netCents;
      existing.taxCents += d.taxCents;
      existing.grossCents += d.grossCents;
    } else {
      deductionsByInvoice.set(d.downpaymentInvoiceId, {
        number: d.number,
        issueDate: d.issueDate,
        netCents: d.netCents,
        taxCents: d.taxCents,
        grossCents: d.grossCents,
      });
    }
  }

  return {
    isDraft,
    isCancelled,
    actions,
    canCancelOrCredit,
    canDuplicate,
    breakdown,
    hasDocumentAdjustment,
    documentDiscountTotalCents,
    documentChargeTotalCents,
    hasSkonto,
    paymentMethodName,
    isInvoiceType,
    payableBase,
    openCents,
    dueDate,
    isOverdue,
    canPay,
    emailDocType,
    deductionsByInvoice,
  };
}
