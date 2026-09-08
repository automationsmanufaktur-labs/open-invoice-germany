"use client";

/**
 * Textvorlagen-Auswahl (Phase 11c, Task 3): `<select>` "Vorlage einfuegen…" mit den
 * Namen der fuer (docType, position) hinterlegten Textvorlagen der aktiven Organisation
 * (`GET /api/text-templates?docType=&position=`). Auswahl ruft `onPick(body)` auf und
 * setzt sich danach zurueck auf den Platzhalter — die Auswahl fuegt Text EIN, sie bindet
 * das Feld nicht dauerhaft an die Vorlage. Ohne Vorlagen bleibt die Komponente leer.
 */
import { useEffect, useState } from "react";

interface TemplateOption {
  id: string;
  name: string;
  body: string;
  isDefault: boolean;
}

export function TextTemplatePicker({
  docType,
  position,
  onPick,
}: {
  docType: string;
  position: "HEAD" | "FOOT" | "TERMS_DELIVERY" | "TERMS_PAYMENT";
  onPick: (body: string) => void;
}) {
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [selected, setSelected] = useState("");

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/text-templates?docType=${encodeURIComponent(docType)}&position=${encodeURIComponent(position)}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) return;
        const json = (await res.json()) as { templates: TemplateOption[] };
        if (!cancelled) setTemplates(json.templates);
      } catch {
        // abgebrochen oder Netzfehler — Auswahl bleibt leer
      }
    })();
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [docType, position]);

  if (templates.length === 0) return null;

  return (
    <select
      className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 focus:border-indigo-500 focus:outline-none"
      aria-label="Textvorlage einfügen"
      value={selected}
      onChange={(e) => {
        const id = e.target.value;
        const tpl = templates.find((t) => t.id === id);
        if (tpl) onPick(tpl.body);
        setSelected("");
      }}
    >
      <option value="">Vorlage einfügen…</option>
      {templates.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  );
}
