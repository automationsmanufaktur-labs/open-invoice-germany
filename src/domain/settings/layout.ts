/**
 * Aufloesung des PDF-Layouts einer Organisation (Phase 11b, PDF-Layouts). Reine
 * Domain-Funktionen ohne DB-Zugriff — der Aufrufer (Task 3, `loadPdfTheme`) laedt
 * BrandingSettings/Beleg-Override und reicht die Werte hier nur durch.
 */
import { DEFAULT_LAYOUT_ID, type LayoutDocType, type LayoutId } from "@/lib/pdf/layouts/ids";
import { layoutByTypeSchema, type LayoutByType } from "@/schemas/settings";

/** Aufloesung: Beleg-Override > Typ-Map > Organisationsstandard > "standard" (Spec Phase 11, "Layout-Auswahl"). */
export function resolveLayoutId(args: { overrideLayoutId?: LayoutId | null; layoutByType: LayoutByType; orgDefault: LayoutId; docType: LayoutDocType }): LayoutId {
  return args.overrideLayoutId ?? args.layoutByType[args.docType] ?? args.orgDefault ?? DEFAULT_LAYOUT_ID;
}

/** Liest `BrandingSettings.layoutByTypeJson`; kaputtes JSON oder unbekannte Werte ⇒ {} (nie werfen im Renderpfad). */
export function parseLayoutByType(json: string | null | undefined): LayoutByType {
  if (!json) return {};
  try {
    const parsed = layoutByTypeSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

const INVOICE_FAMILY = new Set(["INVOICE", "PARTIAL", "DOWNPAYMENT", "FINAL", "CORRECTION"]);
export function invoiceTypeToLayoutDocType(type: string): LayoutDocType {
  if (type === "CREDIT_NOTE") return "CREDIT_NOTE";
  if (type === "ANGEBOT") return "QUOTE";
  if (type === "AUFTRAGSBESTAETIGUNG") return "ORDER_CONFIRMATION";
  if (type === "PROFORMA") return "PROFORMA";
  if (INVOICE_FAMILY.has(type)) return "INVOICE";
  return "INVOICE";
}
