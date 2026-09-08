# REST-API (`/api/v1`)

OpenInvoice Germany bietet neben UI und MCP-Server eine **öffentliche, versionierte
REST-API** unter `/api/v1`. Sie ruft **exakt dieselben Domain-Funktionen** wie UI und
MCP auf (kein Bypass) — GoBD-Regeln (festgeschriebene Belege nur über Storno/
Gutschrift/Korrektur), § 14-Pflichtangaben und die EN-16931-Validierung gelten
unverändert.

## Authentifizierung

Jeder API-Aufruf braucht einen **API-Schlüssel** als Bearer-Token:

1. **Einstellungen → API** → „Schlüssel anlegen" → Name, Scopes (`read`, `write`,
   `send`, `admin`), optional ein Ablaufdatum.
2. Das Token (`oig_<32 Byte base64url>`) wird **einmalig** angezeigt — sicher
   aufbewahren, es lässt sich nicht erneut abrufen.
3. Jeder Request sendet `Authorization: Bearer oig_...`.

`/api/v1/*` akzeptiert **ausschließlich** Bearer-Token, kein Session-Cookie. Ein
Schlüssel ohne den passenden Scope liefert `403 FORBIDDEN`.

| Scope   | Bedeutung |
|---------|-----------|
| `read`  | Lesen (GET) |
| `write` | Anlegen/Ändern/zustandsändernde Aktionen (finalisieren, stornieren, Zahlung erfassen, …) |
| `send`  | E-Mail-Versand und Mahnungen (`/send`, `/dunning`) |
| `admin` | Einstellungen (`/Settings`), API-Schlüsselverwaltung (`/ApiKey`) und Webhook-Endpunkte (`/Webhook`) |

## Antwortformat

Einzelobjekt:

```json
{ "data": { "objectName": "Invoice", "id": "...", "...": "..." } }
```

Liste (Paginierung `limit`/`offset`, Default `limit=50`, max. `200`):

```json
{ "data": [ /* ... */ ], "total": 42, "limit": 50, "offset": 0 }
```

Fehler — einheitlich für jeden Endpunkt:

```json
{ "error": { "code": "VALIDATION", "message": "...", "details": { "issues": [ /* Zod */ ] } } }
```

`code` ist einer von `VALIDATION` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403),
`NOT_FOUND` (404), `CONFLICT` (409), `RATE_LIMITED` (429),
`IDEMPOTENCY_MISMATCH`/`IDEMPOTENCY_IN_PROGRESS` (409, siehe unten),
`EINVOICE_INVALID` (409, EN-16931-Kernvalidierung bei `/xrechnung`/`/zugferd`) oder
`INTERNAL` (500).

## Rate-Limit & Idempotenz

- **600 Anfragen/Minute** je Schlüssel. Jede Antwort trägt `X-RateLimit-Remaining`;
  bei Überschreitung `429` + `Retry-After` (Sekunden).
- Schreibende `POST`-Aktionen unterstützen den Header `Idempotency-Key` (1–128
  Zeichen): derselbe Schlüssel + derselbe Request-Body liefert immer dieselbe
  Antwort erneut, ohne den Effekt zu wiederholen (z. B. keine doppelte Zahlung bei
  einem Netzwerk-Retry). Ein abweichender Body unter demselben Schlüssel liefert
  `409 IDEMPOTENCY_MISMATCH`; ein zeitgleicher zweiter Request mit demselben
  Schlüssel liefert `409 IDEMPOTENCY_IN_PROGRESS` (kurz erneut senden).

## Interaktive Dokumentation

`GET /api/docs` — Swagger-UI (Session-Login oder API-Schlüssel), interaktiv gegen
die eigene Instanz nutzbar ("Authorize" → Bearer-Token einfügen). Das zugrunde
liegende OpenAPI-3.1-Dokument steht maschinenlesbar unter
`GET /api/v1/openapi.json` (ebenfalls Session oder Bearer). Per API-Schlüssel
reicht dafür der Scope `read` — ein Schlüssel ganz ohne `read`-Scope (z. B. nur
`write`/`send`) wird abgelehnt, auch wenn er sonst gültig ist.

## Kompletter Ablauf per curl: Kunde → Rechnung → festschreiben → PDF/XRechnung → Zahlung

Alle Beispiele setzen `TOKEN` (siehe oben) und `BASE` (z. B. `http://localhost:3000`)
voraus:

```bash
export BASE="http://localhost:3000"
export TOKEN="oig_...dein-schluessel..."
AUTH="Authorization: Bearer $TOKEN"
```

### 1. Kunde anlegen

```bash
curl -s -X POST "$BASE/api/v1/Contact" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{
        "type": "BUSINESS",
        "name": "Müller GmbH",
        "addressLine1": "Musterstraße 1",
        "postalCode": "12345",
        "city": "Berlin",
        "countryCode": "DE",
        "email": "buchhaltung@mueller-gmbh.de"
      }'
```

Antwort: `{ "data": { "objectName": "Contact", "id": "cl...", "name": "Müller GmbH", ... } }`
— die `id` wird im nächsten Schritt als `customerId` gebraucht.

### 2. Rechnungsentwurf anlegen

```bash
curl -s -X POST "$BASE/api/v1/Invoice" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{
        "customerId": "cl...",
        "lines": [
          { "description": "Beratung", "quantityMilli": 3000, "unit": "HUR",
            "unitNetPriceCents": 9500, "taxRate": 19 }
        ]
      }'
```

Antwort enthält `data.id` (Rechnung, Status `DRAFT`, noch keine Rechnungsnummer).

### 3. Festschreiben (GoBD: unveränderbar ab hier)

```bash
curl -s -X POST "$BASE/api/v1/Invoice/<id>/finalize" -H "$AUTH"
```

Vergibt die Rechnungsnummer aus dem Nummernkreis und schreibt die Rechnung fest.
Erneutes Festschreiben derselben Rechnung liefert `409 CONFLICT`.

### 4. PDF und XRechnung abrufen

```bash
curl -s "$BASE/api/v1/Invoice/<id>/pdf" -H "$AUTH" -o rechnung.pdf
curl -s "$BASE/api/v1/Invoice/<id>/xrechnung" -H "$AUTH" -o rechnung.xml
```

Beide liefern die Datei direkt als Bytes (kein `{data}`-Umschlag), Content-Type
`application/pdf` bzw. `application/xml`. Schlägt die EN-16931-Kernvalidierung fehl
(z. B. unvollständige Verkäuferadresse), antwortet `/xrechnung` bzw. `/zugferd` mit
`409 EINVOICE_INVALID` und `error.details.issues`.

### 5. Zahlung erfassen

```bash
curl -s -X POST "$BASE/api/v1/Invoice/<id>/payment" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -H "Idempotency-Key: zahlung-2076-09-04-001" \
  -d '{ "amountCents": 33915, "method": "TRANSFER" }'
```

Der `Idempotency-Key` sorgt dafür, dass ein wiederholter Request (z. B. Timeout im
Client) nicht zweimal gebucht wird — derselbe Schlüssel liefert dieselbe Antwort
erneut. Nach vollständiger Zahlung wechselt die Rechnung auf Status `PAID`.

## Anfrageprotokoll

Jede Antwort von `/api/v1/*` — Erfolg **und** Fehler — trägt den Header
`X-Request-Id` (UUID), **mit Ausnahme von** `GET /api/v1/openapi.json` (läuft
bewusst ohne den `withApi`-Wrapper, siehe „Was NICHT protokolliert wird"
unten). Ist das Anfrageprotokoll für die Organisation eingeschaltet
(**standardmäßig AUS**, `Einstellungen → API → Anfrageprotokoll`), landet zu
jeder protokollierten Anfrage eine Zeile mit **derselben** Kennung in
`ApiRequestLog.requestId` — der Header eignet sich damit als Suchschlüssel beim
Support/Debugging.

`GET /api/v1/ApiRequestLog` (Filter: `apiKeyId`, `errorsOnly`, `path`, `from`/
`to`, `limit`/`offset`) und `GET /api/v1/ApiRequestLog/{id}` — Scope `read`,
**ausschließlich lesend**: kein `POST`/`PATCH`/`DELETE` über die API, Löschen
("Protokoll leeren") und die Einstellungen (`logRequests`/`logBodies`/
`retentionDays`/`maxRows`) sind ausschließlich über die Session-Route der UI
erreichbar (`Einstellungen → API`), nicht über `/api/v1`. Die Listenantwort
enthält aus Datenminimierungsgründen **keine** Request-/Response-Bodies (immer
`null`) — volle Bodies (sofern gespeichert) liefert nur der Einzelabruf
`GET /api/v1/ApiRequestLog/{id}`.

**Was im „nur Kopfdaten"-Modus (`logRequests` an, `logBodies` aus) gespeichert
wird:** Methode, Pfad **inklusive Query-String** (Parameter mit verdächtigem
Namen — Geheimnis-Muster wie `token`/`secret`/`password`/`apiKey`/`iban`/`bic`
sowie `email` — werden vor dem Speichern geschwärzt; scheitert die Schwärzung
ausnahmsweise, wird der Pfad **ohne** Query gespeichert), Status, Dauer,
`apiKeyId`, Request-ID sowie **IP-Adresse und User-Agent** des Aufrufers. Nur
Request-/Response-Bodies hängen zusätzlich am separaten Schalter `logBodies`.

**Was NICHT protokolliert wird:**
- Anfragen, die die Authentifizierung nicht passieren — ein `401` mit
  unbekanntem/ungültigem Schlüssel oder ein Vor-Auth-`429` — es gibt in diesem
  Fall keine Organisation, der die Zeile zuzuordnen wäre.
- `GET /api/docs`, `GET /api/v1/openapi.json`, `GET /api/v1/ping` sowie
  `/api/v1/ApiRequestLog` selbst (Rekursionsschutz) — diese Pfade tragen nichts
  zur Fehlersuche bei.

## Auswertungen (Phase 12e)

`GET /api/v1/Report` (Scope `read`) liefert dieselben Auswertungen wie die Diagramme
auf Dashboard und Kundenseite — **keine eigene Aggregation** für die API, sondern
derselbe Kern (`runReport`, `src/domain/reporting/query.ts`), den auch das MCP-Tool
`get_report` aufruft. Kein Eintrag in der CRUD-Ressourcenliste unten: `Report` ist
rein lesend und keine Tabelle, die Antwortform ist bewusst `{ data: <typabhängig> }`
ohne festes Ressourcenschema (wie bei den Aktions-Endpunkten).

Parameter (Query):

| Parameter | Pflicht | Bedeutung |
|---|---|---|
| `type` | ja | `revenue` \| `top-customers` \| `status` \| `payment-behaviour` |
| `months` | nein | Anzahl Kalendermonate rückwirkend (1–36, Default 12) — **nur bei `revenue` und `top-customers` zulässig** (Fix 2, ehem. M8) |
| `limit` | nein | Anzahl Kunden (1–50, Default 5) — **nur bei `top-customers` zulässig** |
| `customerId` | nein | auf einen Kunden einschränken — **nur bei `revenue` und `payment-behaviour` zulässig** |

Ein unbekannter `type`, `months`/`limit` außerhalb ihrer Grenzen ODER ein beim
gewählten `type` **nicht zulässiger** Parameter (z. B. `limit` bei
`type=revenue`, `months` bei `type=status`) liefert `400 VALIDATION` — die
Meldung (`error.details.issues`) nennt den betroffenen Parameter. Vor Fix 2
wurde ein nicht zutreffender Parameter still ignoriert; das ist seither ein
Fehler, kein No-op mehr.

- **`revenue`** — Netto-Umsatz je Kalendermonat, lückenlos (auch Monate ohne Beleg
  als 0), Entwürfe ausgeschlossen, Gutschriften/Stornos bereits mit ihrem
  (negativen) Vorzeichen enthalten.
- **`top-customers`** — die `limit` umsatzstärksten Kunden (netto) im Zeitraum,
  absteigend sortiert.
- **`status`** — Anzahl Rechnungen je effektivem Status (inkl. fällig/überfällig-
  Ableitung) sowie der offene Betrag je Status.
- **`payment-behaviour`** — Ø Tage bis zur Zahlung und Pünktlichkeitsanteil (0–1)
  über als `PAID` abgeschlossene Rechnungen; beide Felder sind `null` ohne
  auswertbare Datengrundlage (keine bezahlte Rechnung bzw. keine mit
  Fälligkeitsdatum).

Beispiel:

```bash
curl -s "$BASE/api/v1/Report?type=revenue&months=6" -H "$AUTH"
```

```json
{
  "data": {
    "objectName": "Report",
    "type": "revenue",
    "rows": [
      { "month": "2026-03", "netCents": 0, "count": 0 },
      { "month": "2026-04", "netCents": 150000, "count": 2 }
    ]
  }
}
```

`type=payment-behaviour` liefert `rows` stets als Ein-Elemente-Array
(`[{ avgDaysToPay, onTimeShare, paidCount }]`) — dieselbe Form wie die anderen drei
Typen, damit Konsumenten nicht zwischen Liste und Einzelobjekt unterscheiden müssen.

## Weitere Ressourcen

`Contact`, `ContactAddress`, `ContactPerson`, `Product`, `Quote`,
`OrderConfirmation`, `DeliveryNote`, `Invoice`, `Payment`, `Dunning`, `Attachment`,
`EmailLog`, `PaymentMethod`, `TextTemplate`, `EmailTemplate`, `Recurring`,
`Settings`, `ApiKey`, `Webhook`, `Layout`, `ApiRequestLog` — vollständige Liste mit
Feldern, Filtern (`embed=`, Statusfilter, Datumsbereiche) und Beispielen:
`GET /api/docs`.

`GET /api/v1/Layout` (Scope `read`) liefert die sieben festen PDF-Layouts (`id`,
`name`, `description`, `thumbnailUrl`) — keine Paginierung, kein POST/PATCH (feste
Liste, keine DB-Tabelle). Auswahl je Organisation/Belegtyp über `PATCH
/api/v1/Settings` (`branding.layoutId`/`branding.layoutByType`). Eine Beleg-
individuelle Layout-Überschreibung ist seit der Fix-Welle (Phase 11b) auch über
`/api/v1` erreichbar: `GET`/`PATCH /api/v1/{Invoice,Quote,DeliveryNote}/{id}/print-
options` (Scope `read`/`write`) liefert die effektiven Druckoptionen (globale
Einstellungen verschmolzen mit einer etwaigen Beleg-Überschreibung) bzw. setzt die
Überschreibung als Ganzes (`printOptionsOverrideSchema`, inkl. optionalem
`layoutId`) — dieselbe Domain-Funktion (`setPrintOptions`) wie MCP
(`set_print_options`) und UI, nur solange der Beleg im Entwurf (`DRAFT`) ist (409
sonst). `Quote/{id}/print-options` gilt nur für `kind=ANGEBOT` — Auftragsbestätigung/
Proforma haben keinen eigenen `print-options`-Endpunkt.

`GET`/`PATCH /api/v1/Settings` (Scope `admin`) bündelt drei Fragmente unter je
einem Schlüssel: `documents` (u. a. `taxRates` — die org-eigene Liste
freigegebener Steuersätze, 1–10 ganze Prozentwerte 0–100, Default `[19, 7, 0]`,
Phase 12c), `branding` (u. a. `appName`/`appShortName`/`faviconPath`/
`appLogoPath` — Marke/White-Label, Phase 12c; `appName`/`appShortName` sind per
`PATCH` schreibbar, `faviconPath`/`appLogoPath` nur lesbar — Datei-Upload läuft
ausschließlich über die Session-Route `/api/settings/branding/upload`, nicht
über `/api/v1`) und `print`. Ein Versuch, eine Rechnung/ein Angebot/einen
Lieferschein/ein Produkt mit einem Steuersatz zu speichern, der **nicht** in
`documents.taxRates` steht (und auch nicht bereits auf dem betroffenen Beleg
gespeichert war), liefert `409 CONFLICT` — dieselbe Regel wie in UI und MCP,
durchgesetzt in den Domain-Kernen, kein API-eigener Bypass.

## Webhooks

Event-getriebene Zustellung (Outbox, HMAC-Signatur, Retry) über
`/api/v1/Webhook` (Scope `admin`) — Ereignisse, Payload-Form, Signaturprüfung
(Node/PHP), Retry-Zeitplan und SSRF-Regeln: siehe [WEBHOOKS.md](WEBHOOKS.md).

## Fehlende Endpunkte / Grenzen (siehe auch [LIMITATIONEN.md](LIMITATIONEN.md))

- Die meisten Aktions-Endpunkte (`/finalize`, `/cancel`, `/credit`, `/convert`,
  `/status`, `/duplicate`, …) liefern die **vollständige, aktualisierte Ressource**
  (nicht nur ein Teilobjekt) — Ausnahmen mit einem kleinen, expliziten
  Antwortobjekt: `/send` (`{emailLogId, status}`), `/payment`
  (`{payment, invoice}` — `payment` ist trotz des Feldnamens die aktualisierte
  Rechnung, siehe `/api/docs`), `/dunning` (`{dunning}`), `/share-link`
  (`{url, token?, expiresAt}`). Datei-Endpunkte (`/pdf`, `/xrechnung`,
  `/zugferd`) bleiben binär.
- `DeliveryNote` hat keinen `PATCH`-Endpunkt (keine `updateDraft`-Domainfunktion
  vorhanden) — siehe [LIMITATIONEN.md](LIMITATIONEN.md).
- `Layout` (Phase 11b) selbst ist nur lesbar (`GET`, feste Liste, keine DB-Tabelle) —
  eine Beleg-individuelle Layout-Überschreibung setzt sich stattdessen über `PATCH
  /api/v1/{Invoice,Quote,DeliveryNote}/{id}/print-options` (siehe oben).
- Multi-Tenant-Rollen gibt es nicht — ein API-Schlüssel gehört zu genau einer
  Organisation, „Berechtigungen" bedeuten hier ausschließlich Scopes.
- `POST /api/pdf/preview` (Beleg-Editor, Phase 11c) ist **keine** `/api/v1`-Ressource:
  eine Session-Route (Browser-Login, kein Bearer-Token) zum Rendern eines
  ungespeicherten Editor-Entwurfs (`{kind, payload, layoutId?}`) — ohne
  Nummernkreis/`ChangeLog`/DB-Schreibzugriff, Belegnummer „ENTWURF", Wasserzeichen
  „VORSCHAU". Für einen bereits gespeicherten Beleg liefert stattdessen `GET
  /api/v1/Invoice/{id}/pdf` (Scope `read`) das PDF; `Quote`/`DeliveryNote` haben
  keinen `/pdf`-Endpunkt unter `/api/v1` (nur die Session-Routen
  `/api/documents/[id]/pdf` bzw. `/api/delivery-notes/[id]/pdf`).
