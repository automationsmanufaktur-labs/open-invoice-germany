/**
 * Auth-Guard fuer die oeffentlich erreichbaren Cron-Endpunkte (`/api/cron/*`, Phase 6,
 * Fix-Welle B3). Vorher: `authorized()` gab bei fehlendem `CRON_SECRET` `true` zurueck
 * ("erlaubt", solange niemand ein Secret konfiguriert hat) — auf einem oeffentlichen
 * Deployment ohne gesetztes Secret war die Route damit anonym erreichbar und loeste
 * Kundenkommunikation aus (Mahn-/Abo-Versand). Fail-closed: OHNE gesetztes `CRON_SECRET`
 * ist die Route grundsaetzlich gesperrt (503), nicht offen. `/api/cron` ist bewusst von der
 * Session-Pruefung ausgenommen (`src/proxy.ts`) — dieser Guard ist der einzige Schutz.
 */
export type CronAuthResult = "ok" | "unset" | "unauthorized";

export function checkCronAuth(req: Request): CronAuthResult {
  const secret = process.env.CRON_SECRET;
  if (!secret) return "unset";
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return "ok";
  const url = new URL(req.url);
  if (url.searchParams.get("secret") === secret) return "ok";
  return "unauthorized";
}
