"use client";

/**
 * Belegdaten-Block (Phase 11c, Task 4, rechte Spalte ab `md`): Modus-spezifische
 * Kopf-Metadaten (Typ/Art, Steuerschema, Termine, Zahlungsmethode, Kundenreferenz) +
 * Betreff.
 *
 * Betreff erscheint NUR bei INVOICE/DOCUMENT: `DeliveryNote` hat weder in Prisma-Schema
 * noch in `toDeliveryNotePayload` (Task 1) ein `subject`-Feld — ein hier angezeigtes
 * Feld wuerde beim Speichern stillschweigend verworfen (Code schlaegt Doku, Lastenheft
 * 61.6), obwohl der Brief „alle: Betreff" nennt. Siehe Task-4-Report, offener Punkt.
 */
import type { DraftState, DraftAction } from "@/lib/editor/draft";
import type { EditorMode } from "@/lib/editor/constants";
import { EditorField } from "../EditorField";
import { inputCls } from "@/components/forms/fields";

export interface PaymentMethodOption {
  id: string;
  name: string;
  paymentTermsDays?: number | null;
}

function addDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export function MetaBlock({
  mode,
  isEdit,
  draft,
  dispatch,
  paymentMethods = [],
}: {
  mode: EditorMode;
  isEdit: boolean;
  draft: DraftState;
  dispatch: (action: DraftAction) => void;
  paymentMethods?: PaymentMethodOption[];
}) {
  const selectedMethod = paymentMethods.find((m) => m.id === draft.paymentMethodId);

  return (
    <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="font-semibold text-slate-900">Belegdaten</h2>

      {mode === "INVOICE" && !isEdit && (
        <EditorField label="Typ">
          {(id) => (
            <select
              id={id}
              className={inputCls}
              value={draft.type}
              onChange={(e) => dispatch({ type: "set", field: "type", value: e.target.value as DraftState["type"] })}
            >
              <option value="INVOICE">Rechnung</option>
              <option value="CREDIT_NOTE">Gutschrift</option>
            </select>
          )}
        </EditorField>
      )}

      {mode === "INVOICE" && (
        <EditorField label="Steuerschema">
          {(id) => (
            <select
              id={id}
              className={inputCls}
              value={draft.taxScheme}
              onChange={(e) => dispatch({ type: "set", field: "taxScheme", value: e.target.value as DraftState["taxScheme"] })}
            >
              <option value="REGULAR">Regelbesteuerung</option>
              <option value="KLEINUNTERNEHMER">Kleinunternehmer (§ 19)</option>
              <option value="DIFFERENZ">Differenzbesteuerung (§ 25a)</option>
              <option value="REVERSE_CHARGE">Reverse Charge (§ 13b)</option>
              <option value="IG_LIEFERUNG">Innergem. Lieferung (§ 6a)</option>
              <option value="IG_LEISTUNG">Innergem. Leistung (§ 3a Abs. 2)</option>
              <option value="AUSFUHR">Ausfuhrlieferung (§ 6)</option>
            </select>
          )}
        </EditorField>
      )}

      {mode === "INVOICE" && (
        <EditorField label="Leistungsdatum">
          {(id) => (
            <input id={id} type="date" className={inputCls} value={draft.deliveryDate} onChange={(e) => dispatch({ type: "set", field: "deliveryDate", value: e.target.value })} />
          )}
        </EditorField>
      )}

      {mode === "INVOICE" && (
        <EditorField label="Fällig am">
          {(id) => (
            <div className="flex flex-wrap items-center gap-2">
              <input
                id={id}
                type="date"
                className={`${inputCls} flex-1`}
                value={draft.dueDate}
                onChange={(e) => dispatch({ type: "set", field: "dueDate", value: e.target.value })}
              />
              <button type="button" onClick={() => dispatch({ type: "set", field: "dueDate", value: addDays(14) })} className="whitespace-nowrap text-xs font-medium text-indigo-600 hover:underline">
                +14 Tage
              </button>
              <button type="button" onClick={() => dispatch({ type: "set", field: "dueDate", value: addDays(30) })} className="whitespace-nowrap text-xs font-medium text-indigo-600 hover:underline">
                +30 Tage
              </button>
              {selectedMethod?.paymentTermsDays != null && (
                <button
                  type="button"
                  onClick={() => dispatch({ type: "set", field: "dueDate", value: addDays(selectedMethod.paymentTermsDays!) })}
                  className="whitespace-nowrap text-xs font-medium text-indigo-600 hover:underline"
                >
                  +{selectedMethod.paymentTermsDays} Tage (Zahlungsmethode)
                </button>
              )}
            </div>
          )}
        </EditorField>
      )}

      {mode === "INVOICE" && (
        <EditorField label="Zahlungsmethode">
          {(id) => (
            <select id={id} className={inputCls} value={draft.paymentMethodId} onChange={(e) => dispatch({ type: "set", field: "paymentMethodId", value: e.target.value })}>
              <option value="">— keine —</option>
              {paymentMethods.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )}
        </EditorField>
      )}

      {mode === "DOCUMENT" && !isEdit && (
        <EditorField label="Art">
          {(id) => (
            <select id={id} className={inputCls} value={draft.kind} onChange={(e) => dispatch({ type: "set", field: "kind", value: e.target.value as DraftState["kind"] })}>
              <option value="ANGEBOT">Angebot</option>
              <option value="AUFTRAGSBESTAETIGUNG">Auftragsbestätigung</option>
              <option value="PROFORMA">Proforma-Rechnung</option>
            </select>
          )}
        </EditorField>
      )}

      {mode === "DOCUMENT" && (
        <EditorField label="Gültig bis" hint="optional">
          {(id) => <input id={id} type="date" className={inputCls} value={draft.validUntil} onChange={(e) => dispatch({ type: "set", field: "validUntil", value: e.target.value })} />}
        </EditorField>
      )}

      {mode === "DOCUMENT" && (
        <EditorField label="Kundenreferenz / Bestellnummer">
          {(id) => <input id={id} className={inputCls} value={draft.customerReference} onChange={(e) => dispatch({ type: "set", field: "customerReference", value: e.target.value })} />}
        </EditorField>
      )}

      {mode === "DELIVERY_NOTE" && (
        <EditorField label="Lieferdatum" hint="optional">
          {(id) => <input id={id} type="date" className={inputCls} value={draft.deliveryDate} onChange={(e) => dispatch({ type: "set", field: "deliveryDate", value: e.target.value })} />}
        </EditorField>
      )}

      {mode === "DELIVERY_NOTE" && (
        <EditorField label="Versanddatum" hint="optional">
          {(id) => <input id={id} type="date" className={inputCls} value={draft.shippingDate} onChange={(e) => dispatch({ type: "set", field: "shippingDate", value: e.target.value })} />}
        </EditorField>
      )}

      {(mode === "INVOICE" || mode === "DOCUMENT") && (
        <EditorField label="Betreff">
          {(id) => <input id={id} className={inputCls} value={draft.subject} onChange={(e) => dispatch({ type: "set", field: "subject", value: e.target.value })} />}
        </EditorField>
      )}
    </div>
  );
}
