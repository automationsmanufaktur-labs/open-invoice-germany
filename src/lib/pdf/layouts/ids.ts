/** Layout-Kennungen (Phase 11b). Reine Konstanten — auch fuer Zod/Client importierbar. */
export const LAYOUT_IDS = ["standard", "schlicht", "klassik", "modern", "blau", "schwarz", "kompakt"] as const;
export type LayoutId = (typeof LAYOUT_IDS)[number];
export const DEFAULT_LAYOUT_ID: LayoutId = "standard";
export const LAYOUT_DOC_TYPES = ["INVOICE", "CREDIT_NOTE", "QUOTE", "ORDER_CONFIRMATION", "PROFORMA", "DELIVERY_NOTE", "DUNNING"] as const;
export type LayoutDocType = (typeof LAYOUT_DOC_TYPES)[number];
export const LAYOUT_DOC_TYPE_LABEL: Record<LayoutDocType, string> = {
  INVOICE: "Rechnung",
  CREDIT_NOTE: "Gutschrift",
  QUOTE: "Angebot",
  ORDER_CONFIRMATION: "Auftragsbestätigung",
  PROFORMA: "Proforma",
  DELIVERY_NOTE: "Lieferschein",
  DUNNING: "Mahnung",
};
export function isLayoutId(value: unknown): value is LayoutId {
  return typeof value === "string" && (LAYOUT_IDS as readonly string[]).includes(value);
}
