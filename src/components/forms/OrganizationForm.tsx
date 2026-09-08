"use client";

import { useActionState } from "react";
import { saveOrganization } from "@/app/actions/masterdata";
import type { ActionResult } from "@/app/actions/result";
import { TextField, SelectField, CheckboxField, SubmitButton, ErrorBanner } from "./fields";

export interface OrgFormData {
  legalName: string;
  ownerName: string | null;
  addressLine1: string;
  addressLine2: string | null;
  postalCode: string;
  city: string;
  country: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  taxNumber: string | null;
  vatId: string | null;
  kuIdNr: string | null;
  smallBusiness: boolean;
  defaultTaxScheme: string;
  iban: string | null;
  bic: string | null;
  bankName: string | null;
  electronicAddress: string | null;
}

export function OrganizationForm({ org }: { org?: OrgFormData | null }) {
  const [state, action] = useActionState<ActionResult, FormData>(saveOrganization, { ok: false });

  return (
    <form action={action} className="space-y-6">
      <ErrorBanner message={state.error} />

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">Unternehmen</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Firmenname" name="legalName" defaultValue={org?.legalName} required className="sm:col-span-2" />
          <TextField label="Inhaber/-in" name="ownerName" defaultValue={org?.ownerName} hint="Erscheint in der automatischen Fußzeile (optional)." />
          <TextField label="Straße & Nr." name="addressLine1" defaultValue={org?.addressLine1} required />
          <TextField label="Adresszusatz" name="addressLine2" defaultValue={org?.addressLine2} />
          <TextField label="PLZ" name="postalCode" defaultValue={org?.postalCode} required />
          <TextField label="Ort" name="city" defaultValue={org?.city} required />
          <TextField label="Land (ISO-2)" name="country" defaultValue={org?.country ?? "DE"} />
          <TextField label="E-Mail" name="email" type="email" defaultValue={org?.email} />
          <TextField label="Telefon" name="phone" defaultValue={org?.phone} />
          <TextField label="Website" name="website" defaultValue={org?.website} />
        </div>
      </section>

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">Steuer</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Steuernummer" name="taxNumber" defaultValue={org?.taxNumber} hint="Steuernummer ODER USt-IdNr. ist Pflicht (§ 14 Abs. 4 Nr. 2)" />
          <TextField label="USt-IdNr." name="vatId" defaultValue={org?.vatId} placeholder="DE123456789" />
          <TextField label="Kleinunternehmer-IdNr. (§ 19a)" name="kuIdNr" defaultValue={org?.kuIdNr} />
          <SelectField
            label="Standard-Steuerschema"
            name="defaultTaxScheme"
            defaultValue={org?.defaultTaxScheme}
            options={[
              { value: "REGULAR", label: "Regelbesteuerung" },
              { value: "KLEINUNTERNEHMER", label: "Kleinunternehmer (§ 19)" },
              { value: "DIFFERENZ", label: "Differenzbesteuerung (§ 25a)" },
            ]}
          />
          <CheckboxField label="Kleinunternehmer nach § 19 UStG" name="smallBusiness" defaultChecked={org?.smallBusiness} hint="Keine USt ausweisen, Pflichthinweis auf Rechnungen." />
        </div>
      </section>

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">Bank & E-Rechnung</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Bankname" name="bankName" defaultValue={org?.bankName} />
          <TextField label="IBAN" name="iban" defaultValue={org?.iban} />
          <TextField label="BIC" name="bic" defaultValue={org?.bic} />
          <TextField label="E-Rechnung-Adresse (Peppol)" name="electronicAddress" defaultValue={org?.electronicAddress} hint="Optional — Endpoint für E-Rechnung-Versand." />
        </div>
      </section>

      <SubmitButton>Stammdaten speichern</SubmitButton>
    </form>
  );
}
