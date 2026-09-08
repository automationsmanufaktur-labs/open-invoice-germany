/**
 * Gemeinsamer Entwurfszustand für Rechnung/Dokument/Lieferschein (Phase 11c). Reiner
 * Reducer + Payload-Mapper — keine React-Imports hier (siehe `src/components/editor/`
 * für die Anbindung in Task 6).
 *
 * Die Payload-Mapper (`toInvoicePayload`/`toDocumentPayload`/`toDeliveryNotePayload`)
 * erzeugen bewusst exakt dieselben Objekte, die die vor Phase 11c bestehenden
 * Einzelformulare fuer Rechnung/Dokument/Lieferschein an die Domain-Aktionen
 * schickten — inklusive `optionalSelectValue`-Semantik (Anlage: leer -> `undefined`,
 * damit Kundenvorgaben greifen; Bearbeiten: leer -> `null`, damit eine Referenz aktiv
 * entfernt werden kann) und dem "leer -> 0 bei Bearbeiten, sonst undefined"-Muster bei
 * Beleg-Rabatt (Kundenkomfort-Facts).
 */
import { optionalSelectValue } from "@/lib/forms/optional-select";
import { SCHEME_CATEGORY, SCHEME_NOTICE, FALLBACK_TAX_RATES, type EditorMode } from "./constants";
import { SCHEME_NOTICE_ACCEPTED, normalizeNotice } from "@/domain/invoice/mandatory";
import { toCents, toMilli, toPermille, fromCents, fromMilli, fromPermille, centsOrZero, milliOrZero, permilleOrZero } from "./parse";
import { newLineKey } from "./ids";
import type { TaxScheme } from "@/schemas";

export type LineType = "ITEM" | "HEADING" | "TEXT" | "SUBTOTAL";

export interface DraftLine {
  key: string;
  lineType: LineType;
  description: string;
  descriptionLong: string;
  articleNumber: string;
  quantity: string;
  unit: string;
  price: string;
  taxRate: number;
  discountPercent: string;
  discountAmount: string;
  productId?: string | null;
  expanded: boolean;
}

export interface DraftState {
  mode: EditorMode;
  id?: string;
  kind: "ANGEBOT" | "AUFTRAGSBESTAETIGUNG" | "PROFORMA";
  type: "INVOICE" | "CREDIT_NOTE";
  customerId: string;
  taxScheme: TaxScheme;
  subject: string;
  headerText: string;
  footerText: string;
  deliveryTerms: string;
  paymentTerms: string;
  notes: string;
  internalNotes: string;
  /** § 14 Abs. 4 Nr. 9 / § 14b Abs. 1 S. 5 UStG — nur INVOICE (Phase 12b, Task 5). */
  consumerRetentionHint: boolean;
  orderNumber: string;
  customerReference: string;
  internalReference: string;
  buyerReference: string;
  contactPersonId: string;
  billingAddressId: string;
  shippingAddressId: string;
  deliveryDate: string;
  deliveryStart: string;
  deliveryEnd: string;
  dueDate: string;
  validUntil: string;
  shippingDate: string;
  paymentMethodId: string;
  documentDiscountPercent: string;
  documentDiscountAmount: string;
  documentChargePercent: string;
  documentChargeAmount: string;
  documentChargeReason: string;
  skonto1Percent: string;
  skonto1Days: string;
  skonto2Percent: string;
  skonto2Days: string;
  showPrices: boolean;
  showTax: boolean;
  showArticleNumber: boolean;
  showDescription: boolean;
  showDeliveryAddress: boolean;
  lines: DraftLine[];
  grossDisplay: boolean;
  dirty: boolean;
  /** Phase 12c — die org-eigene Steuersatz-Liste (`DocumentSettings.taxRates`), zum
   *  Draft-Aufbau eingefroren: `applyProduct` (Reducer kennt die Liste nicht anders) und
   *  `RecipientBlock`s Uebernahme-Vorschlag (`toDraftLine`, Neuanlage) klemmen neue Werte
   *  darauf. Bereits gespeicherte Zeilen (`draftFrom…`) werden NICHT geklemmt — ihr Satz
   *  bleibt sichtbar/aenderbar, auch wenn die Liste ihn inzwischen nicht mehr enthaelt
   *  (GoBD, §51: ein Beleg verliert seinen Satz nicht, weil die Organisation die Liste
   *  aendert — spiegelt `assertAllowedTaxRates`s `existing`-Ausnahme). */
  allowedTaxRates: number[];
}

// M10 (Abschluss-Review): "set" war bisher `{ field: keyof DraftState; value: unknown }` —
// `dispatch({ type: "set", field: "showPrices", value: "ja" })` kompilierte trotz
// Typfehlers (String statt Boolean). Die Mapped-Type-Union unten koppelt `field`/`value`
// je Schluessel `K` — ein falsch typisierter `value` schlaegt jetzt am Aufrufort fehl.
// Der Reducer (`case "set"`) braucht weiterhin einen `as DraftState`-Cast fuer den
// eigentlichen Spread (bekannte TS-Grenze bei generischen Computed Properties), aber
// DIESER eine, bewusste Cast ist jetzt der einzige Ort, an dem die Korrelation nicht mehr
// geprueft wird — nicht mehr jede Aufrufstelle.
// `-?` ist notwendig, nicht nur Stil: `DraftState.id` ist optional (`id?: string`) — ohne
// `-?` bleibt die gemappte Eigenschaft fuer `K = "id"` selbst optional, und die
// anschliessende Indexzugriff-Vereinigung `[keyof DraftState]` schleust dadurch `undefined`
// in die GESAMTE `SetAction`-Union ein (nicht nur in `value` fuer "id", was korrekt waere,
// sondern strukturell in jedes Union-Mitglied) — Symptom war ein voellig unnarrowbares
// `DraftAction` im Reducer unten ("action is possibly undefined" auf einem Pflichtparameter).
// `-?` entfernt nur den Optional-Modifier der gemappten Huelle; `DraftState[K]` bleibt fuer
// "id" weiterhin korrekt `string | undefined`.
type SetAction = { [K in keyof DraftState]-?: { type: "set"; field: K; value: DraftState[K] } }[keyof DraftState];

export type DraftAction =
  | SetAction
  | { type: "setLine"; key: string; patch: Partial<DraftLine> }
  | { type: "addLine"; lineType: DraftLine["lineType"]; after?: string }
  | { type: "removeLine"; key: string }
  | { type: "moveLine"; key: string; to: number }
  | { type: "duplicateLine"; key: string }
  // Task-5-Fix (Minor): eigene Aktion statt `setLine`, damit das Ein-/Ausblenden des
  // Langtexts (reine Anzeige, keine inhaltliche Aenderung) NICHT `dirty: true` setzt.
  | { type: "toggleExpanded"; key: string }
  | {
      type: "applyProduct";
      key: string;
      product: { id: string; name: string; unit: string; netPriceCents: number; taxRate: number; articleNumber?: string | null };
    }
  | { type: "replace"; state: DraftState }
  | { type: "markSaved" };

/** Phase 12c — haelt einen Satz in der org-eigenen Liste. Unbekannte Werte (z. B. aus einem
 *  Produktstamm, dessen Satz inzwischen entfernt wurde) fallen auf den hoechsten
 *  freigegebenen Satz zurueck; Zod/assertAllowedTaxRates entscheiden beim Speichern. */
export function clampTaxRate(n: number, allowed: readonly number[]): number {
  const list = allowed.length > 0 ? allowed : FALLBACK_TAX_RATES;
  return list.includes(n) ? n : Math.max(...list);
}

function emptyLine(lineType: LineType = "ITEM", allowed: readonly number[] = FALLBACK_TAX_RATES): DraftLine {
  return {
    key: newLineKey(),
    lineType,
    description: "",
    descriptionLong: "",
    articleNumber: "",
    quantity: "1",
    unit: "C62",
    price: "0",
    taxRate: clampTaxRate(19, allowed),
    discountPercent: "0",
    discountAmount: "0",
    productId: null,
    expanded: false,
  };
}

export function emptyDraft(mode: EditorMode, defaults?: Partial<DraftState>): DraftState {
  const allowedTaxRates = defaults?.allowedTaxRates ?? [...FALLBACK_TAX_RATES];
  const base: DraftState = {
    mode,
    id: undefined,
    kind: "ANGEBOT",
    type: "INVOICE",
    customerId: "",
    taxScheme: "REGULAR",
    subject: "",
    headerText: "",
    footerText: "",
    deliveryTerms: "",
    paymentTerms: "",
    notes: "",
    internalNotes: "",
    consumerRetentionHint: false,
    orderNumber: "",
    customerReference: "",
    internalReference: "",
    buyerReference: "",
    contactPersonId: "",
    billingAddressId: "",
    shippingAddressId: "",
    deliveryDate: "",
    deliveryStart: "",
    deliveryEnd: "",
    dueDate: "",
    validUntil: "",
    shippingDate: "",
    paymentMethodId: "",
    documentDiscountPercent: "",
    documentDiscountAmount: "",
    documentChargePercent: "0",
    documentChargeAmount: "0",
    documentChargeReason: "",
    skonto1Percent: "",
    skonto1Days: "",
    skonto2Percent: "",
    skonto2Days: "",
    showPrices: false,
    showTax: false,
    showArticleNumber: true,
    showDescription: true,
    showDeliveryAddress: true,
    lines: [emptyLine("ITEM", allowedTaxRates)],
    grossDisplay: false,
    dirty: false,
    allowedTaxRates,
  };
  return defaults ? { ...base, ...defaults } : base;
}

export function draftReducer(state: DraftState, action: DraftAction): DraftState {
  switch (action.type) {
    case "replace":
      return action.state;
    case "markSaved":
      return { ...state, dirty: false };
    case "set":
      return { ...state, [action.field]: action.value, dirty: true } as DraftState;
    case "setLine":
      return {
        ...state,
        lines: state.lines.map((l) => (l.key === action.key ? { ...l, ...action.patch } : l)),
        dirty: true,
      };
    case "toggleExpanded":
      return {
        ...state,
        lines: state.lines.map((l) => (l.key === action.key ? { ...l, expanded: !l.expanded } : l)),
        // bewusst OHNE dirty: true — siehe Kommentar bei DraftAction["toggleExpanded"].
      };
    case "addLine": {
      const idx = action.after ? state.lines.findIndex((l) => l.key === action.after) : state.lines.length - 1;
      const insertAt = idx === -1 ? state.lines.length : idx + 1;
      const lines = [...state.lines];
      lines.splice(insertAt, 0, emptyLine(action.lineType, state.allowedTaxRates));
      return { ...state, lines, dirty: true };
    }
    case "removeLine": {
      const lines = state.lines.filter((l) => l.key !== action.key);
      // Nie leer: die letzte verbleibende Zeile wird durch eine leere ITEM-Zeile ersetzt.
      return { ...state, lines: lines.length ? lines : [emptyLine("ITEM", state.allowedTaxRates)], dirty: true };
    }
    case "moveLine": {
      const from = state.lines.findIndex((l) => l.key === action.key);
      if (from === -1) return state;
      const lines = [...state.lines];
      const [moved] = lines.splice(from, 1);
      const to = Math.max(0, Math.min(lines.length, action.to));
      lines.splice(to, 0, moved!);
      return { ...state, lines, dirty: true };
    }
    case "duplicateLine": {
      const idx = state.lines.findIndex((l) => l.key === action.key);
      if (idx === -1) return state;
      const copy: DraftLine = { ...state.lines[idx]!, key: newLineKey() };
      const lines = [...state.lines];
      lines.splice(idx + 1, 0, copy);
      return { ...state, lines, dirty: true };
    }
    case "applyProduct": {
      return {
        ...state,
        lines: state.lines.map((l) => {
          if (l.key !== action.key) return l;
          // Muster aus der ProductPicker-Verwendung: eine Beschreibung, die der Nutzer
          // selbst getippt hat, wird nicht ueberschrieben — nur wenn das Feld noch leer
          // ist oder die Zeile bereits von einem (anderen) Produkt uebernommen wurde.
          const takeOverDescription = l.description.trim() === "" || Boolean(l.productId);
          return {
            ...l,
            description: takeOverDescription ? action.product.name : l.description,
            price: fromCents(action.product.netPriceCents),
            unit: action.product.unit,
            taxRate: clampTaxRate(action.product.taxRate, state.allowedTaxRates),
            articleNumber: action.product.articleNumber ?? "",
            productId: action.product.id,
          };
        }),
        dirty: true,
      };
    }
    default:
      return state;
  }
}

// ── Payload-Mapper ──────────────────────────────────────────────────────────
// centsOrZero/milliOrZero/permilleOrZero leben in parse.ts (Fix 1: dieselben
// geklemmten Helfer wie totals.ts, damit Live-Summen und Payload nie auseinanderlaufen).

function daysOrUndefined(s: string): number | undefined {
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function toInvoicePayload(d: DraftState, isEdit: boolean): Record<string, unknown> {
  const isRegular = d.taxScheme === "REGULAR";
  const notice = SCHEME_NOTICE[d.taxScheme];
  // Fix 1 (Koordinator, Task 5): notice nur voranstellen, wenn `notes` noch KEINE fuer das
  // Schema zulaessige Formulierung enthaelt (SCHEME_NOTICE_ACCEPTED, dieselbe Pruefung wie
  // validateMandatoryFields und der "Pflichthinweis einfuegen"-Knopf in MoreOptions.tsx) —
  // sonst wuerde jeder Speicher-Durchlauf (inkl. Bearbeiten eines bereits gespeicherten
  // Entwurfs) den Hinweis erneut voranstellen und `notes` bei jedem Save verdoppeln.
  const accepted = SCHEME_NOTICE_ACCEPTED[d.taxScheme] ?? [];
  const hasAcceptedNotice = accepted.some((re) => re.test(normalizeNotice(d.notes)));
  const finalNotes = notice && !hasAcceptedNotice ? `${notice}${d.notes ? " — " + d.notes : ""}` : d.notes || undefined;

  const lines = d.lines.map((l) => ({
    lineType: l.lineType,
    description: l.description,
    descriptionLong: l.descriptionLong || undefined,
    articleNumber: l.articleNumber || undefined,
    quantityMilli: l.lineType === "ITEM" ? milliOrZero(l.quantity) : 0,
    unit: l.unit || "C62",
    unitNetPriceCents: l.lineType === "ITEM" ? centsOrZero(l.price) : 0,
    taxRate: l.lineType === "ITEM" ? (isRegular ? l.taxRate : 0) : 0,
    taxCategory: SCHEME_CATEGORY[d.taxScheme] ?? "S",
    discountPermille: l.lineType === "ITEM" ? permilleOrZero(l.discountPercent) : 0,
    discountCents: l.lineType === "ITEM" ? centsOrZero(l.discountAmount) : 0,
  }));

  const shared: Record<string, unknown> = {
    customerId: d.customerId,
    taxScheme: d.taxScheme,
    currency: "EUR",
    subject: d.subject || undefined,
    orderNumber: d.orderNumber || undefined,
    internalReference: d.internalReference || undefined,
    buyerReference: d.buyerReference || undefined,
    contactPersonId: optionalSelectValue(d.contactPersonId, isEdit),
    billingAddressId: optionalSelectValue(d.billingAddressId, isEdit),
    shippingAddressId: optionalSelectValue(d.shippingAddressId, isEdit),
    deliveryStart: d.deliveryStart || undefined,
    deliveryEnd: d.deliveryEnd || undefined,
    deliveryDate: d.deliveryDate || undefined,
    dueDate: d.dueDate || undefined,
    notes: finalNotes,
    internalNotes: d.internalNotes || undefined,
    consumerRetentionHint: d.consumerRetentionHint,
    paymentTerms: d.paymentTerms || undefined,
    // Fix 2 (Task-1-Review): createDraftInvoice waehlt bei Neuanlage die INVOICE-HEAD/
    // FOOT-Textvorlage nur, wenn headerText/footerText UNDEFINED ist (`input.headerText
    // ?? pickTextTemplate(...)`) — ein leerer, aber gesetzter String wuerde die
    // Vorlagenauswahl unterdruecken. Beim Bearbeiten liest updateDraftInvoice dagegen
    // jeden Wert !== undefined (auch ""), um das Feld gezielt leeren zu koennen.
    headerText: isEdit ? d.headerText : d.headerText || undefined,
    footerText: isEdit ? d.footerText : d.footerText || undefined,
    documentDiscountPermille: d.documentDiscountPercent.trim() ? permilleOrZero(d.documentDiscountPercent) : isEdit ? 0 : undefined,
    documentDiscountCents: d.documentDiscountAmount.trim() ? centsOrZero(d.documentDiscountAmount) : isEdit ? 0 : undefined,
    documentChargePermille: permilleOrZero(d.documentChargePercent),
    documentChargeCents: centsOrZero(d.documentChargeAmount),
    documentChargeReason: d.documentChargeReason || undefined,
    skonto1Permille: d.skonto1Percent ? permilleOrZero(d.skonto1Percent) : undefined,
    skonto1Days: daysOrUndefined(d.skonto1Days),
    skonto2Permille: d.skonto2Percent ? permilleOrZero(d.skonto2Percent) : undefined,
    skonto2Days: daysOrUndefined(d.skonto2Days),
    paymentMethodId: d.paymentMethodId || undefined,
    lines,
  };

  return isEdit ? shared : { ...shared, type: d.type };
}

export function toDocumentPayload(d: DraftState, isEdit: boolean): Record<string, unknown> {
  const lines = d.lines.map((l) => ({
    lineType: l.lineType,
    description: l.description,
    descriptionLong: l.descriptionLong || undefined,
    articleNumber: l.articleNumber || undefined,
    quantityMilli: l.lineType === "ITEM" ? milliOrZero(l.quantity) : 0,
    unit: l.unit || "C62",
    unitNetPriceCents: l.lineType === "ITEM" ? centsOrZero(l.price) : 0,
    taxRate: l.lineType === "ITEM" ? l.taxRate : 0,
    taxCategory: "S",
    discountPermille: l.lineType === "ITEM" ? permilleOrZero(l.discountPercent) : 0,
    discountCents: l.lineType === "ITEM" ? centsOrZero(l.discountAmount) : 0,
  }));

  const shared: Record<string, unknown> = {
    customerId: d.customerId,
    taxScheme: "REGULAR",
    currency: "EUR",
    subject: d.subject || undefined,
    customerReference: d.customerReference || undefined,
    contactPersonId: optionalSelectValue(d.contactPersonId, isEdit),
    billingAddressId: optionalSelectValue(d.billingAddressId, isEdit),
    validUntil: d.validUntil || undefined,
    headerText: d.headerText || undefined,
    footerText: d.footerText || undefined,
    deliveryTerms: d.deliveryTerms || undefined,
    paymentTerms: d.paymentTerms || undefined,
    documentDiscountPermille: d.documentDiscountPercent.trim() ? permilleOrZero(d.documentDiscountPercent) : isEdit ? 0 : undefined,
    documentDiscountCents: d.documentDiscountAmount.trim() ? centsOrZero(d.documentDiscountAmount) : isEdit ? 0 : undefined,
    documentChargePermille: permilleOrZero(d.documentChargePercent),
    documentChargeCents: centsOrZero(d.documentChargeAmount),
    documentChargeReason: d.documentChargeReason || undefined,
    notes: d.notes || undefined,
    internalNotes: d.internalNotes || undefined,
    lines,
  };

  return isEdit ? shared : { kind: d.kind, ...shared };
}

export function toDeliveryNotePayload(d: DraftState): Record<string, unknown> {
  return {
    customerId: d.customerId,
    contactPersonId: optionalSelectValue(d.contactPersonId, false),
    shippingAddressId: optionalSelectValue(d.shippingAddressId, false),
    deliveryDate: d.deliveryDate || undefined,
    // Fix 2 (Task-1-Review): shippingDate/internalNotes sind in createDeliveryNoteSchema
    // vorhanden, der Editor exponiert sie hier zusaetzlich.
    shippingDate: d.shippingDate || undefined,
    internalNotes: d.internalNotes || undefined,
    // Fix-Welle I1/I2 (Abschluss-Review): headerText/footerText/showDeliveryAddress werden
    // im Editor angezeigt (HeadTextBlock/FootTextBlock/MoreOptions fuer ALLE drei Modi,
    // siehe dortige Kommentare) und von createDeliveryNoteSchema/createDeliveryNoteWithinTx
    // verarbeitet — vorher fielen sie hier still unter den Tisch, obwohl der Nutzer sie
    // sichtbar bedienen konnte (Lastenheft 59, "keine Buttons ohne Backend").
    headerText: d.headerText || undefined,
    footerText: d.footerText || undefined,
    showPrices: d.showPrices,
    showTax: d.showTax,
    showArticleNumber: d.showArticleNumber,
    showDescription: d.showDescription,
    showDeliveryAddress: d.showDeliveryAddress,
    notes: d.notes || undefined,
    // Lieferscheine kennen keinen lineType — nur ITEM-Zeilen ergeben eine gueltige
    // Lieferschein-Position (deliveryNoteLineInputSchema verlangt quantityMilli > 0).
    lines: d.lines
      .filter((l) => l.lineType === "ITEM")
      .map((l) => ({
        description: l.description,
        articleNumber: l.articleNumber || undefined,
        quantityMilli: milliOrZero(l.quantity),
        unit: l.unit,
        unitNetPriceCents: centsOrZero(l.price),
        taxRate: l.taxRate,
      })),
  };
}

export function validateDraft(d: DraftState): string[] {
  const problems: string[] = [];
  if (!d.customerId) problems.push("Kunde ist nicht ausgewählt.");

  const itemLines = d.lines.filter((l) => l.lineType === "ITEM");
  if (itemLines.length === 0) {
    problems.push("Mindestens eine Position ist erforderlich.");
  }
  itemLines.forEach((l, idx) => {
    const quantityMilli = toMilli(l.quantity);
    if (quantityMilli === null || quantityMilli === 0) {
      problems.push(`Position ${idx + 1}: Menge muss angegeben werden (ungleich 0).`);
    }
    const unitNetPriceCents = toCents(l.price);
    if (unitNetPriceCents === null) {
      problems.push(`Position ${idx + 1}: Preis ist ungültig.`);
    }
  });

  // I4 (Abschluss-Review): ITEM/HEADING/TEXT verlangen serverseitig eine Beschreibung
  // (invoiceLineInputSchema/deliveryNoteLineInputSchema: description z.string().min(1)) —
  // ohne diese Pruefung landet z. B. eine durch "Enter" in der letzten Zeile versehentlich
  // angelegte leere ITEM-Zeile erst als feldloses "Validierung fehlgeschlagen"-Banner beim
  // Server (siehe DocumentEditor.save()). SUBTOTAL bewusst ausgenommen (Koordinator-Ruling):
  // eine leere Zwischensummen-Bezeichnung faengt der Server ab (jetzt mit lesbarer Meldung,
  // siehe save()), soll den Editor aber nicht zusaetzlich vorab blockieren.
  d.lines.forEach((l, idx) => {
    if (l.lineType === "SUBTOTAL") return;
    if (l.description.trim() === "") {
      problems.push(`Zeile ${idx + 1}: Beschreibung fehlt.`);
    }
  });

  return problems;
}

// ── initial -> Draft (Bearbeiten bestehender Belege) ─────────────────────────

/** Zeilenform der Bearbeiten-Seiten (`InvoiceInitialLike`/`DocumentInitialLike` unten).
 *  M4 (Abschluss-Review): kein `export` mehr — kein Importer, die Seiten bauen ihre
 *  Zeilenobjekte inline innerhalb von `InvoiceInitialLike["lines"]`/`DocumentInitialLike["lines"]`. */
interface InitialLineLike {
  lineType: LineType;
  description: string;
  descriptionLong: string;
  articleNumber: string;
  quantity: string;
  unit: string;
  price: string;
  taxRate: number;
  discountPercent: string;
  discountAmount: string;
}

/** Shape, das `src/app/rechnungen/[id]/bearbeiten/page.tsx` aus der geladenen Rechnung baut und an `draftFromInvoice` uebergibt. */
export interface InvoiceInitialLike {
  id: string;
  customerId: string;
  taxScheme: string;
  subject: string;
  orderNumber: string;
  internalReference: string;
  buyerReference: string;
  contactPersonId: string;
  billingAddressId: string;
  shippingAddressId: string;
  deliveryStart: string;
  deliveryEnd: string;
  deliveryDate: string;
  dueDate: string;
  notes: string;
  internalNotes: string;
  /** § 14 Abs. 4 Nr. 9 / § 14b Abs. 1 S. 5 UStG (Phase 12b, Task 5). */
  consumerRetentionHint: boolean;
  paymentTerms: string;
  paymentMethodId: string;
  // Fix 2 (Task-1-Review, Ruling nach Task 4): headerText/footerText existieren im
  // Schema/`createDraftInvoice`/`updateDraftInvoice` bereits und werden hier mit
  // uebernommen.
  headerText: string;
  footerText: string;
  documentDiscountPercent: string;
  documentDiscountAmount: string;
  documentChargePercent: string;
  documentChargeAmount: string;
  documentChargeReason: string;
  skonto1Percent: string;
  skonto1Days: string;
  skonto2Percent: string;
  skonto2Days: string;
  lines: InitialLineLike[];
}

/** Shape, das `src/app/dokumente/[id]/bearbeiten/page.tsx` aus dem geladenen Dokument baut und an `draftFromDocument` uebergibt. */
export interface DocumentInitialLike {
  id: string;
  kind: string;
  customerId: string;
  subject: string;
  customerReference: string;
  contactPersonId: string;
  billingAddressId: string;
  validUntil: string;
  headerText: string;
  footerText: string;
  deliveryTerms: string;
  paymentTerms: string;
  notes: string;
  internalNotes: string;
  documentDiscountPercent: string;
  documentDiscountAmount: string;
  documentChargePercent: string;
  documentChargeAmount: string;
  documentChargeReason: string;
  lines: InitialLineLike[];
}

/** Parst einen Anzeige-String und formatiert ihn ueber die kanonische Cent-/Milli-/Permille-Form zurueck — normalisiert z. B. "2.5" (Server-`.toString()`) auf "2,5". Leere/ungueltige Eingabe bleibt unveraendert (bzw. leer). */
function roundTrip(s: string | undefined, parse: (s: string) => number | null, format: (n: number) => string): string {
  if (s === undefined || s.trim() === "") return "";
  const n = parse(s);
  return n === null ? s : format(n);
}

// Phase 12c — BEWUSST kein `clampTaxRate` hier: eine bereits gespeicherte Zeile behaelt
// ihren Satz beim Oeffnen im Editor, auch wenn er nicht (mehr) in der Org-Liste steht
// (GoBD, §51 — spiegelt `assertAllowedTaxRates`s `existing`-Ausnahme, siehe
// `DraftState.allowedTaxRates`-Kommentar). `LineRow` zeigt einen solchen Satz als
// zusaetzliche, als "nicht mehr zulaessig" markierte Option, statt ihn hier stillschweigend
// auf den hoechsten freigegebenen Satz zu aendern — Speichern ohne Aenderung an der Zeile
// darf den Satz nicht verschieben.
function initialLineToDraftLine(l: InitialLineLike): DraftLine {
  return {
    key: newLineKey(),
    lineType: l.lineType,
    description: l.description ?? "",
    descriptionLong: l.descriptionLong ?? "",
    articleNumber: l.articleNumber ?? "",
    quantity: roundTrip(l.quantity, toMilli, fromMilli),
    unit: l.unit || "C62",
    price: roundTrip(l.price, toCents, fromCents),
    taxRate: l.taxRate,
    discountPercent: roundTrip(l.discountPercent, toPermille, fromPermille),
    discountAmount: roundTrip(l.discountAmount, toCents, fromCents),
    productId: null,
    expanded: false,
  };
}

function initialLines(lines: InitialLineLike[] | undefined, allowedTaxRates: readonly number[]): DraftLine[] {
  return lines && lines.length ? lines.map(initialLineToDraftLine) : [emptyLine("ITEM", allowedTaxRates)];
}

export function draftFromInvoice(initial: InvoiceInitialLike, taxRates: readonly number[] = FALLBACK_TAX_RATES): DraftState {
  const allowedTaxRates = [...taxRates];
  const base = emptyDraft("INVOICE", { allowedTaxRates });
  return {
    ...base,
    id: initial.id,
    customerId: initial.customerId ?? "",
    taxScheme: (initial.taxScheme as TaxScheme) ?? "REGULAR",
    subject: initial.subject ?? "",
    orderNumber: initial.orderNumber ?? "",
    internalReference: initial.internalReference ?? "",
    buyerReference: initial.buyerReference ?? "",
    contactPersonId: initial.contactPersonId ?? "",
    billingAddressId: initial.billingAddressId ?? "",
    shippingAddressId: initial.shippingAddressId ?? "",
    deliveryStart: initial.deliveryStart ?? "",
    deliveryEnd: initial.deliveryEnd ?? "",
    deliveryDate: initial.deliveryDate ?? "",
    dueDate: initial.dueDate ?? "",
    notes: initial.notes ?? "",
    internalNotes: initial.internalNotes ?? "",
    consumerRetentionHint: initial.consumerRetentionHint ?? false,
    paymentTerms: initial.paymentTerms ?? "",
    paymentMethodId: initial.paymentMethodId ?? "",
    headerText: initial.headerText ?? "",
    footerText: initial.footerText ?? "",
    documentDiscountPercent: roundTrip(initial.documentDiscountPercent, toPermille, fromPermille),
    documentDiscountAmount: roundTrip(initial.documentDiscountAmount, toCents, fromCents),
    documentChargePercent: roundTrip(initial.documentChargePercent, toPermille, fromPermille),
    documentChargeAmount: roundTrip(initial.documentChargeAmount, toCents, fromCents),
    documentChargeReason: initial.documentChargeReason ?? "",
    skonto1Percent: roundTrip(initial.skonto1Percent, toPermille, fromPermille),
    skonto1Days: initial.skonto1Days ?? "",
    skonto2Percent: roundTrip(initial.skonto2Percent, toPermille, fromPermille),
    skonto2Days: initial.skonto2Days ?? "",
    lines: initialLines(initial.lines, allowedTaxRates),
    dirty: false,
  };
}

export function draftFromDocument(initial: DocumentInitialLike, taxRates: readonly number[] = FALLBACK_TAX_RATES): DraftState {
  const allowedTaxRates = [...taxRates];
  const base = emptyDraft("DOCUMENT", { allowedTaxRates });
  const kind: DraftState["kind"] =
    initial.kind === "AUFTRAGSBESTAETIGUNG" || initial.kind === "PROFORMA" || initial.kind === "ANGEBOT" ? initial.kind : "ANGEBOT";
  return {
    ...base,
    id: initial.id,
    kind,
    customerId: initial.customerId ?? "",
    subject: initial.subject ?? "",
    customerReference: initial.customerReference ?? "",
    contactPersonId: initial.contactPersonId ?? "",
    billingAddressId: initial.billingAddressId ?? "",
    validUntil: initial.validUntil ?? "",
    headerText: initial.headerText ?? "",
    footerText: initial.footerText ?? "",
    deliveryTerms: initial.deliveryTerms ?? "",
    paymentTerms: initial.paymentTerms ?? "",
    notes: initial.notes ?? "",
    internalNotes: initial.internalNotes ?? "",
    documentDiscountPercent: roundTrip(initial.documentDiscountPercent, toPermille, fromPermille),
    documentDiscountAmount: roundTrip(initial.documentDiscountAmount, toCents, fromCents),
    documentChargePercent: roundTrip(initial.documentChargePercent, toPermille, fromPermille),
    documentChargeAmount: roundTrip(initial.documentChargeAmount, toCents, fromCents),
    documentChargeReason: initial.documentChargeReason ?? "",
    lines: initialLines(initial.lines, allowedTaxRates),
    dirty: false,
  };
}
