"use client";

import { useActionState } from "react";
import { saveProduct } from "@/app/actions/masterdata";
import type { ActionResult } from "@/app/actions/result";
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

export function ProductForm({ product }: { product?: ProductFormData | null }) {
  const [state, action] = useActionState<ActionResult, FormData>(saveProduct, { ok: false });

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
          defaultValue={product ? String(product.taxRate) : "19"}
          options={[
            { value: "19", label: "19 %" },
            { value: "7", label: "7 %" },
            { value: "0", label: "0 %" },
          ]}
        />
        <CheckboxField label="Differenzbesteuerung (§ 25a)" name="differential" defaultChecked={product?.differential} hint="Für Gebrauchtwaren/Refurb." />
      </div>

      <SubmitButton>Produkt speichern</SubmitButton>
    </form>
  );
}
