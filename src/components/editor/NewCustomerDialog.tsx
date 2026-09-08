"use client";

/**
 * "Neuen Kunden anlegen"-Dialog (Phase 11c, Task 3 — CustomerPicker Inline-Anlage):
 * natives <dialog>, legt ueber die Server Action createCustomerInline einen Kunden an
 * (dieselbe Domain/Zod wie CustomerForm/saveCustomer) und uebergibt ihn an den Aufrufer,
 * statt zu redirecten.
 */
import { useRef, useState } from "react";
import { createCustomerInline, type CreateCustomerInlineResult } from "@/app/actions/masterdata";
import { inputCls } from "@/components/forms/fields";
import type { CustomerInput } from "@/schemas";

export interface InlineCustomer {
  id: string;
  name: string;
  customerNumber: string | null;
  email: string | null;
  defaultPaymentMethodId?: string | null;
}

export function NewCustomerDialog({ onCreated }: { onCreated: (c: InlineCustomer) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [type, setType] = useState<CustomerInput["type"]>("BUSINESS");
  const [name, setName] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [city, setCity] = useState("");
  const [email, setEmail] = useState("");
  const [vatId, setVatId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function open() {
    setError(null);
    dialogRef.current?.showModal();
  }
  function close() {
    dialogRef.current?.close();
  }

  async function submit() {
    // M12 (Abschluss-Review): vorher stille Rueckkehr — ohne <form> greifen die
    // `required`-Attribute nicht, der Nutzer bekam also gar keine Rueckmeldung, warum
    // "Anlegen und übernehmen" nichts tut.
    if (!name.trim() || !addressLine1.trim() || !postalCode.trim() || !city.trim()) {
      setError("Bitte Name, Straße und Hausnummer, PLZ und Ort ausfüllen.");
      return;
    }
    setBusy(true);
    setError(null);
    const result: CreateCustomerInlineResult = await createCustomerInline({
      name,
      type,
      addressLine1,
      postalCode,
      city,
      email: email || undefined,
      vatId: vatId || undefined,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onCreated(result.customer);
    setName("");
    setAddressLine1("");
    setPostalCode("");
    setCity("");
    setEmail("");
    setVatId("");
    close();
  }

  return (
    <>
      <button type="button" onClick={open} className="text-xs font-medium text-indigo-600 hover:underline">
        + Neuen Kunden anlegen
      </button>
      {/* M5 (Abschluss-Review): `DocumentEditor` rendert seit Task 6 gar kein `<form>`
          mehr (`grep -rn "<form" src/components/editor` findet ausser diesem Kommentar
          keinen Treffer) — der urspruengliche Grund ("verschachteltes <form> waere
          ungueltiges HTML") besteht also nicht mehr, der Verzicht auf ein eigenes
          `<form>` bleibt trotzdem richtig: ohne `<form>` gibt es kein `type="submit"`,
          das versehentlich den ganzen Editor abschicken koennte — Speichern laeuft
          bewusst ueber einen normalen Button-Klick. */}
      <dialog
        ref={dialogRef}
        className="w-full max-w-md rounded-lg border border-slate-200 p-0 backdrop:bg-slate-900/40"
        onKeyDown={(e) => {
          // M12 (Abschluss-Review): vorher fing der Dialog JEDES Enter ab, auch mit Fokus
          // auf „Abbrechen"/„✕" — `preventDefault()` unterdrueckte dort die native
          // Button-Aktivierung und loeste stattdessen `submit()` aus. Jetzt nur noch, wenn
          // der Fokus tatsaechlich in einem Eingabefeld liegt.
          if (e.key !== "Enter" || busy || !(e.target instanceof HTMLInputElement)) return;
          e.preventDefault();
          void submit();
        }}
      >
        <div className="space-y-3 p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-900">Neuen Kunden anlegen</h3>
            <button type="button" onClick={close} className="text-slate-400 hover:text-slate-700">
              ✕
            </button>
          </div>
          {error && <div className="rounded-md border border-rose-200 bg-rose-50 p-2 text-sm text-rose-800">{error}</div>}
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-slate-700">Typ</span>
              <select className={inputCls} value={type} onChange={(e) => setType(e.target.value as CustomerInput["type"])}>
                <option value="BUSINESS">Firma</option>
                <option value="CONSUMER">Privatperson</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-slate-700">USt-IdNr. (optional)</span>
              <input className={inputCls} value={vatId} onChange={(e) => setVatId(e.target.value)} />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Name</span>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">Straße und Hausnummer</span>
            <input className={inputCls} value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} required />
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="col-span-1 flex flex-col gap-1 text-sm">
              <span className="font-medium text-slate-700">PLZ</span>
              <input className={inputCls} value={postalCode} onChange={(e) => setPostalCode(e.target.value)} required />
            </label>
            <label className="col-span-2 flex flex-col gap-1 text-sm">
              <span className="font-medium text-slate-700">Ort</span>
              <input className={inputCls} value={city} onChange={(e) => setCity(e.target.value)} required />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-700">E-Mail (optional)</span>
            <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={close} className="text-sm text-slate-500 hover:text-slate-800">
              Abbrechen
            </button>
            <button type="button" onClick={() => void submit()} disabled={busy} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
              {busy ? "Speichern…" : "Anlegen und übernehmen"}
            </button>
          </div>
        </div>
      </dialog>
    </>
  );
}
