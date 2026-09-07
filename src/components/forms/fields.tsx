"use client";

import { useFormStatus } from "react-dom";

const inputCls =
  "rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none disabled:bg-slate-100";

interface BaseField {
  label: string;
  name: string;
  defaultValue?: string | null;
  required?: boolean;
  placeholder?: string;
  hint?: string;
  className?: string;
}

export function TextField({
  label,
  name,
  defaultValue,
  required,
  placeholder,
  hint,
  className,
  type = "text",
  onChange,
}: BaseField & { type?: string; onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <label className={`flex flex-col gap-1 text-sm ${className ?? ""}`}>
      <span className="font-medium text-slate-700">
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </span>
      <input
        className={inputCls}
        name={name}
        type={type}
        defaultValue={defaultValue ?? undefined}
        required={required}
        placeholder={placeholder}
        onChange={onChange}
      />
      {hint && <span className="text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

export function TextAreaField({ label, name, defaultValue, required, placeholder, hint, className }: BaseField) {
  return (
    <label className={`flex flex-col gap-1 text-sm ${className ?? ""}`}>
      <span className="font-medium text-slate-700">
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </span>
      <textarea className={inputCls} name={name} rows={2} defaultValue={defaultValue ?? undefined} required={required} placeholder={placeholder} />
      {hint && <span className="text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

export function SelectField({
  label,
  name,
  defaultValue,
  options,
  hint,
  className,
  onChange,
}: Omit<BaseField, "placeholder" | "required"> & { options: { value: string; label: string }[]; onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void }) {
  return (
    <label className={`flex flex-col gap-1 text-sm ${className ?? ""}`}>
      <span className="font-medium text-slate-700">{label}</span>
      <select className={inputCls} name={name} defaultValue={defaultValue ?? options[0]?.value} onChange={onChange}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && <span className="text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

export function CheckboxField({ label, name, defaultChecked, hint }: { label: string; name: string; defaultChecked?: boolean; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-1 h-4 w-4 rounded border-slate-300" />
      <span>
        <span className="font-medium text-slate-700">{label}</span>
        {hint && <span className="block text-xs text-slate-400">{hint}</span>}
      </span>
    </label>
  );
}

export function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
    >
      {pending ? "Speichern…" : children}
    </button>
  );
}

export function ErrorBanner({ message }: { message?: string }) {
  if (!message) return null;
  return <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm whitespace-pre-line text-rose-800">{message}</div>;
}
