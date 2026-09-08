# Webhooks

OpenInvoice Germany kann Ereignisse (Rechnung festgeschrieben, Zahlung erfasst, …)
in Echtzeit an eigene Endpunkte zustellen — Einrichtung in **Einstellungen →
Webhooks** oder per REST-API (`/api/v1/Webhook`, Scope `admin`) bzw. MCP
(`list_webhooks`, `upsert_webhook`, `test_webhook`, `replay_webhook_delivery`).

## Ereignisse

| Ereignis | Ausgelöst durch |
|---|---|
| `invoice.finalized` | Rechnung festgeschrieben (direkt, Storno-Gutschrift, Teil-/Abschlags-/Schlussrechnung, Abo-Lauf, Angebotsannahme) |
| `invoice.cancelled` | Rechnung storniert (auf dem Original — die neu erzeugte Storno-Gutschrift löst zusätzlich ihr eigenes `invoice.finalized` aus) |
| `invoice.paid` | Rechnung durch eine Zahlung (primär oder Skonto) vollständig bezahlt |
| `payment.recorded` | Zahlung erfasst (immer, auch bei einer Teilzahlung oder der automatischen Skonto-Zahlung) |
| `quote.sent` | Angebot versendet |
| `quote.accepted` | Angebot vom Kunden angenommen |
| `quote.rejected` | Angebot vom Kunden abgelehnt |
| `delivery_note.created` | Lieferschein angelegt |
| `email.sent` / `email.failed` | Belegversand per E-Mail erfolgreich/fehlgeschlagen |
| `dunning.created` | Mahnung erstellt |

Ein Endpunkt abonniert eine oder mehrere dieser Ereignisse (`events`-Feld bei
Anlage/Änderung). Eine **Test-Zustellung** (`webhook.test`, über „Testen"/
`test_webhook`/`POST /api/v1/Webhook/{id}/test`) geht immer an den angegebenen
Endpunkt, unabhängig davon, welche Ereignisse er abonniert hat — sie prüft nur
Erreichbarkeit und Signierbarkeit.

## Payload

```json
{
  "id": "clxyz...",
  "type": "invoice.finalized",
  "createdAt": "2026-09-04T12:00:00.000Z",
  "data": { "objectName": "Invoice", "id": "...", "number": "RE-2026-00042", "...": "..." }
}
```

`data` ist derselbe Serializer-Schnappschuss wie die entsprechende REST-Ressource
(`GET /api/v1/Invoice/{id}` u. Ä.) zum Zeitpunkt des Ereignisses — Geld als
Integer-Cent, Daten als ISO 8601. `data` enthält **niemals** `internalNotes`
(interne Notizen erscheinen grundsätzlich in keinem ausgehenden Kanal, siehe
COMPLIANCE.md).

## Header

Jede Zustellung trägt:

| Header | Bedeutung |
|---|---|
| `X-OIG-Signature` | `t=<unix_seconds>,v1=<hex hmac_sha256(secret, "<t>.<body>")>` |
| `X-OIG-Event` | Ereignisname (identisch zu `data.type` im Body) |
| `X-OIG-Delivery` | ID dieser Zustellung (identisch zu `data.id` im Body) |

`t` ist die Unix-Zeit in Sekunden zum Sendezeitpunkt, `<body>` der rohe,
unveränderte Request-Body (exakter Byte-Inhalt — nicht neu serialisieren). Der
Empfänger sollte den Alterswert von `t` gegen die eigene Uhr prüfen und
Zustellungen mit einem zu alten Zeitstempel ablehnen (Replay-Schutz) — eine
Toleranz von wenigen Minuten ist ein üblicher Richtwert; die Software selbst
erzwingt clientseitig keine feste Toleranz.

## Signaturprüfung — Node.js

```js
const crypto = require("crypto");

function verifyOigWebhook(header, secret, rawBody) {
  const match = /^t=(\d+),v1=([0-9a-f]+)$/.exec(header.trim());
  if (!match) return false;
  const [, tStr, providedHex] = match;
  const t = Number(tStr);

  // Replay-Schutz: Zeitstempel darf nicht zu alt sein (hier: 5 Minuten Toleranz).
  const ageSeconds = Math.abs(Date.now() / 1000 - t);
  if (ageSeconds > 5 * 60) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${t}.${rawBody}`)
    .digest("hex");

  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(providedHex, "hex");
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

// Express-Beispiel (rawBody muss der UNVERÄNDERTE Byte-Body sein, z. B. per
// express.raw({ type: "application/json" }) statt express.json()):
app.post("/webhooks/oig", express.raw({ type: "application/json" }), (req, res) => {
  const ok = verifyOigWebhook(
    req.header("X-OIG-Signature") ?? "",
    process.env.OIG_WEBHOOK_SECRET,
    req.body.toString("utf8"),
  );
  if (!ok) return res.status(401).send("invalid signature");
  const event = JSON.parse(req.body.toString("utf8"));
  // ... event.type / event.data verarbeiten
  res.status(200).send("ok");
});
```

## Signaturprüfung — PHP

```php
<?php

function verify_oig_webhook(string $header, string $secret, string $rawBody): bool {
    if (!preg_match('/^t=(\d+),v1=([0-9a-f]+)$/', trim($header), $m)) {
        return false;
    }
    [$full, $tStr, $providedHex] = $m;
    $t = (int) $tStr;

    // Replay-Schutz: Zeitstempel darf nicht zu alt sein (hier: 5 Minuten Toleranz).
    if (abs(time() - $t) > 5 * 60) {
        return false;
    }

    $expectedHex = hash_hmac('sha256', "{$t}.{$rawBody}", $secret);

    // Zeitkonstanter Vergleich.
    return hash_equals($expectedHex, $providedHex);
}

// Beispiel (rawBody = file_get_contents('php://input'), VOR jedem json_decode):
$rawBody = file_get_contents('php://input');
$signatureHeader = $_SERVER['HTTP_X_OIG_SIGNATURE'] ?? '';
$secret = getenv('OIG_WEBHOOK_SECRET');

if (!verify_oig_webhook($signatureHeader, $secret, $rawBody)) {
    http_response_code(401);
    exit('invalid signature');
}

$event = json_decode($rawBody, true);
// ... $event['type'] / $event['data'] verarbeiten
http_response_code(200);
```

## Retry-Zeitplan

Schlägt eine Zustellung fehl (kein 2xx, Timeout nach 10 s), wird sie erneut
versucht — **Erstversuch + 5 Wiederholungen**, mit steigendem Backoff:

| Versuch | Ergebnis bei Fehlschlag | Wartezeit bis zum nächsten Versuch |
|---|---|---|
| 1 (Erstversuch) | `FAILED` | 1 Minute |
| 2 | `FAILED` | 5 Minuten |
| 3 | `FAILED` | 30 Minuten |
| 4 | `FAILED` | 120 Minuten |
| 5 | `FAILED` | 600 Minuten |
| 6 | `DEAD` | — kein weiterer Retry |

Ausnahme: SSRF-Verstoß (Ziel-URL löst zwischenzeitlich auf ein privates/lokales
Netz auf), ein nicht entschlüsselbares Secret oder ein deaktivierter Endpunkt
führen **sofort** zu `DEAD` — ohne Backoff, ohne Netzwerkaufruf. Zustellungen
laufen **seriell** über den Scheduler-Job `webhooks` (kein Parallelversand).

Eine `DEAD`-Zustellung lässt sich manuell **erneut versuchen** (Replay, im UI
oder per `replay_webhook_delivery`/`POST .../deliveries/{id}/replay`) — das legt
eine **neue** Zustellungszeile an, die ursprüngliche bleibt unverändert
(Zustellprotokoll, GoBD-analog: keine Historie wird überschrieben).

## SSRF-Regeln

Webhook-Ziel-URLs müssen `https://` sein und dürfen nicht auf ein privates oder
lokales Netz auflösen — geprüft bei Anlage/Änderung des Endpunkts UND erneut vor
**jeder** Zustellung (eine zum Anlagezeitpunkt öffentliche Adresse könnte sich
zwischenzeitlich geändert haben). Verboten sind:

- IPv4: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`,
  `169.254.0.0/16`, `0.0.0.0/8`, `100.64.0.0/10` (CGNAT), `198.18.0.0/15`
  (Benchmarking, RFC 2544)
- IPv6: `::` (unspezifiziert), `::1` (Loopback), `fe80::/10` (Link-Local),
  `fc00::/7` (ULA), `64:ff9b::/96` (NAT64), `2002::/16` (6to4), sowie
  IPv4-mapped IPv6-Adressen (`::ffff:10.0.0.1` u. Ä., gegen dieselbe IPv4-Liste
  geprüft)

Die Prüfung löst den Hostnamen per DNS auf und prüft **jede** zurückgelieferte
Adresse (nicht nur die erste).

**Wichtig — kein Schutz vor DNS-Rebinding zur Verbindungszeit:** Diese
Vor-Zustellungs-Prüfung validiert erneut den **DNS-Eintrag** (falls sich die
zurückgelieferten Adressen seit der Anlage geändert haben, wird die Zustellung
abgelehnt) — sie ist **kein** Schutz gegen DNS-Rebinding *während* der
eigentlichen Zustellung selbst: `assertPublicHttpsUrl` löst den Hostnamen
einmal auf und prüft diese Adressen, der anschließende `fetch()`-Aufruf löst
denselben Hostnamen **erneut, unabhängig** auf. Bei einem sehr kurzen DNS-TTL
könnte ein Angreifer der Prüfung eine öffentliche Adresse und dem
`fetch()`-Aufruf eine private Adresse liefern (klassisches TOCTOU/DNS-Rebinding).
Eine vollständige Absicherung würde die geprüfte Adresse an die tatsächliche
Verbindung "pinnen" (eigener `lookup`/Agent statt der Standard-Namensauflösung
von `fetch`) — mit der eingebauten `fetch`-API ist das nicht möglich; ein
eigener HTTP-Client mit injizierbarem `lookup` wäre der Weg dorthin (Backlog,
kein Bestandteil dieser Fix-Welle). Zusätzlich schützt `redirect: "manual"`
(kein automatisches Folgen einer 3xx-Antwort) gegen den naheliegendsten
Angriffsweg — ein zunächst öffentlicher Endpunkt, der per Redirect auf ein
privates Ziel umleitet.

## Secrets

Das Secret eines Endpunkts wird verschlüsselt gespeichert (AES-GCM) und ist nach
Anlage bzw. Rotation **kein zweites Mal im Klartext abrufbar** — bei Verlust
hilft nur „Secret rotieren" (erzeugt ein neues, das alte wird ungültig). Secrets
erscheinen nie in Logs, Fehlermeldungen oder API-Antworten außer unmittelbar bei
Anlage/Rotation.

Siehe auch [API.md](API.md) (REST-API allgemein) und
[LIMITATIONEN.md](LIMITATIONEN.md) (bekannte Grenzen).
