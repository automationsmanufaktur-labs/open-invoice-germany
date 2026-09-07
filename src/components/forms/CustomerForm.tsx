"use client";

import { useActionState } from "react";
import { saveCustomer } from "@/app/actions/masterdata";
import type { ActionResult } from "@/app/actions/result";
import { TextField, SelectField, TextAreaField, SubmitButton, ErrorBanner } from "./fields";

export interface CustomerFormData {
  id: string;
  type: string;
  name: string;
  contactName: string | null;
  addressLine1: string;
  addressLine2: string | null;
  postalCode: string;
  city: string;
  countryCode: string;
  email: string | null;
  phone: string | null;
  vatId: string | null;
  leitwegId: string | null;
  customerNumber: string | null;
  defaultPaymentTermsDays: number | null;
  defaultPaymentMethodId: string | null;
  notes: string | null;
}

export interface PaymentMethodOption {
  id: string;
  name: string;
}

export function CustomerForm({
  customer,
  paymentMethods = [],
}: {
  customer?: CustomerFormData | null;
  paymentMethods?: PaymentMethodOption[];
}) {
  const [state, action] = useActionState<ActionResult, FormData>(saveCustomer, { ok: false });

  return (
    <form action={action} className="space-y-5">
      <ErrorBanner message={state.error} />
      {customer && <input type="hidden" name="id" value={customer.id} />}

      <div className="grid gap-4 rounded-lg border border-slate-200 bg-white p-5 sm:grid-cols-2">
        <SelectField
          label="Typ"
          name="type"
          defaultValue={customer?.type}
          options={[
            { value: "BUSINESS", label: "Unternehmen (B2B)" },
            { value: "CONSUMER", label: "Privatperson (B2C)" },
          ]}
        />
        <TextField label="Name / Firma" name="name" defaultValue={customer?.name} required />
        <TextField label="Ansprechpartner" name="contactName" defaultValue={customer?.contactName} />
        <TextField label="USt-IdNr." name="vatId" defaultValue={customer?.vatId} placeholder="DE…" hint="Pflicht bei ig. Lieferung/Leistung." />
        <TextField label="Straße & Nr." name="addressLine1" defaultValue={customer?.addressLine1} required />
        <TextField label="Adresszusatz" name="addressLine2" defaultValue={customer?.addressLine2} />
        <TextField label="PLZ" name="postalCode" defaultValue={customer?.postalCode} required />
        <TextField label="Ort" name="city" defaultValue={customer?.city} required />
        <TextField label="Land (ISO-2)" name="countryCode" defaultValue={customer?.countryCode ?? "DE"} />
        <TextField label="E-Mail" name="email" type="email" defaultValue={customer?.email} />
        <TextField label="Telefon" name="phone" defaultValue={customer?.phone} />
        <TextField label="Leitweg-ID (B2G)" name="leitwegId" defaultValue={customer?.leitwegId} hint="Nur für Rechnungen an öffentliche Auftraggeber." />
        <TextField
          label="Kundennummer"
          name="customerNumber"
          defaultValue={customer?.customerNumber}
          placeholder="wird automatisch vergeben"
          hint="Leer lassen für automatische Vergabe aus dem Nummernkreis."
        />
        <TextField
          label="Zahlungsziel (Tage)"
          name="defaultPaymentTermsDays"
          type="number"
          defaultValue={customer?.defaultPaymentTermsDays != null ? String(customer.defaultPaymentTermsDays) : ""}
          placeholder="Standard (Zahlungsmethode/Einstellungen)"
          hint="Leer lassen, um die Frist der Zahlungsmethode bzw. der Voreinstellung zu übernehmen."
        />
        <SelectField
          label="Standard-Zahlungsmethode"
          name="defaultPaymentMethodId"
          defaultValue={customer?.defaultPaymentMethodId ?? ""}
          options={[{ value: "", label: "— keine —" }, ...paymentMethods.map((m) => ({ value: m.id, label: m.name }))]}
          hint="Wird bei neuen Rechnungen für diesen Kunden vorbelegt."
        />
        <TextAreaField label="Notiz" name="notes" defaultValue={customer?.notes} className="sm:col-span-2" />
      </div>

      <SubmitButton>Kunde speichern</SubmitButton>
    </form>
  );
}
