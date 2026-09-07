/**
 * Client-IP fuer oeffentliche, ungeschuetzte Routen (Phase 3b: Angebotsannahme).
 * Reihenfolge (Ruling): `cf-connecting-ip` (Cloudflare) bevorzugt, sonst der erste
 * Eintrag aus `x-forwarded-for`, sonst `null`. Beide Header werden vom Reverse-Proxy
 * gesetzt — ohne Proxy davor sind sie vom Client faelschbar, was fuer ein reines
 * Rate-Limit-/Anzeigekriterium (nicht sicherheitskritisch) hinnehmbar ist.
 */
export function clientIpFromHeaders(headers: Headers): string | null {
  const cf = headers.get("cf-connecting-ip");
  if (cf) return cf.trim();

  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }

  return null;
}
