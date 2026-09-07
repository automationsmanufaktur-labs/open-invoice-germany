/**
 * Whitelist für Link-Ziele im Rich-Text-Modul (§9: kein ungefiltertes HTML,
 * keine beliebigen URL-Schemata). Nur https:// und mailto: sind erlaubt;
 * alles andere (javascript:, data:, relative Pfade, http:, …) wird vom
 * Parser als Klartext behandelt, siehe parse.ts.
 */

const ALLOWED_HREF = /^(https:\/\/\S+|mailto:\S+)$/i;

/** Prüft, ob ein Link-Ziel dem erlaubten Schema entspricht. */
export function isAllowedHref(href: string): boolean {
  return ALLOWED_HREF.test(href.trim());
}
