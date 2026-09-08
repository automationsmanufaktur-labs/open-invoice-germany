/**
 * POST /api/v1/Quote/{id}/status — duenner Wrapper um makeStatusAction("Quote")
 * (src/api/document-actions.ts, Phase 10 Task 3 — Quote/OrderConfirmation teilen sich
 * dieselbe Domain-Logik, siehe Modulkommentar dort).
 */
import { makeStatusAction } from "@/api/document-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const { POST, spec } = makeStatusAction("Quote");
