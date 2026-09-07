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

## Weitere Ressourcen

`Contact`, `ContactAddress`, `ContactPerson`, `Product`, `Quote`,
`OrderConfirmation`, `DeliveryNote`, `Invoice`, `Payment`, `Dunning`, `Attachment`,
`EmailLog`, `PaymentMethod`, `TextTemplate`, `EmailTemplate`, `Recurring`,
`Settings`, `ApiKey`, `Webhook` — vollständige Liste mit Feldern, Filtern (`embed=`,
Statusfilter, Datumsbereiche) und Beispielen: `GET /api/docs`.

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
- Multi-Tenant-Rollen gibt es nicht — ein API-Schlüssel gehört zu genau einer
  Organisation, „Berechtigungen" bedeuten hier ausschließlich Scopes.
