/**
 * Aktionsmatrix fuer Zeilen-Schnellaktionen (`RowActionsMenu`) UND die Detailseiten
 * (Phase 8b, §41 — "dieselbe Logik wie Detailseite, dort ebenfalls verwendet, keine
 * Doppelung"). Reine Funktion, keine DB-Zugriffe: der Aufrufer liefert bereits den
 * wirksamen Status (effectiveInvoiceStatus / effectiveQuoteStatus / DeliveryNoteStatus).
 *
 * Die Mengen hier bilden die bestehenden Sichtbarkeits-Sets der Rechnungs-Detailseite
 * nach (CANCELLABLE_TYPES/CREDITABLE_TYPES/NOT_DUPLICATABLE_TYPES in
 * src/app/rechnungen/[id]/page.tsx) — Task 2/4 loesen die Seite auf diese Funktion um,
 * ohne das Verhalten zu aendern.
 */
export type ActionKey =
  | "OPEN"
  | "EDIT"
  | "DUPLICATE"
  | "PDF"
  | "XRECHNUNG"
  | "SEND"
  | "RESEND"
  | "PAYMENT"
  | "REMINDER"
  | "DUNNING"
  | "DELIVERY_NOTE"
  | "CANCEL";

export type DocKind = "INVOICE" | "QUOTE" | "DELIVERY_NOTE" | "RECURRING";

/**
 * Invoice: type ist der Rohtyp (INVOICE|CREDIT_NOTE|CORRECTION|PARTIAL|DOWNPAYMENT|FINAL),
 * status der WIRKSAME Status (effectiveInvoiceStatus-Ergebnis fuer INVOICE, sonst der
 * rohe Beleg-Status — z. B. effectiveQuoteStatus-Ergebnis fuer QUOTE, DeliveryNoteStatus
 * fuer DELIVERY_NOTE).
 */
export interface ActionableDoc {
  kind: DocKind;
  /** Fuer QUOTE: "ANGEBOT" | "AUFTRAGSBESTAETIGUNG" | "PROFORMA". Fuer INVOICE: der
   *  Invoice.type. Sonst ungenutzt. */
  type: string;
  /** Wirksamer Status — siehe Interface-Kommentar. */
  status: string;
  dunningState?: "ACTIVE" | "PAUSED" | "STOPPED";
  hasEmailLog?: boolean;
  isDraft: boolean;
}

// Rechnungstypen, die storniert/(teil-)gutgeschrieben werden koennen — CREDIT_NOTE
// (Stornobeleg selbst) ausgenommen. Deckungsgleich mit CANCELLABLE_TYPES/CREDITABLE_TYPES
// der Detailseite.
const CANCELLABLE_INVOICE_TYPES = new Set(["INVOICE", "CORRECTION", "PARTIAL", "DOWNPAYMENT", "FINAL"]);
// PARTIAL/DOWNPAYMENT/FINAL haengen an einer Quelle — kein freistehendes Duplikat.
// Deckungsgleich mit NOT_DUPLICATABLE_TYPES der Detailseite.
const NOT_DUPLICATABLE_INVOICE_TYPES = new Set(["PARTIAL", "DOWNPAYMENT", "FINAL"]);

const INVOICE_TYPES = new Set(["INVOICE", "CREDIT_NOTE", "CORRECTION", "PARTIAL", "DOWNPAYMENT", "FINAL"]);

function invoiceActions(doc: ActionableDoc): ActionKey[] {
  const actions: ActionKey[] = ["OPEN", "PDF"];
  const isCancelled = doc.status === "CANCELLED";
  const isPayable = INVOICE_TYPES.has(doc.type) && doc.type !== "CREDIT_NOTE";

  if (doc.isDraft) {
    actions.push("EDIT");
  } else {
    // Rechnungsnummer erst nach Festschreibung vorhanden -> XRechnung/Mahnung/Zahlung
    // setzen alle "nicht DRAFT" voraus, unabhaengig vom konkreten Fälligkeits-Status.
    actions.push("XRECHNUNG");
  }

  if (!NOT_DUPLICATABLE_INVOICE_TYPES.has(doc.type)) actions.push("DUPLICATE");

  if (!isCancelled) {
    actions.push(doc.hasEmailLog ? "RESEND" : "SEND");
  }

  if (!doc.isDraft && !isCancelled && isPayable) {
    // PAYMENT nur, solange effectiveInvoiceStatus nicht bereits PAID ist (openCents > 0
    // ist Sache des Aufrufers/openAmountCents — hier reicht der Statuswert).
    if (doc.status !== "PAID") actions.push("PAYMENT");

    if (doc.status === "DUE" || doc.status === "OVERDUE") {
      const dunningActive = doc.dunningState == null || doc.dunningState === "ACTIVE";
      if (dunningActive) {
        actions.push("REMINDER", "DUNNING");
      }
    }
  }

  if (!doc.isDraft && !isCancelled && CANCELLABLE_INVOICE_TYPES.has(doc.type)) {
    actions.push("CANCEL");
  }

  return actions;
}

function quoteActions(doc: ActionableDoc): ActionKey[] {
  const actions: ActionKey[] = ["OPEN", "PDF"];
  const isCancelled = doc.status === "CANCELLED";
  const isRejected = doc.status === "REJECTED";

  if (doc.isDraft) actions.push("EDIT");
  actions.push("DUPLICATE");

  if (!isCancelled && !isRejected) {
    actions.push(doc.hasEmailLog ? "RESEND" : "SEND");
  }

  // Lieferschein/AB nur aus einem angenommenen Angebot bzw. einer AB heraus (§45) —
  // ANGEBOT/AUFTRAGSBESTAETIGUNG jeweils im Status ACCEPTED bzw. bereits SENT/ACCEPTED.
  if (!doc.isDraft && !isCancelled && !isRejected && doc.status === "ACCEPTED") {
    actions.push("DELIVERY_NOTE");
  }

  if (!doc.isDraft && !isCancelled) actions.push("CANCEL");

  return actions;
}

function deliveryNoteActions(doc: ActionableDoc): ActionKey[] {
  const actions: ActionKey[] = ["OPEN", "PDF"];
  const isCancelled = doc.status === "CANCELLED";

  if (doc.isDraft) actions.push("EDIT");
  actions.push("DUPLICATE");

  if (!isCancelled) {
    actions.push(doc.hasEmailLog ? "RESEND" : "SEND");
  }
  if (!doc.isDraft && !isCancelled) actions.push("CANCEL");

  return actions;
}

/**
 * Liefert die im aktuellen Zustand sinnvollen Aktionen fuer einen Beleg. Reine
 * Sichtbarkeitsfunktion — jede Aktion prueft ihre eigentliche Berechtigung erneut in
 * der jeweiligen Domain-Funktion (z. B. cancelInvoice, recordPayment); hier geht es nur
 * darum, ob ein Button/Menuepunkt ueberhaupt angezeigt wird.
 */
export function availableActions(doc: ActionableDoc): ActionKey[] {
  switch (doc.kind) {
    case "INVOICE":
      return invoiceActions(doc);
    case "QUOTE":
      return quoteActions(doc);
    case "DELIVERY_NOTE":
      return deliveryNoteActions(doc);
    case "RECURRING":
      // Abos selbst sind kein GoBD-Beleg (siehe recurring/create.ts) — nur OPEN/EDIT,
      // keine Beleg-Aktionen (PDF/SEND/...).
      return ["OPEN", "EDIT"];
    default:
      return ["OPEN"];
  }
}
