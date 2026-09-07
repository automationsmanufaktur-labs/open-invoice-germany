/**
 * POST /api/v1/Quote/{id}/final-invoice — duenner Wrapper um makeFinalInvoiceAction("Quote")
 * (src/api/document-actions.ts, Phase 10 Task 3 — Quote/OrderConfirmation teilen sich
 * dieselbe Domain-Logik, siehe Modulkommentar dort).
 */
import { makeFinalInvoiceAction } from "@/api/document-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const { POST, spec } = makeFinalInvoiceAction("Quote");
