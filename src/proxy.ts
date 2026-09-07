import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

// Öffentlich erreichbar (ohne Anmeldung):
const PUBLIC_EXACT = new Set(["/"]);
// /api/cron ist nicht sessiongeschützt, sondern via CRON_SECRET in der Route.
// /angebot/ (öffentliche Angebotsseite) und /api/public/ (öffentliche PDF-/Entscheidungs-
// Aktionen, Phase 3b) sind bewusst die einzigen ohne-Login-Präfixe für Kundenzugriff —
// keine weiteren hier ergänzen, ohne die Sicherheitsfolgen zu prüfen.
const PUBLIC_PREFIXES = ["/login", "/setup", "/api/auth", "/api/cron", "/angebot/", "/api/public/"];

// Präfixe, deren Seiten ohne interne Navigation/Layout ausgeliefert werden (Root-Layout
// liest diesen Request-Header und rendert dann nur eine schlanke Hülle — kein Route-Group-
// Umbau nötig, siehe Task-3-Addendum).
const NO_NAV_PREFIXES = ["/angebot/", "/api/public/"];
export const PUBLIC_NO_NAV_HEADER = "x-oig-public";

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // G1: der Client-Header wird bei JEDER Anfrage zuerst entfernt — ohne diesen Schritt
  // koennte ein Client ihn selbst setzen und sich damit als "oeffentliche, navigationslose"
  // Anfrage ausgeben (z. B. um das schlanke Layout ohne interne Navigation zu erzwingen).
  // Erst danach wird er fuer NO_NAV_PREFIXES wieder gesetzt.
  const headers = new Headers(req.headers);
  headers.delete(PUBLIC_NO_NAV_HEADER);

  const isPublic = PUBLIC_EXACT.has(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));

  if (isPublic) {
    if (NO_NAV_PREFIXES.some((p) => pathname.startsWith(p))) {
      headers.set(PUBLIC_NO_NAV_HEADER, "1");
      const res = NextResponse.next({ request: { headers } });
      // G3: /angebot/ und /api/public/ liefern personenbezogene Angebotsdaten ohne Login
      // — CDN/Browser duerfen sie nicht zwischenspeichern.
      res.headers.set("cache-control", "private, no-store");
      return res;
    }
    const res = NextResponse.next({ request: { headers } });
    // Fix-Welle (Nit): "/" ist der einzige PUBLIC_EXACT-Pfad, rendert aber fuer
    // angemeldete Nutzer das Dashboard (Umsatz, Kundennamen) statt der Marketing-Seite.
    // `force-dynamic` liefert dafuer zwar bereits regulaer "private, no-store", aber mit
    // Cloudflare vor der Produktivinstanz wird der Header hier explizit gesetzt statt sich
    // auf Next.js' implizites Verhalten zu verlassen (analog /angebot/ oben, G3).
    if (pathname === "/") res.headers.set("cache-control", "private, no-store");
    return res;
  }

  const userId = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (userId) return NextResponse.next({ request: { headers } });

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Nicht angemeldet" }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("from", pathname);
  return NextResponse.redirect(url);
}

// Fuer Unit-Tests exportiert (Test in test/unit/proxy-public.test.ts).
export { PUBLIC_PREFIXES };

export const config = {
  // Alles außer Next-Interna und statischen Assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
