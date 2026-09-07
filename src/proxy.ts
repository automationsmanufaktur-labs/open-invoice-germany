import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

// Öffentlich erreichbar (ohne Anmeldung):
const PUBLIC_EXACT = new Set(["/"]);
// /api/cron ist nicht sessiongeschützt, sondern via CRON_SECRET in der Route.
// /angebot/ (öffentliche Angebotsseite) und /api/public/ (öffentliche PDF-/Entscheidungs-
// Aktionen, Phase 3b) sind bewusst die einzigen ohne-Login-Präfixe für Kundenzugriff —
// keine weiteren hier ergänzen, ohne die Sicherheitsfolgen zu prüfen.
// /api/v1/ (Phase 10): oeffentlich versionierte REST-API, Auth ausschliesslich per
// Bearer-Token im withApi-Wrapper (src/api/auth.ts) — KEIN Cookie-Fallback.
// /api/docs (Phase 10, Task 4): Swagger UI + ihre Assets (/api/docs/assets/*) sollen
// SOWOHL per Session (Browser) ALS AUCH per Bearer-API-Schluessel (externe Werkzeuge)
// erreichbar sein ("Session ODER Key") — die uebliche Proxy-Session-Pruefung kennt nur
// Cookies und wuerde einen reinen Bearer-Client aussperren, bevor die Route ueberhaupt
// laeuft. Die eigentliche Pruefung passiert deshalb in den Routen selbst
// (src/api/docs-auth.ts), nicht hier.
// Fix-Welle (Nit 11): "/api/docs" steht bewusst OHNE trailing slash in dieser Liste (die
// exakte Route selbst hat keinen) — `isPublic` unten prueft dafuer EXAKTE Gleichheit ODER
// "/api/docs/"-Praefix, nicht mehr ein blosses `startsWith("/api/docs")`, das faelschlich
// auch einen hypothetischen Pfad wie "/api/docsomething" mit durchgelassen haette.
const PUBLIC_PREFIXES = ["/login", "/setup", "/api/auth", "/api/cron", "/angebot/", "/api/public/", "/api/v1/", "/api/docs"];

/** true, wenn `pathname` GENAU `prefix` ist ODER mit `prefix + "/"` beginnt — verhindert,
 *  dass ein Praefix ohne trailing slash (z. B. "/api/docs") auch einen unverwandten
 *  Pfad mit demselben Textanfang durchlaesst (z. B. "/api/docsomething"). Praefixe, die
 *  bereits selbst mit "/" enden (z. B. "/angebot/"), verhalten sich unveraendert wie ein
 *  gewoehnliches startsWith. */
function matchesPublicPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`);
}

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

  const isPublic = PUBLIC_EXACT.has(pathname) || PUBLIC_PREFIXES.some((p) => matchesPublicPrefix(pathname, p));

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
    // Fix-Welle (Should-fix 9): /api/v1/ (Rechnungs-/Kundendaten per Bearer-Token) und
    // /api/docs (Swagger UI, zeigt u. a. Beispieldaten) reichten bisher OHNE eigenen
    // cache-control-Header bis zu Cloudflare durch — Verteidigung in der Tiefe fuer eine
    // Produktivinstanz mit echten Kundendaten, analog /angebot//api/public/ oben (G3).
    if (pathname === "/" || matchesPublicPrefix(pathname, "/api/v1/") || matchesPublicPrefix(pathname, "/api/docs")) {
      res.headers.set("cache-control", "private, no-store");
    }
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
