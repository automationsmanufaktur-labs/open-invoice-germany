"use client";

/**
 * Generisches Feld-Layout fuer den Beleg-Editor (Phase 11c, Task 4): Label + optionaler
 * Hinweistext + Inhalt, einheitlich fuer alle Bloecke (RecipientBlock/MetaBlock/
 * HeadTextBlock/MoreOptions). `children` ist bewusst eine Render-Prop `(id) => ReactNode`
 * statt eines einfachen `ReactNode` — nur so kann `EditorField` die von `useId()`
 * erzeugte Kennung TATSAECHLICH auf das darunterliegende Eingabeelement setzen und ein
 * echtes `<label htmlFor>` erzeugen (Selbst-Review-Vorgabe „a11y-Labels auf allen
 * Eingaben"), statt eines wirkungslosen `htmlFor` ins Leere. Fuer zusammengesetzte
 * Komponenten ohne `id`-Prop (z. B. `CustomerPicker`) bleibt die Kennung ungenutzt — das
 * umschliessende `<label>` bindet den Screenreader-Text dafuer weiterhin implizit an das
 * erste fokussierbare Kind.
 */
import type { ReactNode } from "react";
import { useId } from "react";

export function EditorField({
  label,
  hint,
  required,
  className,
  children,
}: {
  label: string;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className={`flex flex-col gap-1 text-sm ${className ?? ""}`}>
      <span className="font-medium text-slate-700">
        {label}
        {required && <span className="text-rose-500"> *</span>}
      </span>
      {children(id)}
      {hint && <span className="text-xs text-slate-400">{hint}</span>}
    </label>
  );
}
