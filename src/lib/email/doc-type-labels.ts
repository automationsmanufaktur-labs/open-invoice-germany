/** Deutsche Anzeigenamen der E-Mail-Dokumenttypen. Client-sicher (keine Server-Importe) —
 *  wird sowohl vom Domain-Layer (`src/domain/email/context.ts`) als auch von Client-
 *  Komponenten (Vorlagen-Editor) verwendet. */
import type { EmailDocType } from "@/schemas/email";

export const DOC_TYPE_LABEL: Record<EmailDocType, string> = {
  ANGEBOT: "Angebot",
  AUFTRAGSBESTAETIGUNG: "Auftragsbestätigung",
  PROFORMA: "Proformarechnung",
  INVOICE: "Rechnung",
  CREDIT_NOTE: "Gutschrift",
  DUNNING: "Mahnung",
  DELIVERY_NOTE: "Lieferschein",
};
