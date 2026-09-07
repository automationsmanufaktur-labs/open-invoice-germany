import { resolveShareToken } from "@/domain/quote-share/link";
import { hashToken } from "@/domain/quote-share/token";
import { rateLimit, RateLimitError } from "@/lib/rate-limit";
import { clientIpFromHeaders } from "@/lib/http/client-ip";
import { buildDocEInvoiceData } from "@/domain/document/pdf-data";
import { renderInvoicePdf } from "@/lib/pdf/invoice-pdf";
import { loadPdfTheme } from "@/domain/settings/theme";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PDF_RATE_LIMIT = 30;
const PDF_RATE_WINDOW_MS = 60_000;
// W4: zusaetzliches Rate-Limit je Client-IP (neben dem bestehenden je Token-Hash) —
// verhindert das Durchprobieren vieler Tokens von einer IP.
const IP_RATE_LIMIT = 60;
const IP_RATE_WINDOW_MS = 60_000;

/**
 * Oeffentliche PDF-Route zum Angebotslink (kein Login). Gibt ausschliesslich die Daten
 * aus `resolveShareToken` aus (Seller-Snapshot, Positionen, Betraege) — nie
 * `internalNotes`, nie Org-IDs. Jeder Ungueltigkeitsfall (unbekannt/abgelaufen/
 * widerrufen/archiviert) liefert einheitlich 404, ohne Unterscheidung.
 */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;

  const ip = clientIpFromHeaders(req.headers) ?? undefined;
  try {
    if (ip) rateLimit(`public:ip:${ip}`, { limit: IP_RATE_LIMIT, windowMs: IP_RATE_WINDOW_MS });
    rateLimit(`pdf:${hashToken(token)}`, { limit: PDF_RATE_LIMIT, windowMs: PDF_RATE_WINDOW_MS });
  } catch (e) {
    if (e instanceof RateLimitError) {
      return new Response("Zu viele Anfragen", {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(e.retryAfterMs / 1000)), "cache-control": "private, no-store" },
      });
    }
    throw e;
  }

  const resolved = await resolveShareToken(token);
  if (!resolved) return new Response("Nicht gefunden", { status: 404, headers: { "cache-control": "private, no-store" } });

  const { quote } = resolved;
  const theme = await loadPdfTheme(quote.orgId, quote.printOptionsJson);
  const pdf = await renderInvoicePdf(buildDocEInvoiceData(quote), theme);
  const safe = (quote.number ?? "angebot").replace(/[^A-Za-z0-9._-]/g, "_");
  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${safe}.pdf"`,
      // G3: personenbezogene Angebotsdaten — keine CDN-/Browser-Zwischenspeicherung.
      "cache-control": "private, no-store",
    },
  });
}
