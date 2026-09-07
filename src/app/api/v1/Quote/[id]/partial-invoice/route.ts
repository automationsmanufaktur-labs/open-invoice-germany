/**
 * POST /api/v1/Quote/{id}/partial-invoice — duenner Wrapper um makePartialInvoiceAction("Quote")
 * (src/api/document-actions.ts, Phase 10 Task 3 — Quote/OrderConfirmation teilen sich
 * dieselbe Domain-Logik, siehe Modulkommentar dort).
 */
import { makePartialInvoiceAction } from "@/api/document-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const { POST, spec } = makePartialInvoiceAction("Quote");
