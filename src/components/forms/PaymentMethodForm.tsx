"use client";

import { useActionState } from "react";
import { savePaymentMethodAction } from "@/app/actions/payment-methods";
import type { ActionResult } from "@/app/actions/result";
import { TextField, TextAreaField, CheckboxField, SubmitButton, ErrorBanner } from "./fields";

export interface PaymentMethodFormData {
  id: string;
  code: string;
  name: string;
  description: string | null;
  paymentTermsDays: number | null;
  invoiceText: string | null;
  bankAccountRef: string | null;
  bankIban: string | null;
  bankBic: string | null;
  bankName: string | null;
  untdidCode: string;
  isSystem: boolean;
  isActive: boolean;
  sortOrder: number;
}

export function PaymentMethodForm({ method }: { method?: PaymentMethodFormData | null }) {
  const [state, action] = useActionState<ActionResult, FormData>(savePaymentMethodAction, { ok: false });
  const isSystem = method?.isSystem ?? false;

  return (
    <form action={action} className="space-y-5">
      <ErrorBanner message={state.error} />
      {method && <input type="hidden" name="id" value={method.id} />}

      <div className="grid gap-4 rounded-lg border border-slate-200 bg-white p-5 sm:grid-cols-2">
        <TextField
          label="Code"
          name="code"
          defaultValue={method?.code}
          required
          hint={isSystem ? "Systemcode — Änderungen werden beim Speichern ignoriert." : "Nur Großbuchstaben, Ziffern, Unterstrich."}
          placeholder="ZB_KARTE"
        />
        <TextField label="Name" name="name" defaultValue={method?.name} required />
        <TextAreaField label="Beschreibung" name="description" defaultValue={method?.description} className="sm:col-span-2" />
        <TextField label="Zahlungsziel (Tage)" name="paymentTermsDays" type="number" defaultValue={method?.paymentTermsDays != null ? String(method.paymentTermsDays) : undefined} />
        <TextField
          label="UNTDID-4461-Code (BT-81)"
          name="untdidCode"
          defaultValue={method?.untdidCode ?? "ZZZ"}
          hint={
            isSystem
              ? "Systemcode — Änderungen werden beim Speichern ignoriert."
              : "Erlaubt: 58, 30, 10, 68, 97, 1, ZZZ, 48, 54, 55, 59 (48/54/55/59 erscheinen in der E-Rechnung als Code 1)."
          }
          placeholder="ZZZ"
        />
        <TextAreaField label="Rechnungstext" name="invoiceText" defaultValue={method?.invoiceText} className="sm:col-span-2" hint="Erscheint als Zahlungshinweis auf der Rechnung." />
        <TextField label="Bank (Freitext, z. B. Kartenanbieter)" name="bankAccountRef" defaultValue={method?.bankAccountRef} />
        <TextField label="IBAN" name="bankIban" defaultValue={method?.bankIban} />
        <TextField label="BIC" name="bankBic" defaultValue={method?.bankBic} />
        <TextField label="Bankname" name="bankName" defaultValue={method?.bankName} />
        <TextField
          label="Sortierung"
          name="sortOrder"
          type="number"
          defaultValue={method ? String(method.sortOrder) : "0"}
          hint={isSystem ? "Systemwert — Änderungen werden beim Speichern ignoriert." : undefined}
        />
        <CheckboxField label="Aktiv" name="isActive" defaultChecked={method?.isActive ?? true} />
      </div>

      <SubmitButton>Zahlungsmethode speichern</SubmitButton>
    </form>
  );
}
