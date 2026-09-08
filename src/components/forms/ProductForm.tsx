"use client";

import { useActionState } from "react";
import { saveProduct } from "@/app/actions/masterdata";
import type { ActionResult } from "@/app/actions/result";
import { taxRateOptions } from "@/lib/editor/constants";
import { TextField, SelectField, TextAreaField, CheckboxField, SubmitButton, ErrorBanner } from "./fields";

export interface ProductFormData {
  id: string;
  name: string;
  description: string | null;
  articleNumber: string | null;
  unit: string;
  netPriceCents: number;
  taxRate: number;
  differential: boolean;
}

export function ProductForm({
  product,
  taxRates,
}: {
  product?: ProductFormData | null;
  /** Org-eigene Steuersatz-Liste (Phase 12c, Fix-Welle I2) — dieselbe Quelle
   *  (`taxRateOptions`, `@/lib/editor/constants`) wie der Beleg-Editor; die Server-Seite
   *  laedt sie ueber `loadDocumentSettings`. Ersetzt die vorher fest verdrahteten 19/7/0. */
  taxRates: readonly number[];
}) {
  const [state, action] = useActionState<ActionResult, FormData>(saveProduct, { ok: false });
  const baseOptions = taxRateOptions(taxRates).map((o) => ({ value: String(o.value), label: o.label }));
  // Wie LineRow.tsx (Editor): ein bestehendes Produkt kann einen Satz tragen, der
  // inzwischen nicht mehr in der Org-Liste steht (`updateProduct` erlaubt ihn ueber
  // `existing`, GoBD-Parallele) — die Auswahl bleibt trotzdem sichtbar/waehlbar statt
  // ihn stillschweigend zu verlieren (M4-Klasse).
  const options =
    product && !baseOptions.some((o) => o.value === String(product.taxRate))
      ? [...baseOptions, { value: String(product.taxRate), label: `${product.taxRate}% (nicht mehr zulässig)` }]
      : baseOptions;

  return (
    <form action={action} className="space-y-5">
      <ErrorBanner message={state.error} />
      {product && <input type="hidden" name="id" value={product.id} />}

      <div className="grid gap-4 rounded-lg border border-slate-200 bg-white p-5 sm:grid-cols-2">
        <TextField label="Bezeichnung" name="name" defaultValue={product?.name} required className="sm:col-span-2" />
        <TextAreaField label="Beschreibung" name="description" defaultValue={product?.description} className="sm:col-span-2" />
        <TextField
          label="Artikelnummer"
          name="articleNumber"
          defaultValue={product?.articleNumber}
          placeholder="wird automatisch vergeben"
          hint="Leer lassen für automatische Vergabe aus dem Nummernkreis."
        />
        <TextField
          label="Einheit (UN/ECE)"
          name="unit"
          defaultValue={product?.unit ?? "C62"}
          hint="z. B. C62 = Stück, HUR = Stunde, KGM = kg, MTR = m, DAY = Tag"
        />
        <TextField label="Nettopreis (€)" name="netPrice" defaultValue={product ? (product.netPriceCents / 100).toFixed(2) : ""} required placeholder="0,00" />
        <SelectField
          label="USt-Satz"
          name="taxRate"
          defaultValue={product ? String(product.taxRate) : String(options[0]?.value ?? 19)}
          options={options}
        />
        <CheckboxField label="Differenzbesteuerung (§ 25a)" name="differential" defaultChecked={product?.differential} hint="Für Gebrauchtwaren/Refurb." />
      </div>

      <SubmitButton>Produkt speichern</SubmitButton>
    </form>
  );
}
