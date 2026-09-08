"use client";

/**
 * Empfaenger-Block (Phase 11c, Task 4, linke Spalte ab `md`): `CustomerPicker` (Task 3)
 * + schreibgeschuetzte Anschrift-Vorschau des gewaehlten Kunden + Ansprechpartner-/
 * Adress-Selects (gefiltert auf `customerId`, OHNE Filterung nach `AddressOption.type` —
 * beide Adress-Selects zeigen alle Adressen des Kunden, `type` dient nur der „Standard
 * des Kunden"-Beschriftung der leeren Option) + `TakeOverPrompt` bei Neuanlage.
 *
 * Welche Adress-Selects erscheinen, haengt vom Modus ab: INVOICE zeigt Rechnungs- UND
 * Lieferadresse, DOCUMENT nur Rechnungsadresse, DELIVERY_NOTE nur Lieferadresse.
 * `TakeOverPrompt` existiert nur fuer INVOICE/DOCUMENT (Lieferscheine kennen die
 * Funktion nicht).
 */
import { useState } from "react";
import { clampTaxRate, type DraftState, type DraftAction, type DraftLine, type LineType } from "@/lib/editor/draft";
import { newLineKey } from "@/lib/editor/ids";
import type { EditorMode } from "@/lib/editor/constants";
import { CustomerPicker, type CustomerOption } from "../CustomerPicker";
import { EditorField } from "../EditorField";
import { inputCls } from "@/components/forms/fields";
import { emptyOptionLabel } from "@/lib/forms/optional-select";
import { nextDiscountOnCustomerChange } from "@/lib/forms/discount-prefill";
import { fromCents, fromMilli, fromPermille } from "@/lib/editor/parse";
import { TakeOverPrompt, type TakeOverPrefillDTO, type TakeOverLineDTO } from "@/components/TakeOverPrompt";

/** `CustomerOption` (Task 3, `CustomerPicker.tsx`) traegt keine Anschrift — fuer die
 *  read-only Anschrift-Vorschau erweitert um optionale Adressfelder (Task 6 liefert sie
 *  im Prisma-`select` mit; ohne sie bleibt die Vorschau schlicht leer). */
export interface RecipientCustomerOption extends CustomerOption {
  addressLine1?: string | null;
  postalCode?: string | null;
  city?: string | null;
  countryCode?: string | null;
}

export interface ContactOption {
  id: string;
  customerId: string;
  name: string;
  isDefault?: boolean;
}

export interface AddressOption {
  id: string;
  customerId: string;
  type: string;
  label: string;
  isDefault?: boolean;
}

function discountPercentOf(c: { defaultDiscountPermille?: number | null } | undefined): string {
  return c?.defaultDiscountPermille ? fromPermille(c.defaultDiscountPermille) : "";
}

// Phase 12c — hier WIRD geklemmt (anders als beim Laden eines bestehenden Belegs, siehe
// `initialLineToDraftLine`): `toDraftLine` liefert Zeilen fuer die Uebernahme in einen
// NEUEN Beleg (`applyTakeOver`, nur `!isEdit`) — ein inzwischen aus der Org-Liste
// entfernter Satz soll dort nicht unbemerkt wieder auftauchen.
function toDraftLine(l: TakeOverLineDTO, allowedTaxRates: readonly number[]): DraftLine {
  return {
    key: newLineKey(),
    lineType: l.lineType as LineType,
    description: l.description,
    descriptionLong: l.descriptionLong ?? "",
    articleNumber: l.articleNumber ?? "",
    quantity: fromMilli(l.quantityMilli),
    unit: l.unit,
    price: fromCents(l.unitNetPriceCents),
    taxRate: clampTaxRate(l.taxRate, allowedTaxRates),
    discountPercent: fromPermille(l.discountPermille),
    discountAmount: fromCents(l.discountCents),
    productId: null,
    expanded: false,
  };
}

const TAKE_OVER_BASE_PATH: Partial<Record<EditorMode, string>> = { INVOICE: "/rechnungen", DOCUMENT: "/dokumente" };

export function RecipientBlock({
  mode,
  isEdit,
  draft,
  dispatch,
  customers,
  contacts = [],
  addresses = [],
  offerLastDocument = false,
}: {
  mode: EditorMode;
  isEdit: boolean;
  draft: DraftState;
  dispatch: (action: DraftAction) => void;
  customers: RecipientCustomerOption[];
  contacts?: ContactOption[];
  addresses?: AddressOption[];
  offerLastDocument?: boolean;
}) {
  // Fix-Welle B6-Muster: der zuletzt AUTOMATISCH angewendete Rabatt-Default — nur wenn
  // das Feld dem noch entspricht (oder leer ist), ueberschreibt ein weiterer
  // Kundenwechsel es erneut.
  const [appliedDefaultDiscount, setAppliedDefaultDiscount] = useState("");

  const selectedCustomer = customers.find((c) => c.id === draft.customerId);
  const customerContacts = contacts.filter((c) => c.customerId === draft.customerId);
  const customerAddresses = addresses.filter((a) => a.customerId === draft.customerId);
  const hasDefaultContact = customerContacts.some((c) => c.isDefault);
  const hasDefaultBillingAddress = customerAddresses.some((a) => a.type === "BILLING" && a.isDefault);
  // Nur fuer DELIVERY_NOTE verwendet (INVOICEs Lieferadresse-Select nutzt statt der
  // Kundenvorgabe-Beschriftung den statischen Text "wie Rechnungsadresse") — ohne
  // Filterung nach `type`.
  const hasDefaultShippingAddress = customerAddresses.some((a) => a.isDefault);

  function selectCustomer(id: string, customer: CustomerOption | null) {
    dispatch({ type: "set", field: "customerId", value: id });
    // Ansprechpartner/Adressen gehoeren zum ALTEN Kunden — beim Kundenwechsel
    // zuruecksetzen, wenn sie nicht (mehr) zum neuen passen.
    if (draft.contactPersonId && !contacts.some((c) => c.id === draft.contactPersonId && c.customerId === id)) {
      dispatch({ type: "set", field: "contactPersonId", value: "" });
    }
    if (draft.billingAddressId && !addresses.some((a) => a.id === draft.billingAddressId && a.customerId === id)) {
      dispatch({ type: "set", field: "billingAddressId", value: "" });
    }
    if (draft.shippingAddressId && !addresses.some((a) => a.id === draft.shippingAddressId && a.customerId === id)) {
      dispatch({ type: "set", field: "shippingAddressId", value: "" });
    }
    if (!isEdit) {
      if (mode === "INVOICE") {
        dispatch({ type: "set", field: "paymentMethodId", value: customer?.defaultPaymentMethodId ?? "" });
      }
      const nextDiscount = nextDiscountOnCustomerChange(draft.documentDiscountPercent, appliedDefaultDiscount, discountPercentOf(customer ?? undefined));
      if (nextDiscount.apply) {
        dispatch({ type: "set", field: "documentDiscountPercent", value: nextDiscount.value });
        setAppliedDefaultDiscount(nextDiscount.value);
      }
    }
  }

  function applyTakeOver(prefill: TakeOverPrefillDTO) {
    const next: DraftState = { ...draft, dirty: true };
    if (prefill.lines?.length) next.lines = prefill.lines.map((l) => toDraftLine(l, draft.allowedTaxRates));
    // Fix 1 (Koordinator-Ruling): `buildTakeOverPrefill` (src/domain/document/take-over.ts)
    // liest `headerText`/`footerText` bereits fuer BEIDE Quellbelege (Invoice UND Quote,
    // L127-129/147-149) — seit HeadTextBlock Kopftext an `headerText` bindet (statt vorher
    // an `notes`), gilt das jetzt auch fuer INVOICE, nicht mehr nur DOCUMENT.
    // `deliveryTerms` bleibt DOCUMENT-only (Invoice kennt kein eigenes Feld dafuer).
    if (mode === "INVOICE" || mode === "DOCUMENT") {
      if (prefill.headerText != null) next.headerText = prefill.headerText;
      if (prefill.footerText != null) next.footerText = prefill.footerText;
    }
    if (mode === "DOCUMENT" && prefill.deliveryTerms != null) next.deliveryTerms = prefill.deliveryTerms;
    if (prefill.paymentTerms != null) next.paymentTerms = prefill.paymentTerms;
    if (prefill.documentDiscount) {
      next.documentDiscountPercent = fromPermille(prefill.documentDiscount.permille);
      next.documentDiscountAmount = fromCents(prefill.documentDiscount.cents);
    }
    dispatch({ type: "replace", state: next });
  }

  const takeOverKind = mode === "INVOICE" ? "INVOICE" : draft.kind === "AUFTRAGSBESTAETIGUNG" ? "ORDER_CONFIRMATION" : "QUOTE";
  const takeOverBasePath = TAKE_OVER_BASE_PATH[mode];

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="font-semibold text-slate-900">Empfänger</h2>

      <EditorField label="Kunde" required>
        {/* Kein `disabled={isEdit}`: auch bei Belegen mit Status DRAFT (der einzige
            bearbeitbare Zustand, siehe z. B. rechnungen/[id]/bearbeiten/page.tsx) laesst
            sich der Kunde im Editor aendern. */}
        {() => <CustomerPicker customers={customers} value={draft.customerId} onChange={selectCustomer} />}
      </EditorField>

      {selectedCustomer && (selectedCustomer.addressLine1 || selectedCustomer.city) && (
        <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500">
          {selectedCustomer.addressLine1}
          {selectedCustomer.addressLine1 && <br />}
          {[selectedCustomer.postalCode, selectedCustomer.city].filter(Boolean).join(" ")}
        </div>
      )}

      {!isEdit && draft.customerId && (mode === "INVOICE" || mode === "DOCUMENT") && takeOverBasePath && (
        <TakeOverPrompt enabled={offerLastDocument} customerId={draft.customerId} kind={takeOverKind} documentDetailBasePath={takeOverBasePath} onApply={applyTakeOver} />
      )}

      <EditorField label="Ansprechpartner">
        {(id) => (
          <select id={id} className={inputCls} value={draft.contactPersonId} onChange={(e) => dispatch({ type: "set", field: "contactPersonId", value: e.target.value })}>
            <option value="">{emptyOptionLabel(hasDefaultContact)}</option>
            {customerContacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </EditorField>

      {(mode === "INVOICE" || mode === "DOCUMENT") && (
        <EditorField label="Rechnungsadresse">
          {(id) => (
            <select id={id} className={inputCls} value={draft.billingAddressId} onChange={(e) => dispatch({ type: "set", field: "billingAddressId", value: e.target.value })}>
              <option value="">{emptyOptionLabel(hasDefaultBillingAddress)}</option>
              {customerAddresses.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          )}
        </EditorField>
      )}

      {mode === "INVOICE" && (
        <EditorField label="Lieferadresse">
          {(id) => (
            <select id={id} className={inputCls} value={draft.shippingAddressId} onChange={(e) => dispatch({ type: "set", field: "shippingAddressId", value: e.target.value })}>
              <option value="">— wie Rechnungsadresse —</option>
              {customerAddresses.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          )}
        </EditorField>
      )}

      {mode === "DELIVERY_NOTE" && (
        <EditorField label="Lieferadresse">
          {(id) => (
            <select id={id} className={inputCls} value={draft.shippingAddressId} onChange={(e) => dispatch({ type: "set", field: "shippingAddressId", value: e.target.value })}>
              <option value="">{emptyOptionLabel(hasDefaultShippingAddress)}</option>
              {customerAddresses.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          )}
        </EditorField>
      )}
    </div>
  );
}
