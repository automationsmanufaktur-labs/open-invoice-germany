/**
 * POST /api/v1/OrderConfirmation/{id}/downpayment-invoice — duenner Wrapper um makeDownpaymentInvoiceAction("OrderConfirmation")
 * (src/api/document-actions.ts, Phase 10 Task 3 — Quote/OrderConfirmation teilen sich
 * dieselbe Domain-Logik, siehe Modulkommentar dort).
 */
import { makeDownpaymentInvoiceAction } from "@/api/document-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const { POST, spec } = makeDownpaymentInvoiceAction("OrderConfirmation");
