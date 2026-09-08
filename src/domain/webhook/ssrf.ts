/**
 * SSRF-Schutz fuer Webhook-Ziel-URLs (Phase 10, Task 5, task-5-facts.md "SSRF"): nur
 * https, Hostname wird per DNS aufgeloest (dns.lookup, ALLE Adressen — IPv4 und IPv6),
 * private/link-local/loopback-Netze sind verboten. Wird sowohl bei Anlage/Aenderung
 * eines Endpunkts (400, src/domain/webhook/endpoints.ts) als auch VOR jeder Zustellung
 * aufgerufen (Skip statt Fehler, src/domain/webhook/deliver.ts) — ein zum Anlagezeitpunkt
 * oeffentlicher Host koennte inzwischen (neuer DNS-Eintrag) auf ein privates Netz zeigen.
 *
 * Praezisierung (Fix-Welle, Should-fix 8 — korrigiert eine zuvor ungenaue Aussage): diese
 * erneute Pruefung vor jeder Zustellung ist eine Re-Validierung des AKTUELLEN DNS-
 * EINTRAGS, KEIN Schutz vor DNS-Rebinding WAEHREND der eigentlichen Verbindung. Sie loest
 * den Hostnamen HIER auf und prueft diese Adressen; der anschliessende `fetch()`-Aufruf in
 * deliver.ts loest denselben Hostnamen ERNEUT, unabhaengig auf. Bei sehr kurzem DNS-TTL
 * koennte ein Angreifer dieser Pruefung eine oeffentliche und dem `fetch()`-Aufruf eine
 * private Adresse liefern (klassisches TOCTOU). Eine vollstaendige Absicherung muesste die
 * hier validierte Adresse an die Verbindung "pinnen" (eigener `lookup`/Agent) — mit der
 * eingebauten `fetch`-API ist das nicht ohne Weiteres moeglich (Backlog, siehe
 * docs/WEBHOOKS.md "SSRF-Regeln"). `redirect: "manual"` in deliver.ts (Fix-Welle,
 * Blocking 2) schuetzt zusaetzlich gegen den naheliegendsten Angriffsweg (Redirect auf ein
 * privates Ziel), ohne dieses TOCTOU-Fenster zu schliessen.
 */
import dns from "node:dns/promises";
import net from "node:net";

export class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfBlockedError";
  }
}

/**
 * 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8, 169.254.0.0/16
 * (task-5-facts.md, woertlich), erweitert um zwei von final-review-findings.md #13
 * genannte Luecken: 100.64.0.0/10 (Carrier-Grade-NAT, RFC 6598) und 198.18.0.0/15
 * (Benchmarking, RFC 2544) — beide sind kein oeffentlich erreichbares Ziel, auch wenn
 * sie technisch nicht in den "klassischen" privaten Bloecken (RFC 1918) liegen.
 */
export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true; // unparsebar -> sicherheitshalber blockieren
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true; // "diese Netz" (RFC 5735) — kein sinnvolles Zustellziel
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 Benchmarking
  return false;
}

/** Erstes Hextet (16-Bit-Gruppe) einer IPv6-Adresse als Zahl — funktioniert unabhaengig
 *  davon, ob die Adresse komprimiert ("fe80::1") oder vollstaendig ausgeschrieben
 *  ("fe80:0:0:0:0:0:0:1") vorliegt, da beide Formen mit derselben ersten Gruppe beginnen. */
function firstHextet(ip: string): number {
  return parseInt(ip.split(":")[0] || "0", 16) || 0;
}

/**
 * ::1 (Loopback), :: (unspezifiziert), fe80::/10 (Link-Local, task-5-facts.md nennt ::1
 * explizit), fc00::/7 (Unique Local/ULA), 64:ff9b::/96 (NAT64, RFC 6052), 2002::/16
 * (6to4, RFC 3056) — die letzten vier sowie `::` sind Ergaenzungen aus
 * final-review-findings.md #13. `fe80::/10` wird per Zahlen-Arithmetik auf dem ersten
 * Hextet geprueft (0xfe80..0xfebf), NICHT mehr per `startsWith("fe8"|"fe9"|"fea"|"feb")` —
 * die String-Variante war fragil (z. B. haette sie faelschlich auch "fea:" oder "feb:"
 * als vollstaendig andere, NICHT-Link-Local-Adressen ausserhalb von fe80::/10 blockiert
 * bzw. im Zweifel falsch klassifiziert, statt exakt den Bitbereich zu pruefen).
 */
export function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  const first = firstHextet(normalized);
  if (first >= 0xfe80 && first <= 0xfebf) return true; // fe80::/10, per Bitbereich
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // fc00::/7
  if (normalized.startsWith("64:ff9b::")) return true; // 64:ff9b::/96 NAT64
  if (first === 0x2002) return true; // 2002::/16 6to4
  // IPv4-mapped IPv6 (::ffff:10.0.0.1) — dieselbe Pruefung auf den eingebetteten IPv4-Teil.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

/**
 * Wirft `SsrfBlockedError`, wenn `urlStr` kein https ist, keine gueltige URL ist, oder
 * mindestens eine aufgeloeste Adresse in einem verbotenen Netz liegt. `lookupImpl` ist
 * fuer Tests injizierbar (kein echter DNS-Zugriff auf Literale wie "10.0.0.1" noetig,
 * aber Injektion erlaubt deterministische Tests fuer echte Hostnamen).
 */
export async function assertPublicHttpsUrl(
  urlStr: string,
  opts: { lookupImpl?: typeof dns.lookup } = {},
): Promise<void> {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    throw new SsrfBlockedError("Ungueltige URL.");
  }
  if (url.protocol !== "https:") {
    throw new SsrfBlockedError("Nur https:// ist als Webhook-Ziel erlaubt.");
  }

  const lookup = opts.lookupImpl ?? dns.lookup;
  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(url.hostname, { all: true });
  } catch {
    throw new SsrfBlockedError(`Hostname "${url.hostname}" konnte nicht aufgeloest werden.`);
  }

  for (const a of addresses) {
    const family = net.isIP(a.address);
    if (family === 4 && isPrivateIPv4(a.address)) {
      throw new SsrfBlockedError(`Ziel-IP ${a.address} liegt in einem privaten/lokalen Netz — nicht erlaubt.`);
    }
    if (family === 6 && isPrivateIPv6(a.address)) {
      throw new SsrfBlockedError(`Ziel-IP ${a.address} liegt in einem privaten/lokalen Netz — nicht erlaubt.`);
    }
  }
}
