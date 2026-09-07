/**
 * Platzhalter-Engine: {{pfad.zu.wert}}. Fehlende oder nicht-skalare Werte ergeben einen
 * leeren String und eine Warnung — nie eine Exception (Lastenheft 18).
 */
export type TemplateContext = Record<string, unknown>;

const PATTERN = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

function resolve(ctx: TemplateContext, path: string): unknown {
  let cur: unknown = ctx;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object" || !Object.hasOwn(cur as Record<string, unknown>, part)) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function renderTemplate(text: string, ctx: TemplateContext): { text: string; warnings: string[] } {
  const warnings: string[] = [];
  const out = text.replace(PATTERN, (_m, path: string) => {
    const v = resolve(ctx, path);
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    warnings.push(`Unbekannter Platzhalter {{${path}}}`);
    return "";
  });
  return { text: out, warnings };
}

/** Alle Platzhalterpfade eines Textes (fuer Vorschau/Editor). */
export function listPlaceholders(text: string): string[] {
  return Array.from(text.matchAll(PATTERN), (m) => m[1]!);
}
