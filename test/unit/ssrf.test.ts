/**
 * Fix-Welle Phase 10 (Nit 13, final-review-findings.md): direkte Unit-Tests fuer
 * isPrivateIPv4/isPrivateIPv6 (src/domain/webhook/ssrf.ts). Getrennt von
 * test/integration/webhooks.test.ts (assertPublicHttpsUrl ueber echte URLs), weil
 * `new URL("https://[::1]/hook").hostname` fuer IPv6-Literale die Klammerform
 * liefert ("[::1]"), die `dns.lookup` NICHT aufloesen kann — jede IPv6-Adresse
 * (privat oder oeffentlich) wuerde ueber `assertPublicHttpsUrl` also so oder so mit
 * SsrfBlockedError scheitern, unabhaengig vom tatsaechlichen Netz. Die reinen
 * Funktionen hier sind davon nicht betroffen und pruefen exakt die Bitbereiche.
 */
import { describe, it, expect } from "vitest";
import { isPrivateIPv4, isPrivateIPv6 } from "@/domain/webhook/ssrf";

describe("isPrivateIPv4", () => {
  it("CGNAT 100.64.0.0/10 wird blockiert", () => {
    expect(isPrivateIPv4("100.64.0.1")).toBe(true);
    expect(isPrivateIPv4("100.100.100.100")).toBe(true); // Mitte des Bereichs
    expect(isPrivateIPv4("100.127.255.254")).toBe(true); // oberes Ende
  });

  it("Adressen knapp ausserhalb 100.64.0.0/10 werden NICHT blockiert", () => {
    expect(isPrivateIPv4("100.63.255.255")).toBe(false);
    expect(isPrivateIPv4("100.128.0.0")).toBe(false);
  });

  it("Benchmarking 198.18.0.0/15 wird blockiert", () => {
    expect(isPrivateIPv4("198.18.0.1")).toBe(true);
    expect(isPrivateIPv4("198.19.255.254")).toBe(true);
  });

  it("Adressen knapp ausserhalb 198.18.0.0/15 werden NICHT blockiert", () => {
    expect(isPrivateIPv4("198.17.255.255")).toBe(false);
    expect(isPrivateIPv4("198.20.0.0")).toBe(false);
  });

  it("bekannte oeffentliche Adresse bleibt erlaubt", () => {
    expect(isPrivateIPv4("93.184.216.34")).toBe(false);
  });
});

describe("isPrivateIPv6", () => {
  it(":: (unspezifiziert) wird blockiert", () => {
    expect(isPrivateIPv6("::")).toBe(true);
  });

  it("64:ff9b::/96 (NAT64) wird blockiert", () => {
    expect(isPrivateIPv6("64:ff9b::c000:0201")).toBe(true);
    expect(isPrivateIPv6("64:ff9b::1")).toBe(true);
  });

  it("2002::/16 (6to4) wird blockiert", () => {
    expect(isPrivateIPv6("2002:c000:0201::1")).toBe(true);
    expect(isPrivateIPv6("2002::1")).toBe(true);
  });

  it("fe80::/10 (Link-Local) wird per Bitbereich blockiert — innerhalb der Grenzen", () => {
    expect(isPrivateIPv6("fe80::1")).toBe(true);
    expect(isPrivateIPv6("febf::1")).toBe(true); // oberes Ende von fe80::/10
    expect(isPrivateIPv6("fe80:0:0:0:0:0:0:1")).toBe(true); // vollstaendig ausgeschrieben
  });

  it("Adressen knapp ausserhalb fe80::/10 werden NICHT blockiert (Bitbereich statt String-Praefix)", () => {
    expect(isPrivateIPv6("fe7f::1")).toBe(false);
    expect(isPrivateIPv6("fec0::1")).toBe(false);
  });

  it("::1 (Loopback) und fc00::/7 (ULA) bleiben blockiert (Bestandsverhalten)", () => {
    expect(isPrivateIPv6("::1")).toBe(true);
    expect(isPrivateIPv6("fc00::1")).toBe(true);
    expect(isPrivateIPv6("fd12:3456::1")).toBe(true);
  });

  it("IPv4-mapped IPv6 nutzt weiterhin die IPv4-Pruefung (inkl. neuer Bereiche)", () => {
    expect(isPrivateIPv6("::ffff:100.64.0.1")).toBe(true);
    expect(isPrivateIPv6("::ffff:93.184.216.34")).toBe(false);
  });

  it("bekannte oeffentliche IPv6-Adresse bleibt erlaubt", () => {
    expect(isPrivateIPv6("2606:4700:4700::1111")).toBe(false);
  });
});
